// 游戏状态（纯 JSON，可存档）
import { roleById } from '../data/roles.js';
import { ITEMS } from '../data/items.js';
import { makeSchedule, START_TIME } from './weather.js';

export function createState(roleId) {
  const role = roleById(roleId);
  const seed = (Math.random() * 1e9) | 0;
  const st = {
    v: 1,
    seed,
    role: roleId,
    money: role.money,
    inv: {},
    wearInsul: false,
    water: { liquid: 0, frozen: 0 },
    thermos: { l: 0, temp: 20 },
    gas: { normal: 0, alpine: 0 },
    warmers: 0,
    warmerLeft: 0,
    alcoholLeft: 0,
    bat: { phone: 85, gps: 100, headlamp: 100, satcomm: 100 },
    powerbank: 0,
    airplane: false,
    gpsOn: false,
    lampOn: false,
    keepWarm: !!role.mods.keepWarmElectronics,
    body: {
      core: 37.0, stamina: 100, food: 85, water: 80, stress: role.id === 'student' ? 22 : 12,
      health: 100, wet: 0, frostbite: 0, sprain: 0, fracture: 0, snowblind: 0, altSick: 0,
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

// 每个槽位穿着的最佳衣物
export function wornItems(st) {
  const best = {};
  for (const id of Object.keys(st.inv)) {
    const it = ITEMS[id];
    if (!it || it.kind !== 'cloth') continue;
    const cur = best[it.slot];
    const score = (x) => (x.clo || 0) + (x.windproof || 0) + (x.waterproof || 0) * 0.5 + (x.grip || 0) * 0.3 + (x.wetKeep || 0) * 0.2;
    if (!cur || score(it) > score(ITEMS[cur])) best[it.slot] = id;
  }
  return best;
}

export function tentItem(st) {
  if (has(st, 'tent_alpine')) return 'tent_alpine';
  if (has(st, 'tent_light')) return 'tent_light';
  return null;
}
export function bagItem(st) {
  for (const id of ['bag_winter', 'bag_3s', 'bag_summer']) if (has(st, id)) return id;
  return null;
}
export function padItem(st) {
  for (const id of ['pad_air', 'pad_foam']) if (has(st, id)) return id;
  return null;
}
