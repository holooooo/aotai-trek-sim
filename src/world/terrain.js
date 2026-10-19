// 地形生成：沿主线山脊生成高度场，支线（下撤路线）在地形上开出沟谷。
import { WAYPOINTS, BRANCHES, TERRAIN, KM_PER_UNIT, altToVox, voxToAlt, waypointById } from '../data/route.js';
import { makeNoise2D, fbm, hash2, clamp, lerp, smoothstep } from './noise.js';

const WORLD_SEED = 20260102;
const noiseA = makeNoise2D(WORLD_SEED);
const noiseB = makeNoise2D(WORLD_SEED + 7);
const noiseC = makeNoise2D(WORLD_SEED + 13);
const n1 = (t, k = 0) => noiseC(t, k * 17.3 + 0.5);

const GRID = 32;
const INFLUENCE = 150;

export class Path {
  constructor(id, pts) {
    this.id = id;
    const n = pts.length;
    this.n = n;
    this.x = new Float32Array(n);
    this.z = new Float32Array(n);
    this.s = new Float32Array(n);
    this.e = new Float32Array(n);
    this.t = new Array(n);
    let acc = 0;
    for (let i = 0; i < n; i++) {
      this.x[i] = pts[i].x;
      this.z[i] = pts[i].z;
      if (i > 0) acc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      this.s[i] = acc;
    }
    this.length = acc;
    this.grid = new Map();
  }

  buildGrid() {
    for (let i = 0; i < this.n - 1; i++) {
      const minx = Math.min(this.x[i], this.x[i + 1]) - INFLUENCE;
      const maxx = Math.max(this.x[i], this.x[i + 1]) + INFLUENCE;
      const minz = Math.min(this.z[i], this.z[i + 1]) - INFLUENCE;
      const maxz = Math.max(this.z[i], this.z[i + 1]) + INFLUENCE;
      for (let cx = Math.floor(minx / GRID); cx <= Math.floor(maxx / GRID); cx++) {
        for (let cz = Math.floor(minz / GRID); cz <= Math.floor(maxz / GRID); cz++) {
          const k = cx * 100003 + cz;
          let arr = this.grid.get(k);
          if (!arr) this.grid.set(k, (arr = []));
          arr.push(i);
        }
      }
    }
  }

  indexAt(s) {
    let lo = 0, hi = this.n - 1;
    if (s <= 0) return 0;
    if (s >= this.length) return this.n - 2;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.s[mid] <= s) lo = mid; else hi = mid;
    }
    return lo;
  }

  pointAt(s) {
    s = clamp(s, 0, this.length);
    const i = Math.min(this.indexAt(s), this.n - 2);
    const seg = this.s[i + 1] - this.s[i] || 1;
    const t = (s - this.s[i]) / seg;
    const dx = this.x[i + 1] - this.x[i];
    const dz = this.z[i + 1] - this.z[i];
    const len = Math.hypot(dx, dz) || 1;
    return { x: this.x[i] + dx * t, z: this.z[i] + dz * t, dx: dx / len, dz: dz / len, i };
  }

  elevAt(s) {
    s = clamp(s, 0, this.length);
    const i = Math.min(this.indexAt(s), this.n - 2);
    const t = (s - this.s[i]) / (this.s[i + 1] - this.s[i] || 1);
    return lerp(this.e[i], this.e[i + 1], t);
  }

  typeAt(s) {
    const i = Math.min(this.indexAt(clamp(s, 0, this.length)), this.n - 1);
    return this.t[i];
  }

  _segDist(i, x, z) {
    const ax = this.x[i], az = this.z[i];
    const bx = this.x[i + 1], bz = this.z[i + 1];
    const dx = bx - ax, dz = bz - az;
    const L2 = dx * dx + dz * dz || 1;
    let t = ((x - ax) * dx + (z - az) * dz) / L2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + dx * t, pz = az + dz * t;
    const ex = x - px, ez = z - pz;
    return { d2: ex * ex + ez * ez, t, side: Math.sign(dx * (z - az) - dz * (x - ax)) };
  }

  // 最近点查询（网格加速）
  nearest(x, z) {
    const k = Math.floor(x / GRID) * 100003 + Math.floor(z / GRID);
    const arr = this.grid.get(k);
    let best = Infinity, bi = 0, bt = 0, bside = 1;
    if (arr) {
      for (let j = 0; j < arr.length; j++) {
        const i = arr[j];
        const r = this._segDist(i, x, z);
        if (r.d2 < best) { best = r.d2; bi = i; bt = r.t; bside = r.side; }
      }
    }
    if (!arr || best === Infinity) {
      for (let i = 0; i < this.n - 1; i += 8) {
        const dx = this.x[i] - x, dz = this.z[i] - z;
        const d2 = dx * dx + dz * dz;
        if (d2 < best) { best = d2; bi = i; bt = 0; }
      }
      const r = this._segDist(bi, x, z);
      bside = r.side;
    }
    const s = this.s[bi] + (this.s[bi + 1] - this.s[bi]) * bt;
    return { s, d: Math.sqrt(best), i: bi, side: bside || 1 };
  }

  // 在提示索引附近窗口搜索（玩家跟踪用，避免跳到折返的远处路段）
  nearestNear(x, z, hintS, window = 80) {
    const hi = this.indexAt(hintS);
    const a = Math.max(0, hi - window), b = Math.min(this.n - 2, hi + window);
    let best = Infinity, bi = a, bt = 0, bside = 1;
    for (let i = a; i <= b; i++) {
      const r = this._segDist(i, x, z);
      if (r.d2 < best) { best = r.d2; bi = i; bt = r.t; bside = r.side; }
    }
    const s = this.s[bi] + (this.s[bi + 1] - this.s[bi]) * bt;
    return { s, d: Math.sqrt(best), i: bi, side: bside || 1 };
  }
}

// —— 主线几何 ——
function buildMainPath() {
  const total = WAYPOINTS[WAYPOINTS.length - 1].km / KM_PER_UNIT;
  const pts = [];
  let x = 0, z = 0, acc = 0;
  const step = 2;
  while (acc <= total + step) {
    pts.push({ x, z });
    const heading = 0.5 * n1(acc * 0.0035, 1) + 0.22 * n1(acc * 0.013, 2) + 0.08 * n1(acc * 0.05, 3)
      + (acc < 120 ? -0.5 * (1 - acc / 120) : 0);
    x += Math.cos(heading) * step;
    z += Math.sin(heading) * step;
    acc += step;
  }
  const path = new Path('main', pts);
  // 途经点 s 值
  const wps = WAYPOINTS.map((w) => ({ ...w, s: w.km / KM_PER_UNIT, v: altToVox(w.alt) }));
  path.waypoints = wps;
  for (let i = 0; i < path.n; i++) {
    const s = path.s[i];
    let k = 0;
    while (k < wps.length - 2 && wps[k + 1].s <= s) k++;
    const a = wps[k], b = wps[k + 1];
    const t = clamp((s - a.s) / (b.s - a.s), 0, 1);
    const st = t * t * (3 - 2 * t);
    const base = lerp(a.v, b.v, st);
    const T = TERRAIN[a.terrain];
    const bump = Math.sin(Math.PI * t);
    const und = (n1(s * 0.012, 5) * T.amp * 1.6 + n1(s * 0.045, 6) * T.amp * 0.6) * bump;
    path.e[i] = base + und;
    path.t[i] = classify(a.terrain, s, voxToAlt(path.e[i]));
  }
  return path;
}

function classify(segType, s, alt) {
  if (segType === 'village') return s < 30 ? 'village' : 'forest';
  if (alt < 3150) return 'forest';
  if (segType === 'forest') return alt < 3250 ? 'forest' : 'meadow';
  const k = n1(s * 0.02, 9);
  const st = n1(s * 0.017, 11);
  if (segType === 'ridge') {
    if (k > 0.45) return 'knife';
    if (st > 0.4) return 'stone';
    return 'ridge';
  }
  if (segType === 'knife') return k < -0.5 ? 'ridge' : 'knife';
  if (segType === 'stone') return st < -0.55 ? 'ridge' : 'stone';
  if (segType === 'plateau') return st > 0.5 ? 'stone' : 'plateau';
  if (segType === 'meadow') return alt > 3300 && k > 0.4 ? 'ridge' : 'meadow';
  return segType;
}

export const mainPath = buildMainPath();
mainPath.buildGrid();

// —— 湖泊 ——
export const LAKES = [];
function addLake(wpId, offset, r) {
  const wp = mainPath.waypoints.find((w) => w.id === wpId);
  const p = mainPath.pointAt(wp.s);
  const cx = p.x - p.dz * offset;
  const cz = p.z + p.dx * offset;
  const level = Math.round(mainPath.elevAt(wp.s)) - 1;
  LAKES.push({ id: wpId, x: cx, z: cz, r, level });
}
addLake('shuiwozi', 11, 5);
addLake('dayehai', 18, 12);
addLake('dashihe', 9, 4);

// —— 高度函数 ——
function mainHeight(x, z, near) {
  const s = near.s;
  const d = near.d;
  const e = mainPath.elevAt(s);
  const type = mainPath.typeAt(s);
  const T = TERRAIN[type];
  const w = type === 'knife' ? 1.6 : type === 'stone' ? 2.6 : 3.2;
  let h;
  if (d <= w) {
    h = e + noiseB(x * 0.15, z * 0.15) * 0.35;
  } else {
    const dd = d - w;
    const steep = type === 'knife' ? T.steep * (dd < 10 ? 1 : 0.6) : T.steep;
    h = e - steep * Math.pow(dd, 1.22) + fbm(noiseA, x * 0.06, z * 0.06, 3) * T.amp * smoothstep(w, w + 8, d);
  }
  const village = s < 90;
  const sideBase = village ? e + 6 : e - 12;
  const sideAmp = village ? 22 : 30;
  const side = sideBase + fbm(noiseA, x * 0.011 + 40, z * 0.011 - 20, 4) * sideAmp
    + Math.abs(noiseB(x * 0.004, z * 0.004)) * 14;
  const suppress = smoothstep(type === 'knife' ? 22 : 12, type === 'knife' ? 70 : 55, d);
  h = Math.max(h, side - (1 - suppress) * 400);
  const floor = 1 + fbm(noiseB, x * 0.02, z * 0.02, 2) * 3;
  if (h < floor) h = floor;
  return h;
}

// —— 下撤支线 ——
function buildBranch(def) {
  const wp = mainPath.waypoints.find((w) => w.id === def.fromWaypoint);
  const start = mainPath.pointAt(wp.s);
  const pts = [];
  // 朝山脊南侧（路线右侧）下撤
  let heading = Math.atan2(start.dx, -start.dz); // 垂直于主线，指向 +side
  let x = start.x, z = start.z;
  const total = def.lengthKm / KM_PER_UNIT;
  for (let acc = 0; acc <= total + 2; acc += 2) {
    pts.push({ x, z });
    const h = heading + 0.6 * n1(acc * 0.01, 21) + (acc > 60 ? 0.35 * Math.sin(acc * 0.012) : 0);
    x += Math.cos(h) * 2;
    z += Math.sin(h) * 2;
  }
  const path = new Path(def.id, pts);
  // 采样主地形 → 平滑 → 单调下降
  const raw = new Float32Array(path.n);
  for (let i = 0; i < path.n; i++) {
    raw[i] = mainHeight(path.x[i], path.z[i], mainPath.nearest(path.x[i], path.z[i]));
  }
  const endV = altToVox(def.endAlt);
  let prev = mainPath.elevAt(wp.s);
  for (let i = 0; i < path.n; i++) {
    let sum = 0, c = 0;
    for (let k = -12; k <= 12; k++) {
      const j = clamp(i + k, 0, path.n - 1);
      sum += raw[j]; c++;
    }
    const t = i / (path.n - 1);
    // 与线性下降混合，保证可走
    const linear = lerp(mainPath.elevAt(wp.s), endV, Math.pow(t, 0.8));
    let v = lerp(sum / c, linear, 0.55);
    if (i > 0) v = Math.min(v, prev - 0.02);
    v = Math.max(v, endV);
    path.e[i] = v;
    path.t[i] = 'forest';
    prev = v;
  }
  path.buildGrid();
  path.def = def;
  path.fromS = wp.s;
  return path;
}

export const branches = {};
for (const id of Object.keys(BRANCHES)) branches[id] = buildBranch(BRANCHES[id]);
const branchList = Object.values(branches);

export const WANXIAN = (() => {
  const wp = mainPath.waypoints.find((w) => w.id === 'wanxian');
  return { from: wp.s - 50, to: wp.s + 140 };
})();

// 返回柱高（整数）与地表信息
export function columnInfo(x, z) {
  const near = mainPath.nearest(x + 0.5, z + 0.5);
  let h = mainHeight(x + 0.5, z + 0.5, near);
  let type = mainPath.typeAt(near.s);
  let trailD = near.d;
  let onBranch = false;
  for (const b of branchList) {
    const nb = b.nearest(x + 0.5, z + 0.5);
    if (nb.d < 14) {
      const eb = b.elevAt(nb.s);
      const wb = 1 - smoothstep(2.2, 10, nb.d);
      h = lerp(h, eb + Math.max(0, nb.d - 2.2) * 0.55, wb);
      if (nb.d < trailD) { trailD = nb.d; type = 'forest'; onBranch = true; }
    }
  }
  let ice = false;
  for (const L of LAKES) {
    const dl = Math.hypot(x + 0.5 - L.x, z + 0.5 - L.z);
    if (dl < L.r + 4) {
      const target = dl < L.r ? L.level - 1 : lerp(L.level - 1, h, smoothstep(L.r, L.r + 4, dl));
      h = Math.min(h, target);
      if (dl < L.r) { ice = true; h = L.level; }
    }
  }
  let hi = Math.round(h);
  if (!ice && type === 'stone' && near.d < 34) {
    const r = hash2(x, z, 3);
    if (r > 0.7) hi += 1;
    if (hash2(x, z, 9) > 0.9 && near.d > 1.6) hi += 1;
    if (near.s > WANXIAN.from && near.s < WANXIAN.to && near.d > 2.5 && hash2(x, z, 17) > 0.93) {
      hi += 3 + Math.floor(hash2(x, z, 21) * 3);
    }
  }
  return { h: hi, type, d: trailD, s: near.s, side: near.side, ice, onBranch };
}

export function heightAt(x, z) {
  return columnInfo(Math.floor(x), Math.floor(z)).h;
}

export function waypointPos(id) {
  const wp = mainPath.waypoints.find((w) => w.id === id);
  const p = mainPath.pointAt(wp.s);
  return { ...p, s: wp.s, wp };
}

export { waypointById };
