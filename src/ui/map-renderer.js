// 俯视地图 SVG 渲染器。底图是基于游戏地形采样的示意，不是真实遥感影像。
// 只返回字符串，不触碰 DOM，供 story-ui 通过 innerHTML 挂载。
import { mainPath, branches, columnInfo } from '../world/terrain.js';
import { WAYPOINTS, voxToAlt } from '../data/route.js';

const DEFAULTS = { mode: 'satellite', scope: 'nearby', width: 720, height: 540 };
const GRID = { cols: 34, rows: 24 };
const MAX_CACHE = 24;
const terrainCache = new Map();

const MAP_LEGENDS = {
  satellite: [
    { label: '森林', color: '#35634a' },
    { label: '草甸', color: '#7e9b65' },
    { label: '石海', color: '#8f8d86' },
    { label: '积雪/冰面', color: '#d9e5e4' },
    { label: '路线', color: '#e85d3f' },
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
function patternDefs() {
  return [
    '<pattern id="map-forest" width="18" height="18" patternUnits="userSpaceOnUse"><path d="M3 13l3-6 3 6zM12 16l3-7 3 7z" fill="#b2cf98" opacity=".22"/><circle cx="4" cy="3" r="1" fill="#d4e4ad" opacity=".24"/></pattern>',
    '<pattern id="map-meadow" width="16" height="16" patternUnits="userSpaceOnUse"><path d="M3 12l2-5m1 5l1-4m5 5l2-6m1 6l1-3" stroke="#dce4a8" stroke-width="1" opacity=".3"/></pattern>',
    '<pattern id="map-stone" width="22" height="18" patternUnits="userSpaceOnUse"><path d="M2 12l5-5 5 3-3 5zM15 6l4-3 3 5-4 3z" fill="#f1eee5" opacity=".18"/><path d="M2 13l6-2" stroke="#5d5a58" opacity=".22"/></pattern>',
    '<pattern id="map-snow" width="20" height="18" patternUnits="userSpaceOnUse"><path d="M0 13l8-3 12 2M4 4l8 3 8-2" fill="none" stroke="#fff" stroke-width="1.2" opacity=".42"/></pattern>',
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
function terrainFragment(bounds, width, height, mode, scope) {
  const key = terrainKey(bounds, width, height, mode, scope);
  const cached = terrainCache.get(key);
  if (cached) return cached;
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
  const patterns = new Map();
  for (const cell of cells) {
    const x = cell.x, y = cell.y, w = cellW + 0.5, h = cellH + 0.5;
    const rect = `M${n1(x)},${n1(y)}h${n1(w)}v${n1(h)}h-${n1(w)}Z`;
    let fillPath = fills.get(cell.color);
    if (!fillPath) fills.set(cell.color, (fillPath = []));
    fillPath.push(rect);
    if (mode === 'satellite') {
      let patternPath = patterns.get(cell.surface.pattern);
      if (!patternPath) patterns.set(cell.surface.pattern, (patternPath = []));
      patternPath.push(rect);
    }
  }
  for (const [color, d] of fills) out.push(`<path d="${d.join('')}" fill="${color}"/>`);
  for (const [pattern, d] of patterns) out.push(`<path d="${d.join('')}" fill="url(#map-${pattern})" opacity=".72"/>`);
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
    `<defs><clipPath id="${clipId}"><rect width="${width}" height="${height}"/></clipPath>${patternDefs()}</defs>`,
    `<g clip-path="url(#${clipId})">`,
    terrainFragment(bounds, width, height, mode, scope),
    '<rect width="100%" height="100%" fill="#122027" opacity=".08"/>',
  ];

  const visibleRoutes = routePaths().filter(({ path }) => scope === 'all' || routeInBounds(path, bounds));
  const allMainD = routeD(mainPath, T, scope === 'all' ? 8 : 4, scope === 'all' ? null : bounds);
  out.push(`<path d="${allMainD}" data-route-id="main" fill="none" stroke="#182c2a" stroke-opacity=".75" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`);
  const mainProgress = progressMainS(st);
  if (mainProgress > 0) {
    const walked = pathPrefixD(mainPath, mainProgress, T, scope === 'all' ? 8 : 4);
    out.push(`<path d="${walked}" data-route-id="main-walked" fill="none" stroke="#f06b43" stroke-opacity=".82" stroke-width="3.2" stroke-linecap="round"/>`);
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

  const legend = MAP_LEGENDS[mode].map((item, i) => `<g transform="translate(${n1(14 + (i % 3) * 108)},${n1(height - 28 + Math.floor(i / 3) * 15)})"><rect width="9" height="9" rx="1" fill="${item.color}"/><text x="14" y="9" font-size="10" fill="#e8efe7">${escapeXml(item.label)}</text></g>`).join('');
  out.push(`<g>${legend}</g>`);
  out.push(text(width - 12, 16, scope === 'all' ? '全线概览' : '当前位置附近', 'font-size="11" fill="#e8efe7" text-anchor="end"'));  out.push(text(width - 12, height - 8, '游戏地形示意，非真实卫星影像/不可导航', 'font-size="10" fill="#e8efe7" text-anchor="end" style="paint-order:stroke;stroke:#182521;stroke-width:3px"'));
  out.push('</svg>');
  return out.join('');
}

export function clearMapTerrainCache() {
  terrainCache.clear();
}
