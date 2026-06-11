// ============================================================
// 🛍️ 상점 / 포인트 - shop.js
// ============================================================
// 포인트 충전, 아이템 구매, 포인트↔먹이 교환을 처리합니다.
// ============================================================

const express = require('express');
const db      = require('../db/db');
const auth    = require('../middleware/auth');
const logger  = require('../utils/logger');

const router = express.Router();
router.use(auth.required);

// ============================================================
// 📋 상점 아이템 목록 조회
// GET /api/shop/items
// ============================================================
router.get('/items', (req, res) => {
  try {
    const database = db.getDb();
    const userId = req.user.userId;

    const items = database.prepare('SELECT * FROM shop_items WHERE is_active = 1').all();
    const user  = db.getUserById(userId);

    // 버전별 가격 배율 (1버전=1배, 2버전=2배 ...)
    // 캐릭터 버전 확인
    const character = database.prepare('SELECT version FROM characters WHERE user_id = ? AND is_dead = 0 ORDER BY id DESC LIMIT 1').get(userId);
    const version = character?.version || 1;
    const priceMultiplier = version; // 버전이 높을수록 가격 증가

    const itemsWithPrice = items.map(item => ({
      ...item,
      price: item.base_price * priceMultiplier,
      version,
    }));

    res.json({
      success: true,
      items: itemsWithPrice,
      myPoints: user.points,
      version
    });

  } catch (error) {
    logger.error('상점 조회 오류:', error.message);
    res.status(500).json({ success: false, message: '상점을 불러오지 못했습니다.' });
  }
});

// ============================================================
// 🛒 아이템 구매
// POST /api/shop/buy
// Body: { itemType: 'food', quantity: 3 }
// ============================================================
router.post('/buy', (req, res) => {
  try {
    const database = db.getDb();
    const userId   = req.user.userId;
    const { itemType, quantity = 1 } = req.body;

    if (!itemType || quantity < 1 || quantity > 99) {
      return res.status(400).json({ success: false, message: '올바른 아이템 정보를 입력해주세요.' });
    }

    // 아이템 정보 조회
    const item = database.prepare('SELECT * FROM shop_items WHERE item_type = ? AND is_active = 1').get(itemType);
    if (!item) return res.status(404).json({ success: false, message: '존재하지 않는 아이템입니다.' });

    // 버전별 가격 계산
    const character = database.prepare('SELECT version FROM characters WHERE user_id = ? AND is_dead = 0 ORDER BY id DESC LIMIT 1').get(userId);
    const version = character?.version || 1;
    const totalPrice = item.base_price * version * quantity;

    // 포인트 확인
    const user = db.getUserById(userId);
    if (user.points < totalPrice) {
      return res.status(400).json({
        success: false,
        message: `포인트가 부족합니다. (필요: ${totalPrice}P, 보유: ${user.points}P)`
      });
    }

    // 구매 처리 (트랜잭션)
    database.transaction(() => {
      // 포인트 차감
      db.changePoints(userId, -totalPrice, 'spend', `${item.name} x${quantity} 구매`);

      // 인벤토리 추가
      database.prepare(`
        INSERT INTO inventory (user_id, item_type, quantity)
        VALUES (?, ?, ?)
        ON CONFLICT(user_id, item_type) DO UPDATE SET quantity = quantity + ?
      `).run(userId, itemType, quantity, quantity);
    })();

    const remainingPoints = user.points - totalPrice;
    logger.info(`🛒 아이템 구매: 회원 ${userId}, ${item.name} x${quantity}, ${totalPrice}P`);

    res.json({
      success: true,
      message: `${item.name} ${quantity}개를 구매했습니다! (${totalPrice}P 차감)`,
      remainingPoints,
      boughtItem: { type: itemType, name: item.name, quantity }
    });

  } catch (error) {
    logger.error('아이템 구매 오류:', error.message);
    res.status(500).json({ success: false, message: '구매 중 오류가 발생했습니다.' });
  }
});

// ============================================================
// 🔄 포인트 ↔ 먹이 교환 (10P = 먹이 1개)
// POST /api/shop/exchange
// Body: { points: 50 } → 먹이 5개로 교환
// ============================================================
router.post('/exchange', (req, res) => {
  try {
    const database = db.getDb();
    const userId   = req.user.userId;
    const { points } = req.body;

    // 10포인트 단위로만 교환 가능
    if (!points || points < 10 || points % 10 !== 0) {
      return res.status(400).json({
        success: false,
        message: '10포인트 단위로만 교환 가능합니다. (최소 10P)'
      });
    }

    const user = db.getUserById(userId);
    if (user.points < points) {
      return res.status(400).json({
        success: false,
        message: `포인트가 부족합니다. (필요: ${points}P, 보유: ${user.points}P)`
      });
    }

    const foodAmount = points / 10; // 10포인트 = 먹이 1개

    database.transaction(() => {
      db.changePoints(userId, -points, 'spend', `먹이 교환 (${foodAmount}개)`);
      database.prepare(`
        INSERT INTO inventory (user_id, item_type, quantity)
        VALUES (?, 'food', ?)
        ON CONFLICT(user_id, item_type) DO UPDATE SET quantity = quantity + ?
      `).run(userId, foodAmount, foodAmount);
    })();

    res.json({
      success: true,
      message: `${points}P → 먹이 ${foodAmount}개로 교환했습니다!`,
      exchanged: { points, foodAmount }
    });

  } catch (error) {
    logger.error('교환 오류:', error.message);
    res.status(500).json({ success: false, message: '교환 중 오류가 발생했습니다.' });
  }
});

// ============================================================
// ⛔ POST /api/shop/charge — 삭제됨
// 테스트 무료 충전 API 완전 제거.
// 포인트 지급은 /api/admin/points (관리자 전용) 만 허용.
// 실제 충전은 /api/payment/confirm (토스페이먼츠) 만 허용.
// ============================================================

// ============================================================
// 📜 포인트 거래 내역
// GET /api/shop/history?page=1
// ============================================================
router.get('/history', (req, res) => {
  try {
    const database = db.getDb();
    const userId = req.user.userId;
    const page   = Math.max(1, parseInt(req.query.page) || 1);
    const limit  = 20;
    const offset = (page - 1) * limit;

    const history = database.prepare(`
      SELECT * FROM point_transactions
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(userId, limit, offset);

    const total = database.prepare('SELECT COUNT(*) as cnt FROM point_transactions WHERE user_id = ?').get(userId).cnt;

    res.json({
      success: true,
      history,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });

  } catch (error) {
    logger.error('거래 내역 오류:', error.message);
    res.status(500).json({ success: false, message: '거래 내역을 불러오지 못했습니다.' });
  }
});

module.exports = router;
