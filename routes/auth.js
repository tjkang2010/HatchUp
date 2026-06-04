// ============================================================
// 🔐 회원가입 / 로그인 - auth.js
// ============================================================
// 레퍼럴 어뷰징 방지 포함
// - IP 기반 중복 가입 제한
// - 레퍼럴 보상은 첫 결제 후 지급
// ============================================================

const express  = require('express');
const bcrypt   = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db       = require('../db/db');
const authMW   = require('../middleware/auth');
const logger   = require('../utils/logger');
const APP      = require('../config/app-config');

const router = express.Router();

// ── 입력 검증 ────────────────────────────────────────────
const isValidEmail    = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const isValidPassword = (p) => p.length >= 8 && /\d/.test(p) && /[a-zA-Z]/.test(p);
const isValidNickname = (n) => /^[가-힣a-zA-Z0-9]{2,12}$/.test(n);

// 추천인 코드 생성
function generateReferralCode() {
  return uuidv4().replace(/-/g, '').substring(0, 8).toUpperCase();
}

// 클라이언트 IP 추출
function getClientIP(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

// ============================================================
// 📝 회원가입
// POST /api/auth/register
// ============================================================
router.post('/register', async (req, res) => {
  try {
    const { email, password, nickname, referralCode } = req.body;
    const clientIP = getClientIP(req);

    // ── 입력 검증 ──────────────────────────────────────────
    if (!email || !password || !nickname) {
      return res.status(400).json({ success: false, message: '이메일, 비밀번호, 닉네임을 모두 입력해주세요.' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, message: '이메일 형식이 올바르지 않습니다.' });
    }
    if (!isValidPassword(password)) {
      return res.status(400).json({ success: false, message: '비밀번호는 8자 이상, 영문+숫자를 포함해야 합니다.' });
    }
    if (!isValidNickname(nickname)) {
      return res.status(400).json({ success: false, message: '닉네임은 2~12자, 한글/영문/숫자만 가능합니다.' });
    }

    const adapter = db.getAdapter();

    // ── 중복 이메일 확인 ────────────────────────────────────
    if (db.getUserByEmail(email)) {
      return res.status(409).json({ success: false, message: '이미 사용 중인 이메일입니다.' });
    }

    // ── 닉네임 중복 확인 ────────────────────────────────────
    const nickCheck = adapter.get('SELECT id FROM users WHERE nickname = ?', [nickname]);
    if (nickCheck) {
      return res.status(409).json({ success: false, message: '이미 사용 중인 닉네임입니다.' });
    }

    // ── IP 기반 어뷰징 방지 ─────────────────────────────────
    // 같은 IP에서 너무 많이 가입하면 차단
    const ipCount = adapter.get(
      'SELECT COUNT(*) as cnt FROM users WHERE signup_ip = ?',
      [clientIP]
    );
    if (ipCount?.cnt >= APP.referral.maxAccountsPerIP) {
      logger.warn(`⚠️ IP 가입 제한: ${clientIP} (${ipCount.cnt}개 계정)`);
      return res.status(429).json({
        success: false,
        message: '해당 네트워크에서 너무 많은 계정이 생성됐습니다. 고객센터로 문의하세요.'
      });
    }

    // ── 추천인 코드 확인 ────────────────────────────────────
    let referrerId   = null;
    let referredByCode = null;

    if (referralCode) {
      const referrer = adapter.get(
        'SELECT id, signup_ip FROM users WHERE referral_code = ?',
        [referralCode.toUpperCase()]
      );
      if (referrer) {
        // 같은 IP의 추천인은 어뷰징으로 간주
        if (referrer.signup_ip === clientIP && clientIP !== 'unknown') {
          logger.warn(`⚠️ 레퍼럴 어뷰징 감지: 추천인 IP(${clientIP})와 피추천인 IP 동일`);
          // 가입은 허용하되 레퍼럴 코드 무시
        } else {
          referrerId    = referrer.id;
          referredByCode = referralCode.toUpperCase();
        }
      }
    }

    // ── 비밀번호 암호화 ─────────────────────────────────────
    const passwordHash = await bcrypt.hash(password, 12);

    // ── 내 추천인 코드 생성 (중복 없도록) ───────────────────
    let myReferralCode;
    do {
      myReferralCode = generateReferralCode();
    } while (adapter.get('SELECT id FROM users WHERE referral_code = ?', [myReferralCode]));

    // ── 이메일 인증 토큰 생성 ───────────────────────────────
    const emailToken = uuidv4();

    // ── 회원 생성 트랜잭션 ──────────────────────────────────
    const txn = adapter.transaction(() => {
      // 회원 생성 (포인트 0으로 시작, 이메일 인증 후 지급)
      const result = adapter.run(`
        INSERT INTO users
          (email, password_hash, nickname, role, points, referral_code,
           referred_by, signup_ip, email_token)
        VALUES (?, ?, ?, 'user', 0, ?, ?, ?, ?)
      `, [
        email.toLowerCase(), passwordHash, nickname,
        myReferralCode, referredByCode, clientIP, emailToken
      ]);

      const newUserId = result.lastInsertRowid;

      // 가입 보너스 지급 (이메일 인증 전에도 기본 보너스는 지급)
      db.changePoints(
        newUserId, APP.points.signupBonus,
        'earn', '회원가입 환영 포인트',
        `signup-bonus-${newUserId}`
      );

      // 레퍼럴 기록 (실제 보상은 첫 결제 후 지급)
      if (referrerId) {
        adapter.run(`
          INSERT INTO referrals
            (referrer_id, referred_id, referral_code, status, signup_ip)
          VALUES (?, ?, ?, 'pending', ?)
        `, [referrerId, newUserId, referredByCode, clientIP]);
      }

      // 기본 인벤토리 슬롯 생성
      for (const type of ['food','medicine','clean','sleep','light','toy']) {
        adapter.run(
          'INSERT INTO inventory (user_id, item_type, quantity) VALUES (?, ?, 0)',
          [newUserId, type]
        );
      }

      // 첫 캐릭터 자동 생성
      adapter.run(
        'INSERT INTO characters (user_id, name, stage, version) VALUES (?, ?, \'egg\', 1)',
        [newUserId, `${nickname}의 해치`]
      );

      return newUserId;
    });

    const newUserId = txn();

    // ── 이메일 인증 발송 (TODO: 실제 SMTP 연동) ─────────────
    // sendVerificationEmail(email, emailToken);
    logger.info(`이메일 인증 토큰 생성 (개발 모드): ${emailToken}`);

    // ── JWT 발급 ────────────────────────────────────────────
    const user  = db.getUserById(newUserId);
    const token = authMW.signToken(user);

    logger.info(`✅ 회원가입: ${email}, IP: ${clientIP}, 추천인: ${referrerId || '없음'}`);

    res.status(201).json({
      success: true,
      message: `${APP.name}에 오신 것을 환영합니다! 가입 보너스 ${APP.points.signupBonus}P가 지급됐습니다.`,
      token,
      user: {
        id:           newUserId,
        email:        email.toLowerCase(),
        nickname,
        role:         'user',
        points:       APP.points.signupBonus,
        referralCode: myReferralCode,
      }
    });

  } catch (error) {
    logger.error('회원가입 오류: ' + error.message);
    db.logError('error', '회원가입 실패: ' + error.message, error.stack, null, req.path);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' });
  }
});

// ============================================================
// 🔑 로그인
// POST /api/auth/login
// ============================================================
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const clientIP = getClientIP(req);

    if (!email || !password) {
      return res.status(400).json({ success: false, message: '이메일과 비밀번호를 입력해주세요.' });
    }

    const user = db.getUserByEmail(email);
    if (!user) {
      return res.status(401).json({ success: false, message: '이메일 또는 비밀번호가 틀렸습니다.' });
    }
    if (!user.is_active) {
      return res.status(403).json({ success: false, message: '비활성화된 계정입니다. 고객센터로 문의하세요.' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: '이메일 또는 비밀번호가 틀렸습니다.' });
    }

    // 마지막 로그인 IP + 시간 업데이트
    db.getAdapter().run(
      'UPDATE users SET last_login = ?, last_login_ip = ?, updated_at = ? WHERE id = ?',
      [new Date().toISOString(), clientIP, new Date().toISOString(), user.id]
    );

    const token = authMW.signToken(user);
    logger.info(`✅ 로그인: ${email}, IP: ${clientIP}`);

    res.json({
      success: true,
      message: `${APP.name}에 오신 것을 환영합니다!`,
      token,
      user: {
        id:           user.id,
        email:        user.email,
        nickname:     user.nickname,
        role:         user.role,
        points:       user.points,
        referralCode: user.referral_code,
        emailVerified: !!user.email_verified,
      }
    });

  } catch (error) {
    logger.error('로그인 오류: ' + error.message);
    db.logError('error', '로그인 실패: ' + error.message, error.stack, null, req.path);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

// ============================================================
// 🔄 토큰 갱신
// POST /api/auth/refresh
// ============================================================
router.post('/refresh', (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ success: false, message: '토큰이 없습니다.' });
  try {
    const jwt     = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { ignoreExpiration: true });
    const user    = db.getUserById(decoded.userId);
    if (!user || !user.is_active) {
      return res.status(401).json({ success: false, message: '유효하지 않은 사용자입니다.' });
    }
    res.json({ success: true, token: authMW.signToken(user) });
  } catch (e) {
    res.status(401).json({ success: false, message: '토큰이 유효하지 않습니다.' });
  }
});

module.exports = router;
