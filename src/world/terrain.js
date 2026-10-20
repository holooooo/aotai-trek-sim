// 地形生成：沿主线山脊生成高度场，支线（下撤路线）在地形上开出沟谷。
import { WAYPOINTS, BRANCHES, TERRAIN, KM_PER_UNIT, altToVox, voxToAlt, waypointById } from '../data/route.js';
import { makeNoise2D, fbm, hash2, clamp, lerp, smoothstep } from './noise.js';

const WORLD_SEED = 20260102;
const noiseA = makeNoise2D(WORLD_SEED);
const noiseB = makeNoise2D(WORLD_SEED + 7);
const noiseC = makeNoise2D(WORLD_SEED + 13);
const n1 = (t, k = 0) => noiseC(t, k * 17.3 + 0.5);

const GRID = 32;
const INFLUENCE = 260; // 覆盖低地区域侧向查询（最远 ~235 units），保证 nearest 精确

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
  // c2800 之后：山脊南侧（支线一侧，side>0）随侧向距离逐渐下降的可走低地。
  // 侧向 40~235 units 内平滑下降到 LOW_V(<1600m)，沿 s 边界也用 smoothstep 缓入。
  if (near.side > 0 && near.s > C2800_S - 80) {
    const fs = smoothstep(C2800_S - 60, C2800_S + 80, near.s);
    const drop = smoothstep(40, 235, near.d);
    const target = e - (e - LOW_V) * drop + fbm(noiseA, x * 0.05, z * 0.05, 2) * 0.8 * (1 - drop);
    const w = fs * smoothstep(32, 55, near.d);
    const blended = lerp(h, target, w);
    // 保证混合后单调不高于原地形（只削峰），避免跨界处出现抬升台阶。
    h = Math.min(h, blended);
  }
  // 村口向西的出村土路（Sigma 结局通道）：沿路负方向到约 -50，宽约 6，缓坡。
  const road = villageRoadBlend(x, z);
  if (road) h = lerp(h, road.v, road.w);
  return h;
}

// —— 村口出村路 ——
const V0 = mainPath.pointAt(0);
const C2800_S = mainPath.waypoints.find((w) => w.id === 'c2800').s;
const LOW_V = altToVox(1575); // 低地目标海拔 1575m < 1600m

// 返回 null 表示不在路面影响范围内；否则返回 { v: 路面高度, w: 混合权重 }。
function villageRoadBlend(x, z) {
  const rx = x - V0.x, rz = z - V0.z;
  const along = rx * V0.dx + rz * V0.dz;
  const side = -rx * V0.dz + rz * V0.dx;
  // 只覆盖村外（along <= -9），不碰村内沿路 s>0 的地标与摊位区。
  if (along > -9 || along < -82 || Math.abs(side) > 14) return null;
  const wSide = 1 - smoothstep(4, 14, Math.abs(side));
  const wA = smoothstep(-84, -70, along) * (1 - smoothstep(-14, -9, along));
  const w = wSide * wA;
  if (w <= 0) return null;
  // 村内端 6.5 缓降到 4.2（到 along=-44），再以 ~0.85/unit 的可走坡度爬上高地（接天然地面 ~34）。
  const uDown = clamp((-along - 12) / 32, 0, 1);
  const stDown = uDown * uDown * (3 - 2 * uDown);
  const flat = lerp(6.5, 4.2, stDown) + fbm(noiseA, x * 0.09, z * 0.09, 2) * 0.35;
  const uUp = clamp((-along - 44) / 36, 0, 1);
  const stUp = uUp * uUp * (3 - 2 * uUp);
  const v = lerp(flat, 27, stUp);
  return { v, w };
}

// —— 下撤支线 ——
function buildBranch(def) {
  const wp = mainPath.waypoints.find((w) => w.id === def.fromWaypoint);
  const start = mainPath.pointAt(wp.s);
  const pts = [];
  // 游戏相对左右侧；绝不是现实地理方位或道路复刻。
  let heading = Math.atan2(start.dx, -start.dz) + (def.side === -1 ? Math.PI : 0);
  let x = start.x, z = start.z;
  const total = def.lengthKm / KM_PER_UNIT;
  for (let acc = 0; acc <= total + 2; acc += 2) {
    pts.push({ x, z });
    const h = heading + 0.6 * n1(acc * 0.01, 21) + (acc > 60 ? 0.35 * Math.sin(acc * 0.012) : 0);
    x += Math.cos(h) * 2;
    z += Math.sin(h) * 2;
  }
  const path = new Path(def.id, pts);
  // 采样主地形 → 平滑 → 有界起伏，并锚定两端以防岔口产生断崖
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
    // 与线性下降混合，保证可走；末端权重收敛到 1，确保真正落地到 endV。
    const linear = lerp(mainPath.elevAt(wp.s), endV, Math.pow(t, 0.8));
    const mix = Math.max(1 - smoothstep(0, 0.1, t), lerp(0.55, 1, smoothstep(0.65, 1, t)));
    let v = lerp(sum / c, linear, mix);
    if (def.undulations) v += (def.undulations / 25) * Math.sin(t * Math.PI * 8) * Math.sin(t * Math.PI);
    else if (i > 0) v = Math.min(v, prev - 0.02);
    v = Math.max(v, endV);
    path.e[i] = v;
    path.t[i] = t < (def.forestAt || 0) ? 'stone' : def.terrain;
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
      if (nb.d < trailD) { trailD = nb.d; type = b.typeAt(nb.s); onBranch = true; }
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
