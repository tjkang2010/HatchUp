# 🚀 HatchUp 배포 준비 가이드
## DEPLOYMENT_READY.md

이 문서는 **배포 전 마지막 체크**를 위한 가이드입니다.  
자세한 배포 과정은 `docs/DEPLOY_GUIDE.md`를 참조하세요.

---

## ⚡ 빠른 배포 순서

### Step 1: GitHub 준비 (5분)
```bash
# 1. GitHub에 hatchup 저장소 생성 (Private)
# 2. 로컬에서 Git 초기화
git init
git add .
git commit -m "Initial commit: HatchUp v2.4 Railway deployment ready"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/hatchup.git
git push -u origin main
```

### Step 2: Railway 배포 (10분)
```
1. https://railway.app 접속
2. GitHub 계정으로 로그인
3. New Project → Deploy from GitHub
4. 'hatchup' 저장소 선택
5. 자동 배포 시작 (약 2~3분)
```

### Step 3: 환경변수 설정 (3분)
Railway 프로젝트 → Variables 탭:

```
NODE_ENV=production
PORT=3000
JWT_SECRET=<생성 명령어로 만든 64자 문자열>
JWT_EXPIRES=7d
FRONTEND_URL=<생성된 도메인>
TOSS_CLIENT_KEY=test_ck_XXXXX
TOSS_SECRET_KEY=test_sk_XXXXX
TOSS_WEBHOOK_SECRET=<웹훅 시크릿>
VAPID_PUBLIC_KEY=<선택사항>
VAPID_PRIVATE_KEY=<선택사항>
VAPID_EMAIL=mailto:admin@hatchup.app
PUSH_INTERVAL_MS=600000
```

### Step 4: 볼륨 설정 (2분)
Railway 프로젝트 → Volumes 탭:
- Add Volume
- Mount Path: `/app/data`
- **Volume 추가 후 Deploy 탭에서 재배포**

### Step 5: 도메인 생성 (1분)
Railway 프로젝트 → Settings 탭:
- Generate Domain 클릭
- 생성된 도메인으로 FRONTEND_URL 업데이트
- **재배포 실행**

### Step 6: 관리자 계정 생성 (2분)
Railway Deploy 탭 → Shell:
```bash
npm run create-admin
```

### Step 7: 배포 확인 (5분)
```bash
# 메인 페이지
https://YOUR_DOMAIN.up.railway.app

# 관리자 대시보드  
https://YOUR_DOMAIN.up.railway.app/admin

# Smoke Test 실행
SMOKE_BASE_URL=https://YOUR_DOMAIN.up.railway.app npm run smoke-test
```

---

## 🔧 기술 사양

| 항목 | 값 |
|------|-----|
| **Runtime** | Node.js 20.x |
| **Database** | SQLite (better-sqlite3) |
| **Hosting** | Railway |
| **Web Framework** | Express.js |
| **Authentication** | JWT |
| **Payment** | 토스페이먼츠 |
| **Notifications** | Web Push |
| **Deployment** | Docker + Dockerfile |

---

## ⚠️ 중요 주의사항

### ❌ 절대 금지 사항
1. **DATABASE_URL 설정하지 말 것** (SQLite 전용 → PostgreSQL 자동 전환 방지)
2. **.env 파일을 GitHub에 커밋하지 말 것** (.gitignore 확인)
3. **토스 라이브키로 테스트하지 말 것** (테스트 키 사용: test_ck_, test_sk_)
4. **관리자 계정을 Web UI로 만들지 말 것** (CLI 스크립트만 사용)
5. **JWT_SECRET을 평문으로 저장하지 말 것** (Railway Variables에만 저장)

### ✅ 반드시 확인할 것
1. `.env` 파일은 `.gitignore`에 포함됨
2. `package.json`에서 Node 버전이 `"20.x"`로 설정됨
3. 모든 필수 환경변수 설정됨
4. Railway Volume이 `/app/data`에 마운트됨
5. Dockerfile 및 railway.json 존재 확인

---

## 📊 배포 후 운영

### 모니터링
- Railway Dashboard에서 실시간 로그 확인
- 월간 비용 및 리소스 사용량 모니터링
- 에러 발생 시 즉시 알림 설정

### 백업
- SQLite DB 파일: `/app/data/hatchup.db`
- Railway Volume은 자동 백업됨
- 정기적으로 DB 스냅샷 저장 권장

### 업데이트
```bash
# 로컬에서 코드 수정 후
git commit -am "Fix: description"
git push origin main

# Railway는 자동 배포 (약 2~3분)
# 로그에서 배포 상태 확인
```

---

## 🆘 트러블슈팅

### Q: 서버가 시작되지 않아요
A: Railway Logs 확인 → `JWT_SECRET` 설정 여부 확인

### Q: 관리자 로그인이 안 돼요
A: `npm run create-admin` 재실행 후 다시 시도

### Q: DB가 계속 초기화돼요
A: Railway Volume 설정 확인 → Volume 추가 후 재배포

### Q: 결제가 안 돼요
A: 토스 테스트키 확인 (test_ck_, test_sk_ 시작 여부)

자세한 내용은 `docs/DEPLOY_GUIDE.md` 참조.

---

## 📝 배포 기록

| 항목 | 값 |
|------|-----|
| **배포 날짜** | YYYY-MM-DD |
| **배포 버전** | v2.4 |
| **배포 도메인** | https://hatchup-xxx.up.railway.app |
| **관리자 이메일** | admin@example.com |
| **배포 담당자** | Your Name |

---

*마지막 업데이트: 2026-06-04*  
*HatchUp v2.4 — From Egg To Legend. 배포 준비 완료!* 🚀
