// ============================================================
// 👑 관리자 계정 생성 스크립트
// scripts/create-admin.js
// ============================================================
// 사용법:
//   npm run create-admin
//   또는
//   node scripts/create-admin.js
// ============================================================

const bcrypt  = require('bcryptjs');
const readline = require('readline');
const path    = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const db = require('../db/db');

const rl = readline.createInterface({
  input:  process.stdin,
  output: process.stdout,
});

function ask(question) {
  return new Promise(resolve => rl.question(question, resolve));
}

async function main() {
  console.log('\n🐣 HatchUp 관리자 계정 생성\n');

  await db.initialize();
  const adapter = db.getAdapter();

  const email    = await ask('관리자 이메일: ');
  const nickname = await ask('관리자 닉네임: ');
  const password = await ask('비밀번호 (8자 이상, 영문+숫자): ');

  if (password.length < 8) {
    console.error('❌ 비밀번호는 8자 이상이어야 합니다.');
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 12);

  try {
    // 이미 존재하면 role만 admin으로 업데이트
    const existing = db.getUserByEmail(email);
    if (existing) {
      adapter.run(
        'UPDATE users SET role = \'admin\', nickname = ? WHERE email = ?',
        [nickname, email.toLowerCase()]
      );
      console.log(`\n✅ 기존 계정을 관리자로 업그레이드했습니다: ${email}`);
    } else {
      const { v4: uuidv4 } = require('uuid');
      const refCode = uuidv4().replace(/-/g,'').substring(0,8).toUpperCase();
      adapter.run(`
        INSERT INTO users
          (email, password_hash, nickname, role, points, referral_code, email_verified)
        VALUES (?, ?, ?, 'admin', 0, ?, 1)
      `, [email.toLowerCase(), hash, nickname, refCode]);
      console.log(`\n✅ 관리자 계정 생성 완료!`);
    }

    console.log(`📧 이메일: ${email}`);
    console.log(`👤 닉네임: ${nickname}`);
    console.log(`🔑 역할:   admin\n`);

  } catch (e) {
    console.error('❌ 오류:', e.message);
    process.exit(1);
  }

  rl.close();
  db.close();
  process.exit(0);
}

main();
