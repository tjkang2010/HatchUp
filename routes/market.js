// ============================================================
// 🏪 거래시장 API - market.js (v3.2 보안 감사 완료)
// ============================================================
// 보안 강화 내역:
//   1. cancel - 트랜잭션 내 status 재확인 (취소-구매 경쟁 방지)
//   2. buy    - listingId/characterId 정수 검증
//   3. buy    - 트랜잭션 내 자기자신 구매 재확인
//   4. list   - characterId 정수 검증
//   5. 포인트 음수 changePoints 내부 방지 (기존 유지)
// ============================================================
const express = require('express');
const db      = require('../db/db');
const auth    = require('../middleware/auth');
const logger  = require('../utils/logger');
const { checkAchievements } = require('./achievements');

const router = express.Router();
router.use(auth.required);

const FEE_NORMAL  = 0.05; // 일반 5%
const FEE_PREMIUM = 0.03; // 프리미엄 3%

// ── 입력값 정수 검증 헬퍼 ────────────────────────────────
function toInt(val, fieldName) {
  const n = parseInt(val, 10);
  if (isNaN(n) || n <= 0) throw Object.assign(new Error(`${fieldName}이(가) 올바르지 않습니다.`), { status: 400 });
  return n;
}

// ── 거래시장 목록 ─────────────────────────────────────────
router.get('/', (req, res) => {
  try {
    const adapter = db.getAdapter();
    const { sort='price', order='asc', rarity, version } = req.query;

    let sql = `
      SELECT ml.id AS listing_id, ml.price, ml.created_at AS listed_at,
             c.id AS character_id, c.name, c.stage, c.version, c.level,
             c.rarity, c.hunger, c.happy, c.health, c.age_days, c.exp,
             u.nickname AS seller_nickname
      FROM market_listings ml
      JOIN characters c ON ml.character_id = c.id
      JOIN users u ON ml.seller_id = u.id
      WHERE ml.status = 'active' AND c.is_dead = 0
    `;
    const params = [];
    if (rarity)  { sql += ' AND c.rarity = ?';  params.push(rarity); }
    if (version) { sql += ' AND c.version = ?'; params.push(parseInt(version, 10) || 1); }

    const sortMap = { price:'ml.price', level:'c.level', listed_at:'ml.created_at' };
    const sortCol = sortMap[sort] || 'ml.price';
    const sortDir = order === 'desc' ? 'DESC' : 'ASC';
    sql += ` ORDER BY ${sortCol} ${sortDir} LIMIT 50`;

    const listings = adapter.all(sql, params);
    res.json({
      success:  true,
      listings: listings.map(l => ({ ...l, rarityLabel: rarityLabel(l.rarity) })),
    });
  } catch (error) {
    logger.error('마켓 목록 오류: ' + error.message);
    res.status(500).json({ success:false, message:'오류가 발생했습니다.' });
  }
});

// ── 판매 등록 ────────────────────────────────────────────
router.post('/list', (req, res) => {
  try {
    const adapter = db.getAdapter();
    const userId  = req.user.userId;

    // ⚠️ 정수 검증
    let characterId, reqPrice;
    try {
      characterId = toInt(req.body.characterId, 'characterId');
      reqPrice    = toInt(req.body.price,       '판매가');
    } catch(e) {
      return res.status(400).json({ success:false, message: e.message });
    }

    const char = adapter.get('SELECT * FROM characters WHERE id=? AND user_id=?', [characterId, userId]);
    if (!char)             return res.status(404).json({ success:false, message:'캐릭터를 찾을 수 없습니다.' });
    if (char.stage !== 'adult') return res.status(400).json({ success:false, message:'성인 캐릭터만 판매할 수 있습니다.' });
    if (char.is_dead)      return res.status(400).json({ success:false, message:'사망한 캐릭터는 판매할 수 없습니다.' });
    if (char.sold_at)      return res.status(400).json({ success:false, message:'이미 판매된 캐릭터입니다.' });
    if (char.is_for_sale)  return res.status(400).json({ success:false, message:'이미 판매 등록된 캐릭터입니다.' });

    // 서버에서 가격 범위 검증 (클라이언트 입력 신뢰 금지)
    const { calcSalePrice } = require('./game');
    const priceInfo = calcSalePrice(char);
    if (reqPrice < priceInfo.min || reqPrice > priceInfo.max) {
      return res.status(400).json({
        success:     false,
        message:     `판매가는 ${priceInfo.min}P ~ ${priceInfo.max}P 사이여야 합니다.`,
        recommended: priceInfo,
      });
    }

    adapter.transaction(() => {
      adapter.run(
        "INSERT INTO market_listings (seller_id,character_id,price,status) VALUES (?,?,?,'active')",
        [userId, characterId, reqPrice]
      );
      db.updateCharacter(characterId, { is_for_sale:1, sale_price:reqPrice, last_update: new Date().toISOString() });
    })();

    logger.info(`🏪 판매 등록: 캐릭터 ${characterId}, ${reqPrice}P, 판매자 ${userId}`);
    res.json({ success:true, message:`판매 등록! ${reqPrice}P`, price:reqPrice, recommended:priceInfo });
  } catch (error) {
    logger.error('판매 등록 오류: ' + error.message);
    res.status(500).json({ success:false, message:'오류가 발생했습니다.' });
  }
});

// ── 판매 취소 (경쟁조건 방지 강화) ──────────────────────
router.post('/cancel', (req, res) => {
  try {
    const adapter = db.getAdapter();
    const userId  = req.user.userId;

    // ⚠️ 정수 검증
    let listingId;
    try { listingId = toInt(req.body.listingId, 'listingId'); }
    catch(e) { return res.status(400).json({ success:false, message: e.message }); }

    // 트랜잭션 밖 사전 확인 (빠른 실패)
    const listing = adapter.get(
      'SELECT * FROM market_listings WHERE id=? AND seller_id=?',
      [listingId, userId]
    );
    if (!listing) return res.status(404).json({ success:false, message:'등록을 찾을 수 없습니다.' });
    if (listing.status !== 'active') return res.status(400).json({ success:false, message:'취소할 수 없는 상태입니다.' });

    // ⚠️ 트랜잭션 내부에서 status 재확인 (취소-구매 경쟁 방지)
    const txn = adapter.transaction(() => {
      const check = adapter.get(
        "SELECT id FROM market_listings WHERE id=? AND seller_id=? AND status='active'",
        [listingId, userId]
      );
      if (!check) throw new Error('이미 판매됐거나 취소된 목록입니다.');

      adapter.run("UPDATE market_listings SET status='canceled' WHERE id=?", [listingId]);
      db.updateCharacter(listing.character_id, {
        is_for_sale:0, sale_price:0, last_update: new Date().toISOString()
      });
    });

    txn();

    logger.info(`❌ 판매 취소: 목록 ${listingId}, 판매자 ${userId}`);
    res.json({ success:true, message:'판매 취소 완료!' });

  } catch (error) {
    logger.error('판매 취소 오류: ' + error.message);
    if (error.message.includes('이미 판매됐거나')) {
      return res.status(409).json({ success:false, message: error.message });
    }
    res.status(500).json({ success:false, message:'오류가 발생했습니다.' });
  }
});

// ── 캐릭터 구매 (동시성 + 자기구매 완전 방지) ───────────
router.post('/buy', (req, res) => {
  try {
    const adapter = db.getAdapter();
    const buyerId = req.user.userId;

    // ⚠️ 정수 검증
    let listingId;
    try { listingId = toInt(req.body.listingId, 'listingId'); }
    catch(e) { return res.status(400).json({ success:false, message: e.message }); }

    // 트랜잭션 밖 사전 확인
    const listing = adapter.get("SELECT * FROM market_listings WHERE id=? AND status='active'", [listingId]);
    if (!listing) return res.status(404).json({ success:false, message:'판매 중인 캐릭터를 찾을 수 없습니다.' });

    // 트랜잭션 밖에서 자기자신 구매 1차 차단
    if (listing.seller_id === buyerId) {
      return res.status(400).json({ success:false, message:'자신의 캐릭터를 살 수 없습니다.' });
    }

    const buyer = db.getUserById(buyerId);
    if (buyer.points < listing.price) {
      return res.status(400).json({
        success: false,
        message: `포인트 부족 (필요:${listing.price}P, 보유:${buyer.points}P)`,
      });
    }

    // 수수료 계산
    const seller    = db.getUserById(listing.seller_id);
    const feeRate   = seller.is_premium ? FEE_PREMIUM : FEE_NORMAL;
    const fee       = Math.floor(listing.price * feeRate);
    const sellerGet = listing.price - fee;
    const now       = new Date().toISOString();
    const txRef     = `market-buy-${listingId}-${buyerId}-${Date.now()}`;

    // ⚠️ 트랜잭션 내부에서 3중 방어
    const txn = adapter.transaction(() => {
      // 1. status 재확인 (이중 구매 방지)
      const check = adapter.get(
        "SELECT id, seller_id FROM market_listings WHERE id=? AND status='active'",
        [listingId]
      );
      if (!check) throw new Error('이미 판매됐거나 취소된 목록입니다.');

      // 2. 자기자신 구매 트랜잭션 내 재확인 (계정 공유 등 엣지 케이스)
      if (check.seller_id === buyerId) throw new Error('자신의 캐릭터를 살 수 없습니다.');

      // 3. 즉시 sold로 변경 (다른 구매 요청 차단)
      adapter.run("UPDATE market_listings SET status='sold', sold_at=? WHERE id=?", [now, listingId]);

      // 구매자 포인트 차감 (changePoints 내부에서 음수 방지)
      db.changePoints(buyerId, -listing.price, 'spend',
        `캐릭터 구매 (마켓 #${listingId})`,
        `${txRef}-buyer`
      );

      // 판매자 포인트 지급
      db.changePoints(listing.seller_id, sellerGet, 'sale',
        `캐릭터 판매 (마켓 #${listingId}, 수수료 ${Math.round(feeRate*100)}%)`,
        `${txRef}-seller`
      );

      // 거래 내역 기록
      adapter.run(
        'INSERT INTO market_transactions (listing_id,buyer_id,seller_id,amount,fee,seller_receive) VALUES (?,?,?,?,?,?)',
        [listingId, buyerId, listing.seller_id, listing.price, fee, sellerGet]
      );

      // 캐릭터 소유권 이전 + sold_at 기록 (재판매 방지)
      adapter.run(
        'UPDATE characters SET user_id=?, is_for_sale=0, sale_price=0, sold_at=?, last_update=? WHERE id=?',
        [buyerId, now, now, listing.character_id]
      );

      // character_trades 동기화
      adapter.run(
        "UPDATE character_trades SET buyer_id=?, status='sold', traded_at=? WHERE character_id=? AND status='listing'",
        [buyerId, now, listing.character_id]
      );
    });

    txn();

    try { checkAchievements(listing.seller_id); } catch(e) {}

    logger.info(`💰 거래: 캐릭터 ${listing.character_id}, ${listing.seller_id}→${buyerId}, ${listing.price}P (수수료 ${fee}P)`);
    res.json({ success:true, message:`거래 완료! ${listing.price}P 차감`, price:listing.price, fee, sellerReceive:sellerGet });

  } catch (error) {
    logger.error('구매 오류: ' + error.message);
    if (error.message.includes('이미 판매됐거나') || error.message.includes('자신의 캐릭터')) {
      return res.status(409).json({ success:false, message: error.message });
    }
    if (error.message.includes('중복 지급')) {
      return res.status(409).json({ success:false, message:'중복 구매 요청입니다.' });
    }
    if (error.message.includes('포인트 부족')) {
      return res.status(400).json({ success:false, message: error.message });
    }
    res.status(500).json({ success:false, message:'오류가 발생했습니다.' });
  }
});

// ── 내 판매 목록 ──────────────────────────────────────────
router.get('/my-listings', (req, res) => {
  try {
    const listings = db.getAdapter().all(`
      SELECT ml.*, c.name, c.stage, c.version, c.level, c.rarity
      FROM market_listings ml
      JOIN characters c ON ml.character_id = c.id
      WHERE ml.seller_id = ?
      ORDER BY ml.created_at DESC LIMIT 30
    `, [req.user.userId]);
    res.json({ success:true, listings });
  } catch (error) {
    res.status(500).json({ success:false, message:'오류가 발생했습니다.' });
  }
});

// ── 거래 내역 ────────────────────────────────────────────
router.get('/history', (req, res) => {
  try {
    const userId  = req.user.userId;
    const history = db.getAdapter().all(`
      SELECT mt.*, c.name AS char_name, c.rarity, c.version,
             s.nickname AS seller_nickname, b.nickname AS buyer_nickname
      FROM market_transactions mt
      JOIN market_listings ml ON mt.listing_id = ml.id
      JOIN characters c ON ml.character_id = c.id
      JOIN users s ON mt.seller_id = s.id
      JOIN users b ON mt.buyer_id  = b.id
      WHERE mt.buyer_id=? OR mt.seller_id=?
      ORDER BY mt.created_at DESC LIMIT 30
    `, [userId, userId]);
    res.json({ success:true, history });
  } catch (error) {
    res.status(500).json({ success:false, message:'오류가 발생했습니다.' });
  }
});

function rarityLabel(rarity) {
  return {common:'일반',advanced:'고급',rare:'희귀',heroic:'영웅',legendary:'전설'}[rarity]||'일반';
}

module.exports = router;
