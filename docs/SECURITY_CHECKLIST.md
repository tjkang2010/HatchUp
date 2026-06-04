# 🔒 HatchUp 보안 점검 체크리스트
## SECURITY_CHECKLIST.md

배포 전 반드시 모든 항목을 확인하세요.

---

## ✅ 인증 / 계정 보안

- [ ] JWT_SECRET 환경변수 64자 이상 랜덤 문자열로 설정
- [ ] JWT 만료시간 설정 (기본 7일)
- [ ] 비밀번호 bcrypt 해시 저장 (saltRounds=12)
- [ ] 비밀번호 최소 8자, 영문+숫자 조합 검증
- [ ] 로그인 실패 rate limit 적용 (15분에 15회)
- [ ] 계정 정지 시 JWT 즉시 무효화 (DB 조회로 실시간 확인)
- [ ] role 기반 권한 분리 (user / admin)
- [ ] 관리자 계정 생성은 CLI 스크립트로만 가능

## ✅ API 보안

- [ ] 전체 API rate limit 적용 (15분 200회)
- [ ] 결제 API 별도 rate limit (5분 10회)
- [ ] CORS 허용 도메인 설정 (와일드카드 * 금지)
- [ ] Helmet.js 보안 헤더 적용
- [ ] 모든 입력값 서버사이드 검증
- [ ] SQL Injection 방지 (Prepared Statement 사용)
- [ ] XSS 방어 (helmet CSP 적용)

## ✅ 포인트 / 결제 보안

- [ ] users.points 직접 수정 금지 (changePoints() 함수만 사용)
- [ ] 모든 포인트 변경 point_transactions 기록
- [ ] reference_id UNIQUE 제약으로 중복 지급 방지
- [ ] 결제 금액 서버에서 검증 (클라이언트 금액 무시)
- [ ] 결제 중복 처리 방지 (order_id 기준)
- [ ] 웹훅 서명 검증 (TOSS_WEBHOOK_SECRET)
- [ ] 환불 시 포인트 회수 처리

## ✅ 레퍼럴 어뷰징 방지

- [ ] 가입 IP 기록
- [ ] 같은 IP 최대 3계정 제한
- [ ] 추천인과 피추천인 동일 IP 시 레퍼럴 무효
- [ ] 레퍼럴 보상은 첫 결제 완료 후 지급

## ✅ 데이터 보안

- [ ] .env 파일 Git 커밋 금지 (.gitignore 확인)
- [ ] Railway 환경변수 설정 (하드코딩 금지)
- [ ] DB 파일 Railway Volume 백업 설정
- [ ] 민감 데이터 로그 출력 금지 (비밀번호, 카드번호 등)

## ✅ 배포 보안

- [ ] NODE_ENV=production 설정
- [ ] HTTPS 강제 (Railway 자동 적용)
- [ ] 에러 메시지 상세 정보 production에서 숨김
- [ ] 사용하지 않는 포트 닫기

## 🚨 출시 전 필수 확인

- [ ] 개인정보처리방침 게시
- [ ] 서비스 이용약관 게시
- [ ] 포인트 현금 환전 불가 고지
- [ ] 미성년자 결제 제한 안내
- [ ] 사업자등록 완료
- [ ] 통신판매업 신고 완료

---
*마지막 업데이트: 배포 전 확인 필수*
