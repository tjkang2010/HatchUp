// ============================================================
// 🛡️ 인증 미들웨어 - auth.js
// ============================================================
// JWT 검증 + role 기반 권한 제어
// ============================================================

const jwt = require('jsonwebtoken');
const db  = require('../db/db');

const JWT_SECRET = process.env.JWT_SECRET;

// ── 필수 환경변수 체크 ────────────────────────────────────
if (!JWT_SECRET) {
  console.error('❌ JWT_SECRET 환경변수가 설정되지 않았습니다! 서버를 시작할 수 없습니다.');
  process.exit(1);
}

// ============================================================
// 로그인 필수 (모든 인증 API)
// ============================================================
function required(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: '로그인이 필요합니다.' });
    }

    const token   = header.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    // DB에서 최신 유저 정보 확인 (정지된 계정 실시간 차단)
    const user = db.getUserById(decoded.userId);
    if (!user || !user.is_active) {
      return res.status(401).json({ success: false, message: '비활성화된 계정입니다.' });
    }

    req.user = { ...decoded, role: user.role };
    next();

  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: '로그인이 만료됐습니다. 다시 로그인해주세요.',
        expired: true,
      });
    }
    return res.status(401).json({ success: false, message: '유효하지 않은 인증 정보입니다.' });
  }
}

// ============================================================
// 관리자 전용 (role=admin 만 통과)
// ============================================================
function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') {
    // 관리자 권한 시도 로그 기록
    db.logError('warn',
      `관리자 권한 없는 접근 시도: 유저 ${req.user?.userId}, 경로: ${req.path}`,
      null, req.user?.userId, req.path
    );
    return res.status(403).json({ success: false, message: '관리자만 접근할 수 있습니다.' });
  }
  next();
}

// ============================================================
// 선택적 인증 (로그인 여부 무관하게 통과, 정보만 추출)
// ============================================================
function optional(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      const token   = header.split(' ')[1];
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user      = decoded;
    }
  } catch(e) { /* 무시 */ }
  next();
}

// ============================================================
// JWT 토큰 생성 헬퍼
// ============================================================
function signToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      email:  user.email,
      role:   user.role || 'user',
    },
    JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES || '7d' }
  );
}

module.exports = { required, adminOnly, optional, signToken };
