// ============================================================
// 🎮 게임 기능 API - game.js (3차 수정본)
// ============================================================
// DB 필드명 기준:
//   age_days  (age 사용 금지)
//   poop_count (poop 사용 금지)
// ============================================================

const express = require('express');
const db      = require('../db/db');
const auth    = require('../middleware/auth');
const logger  = require('../utils/logger');

const router = express.Router();
router.use(auth.required);

// ============================================================
// 시간 경과 자동 상태 변화 함수
// (마지막 업데이트 이후 경과 시간만큼 상태 자동 계산)
// ============================================================
function applyTimeDecay(character) {
  const now          = new Date();
  const lastUpdate   = new Date(character.last_update);
  const elapsedMs    = now - lastUpdate;
  const elapsedMins  = elapsedMs / (1000 * 60);

  if (elapsedMins < 1) return character; // 1분 미만 변화 없음

  // 단계별 시간당 감소율 (분당)
  const rates = {
    egg:   { hungerRate: 0,   happyRate: 0,   },
    baby:  { hungerRate: 0.5, happyRate: 0.3, },
    child: { hungerRate: 0.6, happyRate: 0.4, },
    teen:  { hungerRate: 0.7, happyRate: 0.5, },
    adult: { hungerRate: 0.8, happyRate: 0.5, },
  };
  const rate = rates[character.stage] || rates.baby;

  // ── 상태값 계산 (DB 필드명 기준) ──────────────────────────
  let hunger     = character.hunger;
  let happy      = character.happy;
  let health     = character.health;
  let poop_count = character.poop_count; // ← poop 아님
  let is_sick    = character.is_sick;

  if (!character.is_sleeping) {
    hunger = Math.max(0, hunger - (rate.hungerRate * elapsedMins));
    happy  = Math.max(0, happy  - (rate.happyRate  * elapsedMins));
  }

  // 변 증가 (2시간마다 1개)
  if (character.stage !== 'egg') {
    const poopIncrease = Math.floor(elapsedMins / 120);
    poop_count = Math.min(5, poop_count + poopIncrease);
  }

  // 건강 감소 (배고픔 낮거나 변 많을 때)
  if (hunger < 20 || poop_count >= 3) {
    health = Math.max(0, health - (0.3 * elapsedMins));
  }

  // 변 4개 이상이면 자동으로 아픔
  if (poop_count >= 4 && !is_sick) is_sick = 1;

  // 나이 증가 (하루마다 1)
  const ageIncrease = Math.floor(elapsedMins / (24 * 60));
  const age_days    = character.age_days + ageIncrease; // ← age 아님

  // 사망 판정
  let is_dead = character.is_dead;
  let stage   = character.stage;
  if (health <= 0 && !is_dead) {
    is_dead = 1;
    stage   = 'dead';
  }

  // 성인 판정
  let matured_at = character.matured_at;
  if (stage === 'adult' && !matured_at) {
    matured_at = now.toISOString();
  }

  // 자동 진화
  const stageOrder = ['egg', 'baby', 'child', 'teen', 'adult'];
  const curIdx     = stageOrder.indexOf(stage);
  if (curIdx >= 0 && curIdx < stageOrder.length - 1 && !is_dead) {
    const daysToEvolve = [0.2, 7, 14, 25];
    if (age_days >= daysToEvolve[curIdx] && health > 30) {
      stage = stageOrder[curIdx + 1];
    }
  }

  // DB 업데이트 (age_days, poop_count 기준)
  const updates = {
    hunger:     Math.round(hunger),
    happy:      Math.round(happy),
    health:     Math.round(health),
    poop_count,          // ← poop 아님
    is_sick,
    is_dead,
    stage,
    age_days,            // ← age 아님
    matured_at,
    last_update: now.toISOString(),
  };

  if (is_dead && !character.died_at) {
    updates.died_at = now.toISOString();
  }

  db.updateCharacter(character.id, updates);
  return { ...character, ...updates };
}

// ============================================================
// 📊 캐릭터 상태 조회
// GET /api/game/status
// ============================================================
router.get('/status', (req, res) => {
  try {
    const adapter = db.getAdapter();
    const userId  = req.user.userId;

    let character = adapter.get(
      'SELECT * FROM characters WHERE user_id = ? AND is_dead = 0 ORDER BY id DESC LIMIT 1',
      [userId]
    );

    if (!character) {
      return res.json({ success: true, character: null, message: '키우는 캐릭터가 없습니다.' });
    }

    character = applyTimeDecay(character);

    const daysAlive = Math.floor(
      (new Date() - new Date(character.born_at)) / (1000 * 60 * 60 * 24)
    );

    const inventory = adapter.all(
      'SELECT item_type, quantity FROM inventory WHERE user_id = ?', [userId]
    );
    const invMap = {};
    inventory.forEach(i => { invMap[i.item_type] = i.quantity; });

    res.json({
      success: true,
      character: {
        ...character,
        daysAlive,
        canSell:       character.stage === 'adult' && !character.is_for_sale,
        daysRemaining: Math.max(0, 30 - daysAlive),
      },
      inventory: invMap,
      points: db.getUserById(userId).points,
    });

  } catch (error) {
    logger.error('상태 조회 오류: ' + error.message);
    db.logError('error', '상태 조회 실패: ' + error.message, error.stack, req.user?.userId, '/api/game/status');
    res.status(500).json({ success: false, message: '상태를 불러오지 못했습니다.' });
  }
});

// ============================================================
// 🍖 먹이주기
// POST /api/game/feed
// ============================================================
router.post('/feed', (req, res) => {
  try {
    const adapter = db.getAdapter();
    const userId  = req.user.userId;

    const character = adapter.get(
      'SELECT * FROM characters WHERE user_id = ? AND is_dead = 0 ORDER BY id DESC LIMIT 1',
      [userId]
    );
    if (!character)              return res.status(404).json({ success: false, message: '캐릭터가 없습니다.' });
    if (character.is_dead)       return res.status(400).json({ success: false, message: '이미 사망한 캐릭터입니다.' });
    if (character.is_sleeping)   return res.status(400).json({ success: false, message: '자고 있어요. 깨워주세요!' });
    if (character.stage === 'egg') return res.status(400).json({ success: false, message: '알은 먹이를 먹지 않아요!' });

    const inv = adapter.get(
      'SELECT quantity FROM inventory WHERE user_id = ? AND item_type = ?',
      [userId, 'food']
    );
    if (!inv || inv.quantity <= 0) {
      return res.status(400).json({ success: false, message: '먹이가 없습니다. 상점에서 구매해주세요!' });
    }

    adapter.transaction(() => {
      adapter.run(
        'UPDATE inventory SET quantity = quantity - 1 WHERE user_id = ? AND item_type = ?',
        [userId, 'food']
      );
      db.updateCharacter(character.id, {
        hunger:      Math.min(100, character.hunger + 35),
        last_update: new Date().toISOString(),
      });
    })();

    res.json({ success: true, message: '냠냠! 맛있게 먹었어요! 😋', hungerGain: 35 });

  } catch (error) {
    logger.error('먹이주기 오류: ' + error.message);
    res.status(500).json({ success: false, message: '오류가 발생했습니다.' });
  }
});

// ============================================================
// 🎮 놀기
// POST /api/game/play
// ============================================================
router.post('/play', (req, res) => {
  try {
    const adapter = db.getAdapter();
    const userId  = req.user.userId;

    const character = adapter.get(
      'SELECT * FROM characters WHERE user_id = ? AND is_dead = 0 ORDER BY id DESC LIMIT 1',
      [userId]
    );
    if (!character) return res.status(404).json({ success: false, message: '캐릭터가 없습니다.' });
    if (character.is_dead || character.is_sleeping || character.is_sick) {
      return res.status(400).json({ success: false, message: '지금은 놀 수 없어요!' });
    }

    const inv = adapter.get(
      'SELECT quantity FROM inventory WHERE user_id = ? AND item_type = ?',
      [userId, 'toy']
    );
    if (!inv || inv.quantity <= 0) {
      return res.status(400).json({ success: false, message: '장난감이 없습니다. 상점에서 구매해주세요!' });
    }

    adapter.transaction(() => {
      adapter.run(
        'UPDATE inventory SET quantity = quantity - 1 WHERE user_id = ? AND item_type = ?',
        [userId, 'toy']
      );
      db.updateCharacter(character.id, {
        happy:       Math.min(100, character.happy + 40),
        hunger:      Math.max(0,   character.hunger - 8),
        last_update: new Date().toISOString(),
      });
    })();

    res.json({ success: true, message: '신나게 놀았어요! 야호! 🎉', happyGain: 40 });

  } catch (error) {
    logger.error('놀기 오류: ' + error.message);
    res.status(500).json({ success: false, message: '오류가 발생했습니다.' });
  }
});

// ============================================================
// 🪣 청소
// POST /api/game/clean
// ============================================================
router.post('/clean', (req, res) => {
  try {
    const adapter = db.getAdapter();
    const userId  = req.user.userId;

    const character = adapter.get(
      'SELECT * FROM characters WHERE user_id = ? AND is_dead = 0 ORDER BY id DESC LIMIT 1',
      [userId]
    );
    if (!character) return res.status(404).json({ success: false, message: '캐릭터가 없습니다.' });

    const inv = adapter.get(
      'SELECT quantity FROM inventory WHERE user_id = ? AND item_type = ?',
      [userId, 'clean']
    );
    if (!inv || inv.quantity <= 0) {
      return res.status(400).json({ success: false, message: '청소도구가 없습니다. 상점에서 구매해주세요!' });
    }

    adapter.transaction(() => {
      adapter.run(
        'UPDATE inventory SET quantity = quantity - 1 WHERE user_id = ? AND item_type = ?',
        [userId, 'clean']
      );
      // poop_count 기준 (poop 아님)
      db.updateCharacter(character.id, {
        poop_count:  0,
        is_sick:     0,
        last_update: new Date().toISOString(),
      });
    })();

    res.json({ success: true, message: '깨끗하게 청소했어요! ✨' });

  } catch (error) {
    logger.error('청소 오류: ' + error.message);
    res.status(500).json({ success: false, message: '오류가 발생했습니다.' });
  }
});

// ============================================================
// 💊 약 주기
// POST /api/game/medicine
// ============================================================
router.post('/medicine', (req, res) => {
  try {
    const adapter = db.getAdapter();
    const userId  = req.user.userId;

    const character = adapter.get(
      'SELECT * FROM characters WHERE user_id = ? AND is_dead = 0 ORDER BY id DESC LIMIT 1',
      [userId]
    );
    if (!character) return res.status(404).json({ success: false, message: '캐릭터가 없습니다.' });

    const inv = adapter.get(
      'SELECT quantity FROM inventory WHERE user_id = ? AND item_type = ?',
      [userId, 'medicine']
    );
    if (!inv || inv.quantity <= 0) {
      return res.status(400).json({ success: false, message: '약이 없습니다. 상점에서 구매해주세요!' });
    }

    adapter.transaction(() => {
      adapter.run(
        'UPDATE inventory SET quantity = quantity - 1 WHERE user_id = ? AND item_type = ?',
        [userId, 'medicine']
      );
      const healthGain = character.is_sick ? 25 : -5;
      db.updateCharacter(character.id, {
        is_sick:     0,
        health:      Math.min(100, Math.max(0, character.health + healthGain)),
        last_update: new Date().toISOString(),
      });
    })();

    const msg = character.is_sick
      ? '나았어요! 건강해졌어요! 💊'
      : '안 아픈데요? 건강이 조금 줄었어요 😅';
    res.json({ success: true, message: msg });

  } catch (error) {
    logger.error('약 주기 오류: ' + error.message);
    res.status(500).json({ success: false, message: '오류가 발생했습니다.' });
  }
});

// ============================================================
// 😴 재우기 / 깨우기 토글
// POST /api/game/sleep
// ============================================================
router.post('/sleep', (req, res) => {
  try {
    const adapter  = db.getAdapter();
    const userId   = req.user.userId;

    const character = adapter.get(
      'SELECT * FROM characters WHERE user_id = ? AND is_dead = 0 ORDER BY id DESC LIMIT 1',
      [userId]
    );
    if (!character) return res.status(404).json({ success: false, message: '캐릭터가 없습니다.' });

    const sleeping = !character.is_sleeping;

    if (sleeping) {
      const inv = adapter.get(
        'SELECT quantity FROM inventory WHERE user_id = ? AND item_type = ?',
        [userId, 'sleep']
      );
      if (!inv || inv.quantity <= 0) {
        return res.status(400).json({ success: false, message: '수면제가 없습니다. 상점에서 구매해주세요!' });
      }
      adapter.run(
        'UPDATE inventory SET quantity = quantity - 1 WHERE user_id = ? AND item_type = ?',
        [userId, 'sleep']
      );
    }

    db.updateCharacter(character.id, {
      is_sleeping: sleeping ? 1 : 0,
      health:      Math.min(100, character.health + (sleeping ? 0 : 20)),
      happy:       Math.min(100, character.happy  + (sleeping ? 0 : 15)),
      last_update: new Date().toISOString(),
    });

    res.json({
      success:  true,
      sleeping,
      message:  sleeping ? '😴 자고 있어요... 조용히 해주세요!' : '😊 잘 잤어요! 건강이 올랐어요!',
    });

  } catch (error) {
    logger.error('재우기 오류: ' + error.message);
    res.status(500).json({ success: false, message: '오류가 발생했습니다.' });
  }
});

// ============================================================
// 💰 캐릭터 판매 등록
// POST /api/game/sell
// ============================================================
router.post('/sell', (req, res) => {
  try {
    const adapter = db.getAdapter();
    const userId  = req.user.userId;
    const { characterId, price } = req.body;

    const character = adapter.get(
      'SELECT * FROM characters WHERE id = ? AND user_id = ?',
      [characterId, userId]
    );
    if (!character)                  return res.status(404).json({ success: false, message: '캐릭터를 찾을 수 없습니다.' });
    if (character.stage !== 'adult') return res.status(400).json({ success: false, message: '성인이 된 캐릭터만 판매할 수 있습니다.' });
    if (character.is_dead)           return res.status(400).json({ success: false, message: '사망한 캐릭터는 판매할 수 없습니다.' });
    if (character.is_for_sale)       return res.status(400).json({ success: false, message: '이미 판매 중입니다.' });
    if (character.sold_at)           return res.status(400).json({ success: false, message: '이미 판매된 캐릭터는 재판매할 수 없습니다.' });

    // 버전별 판매가 범위 검증 (서버 기준)
    const version = adapter.get(
      'SELECT sale_min, sale_max FROM game_versions WHERE version = ?',
      [character.version]
    );
    if (version && (price < version.sale_min || price > version.sale_max)) {
      return res.status(400).json({
        success: false,
        message: `v${character.version} 판매가는 ${version.sale_min}P ~ ${version.sale_max}P 사이여야 합니다.`,
      });
    }

    adapter.transaction(() => {
      db.updateCharacter(characterId, {
        is_for_sale: 1,
        sale_price:  price,
        last_update: new Date().toISOString(),
      });
      adapter.run(`
        INSERT INTO character_trades (character_id, seller_id, price, version, status)
        VALUES (?, ?, ?, ?, 'listing')
      `, [characterId, userId, price, character.version]);
    })();

    logger.info(`🏪 캐릭터 판매 등록: 캐릭터 ${characterId}, ${price}P`);
    res.json({ success: true, message: `판매 등록 완료! ${price}P에 판매 중입니다.` });

  } catch (error) {
    logger.error('판매 등록 오류: ' + error.message);
    res.status(500).json({ success: false, message: '오류가 발생했습니다.' });
  }
});

// ============================================================
// 🛒 캐릭터 구매
// POST /api/game/buy-character
// ============================================================
router.post('/buy-character', (req, res) => {
  try {
    const adapter  = db.getAdapter();
    const buyerId  = req.user.userId;
    const { characterId } = req.body;

    const character = adapter.get(
      'SELECT * FROM characters WHERE id = ? AND is_for_sale = 1',
      [characterId]
    );
    if (!character) return res.status(404).json({ success: false, message: '판매 중인 캐릭터를 찾을 수 없습니다.' });
    if (character.user_id === buyerId) return res.status(400).json({ success: false, message: '자신의 캐릭터를 살 수 없습니다.' });

    const buyer = db.getUserById(buyerId);
    if (buyer.points < character.sale_price) {
      return res.status(400).json({
        success: false,
        message: `포인트가 부족합니다. (필요: ${character.sale_price}P, 보유: ${buyer.points}P)`,
      });
    }

    adapter.transaction(() => {
      // 구매자 포인트 차감
      db.changePoints(buyerId, -character.sale_price, 'spend',
        `캐릭터 구매 #${characterId}`, `buy-char-${characterId}-${buyerId}`);
      // 판매자 포인트 지급 (수수료 10%)
      const sellerAmount = Math.floor(character.sale_price * 0.9);
      db.changePoints(character.user_id, sellerAmount, 'sale',
        `캐릭터 판매 #${characterId}`, `sell-char-${characterId}-${buyerId}`);
      // 소유권 이전 + 재판매 방지 (sold_at 기록)
      adapter.run(
        'UPDATE characters SET user_id = ?, is_for_sale = 0, sale_price = 0, sold_at = ? WHERE id = ?',
        [buyerId, new Date().toISOString(), characterId]
      );
      // 거래 기록
      adapter.run(`
        UPDATE character_trades
        SET buyer_id = ?, status = 'sold', traded_at = ?
        WHERE character_id = ? AND status = 'listing'
      `, [buyerId, new Date().toISOString(), characterId]);
    })();

    logger.info(`💰 캐릭터 거래: ${character.user_id}→${buyerId}, ${character.sale_price}P`);
    res.json({ success: true, message: `캐릭터를 구매했습니다! ${character.sale_price}P가 차감됐습니다.` });

  } catch (error) {
    logger.error('캐릭터 구매 오류: ' + error.message);
    res.status(500).json({ success: false, message: '오류가 발생했습니다.' });
  }
});

// ============================================================
// 🏪 판매 중인 캐릭터 목록
// GET /api/game/market
// ============================================================
router.get('/market', (req, res) => {
  try {
    const items = db.getAdapter().all(`
      SELECT c.*, u.nickname AS owner_nickname
      FROM characters c
      JOIN users u ON c.user_id = u.id
      WHERE c.is_for_sale = 1 AND c.is_dead = 0
      ORDER BY c.sale_price ASC
      LIMIT 50
    `, []);
    res.json({ success: true, market: items });
  } catch (error) {
    logger.error('마켓 조회 오류: ' + error.message);
    res.status(500).json({ success: false, message: '오류가 발생했습니다.' });
  }
});

module.exports = router;
