# 💳 HatchUp 결제 테스트 체크리스트
## PAYMENT_TEST_CHECKLIST.md

> 실제 서비스 전 아래 항목을 전부 확인하세요.
> 테스트는 **토스 테스트키** 기준으로 진행합니다.

---

## 사전 준비

- [ ] 토스 개발자 계정 생성: https://developers.tosspayments.com
- [ ] 테스트 API 키 발급 (`test_ck_...`, `test_sk_...`)
- [ ] Railway Variables에 테스트키 입력 완료
- [ ] 서버 정상 실행 확인

---

## 1. 결제 준비 API 테스트

**API:** `POST /api/payment/prepare`

```bash
curl -X POST https://내도메인/api/payment/prepare \
  -H "Authorization: Bearer <로그인토큰>" \
  -H "Content-Type: application/json" \
  -d '{"packageKey": "p100"}'
```

확인 항목:
- [ ] `success: true` 응답
- [ ] `orderId` 생성됨 (`HATCHUP-` 로 시작)
- [ ] `amount: 1000` (서버 기준 금액, 클라이언트 입력 무시)
- [ ] DB `orders` 테이블에 `status: pending` 기록됨

---

## 2. 결제 승인 성공 테스트

**테스트 카드번호:** `4242 4242 4242 4242` (유효기간: 임의, CVC: 임의)

**API:** `POST /api/payment/confirm`

확인 항목:
- [ ] 토스 결제창 정상 오픈
- [ ] 테스트 결제 완료 후 `success: true` 응답
- [ ] 포인트 정상 지급됨
- [ ] DB `orders` 테이블 `status: paid` 변경
- [ ] DB `payments` 테이블에 기록됨
- [ ] DB `point_transactions`에 `type: charge` 기록됨

---

## 3. 금액 위변조 방지 테스트

클라이언트에서 `amount` 값을 조작해서 전송 시:
- [ ] 서버에서 `400` 오류 반환
- [ ] "결제 금액이 올바르지 않습니다" 메시지
- [ ] `error_logs` 테이블에 위변조 감지 기록

---

## 4. 중복 결제 방지 테스트

동일한 `orderId`로 두 번 승인 요청 시:
- [ ] 두 번째 요청에서 `400` 오류 반환
- [ ] "이미 처리된 결제입니다" 메시지
- [ ] 포인트 중복 지급되지 않음

---

## 5. 결제 실패 테스트

토스 테스트 환경에서 실패 카드로 테스트:
- [ ] `POST /api/payment/fail` 호출됨
- [ ] DB `orders` 테이블 `status: failed` 변경
- [ ] 포인트 지급되지 않음

---

## 6. 결제 취소 테스트

결제창에서 사용자가 직접 취소:
- [ ] `USER_CANCEL` 오류 코드 반환
- [ ] DB `orders` 테이블 `status: canceled` 변경

---

## 7. 환불 API 테스트 (관리자 전용)

**API:** `POST /api/payment/refund`

```bash
curl -X POST https://내도메인/api/payment/refund \
  -H "Authorization: Bearer <관리자토큰>" \
  -H "Content-Type: application/json" \
  -d '{"paymentKey": "...", "cancelReason": "테스트 환불"}'
```

확인 항목:
- [ ] 관리자 토큰으로만 접근 가능 (일반 토큰은 `403`)
- [ ] 토스 환불 API 호출됨
- [ ] `orders` 테이블 `status: refunded` 변경
- [ ] `payments` 테이블 `status: refunded` 변경
- [ ] 포인트 회수됨 (`point_transactions`에 `type: refund`)
- [ ] 포인트 부족 시 관리자 확인 상태 기록 + 로그

---

## 8. 중복 환불 방지 테스트

동일 `paymentKey`로 두 번 환불 요청 시:
- [ ] 두 번째 요청에서 `400` 오류 반환
- [ ] "이미 환불 처리된 결제입니다" 메시지

---

## 9. 웹훅 중복 수신 방지 테스트

동일한 웹훅 이벤트가 두 번 수신될 때:
- [ ] `reference_id` UNIQUE 제약으로 중복 포인트 지급 방지
- [ ] 두 번째 처리 시 오류 없이 스킵

---

## 10. 레퍼럴 보상 결제 연동 테스트

추천인 코드로 가입 후 첫 결제 시:
- [ ] 첫 결제 완료 후 추천인에게 100P 지급
- [ ] `referrals` 테이블 `status: paid` 변경
- [ ] 두 번째 결제에서는 추가 지급되지 않음

---

## ✅ 테스트 완료 기준

위 10개 항목 중 **9개 이상 통과** 시 결제 시스템 베타 배포 가능.

---

*HatchUp 결제 테스트 체크리스트 — From Egg To Legend.*
