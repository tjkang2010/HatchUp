// ============================================================
// 🗄️ DB 레이어 - db.js
// ============================================================
// 현재 버전: SQLite 전용 MVP
//
// ⚠️ PostgreSQL 전환 안내:
//   현재 버전은 SQLite 동기 구조 기준입니다.
//   PostgreSQL 전환은 라우터 비동기 리팩토링 후 별도 진행해야 합니다.
//   지금은 DATABASE_URL을 설정하지 마세요.
//
// SQLite DB 파일 위치:
//   개발:    프로젝트루트/data/hatchup.db
//   Railway: /app/data/hatchup.db  (Volume: /app/data 마운트 필수)
// ============================================================

const path    = require('path');
const fs      = require('fs');
const logger  = require('../utils/logger');

// ============================================================
// ⛔ DATABASE_URL 감지 시 즉시 서버 중단
// (pg 패키지 없어 서버 crash 방지 — 명확한 오류로 차단)
// ============================================================
if (process.env.DATABASE_URL) {
  console.error('');
  console.error('❌ HatchUp v2.x는 SQLite 전용 MVP입니다.');
  console.error('   DATABASE_URL이 감지됐습니다.');
  console.error('   Railway Variables에서 DATABASE_URL을 제거하세요.');
  console.error('   PostgreSQL 전환은 별도 리팩토링 후 진행해야 합니다.');
  console.error('');
  process.exit(1);
}

// SQLite 전용 — PostgreSQL 분기 없음 (USE_PG 항상 false)
const USE_PG = false;

let db;   // DB 연결 객체
let adapter; // SQL 실행 어댑터

// ============================================================
// SQLite 어댑터
// ============================================================
function createSQLiteAdapter(database) {
  return {
    // 단일 행 조회
    get: (sql, params = []) => database.prepare(sql).get(...params),

    // 여러 행 조회
    all: (sql, params = []) => database.prepare(sql).all(...params),

    // INSERT / UPDATE / DELETE
    run: (sql, params = []) => database.prepare(sql).run(...params),

    // 트랜잭션 (여러 쿼리를 한 번에 — 실패 시 전부 롤백)
    transaction: (fn) => database.transaction(fn),

    // DB 종료
    close: () => database.close(),
  };
}

// ============================================================
// PostgreSQL 어댑터 (향후 전환용)
// ============================================================
async function createPGAdapter(pool) {
  return {
    get: async (sql, params = []) => {
      // PostgreSQL은 ? 대신 $1, $2 ... 사용
      const pgSql = sql.replace(/\?/g, (_, i) => `$${i + 1}`);
      const res   = await pool.query(pgSql, params);
      return res.rows[0] || null;
    },
    all: async (sql, params = []) => {
      const pgSql = sql.replace(/\?/g, (_, i) => `$${i + 1}`);
      const res   = await pool.query(pgSql, params);
      return res.rows;
    },
    run: async (sql, params = []) => {
      const pgSql = sql.replace(/\?/g, (_, i) => `$${i + 1}`);
      const res   = await pool.query(pgSql, params);
      return { lastInsertRowid: res.rows[0]?.id, changes: res.rowCount };
    },
    transaction: (fn) => async (...args) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(...args);
        await client.query('COMMIT');
        return result;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

// ============================================================
// DB 초기화
// ============================================================
async function initialize() {
  // USE_PG는 항상 false — DATABASE_URL 감지 시 process.exit(1) 처리됨
  // PostgreSQL 연결 블록은 향후 리팩토링 시 활성화
  if (false) {
    // (비활성화) PostgreSQL 전환 시 라우터 async/await 리팩토링 필요
  } else {
    // ── SQLite 연결 ──────────────────────────────────────────
    logger.info('💾 SQLite 연결 시도...');
    const Database = require('better-sqlite3');
    const DB_DIR   = path.join(__dirname, '../data');  // Railway: /app/data 와 일치
    const DB_PATH  = path.join(DB_DIR, 'hatchup.db');

    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
      logger.info('📁 data 폴더 생성');
    }

    const sqlite = new Database(DB_PATH);
    sqlite.pragma('journal_mode = WAL');  // 동시 읽기 허용
    sqlite.pragma('foreign_keys = ON');   // 관계 무결성
    sqlite.pragma('synchronous = NORMAL');

    adapter = createSQLiteAdapter(sqlite);
    db = sqlite;
    logger.info(`✅ SQLite 연결: ${DB_PATH}`);
  }

  await createTables();
  await insertDefaultData();
  return adapter;
}

// ============================================================
// 테이블 생성 (schema.sql 기준)
// ============================================================
async function createTables() {
  const run = (sql) => USE_PG ? db.query(sql) : db.exec(sql);

  // ── users ────────────────────────────────────────────────
  await run(`CREATE TABLE IF NOT EXISTS users (
    id               INTEGER PRIMARY KEY ${USE_PG ? 'GENERATED ALWAYS AS IDENTITY' : 'AUTOINCREMENT'},
    email            TEXT UNIQUE NOT NULL,
    password_hash    TEXT NOT NULL,
    nickname         TEXT NOT NULL,
    role             TEXT DEFAULT 'user',        -- user / admin
    points           INTEGER DEFAULT 0,           -- 포인트 (직접 수정 금지! changePoints() 사용)
    referral_code    TEXT UNIQUE,
    referred_by      TEXT,
    referral_paid    INTEGER DEFAULT 0,           -- 레퍼럴 보상 지급 여부 (첫 결제 후 지급)
    email_verified   INTEGER DEFAULT 0,           -- 이메일 인증 여부
    email_token      TEXT,                        -- 이메일 인증 토큰
    prestige_count   INTEGER DEFAULT 0,           -- 프레스티지 횟수
    signup_ip        TEXT,                        -- 가입 IP (어뷰징 방지)
    last_login_ip    TEXT,
    is_active        INTEGER DEFAULT 1,
    created_at       ${USE_PG ? 'TIMESTAMPTZ' : 'DATETIME'} DEFAULT ${USE_PG ? 'NOW()' : 'CURRENT_TIMESTAMP'},
    updated_at       ${USE_PG ? 'TIMESTAMPTZ' : 'DATETIME'} DEFAULT ${USE_PG ? 'NOW()' : 'CURRENT_TIMESTAMP'},
    last_login       ${USE_PG ? 'TIMESTAMPTZ' : 'DATETIME'}
  )`);

  // ── characters ───────────────────────────────────────────
  await run(`CREATE TABLE IF NOT EXISTS characters (
    id           INTEGER PRIMARY KEY ${USE_PG ? 'GENERATED ALWAYS AS IDENTITY' : 'AUTOINCREMENT'},
    user_id      INTEGER NOT NULL,
    name         TEXT NOT NULL,
    stage        TEXT DEFAULT 'egg',
    version      INTEGER DEFAULT 1,
    hunger       INTEGER DEFAULT 100,
    happy        INTEGER DEFAULT 100,
    health       INTEGER DEFAULT 100,
    age_days     INTEGER DEFAULT 0,
    poop_count   INTEGER DEFAULT 0,
    is_sick      INTEGER DEFAULT 0,
    is_sleeping  INTEGER DEFAULT 0,
    is_dead      INTEGER DEFAULT 0,
    is_for_sale  INTEGER DEFAULT 0,
    sale_price   INTEGER DEFAULT 0,
    sold_at      ${USE_PG ? 'TIMESTAMPTZ' : 'DATETIME'},
    born_at      ${USE_PG ? 'TIMESTAMPTZ' : 'DATETIME'} DEFAULT ${USE_PG ? 'NOW()' : 'CURRENT_TIMESTAMP'},
    matured_at   ${USE_PG ? 'TIMESTAMPTZ' : 'DATETIME'},
    died_at      ${USE_PG ? 'TIMESTAMPTZ' : 'DATETIME'},
    last_fed_at  ${USE_PG ? 'TIMESTAMPTZ' : 'DATETIME'},
    last_update  ${USE_PG ? 'TIMESTAMPTZ' : 'DATETIME'} DEFAULT ${USE_PG ? 'NOW()' : 'CURRENT_TIMESTAMP'},
    created_at   ${USE_PG ? 'TIMESTAMPTZ' : 'DATETIME'} DEFAULT ${USE_PG ? 'NOW()' : 'CURRENT_TIMESTAMP'},
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  // ── inventory ────────────────────────────────────────────
  await run(`CREATE TABLE IF NOT EXISTS inventory (
    id        INTEGER PRIMARY KEY ${USE_PG ? 'GENERATED ALWAYS AS IDENTITY' : 'AUTOINCREMENT'},
    user_id   INTEGER NOT NULL,
    item_type TEXT NOT NULL,
    quantity  INTEGER DEFAULT 0,
    UNIQUE(user_id, item_type),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  // ── point_transactions ───────────────────────────────────
  // ⚠️ 포인트는 반드시 이 테이블을 통해서만 변경
  await run(`CREATE TABLE IF NOT EXISTS point_transactions (
    id           INTEGER PRIMARY KEY ${USE_PG ? 'GENERATED ALWAYS AS IDENTITY' : 'AUTOINCREMENT'},
    user_id      INTEGER NOT NULL,
    type         TEXT NOT NULL,       -- earn/spend/charge/referral/sale/refund/admin
    amount       INTEGER NOT NULL,    -- 양수=획득, 음수=사용
    balance_after INTEGER NOT NULL,   -- 거래 후 잔액
    reason       TEXT NOT NULL,       -- 사유 (화면 표시용)
    reference_id TEXT UNIQUE,         -- 중복 방지 고유 ID (결제키, 주문ID 등)
    created_at   ${USE_PG ? 'TIMESTAMPTZ' : 'DATETIME'} DEFAULT ${USE_PG ? 'NOW()' : 'CURRENT_TIMESTAMP'},
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  // ── orders ───────────────────────────────────────────────
  await run(`CREATE TABLE IF NOT EXISTS orders (
    id          INTEGER PRIMARY KEY ${USE_PG ? 'GENERATED ALWAYS AS IDENTITY' : 'AUTOINCREMENT'},
    order_id    TEXT UNIQUE NOT NULL,
    user_id     INTEGER NOT NULL,
    package_key TEXT NOT NULL,
    amount      INTEGER NOT NULL,    -- 결제 금액 (서버 기준, 클라이언트 무시)
    points      INTEGER NOT NULL,    -- 지급 포인트
    status      TEXT DEFAULT 'pending', -- pending/paid/failed/canceled/refunded
    payment_key TEXT,
    error_msg   TEXT,
    paid_at     ${USE_PG ? 'TIMESTAMPTZ' : 'DATETIME'},
    created_at  ${USE_PG ? 'TIMESTAMPTZ' : 'DATETIME'} DEFAULT ${USE_PG ? 'NOW()' : 'CURRENT_TIMESTAMP'},
    updated_at  ${USE_PG ? 'TIMESTAMPTZ' : 'DATETIME'} DEFAULT ${USE_PG ? 'NOW()' : 'CURRENT_TIMESTAMP'},
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  // ── payments ─────────────────────────────────────────────
  await run(`CREATE TABLE IF NOT EXISTS payments (
    id          INTEGER PRIMARY KEY ${USE_PG ? 'GENERATED ALWAYS AS IDENTITY' : 'AUTOINCREMENT'},
    order_id    TEXT NOT NULL,
    user_id     INTEGER NOT NULL,
    payment_key TEXT UNIQUE NOT NULL,
    method      TEXT,
    amount      INTEGER NOT NULL,
    points      INTEGER NOT NULL,
    status      TEXT DEFAULT 'paid',  -- paid/refunded/partial_refunded
    raw_data    TEXT,
    created_at  ${USE_PG ? 'TIMESTAMPTZ' : 'DATETIME'} DEFAULT ${USE_PG ? 'NOW()' : 'CURRENT_TIMESTAMP'},
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  // ── referrals ────────────────────────────────────────────
  await run(`CREATE TABLE IF NOT EXISTS referrals (
    id           INTEGER PRIMARY KEY ${USE_PG ? 'GENERATED ALWAYS AS IDENTITY' : 'AUTOINCREMENT'},
    referrer_id  INTEGER NOT NULL,   -- 추천인
    referred_id  INTEGER NOT NULL,   -- 피추천인
    referral_code TEXT NOT NULL,
    status       TEXT DEFAULT 'pending',  -- pending/paid
    signup_ip    TEXT,
    paid_at      ${USE_PG ? 'TIMESTAMPTZ' : 'DATETIME'},
    created_at   ${USE_PG ? 'TIMESTAMPTZ' : 'DATETIME'} DEFAULT ${USE_PG ? 'NOW()' : 'CURRENT_TIMESTAMP'},
    FOREIGN KEY (referrer_id) REFERENCES users(id),
    FOREIGN KEY (referred_id) REFERENCES users(id)
  )`);

  // ── character_trades ─────────────────────────────────────
  await run(`CREATE TABLE IF NOT EXISTS character_trades (
    id           INTEGER PRIMARY KEY ${USE_PG ? 'GENERATED ALWAYS AS IDENTITY' : 'AUTOINCREMENT'},
    character_id INTEGER NOT NULL,
    seller_id    INTEGER NOT NULL,
    buyer_id     INTEGER,
    price        INTEGER NOT NULL,
    version      INTEGER DEFAULT 1,
    status       TEXT DEFAULT 'listing',  -- listing/sold/canceled
    listed_at    ${USE_PG ? 'TIMESTAMPTZ' : 'DATETIME'} DEFAULT ${USE_PG ? 'NOW()' : 'CURRENT_TIMESTAMP'},
    traded_at    ${USE_PG ? 'TIMESTAMPTZ' : 'DATETIME'},
    created_at   ${USE_PG ? 'TIMESTAMPTZ' : 'DATETIME'} DEFAULT ${USE_PG ? 'NOW()' : 'CURRENT_TIMESTAMP'}
  )`);

  // ── shop_items ───────────────────────────────────────────
  await run(`CREATE TABLE IF NOT EXISTS shop_items (
    id          INTEGER PRIMARY KEY ${USE_PG ? 'GENERATED ALWAYS AS IDENTITY' : 'AUTOINCREMENT'},
    item_type   TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL,
    description TEXT,
    base_price  INTEGER NOT NULL,   -- v1 기준 가격 (버전 배율 적용)
    is_active   INTEGER DEFAULT 1,
    created_at  ${USE_PG ? 'TIMESTAMPTZ' : 'DATETIME'} DEFAULT ${USE_PG ? 'NOW()' : 'CURRENT_TIMESTAMP'},
    updated_at  ${USE_PG ? 'TIMESTAMPTZ' : 'DATETIME'} DEFAULT ${USE_PG ? 'NOW()' : 'CURRENT_TIMESTAMP'}
  )`);

  // ── push_subscriptions ───────────────────────────────────
  await run(`CREATE TABLE IF NOT EXISTS push_subscriptions (
    id          INTEGER PRIMARY KEY ${USE_PG ? 'GENERATED ALWAYS AS IDENTITY' : 'AUTOINCREMENT'},
    user_id     INTEGER NOT NULL,
    endpoint    TEXT NOT NULL,
    p256dh      TEXT NOT NULL,
    auth_key    TEXT NOT NULL,
    device_name TEXT DEFAULT '기기',
    created_at  ${USE_PG ? 'TIMESTAMPTZ' : 'DATETIME'} DEFAULT ${USE_PG ? 'NOW()' : 'CURRENT_TIMESTAMP'},
    updated_at  ${USE_PG ? 'TIMESTAMPTZ' : 'DATETIME'} DEFAULT ${USE_PG ? 'NOW()' : 'CURRENT_TIMESTAMP'},
    UNIQUE(user_id, endpoint),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  // ── push_settings ────────────────────────────────────────
  await run(`CREATE TABLE IF NOT EXISTS push_settings (
    user_id       INTEGER PRIMARY KEY,
    notify_hunger INTEGER DEFAULT 1,
    notify_health INTEGER DEFAULT 1,
    notify_poop   INTEGER DEFAULT 1,
    notify_sick   INTEGER DEFAULT 1,
    notify_evolve INTEGER DEFAULT 1,
    notify_dead   INTEGER DEFAULT 1,
    quiet_start   INTEGER DEFAULT 23,
    quiet_end     INTEGER DEFAULT 7,
    updated_at    ${USE_PG ? 'TIMESTAMPTZ' : 'DATETIME'} DEFAULT ${USE_PG ? 'NOW()' : 'CURRENT_TIMESTAMP'},
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  // ── game_versions ────────────────────────────────────────
  await run(`CREATE TABLE IF NOT EXISTS game_versions (
    version         INTEGER PRIMARY KEY,
    name            TEXT NOT NULL,
    emoji           TEXT NOT NULL,
    grow_days       INTEGER NOT NULL,
    price_multiplier INTEGER NOT NULL,
    sale_min        INTEGER NOT NULL,
    sale_max        INTEGER NOT NULL,
    sale_recommend  INTEGER NOT NULL,
    unlock_req_ver  INTEGER,
    unlock_req_count INTEGER DEFAULT 1,
    is_prestige     INTEGER DEFAULT 0,
    created_at      ${USE_PG ? 'TIMESTAMPTZ' : 'DATETIME'} DEFAULT ${USE_PG ? 'NOW()' : 'CURRENT_TIMESTAMP'}
  )`);

  // ── admin_logs ───────────────────────────────────────────
  await run(`CREATE TABLE IF NOT EXISTS admin_logs (
    id         INTEGER PRIMARY KEY ${USE_PG ? 'GENERATED ALWAYS AS IDENTITY' : 'AUTOINCREMENT'},
    admin_id   INTEGER NOT NULL,
    action     TEXT NOT NULL,
    target     TEXT,
    detail     TEXT,
    ip         TEXT,
    created_at ${USE_PG ? 'TIMESTAMPTZ' : 'DATETIME'} DEFAULT ${USE_PG ? 'NOW()' : 'CURRENT_TIMESTAMP'}
  )`);

  // ── error_logs ───────────────────────────────────────────
  await run(`CREATE TABLE IF NOT EXISTS error_logs (
    id         INTEGER PRIMARY KEY ${USE_PG ? 'GENERATED ALWAYS AS IDENTITY' : 'AUTOINCREMENT'},
    level      TEXT NOT NULL,
    message    TEXT NOT NULL,
    stack      TEXT,
    user_id    INTEGER,
    path       TEXT,
    created_at ${USE_PG ? 'TIMESTAMPTZ' : 'DATETIME'} DEFAULT ${USE_PG ? 'NOW()' : 'CURRENT_TIMESTAMP'}
  )`);

  // ── 마이그레이션: 기존 컬럼 없으면 추가 ─────────────────
  if (!USE_PG) {
    const migrations = [
      `ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'`,
      `ALTER TABLE users ADD COLUMN signup_ip TEXT`,
      `ALTER TABLE users ADD COLUMN last_login_ip TEXT`,
      `ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0`,
      `ALTER TABLE users ADD COLUMN email_token TEXT`,
      `ALTER TABLE users ADD COLUMN referral_paid INTEGER DEFAULT 0`,
      `ALTER TABLE users ADD COLUMN prestige_count INTEGER DEFAULT 0`,
      `ALTER TABLE users ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP`,
      `ALTER TABLE characters ADD COLUMN age_days INTEGER DEFAULT 0`,
      `ALTER TABLE characters ADD COLUMN poop_count INTEGER DEFAULT 0`,
      `ALTER TABLE characters ADD COLUMN sold_at DATETIME`,
      `ALTER TABLE point_transactions ADD COLUMN reference_id TEXT`,
      `ALTER TABLE point_transactions ADD COLUMN balance_after INTEGER DEFAULT 0`,
    ];
    for (const sql of migrations) {
      try { db.exec(sql); } catch(e) { /* 이미 있으면 무시 */ }
    }
  }

  // ── 인덱스 ───────────────────────────────────────────────
  const indexes = [
    `CREATE INDEX IF NOT EXISTS idx_users_email     ON users(email)`,
    `CREATE INDEX IF NOT EXISTS idx_users_referral  ON users(referral_code)`,
    `CREATE INDEX IF NOT EXISTS idx_users_role      ON users(role)`,
    `CREATE INDEX IF NOT EXISTS idx_chars_user      ON characters(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_chars_version   ON characters(version)`,
    `CREATE INDEX IF NOT EXISTS idx_txn_user        ON point_transactions(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_txn_ref         ON point_transactions(reference_id)`,
    `CREATE INDEX IF NOT EXISTS idx_orders_user     ON orders(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_orders_status   ON orders(status)`,
    `CREATE INDEX IF NOT EXISTS idx_payments_user   ON payments(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_trades_seller   ON character_trades(seller_id)`,
    `CREATE INDEX IF NOT EXISTS idx_push_user       ON push_subscriptions(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_error_created   ON error_logs(created_at)`,
  ];
  for (const sql of indexes) {
    try { await run(sql); } catch(e) {}
  }

  logger.info('✅ 모든 테이블 생성/확인 완료');
}

// ============================================================
// 기본 데이터 삽입
// ============================================================
async function insertDefaultData() {
  // 상점 아이템
  const existing = adapter.get('SELECT COUNT(*) as cnt FROM shop_items');
  if ((existing?.cnt || 0) === 0) {
    const items = [
      ['food',     '먹이',    '배고픔 35 회복',       10],
      ['medicine', '약',      '치료 + 건강 25 회복',   20],
      ['clean',    '청소도구', '변 제거 + 위생 개선',    5],
      ['sleep',    '수면제',  '재우기 + 건강 회복',    15],
      ['light',    '야간등',  '밤에 불 끄기',           5],
      ['toy',      '장난감',  '행복도 40 증가',        25],
    ];
    for (const [type, name, desc, price] of items) {
      try {
        adapter.run(
          'INSERT INTO shop_items (item_type, name, description, base_price) VALUES (?, ?, ?, ?)',
          [type, name, desc, price]
        );
      } catch(e) {}
    }
    logger.info('✅ 기본 상점 아이템 삽입');
  }

  // 게임 버전 데이터
  const verCount = adapter.get('SELECT COUNT(*) as cnt FROM game_versions');
  if ((verCount?.cnt || 0) === 0) {
    const versions = [
      [1, '베이비',  '🥚', 30, 1,  300,   800,   500,  null, 1, 0],
      [2, '주니어',  '🌟', 25, 2,  800,  2000,  1200,     1, 1, 0],
      [3, '시니어',  '💎', 20, 3, 2000,  5000,  3000,     2, 1, 0],
      [4, '엘리트',  '👑', 15, 5, 5000, 10000,  7000,     3, 1, 0],
      [5, '레전드',  '🔥', 10,10,10000, 20000, 15000,     4, 1, 1],
    ];
    for (const v of versions) {
      try {
        adapter.run(`
          INSERT INTO game_versions
            (version, name, emoji, grow_days, price_multiplier,
             sale_min, sale_max, sale_recommend, unlock_req_ver, unlock_req_count, is_prestige)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, v);
      } catch(e) {}
    }
    logger.info('✅ 게임 버전 데이터 삽입');
  }
}

// ============================================================
// 포인트 변경 핵심 함수
// ============================================================
// ⚠️ users.points 직접 수정 절대 금지!
// 반드시 이 함수만 사용할 것.
//
// 처리 순서:
//   1. 트랜잭션 로그 기록
//   2. 잔액 계산
//   3. users 갱신
// ============================================================
function changePoints(userId, amount, type, reason, referenceId = null) {
  const txn = adapter.transaction(() => {
    // 1. 현재 잔액 조회
    const user = adapter.get('SELECT points FROM users WHERE id = ?', [userId]);
    if (!user) throw new Error('회원을 찾을 수 없습니다.');

    // 2. 잔액 계산
    const newBalance = user.points + amount;
    if (newBalance < 0) throw new Error(`포인트 부족 (보유: ${user.points}P, 필요: ${Math.abs(amount)}P)`);

    // 3. reference_id 중복 체크 (중복 지급 방지)
    if (referenceId) {
      const dup = adapter.get(
        'SELECT id FROM point_transactions WHERE reference_id = ?',
        [referenceId]
      );
      if (dup) throw new Error(`중복 포인트 지급 방지: ${referenceId}`);
    }

    // 4. 트랜잭션 로그 먼저 기록
    adapter.run(`
      INSERT INTO point_transactions
        (user_id, type, amount, balance_after, reason, reference_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [userId, type, amount, newBalance, reason, referenceId]);

    // 5. users 잔액 갱신
    adapter.run(
      'UPDATE users SET points = ?, updated_at = ? WHERE id = ?',
      [newBalance, new Date().toISOString(), userId]
    );

    return newBalance;
  });

  return txn();
}

// ============================================================
// 관리자 행동 로그
// ============================================================
function logAdminAction(adminId, action, target, detail, ip) {
  try {
    adapter.run(
      'INSERT INTO admin_logs (admin_id, action, target, detail, ip) VALUES (?, ?, ?, ?, ?)',
      [adminId, action, target || null, detail || null, ip || null]
    );
  } catch(e) {}
}

// ============================================================
// 오류 로그
// ============================================================
function logError(level, message, stack, userId, path) {
  try {
    adapter.run(
      'INSERT INTO error_logs (level, message, stack, user_id, path) VALUES (?, ?, ?, ?, ?)',
      [level, message, stack || null, userId || null, path || null]
    );
  } catch(e) {}
}

// ============================================================
// 유틸리티
// ============================================================
const getUserById    = (id) => adapter.get('SELECT * FROM users WHERE id = ?', [id]);
const getUserByEmail = (e)  => adapter.get('SELECT * FROM users WHERE email = ?', [e.toLowerCase()]);
const getAdapter     = ()   => { if (!adapter) throw new Error('DB 미초기화'); return adapter; };
const getDb          = ()   => { if (!db) throw new Error('DB 미초기화'); return db; };
const close          = ()   => { if (adapter) adapter.close(); logger.info('✅ DB 연결 종료'); };

module.exports = {
  initialize,
  getAdapter,
  getDb,
  close,
  changePoints,
  logAdminAction,
  logError,
  getUserById,
  getUserByEmail,
};

// ============================================================
// 🎮 캐릭터 관련 헬퍼 함수
// ============================================================

// ============================================================
// 캐릭터 상태 업데이트 (안전장치 포함)
// ⚠️ DB 기준: age_days, poop_count
//    age / poop 키가 들어오면 자동 변환 후 경고 로그
// ============================================================
function updateCharacter(charId, updates) {
  const a = getAdapter();

  // ── 허용 컬럼 whitelist ──────────────────────────────────
  const ALLOWED = new Set([
    'hunger', 'happy', 'health',
    'poop_count',   // poop 금지
    'is_sick', 'is_sleeping', 'is_dead',
    'stage',
    'age_days',     // age 금지
    'matured_at', 'died_at', 'last_update',
    'is_for_sale', 'sale_price', 'sold_at',
    'user_id', 'name', 'version',
  ]);

  // ── 잘못된 필드명 자동 변환 ──────────────────────────────
  const safe = {};
  for (const [key, val] of Object.entries(updates)) {
    if (key === 'age') {
      // age → age_days 자동 변환 (경고 로그)
      logger.warn(`⚠️ updateCharacter: 'age' 대신 'age_days' 사용 필요 (자동 변환됨)`);
      safe['age_days'] = val;
    } else if (key === 'poop') {
      // poop → poop_count 자동 변환 (경고 로그)
      logger.warn(`⚠️ updateCharacter: 'poop' 대신 'poop_count' 사용 필요 (자동 변환됨)`);
      safe['poop_count'] = val;
    } else if (ALLOWED.has(key)) {
      safe[key] = val;
    } else {
      // whitelist 외 컬럼은 무시 + 경고
      logger.warn(`⚠️ updateCharacter: 허용되지 않은 컬럼 무시됨 → '${key}'`);
    }
  }

  if (Object.keys(safe).length === 0) return; // 업데이트할 내용 없음

  const fields = Object.keys(safe).map(k => `${k} = ?`).join(', ');
  const values = [...Object.values(safe), charId];
  a.run(`UPDATE characters SET ${fields} WHERE id = ?`, values);
}

// 새 캐릭터 생성
function createCharacter(userId, name, version = 1) {
  const a = getAdapter();
  const result = a.run(
    'INSERT INTO characters (user_id, name, stage, version, hunger, happy, health, age_days, poop_count) VALUES (?, ?, \'egg\', ?, 100, 100, 100, 0, 0)',
    [userId, name, version]
  );
  return result.lastInsertRowid;
}

// 캐릭터 조회 (살아있는 것 중 최신)
function getActiveCharacter(userId) {
  return getAdapter().get(
    'SELECT * FROM characters WHERE user_id = ? AND is_dead = 0 ORDER BY id DESC LIMIT 1',
    [userId]
  );
}

// 캐릭터 단건 조회
function getCharacterById(charId) {
  return getAdapter().get('SELECT * FROM characters WHERE id = ?', [charId]);
}

// 인벤토리 아이템 수량 변경
function changeInventory(userId, itemType, delta) {
  const a = getAdapter();
  a.run(`
    INSERT INTO inventory (user_id, item_type, quantity)
    VALUES (?, ?, MAX(0, ?))
    ON CONFLICT(user_id, item_type) DO UPDATE
    SET quantity = MAX(0, quantity + ?)
  `, [userId, itemType, Math.max(0, delta), delta]);
}

// 인벤토리 수량 조회
function getInventoryItem(userId, itemType) {
  return getAdapter().get(
    'SELECT quantity FROM inventory WHERE user_id = ? AND item_type = ?',
    [userId, itemType]
  );
}

module.exports = Object.assign(module.exports, {
  updateCharacter,
  createCharacter,
  getActiveCharacter,
  getCharacterById,
  changeInventory,
  getInventoryItem,
});
