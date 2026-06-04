// ============================================================
// 🧪 HatchUp Smoke Test
// scripts/smoke-test.js
// ============================================================
// 서버가 실제로 켜진 후 핵심 API가 동작하는지 확인합니다.
//
// 사용법:
//   node scripts/smoke-test.js
//   또는
//   SMOKE_BASE_URL=https://내도메인.up.railway.app node scripts/smoke-test.js
//
// 성공 기준: 주요 API가 예상된 HTTP 상태코드를 반환하면 통과
// ============================================================

const http  = require('http');
const https = require('https');

// 테스트 대상 서버 주소
const BASE_URL = process.env.SMOKE_BASE_URL || 'http://localhost:3000';
const isHttps  = BASE_URL.startsWith('https');

// ── HTTP 요청 헬퍼 ──────────────────────────────────────────
function request(method, path, body, token) {
  return new Promise((resolve) => {
    const url   = new URL(BASE_URL + path);
    const agent = isHttps ? https : http;

    const opts = {
      hostname: url.hostname,
      port:     url.port || (isHttps ? 443 : 80),
      path:     url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token && { 'Authorization': 'Bearer ' + token }),
      },
      timeout: 8000,
    };

    const req = agent.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', (e) => resolve({ status: 0, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: 'timeout' }); });

    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ── 테스트 러너 ──────────────────────────────────────────────
const results = [];

async function test(name, fn) {
  try {
    const { pass, detail } = await fn();
    const icon = pass ? '✅' : '❌';
    console.log(`  ${icon} ${name}${detail ? '  →  ' + detail : ''}`);
    results.push({ name, pass, detail });
  } catch (e) {
    console.log(`  ❌ ${name}  →  예외: ${e.message}`);
    results.push({ name, pass: false, detail: e.message });
  }
}

// ── 테스트 실행 ──────────────────────────────────────────────
async function runSmokeTest() {
  console.log(`\n🧪 HatchUp Smoke Test`);
  console.log(`   대상: ${BASE_URL}`);
  console.log(`   시작: ${new Date().toLocaleString('ko-KR')}\n`);

  // ── [A] 서버 Health 확인 ──────────────────────────────────
  console.log('[ A. 서버 Health ]');

  await test('GET / — 서버 응답', async () => {
    const r = await request('GET', '/');
    return {
      pass:   r.status === 200,
      detail: `HTTP ${r.status}`,
    };
  });

  await test('GET /api/없는경로 — 404 반환', async () => {
    const r = await request('GET', '/api/nonexistent');
    return {
      pass:   r.status === 404,
      detail: `HTTP ${r.status}`,
    };
  });

  // ── [B] 인증 없이 접근 시 401 확인 ──────────────────────────
  console.log('\n[ B. 인증 보호 확인 ]');

  await test('GET /api/game/status — 토큰 없이 401', async () => {
    const r = await request('GET', '/api/game/status');
    return {
      pass:   r.status === 401,
      detail: `HTTP ${r.status} / ${r.body?.message || ''}`,
    };
  });

  await test('GET /api/user/profile — 토큰 없이 401', async () => {
    const r = await request('GET', '/api/user/profile');
    return {
      pass:   r.status === 401,
      detail: `HTTP ${r.status}`,
    };
  });

  await test('GET /api/admin/stats — 토큰 없이 401', async () => {
    const r = await request('GET', '/api/admin/stats');
    return {
      pass:   r.status === 401,
      detail: `HTTP ${r.status}`,
    };
  });

  // ── [C] 회원가입 테스트 ─────────────────────────────────────
  console.log('\n[ C. 회원가입 / 로그인 ]');

  const testEmail = `smoketest_${Date.now()}@hatchup-test.com`;
  const testPw    = 'Test1234!';
  let   authToken = null;
  let   adminToken = null;

  await test('POST /api/auth/register — 회원가입', async () => {
    const r = await request('POST', '/api/auth/register', {
      email:    testEmail,
      password: testPw,
      nickname: `테스터${Date.now() % 10000}`,
    });
    if (r.body?.token) authToken = r.body.token;
    return {
      pass:   r.status === 201 && !!r.body?.token,
      detail: `HTTP ${r.status} / 토큰: ${r.body?.token ? '발급됨' : '없음'}`,
    };
  });

  await test('POST /api/auth/login — 로그인', async () => {
    const r = await request('POST', '/api/auth/login', {
      email:    testEmail,
      password: testPw,
    });
    if (r.body?.token) authToken = r.body.token;
    return {
      pass:   r.status === 200 && !!r.body?.token,
      detail: `HTTP ${r.status} / role: ${r.body?.user?.role || '-'}`,
    };
  });

  await test('POST /api/auth/login — 잘못된 비밀번호 401', async () => {
    const r = await request('POST', '/api/auth/login', {
      email:    testEmail,
      password: 'wrongpassword',
    });
    return {
      pass:   r.status === 401,
      detail: `HTTP ${r.status}`,
    };
  });

  // ── [D] 인증 후 게임 API 테스트 ────────────────────────────
  console.log('\n[ D. 게임 API (로그인 후) ]');

  await test('GET /api/game/status — 캐릭터 상태 조회', async () => {
    if (!authToken) return { pass: false, detail: '토큰 없음 (로그인 실패)' };
    const r = await request('GET', '/api/game/status', null, authToken);
    return {
      pass:   r.status === 200 && r.body?.success === true,
      detail: `HTTP ${r.status} / success: ${r.body?.success}`,
    };
  });

  await test('GET /api/shop/items — 상점 목록 조회', async () => {
    if (!authToken) return { pass: false, detail: '토큰 없음' };
    const r = await request('GET', '/api/shop/items', null, authToken);
    return {
      pass:   r.status === 200 && Array.isArray(r.body?.items),
      detail: `HTTP ${r.status} / 아이템 수: ${r.body?.items?.length || 0}`,
    };
  });

  await test('GET /api/version/status — 버전 현황 조회', async () => {
    if (!authToken) return { pass: false, detail: '토큰 없음' };
    const r = await request('GET', '/api/version/status', null, authToken);
    return {
      pass:   r.status === 200 && Array.isArray(r.body?.versions),
      detail: `HTTP ${r.status} / 버전 수: ${r.body?.versions?.length || 0}`,
    };
  });

  await test('GET /api/payment/packages — 결제 패키지 조회', async () => {
    if (!authToken) return { pass: false, detail: '토큰 없음' };
    const r = await request('GET', '/api/payment/packages', null, authToken);
    return {
      pass:   r.status === 200 && Array.isArray(r.body?.packages),
      detail: `HTTP ${r.status} / 패키지 수: ${r.body?.packages?.length || 0}`,
    };
  });

  // ── [E] 관리자 권한 확인 ────────────────────────────────────
  console.log('\n[ E. 관리자 권한 보호 ]');

  await test('GET /api/admin/stats — 일반 토큰으로 403', async () => {
    if (!authToken) return { pass: false, detail: '토큰 없음' };
    const r = await request('GET', '/api/admin/stats', null, authToken);
    return {
      pass:   r.status === 403,
      detail: `HTTP ${r.status} (일반 유저 차단: ${r.status === 403 ? '✅' : '❌'})`,
    };
  });

  await test('POST /api/payment/refund — 일반 토큰으로 403', async () => {
    if (!authToken) return { pass: false, detail: '토큰 없음' };
    const r = await request('POST', '/api/payment/refund',
      { paymentKey: 'test', cancelReason: 'test' }, authToken);
    return {
      pass:   r.status === 403,
      detail: `HTTP ${r.status}`,
    };
  });

  // ── [F] 입력값 검증 ─────────────────────────────────────────
  console.log('\n[ F. 입력값 검증 ]');

  await test('POST /api/auth/register — 짧은 비밀번호 400', async () => {
    const r = await request('POST', '/api/auth/register', {
      email: `short_${Date.now()}@test.com`,
      password: '123',
      nickname: '테스터2',
    });
    return {
      pass:   r.status === 400,
      detail: `HTTP ${r.status}`,
    };
  });

  await test('POST /api/auth/register — 잘못된 이메일 400', async () => {
    const r = await request('POST', '/api/auth/register', {
      email: 'not-an-email',
      password: 'Test1234!',
      nickname: '테스터3',
    });
    return {
      pass:   r.status === 400,
      detail: `HTTP ${r.status}`,
    };
  });

  // ── 결과 요약 ─────────────────────────────────────────────
  const pass  = results.filter(r => r.pass).length;
  const fail  = results.filter(r => !r.pass).length;
  const total = results.length;
  const pct   = Math.round((pass / total) * 100);

  console.log('\n══════════════════════════════════════');
  console.log(`  대상:   ${BASE_URL}`);
  console.log(`  결과:   ✅ ${pass}개 통과 / ❌ ${fail}개 실패`);
  console.log(`  총합:   ${total}개 테스트 (통과율 ${pct}%)`);

  if (fail > 0) {
    console.log('\n  실패 항목:');
    results.filter(r => !r.pass).forEach(r =>
      console.log(`    ✗ ${r.name}${r.detail ? ' → ' + r.detail : ''}`)
    );
  }

  if (pct >= 90) {
    console.log('\n  🎉 Smoke Test 통과! 배포 준비 완료.');
  } else if (pct >= 70) {
    console.log('\n  ⚠️  일부 실패 항목 있음. 확인 후 배포 권장.');
  } else {
    console.log('\n  ❌ 다수 실패. 서버 상태 점검 필요.');
  }
  console.log('══════════════════════════════════════\n');

  process.exit(fail > 0 ? 1 : 0);
}

runSmokeTest().catch(e => {
  console.error('Smoke test 실행 오류:', e.message);
  process.exit(1);
});
