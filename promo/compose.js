// Promo overlay animation. Deterministic: window.renderFrame(t) poses everything for video time t (seconds).
import { icon } from '../src/ui/icons.js';

const $ = (s) => document.querySelector(s);
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
const ease = (x) => { x = clamp(x); return 1 - Math.pow(1 - x, 3); };
const pop = (x) => { x = clamp(x); return 1 - Math.pow(1 - x, 3) * (1 - 0.35 * x); };

const bgs = $('#bgs');
const layers = {};
/** background layer from a rendered shot's frames (30 fps, 1-indexed) */
function bg(name, dir, count, fit = 'cover') {
  const img = document.createElement('img');
  img.alt = '';
  bgs.appendChild(img);
  const cache = new Map();
  const get = (n) => {
    if (!cache.has(n)) {
      const i = new Image(); i.src = `build/frames/${dir}/${String(n).padStart(4, '0')}.jpg`;
      cache.set(n, i);
    }
    return cache.get(n);
  };
  for (let n = 1; n <= count; n += 6) get(n);   // warm the cache
  layers[name] = { img, count, get, fit };
}

bg('ridge', 'ridge', 108);
bg('hook', 'hook', 126);
bg('ridge2', 'ridge2', 102);
bg('fog', 'fog', 102);
bg('gate', 'gate', 102);
bg('village', 'village', 72);
bg('roles', 'rec_roles', 180);
bg('shop', 'rec_shop', 108);
bg('hud', 'rec_hud', 270);
bg('gust', 'gust', 120);
bg('blizzard', 'blizzard', 120);
bg('stall', 'stall', 210);
bg('gateui', 'rec_gate', 195);
bg('turn', 'turn', 84);
bg('sausage', 'sausage', 84);
bg('outro', 'outro', 315);

/** show one background; localT maps into its frames. Returns the element for motion. */
function showBg(name, localT, { speed = 1, zoom = 1, x = 0, y = 0, blur = 0, dim = 1, fit } = {}) {
  const L = layers[name];
  const n = clamp(Math.round(localT * speed * 30) + 1, 1, L.count);
  const src = L.get(n);
  if (L.img.src !== src.src) L.img.src = src.src;
  L.img.style.opacity = dim;
  L.img.style.objectFit = fit || L.fit;
  L.img.style.filter = blur ? `blur(${blur}px) brightness(${0.55 + dim * 0.45})` : 'none';
  L.img.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
  return L.img;
}
function hideBgs(except) {
  for (const [k, L] of Object.entries(layers)) if (k !== except) { L.img.style.opacity = 0; }
}

// —— 静态元素 ——
const pix = (name, size, color = 'currentColor', accent = '#ff5a1f') => icon(name, { size, color, accent });
document.querySelectorAll('.ico-sausage').forEach((e) => { e.innerHTML = pix('sausage', 22, '#e8eef2', '#ff5a1f'); });
$('.ico-core').innerHTML = pix('core', 30, '#e8eef2', '#ff5a1f');
$('.ico-baijiu').innerHTML = pix('baijiu' in {} ? 'baijiu' : 'food', 42, '#e8eef2', '#ffc23a');
$('.ico-snow').innerHTML = pix('heavysnow', 42, '#e8eef2', '#6fb7e0');
$('.ico-jacket').innerHTML = pix('wet', 42, '#e8eef2', '#ff5a1f');
$('.ico-storm').innerHTML = pix('blizzard', 28, '#e8eef2', '#6fb7e0');
$('.ico-warn').innerHTML = pix('warn', 24, '#ffd9d9', '#e5383b');
$('#bigSausage').innerHTML = pix('sausage', 150, '#e8eef2', '#ff5a1f');
$('#vTitle').src = 'build/frames/rec_title/0135.jpg';

// 海拔剖面（鳌太线：鳌山 3476 → 太白 3767，113km）
const PROFILE = [[0, 1740], [8, 2800], [14, 3476], [26, 3200], [40, 3600], [52, 2900], [64, 3500], [78, 3767], [90, 3100], [104, 1900], [113, 1700]];
const NAMES = [[0, '塘口'], [14, '鳌山'], [78, '太白'], [113, '东源']];
{
  const svg = $('#profile');
  const W = 440, H = 120, lo = 1500, hi = 4000;
  const X = (km) => (km / 113) * W, Y = (alt) => H - ((alt - lo) / (hi - lo)) * (H - 18) - 6;
  const d = PROFILE.map(([k, a], i) => `${i ? 'L' : 'M'}${X(k).toFixed(1)},${Y(a).toFixed(1)}`).join(' ');
  const area = `${d} L${W},${H} L0,${H} Z`;
  svg.innerHTML = `
    <defs><linearGradient id="pg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff5a1f" stop-opacity="0.55"/><stop offset="1" stop-color="#ff5a1f" stop-opacity="0"/></linearGradient></defs>
    <path d="${area}" fill="url(#pg)"/>
    <path id="pline" d="${d}" fill="none" stroke="#e8eef2" stroke-width="2.5" stroke-linejoin="round"/>
    ${NAMES.map(([k, n]) => `<g><line x1="${X(k)}" y1="${Y(PROFILE.reduce((b, p) => (Math.abs(p[0] - k) < Math.abs(b[0] - k) ? p : b))[1]) - 2}" x2="${X(k)}" y2="${H - 2}" stroke="rgba(255,255,255,.5)" stroke-width="1" stroke-dasharray="2 2"/>
      <text x="${X(k)}" y="${H - 4}" text-anchor="${k === 0 ? 'start' : k === 113 ? 'end' : 'middle'}">${n}</text></g>`).join('')}
    <circle id="pdot" r="4.5" fill="#ffc23a" stroke="#000" stroke-width="1.5"/>
    <text id="palt" class="alt" text-anchor="middle"></text>`;
}

// —— 时间轴 ——
const SCENES = [
  ['sIntro', 0.00, 1.95],
  ['sTease', 1.95, 5.14],
  ['sTitle', 5.14, 7.41],
  ['s46', 7.41, 9.73],
  ['sBan', 9.73, 11.96],
  ['sBrowser', 11.96, 15.02],
  ['sRoles', 15.02, 20.49],
  ['sVillage', 20.49, 21.55],
  ['sShop', 21.55, 23.54],
  ['sCold', 23.54, 30.66],
  ['sGust', 30.66, 33.46],
  ['sStorm', 33.46, 36.48],
  ['sHallu', 36.48, 42.28],
  ['sGateHi', 42.28, 46.10],
  ['sTurn', 46.10, 47.31],
  ['sScenic', 47.31, 50.37],
  ['sSlogan', 50.37, 52.54],
  ['sCard', 52.54, 60.00],
];
const SUBS = [
  [0.50, 1.83, '我做了个登山游戏。'],
  [1.99, 4.24, '它的<b>最佳结局</b>，你绝对猜不到。'],
  [5.14, 7.25, '<b>鳌太线</b>，秦岭最野的山脊。'],
  [7.41, 9.57, '至少 <b>46 人</b> 在这里失踪或遇难，'],
  [9.73, 11.80, '<b>2018 年</b>起禁止穿越。'],
  [11.96, 14.27, '所以，你可以在浏览器里<i>冻一冻</i>。'],
  [15.02, 17.63, '大学生：看完视频，我觉得我也行。'],
  [17.79, 20.33, '程序员：装备到位，就不会出事。'],
  [20.49, 22.74, '山脚小卖部，<b>烤肠永远售罄</b>。'],
  [23.54, 25.06, '进了山，<b>冷了怎么办</b>？'],
  [25.22, 26.72, '喝口白酒？——<i>更冷</i>。'],
  [26.88, 28.30, '吃口雪？——<i>更冷</i>。'],
  [28.46, 30.50, '穿羽绒服赶路？——<i>还是更冷</i>。'],
  [30.66, 32.61, '阵风来了，记得<b>按住空格</b>。'],
  [33.46, 36.32, '第二天，暴风雪来了，路标全看不见。'],
  [36.48, 39.27, '冻狠了，你还可能在雾里看见一个<b>烤肠摊</b>。'],
  [39.42, 41.48, '<b>别过去。</b> 那是你的幻觉。'],
  [42.28, 44.11, '所以，最佳结局是什么？'],
  [44.27, 47.15, '在管护站门口转身，去景区<b>买根烤肠</b>。'],
  [47.31, 49.42, '全游戏<b>唯一一个</b>不靠运气的结局。'],
  [50.37, 52.38, '门口没有烤肠的山，<b>不要爬</b>。'],
  [52.54, 58.6, '浏览器就能玩，代码全开源。<br>两个地址，扫码就能进。'],
];

const els = {};
document.querySelectorAll('.sc').forEach((e) => { els[e.id] = e; });
const set = (el, o) => { for (const [k, v] of Object.entries(o)) el.style[k] = v; };

function renderFrame(t) {
  // 背景
  const bgOf = () => {
    if (t < 1.95) return showBg('hook', t - 0.3, { zoom: 1.04, y: -10 });
    if (t < 5.14) return showBg('ridge2', t - 1.95, { zoom: lerp(1.06, 1.0, ease((t - 1.95) / 3.2)) });
    if (t < 7.41) return showBg('ridge', t - 5.14, { zoom: 1.02 });
    if (t < 9.73) return showBg('fog', t - 7.41, { zoom: 1.05 });
    if (t < 11.96) return showBg('gate', t - 9.73, { zoom: 1.02 });
    if (t < 15.02) return showBg('ridge', 2.2, { blur: 6, dim: 0.35 });
    if (t < 20.49) return showBg('roles', t - 15.02, { speed: 180 / 30 / 5.47 });
    if (t < 21.55) return showBg('village', (t - 20.49) * 1.6, { zoom: lerp(1.0, 1.06, ease((t - 20.49) / 1.06)) });
    if (t < 23.54) return showBg('shop', Math.min(t - 21.4, 3.4), { speed: 1 });
    if (t < 30.66) { const m = smooth((t - 25.05) / 0.25) * (1 - smooth((t - 30.45) / 0.2)); return showBg('hud', (t - 23.54) * (8.6 / 7.12), { zoom: 1 + m * 0.05, blur: m * 4, dim: 1 - m * 0.45 }); }
    if (t < 33.46) return showBg('gust', t - 30.66, { zoom: 1.04 });
    if (t < 36.48) return showBg('blizzard', t - 33.46, { zoom: 1.06 });
    if (t < 42.28) return showBg('stall', (t - 36.48) * (6.6 / 5.8), { zoom: 1.02 });
    if (t < 46.10) return showBg('gateui', Math.min(0.4 + Math.max(0, t - 42.28) * 0.9, 6.2));
    if (t < 47.31) return showBg('turn', t - 46.10, { zoom: 1.02 });
    if (t < 50.37) return showBg('sausage', Math.min((t - 47.31) * 1.3, 2.6), { zoom: lerp(1.0, 1.05, ease((t - 47.31) / 3)) });
    return showBg('outro', t - 50.37, { zoom: 1.0 });
  };
  const shown = bgOf();
  for (const L of Object.values(layers)) if (L.img !== shown) L.img.style.opacity = 0;

  // 场景层
  let cur = null;
  for (const [id, a, b] of SCENES) {
    const on = t >= a && t < b;
    const e = els[id];
    if (e.style.visibility !== (on ? 'visible' : 'hidden')) { e.style.visibility = on ? 'visible' : 'hidden'; e.style.opacity = on ? 1 : 0; }
    if (on) cur = [id, a, b];
  }
  const [id, a] = cur;
  const u = t - a;
  anim[id]?.(u, t);

  // 字幕
  const sub = SUBS.find(([s, e]) => t >= s && t < e);
  const st = $('#subText');
  if (sub) {
    if (st.dataset.k !== sub[2]) { st.dataset.k = sub[2]; st.innerHTML = sub[2]; }
    const k = Math.min(1, (t - sub[0]) / 0.18);
    set(st, { opacity: k < 1 ? k : 1, transform: `translateY(${(1 - ease(k)) * 10}px)` });
    $('#sub').style.opacity = 1;
  } else $('#sub').style.opacity = 0;

  $('#sub').style.bottom = t >= 52.54 ? '60px' : '252px';
  // 常驻角标
  const ui = (t >= 15.02 && t < 20.49) || (t >= 21.55 && t < 25.05) || (t >= 30.45 && t < 30.66) || (t >= 42.28 && t < 46.10);
  $('#chip').style.opacity = t > 1.6 && t < 52.4 && !ui ? 1 : 0;
  // 白色闪切
  const flashAt = [1.95, 7.41, 33.46, 42.28, 50.37];
  let f = 0;
  for (const ft of flashAt) { const d = t - ft; if (d >= 0 && d < 0.18) f = Math.max(f, 1 - d / 0.18); }
  $('#flash').style.opacity = f * 0.85;
  // 结霜（"冻一冻"）
  const frost = t > 12.3 && t < 15.1 ? smooth((t - 12.3) / 1.1) * (1 - smooth((t - 14.3) / 0.8)) : 0;
  $('#frost').style.opacity = frost;
}

const anim = {
  sIntro(u) {
    set($('.h1a'), { opacity: smooth(u / 0.35), transform: `translateY(${(1 - ease(u / 0.4)) * 16}px)` });
    set($('.h1b'), { opacity: smooth((u - 0.12) / 0.4), transform: `translateY(${(1 - ease((u - 0.12) / 0.45)) * 26}px)` });
    $('.kick').style.opacity = smooth((u - 0.3) / 0.4);
  },
  sTease(u) {
    const k = ease(u / 0.4);
    set($('.tease'), { opacity: k, transform: `translateY(${(1 - k) * 24}px)` });
    const w = smooth((u - 0.35) / 0.8);
    document.querySelectorAll('.redact i').forEach((e, i) => { e.style.transform = `scaleX(${clamp(w * 5 - i)})`; });
    const s = pop((u - 0.55) / 0.35);
    set($('#teaseStamp'), { opacity: s, transform: `rotate(-8deg) scale(${0.4 + 0.6 * s})` });
    const q = ease((u - 0.7) / 0.35);
    set($('.qq'), { opacity: q, transform: `translateY(${(1 - q) * 18}px)` });
  },
  sTitle(u) {
    set($('.logo'), { opacity: ease(u / 0.3), transform: `translateY(${(1 - ease(u / 0.35)) * 20}px)` });
    $('.logo-sub').style.opacity = smooth((u - 0.25) / 0.35);
    const len = 1000;
    $('#pline').style.strokeDasharray = len;
    $('#pline').style.strokeDashoffset = len * (1 - ease(u / 1.5));
    const km = ease((u - 0.2) / 1.6) * 113;
    const seg = PROFILE.findIndex((p, i) => PROFILE[i + 1] && PROFILE[i + 1][0] >= km);
    const [k0, a0] = PROFILE[Math.max(0, seg)], [k1, a1] = PROFILE[Math.min(PROFILE.length - 1, seg + 1)];
    const f = (km - k0) / Math.max(0.001, k1 - k0);
    const alt = lerp(a0, a1, clamp(f));
    const X = (k) => (k / 113) * 440, Y = (alt) => 120 - ((alt - 1500) / 2500) * 102 - 6;
    set($('#pdot'), { opacity: u > 0.25 ? 1 : 0, cx: X(km), cy: Y(alt) });
    const pa = $('#palt');
    pa.textContent = Math.round(alt) + ' m';
    set(pa, { opacity: u > 0.3 ? 1 : 0, x: X(km), y: Y(alt) - 10 });
  },
  s46(u) {
    const n = Math.round(ease(Math.min(1, u / 0.9)) * 46);
    $('#n46').textContent = n;
    const k = ease(u / 0.25);
    set($('.n46'), { opacity: k, transform: `scale(${0.86 + 0.14 * k})` });
    $('.n46pre').style.opacity = smooth(u / 0.3);
    $('.n46sub').style.opacity = smooth((u - 0.8) / 0.35);
    $('.n46src').style.opacity = smooth((u - 1.05) / 0.4) * 0.9;
  },
  sBan(u) {
    const s = pop(u / 0.32);
    set($('.ban'), { opacity: s, transform: `rotate(${-7 + Math.sin(u * 2.2) * 0.6}deg) scale(${0.7 + 0.3 * s})` });
    $('.ban-sub').style.opacity = smooth((u - 0.4) / 0.35);
  },
  sBrowser(u) {
    const k = ease(u / 0.4);
    set($('.browser'), { opacity: k, transform: `translateY(${(1 - k) * 30}px) scale(${0.94 + 0.06 * k})` });
    const ice = smooth((u - 0.55) / 1.0);
    $('#ice').style.opacity = ice;
    const fr = ease((u - 1.0) / 0.3);
    set($('.freeze'), { opacity: fr, transform: `scale(${0.8 + 0.2 * fr})` });
  },
  sRoles(u) {
    const s1 = u < 2.6 ? pop(u / 0.3) : 1 - smooth((u - 2.6) / 0.3);
    set($('#st1'), { opacity: s1, transform: `rotate(-6deg) scale(${0.6 + 0.4 * Math.min(1, s1 + 0.001)})` });
    const s2 = u > 2.95 ? pop((u - 2.95) / 0.3) : 0;
    set($('#st2'), { opacity: s2, transform: `rotate(4deg) scale(${0.6 + 0.4 * s2})` });
  },
  sVillage(u) {
    const k = ease(u / 0.35);
    set($('#sVillage .loc'), { opacity: k, transform: `translateY(${(1 - k) * 12}px)` });
  },
  sShop(u) {
    const s = pop((u - 0.15) / 0.3);
    set($('#soldStamp'), { opacity: s, transform: `rotate(${-9 + Math.sin(u * 3) * 0.8}deg) scale(${0.65 + 0.35 * s})` });
  },
  sCold(u) {
    // 23.54 ask, 25.22 白酒, 26.22 更冷, 26.88 吃雪, 27.74 更冷, 28.46 羽绒服, 29.70 还是更冷
    const rel = [0, 1.68, 2.68, 3.34, 4.20, 4.92, 6.16];
    const core = u < rel[1] ? 36.4 : u < rel[2] ? lerp(36.4, 35.9, smooth((u - rel[1]) / 0.5))
      : u < rel[3] ? 35.9 : u < rel[4] ? lerp(35.9, 35.3, smooth((u - rel[3]) / 0.5))
        : u < rel[5] ? 35.3 : lerp(35.3, 34.6, smooth((u - rel[5]) / 0.8));
    $('#tempNum').textContent = core.toFixed(1);
    $('#tempNum').style.color = core < 35 ? '#6fb7e0' : core < 36 ? '#ffc23a' : '#e8eef2';
    const tk = ease((u - 1.5) / 0.3);
    set($('.temp'), { opacity: tk, transform: `translate(-50%, ${(1 - tk) * 14}px)` });
    const ak = u < 1.45 ? ease((u - 0.1) / 0.35) * (1 - smooth((u - 1.3) / 0.15)) : 0;
    set($('#ask'), { opacity: Math.max(0, ak) });
    const item = (el, from, to) => {
      const k = u < from ? 0 : u < to ? pop((u - from) / 0.22) : 1 - smooth((u - to) / 0.16);
      set(el, { opacity: Math.max(0, k), transform: `translateX(${(1 - Math.min(1, k + 0.001)) * -24}px)` });
    };
    item($('#it1'), rel[1], rel[2] - 0.02);
    item($('#it2'), rel[3], rel[4] - 0.02);
    item($('#it3'), rel[5], rel[6] - 0.02);
    const cold = (el, from, to) => {
      const k = u < from ? 0 : u < to ? pop((u - from) / 0.16) : 1 - smooth((u - to) / 0.16);
      set(el, { opacity: Math.max(0, k), transform: `rotate(-7deg) scale(${0.8 + 0.2 * Math.min(1, k + 0.001)})` });
    };
    cold($('#c1'), rel[2], rel[3] - 0.02);
    cold($('#c2'), rel[4], rel[5] - 0.02);
    cold($('#c3'), rel[6], 6.95);
  },
  sGust(u) {
    const hit = 1.1;
    const g = u > hit && u < hit + 1.5 ? Math.sin(Math.min(1, (u - hit) / 1.4) * Math.PI) : 0;
    set($('#gustw'), { opacity: g, transform: `translateX(${(u - hit) * 70 - 30}px)` });
    const k = u > hit + 0.35 ? ease((u - hit - 0.35) / 0.3) : 0;
    const press = u > hit + 0.75 && u < hit + 1.9;
    set($('#key'), { opacity: k });
    set($('#cap'), { transform: press ? 'translateY(8px)' : 'none', boxShadow: press ? '0 2px 0 #69757f, 0 6px 0 #000' : '' });
  },
  sStorm(u) {
    const k = ease(u / 0.35);
    set($('#device'), { opacity: k, transform: `translateY(${(1 - k) * 16}px)` });
    const l = ease((u - 1.1) / 0.35);
    set($('#lost'), { opacity: l, transform: `translateX(${(1 - l) * -20}px)` });
  },
  sHallu(u) {
    const k = ease(u / 0.4);
    set($('#hdlg'), { opacity: k, transform: `translateY(${(1 - k) * 26}px)` });
    $('#ch1').classList.toggle('on', u > 1.3 && u < 2.75);
    const off = u > 4.5;
    $('#hdlg').style.filter = off ? 'grayscale(0.7) brightness(0.55)' : 'none';
    const tk = u > 3.0 && u < 5.6 ? ease((u - 3.0) / 0.3) * (u < 5.2 ? 1 : 1 - smooth((u - 5.2) / 0.35)) : 0;
    $('#htoast').style.opacity = tk;
  },
  sGateHi(u) {
    // 选项在录屏里的位置（405 宽 CSS 像素，合成页 540 宽，等比 1.333）
    const S = 540 / 405;
    const [x, y, w, h] = [30, 618.5, 345, 71.5].map((v, i) => v * S);
    const k = ease((u - 0.35) / 0.3) * (1 - smooth((u - 2.3) / 0.15));
    set($('#hlChoice'), { opacity: k, left: (x - 6) + 'px', top: (y - 6) + 'px', width: (w + 12) + 'px', height: (h + 12) + 'px' });
    const press = u > 1.85 && u < 2.3;
    const hk = ease((u - 1.5) / 0.3) * (1 - smooth((u - 2.25) / 0.15));
    set($('#hand'), { opacity: Math.max(0, hk), left: (x + w - 30) + 'px', top: (y + (press ? 34 : 22)) + 'px' });
  },
  sTurn(u) {
    const k = ease(u / 0.3);
    set($('#turnTag'), { opacity: k, transform: `translateY(${(1 - k) * 12}px)` });
  },
  sScenic(u) {
    document.querySelectorAll('#checks span').forEach((e, i) => {
      const k = pop((u - 0.1 - i * 0.28) / 0.3);
      set(e, { opacity: k, transform: `translateY(${(1 - k) * 14}px) scale(${0.9 + 0.1 * k})` });
    });
  },
  sSlogan(u) {
    const s = pop(u / 0.35);
    set($('#bigSausage'), { opacity: s, transform: `translateX(-50%) rotate(${-20 + s * 14}deg) scale(${0.6 + 0.4 * s})`, left: '50%' });
    const k = ease((u - 0.25) / 0.35);
    set($('#slogan'), { opacity: k, transform: `translateY(${(1 - k) * 16}px)` });
  },
  sCard(u) {
    const k = ease(u / 0.4);
    set($('#card'), { opacity: k, transform: `translateY(${(1 - k) * 24}px)` });
    const rows = [['#r1', 0.45], ['#r2', 1.15], ['#cmt', 2.3]];
    for (const [sel, at] of rows) {
      const r = pop((u - at) / 0.35);
      set($(sel), { opacity: r, transform: `translateY(${(1 - r) * 12}px)` });
    }
  },
};

window.renderFrame = renderFrame;
window.DURATION = 59.988;
renderFrame(0);
window.READY = true;
