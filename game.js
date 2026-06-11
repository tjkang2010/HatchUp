// ============================================================
// 🎮 게임 API - game.js (v3.1 — 쿨다운 필드 분리)
// ============================================================
// 쿨다운 필드 분리:
//   feed  → last_fed_at    (30초)
//   play  → last_played_at (60초)
//   clean → last_cleaned_at(120초)
// ============================================================
const express = require('express');
const db      = require('../db/db');
const auth    = require('../middleware/auth');
const logger  = require('../utils/logger');

const router = express.Router();
router.use(auth.required);

const EXP_TABLE = { feed:5, play:10, clean:3, medicine:2 };

// 쿨다운 체크 헬퍼
function checkCooldown(lastAt, cooldownSec) {
  if (!lastAt) return { ok: true, remaining: 0 };
  const elapsed   = (Date.now() - new Date(lastAt).getTime()) / 1000;
  const remaining = Math.ceil(cooldownSec - elapsed);
  return { ok: elapsed >= cooldownSec, remaining: Math.max(0, remaining) };
}

// 시간 경과 자동 상태 변화
function applyTimeDecay(character) {
  const now         = new Date();
  const lastUpdate  = new Date(character.last_update);
  const elapsedMs   = now - lastUpdate;
  const elapsedMins = elapsedMs / (1000 * 60);
  if (elapsedMins < 1) return character;

  const rates = {
    egg:   { hungerRate:0,   happyRate:0   },
    baby:  { hungerRate:0.5, happyRate:0.3 },
    child: { hungerRate:0.6, happyRate:0.4 },
    teen:  { hungerRate:0.7, happyRate:0.5 },
    adult: { hungerRate:0.8, happyRate:0.5 },
  };
  const rate = rates[character.stage] || rates.baby;

  let hunger     = character.hunger;
  let happy      = character.happy;
  let health     = character.health;
  let poop_count = character.poop_count;
  let is_sick    = character.is_sick;

  if (!character.is_sleeping) {
    hunger = Math.max(0, hunger - (rate.hungerRate * elapsedMins));
    happy  = Math.max(0, happy  - (rate.happyRate  * elapsedMins));
  }
  if (character.stage !== 'egg') {
    poop_count = Math.min(5, poop_count + Math.floor(elapsedMins / 120));
  }
  if (hunger < 20 || poop_count >= 3) health = Math.max(0, health - (0.3 * elapsedMins));
  if (poop_count >= 4 && !is_sick) is_sick = 1;

  const age_days    = character.age_days + Math.floor(elapsedMins / (24 * 60));
  let   is_dead     = character.is_dead;
  let   stage       = character.stage;
  let   matured_at  = character.matured_at;

  if (health <= 0 && !is_dead) { is_dead = 1; stage = 'dead'; }
  if (stage === 'adult' && !matured_at) matured_at = now.toISOString();

  const stageOrder   = ['egg','baby','child','teen','adult'];
  const curIdx       = stageOrder.indexOf(stage);
  const daysToEvolve = [0.2, 7, 14, 25];
  if (curIdx >= 0 && curIdx < stageOrder.length-1 && !is_dead
      && age_days >= daysToEvolve[curIdx] && health > 30) {
    stage = stageOrder[curIdx + 1];
  }

  const updates = {
    hunger: Math.round(hunger), happy: Math.round(happy),
    health: Math.round(health), poop_count, is_sick, is_dead, stage,
    age_days, matured_at, last_update: now.toISOString(),
  };
  if (is_dead && !character.died_at) updates.died_at = now.toISOString();

  db.updateCharacter(character.id, updates);
  return { ...character, ...updates };
}

// ── 캐릭터 상태 조회 ─────────────────────────────────────
router.get('/status', (req, res) => {
  try {
    const adapter = db.getAdapter();
    const userId  = req.user.userId;
    const user    = db.getUserById(userId);

    let character = adapter.get(
      'SELECT * FROM characters WHERE user_id=? AND is_dead=0 ORDER BY id DESC LIMIT 1',
      [userId]
    );
    if (!character) return res.json({ success:true, character:null, message:'키우는 캐릭터가 없습니다.' });

    character = applyTimeDecay(character);
    const offlineReward = db.calcOfflineReward(userId, character.id, !!user.is_premium);

    const daysAlive = Math.floor((new Date() - new Date(character.born_at)) / (1000*60*60*24));
    const inventory = adapter.all('SELECT item_type, quantity FROM inventory WHERE user_id=?', [userId]);
    const invMap    = {};
    inventory.forEach(i => { invMap[i.item_type] = i.quantity; });

    // 각 행동별 남은 쿨다운 시간 제공
    const cooldowns = {
      feed:  checkCooldown(character.last_fed_at,     30).remaining,
      play:  checkCooldown(character.last_played_at,  60).remaining,
      clean: checkCooldown(character.last_cleaned_at,120).remaining,
    };

    res.json({
      success: true,
      character: {
        ...character,
        daysAlive,
        canSell:       character.stage === 'adult' && !character.is_for_sale,
        daysRemaining: Math.max(0, 30 - daysAlive),
        rarityLabel:   getRarityLabel(character.rarity),
      },
      inventory,    invMap,
      points:         user.points,
      is_premium:     !!user.is_premium,
      offline_reward: offlineReward,
      cooldowns,
    });
  } catch (error) {
    logger.error('상태 조회 오류: ' + error.message);
    db.logError('error', error.message, error.stack, req.user?.userId, req.path);
    res.status(500).json({ success:false, message:'상태를 불러오지 못했습니다.' });
  }
});

// ── 먹이주기 — last_fed_at, 30초 쿨다운 ─────────────────
router.post('/feed', (req, res) => {
  try {
    const adapter = db.getAdapter();
    const userId  = req.user.userId;
    const char    = adapter.get('SELECT * FROM characters WHERE user_id=? AND is_dead=0 ORDER BY id DESC LIMIT 1', [userId]);

    if (!char) return res.status(404).json({ success:false, message:'캐릭터가 없습니다.' });
    if (char.stage === 'egg') return res.status(400).json({ success:false, message:'알은 먹이를 먹지 않아요!' });
    if (char.is_sleeping) return res.status(400).json({ success:false, message:'자고 있어요!' });

    // ⚠️ 먹이 전용 쿨다운 (last_fed_at)
    const cd = checkCooldown(char.last_fed_at, 30);
    if (!cd.ok) {
      return res.status(429).json({ success:false, message:`${cd.remaining}초 후 먹이를 줄 수 있어요!`, cooldown:cd.remaining, remaining:cd.remaining });
    }

    const inv = adapter.get('SELECT quantity FROM inventory WHERE user_id=? AND item_type=?', [userId, 'food']);
    if (!inv || inv.quantity <= 0) return res.status(400).json({ success:false, message:'먹이가 없습니다!' });

    const now = new Date().toISOString();
    adapter.transaction(() => {
      adapter.run('UPDATE inventory SET quantity=quantity-1 WHERE user_id=? AND item_type=?', [userId, 'food']);
      db.updateCharacter(char.id, { hunger:Math.min(100, char.hunger+35), last_fed_at:now, last_update:now });
    })();

    const expResult = db.addExp(char.id, EXP_TABLE.feed);
    try {
      const { checkAndUpdateMissions } = require('./missions');
      const { checkAchievements }      = require('./achievements');
      checkAndUpdateMissions(userId, 'feed');
      checkAchievements(userId);
    } catch(e) {}

    res.json({ success:true, message:'냠냠! 맛있게 먹었어요! 😋', exp_gained:EXP_TABLE.feed, level:expResult?.level, level_up:expResult?.levelUp||false });
  } catch (error) {
    logger.error('먹이주기 오류: ' + error.message);
    res.status(500).json({ success:false, message:'오류가 발생했습니다.' });
  }
});

// ── 놀기 — last_played_at, 60초 쿨다운 ─────────────────
router.post('/play', (req, res) => {
  try {
    const adapter = db.getAdapter();
    const userId  = req.user.userId;
    const char    = adapter.get('SELECT * FROM characters WHERE user_id=? AND is_dead=0 ORDER BY id DESC LIMIT 1', [userId]);

    if (!char) return res.status(404).json({ success:false, message:'캐릭터가 없습니다.' });
    if (char.is_dead || char.is_sleeping || char.is_sick) return res.status(400).json({ success:false, message:'지금은 놀 수 없어요!' });

    // ⚠️ 놀이 전용 쿨다운 (last_played_at) — 먹이 쿨다운과 독립
    const cd = checkCooldown(char.last_played_at, 60);
    if (!cd.ok) {
      return res.status(429).json({ success:false, message:`${cd.remaining}초 후 놀 수 있어요!`, cooldown:cd.remaining, remaining:cd.remaining });
    }

    const inv = adapter.get('SELECT quantity FROM inventory WHERE user_id=? AND item_type=?', [userId, 'toy']);
    if (!inv || inv.quantity <= 0) return res.status(400).json({ success:false, message:'장난감이 없습니다!' });

    const now = new Date().toISOString();
    adapter.transaction(() => {
      adapter.run('UPDATE inventory SET quantity=quantity-1 WHERE user_id=? AND item_type=?', [userId, 'toy']);
      db.updateCharacter(char.id, { happy:Math.min(100,char.happy+40), hunger:Math.max(0,char.hunger-8), last_played_at:now, last_update:now });
    })();

    const expResult = db.addExp(char.id, EXP_TABLE.play);
    try {
      const { checkAndUpdateMissions } = require('./missions');
      const { checkAchievements }      = require('./achievements');
      checkAndUpdateMissions(userId, 'play');
      checkAchievements(userId);
    } catch(e) {}

    res.json({ success:true, message:'신나게 놀았어요! 🎉', exp_gained:EXP_TABLE.play, level:expResult?.level, level_up:expResult?.levelUp||false });
  } catch (error) {
    logger.error('놀기 오류: ' + error.message);
    res.status(500).json({ success:false, message:'오류가 발생했습니다.' });
  }
});

// ── 청소 — last_cleaned_at, 120초 쿨다운 ────────────────
router.post('/clean', (req, res) => {
  try {
    const adapter = db.getAdapter();
    const userId  = req.user.userId;
    const char    = adapter.get('SELECT * FROM characters WHERE user_id=? AND is_dead=0 ORDER BY id DESC LIMIT 1', [userId]);

    if (!char) return res.status(404).json({ success:false, message:'캐릭터가 없습니다.' });
    if (char.poop_count === 0) return res.status(400).json({ success:false, message:'이미 깨끗해요!' });

    // ⚠️ 청소 전용 쿨다운 (last_cleaned_at) — 먹이/놀이와 독립
    const cd = checkCooldown(char.last_cleaned_at, 120);
    if (!cd.ok) {
      return res.status(429).json({ success:false, message:`${cd.remaining}초 후 청소할 수 있어요!`, cooldown:cd.remaining, remaining:cd.remaining });
    }

    const inv = adapter.get('SELECT quantity FROM inventory WHERE user_id=? AND item_type=?', [userId, 'clean']);
    if (!inv || inv.quantity <= 0) return res.status(400).json({ success:false, message:'청소도구가 없습니다!' });

    const now = new Date().toISOString();
    adapter.transaction(() => {
      adapter.run('UPDATE inventory SET quantity=quantity-1 WHERE user_id=? AND item_type=?', [userId, 'clean']);
      db.updateCharacter(char.id, { poop_count:0, is_sick:0, last_cleaned_at:now, last_update:now });
    })();

    const expResult = db.addExp(char.id, EXP_TABLE.clean);
    try {
      const { checkAndUpdateMissions } = require('./missions');
      checkAndUpdateMissions(userId, 'clean');
    } catch(e) {}

    res.json({ success:true, message:'깨끗하게 청소했어요! ✨', exp_gained:EXP_TABLE.clean, level:expResult?.level, level_up:expResult?.levelUp||false });
  } catch (error) {
    logger.error('청소 오류: ' + error.message);
    res.status(500).json({ success:false, message:'오류가 발생했습니다.' });
  }
});

// ── 약 주기 ──────────────────────────────────────────────
router.post('/medicine', (req, res) => {
  try {
    const adapter = db.getAdapter();
    const userId  = req.user.userId;
    const char    = adapter.get('SELECT * FROM characters WHERE user_id=? AND is_dead=0 ORDER BY id DESC LIMIT 1', [userId]);
    if (!char) return res.status(404).json({ success:false, message:'캐릭터가 없습니다.' });
    const inv = adapter.get('SELECT quantity FROM inventory WHERE user_id=? AND item_type=?', [userId, 'medicine']);
    if (!inv || inv.quantity <= 0) return res.status(400).json({ success:false, message:'약이 없습니다!' });
    adapter.transaction(() => {
      adapter.run('UPDATE inventory SET quantity=quantity-1 WHERE user_id=? AND item_type=?', [userId, 'medicine']);
      const healthGain = char.is_sick ? 25 : -5;
      db.updateCharacter(char.id, { is_sick:0, health:Math.min(100,Math.max(0,char.health+healthGain)), last_update:new Date().toISOString() });
    })();
    res.json({ success:true, message:char.is_sick?'나았어요! 💊':'안 아픈데요? 건강이 조금 줄었어요 😅' });
  } catch (error) {
    logger.error('약 주기 오류: ' + error.message);
    res.status(500).json({ success:false, message:'오류가 발생했습니다.' });
  }
});

// ── 재우기/깨우기 ─────────────────────────────────────────
router.post('/sleep', (req, res) => {
  try {
    const adapter  = db.getAdapter();
    const userId   = req.user.userId;
    const char     = adapter.get('SELECT * FROM characters WHERE user_id=? AND is_dead=0 ORDER BY id DESC LIMIT 1', [userId]);
    if (!char) return res.status(404).json({ success:false, message:'캐릭터가 없습니다.' });
    const sleeping = !char.is_sleeping;
    if (sleeping) {
      const inv = adapter.get('SELECT quantity FROM inventory WHERE user_id=? AND item_type=?', [userId, 'sleep']);
      if (!inv || inv.quantity <= 0) return res.status(400).json({ success:false, message:'수면제가 없습니다!' });
      adapter.run('UPDATE inventory SET quantity=quantity-1 WHERE user_id=? AND item_type=?', [userId, 'sleep']);
    }
    db.updateCharacter(char.id, {
      is_sleeping: sleeping?1:0,
      health: Math.min(100,char.health+(sleeping?0:20)),
      happy:  Math.min(100,char.happy +(sleeping?0:15)),
      last_update: new Date().toISOString(),
    });
    res.json({ success:true, sleeping, message:sleeping?'😴 자고 있어요...':'😊 잘 잤어요!' });
  } catch (error) {
    logger.error('재우기 오류: ' + error.message);
    res.status(500).json({ success:false, message:'오류가 발생했습니다.' });
  }
});

// ── 판매가 계산 API ──────────────────────────────────────
router.get('/price-calc/:charId', (req, res) => {
  try {
    const char = db.getCharacterById(parseInt(req.params.charId));
    if (!char || char.user_id !== req.user.userId) {
      return res.status(404).json({ success:false, message:'캐릭터를 찾을 수 없습니다.' });
    }
    res.json({ success:true, ...calcSalePrice(char) });
  } catch (error) {
    res.status(500).json({ success:false, message:'오류가 발생했습니다.' });
  }
});

// ── 판매가 추천 계산 ──────────────────────────────────────
function calcSalePrice(char) {
  const versionBase = [300,800,2000,5000,10000][(char.version||1)-1] || 300;
  const levelBonus  = (char.level||1) * 10;
  const rarityBonus = {common:0,advanced:200,rare:800,heroic:3000,legendary:15000}[char.rarity] || 0;
  const stateScore  = Math.floor(((char.hunger||0)+(char.happy||0)+(char.health||0)+Math.max(0,100-(char.poop_count||0)*20))/4);
  const stateBonus  = Math.floor(stateScore * 2);
  const recommend   = versionBase + levelBonus + rarityBonus + stateBonus;
  return { recommend, min:Math.floor(recommend*0.5), max:Math.floor(recommend*3), breakdown:{versionBase,levelBonus,rarityBonus,stateBonus} };
}

function getRarityLabel(rarity) {
  return {common:'일반',advanced:'고급',rare:'희귀',heroic:'영웅',legendary:'전설'}[rarity]||'일반';
}

module.exports = router;
module.exports.calcSalePrice = calcSalePrice;
