// 分件潮湿与穿脱，旧版总潮湿值在迁移和剧情明确修改时同步到在穿衣物。
import { ITEMS, SLOTS } from '../data/items.js';
const clamp = (n, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));
const object = v => v && typeof v === 'object' && !Array.isArray(v);
const weights = { base: 1.2, mid: 1.4, insul: 1.8, shell: 0.6, pants: 1.1, shoes: 1.2, gloves: 0.2, hat: 0.3, eyes: 0.05, gaiters: 0.2 };
const score = it => (it.clo || 0) + (it.windproof || 0) + (it.waterproof || 0) * 0.5 + (it.grip || 0) * 0.3 + (it.wetKeep || 0) * 0.2;
const owns = (st, id) => !!ITEMS[id] && ITEMS[id].kind === 'cloth' && (st.inv?.[id] || 0) > 0;
const isWorn = (st, c, id) => owns(st, id) && c.equipped[ITEMS[id].slot] === id && (ITEMS[id].slot !== 'insul' || !!st.wearInsul);
function syncAggregate(st, c) {
  let total = 0, weight = 0;
  for (const id of Object.values(c.equipped)) {
    if (!isWorn(st, c, id)) continue;
    const w = weights[ITEMS[id].slot] || 1;
    total += c.wetness[id] * w; weight += w;
  }
  c.lastWet = clamp(weight ? total / weight : 0);
  if (st.body) st.body.wet = c.lastWet;
}
export function ensureClothes(st) {
  if (!object(st)) return { equipped: {}, wetness: {}, manualSlots: [], drying: [], dryingWarmLeft: 0, lastWet: 0 };
  const legacyWet = clamp(st.body?.wet || 0), fresh = !object(st.clothes);
  const c = fresh ? {} : st.clothes;
  if (!object(c.equipped)) c.equipped = {};
  if (!object(c.wetness)) c.wetness = {};
  c.manualSlots = Array.isArray(c.manualSlots) ? [...new Set(c.manualSlots.filter(s => SLOTS.includes(s)))] : [];
  const best = {};
  for (const [id, n] of Object.entries(st.inv || {})) {
    const it = ITEMS[id];
    if (n <= 0 || it?.kind !== 'cloth') continue;
    if (!best[it.slot] || score(it) > score(ITEMS[best[it.slot]])) best[it.slot] = id;
  }
  for (const slot of SLOTS) {
    if (!c.manualSlots.includes(slot)) c.equipped[slot] = best[slot] || null;
    else if (!owns(st, c.equipped[slot]) || ITEMS[c.equipped[slot]].slot !== slot) c.equipped[slot] = null;
  }
  for (const [id, n] of Object.entries(st.inv || {})) {
    if (n <= 0 || ITEMS[id]?.kind !== 'cloth') continue;
    c.wetness[id] = Number.isFinite(c.wetness[id]) ? clamp(c.wetness[id]) : fresh && isWorn(st, c, id) ? legacyWet : 0;
  }
  for (const id of Object.keys(c.wetness)) if (!owns(st, id)) delete c.wetness[id];
  // 兼容旧剧情直接增减总湿度，普通脱穿不能把库存衣物瞬间洗干。
  if (!fresh && Number.isFinite(c.lastWet) && Number.isFinite(st.body?.wet)) {
    const delta = st.body.wet - c.lastWet;
    if (Math.abs(delta) > 0.00001) for (const id of Object.keys(c.wetness)) if (isWorn(st, c, id)) c.wetness[id] = clamp(c.wetness[id] + delta);
  }
  c.drying = Array.isArray(c.drying) ? [...new Set(c.drying.filter(id => owns(st, id) && !isWorn(st, c, id)))] : [];
  c.dryingWarmLeft = clamp(c.dryingWarmLeft || 0, 0, 180);
  st.clothes = c; syncAggregate(st, c);
  return c;
}
export function selectedClothes(st) {
  const c = ensureClothes(st);
  return Object.fromEntries(Object.entries(c.equipped).filter(([, id]) => owns(st, id)));
}
export function isClothWorn(st, id) { return isWorn(st, ensureClothes(st), id); }
export function garmentWetness(st, id) { return ensureClothes(st).wetness[id] || 0; }
export function clothingExchangeCost(st, id, env = {}) {
  const slot = ITEMS[id]?.slot;
  if (!slot) return { minutes: 0, coreCost: 0 };
  const depth = { base: 1.3, pants: 1.2, mid: 0.9, shoes: 0.8, shell: 0.45, insul: 0.4, eyes: 0.08, gloves: 0.2, hat: 0.18, gaiters: 0.18 }[slot] || 0.5;
  const minutes = { base: 3, pants: 3, mid: 2, shoes: 2, insul: 1.5, shell: 1.5 }[slot] || 0.6;
  const temperature = Number.isFinite(env.Teff) ? env.Teff : Number.isFinite(env.T) ? env.T : 10;
  const shelter = env.tentInfo ? 0.3 : 1 + clamp(env.wind || 0, 0, 30) / 40;
  return { minutes, coreCost: clamp(Math.max(0, 5 - temperature) * 0.004 * depth * shelter, 0, 0.45) };
}
export function changeClothing(st, id, env = {}) {
  if (!owns(st, id)) return null;
  const c = ensureClothes(st), slot = ITEMS[id].slot;
  const wasWorn = isWorn(st, c, id), previous = c.equipped[slot];
  c.manualSlots = [...new Set([...c.manualSlots, slot])];
  if (slot === 'insul') { c.equipped[slot] = id; st.wearInsul = !wasWorn; }
  else c.equipped[slot] = wasWorn ? null : id;
  c.drying = c.drying.filter(item => !isWorn(st, c, item));
  const cost = clothingExchangeCost(st, id, env);
  if (st.body && Number.isFinite(st.body.core)) st.body.core = clamp(st.body.core - cost.coreCost, 20, 37.6);
  syncAggregate(st, c);
  return { id, previous, worn: !wasWorn, ...cost };
}
export function canDryClothes(st) {
  return !!(st?.camp?.inside && !st.camp.bivy && !st.camp.collapsed && st.camp.health > 0 && ITEMS[st.camp.tent]?.kind === 'tent');
}
export function dryableClothes(st) {
  const c = ensureClothes(st);
  return Object.keys(c.wetness).filter(id => !isWorn(st, c, id) && c.wetness[id] > 0.5);
}
export function beginClothesDrying(st, { assisted = false } = {}) {
  if (!canDryClothes(st)) return null;
  const c = ensureClothes(st), ids = dryableClothes(st);
  if (!ids.length || assisted && !(st.warmers > 0)) return null;
  c.drying = ids;
  if (assisted) { st.warmers--; c.dryingWarmLeft = 90; }
  return { ids: [...ids], assisted: c.dryingWarmLeft > 0 };
}
export function stepGarmentMoisture(st, env, act, minutes, sweatRate = 0) {
  const c = ensureClothes(st), dt = Math.max(0, Number.isFinite(minutes) ? minutes : 0);
  if (!dt) return;
  const walking = act.mode === 'walk';
  const cotton = id => id === 'base_cotton' || id === 'mid_hoodie' || id === 'insul_coat';
  for (const id of Object.keys(c.wetness)) {
    const it = ITEMS[id], slot = it.slot;
    if (!isWorn(st, c, id)) continue;
    let wet = c.wetness[id];
    if (sweatRate > 0) {
      const coverage = { base: 1.25, mid: 0.95, insul: 1.05, shell: 0.3, pants: 0.7, shoes: 0.35, hat: 0.55, gloves: 0.3, eyes: 0, gaiters: 0 }[slot] ?? 0.4;
      wet += sweatRate * coverage * dt;
    }
    if (env.precip > 0) {
      const protection = ['shell', 'hat', 'gaiters', 'shoes', 'gloves'].includes(slot) ? (slot === 'shell' ? 0.75 : 1 - (it.waterproof || 0)) : 1 - (env.cl?.waterproof || 0);
      wet += env.precip * (env.T > -2 ? 0.6 : 0.33) * protection * dt;
    }
    if (walking && act.snowDeep > 0.5 && slot === 'shoes' && !env.cl?.gaiters && (it.wetKeep || 0) < 0.6) wet += 0.05 * dt;
    if (sweatRate <= 0 && (env.precip || 0) <= 0.02) {
      const base = env.tentInfo ? 0.08 : act.mode === 'sleep' ? 0.055 : 0.035;
      wet -= base * (cotton(id) ? 0.5 : 1) * (env.Teff < 0 ? 0.45 : 1) * dt;
    }
    c.wetness[id] = clamp(wet);
  }
  if (canDryClothes(st)) {
    const temp = Number.isFinite(env.Teff) ? env.Teff : -10;
    const ventilation = clamp(ITEMS[st.camp.tent]?.ventilation ?? 0.6, 0.1, 1);
    const air = (temp > 0 ? 0.42 : 0.2) * (0.6 + ventilation * 0.7);
    const heatMinutes = Math.min(dt, c.dryingWarmLeft);
    for (const id of c.drying) {
      if (!owns(st, id) || isWorn(st, c, id)) continue;
      const fiber = cotton(id) ? 0.55 : id === 'insul_down' ? 0.65 : 1;
      c.wetness[id] = clamp(c.wetness[id] - (air * dt + 0.45 * heatMinutes) * fiber);
    }
  }
  c.dryingWarmLeft = Math.max(0, c.dryingWarmLeft - dt);
  syncAggregate(st, c);
}
