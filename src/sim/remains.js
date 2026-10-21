// 死亡遗迹：仅游戏坐标和白名单状态；不共享姓名、浏览器标识或自由文本。
import { ROLES } from '../data/roles.js';
import { maxHealth } from './difficulty.js';
export const REMAINS_WORLD = 'aotai-winter-v1';
export const CELL_SIZE = 64;
export const LOAD_RADIUS = 56;
export const KEEP_RADIUS = 72;
export const MAX_VISIBLE = 24;
export const CAUSE_NAMES = { hypothermia: '失温', fall: '滑坠', dehydration: '脱水', starvation: '力竭', injury: '伤重' };
const PATHS = new Set(['main', 'hetaoping', 'qingfengxia', 'dudumen', 'diaoyutai']);
const PREF_KEY = 'aotai-remains-settings-v1';
const LOCAL_KEY = 'aotai-remains-local-v1';
const MAX_LOCAL = 60;
const ID = /^[A-Za-z0-9_-]{8,96}$/;
const numeric = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const round = v => Math.sign(v) * Math.round(Math.abs(v) * 100) / 100;
const bounded = (v, lo, hi) => round(Math.max(lo, Math.min(hi, Number(v) || 0)));
const uuid = () => globalThis.crypto?.randomUUID?.() || `death_${Date.now()}_${Math.random().toString(36).slice(2)}`;
const parse = (storage, key, fallback) => { try { return JSON.parse(storage?.getItem(key) || 'null') ?? fallback; } catch { return fallback; } };
const store = (storage, key, value) => { try { storage?.setItem(key, JSON.stringify(value)); } catch { /* 内存中仍可用 */ } };

export function validRemains(r) {
  return !!r && typeof r.id === 'string' && ID.test(r.id) && r.world === REMAINS_WORLD && PATHS.has(r.path)
    && numeric(r.x, -100000, 100000) && numeric(r.z, -100000, 100000)
    && ROLES.some(role => role.id === r.role)
    && ['easy', 'normal', 'hardcore'].includes(r.difficulty) && Object.hasOwn(CAUSE_NAMES, r.cause)
    && numeric(r.gameMinute, 0, 1e6) && numeric(r.core, 0, 45)
    && ['health', 'food', 'water', 'stress'].every(k => numeric(r[k], 0, 100))
    && numeric(r.altitude, -1000, 10000) && numeric(r.createdAt, 0, 4102444800000);
}
export function makeDeathRecord(st, pos, cause, altitude, now = Date.now()) {
  if (!PATHS.has(st?.path) || !numeric(pos?.x, -100000, 100000) || !numeric(pos?.z, -100000, 100000)) return null;
  st.ending ||= {};
  st.ending.remainsId ||= uuid();
  return {
    id: st.ending.remainsId, world: REMAINS_WORLD, path: st.path, x: round(pos.x), z: round(pos.z),
    role: st.role, difficulty: st.difficulty || 'normal', cause: Object.hasOwn(CAUSE_NAMES, cause) ? cause : 'hypothermia',
    gameMinute: bounded(st.time, 0, 1e6), core: bounded(st.body.core, 0, 45),
    health: bounded(st.body.health / maxHealth(st) * 100, 0, 100), food: bounded(st.body.food, 0, 100), water: bounded(st.body.water, 0, 100),
    stress: bounded(st.body.stress, 0, 100), altitude: bounded(altitude, -1000, 10000), createdAt: now,
  };
}
export const remainsCell = (path, pos) => ({ path, cx: Math.floor(pos.x / CELL_SIZE), cz: Math.floor(pos.z / CELL_SIZE) });
const cellKey = c => `${c.path}:${c.cx}:${c.cz}`;
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export class RemainsClient {
  constructor({ storage = globalThis.localStorage, fetcher = globalThis.fetch?.bind(globalThis), now = Date.now } = {}) {
    this.storage = storage; this.fetcher = fetcher; this.now = now;
    const prefs = parse(storage, PREF_KEY, {});
    this.enabled = prefs?.enabled !== false;
    this.shared = prefs?.shared !== false;
    const local = parse(storage, LOCAL_KEY, []);
    this.local = Array.isArray(local) ? local.filter(e => validRemains(e?.record)).slice(0, MAX_LOCAL) : [];
    this.remote = []; this.cache = new Map(); this.generation = 0; this.nextQuery = 0;
    this.currentCell = null; this.request = null; this.postRequest = null;
    if (!this.enabled || !this.shared) this.clearPending();
  }
  persist() { store(this.storage, LOCAL_KEY, this.local); }
  clearPending() { for (const e of this.local) e.pending = false; this.persist(); }
  setEnabled(value) { this.enabled = !!value; this.settingsChanged(); }
  setShared(value) { this.shared = !!value; this.settingsChanged(); }
  settingsChanged() {
    store(this.storage, PREF_KEY, { enabled: this.enabled, shared: this.shared });
    this.reset();
    if (!this.enabled || !this.shared) this.clearPending();
  }
  reset() {
    this.generation++; this.request?.abort(); this.postRequest?.abort(); this.request = this.postRequest = null;
    this.remote = []; this.cache.clear(); this.currentCell = null; this.nextQuery = 0;
  }
  clearLocal() { this.local = []; this.persist(); this.reset(); }
  recordDeath(st, pos, cause, altitude) {
    if (!this.enabled) return null;
    const record = makeDeathRecord(st, pos, cause, altitude, this.now());
    if (!record || !validRemains(record)) return null;
    if (!this.local.some(e => e.record.id === record.id)) {
      this.local.unshift({ record, pending: this.shared }); this.local.length = Math.min(MAX_LOCAL, this.local.length); this.persist();
    }
    void this.flush();
    return record;
  }
  async flush() {
    if (!this.enabled || !this.shared || this.postRequest || !this.fetcher) return;
    const e = this.local.find(e => e.pending);
    if (!e || this.now() < (this.nextPost || 0)) return;
    const token = this.generation, controller = new AbortController(); this.postRequest = controller;
    const timer = setTimeout(() => controller.abort(), 5000);
    this.nextPost = this.now() + 30000;
    try {
      const { createdAt, ...body } = e.record;
      const res = await this.fetcher('/api/remains', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
      if (res.ok && token === this.generation && this.enabled && this.shared) { e.pending = false; this.persist(); }
    } catch { /* 下次附近查询时重试，失败不阻塞游戏 */ }
    finally { clearTimeout(timer); if (this.postRequest === controller) this.postRequest = null; }
  }
  tick(path, pos) {
    if (!this.enabled || !this.shared || !PATHS.has(path) || !pos) return;
    const cell = remainsCell(path, pos), key = cellKey(cell), now = this.now();
    if (key !== this.currentCell) { this.request?.abort(); this.request = null; this.remote = []; this.currentCell = key; }
    if (now < this.nextQuery || this.request || !this.fetcher) return;
    const cached = this.cache.get(key);
    if (cached && now - cached.at < 60000) { this.remote = cached.rows; return; }
    this.nextQuery = now + 8000;
    void this.flush();
    void this.query(cell, key);
  }
  async query(cell, key) {
    const token = this.generation, controller = new AbortController(); this.request = controller;
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const params = new URLSearchParams({ world: REMAINS_WORLD, path: cell.path, cx: cell.cx, cz: cell.cz });
      const res = await this.fetcher(`/api/remains?${params}`, { signal: controller.signal });
      if (!res.ok) return;
      const data = await res.json();
      if (controller.signal.aborted || !Array.isArray(data?.remains) || token !== this.generation || key !== this.currentCell || !this.enabled || !this.shared) return;
      const rows = data.remains.slice(0, 24).filter(r => validRemains(r) && r.path === cell.path
        && Math.abs(Math.floor(r.x / CELL_SIZE) - cell.cx) <= 1 && Math.abs(Math.floor(r.z / CELL_SIZE) - cell.cz) <= 1);
      this.remote = rows; this.cache.set(key, { at: this.now(), rows });
      if (this.cache.size > 8) this.cache.delete(this.cache.keys().next().value);
    } catch { /* 网络失败时仍能看到自己的血迹 */ }
    finally { clearTimeout(timer); if (this.request === controller) this.request = null; }
  }
  nearby(path, pos, existing = new Set()) {
    if (!this.enabled) return [];
    const ownIds = new Set(this.local.map(e => e.record.id)), merged = new Map();
    for (const r of this.shared ? this.remote : []) merged.set(r.id, { ...r, own: ownIds.has(r.id) });
    for (const e of this.local) merged.set(e.record.id, { ...e.record, own: true });
    return [...merged.values()].filter(r => r.path === path && distance(r, pos) <= (existing.has(r.id) ? KEEP_RADIUS : LOAD_RADIUS))
      .sort((a, b) => Number(b.own) - Number(a.own) || distance(a, pos) - distance(b, pos)).slice(0, MAX_VISIBLE);
  }
}
