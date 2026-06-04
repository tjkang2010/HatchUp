// ============================================================
// 🐣 HatchUp - 앱 전역 설정
// app-config.js
// ============================================================
// 브랜드명, 슬로건, 포인트 정책 등
// 이 파일 하나만 수정하면 전체 앱에 반영됩니다.
// ============================================================

const APP = {
  // 브랜드
  name:        'HatchUp',
  slogan:      'From Egg To Legend.',
  description: '키우고, 성장시키고, 거래하세요.',
  version:     '1.0.0',

  // 포인트 정책 (법적 고지 포함)
  points: {
    currency:        'HatchPoint',   // 포인트 단위명
    signupBonus:     100,            // 가입 보너스
    referralBonus:   100,            // 추천인 보너스
    // ⚠️ 포인트는 현금 환전 불가 / 게임 내 전용 재화
    cashConvertible: false,
    investmentProduct: false,
  },

  // 레퍼럴 정책
  referral: {
    // 첫 결제 완료 후 지급 (어뷰징 방지)
    payOnFirstPurchase: true,
    // 같은 IP 최대 가입 허용 수
    maxAccountsPerIP: 3,
    // IP 기록 보관 기간 (일)
    ipLogRetentionDays: 90,
  },

  // JWT 설정
  jwt: {
    expiresIn: '7d',
  },

  // 게임 정책
  game: {
    // 서버 시간 기준 (클라이언트 시간 신뢰 금지)
    serverTimeOnly: true,
    // 캐릭터 판매 후 재판매 금지
    noResale: true,
  },
};

module.exports = APP;
