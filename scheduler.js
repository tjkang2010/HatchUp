// ============================================================
// ⏰ 자동 알림 스케줄러 - scheduler.js
// ============================================================
// 서버가 실행되는 동안 백그라운드에서 계속 돌아갑니다.
// 10분마다 모든 캐릭터 상태를 체크해서
// 위험한 캐릭터가 있으면 주인에게 알림을 보냅니다.
//
// 알림 조건:
//   🍖 배고픔 20% 이하 → "배고파요!" 알림
//   ❤️ 건강 30% 이하   → "건강 위험!" 알림
//   💩 변 3개 이상     → "청소 필요!" 알림
//   🤒 아픔 상태       → "아파요!" 알림
//   ✨ 진화 가능       → "진화할 수 있어요!" 알림
//   💀 사망            → "캐릭터가 사망했어요" 알림
// ============================================================

const db          = require('./db/db');
const { notifyUser } = require('./routes/push');
const logger      = require('./utils/logger');

// ============================================================
// 방해금지 모드 확인 (조용한 시간에는 알림 안 보냄)
// ============================================================
function isQuietTime(quietStart, quietEnd) {
  const now  = new Date();
  const hour = now.getHours(); // 0~23

  if (quietStart === quietEnd) return false; // 방해금지 없음

  if (quietStart > quietEnd) {
    // 예: 23시 ~ 7시 (자정 넘김)
    return hour >= quietStart || hour < quietEnd;
  } else {
    // 예: 2시 ~ 6시
    return hour >= quietStart && hour < quietEnd;
  }
}

// ============================================================
// 중복 알림 방지 캐시
// (같은 이유로 1시간 안에 두 번 알림 안 보냄)
// ============================================================
const notifyCache = new Map();

function shouldNotify(userId, reason) {
  const key      = `${userId}:${reason}`;
  const lastTime = notifyCache.get(key);
  const now      = Date.now();
  const cooldown = 60 * 60 * 1000; // 1시간 쿨다운

  if (lastTime && now - lastTime < cooldown) return false;

  notifyCache.set(key, now);
  return true;
}

// 오래된 캐시 정리 (메모리 누수 방지)
function cleanCache() {
  const now     = Date.now();
  const maxAge  = 2 * 60 * 60 * 1000; // 2시간
  for (const [key, time] of notifyCache.entries()) {
    if (now - time > maxAge) notifyCache.delete(key);
  }
}

// ============================================================
// 핵심: 캐릭터 상태 체크 & 알림 발송
// ============================================================
async function checkAndNotify() {
  logger.info('🔍 캐릭터 상태 점검 시작...');

  try {
    const database = db.getDb();

    // 살아있는 캐릭터 + 알림 설정 + 구독 정보 한 번에 조회
    const characters = database.prepare(`
      SELECT
        c.*,
        u.nickname,
        COALESCE(ps.notify_hunger, 1)  AS notify_hunger,
        COALESCE(ps.notify_health, 1)  AS notify_health,
        COALESCE(ps.notify_poop,   1)  AS notify_poop,
        COALESCE(ps.notify_sick,   1)  AS notify_sick,
        COALESCE(ps.notify_evolve, 1)  AS notify_evolve,
        COALESCE(ps.notify_dead,   1)  AS notify_dead,
        COALESCE(ps.quiet_start,  23)  AS quiet_start,
        COALESCE(ps.quiet_end,     7)  AS quiet_end,
        (SELECT COUNT(*) FROM push_subscriptions WHERE user_id = c.user_id) AS sub_count
      FROM characters c
      JOIN users u ON c.user_id = u.id
      LEFT JOIN push_settings ps ON ps.user_id = c.user_id
      WHERE c.is_dead = 0
        AND c.stage != 'egg'
    `).all();

    let notified = 0;

    for (const char of characters) {
      // 알림 구독 없으면 스킵
      if (char.sub_count === 0) continue;

      // 방해금지 시간이면 스킵
      if (isQuietTime(char.quiet_start, char.quiet_end)) continue;

      const alerts = [];

      // 🍖 배고픔 위험 (20% 이하)
      if (char.notify_hunger && char.hunger <= 20 && shouldNotify(char.user_id, 'hunger')) {
        alerts.push({
          title: `🍖 ${char.nickname}의 HatchUp 펫이 배고파요!`,
          body:  `${char.name}의 배고픔이 ${char.hunger}%입니다. 먹이를 주세요!`,
          tag:   'hunger',
          data:  { url: '/', type: 'hunger' }
        });
      }

      // ❤️ 건강 위험 (30% 이하)
      if (char.notify_health && char.health <= 30 && shouldNotify(char.user_id, 'health')) {
        alerts.push({
          title: `❤️ ${char.nickname}의 HatchUp 펫 건강 위험!`,
          body:  `${char.name}의 건강이 ${char.health}%입니다. 약을 주거나 재워주세요!`,
          tag:   'health',
          urgency: 'high',
          data:  { url: '/', type: 'health' }
        });
      }

      // 💩 변 가득 (3개 이상)
      if (char.notify_poop && char.poop_count >= 3 && shouldNotify(char.user_id, 'poop')) {
        alerts.push({
          title: `💩 ${char.nickname}의 HatchUp 펫이 지저분해요!`,
          body:  `${char.name} 주변에 변이 ${char.poop_count}개 있어요. 청소해주세요!`,
          tag:   'poop',
          data:  { url: '/', type: 'clean' }
        });
      }

      // 🤒 아픔 상태
      if (char.notify_sick && char.is_sick && shouldNotify(char.user_id, 'sick')) {
        alerts.push({
          title: `🤒 ${char.nickname}의 HatchUp 펫이 아파요!`,
          body:  `${char.name}이 아픕니다. 약을 주세요!`,
          tag:   'sick',
          urgency: 'high',
          data:  { url: '/', type: 'medicine' }
        });
      }

      // ✨ 진화 가능 (adult가 아니고 건강 60% 이상, 나이 조건)
      const evoAge = { baby:7, child:14, teen:25 };
      if (char.notify_evolve
          && evoAge[char.stage]
          && char.age_days >= evoAge[char.stage]
          && char.health >= 60
          && shouldNotify(char.user_id, 'evolve_' + char.stage)) {
        alerts.push({
          title: `✨ ${char.nickname}의 HatchUp 펫이 진화할 수 있어요!`,
          body:  `${char.name}이 ${char.age_days}일이 됐습니다. 앱에서 확인해보세요!`,
          tag:   'evolve',
          data:  { url: '/', type: 'evolve' }
        });
      }

      // 30일 완료 (판매 가능)
      const daysAlive = Math.floor(
        (Date.now() - new Date(char.born_at).getTime()) / (1000 * 60 * 60 * 24)
      );
      if (char.stage === 'adult' && daysAlive >= 30 && !char.is_for_sale
          && shouldNotify(char.user_id, 'ready_sell')) {
        alerts.push({
          title: `🏪 ${char.nickname}의 HatchUp 펫이 판매 준비됐어요!`,
          body:  `${char.name}이 성인이 됐습니다. 마켓에서 판매해보세요!`,
          tag:   'ready_sell',
          data:  { url: '/', type: 'sell' }
        });
      }

      // 알림 발송
      for (const alert of alerts) {
        await notifyUser(char.user_id, {
          ...alert,
          icon:  '/icon-192.png',
          badge: '/badge.png',
        });
        notified++;
      }
    }

    // 만약 사망한 캐릭터 중 알림 안 보낸 게 있으면 발송
    const deadChars = database.prepare(`
      SELECT c.*, u.nickname,
        COALESCE(ps.notify_dead, 1) AS notify_dead,
        (SELECT COUNT(*) FROM push_subscriptions WHERE user_id = c.user_id) AS sub_count
      FROM characters c
      JOIN users u ON c.user_id = u.id
      LEFT JOIN push_settings ps ON ps.user_id = c.user_id
      WHERE c.is_dead = 1
        AND c.died_at > datetime('now', '-15 minutes')
    `).all();

    for (const char of deadChars) {
      if (!char.sub_count || !char.notify_dead) continue;
      if (!shouldNotify(char.user_id, `dead_${char.id}`)) continue;

      await notifyUser(char.user_id, {
        title: `💀 ${char.nickname}의 HatchUp 펫이 무지개다리를 건넜어요`,
        body:  `${char.name}이 사망했습니다. 새 캐릭터를 키워보세요.`,
        icon:  '/icon-192.png',
        tag:   `dead-${char.id}`,
        data:  { url: '/', type: 'dead' }
      });
      notified++;
    }

    logger.info(`✅ 상태 점검 완료 - 알림 발송: ${notified}건, 총 캐릭터: ${characters.length}개`);
    cleanCache(); // 오래된 캐시 정리

  } catch (error) {
    logger.error('스케줄러 오류: ' + error.message);
    db.logError('error', '스케줄러 실패: ' + error.message, error.stack);
  }
}

// ============================================================
// 스케줄러 시작
// ============================================================
let schedulerInterval = null;

function startScheduler() {
  const CHECK_INTERVAL = parseInt(process.env.PUSH_INTERVAL_MS) || 10 * 60 * 1000; // 기본 10분

  logger.info(`⏰ 푸시 알림 스케줄러 시작 (${CHECK_INTERVAL / 60000}분 간격)`);

  // 서버 시작 2분 후 첫 실행 (서버 완전히 뜬 다음)
  setTimeout(() => {
    checkAndNotify();
    schedulerInterval = setInterval(checkAndNotify, CHECK_INTERVAL);
  }, 2 * 60 * 1000);

  return schedulerInterval;
}

function stopScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    logger.info('⏰ 스케줄러 중지');
  }
}

// 수동 즉시 실행 (테스트용)
async function runNow() {
  logger.info('⏰ 스케줄러 즉시 실행 (수동)');
  await checkAndNotify();
}

module.exports = { startScheduler, stopScheduler, runNow };
