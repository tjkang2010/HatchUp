# 🚀 HatchUp 배포 완료 체크리스트
## DEPLOYMENT_CHECKLIST.md

배포 작업을 단계별로 완료하고 각 항목을 확인하세요.

---

## 📋 사전 준비 단계

### GitHub 저장소 설정
- [ ] GitHub 계정 생성 완료
- [ ] 새 저장소 `hatchup` 생성 (Private)
- [ ] 모든 소스코드 업로드 완료
- [ ] `.gitignore` 설정 확인 (node_modules, .env, *.db 제외)
- [ ] 최초 commit 완료

### 필수 파일 확인
- [x] `Dockerfile` 생성 완료
- [x] `railway.json` 생성 완료
- [x] `.dockerignore` 생성 완료
- [x] `package.json` 검증 완료 (Node 20 지정)
- [x] `.env.example` 작성 완료

---

## 🔧 배포 전 설정

### Railway 프로젝트 생성
- [ ] Railway 계정 생성 완료 (GitHub 로그인)
- [ ] 새 프로젝트 생성 완료
- [ ] GitHub 저장소 연결 완료

### 환경변수 설정 (Railway Variables)
- [ ] `NODE_ENV=production` 설정
- [ ] `PORT=3000` 설정
- [ ] `JWT_SECRET` 설정 (64자 이상 랜덤 문자열)
  ```bash
  # 생성 명령어
  node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
  ```
- [ ] `JWT_EXPIRES=7d` 설정
- [ ] `FRONTEND_URL` 설정 (임시: `https://hatchup-xxx.up.railway.app`)
- [ ] `TOSS_CLIENT_KEY` 설정 (test_ck_로 시작)
- [ ] `TOSS_SECRET_KEY` 설정 (test_sk_로 시작)
- [ ] `TOSS_WEBHOOK_SECRET` 설정
- [ ] `VAPID_PUBLIC_KEY` 설정 (Optional - 푸시 알림 필요 시)
  ```bash
  npm run gen-vapid
  ```
- [ ] `VAPID_PRIVATE_KEY` 설정 (Optional - 푸시 알림 필요 시)
- [ ] `VAPID_EMAIL` 설정 (기본값: `mailto:admin@hatchup.app`)
- [ ] `PUSH_INTERVAL_MS=600000` 설정
- [ ] **❌ DATABASE_URL 입력하지 말 것** (SQLite 전용)

### 볼륨(데이터 저장소) 설정
- [ ] Railway → Volumes 탭 접속
- [ ] **Add Volume** 클릭
- [ ] Mount Path: `/app/data` 입력
- [ ] Add 클릭
- [ ] ⚠️ 볼륨 추가 후 **Deploy** 탭에서 재배포 실행

---

## 🚀 배포 실행

### 자동 배포
- [ ] Railway 자동 배포 완료 (1~3분 대기)
- [ ] Railway Logs 확인 (에러 없음)
- [ ] 배포 상태: `Running` 확인

### 도메인 생성
- [ ] Railway → Settings 탭 접속
- [ ] **Generate Domain** 클릭
- [ ] 도메인 주소 확인 (예: `https://hatchup-abc123.up.railway.app`)
- [ ] Railway Variables의 `FRONTEND_URL` 업데이트
- [ ] 재배포 실행

---

## 👤 관리자 계정 생성

- [ ] Railway → Deploy 탭 → Shell 클릭
- [ ] 다음 명령어 실행:
  ```bash
  npm run create-admin
  ```
- [ ] 프롬프트에 따라 입력:
  - 관리자 이메일
  - 관리자 닉네임
  - 비밀번호 (8자 이상, 영문+숫자)
- [ ] 계정 생성 완료 메시지 확인

---

## 🧪 배포 확인

### 서비스 헬스 체크
- [ ] 메인 페이지 로드 확인: `https://도메인.up.railway.app`
- [ ] 관리자 대시보드 접근: `https://도메인.up.railway.app/admin`
- [ ] 관리자 로그인 성공 확인

### API 테스트 (Smoke Test)
- [ ] Railway Shell에서 실행:
  ```bash
  SMOKE_BASE_URL=https://도메인.up.railway.app npm run smoke-test
  ```
- [ ] 모든 API 테스트 통과

### 결제 테스트 (Optional)
- [ ] 결제 페이지 로드: `https://도메인.up.railway.app/payment`
- [ ] 토스페이먼츠 테스트 결제 실행
- [ ] 포인트 지급 확인
- [ ] 주문 생성 확인

### 푸시 알림 테스트 (Optional)
- [ ] 푸시 알림 체크 스케줄러 시작 확인
- [ ] 로그에서 스케줄러 메시지 확인

---

## 🔒 보안 확인

- [ ] JWT_SECRET이 안전한 값으로 설정됨
- [ ] .env 파일이 `.gitignore`에 포함됨
- [ ] NODE_ENV=production 설정됨
- [ ] 토스페이먼츠 테스트키 사용 확인 (라이브키 사용 금지)
- [ ] 민감 정보(카드번호, 비밀번호)가 로그에 출력 안 됨
- [ ] Rate Limiting 활성화 확인

---

## 📊 모니터링 설정 (Optional)

- [ ] Railway Logs 자주 확인
- [ ] 에러 발생 시 Slack/이메일 알림 설정
- [ ] 월간 비용 예상액 확인
- [ ] Railway Usage Dashboard 정기 점검

---

## ⚠️ 배포 후 필수 작업

### 법적 준비
- [ ] 개인정보처리방침 페이지 추가
- [ ] 서비스 이용약관 페이지 추가
- [ ] 포인트 현금 환전 불가 고지
- [ ] 미성년자 결제 제한 안내

### 운영 준비
- [ ] 사업자등록 완료
- [ ] 통신판매업 신고 완료
- [ ] 토스페이먼츠 라이브키 신청 (사업자 심사 필요)

### 배포 이후
- [ ] 운영 계정 암호 안전 보관
- [ ] 백업 전략 수립
- [ ] 모니터링 계획 수립

---

## 🆘 문제 발생 시

### 서버 미시작
```
Railway → Logs 탭 확인
- JWT_SECRET 설정 여부 확인
- NODE_ENV=production 설정 여부 확인
```

### 데이터베이스 오류 (SQLITE_CANTOPEN)
```
- Railway Volume이 /app/data에 마운트되었는지 확인
- Volume 추가 후 Deploy 탭에서 재배포 실행
```

### 관리자 로그인 실패
```
- npm run create-admin 재실행
- JWT_SECRET이 코드 배포 후 변경되지 않았는지 확인
```

### 결제 안 될 때
```
- 토스 테스트키 입력 확인
- TOSS_CLIENT_KEY가 test_ck_로 시작하는지 확인
- TOSS_SECRET_KEY가 test_sk_로 시작하는지 확인
```

---

## ✅ 배포 완료 확인

모든 항목에 체크(✓)가 완료되면 **배포 완료**입니다! 🎉

마지막으로:
- [ ] 배포 일시 기록
- [ ] 배포 버전 (v2.4) 기록
- [ ] 관리자 연락처 확인

---

*HatchUp v2.4 — From Egg To Legend. 배포 완료!*
