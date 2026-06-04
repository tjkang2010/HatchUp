# 🚀 HatchUp Railway 배포 가이드
## DEPLOY_GUIDE.md

> 개발자 없이 혼자 배포할 수 있도록 단계별로 작성했습니다.
> 예상 소요시간: 약 20~30분
>
> **💡 Quick Links:**
> - [배포 준비 상태 확인](DEPLOYMENT_READY.md)
> - [배포 체크리스트](DEPLOYMENT_CHECKLIST.md)
> - [최종 보고서](DEPLOYMENT_FINAL_REPORT.md)
> - [보안 점검](SECURITY_CHECKLIST.md)

---

## 📋 사전 준비물

- [ ] GitHub 계정
- [ ] Railway 계정 (GitHub으로 가입)
- [ ] HatchUp 코드 ZIP 파일

---

## 1단계 — GitHub에 코드 올리기

### 1-1. GitHub 저장소 생성
1. https://github.com 로그인
2. 우측 상단 `+` → **New repository**
3. Repository name: `hatchup`
4. **Private** 선택 (소스코드 비공개)
5. **Create repository** 클릭

### 1-2. 코드 업로드
1. 생성된 페이지에서 **"uploading an existing file"** 클릭
2. `HatchUp-v2.3-RAILWAY-BETA.zip` 압축 해제
3. 압축 해제된 **파일 전체** 드래그앤드롭 업로드
   > ⚠️ `node_modules` 폴더는 올리지 마세요 (`.gitignore`에 포함)
4. **Commit changes** 클릭

---

## 2단계 — Railway 프로젝트 생성

1. https://railway.app 접속
2. **Login with GitHub** 클릭
3. GitHub 연결 허용
4. 대시보드에서 **New Project** 클릭
5. **Deploy from GitHub repo** 선택
6. `hatchup` 저장소 선택
7. 자동 배포 시작 (약 1~3분 대기)

---

## 3단계 — Railway Variables 설정 ⚠️ 가장 중요

Railway 프로젝트 → **Variables** 탭 → **Raw Editor** 클릭 후 아래 입력:

```
NODE_ENV=production
PORT=3000
JWT_SECRET=<아래 방법으로 생성한 키>
JWT_EXPIRES=7d
FRONTEND_URL=https://<내도메인>.up.railway.app
TOSS_CLIENT_KEY=test_ck_여기에_토스_테스트키
TOSS_SECRET_KEY=test_sk_여기에_토스_시크릿키
```

### JWT_SECRET 생성 방법

터미널(또는 Railway Shell)에서 실행:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```
출력된 긴 문자열을 `JWT_SECRET` 값으로 사용.

### ⚠️ DATABASE_URL 절대 입력 금지
현재 버전은 SQLite 전용입니다.  
`DATABASE_URL`을 입력하면 PostgreSQL 모드로 진입하지만,  
현재 코드가 SQLite 기준이라 **서버가 오작동**합니다.

---

## 4단계 — Railway Volume 설정 (데이터 영구 저장)

> ⚠️ 이 설정을 안 하면 서버 재시작 시 DB가 초기화됩니다!

1. Railway 프로젝트 → **Volumes** 탭
2. **Add Volume** 클릭
3. Mount Path: `/app/data` 입력
4. **Add** 클릭

SQLite DB 파일 위치: `/app/data/hatchup.db`

---

## 5단계 — 도메인 생성

1. Railway 프로젝트 → **Settings** 탭
2. **Generate Domain** 클릭
3. 생성된 주소 확인 (예: `https://hatchup-xxxx.up.railway.app`)
4. Railway Variables의 `FRONTEND_URL`을 실제 주소로 업데이트

---

## 6단계 — 관리자 계정 생성

Railway 프로젝트 → **Deploy** 탭 → **Shell** 클릭 후 실행:

```bash
npm run create-admin
```

프롬프트에 따라 입력:
- 관리자 이메일
- 관리자 닉네임
- 비밀번호 (8자 이상, 영문+숫자)

---

## 7단계 — 배포 확인

| URL | 설명 |
|-----|------|
| `https://내도메인.up.railway.app` | 게임 메인 |
| `https://내도메인.up.railway.app/admin` | 관리자 대시보드 |
| `https://내도메인.up.railway.app/payment` | 결제 페이지 |

---

## 8단계 — Smoke Test (선택사항)

Railway Shell에서:
```bash
SMOKE_BASE_URL=https://내도메인.up.railway.app node scripts/smoke-test.js
```

---

## ❓ 문제 발생 시 점검표

### 서버가 시작되지 않을 때
```
Railway → Logs 탭 확인
```
- `JWT_SECRET` 설정됐는지 확인
- `NODE_ENV=production` 설정됐는지 확인

### DB 오류 (`SQLITE_CANTOPEN`)
- Railway Volume이 `/app/data`에 마운트됐는지 확인
- Volume 추가 후 **재배포** 필요

### `better-sqlite3` 빌드 오류
- Railway는 Node 20 + gcc 환경 자동 제공
- `package.json`의 `engines.node`가 `"20.x"`인지 확인

### 결제가 안 될 때
- 토스 테스트키 입력됐는지 확인
- `TOSS_CLIENT_KEY`가 `test_ck_`로 시작하는지 확인

### 관리자 로그인이 안 될 때
- `npm run create-admin` 실행됐는지 확인
- `JWT_SECRET`이 코드 배포 후 변경되지 않았는지 확인

---

## 📞 지원

문제 발생 시 Railway Logs 내용을 복사해서 문의해주세요.

---

*HatchUp v2.3 — From Egg To Legend.*
