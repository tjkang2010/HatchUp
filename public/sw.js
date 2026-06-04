// ============================================================
// 🔧 서비스워커 - sw.js
// ============================================================
// 이 파일은 브라우저 백그라운드에서 실행됩니다.
// 서버에서 푸시가 오면 이 파일이 알림을 표시합니다.
//
// 파일 위치: /public/sw.js (서버 루트에서 접근 가능해야 함)
// ============================================================

const CACHE_NAME = 'hatchup-v1';

// ============================================================
// 서비스워커 설치 (최초 1회)
// ============================================================
self.addEventListener('install', (event) => {
  console.log('[SW] 설치됨');
  // 즉시 활성화 (페이지 새로고침 없이)
  self.skipWaiting();
});

// ============================================================
// 서비스워커 활성화
// ============================================================
self.addEventListener('activate', (event) => {
  console.log('[SW] 활성화됨');
  // 모든 클라이언트 즉시 제어
  event.waitUntil(clients.claim());
});

// ============================================================
// 📱 푸시 메시지 수신 → 알림 표시
// ============================================================
self.addEventListener('push', (event) => {
  console.log('[SW] 푸시 수신:', event);

  // 기본값 (서버에서 데이터가 안 왔을 때)
  let payload = {
    title: '🥚 HatchUp',
    body:  '캐릭터가 당신을 기다려요!',
    icon:  '/icon-192.png',
    badge: '/badge.png',
    tag:   'default',
    data:  { url: '/' }
  };

  // 서버에서 보낸 데이터 파싱
  if (event.data) {
    try {
      const data = event.data.json();
      payload = { ...payload, ...data };
    } catch (e) {
      payload.body = event.data.text();
    }
  }

  // 알림 표시 옵션
  const options = {
    body:    payload.body,
    icon:    payload.icon    || '/icon-192.png',
    badge:   payload.badge   || '/badge.png',
    tag:     payload.tag     || 'hatchup',
    data:    payload.data    || { url: '/' },
    vibrate: [200, 100, 200],     // 진동 패턴 (모바일)
    requireInteraction: false,    // true: 사용자가 닫을 때까지 유지
    actions: getActions(payload), // 알림 버튼
    timestamp: Date.now(),
  };

  event.waitUntil(
    self.registration.showNotification(payload.title, options)
  );
});

// ============================================================
// 알림 타입별 버튼 설정
// ============================================================
function getActions(payload) {
  const type = payload.data?.type;
  switch (type) {
    case 'hunger':
      return [{ action: 'open', title: '🍖 먹이 주러 가기' }];
    case 'health':
      return [{ action: 'open', title: '💊 약 주러 가기' }];
    case 'clean':
      return [{ action: 'open', title: '🪣 청소하러 가기' }];
    case 'sick':
      return [{ action: 'open', title: '💊 치료하러 가기' }];
    case 'sell':
      return [{ action: 'open', title: '🏪 판매하러 가기' }];
    case 'evolve':
      return [{ action: 'open', title: '✨ 진화 확인하기' }];
    default:
      return [{ action: 'open', title: '🥚 앱 열기' }];
  }
}

// ============================================================
// 알림 클릭 처리
// ============================================================
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] 알림 클릭:', event.action);
  event.notification.close(); // 알림 닫기

  const url = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        // 이미 열린 탭이 있으면 포커스
        for (const client of windowClients) {
          if (client.url.includes(self.location.origin)) {
            client.focus();
            client.postMessage({ type: 'NOTIFICATION_CLICK', url });
            return;
          }
        }
        // 열린 탭이 없으면 새 탭 열기
        return clients.openWindow(url);
      })
  );
});

// ============================================================
// 알림 닫기 처리 (선택 사항 - 분석용)
// ============================================================
self.addEventListener('notificationclose', (event) => {
  console.log('[SW] 알림 닫힘:', event.notification.tag);
  // 필요하면 여기서 서버에 닫힘 이벤트 전송 가능
});
