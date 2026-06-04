// ============================================================
// ⚠️ 전역 오류 처리 - errorHandler.js
// ============================================================
// 서버 어디서든 오류가 나면 여기서 한 번에 처리합니다.
// 오류는 자동으로 DB에 저장되고 서버는 계속 실행됩니다.
// ============================================================

const db     = require('../db/db');
const logger = require('../utils/logger');

function errorHandler(err, req, res, next) {
  // 오류 정보 수집
  const statusCode = err.statusCode || 500;
  const message    = err.message || '알 수 없는 오류가 발생했습니다.';
  const userId     = req.user?.userId || null;

  // 오류 로그 기록 (콘솔 + DB)
  logger.error(`[${req.method}] ${req.path} → ${statusCode}: ${message}`);

  // DB에 자동 저장 (나중에 관리자 패널에서 확인 가능)
  try {
    db.logError('error', `[${req.method}] ${req.path}: ${message}`, err.stack, userId);
  } catch (logErr) {
    // DB 저장 실패해도 계속 진행
    console.error('오류 로그 저장 실패:', logErr.message);
  }

  // 개발 환경에서는 상세 오류 표시, 배포 환경에서는 간단하게
  const isDev = process.env.NODE_ENV !== 'production';

  res.status(statusCode).json({
    success: false,
    message: isDev ? message : '서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
    ...(isDev && { stack: err.stack }) // 개발 환경에서만 스택 표시
  });
}

module.exports = errorHandler;
