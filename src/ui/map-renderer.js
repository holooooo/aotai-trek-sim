// 俯视地图 SVG 渲染器。底图是基于游戏地形采样的示意，不是真实遥感影像。
// 只返回字符串，不触碰 DOM，供 story-ui 通过 innerHTML 挂载。
import { mainPath, branches, columnInfo } from '../world/terrain.js';
import { WAYPOINTS, voxToAlt } from '../data/route.js';
import { makeNoise2D, fbm } from '../world/noise.js';

const DEFAULTS = { mode: 'satellite', scope: 'nearby', width: 720, height: 540 };
const GRID = { cols: 34, rows: 24 };
const MAX_CACHE = 24;
const terrainCache = new Map();

const MAP_LEGENDS = {
  satellite: [
    { label: '森林', color: '#2b4a2c' },
    { label: '草甸', color: '#8b9a58' },
    { label: '石海', color: '#8a867c' },
    { label: '积雪/冰面', color: '#e6eded' },
    { label: '路线', color: '#ff7a45' },
  ],
  elevation: [
    { label: '低地', color: '#4e8056' },
    { label: '林线', color: '#a5ad68' },
    { label: '高山', color: '#d3a06c' },
    { label: '高峰', color: '#f1e8d4' },
    { label: '等高线', color: '#614b43' },
  ],
};
export { MAP_LEGENDS };

const SURFACE = {
  forest: { color: '#35634a', pattern: 'forest', label: '森林' },
  village: { color: '#8f866c', pattern: 'meadow', label: '村落' },
  meadow: { color: '#7e9b65', pattern: 'meadow', label: '草甸' },
  plateau: { color: '#a39b71', pattern: 'meadow', label: '高山塬' },
  ridge: { color: '#9e9b8f', pattern: 'stone', label: '山脊' },
  knife: { color: '#84847f', pattern: 'stone', label: '刃脊' },
  stone: { color: '#8f8d86', pattern: 'stone', label: '石海' },
  snow: { color: '#d9e5e4', pattern: 'snow', label: '积雪' },
};

const escapeXml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
}[c]));
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
const n1 = (value) => Number(finite(value, 0).toFixed(1));
const safeDimension = (value, fallback) => clamp(Math.round(finite(value, fallback)), 120, 2000);

function hexToRgb(hex) {
  const raw = hex.replace('#', '');
  return [parseInt(raw.slice(0, 2), 16), parseInt(raw.slice(2, 4), 16), parseInt(raw.slice(4, 6), 16)];
}
function rgbToHex(rgb) {
  return `#${rgb.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')}`;
}
function shade(hex, amount) {
  const rgb = hexToRgb(hex);
  const target = amount < 0 ? 0 : 255;
  const ratio = Math.abs(amount);
  return rgbToHex(rgb.map((v) => v + (target - v) * ratio));
}
function elevationColor(alt) {
  const stops = [
    [1500, '#4e8056'],
    [2500, '#7e9b65'],
    [3100, '#b8a56e'],
    [3500, '#d3a06c'],
    [3800, '#f1e8d4'],
  ];
  const h = clamp(alt, stops[0][0], stops[stops.length - 1][0]);
  for (let i = 1; i < stops.length; i++) {
    if (h <= stops[i][0]) {
      const [a, ac] = stops[i - 1];
      const [b, bc] = stops[i];
      const t = (h - a) / (b - a);
      const ar = hexToRgb(ac), br = hexToRgb(bc);
      return rgbToHex(ar.map((v, j) => v + (br[j] - v) * t));
    }
  }
  return stops.at(-1)[1];
}
function surfaceFor(info) {
  const alt = voxToAlt(info.h);
  if (info.ice || (alt > 3460 && (info.type === 'ridge' || info.type === 'knife' || info.type === 'plateau'))) return SURFACE.snow;
  return SURFACE[info.type] || SURFACE.meadow;
}
function pathPoints(path, stride = 2) {
  if (!path || !path.n) return [];
  const out = [];
  for (let i = 0; i < path.n; i += stride) out.push({ x: path.x[i], z: path.z[i] });
  const last = path.n - 1;
  if (last >= 0 && (out.length === 0 || out[out.length - 1].x !== path.x[last] || out[out.length - 1].z !== path.z[last])) {
    out.push({ x: path.x[last], z: path.z[last] });
  }
  return out;
}
function routePaths() {
  return [{ id: 'main', path: mainPath }, ...Object.values(branches).map((path) => ({ id: path.id, path }))];
}
function playerPosition(st) {
  if (st?.pos && Number.isFinite(Number(st.pos.x)) && Number.isFinite(Number(st.pos.z))) return { x: Number(st.pos.x), z: Number(st.pos.z) };
  const route = st?.path && st.path !== 'main' ? branches[st.path] : mainPath;
  const p = route?.pointAt(finite(st?.s, 0));
  return p ? { x: p.x, z: p.z } : { x: mainPath.x[0] || 0, z: mainPath.z[0] || 0 };
}
function boundsFor(st, scope) {
  const paths = routePaths();
  if (scope === 'nearby') {
    const p = playerPosition(st);
    const radius = 330;
    const centerX = Math.round(p.x / 8) * 8;
    const centerZ = Math.round(p.z / 8) * 8;
    return { minX: centerX - radius, maxX: centerX + radius, minZ: centerZ - radius, maxZ: centerZ + radius };
  }
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const { path } of paths) {
    for (let i = 0; i < path.n; i += 8) {
      minX = Math.min(minX, path.x[i]); maxX = Math.max(maxX, path.x[i]);
      minZ = Math.min(minZ, path.z[i]); maxZ = Math.max(maxZ, path.z[i]);
    }
  }
  if (!Number.isFinite(minX)) return { minX: -1, maxX: 1, minZ: -1, maxZ: 1 };
  const pad = Math.max(20, Math.max(maxX - minX, maxZ - minZ) * 0.06);
  return { minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad };
}
function fitBounds(bounds, width, height) {
  const minX = bounds.minX, maxX = bounds.maxX, minZ = bounds.minZ, maxZ = bounds.maxZ;
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  let spanX = Math.max(1, maxX - minX), spanZ = Math.max(1, maxZ - minZ);
  const ratio = width / height;
  if (spanX / spanZ < ratio) spanX = spanZ * ratio;
  else spanZ = spanX / ratio;
  return { minX: cx - spanX / 2, maxX: cx + spanX / 2, minZ: cz - spanZ / 2, maxZ: cz + spanZ / 2 };
}
function terrainKey(bounds, width, height, mode, scope) {
  return [mode, scope, width, height, ...['minX', 'maxX', 'minZ', 'maxZ'].map((key) => Math.round(bounds[key] / 8))].join(':');
}
function satelliteDefs(width, height) {
  const soften = n1(Math.max(width / SAT.cols, height / SAT.rows) * 0.34);
  return [
    `<filter id="map-sat-soften" x="-2%" y="-2%" width="104%" height="104%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="${soften}"/></filter>`,
    '<filter id="map-sat-grain" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="11" result="n"/><feColorMatrix type="matrix" values="0 0 0 0 .5  0 0 0 0 .5  0 0 0 0 .5  .9 .9 .9 0 -.8"/></filter>',
    '<filter id="map-sat-canopy" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency=".2" numOctaves="4" seed="5"/><feColorMatrix type="matrix" values="2.4 0 0 0 -.7  2.4 0 0 0 -.7  2.4 0 0 0 -.7  0 0 0 0 1"/></filter>',
    '<radialGradient id="map-sat-vignette" cx="50%" cy="50%" r="75%"><stop offset="55%" stop-color="#0b1410" stop-opacity="0"/><stop offset="100%" stop-color="#0b1410" stop-opacity=".48"/></radialGradient>',
    '<linearGradient id="map-sat-haze" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cfd9e2" stop-opacity=".1"/><stop offset=".45" stop-color="#cfd9e2" stop-opacity="0"/></linearGradient>',
  ].join('');
}
function mapTransform(bounds, width, height) {
  const sx = width / (bounds.maxX - bounds.minX);
  const sy = height / (bounds.maxZ - bounds.minZ);
  return {
    x: (worldX) => (worldX - bounds.minX) * sx,
    y: (worldZ) => height - (worldZ - bounds.minZ) * sy,
  };
}

const SAT = { cols: 104, rows: 76, margin: 3 };
const SAT_BASE = {
  forest: [38, 64, 40],
  village: [124, 118, 92],
  meadow: [128, 148, 82],
  plateau: [152, 142, 98],
  ridge: [138, 133, 122],
  knife: [118, 114, 108],
  stone: [136, 132, 122],
  snow: [232, 238, 238],
};
const SAT_NOISE = { macro: makeNoise2D(21), meso: makeNoise2D(53), fine: makeNoise2D(87), warpX: makeNoise2D(111), warpZ: makeNoise2D(137) };
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function satelliteSurface(info) {
  const surface = surfaceFor(info);
  const key = Object.keys(SURFACE).find((k) => SURFACE[k] === surface) || 'meadow';
  return { key, base: SAT_BASE[key] || SAT_BASE.meadow, ice: !!info.ice };
}

function satelliteTerrain(bounds, width, height) {
  const spanX = bounds.maxX - bounds.minX, spanZ = bounds.maxZ - bounds.minZ;
  const cols = SAT.cols + SAT.margin * 2, rows = SAT.rows + SAT.margin * 2;
  const wx = spanX / SAT.cols, wz = spanZ / SAT.rows;
  const cellW = width / SAT.cols, cellH = height / SAT.rows;
  const cellSize = (wx + wz) / 2;
  const warp = Math.max(18, cellSize * 4);
  const grid = new Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = bounds.minX + (c - SAT.margin + 0.5) * wx;
      const z = bounds.maxZ - (r - SAT.margin + 0.5) * wz;
      const info = columnInfo(Math.floor(x), Math.floor(z));
      // 地表类型在路线两侧是整齐的色带；用噪声扭曲取样位置，让林线/草甸边界变得自然。
      const ux = x + fbm(SAT_NOISE.warpX, x * 0.011, z * 0.011, 3) * warp;
      const uz = z + fbm(SAT_NOISE.warpZ, x * 0.011, z * 0.011, 3) * warp;
      const surfaceInfo = columnInfo(Math.floor(ux), Math.floor(uz));
      grid[r * cols + c] = { x, z, info, surfaceInfo };
    }
  }
  const idx = (c, r) => clamp(r, 0, rows - 1) * cols + clamp(c, 0, cols - 1);
  const hAt = (c, r) => grid[idx(c, r)].info.h;
  const smoothH = (c, r) => (hAt(c, r) * 4 + hAt(c - 1, r) * 2 + hAt(c + 1, r) * 2 + hAt(c, r - 1) * 2 + hAt(c, r + 1) * 2 + hAt(c - 1, r - 1) + hAt(c + 1, r - 1) + hAt(c - 1, r + 1) + hAt(c + 1, r + 1)) / 16;

  let color = new Array(cols * rows);
  for (let k = 0; k < grid.length; k++) {
    const { x, z, info, surfaceInfo } = grid[k];
    const alt = voxToAlt(info.h);
    const sf = satelliteSurface(surfaceInfo);
    const macro = fbm(SAT_NOISE.macro, x * 0.0045, z * 0.0045, 3);
    const meso = fbm(SAT_NOISE.meso, x * 0.02, z * 0.02, 3);
    const fine = SAT_NOISE.fine(x * 0.11, z * 0.11);
    let rgb = sf.base;
    if (sf.key === 'forest') {
      rgb = mix3(rgb, [24, 46, 30], clamp(0.5 + meso * 0.7, 0, 1) * 0.6);
      rgb = mix3(rgb, [70, 94, 54], clamp(0.5 + macro * 0.9, 0, 1) * 0.4);
      rgb = mix3(rgb, [20, 36, 26], clamp(0.5 + fine * 0.8, 0, 1) * 0.3);
    } else if (sf.key === 'meadow' || sf.key === 'plateau' || sf.key === 'village') {
      rgb = mix3(rgb, [98, 126, 68], clamp(0.5 + macro * 1.1, 0, 1) * 0.5);
      rgb = mix3(rgb, [178, 166, 110], clamp(0.5 + meso * 0.9, 0, 1) * 0.45);
      rgb = mix3(rgb, [96, 106, 64], clamp(0.5 + fine * 0.8, 0, 1) * 0.22);
    } else if (sf.key === 'snow') {
      rgb = mix3(rgb, [206, 220, 226], clamp(0.5 + meso * 0.9, 0, 1) * 0.5);
    } else {
      rgb = mix3(rgb, [108, 104, 98], clamp(0.5 + meso * 1.1, 0, 1) * 0.42);
      rgb = mix3(rgb, [172, 165, 152], clamp(0.5 + fine * 1.1, 0, 1) * 0.3);
    }
    if (alt > 3000 && !['snow', 'stone', 'ridge', 'knife'].includes(sf.key)) {
      rgb = mix3(rgb, [152, 144, 108], clamp((alt - 3000) / 600, 0, 0.6));
    }
    if (sf.ice) rgb = mix3([208, 226, 234], [170, 198, 214], clamp(0.5 + meso, 0, 1) * 0.6);
    color[k] = rgb;
  }
  // 一次 3x3 高斯平滑，让不同地表之间出现渐变过渡
  for (let pass = 0; pass < 1; pass++) {
    const next = new Array(color.length);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let R = 0, G = 0, B = 0, W = 0;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const w = (2 - Math.abs(dr)) * (2 - Math.abs(dc));
            const v = color[idx(c + dc, r + dr)];
            R += v[0] * w; G += v[1] * w; B += v[2] * w; W += w;
          }
        }
        next[r * cols + c] = [R / W, G / W, B / W];
      }
    }
    color = next;
  }

  const runs = new Map();
  for (let r = 0; r < rows; r++) {
    let runColor = null, runStart = 0;
    const flush = (endCol) => {
      if (runColor === null) return;
      const x0 = (runStart - SAT.margin) * cellW, y0 = (r - SAT.margin) * cellH;
      const w = (endCol - runStart) * cellW + 0.6;
      let list = runs.get(runColor);
      if (!list) runs.set(runColor, (list = []));
      list.push(`M${n1(x0)},${n1(y0)}h${n1(w)}v${n1(cellH + 0.6)}h-${n1(w)}Z`);
    };
    for (let c = 0; c < cols; c++) {
      const { info } = grid[r * cols + c];
      const alt = voxToAlt(info.h);
      // 西北方向光源的山体阴影 + 谷底略暗；用较宽的核避免石海单格高度噪声造成斑驳
      const dx = (smoothH(c - 2, r) - smoothH(c + 2, r)) / (4 * cellSize);
      const dz = (smoothH(c, r + 2) - smoothH(c, r - 2)) / (4 * cellSize);
      const slope = clamp(dx * 0.62 + dz * 0.78, -1.2, 1.2);
      const ao = clamp((smoothH(c, r) - (smoothH(c - 3, r) + smoothH(c + 3, r) + smoothH(c, r - 3) + smoothH(c, r + 3)) / 4) * 0.05, -0.1, 0.08);
      const light = clamp(1 + slope * 0.85 + ao, 0.58, 1.36);
      let [R, G, B] = color[r * cols + c].map((v) => v * light);
      const cool = clamp((alt - 2400) / 1800, 0, 1) * 0.07;
      R *= 1 - cool; B *= 1 + cool * 0.8;
      if (info.d < 1.4 && info.type !== 'snow') { R += 10; G += 8; B += 4; }
      const q = (v) => clamp(Math.round(v / 4) * 4, 0, 255);
      const hex = rgbToHex([q(R), q(G), q(B)]);
      if (hex !== runColor) { flush(c); runColor = hex; runStart = c; }
    }
    flush(cols);
  }
  const out = [];
  for (const [hex, d] of runs) out.push(`<path d="${d.join('')}" fill="${hex}"/>`);
  return `<g filter="url(#map-sat-soften)">${out.join('')}</g>`;
}

function terrainFragment(bounds, width, height, mode, scope) {
  const key = terrainKey(bounds, width, height, mode, scope);
  const cached = terrainCache.get(key);
  if (cached) return cached;
  if (mode === 'satellite') {
    const fragment = satelliteTerrain(bounds, width, height);
    terrainCache.set(key, fragment);
    if (terrainCache.size > MAX_CACHE) terrainCache.delete(terrainCache.keys().next().value);
    return fragment;
  }
  const T = mapTransform(bounds, width, height);
  const cellW = width / GRID.cols, cellH = height / GRID.rows;
  const out = [];
  const cells = [];
  for (let row = 0; row < GRID.rows; row++) {
    for (let col = 0; col < GRID.cols; col++) {
      const x = bounds.minX + (col + 0.5) / GRID.cols * (bounds.maxX - bounds.minX);
      const z = bounds.maxZ - (row + 0.5) / GRID.rows * (bounds.maxZ - bounds.minZ);
      const info = columnInfo(Math.floor(x), Math.floor(z));
      const alt = voxToAlt(info.h);
      const east = columnInfo(Math.floor(x + (bounds.maxX - bounds.minX) / GRID.cols), Math.floor(z)).h;
      const north = columnInfo(Math.floor(x), Math.floor(z + (bounds.maxZ - bounds.minZ) / GRID.rows)).h;
      const slope = clamp(((info.h - east) + (info.h - north)) * 0.018, -0.22, 0.22);
      const surface = surfaceFor(info);
      const color = mode === 'elevation' ? elevationColor(alt) : shade(surface.color, slope);
      const rx = col * cellW, ry = row * cellH;
      cells.push({ x: rx, y: ry, color, surface, alt, h: info.h });
    }
  }
  const fills = new Map();
  for (const cell of cells) {
    const x = cell.x, y = cell.y, w = cellW + 0.5, h = cellH + 0.5;
    const rect = `M${n1(x)},${n1(y)}h${n1(w)}v${n1(h)}h-${n1(w)}Z`;
    let fillPath = fills.get(cell.color);
    if (!fillPath) fills.set(cell.color, (fillPath = []));
    fillPath.push(rect);
  }
  for (const [color, d] of fills) out.push(`<path d="${d.join('')}" fill="${color}"/>`);
  if (mode === 'elevation') {
    const values = cells.map((cell) => cell.h);
    const minLevel = Math.ceil(Math.min(...values) / 4) * 4;
    const maxLevel = Math.floor(Math.max(...values) / 4) * 4;
    const contours = new Map();
    const interpolate = (a, b, level) => (level - a) / (b - a || 1);
    for (let row = 0; row < GRID.rows - 1; row++) {
      for (let col = 0; col < GRID.cols - 1; col++) {
        const i = row * GRID.cols + col;
        const heights = [values[i], values[i + 1], values[i + GRID.cols + 1], values[i + GRID.cols]];
        const corners = [
          [col * cellW + cellW / 2, row * cellH + cellH / 2],
          [(col + 1) * cellW + cellW / 2, row * cellH + cellH / 2],
          [(col + 1) * cellW + cellW / 2, (row + 1) * cellH + cellH / 2],
          [col * cellW + cellW / 2, (row + 1) * cellH + cellH / 2],
        ];
        for (let level = minLevel; level <= maxLevel; level += 4) {
          const crossings = [];
          for (let edge = 0; edge < 4; edge++) {
            const next = (edge + 1) % 4;
            const a = heights[edge], b = heights[next];
            if ((a < level && b >= level) || (b < level && a >= level)) {
              const t = clamp(interpolate(a, b, level), 0, 1);
              crossings.push([
                corners[edge][0] + (corners[next][0] - corners[edge][0]) * t,
                corners[edge][1] + (corners[next][1] - corners[edge][1]) * t,
              ]);
            }
          }
          if (crossings.length >= 2) {
            let segments = contours.get(level);
            if (!segments) contours.set(level, (segments = []));
            for (let j = 0; j + 1 < crossings.length; j += 2) {
              segments.push(`M${n1(crossings[j][0])},${n1(crossings[j][1])}L${n1(crossings[j + 1][0])},${n1(crossings[j + 1][1])}`);
            }
          }
        }
      }
    }
    for (const [level, segments] of contours) {
      out.push(`<path d="${segments.join('')}" fill="none" stroke="#614b43" stroke-opacity="${level % 20 === 0 ? '.46' : '.22'}" stroke-width="${level % 20 === 0 ? '1.2' : '.7'}"/>`);
    }
  }
  const fragment = out.join('');
  terrainCache.set(key, fragment);
  if (terrainCache.size > MAX_CACHE) terrainCache.delete(terrainCache.keys().next().value);
  return fragment;
}
function routeD(path, T, stride = 2, bounds = null) {
  const points = pathPoints(path, stride);
  const segments = [];
  let current = [];
  const margin = bounds ? Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) * 0.03 : 0;
  for (const p of points) {
    const visible = !bounds || (p.x >= bounds.minX - margin && p.x <= bounds.maxX + margin && p.z >= bounds.minZ - margin && p.z <= bounds.maxZ + margin);
    if (visible) current.push(p);
    else if (current.length) { segments.push(current); current = []; }
  }
  if (current.length) segments.push(current);
  return segments.map((segment) => segment.map((p, i) => `${i ? 'L' : 'M'}${n1(T.x(p.x))},${n1(T.y(p.z))}`).join(' ')).join(' ');
}
function routeInBounds(path, bounds) {
  if (!path?.n) return false;
  for (let i = 0; i < path.n; i += 12) {
    if (path.x[i] >= bounds.minX && path.x[i] <= bounds.maxX && path.z[i] >= bounds.minZ && path.z[i] <= bounds.maxZ) return true;
  }
  return false;
}
function pathPrefixD(path, distance, T, stride = 2) {
  const points = [];
  for (let i = 0; i < path.n; i += stride) {
    if (path.s && path.s[i] > distance) break;
    points.push({ x: path.x[i], z: path.z[i] });
  }
  if (distance > 0 && distance < path.length && typeof path.pointAt === 'function') {
    const p = path.pointAt(distance);
    points.push({ x: p.x, z: p.z });
  }
  return points.map((p, i) => `${i ? 'L' : 'M'}${n1(T.x(p.x))},${n1(T.y(p.z))}`).join(' ');
}
function text(x, y, value, attrs = '') {
  return `<text x="${n1(x)}" y="${n1(y)}" ${attrs}>${escapeXml(value)}</text>`;
}
function progressMainS(st) {
  if (st?.path === 'main') return clamp(Math.max(finite(st?.maxS, 0), finite(st?.s, 0)), 0, mainPath.length);
  const branch = branches[st?.path];
  return clamp(Math.max(finite(st?.maxS, 0), finite(branch?.fromS, 0)), 0, mainPath.length);
}
function branchProgress(st, branch) {
  if (st?.path !== branch.id) return 0;
  return clamp(finite(st?.s, 0), 0, branch.length);
}

export function routeMapSVG(st = {}, options = {}) {
  const mode = options.mode === 'elevation' ? 'elevation' : DEFAULTS.mode;
  const scope = options.scope === 'all' ? 'all' : DEFAULTS.scope;
  const width = safeDimension(options.width, DEFAULTS.width);
  const height = safeDimension(options.height, DEFAULTS.height);
  const bounds = fitBounds(boundsFor(st, scope), width, height);
  const T = mapTransform(bounds, width, height);
  const clipId = `map-clip-${width}-${height}`;
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="鳌太线${mode === 'elevation' ? '高程' : '卫星式'}示意地图">`,
    `<defs><clipPath id="${clipId}"><rect width="${width}" height="${height}"/></clipPath>${mode === 'satellite' ? satelliteDefs(width, height) : ''}</defs>`,
    `<g clip-path="url(#${clipId})">`,
    terrainFragment(bounds, width, height, mode, scope),
    mode === 'satellite'
      ? `<rect width="${width}" height="${height}" filter="url(#map-sat-canopy)" opacity=".34" style="mix-blend-mode:overlay"/><rect width="${width}" height="${height}" filter="url(#map-sat-grain)" opacity=".16" style="mix-blend-mode:overlay"/><rect width="${width}" height="${height}" fill="url(#map-sat-haze)"/><rect width="${width}" height="${height}" fill="url(#map-sat-vignette)"/>`
      : '<rect width="100%" height="100%" fill="#122027" opacity=".08"/>',
  ];

  const visibleRoutes = routePaths().filter(({ path }) => scope === 'all' || routeInBounds(path, bounds));
  const allMainD = routeD(mainPath, T, scope === 'all' ? 8 : 4, scope === 'all' ? null : bounds);
  if (mode === 'satellite') out.push(`<path d="${allMainD}" fill="none" stroke="#0a120e" stroke-opacity=".5" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/>`);
  out.push(mode === 'satellite'
    ? `<path d="${allMainD}" data-route-id="main" fill="none" stroke="#f3efdf" stroke-opacity=".9" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`
    : `<path d="${allMainD}" data-route-id="main" fill="none" stroke="#182c2a" stroke-opacity=".75" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`);
  const mainProgress = progressMainS(st);
  if (mainProgress > 0) {
    const walked = pathPrefixD(mainPath, mainProgress, T, scope === 'all' ? 8 : 4);
    out.push(`<path d="${walked}" data-route-id="main-walked" fill="none" stroke="#ff7a45" stroke-opacity=".95" stroke-width="3.2" stroke-linecap="round"/>`);
  }
  for (const { id, path } of visibleRoutes.filter((route) => route.id !== 'main')) {
    const d = routeD(path, T, scope === 'all' ? 4 : 2, scope === 'all' ? null : bounds);
    out.push(`<path d="${d}" data-route-id="${escapeXml(id)}" fill="none" stroke="#b5d08a" stroke-width="4" stroke-opacity=".88" stroke-dasharray="7 5" stroke-linecap="round"/>`);
    const walked = branchProgress(st, path);
    if (walked > 0) {
      const count = Math.max(2, Math.round(path.n * walked / path.length));
      const partial = routeD({ n: count, x: path.x, z: path.z }, T, 1);
      out.push(`<path d="${partial}" data-route-id="${escapeXml(id)}-walked" fill="none" stroke="#f06b43" stroke-width="3.2" stroke-linecap="round"/>`);
    }
  }

  const wpRadius = scope === 'all' ? 4 : 5;
  for (const wp of WAYPOINTS) {
    const p = mainPath.pointAt(wp.s);
    const x = T.x(p.x), y = T.y(p.z);
    if (x < -30 || x > width + 30 || y < -30 || y > height + 30) continue;
    const visited = !!st?.visited?.[wp.id] || wp.s <= mainProgress;
    out.push(`<circle cx="${n1(x)}" cy="${n1(y)}" r="${wpRadius}" fill="${visited ? '#f06b43' : '#e7eee4'}" stroke="#20332f" stroke-width="1.4" data-waypoint-id="${escapeXml(wp.id)}"/>`);
    if (wp.camp) out.push(`<path d="M${n1(x - 5)},${n1(y - 6)}L${n1(x)},${n1(y - 11)}L${n1(x + 5)},${n1(y - 6)}Z" fill="#e3c47b" stroke="#20332f" stroke-width=".8"/>`);
    const anchor = x > width - 95 ? 'end' : 'start';
    const tx = x > width - 95 ? x - 8 : x + 8;
    out.push(text(tx, y - 8, wp.name, `font-size="11" fill="#f1f4eb" text-anchor="${anchor}" style="paint-order:stroke;stroke:#182521;stroke-width:3px;stroke-linejoin:round"`));
  }
  for (const { id, path } of visibleRoutes.filter((route) => route.id !== 'main')) {
    const end = path.pointAt(path.length);
    const x = T.x(end.x), y = T.y(end.z);
    if (x >= -30 && x <= width + 30 && y >= -30 && y <= height + 30) {
      out.push(`<rect x="${n1(x - 4)}" y="${n1(y - 4)}" width="8" height="8" fill="#b5d08a" stroke="#20332f" data-branch-end="${escapeXml(id)}"/>`);
      out.push(text(x + 8, y + 4, path.def?.endName || path.def?.name || id, 'font-size="11" fill="#e2f0c9" style="paint-order:stroke;stroke:#182521;stroke-width:3px"'));
    }
  }

  const player = playerPosition(st);
  const px = T.x(player.x), py = T.y(player.z);
  const playerRoute = st?.path === 'main' ? mainPath : branches[st?.path] || mainPath;
  const playerAt = playerRoute.pointAt(finite(st?.s, 0));
  const direction = st?.dir === -1 ? -1 : 1;
  const dx = playerAt?.dx * direction || 1, dz = playerAt?.dz * direction || 0;
  const len = Math.hypot(dx, dz) || 1;
  const ux = (dx / len) * 12, uy = (-dz / len) * 12;
  const lx = -uy * 0.55, ly = ux * 0.55;
  out.push(`<path d="M${n1(px + ux)},${n1(py + uy)}L${n1(px + lx)},${n1(py + ly)}L${n1(px - lx)},${n1(py - ly)}Z" fill="#ff6b43" stroke="#fff2e7" stroke-width="1.4" data-player-marker="true"/>`);
  out.push(text(clamp(px + 10, 14, width - 14), clamp(py + 24, 18, height - 18), '你', 'font-size="12" font-weight="700" fill="#fff2e7" style="paint-order:stroke;stroke:#182521;stroke-width:3px"'));
  out.push('</g>');

  const legend = MAP_LEGENDS[mode].map((item, i) => `<g transform="translate(${n1(14 + (i % 3) * 108)},${n1(height - 28 + Math.floor(i / 3) * 15)})"><rect width="9" height="9" rx="1" fill="${item.color}" stroke="#101a16" stroke-opacity=".6" stroke-width=".8"/><text x="14" y="9" font-size="10" fill="#f1f5ee" style="paint-order:stroke;stroke:#101a16;stroke-width:3px;stroke-linejoin:round">${escapeXml(item.label)}</text></g>`).join('');
  out.push(`<g>${legend}</g>`);
  out.push(text(width - 12, 16, scope === 'all' ? '全线概览' : '当前位置附近', 'font-size="11" fill="#e8efe7" text-anchor="end"'));  out.push(text(width - 12, height - 8, '游戏地形示意，非真实卫星影像/不可导航', 'font-size="10" fill="#e8efe7" text-anchor="end" style="paint-order:stroke;stroke:#182521;stroke-width:3px"'));
  out.push('</svg>');
  return out.join('');
}

export function clearMapTerrainCache() {
  terrainCache.clear();
}
