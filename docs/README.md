# 🐣 HatchUp

> **From Egg To Legend.**

가상 생명체를 키우고, 성장시키고, 거래하는 웹 게임 서비스입니다.

> ⚠️ **현재 버전은 비공개 베타용입니다.**
> 실제 유료 상업 서비스 전에는 토스 라이브키, 약관, 개인정보처리방침,
> 사업자 정보, 통신판매업 신고 확인이 필요합니다.

---

## 🚀 빠른 시작

```bash
# 1. 의존성 설치
npm install

# 2. 환경변수 설정
cp .env.example .env
# .env 파일을 열어서 값 입력 (JWT_SECRET 필수)

# 3. 관리자 계정 생성
npm run create-admin

# 4. 서버 시작
npm start       # 운영
npm run dev     # 개발 (자동 재시작)

# 5. Smoke Test (서버 켠 후)
npm run smoke-test
```

서버 시작 후: http://localhost:3000

---

## 💾 현재 DB 운영 구조

```
현재 운영: SQLite (better-sqlite3)
Node 버전: 20.x (고정)
배포 환경: Railway + Volume 마운트
```

> **⚠️ DATABASE_URL을 Railway Variables에 입력하지 마세요.**
> 현재 버전은 SQLite 전용입니다. DATABASE_URL을 입력하면
> PostgreSQL 모드로 진입하지만, 현재 라우터는 SQLite 동기 구조 기준이므로
> 별도 리팩토링 전에는 사용하지 않습니다.

> **PostgreSQL 전환이 필요한 시점:**
> 동시 접속 500명+ 또는 결제/거래 트래픽 급증 시.
> 전환 시 라우터 전체 async/await 리팩토링 필요.
> `docs/schema.sql`에 PostgreSQL 스키마 초안 포함.

---

## 📁 폴더 구조

```
hatchup/
├── server.js             ← 서버 진입점
├── scheduler.js          ← 푸시 알림 스케줄러
├── config/               ← 앱/버전 설정
├── db/db.js              ← SQLite DB 레이어
├── routes/               ← API 8개 (auth/game/shop/payment/push/version/user/admin)
├── middleware/            ← JWT 인증, 오류처리
├── utils/logger.js       ← 날짜별 로그
├── scripts/
│   ├── create-admin.js   ← 관리자 계정 CLI
│   └── smoke-test.js     ← 배포 후 API 테스트
├── public/sw.js          ← 서비스워커 (PWA)
└── docs/
    ├── DEPLOY_GUIDE.md          ← Railway 배포 가이드
    ├── PAYMENT_TEST_CHECKLIST.md ← 결제 테스트 체크리스트
    ├── SECURITY_CHECKLIST.md    ← 보안 점검표
    ├── TERMS_DRAFT.md           ← 이용약관 초안
    ├── PRIVACY_DRAFT.md         ← 개인정보처리방침 초안
    ├── schema.sql               ← PostgreSQL 참고 스키마
    └── WORK_REPORT.md           ← 작업 보고서
```

---

## ⚙️ 환경변수 (필수)

| 키 | 설명 | 필수 |
|----|------|------|
| `JWT_SECRET` | 64자 이상 랜덤 문자열 | ✅ |
| `NODE_ENV` | `production` | ✅ |
| `FRONTEND_URL` | 배포된 도메인 주소 | ✅ |
| `TOSS_CLIENT_KEY` | 토스 클라이언트 키 | 결제 시 |
| `TOSS_SECRET_KEY` | 토스 시크릿 키 | 결제 시 |
| `VAPID_PUBLIC_KEY` | 푸시 알림 공개키 | 알림 시 |
| `VAPID_PRIVATE_KEY` | 푸시 알림 비밀키 | 알림 시 |

**JWT_SECRET 생성:**
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

---

## 🚀 Railway 배포

`docs/DEPLOY_GUIDE.md` 참고 — 단계별 초보자 가이드 포함.

---

## 🧪 Smoke Test

배포 후 API 동작 확인:
```bash
SMOKE_BASE_URL=https://내도메인.up.railway.app npm run smoke-test
```

---

## ⚠️ 법적 고지

- HatchPoint는 현금으로 환전되지 않는 **게임 전용 가상 재화**입니다.
- 투자 상품이 아니며 수익을 보장하지 않습니다.
- 상업 서비스 운영 전 **사업자 등록 및 통신판매업 신고**가 필요합니다.

---

*HatchUp v2.3 — From Egg To Legend.*
