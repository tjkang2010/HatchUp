// ============================================================
// 🏆 업적 시스템 API - achievements.js (v3.0)
// ============================================================
const express = require('express');
const db      = require('../db/db');
const auth    = require('../middleware/auth');
const logger  = require('../utils/logger');

const router = express.Router();
router.use(auth.required);

// ── 업적 목록 조회 ───────────────────────────────────────
router.get('/', (req, res) => {
  try {
    const adapter = db.getAdapter();
    const userId  = req.user.userId;

    const achievements = adapter.all('SELECT * FROM achievements', []);
    const unlocked     = adapter.all(
      'SELECT * FROM user_achievements WHERE user_id=?', [userId]
    );
    const unlockedMap  = {};
    unlocked.forEach(u => { unlockedMap[u.achievement_key] = u; });

    const result = achievements.map(a => ({
      ...a,
      unlocked:    !!unlockedMap[a.key],
      claimed:     unlockedMap[a.key]?.claimed || 0,
      unlocked_at: unlockedMap[a.key]?.unlocked_at || null,
    }));

    res.json({ success: true, achievements: result });
  } catch (error) {
    logger.error('업적 조회 오류: ' + error.message);
    res.status(500).json({ success: false, message: '오류가 발생했습니다.' });
  }
});

// ── 업적 보상 수령 ───────────────────────────────────────
router.post('/claim', (req, res) => {
  try {
    const adapter = db.getAdapter();
    const userId  = req.user.userId;
    const { achievementKey } = req.body;

    const achievement = adapter.get('SELECT * FROM achievements WHERE key=?', [achievementKey]);
    if (!achievement) return res.status(404).json({ success: false, message: '업적을 찾을 수 없습니다.' });

    const userAchieve = adapter.get(
      'SELECT * FROM user_achievements WHERE user_id=? AND achievement_key=?',
      [userId, achievementKey]
    );
    if (!userAchieve) return res.status(400).json({ success: false, message: '달성하지 못한 업적입니다.' });
    if (userAchieve.claimed) return res.status(400).json({ success: false, message: '이미 보상을 받았습니다.' });

    const newBalance = db.changePoints(
      userId, achievement.reward_pts, 'earn',
      `업적 보상: ${achievement.name}`,
      `achievement-${userId}-${achievementKey}`
    );

    adapter.run(
      'UPDATE user_achievements SET claimed=1 WHERE user_id=? AND achievement_key=?',
      [userId, achievementKey]
    );

    logger.info(`🏆 업적 보상: 유저 ${userId}, ${achievement.name}, +${achievement.reward_pts}P`);
    res.json({ success: true, message: `${achievement.name} 달성 보상! +${achievement.reward_pts}P`, newBalance });
  } catch (error) {
    logger.error('업적 보상 오류: ' + error.message);
    res.status(500).json({ success: false, message: '오류가 발생했습니다.' });
  }
});

// ── 업적 조건 체크 함수 (내부 호출용) ────────────────────
function checkAchievements(userId) {
  try {
    const adapter = db.getAdapter();
    const user    = db.getUserById(userId);
    if (!user) return;

    const allAchievements = adapter.all('SELECT * FROM achievements', []);
    const unlocked        = adapter.all('SELECT achievement_key FROM user_achievements WHERE user_id=?', [userId]);
    const unlockedKeys    = new Set(unlocked.map(u => u.achievement_key));

    for (const a of allAchievements) {
      if (unlockedKeys.has(a.key)) continue; // 이미 달성

      let achieved = false;

      // 조건별 판단
      switch (a.condition) {
        case 'hatch': {
          const cnt = adapter.get('SELECT COUNT(*) as c FROM characters WHERE user_id=?', [userId]).c;
          achieved  = cnt >= a.target;
          break;
        }
        case 'sell': {
          const cnt = adapter.get("SELECT COUNT(*) as c FROM market_transactions WHERE seller_id=?", [userId]).c;
          achieved  = cnt >= a.target;
          break;
        }
        case 'level': {
          const char = adapter.get('SELECT MAX(level) as ml FROM characters WHERE user_id=?', [userId]);
          achieved   = (char?.ml || 0) >= a.target;
          break;
        }
        case 'login_count': {
          // 고유 날짜 수로 체크
          const cnt = adapter.get(
            "SELECT COUNT(DISTINCT date) as c FROM user_missions WHERE user_id=? AND mission_key='daily_login' AND completed=1",
            [userId]
          ).c;
          achieved = cnt >= a.target;
          break;
        }
      }

      if (achieved) {
        try {
          adapter.run(
            'INSERT OR IGNORE INTO user_achievements (user_id,achievement_key) VALUES (?,?)',
            [userId, a.key]
          );
          logger.info(`🏆 업적 달성: 유저 ${userId} - ${a.name}`);
        } catch(e) {}
      }
    }
  } catch (e) {
    logger.error('업적 체크 오류: ' + e.message);
  }
}

module.exports = router;
module.exports.checkAchievements = checkAchievements;
