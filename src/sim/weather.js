// 天气系统：半脚本化的天气日程 + 随机扰动。元旦期间冷空气过境。
import { mulberry32, makeNoise2D, clamp, lerp } from '../world/noise.js';

export const WEATHER = {
  clear: { name: '晴', icon: 'sun', vis: 260, wind: 5, precip: 0, temp: 0, overcast: 0, fog: 0, severity: 0 },
  cloudy: { name: '多云', icon: 'cloud', vis: 220, wind: 7, precip: 0, temp: 1, overcast: 0.35, fog: 0.1, severity: 0.1 },
  overcast: { name: '阴', icon: 'cloud', vis: 150, wind: 9, precip: 0, temp: 0, overcast: 0.75, fog: 0.3, severity: 0.2 },
  fog: { name: '大雾', icon: 'fog', vis: 20, wind: 4, precip: 0.04, temp: 0, overcast: 0.9, fog: 1, severity: 0.5 },
  snow: { name: '小雪', icon: 'snow', vis: 70, wind: 10, precip: 0.4, temp: -1, overcast: 0.85, fog: 0.5, severity: 0.45 },
  heavysnow: { name: '大雪', icon: 'snow', vis: 32, wind: 14, precip: 0.8, temp: -3, overcast: 1, fog: 0.75, severity: 0.75 },
  blizzard: { name: '暴风雪', icon: 'storm', vis: 11, wind: 23, precip: 1, temp: -6, overcast: 1, fog: 0.95, severity: 1, blizzard: true },
  gale: { name: '大风', icon: 'wind', vis: 170, wind: 19, precip: 0, temp: -2, overcast: 0.3, fog: 0.15, severity: 0.7, spindrift: true },
};

export const START_TIME = 5 * 60 + 30; // 12月31日 05:30（分钟，自 12月31日 00:00 起）
const D = 1440;

export function makeSchedule(seed) {
  const r = mulberry32(seed);
  const j = (h) => Math.round((r() - 0.5) * 2 * h * 60);
  const s = [];
  const push = (t, w, extra = {}) => s.push({ t, w, ...extra });
  // 第一天：晴 → 多云 → 午后起雾（鳌山一带典型）→ 晴冷之夜
  push(0, 'clear');
  push(11 * 60 + j(1), 'cloudy');
  push(14 * 60 + 30 + j(1.5), 'fog', { warn: 'fog' });
  push(17 * 60 + 30 + j(1), 'cloudy');
  push(20 * 60 + j(1), 'clear');
  // 第二天：冷锋过境
  const front = D + 13 * 60 + j(2.5) - (r() < 0.3 ? 4 * 60 : 0);
  push(D + 6 * 60, r() < 0.5 ? 'clear' : 'cloudy');
  push(D + 9 * 60 + j(1), 'overcast');
  push(front, 'snow', { warn: 'front' });
  push(front + 70 + j(0.5), 'heavysnow');
  push(front + 4 * 60 + j(1), 'blizzard');
  // 第三天：风雪渐弱 → 雾 → 晴冷
  const ease = 2 * D + 6 * 60 + j(2);
  push(ease, 'heavysnow');
  push(ease + 3 * 60, 'snow');
  push(2 * D + 13 * 60 + j(1), 'fog', { warn: 'fog' });
  push(2 * D + 17 * 60 + j(1), 'cloudy');
  push(2 * D + 20 * 60, 'clear');
  // 第四天：大风
  push(3 * D + 7 * 60 + j(1.5), 'gale', { warn: 'gale' });
  push(3 * D + 18 * 60 + j(1.5), 'cloudy');
  // 之后：随机
  let t = 4 * D + 2 * 60;
  const table = [['clear', 3], ['cloudy', 3], ['overcast', 2], ['fog', 2], ['snow', 2], ['heavysnow', 1.2], ['gale', 1], ['blizzard', 0.8]];
  const total = table.reduce((a, b) => a + b[1], 0);
  while (t < 14 * D) {
    let x = r() * total;
    let w = 'clear';
    for (const [id, p] of table) { if ((x -= p) <= 0) { w = id; break; } }
    const warn = ['blizzard', 'heavysnow', 'gale'].includes(w) ? 'front' : w === 'fog' ? 'fog' : null;
    push(t, w, warn ? { warn } : {});
    t += (3 + r() * 5) * 60;
  }
  s.sort((a, b) => a.t - b.t);
  return s;
}

const windNoise = makeNoise2D(99);

// 根据日程得到当前天气（含过渡）
export function weatherAt(schedule, time) {
  let i = 0;
  while (i < schedule.length - 1 && schedule[i + 1].t <= time) i++;
  const cur = schedule[i];
  const prev = schedule[Math.max(0, i - 1)];
  const trans = 60;
  const k = i === 0 ? 1 : clamp((time - cur.t) / trans, 0, 1);
  const A = WEATHER[prev.w], B = WEATHER[cur.w];
  const mix = (key) => lerp(A[key], B[key], k);
  const next = schedule[i + 1];
  // 风向：西北风为主，锋面过境时偏西，过后转北
  let dirDeg = 312 + windNoise(time * 0.002, 3) * 28;
  if (cur.w === 'blizzard' || cur.w === 'heavysnow') dirDeg = 285 + windNoise(time * 0.004, 7) * 20;
  if (cur.w === 'gale') dirDeg = 330 + windNoise(time * 0.003, 9) * 15;
  const gust = 1 + 0.35 * windNoise(time * 0.08, 1) + 0.15 * windNoise(time * 0.5, 2);
  return {
    id: cur.w,
    name: k < 0.5 ? A.name : B.name,
    icon: k < 0.5 ? A.icon : B.icon,
    vis: mix('vis'),
    wind: mix('wind'),
    precip: mix('precip'),
    temp: mix('temp'),
    overcast: mix('overcast'),
    fog: mix('fog'),
    severity: mix('severity'),
    blizzard: !!B.blizzard && k > 0.5,
    spindrift: !!B.spindrift && k > 0.5,
    dirDeg: (dirDeg + 360) % 360,
    gust,
    next,
    idx: i,
  };
}

// 风"来向"的单位向量（北 = -z，东 = +x），以及风吹去的方向
export function windVectors(dirDeg) {
  const th = (dirDeg * Math.PI) / 180;
  const from = { x: Math.sin(th), z: -Math.cos(th) };
  return { from, to: { x: -from.x, z: -from.z } };
}

export function compassName(deg) {
  const names = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
  return names[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

export function beaufort(ms) {
  const t = [0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];
  let b = 0;
  while (b < t.length && ms >= t[b]) b++;
  return b;
}

// 气温（℃）：冬季1月，3500m 日均约 -13.5℃
export function airTemp(alt, hour, wx, day, minTemp = -Infinity) {
  const diurnal = 6 * Math.cos((2 * Math.PI * (hour - 14)) / 24);
  const lapse = (3500 - alt) * 0.0062;
  const night = hour < 7.5 || hour > 18 ? 1 : 0;
  const radiative = night * -3 * (1 - wx.overcast);
  const snap = day >= 1 && day <= 3 ? -2 : 0;
  const raw = -13.5 + diurnal + lapse + wx.temp + radiative + snap;
  return Math.max(Number.isFinite(minTemp) ? minTemp : -Infinity, raw);
}

export function windChill(T, ms) {
  const V = ms * 3.6;
  if (V < 4.8 || T > 10) return T;
  const p = Math.pow(V, 0.16);
  return 13.12 + 0.6215 * T - 11.37 * p + 0.3965 * T * p;
}

export function sunElevation(hour) {
  // 1月：日出约 07:50，日落约 17:50
  const rise = 7.8, set = 17.8;
  if (hour >= rise && hour <= set) return Math.sin((Math.PI * (hour - rise)) / (set - rise));
  const h = hour < rise ? hour + 24 : hour;
  return -Math.sin((Math.PI * (h - set)) / (24 + rise - set)) * 0.9;
}
