// ============================================================
// 👑 관리자 패널 API - admin.js
// ============================================================
// 회원 관리, 통계, 아이템 가격 설정 등 관리자 기능
// ============================================================

const express = require('express');
const db      = require('../db/db');
const auth    = require('../middleware/auth');
const logger  = require('../utils/logger');

const router = express.Router();

// 관리자만 접근 가능
router.use(auth.required, auth.adminOnly);

// ============================================================
// 📊 대시보드 통계
// GET /api/admin/stats
// ============================================================
router.get('/stats', (req, res) => {
  try {
    const database = db.getDb();

    const stats = {
      // 전체 회원 수
      totalUsers: database.prepare('SELECT COUNT(*) as cnt FROM users').get().cnt,
      // 오늘 가입자
      todayUsers: database.prepare(`SELECT COUNT(*) as cnt FROM users WHERE DATE(created_at) = DATE('now')`).get().cnt,
      // 살아있는 캐릭터 수
      activeChars: database.prepare('SELECT COUNT(*) as cnt FROM characters WHERE is_dead = 0').get().cnt,
      // 판매 중 캐릭터
      forSaleChars: database.prepare('SELECT COUNT(*) as cnt FROM characters WHERE is_for_sale = 1').get().cnt,
      // 총 포인트 거래량
      totalPoints: database.prepare('SELECT SUM(amount) as total FROM point_transactions WHERE type = "charge"').get().total || 0,
      // 오늘 포인트 거래량
      todayPoints: database.prepare(`SELECT SUM(amount) as total FROM point_transactions WHERE type = "charge" AND DATE(created_at) = DATE('now')`).get().total || 0,
      // 오류 로그 (최근 24시간)
      recentErrors: database.prepare(`SELECT COUNT(*) as cnt FROM error_logs WHERE created_at > datetime('now', '-24 hours') AND level = 'error'`).get().cnt,
    };

    res.json({ success: true, stats });
  } catch (error) {
    logger.error('통계 조회 오류:', error.message);
    res.status(500).json({ success: false, message: '통계를 불러오지 못했습니다.' });
  }
});

// ============================================================
// 👥 회원 목록
// GET /api/admin/users?page=1&search=이메일
// ============================================================
router.get('/users', (req, res) => {
  try {
    const database = db.getDb();
    const page   = Math.max(1, parseInt(req.query.page) || 1);
    const search = req.query.search || '';
    const limit  = 20;
    const offset = (page - 1) * limit;

    const query = search
      ? `SELECT id, email, nickname, points, is_active, is_admin, created_at, last_login, referral_code FROM users WHERE email LIKE ? OR nickname LIKE ? ORDER BY created_at DESC LIMIT ? OFFSET ?`
      : `SELECT id, email, nickname, points, is_active, is_admin, created_at, last_login, referral_code FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?`;

    const users = search
      ? database.prepare(query).all(`%${search}%`, `%${search}%`, limit, offset)
      : database.prepare(query).all(limit, offset);

    const total = search
      ? database.prepare('SELECT COUNT(*) as cnt FROM users WHERE email LIKE ? OR nickname LIKE ?').get(`%${search}%`, `%${search}%`).cnt
      : database.prepare('SELECT COUNT(*) as cnt FROM users').get().cnt;

    res.json({ success: true, users, pagination: { page, total, totalPages: Math.ceil(total / limit) } });
  } catch (error) {
    res.status(500).json({ success: false, message: '회원 목록 조회 실패' });
  }
});

// ============================================================
// 🔧 회원 포인트 수동 지급/차감
// POST /api/admin/points
// ============================================================
router.post('/points', (req, res) => {
  try {
    const { userId, amount, reason } = req.body;
    if (!userId || !amount || !reason) {
      return res.status(400).json({ success: false, message: '회원ID, 금액, 사유를 모두 입력하세요.' });
    }

    const newBalance = db.changePoints(parseInt(userId), parseInt(amount), 'earn', `[관리자] ${reason}`);
    logger.info(`👑 관리자 포인트 지급: 회원 ${userId}, ${amount}P, 사유: ${reason}`);
    res.json({ success: true, message: '포인트가 지급됐습니다.', newBalance });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================================
// 💰 아이템 가격 변경
// PUT /api/admin/shop/:itemType
// ============================================================
router.put('/shop/:itemType', (req, res) => {
  try {
    const database = db.getDb();
    const { itemType } = req.params;
    const { price, isActive } = req.body;

    const updates = [];
    const values  = [];
    if (price !== undefined)    { updates.push('price = ?');     values.push(parseInt(price)); }
    if (isActive !== undefined) { updates.push('is_active = ?'); values.push(isActive ? 1 : 0); }

    if (updates.length === 0) return res.status(400).json({ success: false, message: '변경할 값이 없습니다.' });

    values.push(itemType);
    database.prepare(`UPDATE shop_items SET ${updates.join(', ')} WHERE item_type = ?`).run(...values);

    logger.info(`👑 관리자 가격 변경: ${itemType}, 가격: ${price}`);
    res.json({ success: true, message: '상점 설정이 변경됐습니다.' });
  } catch (error) {
    res.status(500).json({ success: false, message: '변경 실패' });
  }
});

// ============================================================
// 🚫 회원 활성화/비활성화
// PUT /api/admin/users/:id/toggle
// ============================================================
router.put('/users/:id/toggle', (req, res) => {
  try {
    const database = db.getDb();
    const user = db.getUserById(parseInt(req.params.id));
    if (!user) return res.status(404).json({ success: false, message: '회원을 찾을 수 없습니다.' });

    const newStatus = user.is_active ? 0 : 1;
    database.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(newStatus, user.id);

    logger.info(`👑 회원 상태 변경: ${user.email}, 활성화: ${newStatus}`);
    res.json({ success: true, message: newStatus ? '계정이 활성화됐습니다.' : '계정이 비활성화됐습니다.' });
  } catch (error) {
    res.status(500).json({ success: false, message: '변경 실패' });
  }
});

// ============================================================
// 📋 오류 로그 조회
// GET /api/admin/errors
// ============================================================
router.get('/errors', (req, res) => {
  try {
    const database = db.getDb();
    const errors = database.prepare(`
      SELECT * FROM error_logs ORDER BY created_at DESC LIMIT 100
    `).all();
    res.json({ success: true, errors });
  } catch (error) {
    res.status(500).json({ success: false, message: '로그 조회 실패' });
  }
});

module.exports = router;
