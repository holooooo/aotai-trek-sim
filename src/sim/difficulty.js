// 难度是游戏平衡，不是现实风险或医学模型。轻松模式仅增加健康容错，不改变失温死亡阈值。
const BASE = { maxHealth: 100, heatLoss: 1, staminaDrain: 1, foodDrain: 1, waterDrain: 1, damage: 1, minTemp: -Infinity };
export const DIFFICULTIES = Object.freeze([
  Object.freeze({ ...BASE, id: 'spring', name: '春游', maxHealth: 240, heatLoss: 0.72, staminaDrain: 0.82, foodDrain: 0.82, waterDrain: 0.82, damage: 0.7, minTemp: 0.5,
    description: '春游模式，气温与体感保持在0℃以上；健康、消耗与伤害更宽松，适合先熟悉路线。' }),
  Object.freeze({ ...BASE, id: 'easy', name: '轻松', maxHealth: 200,
    description: '健康上限翻倍，其他生理规则与标准相同；仍可能失温、滑坠和遇难。' }),
  Object.freeze({ ...BASE, id: 'normal', name: '标准',
    description: '保留原有生存平衡，健康上限100。' }),
  Object.freeze({ ...BASE, id: 'hardcore', name: '真实', heatLoss: 1.15, staminaDrain: 1.25, foodDrain: 1.2, waterDrain: 1.25, damage: 1.35,
    description: '散热、体力和补给消耗更高，受伤后果更重；数值仍是游戏近似。' }),
]);
const profiles = new Map(DIFFICULTIES.map((profile) => [profile.id, profile]));
const clampHealth = (value, cap) => Math.max(0, Math.min(cap, Number.isFinite(value) ? value : cap));

/** 只读查询。无字段的旧存档和非法 id 均按原来的标准平衡处理。 */
export function difficultyProfile(stOrId) {
  const id = typeof stOrId === 'string' ? stOrId : stOrId?.difficulty;
  return profiles.get(id) ?? profiles.get('normal');
}

export const maxHealth = (stOrId) => difficultyProfile(stOrId).maxHealth;

/** 归一化存档；不按比例缩放、不复活、不重置体温、伤病或其他资源。返回 profile。 */
export function ensureDifficulty(st) {
  const profile = difficultyProfile(st);
  if (st && typeof st === 'object') {
    st.difficulty = profile.id;
    if (st.body && typeof st.body === 'object') st.body.health = clampHealth(st.body.health, profile.maxHealth);
  }
  return profile;
}

/** 用于新局准备阶段切换：保留健康比例，其他状态保持不变。返回新 profile。 */
export function setDifficulty(st, id) {
  const previous = ensureDifficulty(st);
  const next = difficultyProfile(id);
  if (st && typeof st === 'object') {
    const ratio = st.body ? st.body.health / previous.maxHealth : 1;
    st.difficulty = next.id;
    if (st.body && typeof st.body === 'object') st.body.health = clampHealth(ratio * next.maxHealth, next.maxHealth);
  }
  return next;
}
