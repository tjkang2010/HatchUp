// ============================================================
// 🔔 푸시 알림 API - push.js
// ============================================================
// Web Push API를 사용합니다.
// 사용자 폰/PC에 직접 알림을 보낼 수 있어요.
//
// 동작 흐름:
// 1. 사용자가 앱에서 "알림 허용" 버튼 클릭
// 2. 브라우저가 구독 정보(endpoint)를 서버로 전송
// 3. 서버가 구독 정보를 DB에 저장
// 4. 스케줄러가 10분마다 위험 캐릭터 감지
// 5. 위험 캐릭터 있으면 해당 유저에게 푸시 발송
// ============================================================

const express  = require('express');
const webpush  = require('web-push');       // 푸시 알림 라이브러리
const db       = require('../db/db');
const auth     = require('../middleware/auth');
const logger   = require('../utils/logger');

const router = express.Router();

// ============================================================
// VAPID 키 설정 (푸시 알림 인증용)
// ============================================================
// .env 파일에 설정하세요.
// 키 생성 방법: node -e "const wp=require('web-push');console.log(wp.generateVAPIDKeys())"
// 또는 아래 명령어: npx web-push generate-vapid-keys

const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY  || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_EMAIL   = process.env.VAPID_EMAIL || 'mailto:admin@hatchup.app';

// VAPID 키가 설정된 경우에만 초기화
if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);
  logger.info('✅ 푸시 알림 초기화 완료');
} else {
  logger.warn('⚠️ VAPID 키 미설정 - 푸시 알림 비활성화 상태');
}

// ============================================================
// 푸시 알림 전송 핵심 함수
// ============================================================
async function sendPush(subscription, payload) {
  try {
    await webpush.sendNotification(
      subscription,
      JSON.stringify(payload),
      {
        TTL: 60 * 60,  // 1시간 후 만료 (안 받아도 1시간 후 버림)
        urgency: 'high',
      }
    );
    return true;
  } catch (error) {
    // 구독이 만료됐거나 유효하지 않으면 DB에서 삭제
    if (error.statusCode === 410 || error.statusCode === 404) {
      logger.info(`구독 만료 감지 - DB에서 삭제: ${subscription.endpoint?.substring(0, 50)}...`);
      return 'expired';
    }
    logger.error('푸시 전송 오류: ' + error.message);
    return false;
  }
}

// ============================================================
// 📱 VAPID 공개 키 조회 (프론트에서 구독 시 필요)
// GET /api/push/vapid-key
// ============================================================
router.get('/vapid-key', (req, res) => {
  if (!VAPID_PUBLIC) {
    return res.json({
      success: false,
      message: '푸시 알림이 설정되지 않았습니다.',
      available: false
    });
  }
  res.json({ success: true, publicKey: VAPID_PUBLIC, available: true });
});

// ============================================================
// ✅ 푸시 구독 등록
// POST /api/push/subscribe
// Body: { subscription: { endpoint, keys: { p256dh, auth } } }
// ============================================================
router.post('/subscribe', auth.required, (req, res) => {
  try {
    const { subscription, deviceName } = req.body;
    const userId = req.user.userId;

    if (!subscription?.endpoint) {
      return res.status(400).json({ success: false, message: '구독 정보가 없습니다.' });
    }

    const database = db.getDb();

    // 이미 등록된 구독인지 확인 (같은 기기는 중복 저장 안 함)
    const existing = database.prepare(
      'SELECT id FROM push_subscriptions WHERE user_id = ? AND endpoint = ?'
    ).get(userId, subscription.endpoint);

    if (existing) {
      // 기존 구독 업데이트 (키가 바뀔 수 있음)
      database.prepare(`
        UPDATE push_subscriptions
        SET p256dh = ?, auth_key = ?, device_name = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        subscription.keys.p256dh,
        subscription.keys.auth,
        deviceName || '기기',
        existing.id
      );
    } else {
      // 새 구독 저장
      database.prepare(`
        INSERT INTO push_subscriptions
          (user_id, endpoint, p256dh, auth_key, device_name)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        userId,
        subscription.endpoint,
        subscription.keys.p256dh,
        subscription.keys.auth,
        deviceName || '기기'
      );
    }

    logger.info(`✅ 푸시 구독 등록: 유저 ${userId}, 기기: ${deviceName}`);

    // 등록 확인 알림 발송
    sendPush(subscription, {
      title: '🥚 HatchUp 알림 연결 완료!',
      body:  '캐릭터가 위험하면 바로 알려드릴게요 😊',
      icon:  '/icon-192.png',
      badge: '/badge.png',
      tag:   'welcome',
    });

    res.json({ success: true, message: '알림이 설정됐습니다!' });

  } catch (error) {
    logger.error('구독 등록 오류: ' + error.message);
    db.logError('error', '푸시 구독 실패: ' + error.message, error.stack, req.user?.userId);
    res.status(500).json({ success: false, message: '알림 설정 중 오류가 발생했습니다.' });
  }
});

// ============================================================
// ❌ 푸시 구독 해제
// DELETE /api/push/unsubscribe
// ============================================================
router.delete('/unsubscribe', auth.required, (req, res) => {
  try {
    const { endpoint } = req.body;
    const userId = req.user.userId;
    const database = db.getDb();

    if (endpoint) {
      // 특정 기기만 해제
      database.prepare(
        'DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?'
      ).run(userId, endpoint);
    } else {
      // 모든 기기 해제
      database.prepare(
        'DELETE FROM push_subscriptions WHERE user_id = ?'
      ).run(userId);
    }

    res.json({ success: true, message: '알림이 해제됐습니다.' });
  } catch (error) {
    res.status(500).json({ success: false, message: '오류가 발생했습니다.' });
  }
});

// ============================================================
// 📋 내 구독 기기 목록
// GET /api/push/subscriptions
// ============================================================
router.get('/subscriptions', auth.required, (req, res) => {
  try {
    const database = db.getDb();
    const subs = database.prepare(`
      SELECT id, device_name, created_at, updated_at
      FROM push_subscriptions
      WHERE user_id = ?
      ORDER BY updated_at DESC
    `).all(req.user.userId);

    res.json({ success: true, subscriptions: subs });
  } catch (error) {
    res.status(500).json({ success: false, message: '오류가 발생했습니다.' });
  }
});

// ============================================================
// 🔔 알림 설정 조회/변경
// GET/PUT /api/push/settings
// ============================================================
router.get('/settings', auth.required, (req, res) => {
  try {
    const database = db.getDb();
    const settings = database.prepare(
      'SELECT * FROM push_settings WHERE user_id = ?'
    ).get(req.user.userId);

    // 기본값
    res.json({
      success: true,
      settings: settings || {
        notify_hunger:  1,  // 배고픔 알림
        notify_health:  1,  // 건강 알림
        notify_poop:    1,  // 변 알림
        notify_sick:    1,  // 아픔 알림
        notify_evolve:  1,  // 진화 알림
        notify_dead:    1,  // 사망 알림
        quiet_start:    23, // 방해금지 시작 (23시)
        quiet_end:      7,  // 방해금지 종료 (7시)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: '오류가 발생했습니다.' });
  }
});

router.put('/settings', auth.required, (req, res) => {
  try {
    const database = db.getDb();
    const userId   = req.user.userId;
    const {
      notify_hunger, notify_health, notify_poop,
      notify_sick, notify_evolve, notify_dead,
      quiet_start, quiet_end
    } = req.body;

    database.prepare(`
      INSERT INTO push_settings
        (user_id, notify_hunger, notify_health, notify_poop,
         notify_sick, notify_evolve, notify_dead, quiet_start, quiet_end)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        notify_hunger  = excluded.notify_hunger,
        notify_health  = excluded.notify_health,
        notify_poop    = excluded.notify_poop,
        notify_sick    = excluded.notify_sick,
        notify_evolve  = excluded.notify_evolve,
        notify_dead    = excluded.notify_dead,
        quiet_start    = excluded.quiet_start,
        quiet_end      = excluded.quiet_end,
        updated_at     = CURRENT_TIMESTAMP
    `).run(
      userId,
      notify_hunger ?? 1, notify_health ?? 1, notify_poop ?? 1,
      notify_sick   ?? 1, notify_evolve ?? 1, notify_dead ?? 1,
      quiet_start   ?? 23, quiet_end ?? 7
    );

    res.json({ success: true, message: '알림 설정이 저장됐습니다.' });
  } catch (error) {
    res.status(500).json({ success: false, message: '오류가 발생했습니다.' });
  }
});

// ============================================================
// 🧪 테스트 알림 발송 (관리자 또는 본인)
// POST /api/push/test
// ============================================================
router.post('/test', auth.required, async (req, res) => {
  try {
    const database = db.getDb();
    const userId   = req.user.userId;

    const subs = database.prepare(
      'SELECT * FROM push_subscriptions WHERE user_id = ?'
    ).all(userId);

    if (!subs.length) {
      return res.status(400).json({ success: false, message: '등록된 기기가 없습니다. 먼저 알림을 허용해주세요.' });
    }

    let sent = 0;
    for (const sub of subs) {
      const subscription = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth_key }
      };
      const result = await sendPush(subscription, {
        title: '🥚 테스트 알림',
        body:  '푸시 알림이 정상적으로 작동합니다! 😊',
        icon:  '/icon-192.png',
        tag:   'test-' + Date.now(),
        data:  { url: '/' }
      });
      if (result === true) sent++;
    }

    res.json({ success: true, message: `테스트 알림 발송 완료! (${sent}개 기기)` });
  } catch (error) {
    res.status(500).json({ success: false, message: '알림 발송 실패: ' + error.message });
  }
});

// ============================================================
// 📢 관리자 전체 공지 발송
// POST /api/push/broadcast
// Body: { title, body, url }
// ============================================================
router.post('/broadcast', auth.required, auth.adminOnly, async (req, res) => {
  try {
    const { title, body, url } = req.body;
    if (!title || !body) {
      return res.status(400).json({ success: false, message: '제목과 내용을 입력하세요.' });
    }

    const database = db.getDb();
    const allSubs  = database.prepare('SELECT * FROM push_subscriptions').all();

    logger.info(`📢 공지 발송 시작: 총 ${allSubs.length}명에게`);

    let sent = 0, failed = 0, expired = 0;

    // 배치로 나눠서 발송 (한 번에 너무 많이 보내면 느림)
    const BATCH = 50;
    for (let i = 0; i < allSubs.length; i += BATCH) {
      const batch = allSubs.slice(i, i + BATCH);

      await Promise.all(batch.map(async (sub) => {
        const subscription = {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth_key }
        };

        const result = await sendPush(subscription, {
          title,
          body,
          icon: '/icon-192.png',
          tag:  'broadcast-' + Date.now(),
          data: { url: url || '/' }
        });

        if (result === true)      sent++;
        else if (result === 'expired') {
          expired++;
          // 만료된 구독 삭제
          database.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
        } else failed++;
      }));

      // 배치 간 잠깐 대기 (서버 과부하 방지)
      if (i + BATCH < allSubs.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    logger.info(`📢 공지 완료: 성공 ${sent}, 실패 ${failed}, 만료 ${expired}`);
    res.json({
      success: true,
      message: `공지 발송 완료!`,
      stats: { total: allSubs.length, sent, failed, expired }
    });

  } catch (error) {
    logger.error('공지 발송 오류: ' + error.message);
    res.status(500).json({ success: false, message: '공지 발송 중 오류가 발생했습니다.' });
  }
});

// ============================================================
// 스케줄러에서 사용하는 함수들 (외부 export)
// ============================================================

// 특정 유저에게 알림 발송
async function notifyUser(userId, payload) {
  if (!VAPID_PUBLIC) return; // VAPID 미설정 시 스킵

  const database = db.getDb();
  const subs = database.prepare(
    'SELECT * FROM push_subscriptions WHERE user_id = ?'
  ).all(userId);

  for (const sub of subs) {
    const subscription = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.p256dh, auth: sub.auth_key }
    };
    const result = await sendPush(subscription, payload);

    // 만료된 구독 자동 삭제
    if (result === 'expired') {
      database.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
    }
  }
}

module.exports = router;
module.exports.notifyUser = notifyUser;
