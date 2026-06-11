// ============================================================
// 👤 회원 정보 API - user.js
// ============================================================
const express = require('express');
const db      = require('../db/db');
const auth    = require('../middleware/auth');
const router  = express.Router();

router.use(auth.required);

// 내 정보 조회
router.get('/profile', (req, res) => {
  try {
    const user = db.getUserById(req.user.userId);
    if (!user) return res.status(404).json({ success: false, message: '회원을 찾을 수 없습니다.' });
    const { password_hash, ...safeUser } = user; // 비밀번호 제외
    res.json({ success: true, user: safeUser });
  } catch (error) {
    res.status(500).json({ success: false, message: '정보를 불러오지 못했습니다.' });
  }
});

// 내 캐릭터 목록
router.get('/characters', (req, res) => {
  try {
    const database = db.getDb();
    const chars = database.prepare('SELECT * FROM characters WHERE user_id = ? ORDER BY id DESC').all(req.user.userId);
    res.json({ success: true, characters: chars });
  } catch (error) {
    res.status(500).json({ success: false, message: '캐릭터 목록을 불러오지 못했습니다.' });
  }
});

// 내 인벤토리
router.get('/inventory', (req, res) => {
  try {
    const database = db.getDb();
    const items = database.prepare('SELECT * FROM inventory WHERE user_id = ?').all(req.user.userId);
    res.json({ success: true, inventory: items });
  } catch (error) {
    res.status(500).json({ success: false, message: '인벤토리를 불러오지 못했습니다.' });
  }
});

// 내 추천인 코드 / 추천 현황
router.get('/referral', (req, res) => {
  try {
    const database  = db.getDb();
    const user      = db.getUserById(req.user.userId);
    const referrals = database.prepare('SELECT nickname, created_at FROM users WHERE referred_by = ?').all(user.referral_code);
    res.json({
      success: true,
      referralCode: user.referral_code,
      referralLink: `${process.env.FRONTEND_URL || 'http://localhost:3001'}?ref=${user.referral_code}`,
      referrals,
      totalEarned: referrals.length * 100
    });
  } catch (error) {
    res.status(500).json({ success: false, message: '추천인 정보를 불러오지 못했습니다.' });
  }
});

module.exports = router;
