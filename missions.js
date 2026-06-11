// ============================================================
// 📋 미션 시스템 API - missions.js (v3.0)
// ============================================================
const express = require('express');
const db      = require('../db/db');
const auth    = require('../middleware/auth');
const logger  = require('../utils/logger');

const router = express.Router();
router.use(auth.required);

// 오늘 날짜 문자열 (KST 기준)
function today() {
  return new Date().toISOString().split('T')[0];
}

// ── 미션 목록 + 진행도 조회 ──────────────────────────────
router.get('/', (req, res) => {
  try {
    const adapter = db.getAdapter();
    const userId  = req.user.userId;
    const date    = today();

    // 오늘 미션 진행도 조회 (없으면 기본값)
    const missions = adapter.all('SELECT * FROM missions WHERE is_active=1', []);
    const progress = adapter.all(
      'SELECT * FROM user_missions WHERE user_id=? AND date=?',
      [userId, date]
    );
    const progMap = {};
    progress.forEach(p => { progMap[p.mission_key] = p; });

    const result = missions.map(m => ({
      ...m,
      progress:  progMap[m.key]?.progress  || 0,
      completed: progMap[m.key]?.completed || 0,
      claimed:   progMap[m.key]?.claimed   || 0,
    }));

    const totalReward  = missions.reduce((s, m) => s + m.reward_pts, 0);
    const earnedReward = result.filter(m => m.claimed).reduce((s, m) => s + m.reward_pts, 0);

    res.json({ success: true, missions: result, totalReward, earnedReward, date });
  } catch (error) {
    logger.error('미션 조회 오류: ' + error.message);
    res.status(500).json({ success: false, message: '오류가 발생했습니다.' });
  }
});

// ── 미션 보상 수령 ───────────────────────────────────────
router.post('/claim', (req, res) => {
  try {
    const adapter  = db.getAdapter();
    const userId   = req.user.userId;
    const { missionKey } = req.body;
    const date     = today();

    const mission = adapter.get('SELECT * FROM missions WHERE key=?', [missionKey]);
    if (!mission) return res.status(404).json({ success: false, message: '미션을 찾을 수 없습니다.' });

    const progress = adapter.get(
      'SELECT * FROM user_missions WHERE user_id=? AND mission_key=? AND date=?',
      [userId, missionKey, date]
    );

    if (!progress?.completed) return res.status(400).json({ success: false, message: '미션이 완료되지 않았습니다.' });
    if (progress?.claimed)    return res.status(400).json({ success: false, message: '이미 보상을 받았습니다.' });

    // 포인트 지급
    const newBalance = db.changePoints(
      userId, mission.reward_pts, 'earn',
      `미션 보상: ${mission.name}`,
      `mission-${userId}-${missionKey}-${date}`
    );

    adapter.run(
      'UPDATE user_missions SET claimed=1 WHERE user_id=? AND mission_key=? AND date=?',
      [userId, missionKey, date]
    );

    logger.info(`✅ 미션 보상: 유저 ${userId}, ${mission.name}, +${mission.reward_pts}P`);
    res.json({ success: true, message: `${mission.name} 보상 수령! +${mission.reward_pts}P`, newBalance });
  } catch (error) {
    logger.error('미션 보상 오류: ' + error.message);
    res.status(500).json({ success: false, message: '오류가 발생했습니다.' });
  }
});

// ── 외부에서 미션 진행도 업데이트하는 함수 ──────────────
function checkAndUpdateMissions(userId, actionType) {
  try {
    const adapter = db.getAdapter();
    const date    = today();

    // 해당 타입의 미션 찾기
    const missions = adapter.all(
      'SELECT * FROM missions WHERE type=? AND is_active=1',
      [actionType]
    );

    for (const mission of missions) {
      // 현재 진행도 조회 또는 생성
      let progress = adapter.get(
        'SELECT * FROM user_missions WHERE user_id=? AND mission_key=? AND date=?',
        [userId, mission.key, date]
      );

      if (!progress) {
        adapter.run(
          'INSERT OR IGNORE INTO user_missions (user_id,mission_key,progress,completed,claimed,date) VALUES (?,?,0,0,0,?)',
          [userId, mission.key, date]
        );
        progress = { progress: 0, completed: 0 };
      }

      if (progress.completed) continue; // 이미 완료

      const newProgress = progress.progress + 1;
      const completed   = newProgress >= mission.target ? 1 : 0;

      adapter.run(
        'UPDATE user_missions SET progress=?, completed=? WHERE user_id=? AND mission_key=? AND date=?',
        [newProgress, completed, userId, mission.key, date]
      );
    }

    // 로그인 미션 (login 타입) 자동 완료 처리
    if (actionType === 'login') {
      const loginMission = adapter.get("SELECT * FROM missions WHERE type='login' AND is_active=1", []);
      if (loginMission) {
        adapter.run(`
          INSERT INTO user_missions (user_id,mission_key,progress,completed,claimed,date)
          VALUES (?,?,1,1,0,?)
          ON CONFLICT(user_id,mission_key,date) DO UPDATE SET progress=1, completed=1
        `, [userId, loginMission.key, date]);
      }
    }
  } catch (e) {
    logger.error('미션 업데이트 오류: ' + e.message);
  }
}

module.exports = router;
module.exports.checkAndUpdateMissions = checkAndUpdateMissions;
