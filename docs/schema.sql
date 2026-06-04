-- ============================================================
-- 📄 schema.sql — HatchUp DB 스키마
-- ============================================================
-- 현재: SQLite로 자동 생성됨
-- 향후: PostgreSQL 전환 시 이 파일 기준으로 생성
--
-- PostgreSQL 사용법:
--   psql -U postgres -d hatchup -f schema.sql
-- ============================================================

-- 회원
CREATE TABLE IF NOT EXISTS users (
  id               SERIAL PRIMARY KEY,
  email            TEXT UNIQUE NOT NULL,
  password_hash    TEXT NOT NULL,
  nickname         TEXT NOT NULL,
  role             TEXT DEFAULT 'user',        -- user / admin
  points           INTEGER DEFAULT 0,
  referral_code    TEXT UNIQUE,
  referred_by      TEXT,
  referral_paid    INTEGER DEFAULT 0,
  email_verified   INTEGER DEFAULT 0,
  email_token      TEXT,
  prestige_count   INTEGER DEFAULT 0,
  signup_ip        TEXT,
  last_login_ip    TEXT,
  is_active        INTEGER DEFAULT 1,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  last_login       TIMESTAMPTZ
);

-- 캐릭터
CREATE TABLE IF NOT EXISTS characters (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id),
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
  sold_at      TIMESTAMPTZ,
  born_at      TIMESTAMPTZ DEFAULT NOW(),
  matured_at   TIMESTAMPTZ,
  died_at      TIMESTAMPTZ,
  last_fed_at  TIMESTAMPTZ,
  last_update  TIMESTAMPTZ DEFAULT NOW(),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- 인벤토리
CREATE TABLE IF NOT EXISTS inventory (
  id        SERIAL PRIMARY KEY,
  user_id   INTEGER NOT NULL REFERENCES users(id),
  item_type TEXT NOT NULL,
  quantity  INTEGER DEFAULT 0,
  UNIQUE(user_id, item_type)
);

-- ⚠️ 포인트 거래 내역 (직접 수정 금지)
CREATE TABLE IF NOT EXISTS point_transactions (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  type          TEXT NOT NULL,
  amount        INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  reason        TEXT NOT NULL,
  reference_id  TEXT UNIQUE,   -- 중복 지급 방지
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 주문
CREATE TABLE IF NOT EXISTS orders (
  id          SERIAL PRIMARY KEY,
  order_id    TEXT UNIQUE NOT NULL,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  package_key TEXT NOT NULL,
  amount      INTEGER NOT NULL,
  points      INTEGER NOT NULL,
  status      TEXT DEFAULT 'pending',  -- pending/paid/failed/canceled/refunded
  payment_key TEXT,
  error_msg   TEXT,
  paid_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 결제
CREATE TABLE IF NOT EXISTS payments (
  id          SERIAL PRIMARY KEY,
  order_id    TEXT NOT NULL,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  payment_key TEXT UNIQUE NOT NULL,
  method      TEXT,
  amount      INTEGER NOT NULL,
  points      INTEGER NOT NULL,
  status      TEXT DEFAULT 'paid',
  raw_data    TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 레퍼럴
CREATE TABLE IF NOT EXISTS referrals (
  id            SERIAL PRIMARY KEY,
  referrer_id   INTEGER NOT NULL REFERENCES users(id),
  referred_id   INTEGER NOT NULL REFERENCES users(id),
  referral_code TEXT NOT NULL,
  status        TEXT DEFAULT 'pending',  -- pending/paid
  signup_ip     TEXT,
  paid_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 캐릭터 거래
CREATE TABLE IF NOT EXISTS character_trades (
  id           SERIAL PRIMARY KEY,
  character_id INTEGER NOT NULL,
  seller_id    INTEGER NOT NULL,
  buyer_id     INTEGER,
  price        INTEGER NOT NULL,
  version      INTEGER DEFAULT 1,
  status       TEXT DEFAULT 'listing',
  listed_at    TIMESTAMPTZ DEFAULT NOW(),
  traded_at    TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- 상점 아이템
CREATE TABLE IF NOT EXISTS shop_items (
  id          SERIAL PRIMARY KEY,
  item_type   TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  base_price  INTEGER NOT NULL,
  is_active   INTEGER DEFAULT 1,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 게임 버전
CREATE TABLE IF NOT EXISTS game_versions (
  version          INTEGER PRIMARY KEY,
  name             TEXT NOT NULL,
  emoji            TEXT NOT NULL,
  grow_days        INTEGER NOT NULL,
  price_multiplier INTEGER NOT NULL,
  sale_min         INTEGER NOT NULL,
  sale_max         INTEGER NOT NULL,
  sale_recommend   INTEGER NOT NULL,
  unlock_req_ver   INTEGER,
  unlock_req_count INTEGER DEFAULT 1,
  is_prestige      INTEGER DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- 푸시 구독
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  endpoint    TEXT NOT NULL,
  p256dh      TEXT NOT NULL,
  auth_key    TEXT NOT NULL,
  device_name TEXT DEFAULT '기기',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, endpoint)
);

-- 푸시 설정
CREATE TABLE IF NOT EXISTS push_settings (
  user_id       INTEGER PRIMARY KEY REFERENCES users(id),
  notify_hunger INTEGER DEFAULT 1,
  notify_health INTEGER DEFAULT 1,
  notify_poop   INTEGER DEFAULT 1,
  notify_sick   INTEGER DEFAULT 1,
  notify_evolve INTEGER DEFAULT 1,
  notify_dead   INTEGER DEFAULT 1,
  quiet_start   INTEGER DEFAULT 23,
  quiet_end     INTEGER DEFAULT 7,
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 관리자 로그
CREATE TABLE IF NOT EXISTS admin_logs (
  id         SERIAL PRIMARY KEY,
  admin_id   INTEGER NOT NULL,
  action     TEXT NOT NULL,
  target     TEXT,
  detail     TEXT,
  ip         TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 오류 로그
CREATE TABLE IF NOT EXISTS error_logs (
  id         SERIAL PRIMARY KEY,
  level      TEXT NOT NULL,
  message    TEXT NOT NULL,
  stack      TEXT,
  user_id    INTEGER,
  path       TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_users_email    ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role     ON users(role);
CREATE INDEX IF NOT EXISTS idx_chars_user     ON characters(user_id);
CREATE INDEX IF NOT EXISTS idx_txn_user       ON point_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_txn_ref        ON point_transactions(reference_id);
CREATE INDEX IF NOT EXISTS idx_orders_user    ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status  ON orders(status);
CREATE INDEX IF NOT EXISTS idx_payments_user  ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_trades_seller  ON character_trades(seller_id);
CREATE INDEX IF NOT EXISTS idx_error_created  ON error_logs(created_at);
