// 区块网格：把高度场转成体素表面（顶面 + 暴露侧面），并把树木、玛尼堆、石块合并进同一几何体。
import * as THREE from 'three';
import { VoxBuilder, voxMaterial } from './models.js';
import { columnInfo, mainPath, branches } from './terrain.js';
import { hash2 } from './noise.js';
import { voxToAlt } from '../data/route.js';

export const CS = 32;
const AO_LEVEL = [0.6, 0.74, 0.88, 1.0];

const C = {
  snow: new THREE.Color(0xeef3f7),
  snowBlue: new THREE.Color(0xdde7ef),
  trail: new THREE.Color(0xc4c9cc),
  forestTrail: new THREE.Color(0xb9b2a4),
  forestFloor: new THREE.Color(0xe2e8ea),
  rock: new THREE.Color(0x868b92),
  rockDark: new THREE.Color(0x70757c),
  rockSide: new THREE.Color(0x9097a0),
  stone: new THREE.Color(0x9a9da1),
  stoneB: new THREE.Color(0x83878b),
  ice: new THREE.Color(0xa6d2e4),
  dirt: new THREE.Color(0x6b5a45),
  grass: new THREE.Color(0x8a8160),
};
const tmp = new THREE.Color();

// 全线玛尼堆（路标）：游戏逻辑也会用到
export const CAIRNS = [];
(function buildCairns() {
  const add = (path, spacingFn, startS) => {
    let s = startS;
    let k = 0;
    while (s < path.length - 4) {
      const p = path.pointAt(s);
      const side = k % 2 === 0 ? 1 : -1;
      CAIRNS.push({ x: p.x - p.dz * 2.0 * side, z: p.z + p.dx * 2.0 * side, s, path: path.id });
      s += spacingFn(s, path);
      k++;
    }
  };
  add(mainPath, (s, p) => (p.typeAt(s) === 'stone' ? 46 : p.typeAt(s) === 'forest' ? 34 : 28), 40);
  for (const b of Object.values(branches)) add(b, () => 30, 14);
})();

const cairnGrid = new Map();
for (const c of CAIRNS) {
  const k = Math.floor(c.x / CS) + ',' + Math.floor(c.z / CS);
  if (!cairnGrid.has(k)) cairnGrid.set(k, []);
  cairnGrid.get(k).push(c);
}

function topColor(info, x, z, maxDrop, out) {
  const alt = voxToAlt(info.h);
  const r = hash2(x, z, 5);
  const v = 0.95 + r * 0.05;
  if (info.ice) return out.copy(C.ice).multiplyScalar(0.97 + r * 0.03);
  if (info.type === 'village') {
    if (info.d < 2) return out.copy(C.dirt).multiplyScalar(v);
    return out.copy(r > 0.7 ? C.grass : C.forestFloor).multiplyScalar(v);
  }
  if (info.d < 1.25 && info.type !== 'stone') {
    return out.copy(info.type === 'forest' ? C.forestTrail : C.trail).multiplyScalar(v);
  }
  if (maxDrop >= 3) return out.copy(r > 0.5 ? C.rock : C.rockDark).multiplyScalar(v);
  if (info.type === 'stone' && info.d < 34) {
    if (hash2(x, z, 11) > 0.42) return out.copy(r > 0.3 ? C.snow : C.snowBlue).multiplyScalar(v);
    return out.copy(r > 0.5 ? C.stone : C.stoneB).multiplyScalar(0.92 + r * 0.12);
  }
  if (alt < 3250) return out.copy(C.forestFloor).multiplyScalar(v);
  if (hash2(x, z, 13) > 0.985) return out.copy(C.rock).multiplyScalar(v);
  return out.copy(r > 0.5 ? C.snow : C.snowBlue).multiplyScalar(v);
}

function addTree(vb, x, h, z, r) {
  const th = 1.4 + Math.floor(r * 3) * 0.5;
  vb.box(x + 0.38, h, z + 0.38, 0.24, th + 1.2, 0.24, 0x4a3426);
  const dark = r > 0.5 ? 0x1f3b2e : 0x26463a;
  let y = h + th * 0.55;
  const tiers = 3 + (r > 0.7 ? 1 : 0);
  for (let k = 0; k < tiers; k++) {
    const w = 2.4 - k * 0.55;
    const tH = 0.9;
    vb.box(x + 0.5 - w / 2, y, z + 0.5 - w / 2, w, tH, w, dark, false, 0xe6edf0);
    y += tH * 0.85;
  }
}

function addCairn(vb, c, h) {
  const x = c.x, z = c.z;
  vb.box(x - 0.36, h, z - 0.36, 0.72, 0.38, 0.72, 0x7c7f83, false, 0xdfe5ea);
  vb.box(x - 0.26, h + 0.38, z - 0.26, 0.52, 0.34, 0.52, 0x8a8d90);
  vb.box(x - 0.17, h + 0.72, z - 0.17, 0.34, 0.3, 0.34, 0x6f7276);
  // 红布条
  vb.box(x - 0.03, h + 1.02, z - 0.03, 0.06, 0.55, 0.06, 0x555555);
  vb.box(x + 0.03, h + 1.3, z - 0.02, 0.28, 0.14, 0.04, 0xd9302a);
}

export function buildChunk(cx, cz) {
  const x0 = cx * CS, z0 = cz * CS;
  const N = CS + 2;
  const hs = new Int16Array(N * N);
  const infos = new Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const info = columnInfo(x0 + i - 1, z0 + j - 1);
      hs[j * N + i] = info.h;
      infos[j * N + i] = info;
    }
  }
  const vb = new VoxBuilder();
  const col = new THREE.Color();
  const sideCol = new THREE.Color();
  const ao4 = [1, 1, 1, 1];
  for (let j = 1; j <= CS; j++) {
    for (let i = 1; i <= CS; i++) {
      const idx = j * N + i;
      const h = hs[idx];
      const info = infos[idx];
      const x = x0 + i - 1, z = z0 + j - 1;
      const hpx = hs[idx + 1], hnx = hs[idx - 1], hpz = hs[idx + N], hnz = hs[idx - N];
      const maxDrop = Math.max(h - hpx, h - hnx, h - hpz, h - hnz);
      topColor(info, x, z, maxDrop, col);
      // 体素 AO：相邻柱子比自己高时，压暗对应角
      const occ = (di, dj) => (hs[idx + dj * N + di] > h ? 1 : 0);
      const cornerAO = (sa, sb, c) => (sa && sb ? 0 : 3 - (sa + sb + c));
      const sW = occ(-1, 0), sE = occ(1, 0), sN = occ(0, -1), sS = occ(0, 1);
      const a0 = cornerAO(sW, sN, occ(-1, -1));
      const a1 = cornerAO(sW, sS, occ(-1, 1));
      const a2 = cornerAO(sE, sS, occ(1, 1));
      const a3 = cornerAO(sE, sN, occ(1, -1));
      ao4[0] = AO_LEVEL[a0]; ao4[1] = AO_LEVEL[a1]; ao4[2] = AO_LEVEL[a2]; ao4[3] = AO_LEVEL[a3];
      vb.topAO(x, z, x + 1, z + 1, h, col, ao4);
      const isSnowTop = !info.ice && col.r > 0.7 && col.b > 0.7;
      const sides = [['px', hpx], ['nx', hnx], ['pz', hpz], ['nz', hnz]];
      for (const [dir, nh] of sides) {
        if (nh >= h) continue;
        const bottom = Math.max(nh, h - 24);
        const drop = h - bottom;
        sideCol.copy(info.type === 'stone' ? C.stone : C.rockSide);
        if (isSnowTop && drop <= 2) sideCol.copy(C.snowBlue);
        vb.side(x, z, dir, bottom, h, sideCol, 1.0, drop > 3 ? 0.62 : 0.8);
      }
      // 装饰
      if (!info.ice && info.d > 2.6) {
        const alt = voxToAlt(h);
        const r = hash2(x, z, 31);
        const flat = maxDrop <= 1 && Math.max(hpx, hnx, hpz, hnz) - h <= 1;
        if (alt < 3260 && flat && (info.type === 'forest' || info.type === 'village' || info.type === 'meadow')) {
          const dens = info.type === 'village' ? 0.018 : alt > 3150 ? 0.03 : 0.075;
          if (r < dens) addTree(vb, x, h, z, hash2(x, z, 37));
        } else if (alt >= 3200 && flat && r < 0.006) {
          const s = 0.5 + hash2(x, z, 41) * 0.8;
          vb.box(x + 0.5 - s / 2, h, z + 0.5 - s / 2, s, s * 0.7, s, 0x77797c, false, 0xe4eaee);
        }
      }
    }
  }
  const cs = cairnGrid.get(cx + ',' + cz);
  if (cs) {
    for (const c of cs) {
      const lx = Math.floor(c.x) - x0 + 1, lz = Math.floor(c.z) - z0 + 1;
      const h = hs[lz * N + lx];
      addCairn(vb, c, h);
    }
  }
  const mesh = new THREE.Mesh(vb.build(), voxMaterial);
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return { mesh, hs, x0, z0 };
}
