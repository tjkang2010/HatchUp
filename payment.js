// ============================================================
// 💳 결제 API - payment.js (2차 수정본)
// ============================================================
// 토스페이먼츠 연동
// 테이블: orders (payment_orders 아님)
// 상태값: pending / paid / failed / canceled / refunded
// ⚠️ 클라이언트 금액 신뢰 금지 — 서버에서 검증
// ⚠️ order_id 중복 지급 방지 — reference_id UNIQUE 활용
// ============================================================

const express = require('express');
const https   = require('https');
const crypto  = require('crypto');
const db      = require('../db/db');
const auth    = require('../middleware/auth');
const logger  = require('../utils/logger');

const router = express.Router();

// ── 토스페이먼츠 키 ──────────────────────────────────────
const TOSS_SECRET = process.env.TOSS_SECRET_KEY  || '';
const TOSS_CLIENT = process.env.TOSS_CLIENT_KEY  || '';
const TOSS_WEBHOOK_SECRET = process.env.TOSS_WEBHOOK_SECRET || '';

// ── 충전 패키지 (서버 기준 — 클라이언트 금액 무시) ───────
const PACKAGES = {
  p100:  { points: 100,  price: 1000,  name: '스타터 100P',    bonus: 0   },
  p500:  { points: 500,  price: 4500,  name: '인기 500P',      bonus: 50  },
  p1000: { points: 1000, price: 8000,  name: '대용량 1000P',   bonus: 150 },
  p3000: { points: 3000, price: 20000, name: '프리미엄 3000P', bonus: 500 },
};

// ── 토스 API 호출 헬퍼 ──────────────────────────────────
function callTossAPI(method, endpoint, body) {
  return new Promise((resolve, reject) => {
    const authHeader = Buffer.from(TOSS_SECRET + ':').toString('base64');
    const options = {
      hostname: 'api.tosspayments.com',
      port: 443, path: endpoint, method,
      headers: {
        'Authorization': `Basic ${authHeader}`,
        'Content-Type': 'application/json',
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ============================================================
// 🔑 토스 클라이언트 키 조회
// GET /api/payment/config
// ============================================================
router.get('/config', auth.required, (req, res) => {
  if (!TOSS_CLIENT) {
    return res.json({ success: false, message: '결제 설정이 완료되지 않았습니다.', available: false });
  }
  res.json({ success: true, clientKey: TOSS_CLIENT, isTest: TOSS_CLIENT.startsWith('test_') });
});

// ============================================================
// 📦 충전 패키지 목록
// GET /api/payment/packages
// ============================================================
router.get('/packages', auth.required, (req, res) => {
  const list = Object.entries(PACKAGES).map(([key, pkg]) => ({
    key, ...pkg,
    totalPoints: pkg.points + pkg.bonus,
    pricePerPoint: Math.floor(pkg.price / (pkg.points + pkg.bonus)),
  }));
  res.json({ success: true, packages: list });
});

// ============================================================
// 💳 결제 준비 — 서버에서 주문 생성
// POST /api/payment/prepare
// Body: { packageKey: 'p500' }
// ============================================================
router.post('/prepare', auth.required, (req, res) => {
  try {
    const { packageKey } = req.body;
    const userId = req.user.userId;

    // 패키지는 서버에서 확인 (클라이언트 금액 무시)
    const pkg = PACKAGES[packageKey];
    if (!pkg) return res.status(400).json({ success: false, message: '존재하지 않는 패키지입니다.' });

    // 주문 ID 생성
    const orderId = `HATCHUP-${userId}-${packageKey}-${Date.now()}`;
    const adapter = db.getAdapter();

    // orders 테이블에 pending 상태로 저장
    adapter.run(`
      INSERT INTO orders
        (order_id, user_id, package_key, amount, points, status)
      VALUES (?, ?, ?, ?, ?, 'pending')
    `, [orderId, userId, packageKey, pkg.price, pkg.points + pkg.bonus]);

    logger.info(`💳 결제 준비: 유저 ${userId}, ${pkg.name}, ${pkg.price}원`);

    res.json({
      success:   true,
      orderId,
      amount:    pkg.price,  // 서버 기준 금액
      name:      pkg.name,
      clientKey: TOSS_CLIENT,
    });

  } catch (error) {
    logger.error('결제 준비 오류: ' + error.message);
    db.logError('error', '결제 준비 실패: ' + error.message, error.stack, req.user?.userId, req.path);
    res.status(500).json({ success: false, message: '결제 준비 중 오류가 발생했습니다.' });
  }
});

// ============================================================
// ✅ 결제 승인 — 토스 API 검증 후 포인트 지급
// POST /api/payment/confirm
// Body: { paymentKey, orderId, amount }
// ============================================================
router.post('/confirm', auth.required, async (req, res) => {
  try {
    const { paymentKey, orderId, amount } = req.body;
    const userId  = req.user.userId;
    const adapter = db.getAdapter();

    if (!paymentKey || !orderId || !amount) {
      return res.status(400).json({ success: false, message: '결제 정보가 올바르지 않습니다.' });
    }

    // orders 테이블에서 주문 조회
    const order = adapter.get(
      'SELECT * FROM orders WHERE order_id = ? AND user_id = ?',
      [orderId, userId]
    );
    if (!order) {
      return res.status(404).json({ success: false, message: '주문 정보를 찾을 수 없습니다.' });
    }

    // 이미 처리된 주문 중복 방지
    if (order.status !== 'pending') {
      return res.status(400).json({ success: false, message: '이미 처리된 결제입니다.' });
    }

    // ⚠️ 금액 위변조 검증 (서버 기준 금액과 비교)
    if (parseInt(amount) !== order.amount) {
      logger.error(`⚠️ 금액 위변조 감지! 유저:${userId}, 요청:${amount}원, 실제:${order.amount}원`);
      db.logError('error', `금액 위변조 시도 유저 ${userId}`, null, userId, req.path);
      return res.status(400).json({ success: false, message: '결제 금액이 올바르지 않습니다.' });
    }

    // 토스 API 승인 요청
    const tossResult = await callTossAPI('POST', '/v1/payments/confirm', {
      paymentKey, orderId, amount: order.amount
    });

    if (tossResult.status !== 200) {
      const errMsg = tossResult.data?.message || '결제 승인 실패';
      adapter.run(
        'UPDATE orders SET status = ?, error_msg = ?, updated_at = ? WHERE order_id = ?',
        ['failed', errMsg, new Date().toISOString(), orderId]
      );
      return res.status(400).json({ success: false, message: `결제 승인 실패: ${errMsg}` });
    }

    const payData = tossResult.data;

    // 트랜잭션: 주문 상태 paid + 포인트 지급 동시 처리
    const newBalance = adapter.transaction(() => {
      // orders 상태 → paid
      adapter.run(`
        UPDATE orders
        SET status = 'paid', payment_key = ?, paid_at = ?, updated_at = ?
        WHERE order_id = ?
      `, [paymentKey, new Date().toISOString(), new Date().toISOString(), orderId]);

      // payments 기록
      adapter.run(`
        INSERT INTO payments
          (order_id, user_id, payment_key, method, amount, points, status, raw_data)
        VALUES (?, ?, ?, ?, ?, ?, 'paid', ?)
      `, [orderId, userId, paymentKey, payData.method || 'unknown',
          order.amount, order.points, JSON.stringify(payData)]);

      // 포인트 지급 (reference_id = orderId → 중복 지급 방지)
      return db.changePoints(
        userId, order.points, 'charge',
        `${PACKAGES[order.package_key]?.name || '포인트'} 충전`,
        `payment-${orderId}`
      );
    })();

    // 레퍼럴 보상 지급 (첫 결제 완료 시)
    const user = db.getUserById(userId);
    if (!user.referral_paid && user.referred_by) {
      try {
        const referral = adapter.get(
          'SELECT * FROM referrals WHERE referred_id = ? AND status = ?',
          [userId, 'pending']
        );
        if (referral) {
          db.changePoints(
            referral.referrer_id, 100, 'referral',
            `추천인 보상 (${user.nickname}님 첫 결제)`,
            `referral-${userId}-first-payment`
          );
          adapter.run(
            'UPDATE referrals SET status = ?, paid_at = ? WHERE id = ?',
            ['paid', new Date().toISOString(), referral.id]
          );
          adapter.run(
            'UPDATE users SET referral_paid = 1, updated_at = ? WHERE id = ?',
            [new Date().toISOString(), userId]
          );
          logger.info(`🎁 레퍼럴 보상 지급: 추천인 ${referral.referrer_id} +100P`);
        }
      } catch(e) {
        // 레퍼럴 오류는 결제 자체를 막지 않음
        logger.error('레퍼럴 보상 처리 오류: ' + e.message);
      }
    }

    logger.info(`✅ 결제 완료: 유저 ${userId}, +${order.points}P, 잔액 ${newBalance}P`);
    res.json({
      success:    true,
      message:    `${order.points}P가 충전됐습니다!`,
      points:     order.points,
      newBalance,
      method:     payData.method,
      orderId,
    });

  } catch (error) {
    logger.error('결제 승인 오류: ' + error.message);
    db.logError('error', '결제 승인 실패: ' + error.message, error.stack, req.user?.userId, req.path);
    res.status(500).json({ success: false, message: '결제 처리 중 오류가 발생했습니다. 고객센터로 문의해주세요.' });
  }
});

// ============================================================
// ❌ 결제 실패
// POST /api/payment/fail
// ============================================================
router.post('/fail', auth.required, (req, res) => {
  try {
    const { orderId, code, message } = req.body;
    if (orderId) {
      db.getAdapter().run(
        'UPDATE orders SET status = ?, error_msg = ?, updated_at = ? WHERE order_id = ?',
        ['failed', `${code}: ${message}`, new Date().toISOString(), orderId]
      );
    }
    logger.info(`결제 실패: ${orderId}, ${code}: ${message}`);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false });
  }
});

// ============================================================
// 🔔 웹훅 (토스 서버 → 우리 서버 자동 이벤트)
// POST /api/payment/webhook
// ============================================================
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const rawBody = req.body;

    // 웹훅 서명 검증
    if (TOSS_WEBHOOK_SECRET) {
      const sig      = req.headers['toss-payments-signature'];
      const expected = crypto.createHmac('sha256', TOSS_WEBHOOK_SECRET).update(rawBody).digest('base64');
      if (sig !== expected) {
        logger.error('⚠️ 웹훅 서명 불일치');
        return res.status(401).json({ message: '서명 오류' });
      }
    }

    const event   = JSON.parse(rawBody);
    const adapter = db.getAdapter();
    logger.info(`🔔 웹훅: ${event.eventType}`);

    if (event.eventType === 'PAYMENT_STATUS_CHANGED' && event.data?.status === 'DONE') {
      const order = adapter.get(
        'SELECT * FROM orders WHERE order_id = ?',
        [event.data.orderId]
      );
      // pending 상태만 처리 (중복 지급 방지)
      if (order && order.status === 'pending') {
        db.changePoints(order.user_id, order.points, 'charge', '웹훅 결제 완료', `webhook-${order.order_id}`);
        adapter.run(
          'UPDATE orders SET status = ?, updated_at = ? WHERE order_id = ?',
          ['paid', new Date().toISOString(), order.order_id]
        );
        logger.info(`✅ 웹훅 포인트 지급: 유저 ${order.user_id} +${order.points}P`);
      }
    }

    if (event.eventType === 'PAYMENT_STATUS_CHANGED_CANCELED') {
      adapter.run(
        'UPDATE orders SET status = ?, updated_at = ? WHERE order_id = ?',
        ['canceled', new Date().toISOString(), event.data?.orderId]
      );
    }

    res.status(200).json({ message: 'ok' });
  } catch (error) {
    logger.error('웹훅 오류: ' + error.message);
    res.status(200).json({ message: 'error handled' });
  }
});

// ============================================================
// 💸 환불 (관리자 전용)
// POST /api/payment/refund
// ============================================================
// 처리 순서:
//   1. 이미 환불된 건 중복 처리 금지
//   2. 토스 API 환불 요청
//   3. 포인트 회수 시도 (부족 시 관리자 확인 상태 기록)
//   4. orders/payments 상태 refunded 변경
//   5. point_transactions에 refund 기록
// ============================================================
router.post('/refund', auth.required, auth.adminOnly, async (req, res) => {
  try {
    const { paymentKey, cancelReason, cancelAmount } = req.body;
    const adminId = req.user.userId;

    if (!paymentKey || !cancelReason) {
      return res.status(400).json({ success: false, message: 'paymentKey와 환불 사유를 입력해주세요.' });
    }

    const adapter = db.getAdapter();

    // 1. 결제 내역 조회
    const payment = adapter.get('SELECT * FROM payments WHERE payment_key = ?', [paymentKey]);
    if (!payment) {
      return res.status(404).json({ success: false, message: '결제 내역을 찾을 수 없습니다.' });
    }

    // 2. 이미 환불된 건 중복 처리 금지
    if (payment.status === 'refunded') {
      return res.status(400).json({ success: false, message: '이미 환불 처리된 결제입니다.' });
    }

    // 3. 토스 API 환불 요청
    const refundAmount = cancelAmount ? parseInt(cancelAmount) : payment.amount;
    const result = await callTossAPI('POST', `/v1/payments/${paymentKey}/cancel`, {
      cancelReason,
      ...(cancelAmount && { cancelAmount: refundAmount })
    });

    if (result.status !== 200) {
      return res.status(400).json({
        success: false,
        message: '토스 환불 실패: ' + (result.data?.message || '알 수 없는 오류')
      });
    }

    // 4. 포인트 비례 계산 (부분 환불 지원)
    const refundRatio  = refundAmount / payment.amount;
    const pointsToRevoke = Math.floor(payment.points * refundRatio);

    // 5. 포인트 회수 처리
    let pointStatus = 'revoked'; // 회수 성공
    let pointMsg    = `${pointsToRevoke}P 회수 완료`;

    try {
      db.changePoints(
        payment.user_id,
        -pointsToRevoke,
        'refund',
        `환불 포인트 회수 (사유: ${cancelReason})`,
        `refund-${paymentKey}` // reference_id로 중복 회수 방지
      );
    } catch (pointErr) {
      // 포인트 부족 시 관리자 확인 필요 상태로 기록
      pointStatus = 'insufficient';
      pointMsg    = `포인트 부족으로 회수 불가 (${pointsToRevoke}P) — 관리자 수동 처리 필요`;
      logger.error(`⚠️ 환불 포인트 회수 실패: 유저 ${payment.user_id}, ${pointsToRevoke}P — ${pointErr.message}`);
      db.logError('warn', `환불 포인트 회수 실패: ${pointErr.message}`, null, payment.user_id, '/api/payment/refund');
    }

    // 6. orders/payments 상태 refunded 변경
    adapter.run(
      'UPDATE orders SET status = ?, updated_at = ? WHERE payment_key = ?',
      ['refunded', new Date().toISOString(), paymentKey]
    );
    adapter.run(
      'UPDATE payments SET status = ? WHERE payment_key = ?',
      ['refunded', paymentKey]
    );

    // 7. 관리자 행동 로그
    db.logAdminAction(
      adminId, 'REFUND',
      `payment:${paymentKey}`,
      `환불 ${refundAmount}원, 포인트 ${pointMsg}`,
      req.ip
    );

    logger.info(`💸 환불 완료: ${paymentKey}, ${refundAmount}원, ${pointMsg}`);

    res.json({
      success: true,
      message: `환불 처리됐습니다. ${pointMsg}`,
      refundAmount,
      pointStatus,
      pointsRevoked: pointStatus === 'revoked' ? pointsToRevoke : 0,
    });

  } catch (error) {
    logger.error('환불 오류: ' + error.message);
    db.logError('error', '환불 처리 실패: ' + error.message, error.stack, req.user?.userId, '/api/payment/refund');
    res.status(500).json({ success: false, message: '환불 처리 중 오류가 발생했습니다.' });
  }
});

// ============================================================
// 📜 결제 내역
// GET /api/payment/history
// ============================================================
router.get('/history', auth.required, (req, res) => {
  try {
    const adapter = db.getAdapter();
    const userId  = req.user.userId;
    const page    = Math.max(1, parseInt(req.query.page) || 1);
    const limit   = 10;
    const offset  = (page - 1) * limit;

    const payments = adapter.all(`
      SELECT p.*, o.package_key
      FROM payments p
      JOIN orders o ON p.order_id = o.order_id
      WHERE p.user_id = ?
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `, [userId, limit, offset]);

    const total = adapter.get(
      'SELECT COUNT(*) as cnt FROM payments WHERE user_id = ?', [userId]
    )?.cnt || 0;

    res.json({ success: true, payments, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (error) {
    res.status(500).json({ success: false, message: '내역을 불러오지 못했습니다.' });
  }
});

module.exports = router;
