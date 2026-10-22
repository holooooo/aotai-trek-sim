// 游戏状态（纯 JSON，可存档）
import { roleById } from '../data/roles.js';
import { ITEMS } from '../data/items.js';
import { makeSchedule, START_TIME } from './weather.js';
import { ensureStoryState } from './stories.js';
import { difficultyProfile } from './difficulty.js';
import { ensureClothes, selectedClothes } from './clothes.js';
import { ensurePsychology } from './stress.js';
import { ensureFire } from './fire.js';

export function createState(roleId, difficulty = 'easy') {
  const role = roleById(roleId);
  const profile = difficultyProfile(difficulty);
  const seed = (Math.random() * 1e9) | 0;
  const st = {
    v: 1,
    seed,
    role: roleId,
    difficulty: profile.id,
    money: role.money,
    inv: {},
    wearInsul: false,
    pace: 'walk',
    water: { liquid: 0, frozen: 0 },
    thermos: { l: 0, temp: 20 },
    gas: { normal: 0, alpine: 0 },
    fire: { active: false, fuel: null, balance: 0, scrapped: 0 },
    warmers: 0,
    warmerLeft: 0,
    alcoholLeft: 0,
    bat: { phone: 85, gps: 100, headlamp: 100, satcomm: 100 },
    powerbank: 0,
    airplane: false,
    gpsOn: false,
    lampOn: false,
    lampMode: 'auto',
    keepWarm: !!role.mods.keepWarmElectronics,
    body: {
      core: 37.0, stamina: 100, food: 85, water: 80, stress: role.id === 'student' ? 22 : 12,
      health: profile.maxHealth, wet: 0, frostbite: 0, sprain: 0, fracture: 0, snowblind: 0, altSick: 0,
      shiver: 0, sweating: 0, collapsed: false, lastHarm: 'hypothermia',
    },
    time: START_TIME,
    schedule: makeSchedule(seed),
    pos: null, // {x,z}
    path: 'main',
    dir: 1,
    s: 0,
    maxS: 0,
    camp: null,
    campCheckpoint: null,
    rescue: null,
    npcs: {},
    companions: [],
    flags: {},
    warned: {},
    visited: {},
    log: [],
    stats: { minCore: 37, maxAlt: 1740, walked: 0, startedAt: Date.now(), coldestFelt: 0, nights: 0 },
    fines: 0,
    ending: null,
  };
  for (const [id, n] of Object.entries(role.inv)) addItem(st, id, n);
  ensureStoryState(st);
  ensureClothes(st);
  ensurePsychology(st);
  ensureFire(st);
  return st;
}

// 购买/获得物品时的处理（有的物品转为资源）
export function addItem(st, id, n = 1) {
  const it = ITEMS[id];
  if (!it) return;
  if (it.kind === 'water') {
    st.water.liquid += it.liters * n;
    return;
  }
  if (it.kind === 'gas') {
    if (id === 'gas_alpine') st.gas.alpine += it.units * n; else st.gas.normal += it.units * n;
    return;
  }
  if (id === 'warmer') { st.warmers += it.pieces * n; return; }
  if (id === 'powerbank') { st.powerbank += it.charges * n; st.inv.powerbank = (st.inv.powerbank || 0) + n; return; }
  if (id === 'hotwater_fill') { st.thermos.l = 1; st.thermos.temp = 92; return; }
  if (id === 'insurance') { st.flags.insurance = true; return; }
  st.inv[id] = (st.inv[id] || 0) + n;
}

export function removeItem(st, id, n = 1) {
  if (!st.inv[id]) return false;
  st.inv[id] -= n;
  if (st.inv[id] <= 0) delete st.inv[id];
  return true;
}

export const has = (st, id) => (st.inv[id] || 0) > 0;

// 负重（kg）
export function packWeight(st) {
  let w = 0;
  for (const [id, n] of Object.entries(st.inv)) {
    const it = ITEMS[id];
    if (!it) continue;
    w += (it.weight || 0) * n;
  }
  w += st.water.liquid + st.water.frozen + st.thermos.l;
  w += ((st.gas.normal + st.gas.alpine) / 6) * 0.38;
  w += st.warmers * 0.024;
  return w;
}

export function packCapacity(st) {
  let cap = 4; // 没有背包时：手里拎着
  for (const id of Object.keys(st.inv)) {
    const it = ITEMS[id];
    if (it && it.kind === 'pack') cap = Math.max(cap, it.cap);
  }
  return cap;
}

export function packItem(st) {
  let best = null;
  for (const id of Object.keys(st.inv)) {
    const it = ITEMS[id];
    if (it && it.kind === 'pack' && (!best || it.cap > ITEMS[best].cap)) best = id;
  }
  return best;
}

// 沿用返回所选保暖层的旧接口；是否穿上仍由wearInsul控制。
export function wornItems(st) { return selectedClothes(st); }

function bestCampingItem(st, kind, score) {
  return Object.keys(st.inv || {}).filter(id => has(st, id) && ITEMS[id]?.kind === kind)
    .sort((a, b) => score(ITEMS[b]) - score(ITEMS[a]) || a.localeCompare(b))[0] || null;
}
export function tentItem(st) { return bestCampingItem(st, 'tent', it => it.windRating * 2 + it.warmth); }
export function bagItem(st) { return bestCampingItem(st, 'bag', it => -it.comfort); }
export function padItem(st) { return bestCampingItem(st, 'pad', it => it.r); }
