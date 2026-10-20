// 海拔剖面图（"救援档案"风格）：纯 SVG 字符串，无依赖。
// 用法：container.innerHTML = profileSVG({ waypoints, branch, currentKm, ... })
// 底色透明，由容器提供深石板色背景；字体通过 CSS 变量 --display / --mono 继承。

const ALT_MIN = 1400;
const ALT_MAX = 3900;
// 左：海拔刻度；上：方向提示 + 斜置的途经点名称（-60° 的 5 字名称约需 45px 高）；右：给末端名称留空；下：公里刻度
const MARGIN = { l: 44, r: 30, t: 44, b: 26 };

const COL = {
  line: '#d6e2ec',
  fill: 'rgba(214,226,236,0.10)',
  walked: '#ff5a1f',
  grid: 'rgba(255,255,255,0.08)',
  guide: 'rgba(255,255,255,0.06)',
  axis: '#8a9aa8',
  label: '#c9d3db',
  water: '#6fb7e0',
  branch: '#7bd389',
  camp: '#e8c170',
  signal: '#b6c4d0',
  ink: '#0b1116',
};
const DISPLAY = "font-family:var(--display,'PingFang SC','Microsoft YaHei',sans-serif)";
const MONO = "font-family:var(--mono,ui-monospace,Menlo,monospace)";

const STYLE =
  '.pf-pulse{animation:pfp 1.4s ease-in-out infinite;transform-box:fill-box;transform-origin:center}' +
  '@keyframes pfp{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.45;transform:scale(1.5)}}';

const escapeXml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const n1 = (n) => +n.toFixed(1); // 控制输出体积
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** 在按 km 升序的途经点间线性插值，返回 km 处的海拔（越界则取端点）。 */
export function altAt(waypoints, km) {
  const n = waypoints.length;
  if (!n) return 0;
  if (km <= waypoints[0].km) return waypoints[0].alt;
  for (let i = 1; i < n; i++) {
    const a = waypoints[i - 1];
    const b = waypoints[i];
    if (km <= b.km) {
      const span = b.km - a.km;
      return span > 0 ? a.alt + ((b.alt - a.alt) * (km - a.km)) / span : b.alt;
    }
  }
  return waypoints[n - 1].alt;
}

export function profileSVG({
  waypoints,
  branch,
  currentKm = 0,
  maxKm = 0,
  onBranch = false,
  branchKm = 0,
  dir = 1,
  width = 720,
  height = 300,
}) {
  const wps = [...waypoints].sort((a, b) => a.km - b.km);
  const totalKm = wps[wps.length - 1].km || 1;
  const plotW = width - MARGIN.l - MARGIN.r;
  const plotH = height - MARGIN.t - MARGIN.b;
  const baseY = MARGIN.t + plotH;
  const X = (km) => MARGIN.l + (km / totalKm) * plotW;
  const Y = (alt) => MARGIN.t + ((ALT_MAX - alt) / (ALT_MAX - ALT_MIN)) * plotH;
  const pathOf = (pts) => pts.map(([km, alt], i) => `${i ? 'L' : 'M'}${n1(X(km))},${n1(Y(alt))}`).join('');
  const text = (x, y, s, attrs, font = DISPLAY) =>
    `<text x="${n1(x)}" y="${n1(y)}" ${attrs} style="${font}">${escapeXml(s)}</text>`;

  const out = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" ` +
      `preserveAspectRatio="xMidYMid meet" role="img" aria-label="鳌太线海拔剖面图">`,
    `<style>${STYLE}</style>`
  );

  // ---- 网格与坐标轴 ----
  for (const alt of [2000, 2500, 3000, 3500]) {
    const y = Y(alt);
    out.push(
      `<line x1="${MARGIN.l}" y1="${n1(y)}" x2="${width - MARGIN.r}" y2="${n1(y)}" stroke="${COL.grid}" stroke-dasharray="3 4"/>`,
      text(MARGIN.l - 6, y + 3.5, alt, `text-anchor="end" font-size="11" fill="${COL.axis}"`, MONO)
    );
  }
  out.push(
    `<line x1="${MARGIN.l}" y1="${baseY}" x2="${width - MARGIN.r}" y2="${baseY}" stroke="rgba(255,255,255,0.18)"/>`
  );
  for (let km = 0; km <= totalKm; km += 20) {
    const x = X(km);
    out.push(
      `<line x1="${n1(x)}" y1="${baseY}" x2="${n1(x)}" y2="${baseY + 3}" stroke="${COL.axis}"/>`,
      text(x, baseY + 15, `${km}km`, `text-anchor="middle" font-size="11" fill="${COL.axis}"`, MONO)
    );
  }

  // ---- 主线：填充面积 + 轮廓线 + 已走过的部分 ----
  const mainPts = wps.map((w) => [w.km, w.alt]);
  const mainPath = pathOf(mainPts);
  out.push(
    `<path d="${mainPath}L${n1(X(totalKm))},${baseY}L${n1(X(0))},${baseY}Z" fill="${COL.fill}"/>`,
    `<path d="${mainPath}" fill="none" stroke="${COL.line}" stroke-width="2" stroke-linejoin="round"/>`
  );
  const walkedTo = clamp(Math.max(maxKm, onBranch ? currentKm : 0), 0, totalKm);
  if (walkedTo > 0) {
    const pts = wps.filter((w) => w.km < walkedTo).map((w) => [w.km, w.alt]);
    pts.push([walkedTo, altAt(wps, walkedTo)]);
    out.push(
      `<path d="${pathOf(pts)}" fill="none" stroke="${COL.walked}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`
    );
  }

  // ---- 当前虚构下撤支线（示意：横向压缩到 lengthKm 的 60%） ----
  let branchAt = null; // 支线上 [x, y] 的插值函数
  if (branch) {
    const startAlt = branch.startAlt ?? altAt(wps, branch.fromKm);
    const endKm = branch.fromKm + branch.lengthKm * 0.6;
    const x0 = X(branch.fromKm), y0 = Y(startAlt), x1 = X(endKm), y1 = Y(branch.endAlt);
    branchAt = (f) => [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f];
    out.push(
      `<line x1="${n1(x0)}" y1="${n1(y0)}" x2="${n1(x1)}" y2="${n1(y1)}" stroke="${COL.branch}" stroke-width="2" stroke-dasharray="5 4"/>`,
      `<rect x="${n1(x1 - 3)}" y="${n1(y1 - 3)}" width="6" height="6" fill="none" stroke="${COL.branch}" stroke-width="1.5"/>`,
      text(x1 + 8, y1 + 3.5, branch.name, `font-size="10" fill="${COL.branch}"`)
    );
    if (onBranch) {
      const f = clamp(branchKm / (branch.lengthKm || 1), 0, 1);
      const [bx, by] = branchAt(f);
      out.push(
        `<line x1="${n1(x0)}" y1="${n1(y0)}" x2="${n1(bx)}" y2="${n1(by)}" stroke="${COL.walked}" stroke-width="3" stroke-linecap="round"/>`
      );
    }
  }

  // ---- 途经点：引导线、方块标记、营地/水源/信号图标、斜置名称 ----
  // 名称统一排在顶部一行（-60°），用垂直于文字基线的坐标 p 做简单错位，避免相邻名称叠在一起。
  const COS = 0.866, SIN = 0.5, SEP = 12;
  const labelY = MARGIN.t + 16;
  let prevP = -Infinity;
  for (const w of wps) {
    const x = X(w.km), y = Y(w.alt);
    const visited = w.visited ?? w.km <= maxKm;
    const topY = y - (w.camp ? 14 : 5); // 标记（含帐篷）顶端

    const ax = x + 4; // 文字主体在基线左上侧，右移半个字宽以对齐标记
    let ay = Math.min(labelY, y - (w.camp ? 15 : 9));
    let p = COS * ax + SIN * ay;
    if (p < prevP + SEP) {
      p = prevP + SEP;
      ay = (p - COS * ax) / SIN;
    }
    prevP = p;

    if (topY - ay > 4) {
      out.push(`<line x1="${n1(x)}" y1="${n1(topY)}" x2="${n1(x)}" y2="${n1(ay + 2)}" stroke="${COL.guide}"/>`);
    }
    out.push(
      `<rect x="${n1(x - 3)}" y="${n1(y - 3)}" width="6" height="6" fill="${visited ? COL.walked : COL.line}" ` +
        `stroke="${w.bailout ? COL.branch : COL.ink}" stroke-width="${w.bailout ? 1.5 : 1}"/>`
    );
    if (w.camp) {
      out.push(`<polygon points="${n1(x - 3.5)},${n1(y - 5.5)} ${n1(x + 3.5)},${n1(y - 5.5)} ${n1(x)},${n1(y - 12)}" fill="${COL.camp}"/>`);
    }
    if (w.water) out.push(`<circle cx="${n1(x - 6)}" cy="${n1(y + 11)}" r="2.5" fill="${COL.water}"/>`);
    if (w.signal > 0) {
      for (let i = 0; i < 3; i++) {
        const h = 3 + i * 2;
        out.push(
          `<rect x="${n1(x + 4 + i * 3)}" y="${n1(y + 14 - h)}" width="2" height="${h}" fill="${COL.signal}" opacity="${i < w.signal ? 1 : 0.25}"/>`
        );
      }
    }
    out.push(
      `<text transform="translate(${n1(ax)},${n1(ay)}) rotate(-60)" font-size="10" fill="${COL.label}" style="${DISPLAY}">${escapeXml(w.name)}</text>`
    );
  }

  // ---- 当前位置：脉冲圆点 + 竖线 + “你” ----
  let cx, cy;
  if (onBranch && branchAt) {
    [cx, cy] = branchAt(clamp(branchKm / (branch.lengthKm || 1), 0, 1));
  } else {
    const km = clamp(currentKm, 0, totalKm);
    cx = X(km);
    cy = Y(altAt(wps, km));
  }
  const above = cy - 28 >= labelY + 2; // 位置太高时把“你”放到标记下方，避开名称行
  const by = above ? cy - 28 : cy + 14;
  const bx = clamp(cx - 7, MARGIN.l - 2, width - 18); // 靠近边缘时平移，避免压住海拔刻度/出界
  out.push(
    `<line x1="${n1(cx)}" y1="${n1(above ? cy - 6 : cy + 6)}" x2="${n1(cx)}" y2="${n1(above ? by + 14 : by)}" stroke="${COL.walked}" stroke-width="1.5"/>`,
    `<rect x="${n1(bx)}" y="${n1(by)}" width="14" height="14" fill="${COL.walked}"/>`,
    text(bx + 7, by + 11.5, '你', `text-anchor="middle" font-size="11" font-weight="bold" fill="${COL.ink}"`),
    `<circle class="pf-pulse" cx="${n1(cx)}" cy="${n1(cy)}" r="6" fill="${COL.walked}"/>`,
    `<circle cx="${n1(cx)}" cy="${n1(cy)}" r="2.5" fill="#fff4ec"/>`
  );

  // ---- 右上角方向提示 ----
  const hint = onBranch ? `↘ ${branch?.name || '虚构支线'} · 游戏参考` : dir > 0 ? '→ 太白山 · 拔仙台' : '← 下撤 · 塘口';
  out.push(text(width - 8, 11, hint, `text-anchor="end" font-size="11" fill="${onBranch ? COL.branch : COL.label}"`));

  out.push('</svg>');
  return out.join('');
}
