// ============================================================
// 📝 로그 기록 유틸리티 - logger.js
// ============================================================
// 서버의 모든 활동을 파일에 기록합니다.
// logs/ 폴더에서 날짜별로 확인할 수 있습니다.
// ============================================================

const fs   = require('fs');
const path = require('path');

// 로그 폴더 생성
const LOG_DIR = path.join(__dirname, '../../../logs');
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// 현재 날짜를 파일명으로 사용 (예: 2025-01-15.log)
function getLogFileName() {
  const now = new Date();
  const date = now.toISOString().split('T')[0];
  return path.join(LOG_DIR, `${date}.log`);
}

// 로그 기록 함수
function writeLog(level, message) {
  const now       = new Date().toISOString();
  const logLine   = `[${now}] [${level.toUpperCase()}] ${message}\n`;

  // 콘솔 출력 (색상 포함)
  const colors = { info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m' };
  const reset  = '\x1b[0m';
  console.log(`${colors[level] || ''}${logLine.trim()}${reset}`);

  // 파일 기록 (오류가 나도 서버 죽지 않게)
  try {
    fs.appendFileSync(getLogFileName(), logLine);
  } catch (e) {
    console.error('로그 파일 저장 실패:', e.message);
  }
}

module.exports = {
  info:  (msg) => writeLog('info',  msg),
  warn:  (msg) => writeLog('warn',  msg),
  error: (msg) => writeLog('error', msg),
};
