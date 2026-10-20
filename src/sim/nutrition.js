import { ITEMS } from '../data/items.js';
import { roleById } from '../data/roles.js';
import { maxHealth } from './difficulty.js';

const DEFAULT_MODIFIERS = Object.freeze({ staminaDrain: 1, foodDrain: 1, stressGain: 1, restRecovery: 1, waterDrain: 1 });
const MODIFIER_KEYS = Object.keys(DEFAULT_MODIFIERS);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const bodyNumber = (body, key, fallback = 0) => finite(body[key]) ? body[key] : fallback;

function normalizedEffect(effect) {
  if (!effect || typeof effect !== 'object' || typeof effect.id !== 'string' || !effect.id || typeof effect.label !== 'string' || !effect.label) return null;
  const minutes = finite(effect.minutes) ? clamp(effect.minutes, 0, 240) : 0;
  if (minutes <= 0) return null;
  const modifiers = {};
  for (const key of MODIFIER_KEYS) {
    const value = effect.modifiers?.[key];
    if (finite(value)) modifiers[key] = clamp(value, 0.5, 1.5);
  }
  return { id: effect.id, label: effect.label, minutes, modifiers };
}

function activeEntries(st) {
  if (!Array.isArray(st?.foodEffects)) return [];
  return st.foodEffects.map(normalizedEffect).filter(Boolean);
}

function boundBody(st) {
  const body = st?.body;
  if (!body || typeof body !== 'object') return;
  body.core = clamp(bodyNumber(body, 'core', 37), 20, 37.6);
  body.health = clamp(bodyNumber(body, 'health'), 0, maxHealth(st));
  for (const key of ['food', 'water', 'stamina', 'stress']) body[key] = clamp(bodyNumber(body, key), 0, 100);
}

function refreshEffects(st, item, hot) {
  const additions = Array.isArray(item.foodEffects) ? item.foodEffects.map(normalizedEffect).filter(Boolean) : [];
  if (item.needsHot && !hot) return;
  const current = activeEntries(st);
  for (const effect of additions) {
    const existing = current.find((entry) => entry.id === effect.id);
    if (existing) {
      existing.minutes = Math.max(existing.minutes, effect.minutes);
      for (const key of MODIFIER_KEYS) {
        const next = effect.modifiers[key];
        if (!finite(next)) continue;
        const previous = existing.modifiers[key];
        if (!finite(previous)) existing.modifiers[key] = next;
        else existing.modifiers[key] = key === 'restRecovery' ? Math.max(previous, next) : Math.min(previous, next);
      }
    } else current.push(effect);
  }
  st.foodEffects = current.slice(-8);
}

export function applyFood(st, id, options = {}) {
  const item = ITEMS[id];
  const body = st?.body;
  if (!item || item.kind !== 'food' || !body || typeof body !== 'object') return false;
  try {
    const preparedHot = options?.hot === true;
    let food = finite(item.food) ? item.food : 0;
    let water = finite(item.water) ? item.water : 0;
    let core = 0;
    let stressRelief = finite(item.stressRelief) ? Math.max(0, item.stressRelief) : 0;

    if (item.needsHot && !preparedHot) { food *= 0.6; water -= 4; }
    if (item.needsHot && preparedHot) {
      core += finite(item.heat) ? item.heat : 0.4;
      water += 6;
      stressRelief += 6;
    } else if (!item.needsHot && finite(item.heat)) {
      core += item.heat;
      stressRelief += 6;
    }
    if (item.alcohol) {
      st.alcoholLeft = Math.max(finite(st.alcoholLeft) ? st.alcoholLeft : 0, 120);
      stressRelief += 10;
    }
    const comfort = finite(roleById(st?.role)?.mods?.foodComfort) ? roleById(st.role).mods.foodComfort : 1;
    stressRelief = clamp(stressRelief * clamp(comfort, 0, 2), 0, 20);

    body.food = bodyNumber(body, 'food') + food;
    body.water = bodyNumber(body, 'water') + water;
    body.stamina = bodyNumber(body, 'stamina') + (finite(item.stamina) ? item.stamina : 0);
    body.stress = bodyNumber(body, 'stress') - stressRelief;
    if (core > 0) body.core = Math.min(37.6, Math.max(bodyNumber(body, 'core', 37), Math.min(37.2, bodyNumber(body, 'core', 37) + core)));
    boundBody(st);
    refreshEffects(st, item, preparedHot);
    return true;
  } catch { return false; }
}

export function nutritionModifiers(st) {
  const result = { ...DEFAULT_MODIFIERS };
  for (const effect of activeEntries(st)) {
    for (const key of MODIFIER_KEYS) {
      const value = effect.modifiers[key];
      if (finite(value)) result[key] = clamp(result[key] * value, 0.5, 1.5);
    }
  }
  return result;
}

export function stepFoodEffects(st, minutes) {
  if (!st || typeof st !== 'object' || !finite(minutes) || minutes <= 0) return activeFoodEffects(st);
  st.foodEffects = activeEntries(st)
    .map((effect) => ({ ...effect, minutes: Math.max(0, effect.minutes - minutes) }))
    .filter((effect) => effect.minutes > 0)
    .slice(-8);
  return activeFoodEffects(st);
}

export function foodEffectSummary(id) {
  const item = ITEMS[id];
  if (!item || item.kind !== 'food') return '';
  return typeof item.summary === 'string' ? item.summary : typeof item.desc === 'string' ? item.desc : '';
}

export function activeFoodEffects(st) {
  const active = activeEntries(st).map(({ id, label, minutes }) => ({ id, label, minutes: Math.ceil(minutes) }));
  const alcoholMinutes = finite(st?.alcoholLeft) ? clamp(st.alcoholLeft, 0, 240) : 0;
  if (alcoholMinutes > 0 && !active.some((effect) => effect.id === 'alcohol_risk')) active.push({ id: 'alcohol_risk', label: '饮酒后失温风险', minutes: Math.ceil(alcoholMinutes) });
  return active.slice(0, 9);
}
