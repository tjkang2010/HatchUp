// ============================================================
// 🎮 버전 시스템 API - version.js (4차 수정본)
// ============================================================
// 버그 수정:
//   - database 미선언 변수 → adapter 로 통일
//   - adapter.prepare() 제거 → adapter.get/all/run 사용
// ============================================================

const express = require('express');
const db      = require('../db/db');
const auth    = require('../middleware/auth');
const logger  = require('../utils/logger');
const {
  getVersionConfig,
  checkVersionUnlock,
  getMaxUnlockedVersion,
} = require('../config/version-config');

const router = express.Router();
router.use(auth.required);

// ============================================================
// 📋 내 버전 현황 조회
// GET /api/version/status
// ============================================================
router.get('/status', (req, res) => {
  try {
    const adapter = db.getAdapter(); // ← database 아님, adapter
    const userId  = req.user.userId;

    const versionStatus = [];

    for (let v = 1; v <= 5; v++) {
      const cfg    = getVersionConfig(v);
      // adapter 를 checkVersionUnlock 에 전달
      const unlock = checkVersionUnlock(userId, v, adapter);

      // 이 버전으로 키운 총 캐릭터 수
      const totalRow = adapter.get(
        'SELECT COUNT(*) as cnt FROM characters WHERE user_id = ? AND version = ?',
        [userId, v]
      );
      const total = totalRow?.cnt || 0;

      // 이 버전으로 판매한 수
      const soldRow = adapter.get(`
        SELECT COUNT(*) as cnt
        FROM character_trades ct
        JOIN characters c ON ct.character_id = c.id
        WHERE ct.seller_id = ? AND c.version = ? AND ct.status = 'sold'
      `, [userId, v]);
      const sold = soldRow?.cnt || 0;

      // 최고 판매가
      const bestRow = adapter.get(`
        SELECT MAX(ct.price) as best
        FROM character_trades ct
        JOIN characters c ON ct.character_id = c.id
        WHERE ct.seller_id = ? AND c.version = ? AND ct.status = 'sold'
      `, [userId, v]);
      const bestSale = bestRow?.best || 0;

      versionStatus.push({
        version,
        name:        cfg.name,
        emoji:       cfg.emoji,
        description: cfg.description,
        unlocked:    unlock.unlocked,
        unlockMsg:   unlock.message  || null,
        progress:    unlock.progress || null,
        stats:  { total, sold, bestSale },
        config: {
          growDays:        cfg.growDays,
          priceMultiplier: cfg.priceMultiplier,
          salePrice:       cfg.salePrice,
          prestige:        cfg.prestige || false,
        },
      });
    }

    // 현재 활성 캐릭터
    const activeChar = adapter.get(
      'SELECT version FROM characters WHERE user_id = ? AND is_dead = 0 ORDER BY id DESC LIMIT 1',
      [userId]
    );

    res.json({
      success:           true,
      versions:          versionStatus,
      activeCharVersion: activeChar?.version || null,
      maxUnlocked:       getMaxUnlockedVersion(userId, adapter), // ← adapter 전달
    });

  } catch (error) {
    logger.error('버전 상태 조회 오류: ' + error.message);
    db.logError('error', error.message, error.stack, req.user?.userId, '/api/version/status');
    res.status(500).json({ success: false, message: '오류가 발생했습니다.' });
  }
});

// ============================================================
// 🆕 새 버전으로 캐릭터 시작
// POST /api/version/start
// Body: { version: 2 }
// ============================================================
router.post('/start', (req, res) => {
  try {
    const adapter = db.getAdapter();
    const userId  = req.user.userId;
    const version = parseInt(req.body.version) || 1;

    if (version < 1 || version > 5) {
      return res.status(400).json({ success: false, message: '버전은 1~5 사이여야 합니다.' });
    }

    // 해금 조건 확인 (adapter 전달)
    const unlock = checkVersionUnlock(userId, version, adapter);
    if (!unlock.unlocked) {
      return res.status(403).json({
        success:  false,
        message:  unlock.message,
        progress: unlock.progress,
      });
    }

    // 이미 살아있는 캐릭터 확인
    const existing = adapter.get(
      'SELECT id FROM characters WHERE user_id = ? AND is_dead = 0',
      [userId]
    );
    if (existing) {
      return res.status(400).json({
        success: false,
        message: '이미 키우는 캐릭터가 있습니다. 현재 캐릭터를 판매하거나 완료한 후 새로 시작하세요.',
      });
    }

    const cfg      = getVersionConfig(version);
    const charName = cfg.stageNames.adult;

    // 새 캐릭터 생성 (age_days, poop_count 기준)
    const result = adapter.run(`
      INSERT INTO characters
        (user_id, name, stage, version, hunger, happy, health, age_days, poop_count)
      VALUES (?, ?, 'egg', ?, 100, 100, 100, 0, 0)
    `, [userId, charName, version]);

    logger.info(`🥚 새 캐릭터 시작: 유저 ${userId}, v${version}, ID ${result.lastInsertRowid}`);

    res.json({
      success:   true,
      message:   `✨ ${cfg.emoji} ${cfg.name} 시작! 새 알이 태어났습니다.`,
      character: {
        id:      result.lastInsertRowid,
        version,
        name:    charName,
        stage:   'egg',
        config:  cfg,
      },
    });

  } catch (error) {
    logger.error('버전 시작 오류: ' + error.message);
    db.logError('error', error.message, error.stack, req.user?.userId, '/api/version/start');
    res.status(500).json({ success: false, message: '오류가 발생했습니다.' });
  }
});

// ============================================================
// 🔄 프레스티지 (5단계 판매 후 1단계 재시작)
// POST /api/version/prestige
// ============================================================
router.post('/prestige', (req, res) => {
  try {
    const adapter = db.getAdapter();
    const userId  = req.user.userId;

    // 5단계 판매 기록 확인
    const v5Row = adapter.get(`
      SELECT COUNT(*) as cnt
      FROM character_trades ct
      JOIN characters c ON ct.character_id = c.id
      WHERE ct.seller_id = ? AND c.version = 5 AND ct.status = 'sold'
    `, [userId]);

    if ((v5Row?.cnt || 0) === 0) {
      return res.status(403).json({
        success: false,
        message: '레전드(5단계) 캐릭터를 판매해야 프레스티지할 수 있습니다.',
      });
    }

    // 살아있는 캐릭터 없어야 함
    const existing = adapter.get(
      'SELECT id FROM characters WHERE user_id = ? AND is_dead = 0',
      [userId]
    );
    if (existing) {
      return res.status(400).json({
        success: false,
        message: '현재 캐릭터를 먼저 처리해주세요.',
      });
    }

    // 프레스티지 카운트 +1
    adapter.run(
      'UPDATE users SET prestige_count = COALESCE(prestige_count, 0) + 1, updated_at = ? WHERE id = ?',
      [new Date().toISOString(), userId]
    );

    const user          = db.getUserById(userId);
    const prestigeCount = user.prestige_count || 1;
    const bonusPoints   = prestigeCount * 500;

    // 보너스 포인트 지급
    db.changePoints(
      userId, bonusPoints, 'earn',
      `프레스티지 ${prestigeCount}회 달성 보너스`,
      `prestige-bonus-${userId}-${prestigeCount}`
    );

    // 1단계 새 캐릭터 자동 생성
    const cfg = getVersionConfig(1);
    adapter.run(`
      INSERT INTO characters
        (user_id, name, stage, version, hunger, happy, health, age_days, poop_count)
      VALUES (?, ?, 'egg', 1, 100, 100, 100, 0, 0)
    `, [userId, cfg.stageNames.adult]);

    logger.info(`🔄 프레스티지: 유저 ${userId}, ${prestigeCount}회째, +${bonusPoints}P`);

    res.json({
      success: true,
      message: `🔥 프레스티지 ${prestigeCount}회 달성! +${bonusPoints}P 보너스! 1단계부터 다시 시작합니다.`,
      prestigeCount,
      bonusPoints,
    });

  } catch (error) {
    logger.error('프레스티지 오류: ' + error.message);
    db.logError('error', error.message, error.stack, req.user?.userId, '/api/version/prestige');
    res.status(500).json({ success: false, message: '오류가 발생했습니다.' });
  }
});

// ============================================================
// 🏆 버전 리더보드
// GET /api/version/leaderboard
// ============================================================
router.get('/leaderboard', (req, res) => {
  try {
    const adapter = db.getAdapter();

    const topSellers = adapter.all(`
      SELECT
        u.nickname,
        MAX(ct.price)      as best_sale,
        COUNT(ct.id)       as total_sold,
        MAX(c.version)     as max_version,
        COALESCE(u.prestige_count, 0) as prestige_count
      FROM character_trades ct
      JOIN characters c ON ct.character_id = c.id
      JOIN users u ON ct.seller_id = u.id
      WHERE ct.status = 'sold'
      GROUP BY ct.seller_id
      ORDER BY best_sale DESC
      LIMIT 20
    `, []);

    const topPrestige = adapter.all(`
      SELECT nickname, COALESCE(prestige_count, 0) as prestige_count, points
      FROM users
      WHERE is_active = 1
      ORDER BY prestige_count DESC, points DESC
      LIMIT 10
    `, []);

    res.json({ success: true, topSellers, topPrestige });

  } catch (error) {
    logger.error('리더보드 조회 오류: ' + error.message);
    res.status(500).json({ success: false, message: '오류가 발생했습니다.' });
  }
});

// ============================================================
// 🔓 버전 해금 현황
// GET /api/version/unlock-info/:version
// ============================================================
router.get('/unlock-info/:version', (req, res) => {
  try {
    const adapter = db.getAdapter();
    const version = parseInt(req.params.version);
    const userId  = req.user.userId;

    // adapter 전달 (database 아님)
    const result = checkVersionUnlock(userId, version, adapter);
    const cfg    = getVersionConfig(version);

    res.json({ success: true, version, ...result, config: cfg });

  } catch (error) {
    logger.error('해금 정보 조회 오류: ' + error.message);
    res.status(500).json({ success: false, message: '오류가 발생했습니다.' });
  }
});

module.exports = router;
