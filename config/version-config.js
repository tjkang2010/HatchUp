// ============================================================
// 🎮 버전 시스템 설정 - version-config.js
// ============================================================
// 1단계 ~ 5단계 버전별 설정을 한 곳에서 관리합니다.
// 가격, 기간, 캐릭터 이름, 판매가 범위 등
// 이 파일만 수정하면 전체 게임에 자동 반영됩니다.
// ============================================================

const VERSION_CONFIG = {

  // ── 1단계 ────────────────────────────────────────────────
  1: {
    name:        '베이비 버전',
    emoji:       '🥚',
    description: '처음 키우는 HatchUp 펫! 기본 아이템으로 시작',
    growDays:    30,        // 성인까지 걸리는 일수
    priceMultiplier: 1,     // 아이템 가격 배율 (기본가 × 1)
    salePrice: {
      min: 300,             // 최소 판매가 (포인트)
      max: 800,             // 최대 판매가
      recommend: 500,       // 추천 판매가
    },
    stageNames: {           // 각 성장 단계 이름
      egg:   '알',
      baby:  '해치루',
      child: '해치비',
      teen:  '해치나',
      adult: '해치메',
    },
    colors: {               // 캐릭터 색상
      body:  '#ffccaa',
      accent:'#ff9999',
    },
    unlockRequirement: null, // 첫 버전은 조건 없음
  },

  // ── 2단계 ────────────────────────────────────────────────
  2: {
    name:        '주니어 버전',
    emoji:       '🌟',
    description: '1단계 판매 완료 후 해금! 더 비싼 아이템과 높은 판매가',
    growDays:    25,        // 더 빨리 성장 (숙련도 반영)
    priceMultiplier: 2,     // 아이템 가격 × 2배
    salePrice: {
      min: 800,
      max: 2000,
      recommend: 1200,
    },
    stageNames: {
      egg:   '스타알',
      baby:  '스타해치',
      child: '스타비',
      teen:  '스타나',
      adult: '스타메',
    },
    colors: {
      body:  '#aaccff',
      accent:'#5588ff',
    },
    unlockRequirement: {
      type:    'sell',      // 1단계 캐릭터를 판매해야 해금
      version: 1,
      count:   1,           // 최소 1회 판매
    },
  },

  // ── 3단계 ────────────────────────────────────────────────
  3: {
    name:        '시니어 버전',
    emoji:       '💎',
    description: '2단계 판매 완료! 희귀 외형과 높은 가치',
    growDays:    20,
    priceMultiplier: 3,
    salePrice: {
      min: 2000,
      max: 5000,
      recommend: 3000,
    },
    stageNames: {
      egg:   '다이아알',
      baby:  '다이아해치',
      child: '다이아비',
      teen:  '다이아나',
      adult: '다이아메',
    },
    colors: {
      body:  '#aaffcc',
      accent:'#00cc66',
    },
    unlockRequirement: {
      type:    'sell',
      version: 2,
      count:   1,
    },
  },

  // ── 4단계 ────────────────────────────────────────────────
  4: {
    name:        '엘리트 버전',
    emoji:       '👑',
    description: '3단계 판매 완료! 왕관을 쓴 귀한 HatchUp 펫',
    growDays:    15,
    priceMultiplier: 5,
    salePrice: {
      min: 5000,
      max: 10000,
      recommend: 7000,
    },
    stageNames: {
      egg:   '왕관알',
      baby:  '왕해치',
      child: '왕비',
      teen:  '왕나',
      adult: '왕메',
    },
    colors: {
      body:  '#ffaacc',
      accent:'#ff44aa',
    },
    unlockRequirement: {
      type:    'sell',
      version: 3,
      count:   1,
    },
  },

  // ── 5단계 ────────────────────────────────────────────────
  5: {
    name:        '레전드 버전',
    emoji:       '🔥',
    description: '최고 등급! 전설의 HatchUp 펫. 판매 후 1단계로 재시작',
    growDays:    10,        // 최고 숙련도 = 가장 빠른 성장
    priceMultiplier: 10,    // 아이템 가격 × 10배
    salePrice: {
      min: 10000,
      max: 20000,
      recommend: 15000,
    },
    stageNames: {
      egg:   '전설의알',
      baby:  '레전드해치',
      child: '레전드비',
      teen:  '레전드나',
      adult: '레전드메',
    },
    colors: {
      body:  '#ffdd44',
      accent:'#ff6600',
    },
    unlockRequirement: {
      type:    'sell',
      version: 4,
      count:   1,
    },
    // 5단계 판매 후 1단계로 리셋 (prestige 시스템)
    prestige: true,
  },
};

// ============================================================
// 버전 관련 유틸리티 함수들
// ============================================================

// 특정 버전 설정 가져오기
function getVersionConfig(version) {
  return VERSION_CONFIG[version] || VERSION_CONFIG[1];
}

// 아이템 실제 가격 계산 (버전 배율 적용)
function calcItemPrice(basePrice, version) {
  const cfg = getVersionConfig(version);
  return basePrice * cfg.priceMultiplier;
}

// 다음 버전 해금 조건 확인
// ============================================================
// 버전 해금 조건 확인
// adapter: db.getAdapter() 로 받은 객체 (adapter.get() 방식 사용)
// ============================================================
function checkVersionUnlock(userId, targetVersion, adapter) {
  const cfg = getVersionConfig(targetVersion);
  if (!cfg.unlockRequirement) return { unlocked: true };

  const req = cfg.unlockRequirement;

  if (req.type === 'sell') {
    // 이전 버전 캐릭터 판매 기록 확인 (adapter.get 방식)
    const soldRow = adapter.get(`
      SELECT COUNT(*) as cnt
      FROM character_trades ct
      JOIN characters c ON ct.character_id = c.id
      WHERE ct.seller_id = ?
        AND c.version = ?
        AND ct.status = 'sold'
    `, [userId, req.version]);

    const cnt = soldRow?.cnt || 0;

    if (cnt >= req.count) {
      return { unlocked: true };
    }

    return {
      unlocked:  false,
      message:   `${getVersionConfig(req.version).name} 캐릭터를 ${req.count}번 판매해야 해금됩니다.`,
      progress:  `${cnt} / ${req.count}`,
    };
  }

  return { unlocked: true };
}

// 현재 유저의 최고 해금 버전 확인
function getMaxUnlockedVersion(userId, adapter) {
  for (let v = 5; v >= 1; v--) {
    const result = checkVersionUnlock(userId, v, adapter);
    if (result.unlocked) return v;
  }
  return 1;
}

// 버전별 진화 단계 일수 (egg 제외)
function getEvoSchedule(version) {
  const cfg = getVersionConfig(version);
  const days = cfg.growDays;
  return {
    egg:   0,
    baby:  Math.floor(days * 0.1),   // 10%
    child: Math.floor(days * 0.35),  // 35%
    teen:  Math.floor(days * 0.65),  // 65%
    adult: days,                     // 100%
  };
}

module.exports = {
  VERSION_CONFIG,
  getVersionConfig,
  calcItemPrice,
  checkVersionUnlock,
  getMaxUnlockedVersion,
  getEvoSchedule,
};
