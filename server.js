// ============================================================
// 🐣 HatchUp — server.js (v3.0 성장 플랫폼)
// From Egg To Legend.
// ============================================================
require('dotenv').config();

const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const morgan    = require('morgan');
const rateLimit = require('express-rate-limit');
const path      = require('path');
const fs        = require('fs');

const db               = require('./db/db');
const authRoutes       = require('./routes/auth');
const userRoutes       = require('./routes/user');
const gameRoutes       = require('./routes/game');
const shopRoutes       = require('./routes/shop');
const adminRoutes      = require('./routes/admin');
const paymentRoutes    = require('./routes/payment');
const pushRoutes       = require('./routes/push');
const versionRoutes    = require('./routes/version');

const achieveRoutes    = require('./routes/achievements');
const marketRoutes     = require('./routes/market');
const { startScheduler, stopScheduler } = require('./scheduler');
const errorHandler     = require('./middleware/errorHandler');
const logger           = require('./utils/logger');

// 필수 환경변수 체크
if (!process.env.JWT_SECRET) {
  console.error('❌ JWT_SECRET 필수 환경변수 누락');
  process.exit(1);
}

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:    ["'self'"],
      scriptSrc:     ["'self'","'unsafe-inline'","fonts.googleapis.com","js.tosspayments.com"],
      scriptSrcAttr: ["'unsafe-inline'"],  // onclick 등 인라인 이벤트 핸들러 허용
      styleSrc:      ["'self'","'unsafe-inline'","fonts.googleapis.com","fonts.gstatic.com"],
      fontSrc:       ["'self'","fonts.googleapis.com","fonts.gstatic.com"],
      imgSrc:        ["'self'","data:"],
      connectSrc:    ["'self'","api.tosspayments.com"],
      workerSrc:     ["'self'"],
    }
  }
}));

app.use(cors({ origin: process.env.FRONTEND_URL || true, credentials: true }));
app.use('/api/payment/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('short', { stream: { write: m => logger.info(m.trim()) } }));

// Rate limit
app.use('/api/', rateLimit({ windowMs:15*60*1000, max:300, message:{success:false,message:'잠시 후 다시 시도해주세요.'} }));
app.use('/api/auth/', rateLimit({ windowMs:15*60*1000, max:15 }));
app.use('/api/payment/confirm', rateLimit({ windowMs:5*60*1000, max:10 }));

// 라우터 등록
app.use('/api/auth',         authRoutes);
app.use('/api/user',         userRoutes);
app.use('/api/game',         gameRoutes);
app.use('/api/shop',         shopRoutes);
app.use('/api/admin',        adminRoutes);
app.use('/api/payment',      paymentRoutes);
app.use('/api/push',         pushRoutes);
app.use('/api/version',      versionRoutes);

app.use('/api/achievements', achieveRoutes);    // 신규
app.use('/api/market',       marketRoutes);     // 신규

// 정적 파일
app.use(express.static(path.join(__dirname, 'public')));

const pages = {
  '/':        'hatchup-app.html',
  '/admin':   'admin-dashboard.html',
  '/payment': 'payment.html',
  '/version': 'version.html',
};
Object.entries(pages).forEach(([route, file]) => {
  const fp = path.join(__dirname, file);
  if (fs.existsSync(fp)) app.get(route, (_, res) => res.sendFile(fp));
});

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ success:false, message:'API를 찾을 수 없습니다.' });
  const fp = path.join(__dirname, 'hatchup-app.html');
  if (fs.existsSync(fp)) res.sendFile(fp);
  else res.json({ status:'ok', name:'HatchUp', slogan:'From Egg To Legend.', version:'3.0' });
});

app.use(errorHandler);

async function startServer() {
  try {
    logger.info('🐣 HatchUp v3.0 서버 시작 중...');
    await db.initialize();
    const server = app.listen(PORT, '0.0.0.0', () => {
      logger.info(`🚀 HatchUp v3.0 실행 중! 포트: ${PORT}`);
      logger.info(`🎮 신규 API: missions / achievements / market`);
    });
    startScheduler();
    process.on('unhandledRejection', r  => logger.error('비동기 오류: '+(r?.message||r)));
    process.on('uncaughtException',  e  => { logger.error('치명적 오류: '+e.message); if(e.code==='EADDRINUSE') process.exit(1); });
    process.on('SIGTERM', () => { stopScheduler(); server.close(() => { db.close(); process.exit(0); }); });
  } catch (err) {
    logger.error('❌ 서버 시작 실패: '+err.message);
    process.exit(1);
  }
}

startServer();
module.exports = app;
