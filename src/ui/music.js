// Music: 自适应、全程序化的背景音乐 (仅 Web Audio API, 无音频文件, 无依赖)。
// 秦岭鳌太线: 雪山之美与致命的危险。五声音阶 (宫商角徵羽) 古琴式拨弦 + 持续低鸣 + 心跳脉冲 + 高处风铃。
//
// 图:  各层 (pad / pluck / air / pulse / fx) --dry--> bus --> [M/S 展宽] --> 低通(cold 时闭合) --> out --> audio.output
//                                            \--send--> 低通 --> 卷积混响 --(rvOut)--> bus
//
// 古琴音色说明: Karplus-Strong 的反馈延迟线在原生 DelayNode 环路中最短只能一个渲染量子 (128 样本),
// 高于 ~340 Hz 的音会跑调, 因此这里用 "三角波 + 略失谐二次泛音 + 指甲噪声瞬态 + 快速下坠的低通" 来模拟弦的拨奏;
// 吟猱 (颤音/滑音) 用 setValueCurveAtTime 预先算好的音高曲线实现。
//
// 约束: 所有公开方法在音频未解锁 / ctx 非 running / 任何异常时都是静默空操作, 绝不抛错。

const STORAGE_KEY = 'aotai-music-vol';
const DEFAULT_VOL = 0.55;
const LOOKAHEAD = 0.3;     // 预调度窗口 (秒)
const MAX_VOICES = 12;     // 普通音符的同时发声上限
const HARD_CAP = 16;       // 过场音 / 脉冲的绝对上限
const EPS = 0.0001;        // 指数包络不能到 0
const ROOT = 50;           // D3 (MIDI), 全曲主音 "宫"

// 音阶 (相对 ROOT 的半音数)。大五声 = 宫商角徵羽; 小五声与 "色彩音" 随紧张度渗入。
const MAJOR = [0, 2, 4, 7, 9];     // D E F# A B
const MINOR = [0, 3, 5, 7, 10];    // D F G A C (与 MAJOR 按级数对齐, 可逐音替换)
const COLOR = [1, 6, 6, 8];        // 小二度 / 三全音 / 小六度
// 铺底和弦 [根音, 五音] (相对 ROOT), 皆为五声音阶内的纯五度: D-A, B-F#, E-B, A-E
const CHORDS = [[0, 7], [-3, 4], [2, 9], [-5, 2]];
const THIRD = [4, 3, 2, 2];        // 各和弦之上的 "三音" (D→F#, B→D, E→F#(sus2), A→B(sus2))

// 场景档案。pad/pluck/air/pulse: 各层基础电平; rest: 乐句间休止(秒); notes: 乐句音数;
// oct: 音区偏移; minor: 小五声倾向; third: 三音强度; sub: 低鸣; cad: 终止音级(0宫 2角 3徵 4羽);
// chords: 可用和弦; life: 乐句层寿命(秒, 仅坏结局, 之后只剩低鸣); drop: 铺底降八度; dark: 滤波系数。
const SCENES = {
  title:        { pad: 0.55, pluck: 1.00, air: 0.70, pulse: 0.00, rest: [5, 9],   notes: [4, 8], oct: 0.2,  minor: 0.15, third: 0.5, sub: 0,   cad: [4, 0, 2], chords: [1, 0, 2, 0], motif: 0.6,  space: 1.25 },
  trek:         { pad: 0.50, pluck: 0.75, air: 1.00, pulse: 1.00, rest: [9, 18],  notes: [2, 6], oct: 0,    minor: 0,    third: 0.3, sub: 0,   cad: [0, 3],    chords: [0, 2, 3, 0], motif: 0.35, space: 1.0 },
  camp:         { pad: 0.65, pluck: 0.55, air: 0.35, pulse: 0.55, rest: [14, 26], notes: [2, 4], oct: -0.4, minor: 0.1,  third: 0.4, sub: 0,   cad: [0, 3],    chords: [0, 3, 0, 2], motif: 0.4,  space: 1.3, dark: 0.8 },
  ending_good:  { pad: 0.60, pluck: 0.90, air: 1.00, pulse: 0.00, rest: [5, 9],   notes: [3, 7], oct: 0.3,  minor: 0,    third: 1.0, sub: 0,   cad: [0],       chords: [0, 2, 0, 0], motif: 0.6,  space: 1.15 },
  ending_bad:   { pad: 0.25, pluck: 0.40, air: 0.08, pulse: 0.00, rest: [16, 28], notes: [1, 3], oct: -0.8, minor: 0.8,  third: 0,   sub: 0.8, cad: [4],       chords: [0],          motif: 0,    space: 1.6, life: 75, drop: 12, dark: 0.7, dir: -1 },
  ending_mixed: { pad: 0.50, pluck: 0.70, air: 0.50, pulse: 0.10, rest: [8, 14],  notes: [2, 5], oct: 0,    minor: 0.5,  third: 0.8, sub: 0,   cad: [4, 0],    chords: [1, 0, 1, 2], motif: 0.5,  space: 1.2 },
};

const clamp01 = (v) => (v > 0 ? (v < 1 ? v : 1) : 0);
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
/** 五声音阶级数 (可跨八度, 允许负数) → 相对 ROOT 的半音 */
const pent = (idx) => Math.floor(idx / 5) * 12 + MAJOR[((idx % 5) + 5) % 5];

/** 源节点结束后断开整串节点, 让一次性音符不留残骸 */
function cleanup(src, nodes) {
  src.onended = () => { for (const n of nodes) { try { n.disconnect(); } catch (e) { /* 已断开 */ } } };
}

/** 白噪声缓冲 (指甲拨弦瞬态 / 滴答声) */
function makeNoise(ctx, seconds) {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/** 山谷混响脉冲响应: 立体声衰减噪声, 20 ms 预延迟, 高频随时间衰减得更快 (一阶低通系数渐小) */
function makeImpulse(ctx, seconds) {
  const sr = ctx.sampleRate, n = Math.floor(sr * seconds), pre = Math.floor(sr * 0.02);
  const buf = ctx.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let y = 0;
    for (let i = pre; i < n; i++) {
      const x = (i - pre) / (n - pre);
      y += (0.85 - 0.75 * Math.sqrt(x)) * ((Math.random() * 2 - 1) - y);
      d[i] = y * Math.exp(-5.5 * x) * (1 - x);
    }
  }
  return buf;
}

/**
 * 吟猱音高曲线 (单位 Hz)。type: 'yin' 吟(颤音) | 'up' 上滑 | 'sag' 下垂(危险时的走音)。
 * 所有类型都带拨弦瞬间的微小音高下坠; yin/up 结束于精确音高, sag 停在偏低处。
 */
function bendCurve(f, bend, dur) {
  const N = 96, D = Math.min(dur * 0.8, 1.8), c = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const x = (i / (N - 1)) * D;
    let s = 0.22 * Math.exp(-x / 0.03);
    if (bend.type === 'up') s -= bend.semi * Math.exp(-x / 0.14);
    else if (bend.type === 'sag') s -= bend.semi * (x / D);
    else s += bend.depth * Math.min(1, Math.max(0, (x - 0.12) / 0.3)) * Math.sin(2 * Math.PI * bend.rate * x) * (1 - x / D);
    c[i] = f * Math.pow(2, s / 12);
  }
  return { c, D };
}

export class Music {
  constructor(audio) {
    this._audio = audio;
    this._failed = false;
    this._vol = DEFAULT_VOL;
    try {
      const s = localStorage.getItem(STORAGE_KEY);
      const v = s === null ? NaN : parseFloat(s);
      if (isFinite(v)) this._vol = clamp01(v);
    } catch (e) { /* 无存储 */ }
    this._ctx = null;
    this._built = false;
    this._moodInit = false;
    this._m = { calm: 0.5, tension: 0, danger: 0, severity: 0, altitude: 1700, cold: 0, heartRate: 0.2 };
    this._night = false;
    this._resetState();
  }

  get volume() { return this._vol; }

  /** v: 0..1, 持久化到 localStorage */
  setVolume(v) {
    try {
      const n = +v;
      if (!isFinite(n)) return;
      this._vol = clamp01(n);
      try { localStorage.setItem(STORAGE_KEY, String(this._vol)); } catch (e) { /* ignore */ }
      this._applyVolume(0.15);
    } catch (e) { /* never throw */ }
  }

  /**
   * 每帧调用 (很便宜: 图参数每 0.25 s 才更新一次, 其余只是几个时间比较)。
   * mood: { scene, calm, tension, danger, night, severity, altitude, cold, heartRate }
   */
  update(dt, mood) {
    try {
      if (!this._ensure()) return;
      const ctx = this._ctx, now = ctx.currentTime;
      dt = dt > 0 ? Math.min(dt, 0.25) : 0.016;
      this._readMood(dt, mood);
      if (this._vol <= 0.002 || this._audio.muted) { this._queue.length = 0; this._nextPulse = 0; return; }

      const sc = SCENES[mood && mood.scene] ? mood.scene : 'trek';
      if (sc !== this._scene) this._setScene(sc, now);

      this._applyT += dt;
      if (this._applyT >= 0.25) { this._applyT = 0; this._applyMood(now); }

      this._pump(now);
      if (now >= this._nextPhrase) this._planPhrase(now);
      this._schedulePulse(now);
      this._scheduleAir(now);
      if (now >= this._nextChord) {
        const pool = SCENES[this._scene].chords.filter((c) => c !== this._chord);
        if (pool.length) { this._chord = pick(pool); this._tuneChord(this._chord, now, 3.5); }
        this._nextChord = now + rnd(22, 45);
      }
    } catch (e) { this._fail(e); }
  }

  /** 一次性音乐提示: 'waypoint' | 'danger' | 'rescue' | 'death' | 'camp' */
  stinger(name) {
    try {
      if (!this._ensure() || this._vol <= 0.002 || this._audio.muted) return;
      const now = this._ctx.currentTime;
      const last = this._lastSt[name];
      if (last !== undefined && now - last < 1.2) return;
      this._lastSt[name] = now;
      // 让位: 丢弃尚未播放的普通乐句, 暂时压低其他层 (约 5 s)
      this._queue = this._queue.filter((e) => e.st);
      this._nextPhrase = Math.max(this._nextPhrase, now + 7);
      this._duckUntil = now + 5;
      this._applyT = 1e9;
      this._playStinger(name, now + 0.05);
      this._pump(now);
    } catch (e) { this._fail(e); }
  }

  // ------------------------------------------------------------------ 内部: 状态与构建

  _resetState() {
    this._queue = [];          // 待调度事件 (按时间排序): {t, k, st, ...}
    this._voices = [];         // 各发声的结束时间 (用于限制复音)
    this._last = {};           // _set 的目标值缓存, 避免重复写入 AudioParam
    this._lastSt = {};
    this._scene = null; this._sceneAt = 0; this._sceneFadeUntil = 0;
    this._nextPhrase = 0; this._nextPulse = 0; this._nextAir = 0; this._nextChord = 0;
    this._chord = 0; this._subF = mtof(ROOT - 12); this._beat = 0.4;
    this._applyT = 1e9; this._duckUntil = 0;
    this._motif = null;
    this._pluckLevel = 0; this._airLevel = 0; this._pulseLevel = 0; this._tickLevel = 0; this._bpm = 60;
  }

  /** 只有 AudioContext 存在且 running 时才返回 true; 首次到达时构建整个图 */
  _ensure() {
    if (this._failed) return false;
    const ctx = this._audio && this._audio.context;
    if (!ctx || ctx.state !== 'running') return false;
    if (!this._built || this._ctx !== ctx) {
      const dest = this._audio.output;
      if (!dest) return false;
      this._resetState();
      this._ctx = ctx;
      this._build(ctx, dest);
      this._built = true;
    }
    return true;
  }

  _fail(e) {
    this._failed = true;
    try { if (this._out) this._out.disconnect(); } catch (e2) { /* ignore */ }
  }

  _build(ctx, dest) {
    this._noise = makeNoise(ctx, 1);
    const mk = (t) => { const g = ctx.createBiquadFilter(); g.type = t; return g; };
    const gain = (v) => { const g = ctx.createGain(); g.gain.value = v; return g; };

    // 总线: 展宽 → 低通 (cold 时闭合) → 总音量 → GameAudio 主输出
    const bus = this._bus = gain(1);
    bus.channelCount = 2; bus.channelCountMode = 'explicit'; bus.channelInterpretation = 'speakers';
    const lp = this._lp = mk('lowpass'); lp.frequency.value = 16000; lp.Q.value = 0.5;
    const out = this._out = gain(0);
    let tail = bus;
    try { tail = this._widen(ctx, bus); } catch (e) { tail = bus; } // 展宽是锦上添花, 失败就跳过
    tail.connect(lp); lp.connect(out); out.connect(dest);

    // 山谷混响
    const rvIn = this._rvIn = mk('lowpass'); rvIn.frequency.value = 4500;
    const conv = ctx.createConvolver(); conv.normalize = true; conv.buffer = makeImpulse(ctx, 3.5);
    const rvOut = this._rvOut = gain(0.6);
    rvIn.connect(conv); conv.connect(rvOut); rvOut.connect(bus);

    // 各层: 输入增益 (随情绪变化) → dry → bus ; → send → 混响
    const L = this._L = {};
    for (const [k, wet] of [['pad', 0.35], ['pluck', 0.55], ['air', 0.85], ['pulse', 0.12], ['fx', 0.6]]) {
      const input = gain(k === 'fx' ? 1 : 0), dry = gain(1 - wet * 0.4), send = gain(wet);
      input.connect(dry); dry.connect(bus);
      input.connect(send); send.connect(rvIn);
      L[k] = input;
    }

    // Pad / 低鸣: 振荡器 → 分量增益 → 低通(慢速 LFO 调制) → 振幅涌动 → pad 层
    const P = this._pad = {};
    P.filter = mk('lowpass'); P.filter.frequency.value = 500; P.filter.Q.value = 1;
    P.swell = gain(0.9);
    P.filter.connect(P.swell); P.swell.connect(L.pad);
    const comp = (name) => { P[name + 'G'] = gain(0); P[name + 'G'].connect(P.filter); return P[name + 'G']; };
    const osc = (type, cents, dest2) => {
      const o = ctx.createOscillator(); o.type = type; o.detune.value = cents; o.connect(dest2); o.start(); return o;
    };
    const rg = comp('root'), fg = comp('fifth');
    P.root = [osc('sawtooth', -8, rg), osc('sawtooth', 0, rg), osc('sawtooth', 8, rg)];
    P.fifth = [osc('triangle', -5, fg), osc('triangle', 5, fg)];
    P.third = osc('triangle', 0, comp('third'));
    P.cluster = osc('sine', 0, comp('cluster'));          // 小九度: 紧张时的刺
    const sg = comp('sub');
    P.subA = osc('triangle', 0, sg); P.subB = osc('triangle', 0, sg); // 二者拍频 → 不安的颤动
    const lfo = (rate, depth, target) => {
      const l = ctx.createOscillator(), d = gain(depth);
      l.frequency.value = rate; l.connect(d); d.connect(target); l.start();
      return { l, d };
    };
    const fl = lfo(0.06, 150, P.filter.frequency); P.fLfo = fl.l; P.fDepth = fl.d;
    const sl = lfo(0.08, 0.05, P.swell.gain); P.sLfo = sl.l; P.sDepth = sl.d;
    this._tuneChord(0, ctx.currentTime, 0.001);
    this._applyVolume(0.6);
  }

  /** 简易 M/S 展宽: outL = aL + bR, outR = bL + aR, 其中 a=(1+k)/2, b=(1-k)/2 (k>1 加宽侧信号) */
  _widen(ctx, input) {
    const k = 1.25, a = (1 + k) / 2, b = (1 - k) / 2;
    const g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    const sp = ctx.createChannelSplitter(2), mg = ctx.createChannelMerger(2);
    const ll = g(a), lr = g(b), rl = g(b), rr = g(a);
    input.connect(sp);
    sp.connect(ll, 0); sp.connect(lr, 0); sp.connect(rl, 1); sp.connect(rr, 1);
    ll.connect(mg, 0, 0); rl.connect(mg, 0, 0); lr.connect(mg, 0, 1); rr.connect(mg, 0, 1);
    return mg;
  }

  _applyVolume(tc) {
    if (!this._built || !this._out) return;
    try { this._out.gain.setTargetAtTime(this._vol * 0.5, this._ctx.currentTime, tc); } catch (e) { /* ignore */ }
  }

  /** 把情绪读入平滑量 (JS 侧指数平滑, 避免调度概率随输入抖动); 首次直接取值 */
  _readMood(dt, mood) {
    const m = this._m, src = mood || {};
    const k = this._moodInit ? 1 - Math.exp(-dt / 1.5) : 1;
    const kh = this._moodInit ? 1 - Math.exp(-dt / 0.6) : 1;
    const num = (v, d) => (isFinite(+v) ? +v : d);
    m.calm += (clamp01(num(src.calm, 0.5)) - m.calm) * k;
    m.tension += (clamp01(num(src.tension, 0)) - m.tension) * k;
    m.danger += (clamp01(num(src.danger, 0)) - m.danger) * k;
    m.severity += (clamp01(num(src.severity, 0)) - m.severity) * k;
    m.cold += (clamp01(num(src.cold, 0)) - m.cold) * k;
    m.altitude += (num(src.altitude, 1700) - m.altitude) * k;
    m.heartRate += (clamp01(num(src.heartRate, 0.2)) - m.heartRate) * kh;
    this._night = !!src.night;
    this._moodInit = true;
  }

  /** 带缓存的 setTargetAtTime: 目标几乎没变就不写, 避免 AudioParam 时间线无谓膨胀 */
  _set(key, param, v, tc, now) {
    if (!isFinite(v)) return;
    const last = this._last[key];
    if (last !== undefined && Math.abs(v - last) < 0.003 + 0.003 * Math.abs(last)) return;
    this._last[key] = v;
    param.setTargetAtTime(v, now, tc);
  }

  _setScene(sc, now) {
    const first = this._scene === null, S = SCENES[sc];
    this._scene = sc; this._sceneAt = now;
    this._sceneFadeUntil = now + 3.2; // 此窗口内时间常数 ≤ 1 s → 约 3 s 的交叉淡化
    this._queue = this._queue.filter((e) => e.st);
    this._nextPhrase = now + (first && sc === 'title' ? 1.5 : rnd(3, 5.5));
    this._nextAir = now + rnd(2, 5);
    this._nextChord = now + rnd(22, 45);
    if (!S.chords.includes(this._chord)) this._chord = pick(S.chords);
    this._tuneChord(this._chord, now, first ? 0.01 : 2.5);
    this._applyT = 1e9;
  }

  /** 把 pad 各振荡器滑到和弦 ci (根音/五音/三音/小九度/低鸣) */
  _tuneChord(ci, now, tc) {
    const P = this._pad, drop = (SCENES[this._scene] || SCENES.trek).drop || 0;
    const [r, f5] = CHORDS[ci], rt = ROOT + r - drop;
    const set = (o, midi) => o.frequency.setTargetAtTime(mtof(midi), now, tc);
    P.root.forEach((o) => set(o, rt));
    P.fifth.forEach((o) => set(o, ROOT + f5 - drop));
    set(P.third, rt + 12 + THIRD[ci]);
    set(P.cluster, rt + 13);
    this._subF = mtof(rt - 12);
    P.subA.frequency.setTargetAtTime(this._subF, now, tc);
    P.subB.frequency.setTargetAtTime(this._subF + this._beat, now, tc);
  }

  // ------------------------------------------------------------------ 内部: 情绪 → 各层目标

  _applyMood(now) {
    const S = SCENES[this._scene], m = this._m, P = this._pad, L = this._L;
    const dg = m.danger, tn = Math.max(m.tension, dg * 0.8), cm = m.calm, cold = m.cold;
    const alt = clamp01((m.altitude - 1700) / 2100);
    const age = now - this._sceneAt;
    const fade = now < this._sceneFadeUntil ? 1.0 : 99;           // 场景切换期间加快跟随
    const T = (key, param, v, tc) => this._set(key, param, v, Math.min(tc, fade), now);
    const duck = now < this._duckUntil ? 0.35 : 1;                // 过场音期间让位
    const life = S.life ? Math.max(0, 1 - age / S.life) : 1;      // 坏结局: 乐句渐隐, 最后只剩低鸣
    const padFade = S.life ? Math.max(0.2, 1 - age / (S.life * 1.6)) : 1;

    // Pad: 根音+五音为基底; 紧张加小九度簇与更深的涌动; 危险加深沉低鸣与拍频, 滤波打开且更尖
    T('root', P.rootG.gain, 0.32 * (1 - 0.3 * dg) * padFade, 3);
    T('fifth', P.fifthG.gain, 0.26 * (1 - 0.8 * dg) * padFade, 3);
    T('third', P.thirdG.gain, 0.22 * S.third * (1 - dg) * padFade, 3);
    T('cluster', P.clusterG.gain, 0.16 * clamp01(Math.max(0, tn - 0.25) * 1.2 + dg * 0.8), 3.5);
    T('sub', P.subG.gain, 0.55 * clamp01((S.sub || 0) + dg * 0.9 + tn * 0.12), 3);
    this._beat = 0.35 + 4.5 * dg;
    T('beat', P.subB.frequency, this._subF + this._beat, 2);
    T('cut', P.filter.frequency, (380 + 420 * cm + 250 * tn + 1700 * Math.pow(dg, 1.3)) * (S.dark || 1), 3);
    T('q', P.filter.Q, 0.8 + 3.5 * dg, 3);
    T('fdep', P.fDepth.gain, 120 + 500 * dg + 150 * tn, 3);
    T('frate', P.fLfo.frequency, 0.045 + 0.08 * tn, 3);
    const depth = 0.12 + 0.45 * tn;                               // 振幅涌动深度 (0.5 → 满幅涌动)
    T('sw0', P.swell.gain, 1 - depth * 0.5, 3);
    T('swd', P.sDepth.gain, depth * 0.5, 3);
    T('swr', P.sLfo.frequency, 0.05 + 0.09 * tn + 0.1 * dg, 3);

    // 各层总电平
    this._pluckLevel = S.pluck * duck * life * (1 - 0.4 * cold);
    const air = S.air * (0.25 + 0.75 * cm) * (1 - m.severity * 0.85) * (0.45 + 0.55 * alt)
      * (this._night && m.severity < 0.4 ? 1.25 : 1) * (1 - dg) * (1 - cold) * duck;
    this._airLevel = air;
    this._pulseLevel = clamp01(Math.max(0, (tn - 0.2) / 0.8) * 0.75 + dg * 0.5) * S.pulse * duck;
    this._tickLevel = clamp01(tn * 0.8 + dg * 0.4 - 0.2) * S.pulse;
    this._bpm = 50 + 60 * m.heartRate;
    T('Lpad', L.pad.gain, S.pad * duck, 2.5);
    T('Lpluck', L.pluck.gain, this._pluckLevel, 2.5);
    T('Lair', L.air.gain, Math.min(1, air * 1.2), 4);
    T('Lpulse', L.pulse.gain, this._pulseLevel * 0.7, 2.5);

    // 母线: cold 越高越闷 (失去意识的感觉); 高海拔与危险让空间更大
    T('lp', this._lp.frequency, 600 + 15400 * Math.pow(1 - cold, 2.5) * (this._night ? 0.9 : 1), 2.5);
    T('rv', this._rvOut.gain, 0.45 + 0.3 * alt + 0.2 * dg, 3);
  }

  // ------------------------------------------------------------------ 内部: 调度

  _ev(t, e) {
    e.t = t;
    this._queue.push(e);
    this._queue.sort((a, b) => a.t - b.t);
  }

  /** 触发已进入前瞻窗口的事件; 过期太久的 (标签页挂起后) 直接丢弃 */
  _pump(now) {
    const q = this._queue;
    while (q.length && q[0].t <= now + LOOKAHEAD) {
      const e = q.shift();
      if (e.t < now - 0.25) continue;
      this._fire(e, Math.max(e.t, now + 0.005));
    }
  }

  _fire(e, t) {
    switch (e.k) {
      case 'pluck': this._pluck(t, e); break;
      case 'bell': this._bell(t, e.midi, e.vel, e.st ? this._L.fx : this._L.air); break;
      case 'swell': this._swell(t, e); break;
      case 'tom': this._tom(t, e.vel, 1, this._L.fx); break;
      case 'glide': this._tone(t, 'sine', e.f0, e.f1, e.dur, e.peak, 1.5, this._L.fx); break;
      default: break;
    }
  }

  /** 生成一个乐句 (2-6 个音, 之后长休止); 音域/音阶/节奏随情绪与场景变化 */
  _planPhrase(now) {
    const S = SCENES[this._scene], m = this._m;
    const dg = m.danger, tn = Math.max(m.tension, dg * 0.8), cm = m.calm, age = now - this._sceneAt;
    const rest = rnd(S.rest[0], S.rest[1]) * (1 - 0.4 * tn) * (1 + 0.25 * cm) * (1 + 0.5 * m.cold)
      * (S.life ? 1 + age / 60 : 1);
    this._nextPhrase = now + rest;
    if (this._pluckLevel < 0.05 || Math.random() < 0.15 * dg) return; // 危险时偶尔干脆沉默

    let lo = S.notes[0], hi = S.notes[1];
    if (dg > 0.4) { lo = 1; hi = Math.min(hi, 3); }                     // 破碎: 只剩零星几个音
    const n = randInt(lo, hi);
    const oct = Math.max(-1, Math.min(1, Math.round(1 - 1.1 * tn - 1.3 * dg + S.oct)));
    const base = ROOT + 12 * oct;                                       // 紧张/危险 → 音区下移
    const minorP = clamp01(S.minor + 0.75 * tn + 0.2 * dg);             // 小五声渗入概率
    const colorP = clamp01(0.45 * Math.max(0, tn - 0.45) + 0.55 * dg + (S.life ? 0.15 : 0)); // 小二度/三全音
    const dir = S.dir || (Math.random() < 0.5 ? 1 : -1);
    const top = S === SCENES.title ? 11 : 9;

    // 级数序列: 有一定概率重现 (并微变) 之前的动机, 使旋律有记忆但不重复
    const idxs = [];
    let idx = randInt(2, 7);
    if (this._motif && Math.random() < S.motif * (1 - dg)) {
      for (const off of this._motif) idxs.push(idx + off + (Math.random() < 0.25 ? pick([-1, 1]) : 0));
    }
    while (idxs.length < n) {
      const prev = idxs.length ? idxs[idxs.length - 1] : idx;
      const step = pick([1, 1, 1, 2, 2, 3]) * (Math.random() < 0.5 + 0.2 * dir ? 1 : -1);
      idxs.push(prev + step);
    }
    idxs.length = n;
    for (let i = 0; i < n; i++) idxs[i] = Math.max(0, Math.min(top, idxs[i] < 0 ? -idxs[i] : idxs[i]));
    if (dg < 0.45) {                                                    // 平和时终止于 宫/徵/羽
      let best = idxs[n - 1], bd = 99;
      for (let c = 0; c <= top; c++) {
        const d = Math.abs(c - idxs[n - 1]);
        if (S.cad.includes(c % 5) && d < bd) { bd = d; best = c; }
      }
      idxs[n - 1] = best;
    }
    if (n >= 3 && Math.random() < 0.4) this._motif = idxs.slice(0, Math.min(4, n)).map((v) => v - idxs[0]);

    // 节奏与力度
    const sp = (S.space || 1) * lerp(1.0, 0.7, tn);
    let t = now + rnd(0.3, 1.0);
    const dark = clamp01(dg * 0.9 + tn * 0.2);
    if (Math.random() < 0.4 * (1 - dg)) {                               // 散音: 先弹一个低的空弦根音
      this._ev(t - 0.02, { k: 'pluck', midi: ROOT + CHORDS[this._chord][0] - 12, vel: 0.45, dur: 5, pan: 0, dark: 0.5 });
    }
    for (let i = 0; i < n; i++) {
      const o = Math.floor(idxs[i] / 5) * 12, d = idxs[i] % 5;      // 八度 + 级数(0..4)
      let s = Math.random() < minorP ? MINOR[d] : MAJOR[d];
      if (Math.random() < colorP) s = pick(COLOR);
      let bend = null;
      const r = Math.random();
      if (dg > 0.5) { if (r < 0.5) bend = { type: 'sag', semi: rnd(0.4, 1.2) }; }
      else if (r < 0.22 + 0.15 * cm) bend = { type: 'yin', depth: rnd(0.25, 0.5), rate: rnd(4.2, 6) };
      else if (r < 0.36 + 0.15 * cm) bend = { type: 'up', semi: pick([1, 2]) };
      const midi = base + o + s;
      this._ev(t, {
        k: 'pluck', midi, bend, dark,
        vel: Math.max(0.1, (i === 0 ? 0.8 : rnd(0.5, 0.75)) * (1 - 0.35 * dg)),
        dur: Math.max(1.5, (3.6 - (midi - 50) * 0.03) * (1 - 0.35 * dg)),
        pan: rnd(-0.4, 0.4),
        detune: dg > 0.3 ? rnd(-50, 50) * dg : 0,                       // 危险: 走音
      });
      t += sp * (dg > 0.4 ? pick([1, 2, 3]) : pick([1, 1, 0.5, 0.75, 1.5, 2]));
    }
    this._nextPhrase = t + rest;
  }

  /** 心跳/低鼓: 速度跟随 heartRate (50→110 bpm), 紧张时在反拍加轻微滴答声 */
  _schedulePulse(now) {
    if (this._pulseLevel <= 0.03) { this._nextPulse = 0; return; }
    if (this._nextPulse < now) this._nextPulse = now + 0.05;            // 首次进入 / 挂起后重新对齐
    const period = 60 / this._bpm, dg = this._m.danger;
    while (this._nextPulse < now + LOOKAHEAD) {
      const t = this._nextPulse + (Math.random() - 0.5) * 0.012;        // 心率的细微不规则
      const vel = 0.45 + 0.55 * clamp01(dg + this._m.heartRate * 0.4);
      this._tom(t, vel, 1, this._L.pulse);
      this._tom(t + Math.min(0.2, period * 0.3), vel * 0.6, 0.85, this._L.pulse); // "咚-咚"
      if (this._tickLevel > 0.08) this._tick(t + period * 0.5, this._tickLevel);
      this._nextPulse += period;
    }
  }

  /** 高处空气感: 极轻的风铃/钟泛音, 仅在晴好、高海拔、清朗夜晚出现 */
  _scheduleAir(now) {
    if (this._airLevel <= 0.12 || now < this._nextAir) return;
    const n = 1 + (Math.random() < 0.5 ? 1 : 0) + (Math.random() < 0.2 ? 1 : 0);
    let t = now + 0.05, idx = randInt(0, 8);
    for (let i = 0; i < n; i++) {
      this._bell(t, 74 + pent(idx), rnd(0.4, 0.8), this._L.air);
      t += rnd(0.09, 0.3);
      idx = Math.max(0, Math.min(8, idx + pick([-2, -1, 1, 2])));
    }
    this._nextAir = now + rnd(5, 13) / (0.4 + this._airLevel);
  }

  // ------------------------------------------------------------------ 内部: 发声

  /** 登记一个发声; 超过上限返回 false (调用方跳过该音)。以结束时间记账, 不依赖 onended */
  _claim(end, cap) {
    const v = this._voices, now = this._ctx.currentTime;
    for (let i = v.length - 1; i >= 0; i--) if (v[i] <= now) v.splice(i, 1);
    if (v.length >= cap) return false;
    v.push(end);
    return true;
  }

  /** 古琴式拨弦: 三角波 + 二次泛音 + 指甲噪声瞬态, 低通随衰减闭合; 可带吟猱曲线 */
  _pluck(t, e) {
    const dur = e.dur || 3, vel = Math.min(1, Math.max(0.05, e.vel || 0.6)), dark = e.dark || 0;
    if (!this._claim(t + dur + 0.1, e.st ? HARD_CAP : MAX_VOICES)) return;
    const ctx = this._ctx, f = mtof(e.midi), f2 = f * 2.004; // 略失谐的二次泛音带来弦的质感
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
    o1.type = 'triangle'; o2.type = 'sine';
    o1.detune.value = e.detune || 0; o2.detune.value = e.detune || 0;
    if (e.bend) {
      const b1 = bendCurve(f, e.bend, dur), b2 = bendCurve(f2, e.bend, dur);
      o1.frequency.setValueCurveAtTime(b1.c, t, b1.D);
      o2.frequency.setValueCurveAtTime(b2.c, t, b2.D);
    } else {
      o1.frequency.setValueAtTime(f * 1.012, t); o1.frequency.exponentialRampToValueAtTime(f, t + 0.04);
      o2.frequency.setValueAtTime(f2 * 1.012, t); o2.frequency.exponentialRampToValueAtTime(f2, t + 0.04);
    }
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.6;
    lp.frequency.setValueAtTime(Math.min(f * (4 + 6 * vel) * (1 - 0.65 * dark), 8000), t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(f * 1.6, 250), t + Math.min(dur * 0.5, 1.2));
    const g2 = ctx.createGain(); g2.gain.value = 0.28 * (1 - dark * 0.5);
    const env = ctx.createGain(), pk = 0.75 * vel;
    env.gain.setValueAtTime(EPS, t);
    env.gain.linearRampToValueAtTime(pk, t + 0.004);
    env.gain.exponentialRampToValueAtTime(pk * 0.35, t + 0.22);  // 先快衰再长尾
    env.gain.exponentialRampToValueAtTime(EPS, t + dur);
    o1.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(env);
    const nodes = [o1, o2, g2, lp, env];
    let tail = env;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, e.pan || 0));
      env.connect(p); tail = p; nodes.push(p);
    }
    // 指甲/指肉触弦的短噪声
    const ns = ctx.createBufferSource(); ns.buffer = this._noise;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = Math.min(f * 3, 5000); bp.Q.value = 1.2;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(vel * 0.3, t); ng.gain.exponentialRampToValueAtTime(EPS, t + 0.06);
    ns.connect(bp); bp.connect(ng); ng.connect(tail);
    nodes.push(ns, bp, ng);
    tail.connect(e.st ? this._L.fx : this._L.pluck);
    cleanup(o1, nodes);
    o1.start(t); o2.start(t); ns.start(t, Math.random() * 0.8);
    ns.stop(t + 0.08); o1.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
  }

  /** 风铃/钟: 两个非谐和正弦泛音 (比例 1 : 2.76), 长衰减 */
  _bell(t, midi, vel, layer) {
    if (!this._claim(t + 5, MAX_VOICES)) return;
    const ctx = this._ctx, f = mtof(midi), nodes = [];
    let first = null, tail = layer;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner(); p.pan.value = rnd(-0.6, 0.6); p.connect(layer); tail = p; nodes.push(p);
    }
    for (const [ratio, amp, dec] of [[1, 1, 4.5], [2.76, 0.4, 2.4]]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f * ratio;
      g.gain.setValueAtTime(EPS, t);
      g.gain.linearRampToValueAtTime(vel * amp * 0.28, t + 0.006);
      g.gain.exponentialRampToValueAtTime(EPS, t + dec);
      o.connect(g); g.connect(tail);
      o.start(t); o.stop(t + dec + 0.05);
      nodes.push(o, g);
      if (!first || dec > 4) first = o;
    }
    cleanup(first, nodes);
  }

  /** 多振荡器 → 低通 (打开再闭合) → 涌动包络: 过场音的和弦/低鸣 */
  _swell(t, e) {
    const total = e.attack + e.hold + e.release;
    if (!this._claim(t + total, HARD_CAP)) return;
    const ctx = this._ctx, midis = e.midis, nodes = [];
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.8;
    lp.frequency.setValueAtTime(e.c0, t);
    lp.frequency.linearRampToValueAtTime(e.c1, t + e.attack);
    lp.frequency.linearRampToValueAtTime(e.c0, t + total);
    const g = ctx.createGain(), pk = e.peak / Math.sqrt(midis.length);
    g.gain.setValueAtTime(EPS, t);
    g.gain.linearRampToValueAtTime(pk, t + e.attack);
    g.gain.setValueAtTime(pk, t + e.attack + e.hold);
    g.gain.exponentialRampToValueAtTime(EPS, t + total);
    lp.connect(g); g.connect(this._L.fx);
    nodes.push(lp, g);
    let first = null;
    midis.forEach((mi, i) => {
      const o = ctx.createOscillator();
      o.type = e.type || 'triangle'; o.frequency.value = mtof(mi);
      if (e.beat) o.detune.value = i % 2 ? e.beat : -e.beat * 0.5;
      o.connect(lp); o.start(t); o.stop(t + total + 0.05);
      nodes.push(o); if (!first) first = o;
    });
    cleanup(first, nodes);
  }

  /** 单音: 指数音高滑动 f0→f1 + 线性起音/指数衰减 (低鼓、下坠的滑音) */
  _tone(t, type, f0, f1, dur, peak, attack, layer) {
    if (!this._claim(t + dur, HARD_CAP)) return;
    const ctx = this._ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(EPS, t);
    g.gain.linearRampToValueAtTime(Math.max(peak, EPS), t + attack);
    g.gain.exponentialRampToValueAtTime(EPS, t + dur);
    o.connect(g); g.connect(layer);
    cleanup(o, [o, g]);
    o.start(t); o.stop(t + dur + 0.02);
  }

  /** 低鼓/心跳的一击 (正弦下滑 + 皮面短促的"噗") */
  _tom(t, vel, pitch, layer) {
    this._tone(t, 'sine', 88 * pitch, 46 * pitch, 0.3, vel * 0.8, 0.004, layer);
    this._tone(t, 'triangle', 190 * pitch, 70 * pitch, 0.06, vel * 0.15, 0.002, layer);
  }

  /** 极轻的机械滴答 (带通噪声短脉冲), 制造焦虑感 */
  _tick(t, vel) {
    const ctx = this._ctx, ns = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
    ns.buffer = this._noise;
    bp.type = 'bandpass'; bp.frequency.value = 3400; bp.Q.value = 5;
    g.gain.setValueAtTime(vel * 0.35, t); g.gain.exponentialRampToValueAtTime(EPS, t + 0.04);
    ns.connect(bp); bp.connect(g); g.connect(this._L.pulse);
    cleanup(ns, [ns, bp, g]);
    ns.start(t, Math.random() * 0.8); ns.stop(t + 0.05);
  }

  // ------------------------------------------------------------------ 内部: 过场音

  _playStinger(name, t) {
    const P = (dt, midi, vel, dur, extra) => this._ev(t + dt, Object.assign({ k: 'pluck', st: true, midi, vel, dur, pan: rnd(-0.3, 0.3) }, extra));
    const W = (dt, midis, o) => this._ev(t + dt, Object.assign({ k: 'swell', st: true, midis }, o));
    const B = (dt, midi, vel) => this._ev(t + dt, { k: 'bell', st: true, midi, vel });
    switch (name) {
      case 'waypoint': // 抵达: 轻柔上行五声音阶 D E F# A B D, 末尾钟声
        [62, 64, 66, 69, 71, 74].forEach((mi, i) => P(i * 0.3 + (i === 5 ? 0.1 : 0), mi, 0.45 + i * 0.07, i === 5 ? 5 : 2.8,
          i === 2 ? { bend: { type: 'yin', depth: 0.3, rate: 5.2 } } : null));
        B(1.9, 86, 0.8); B(2.2, 81, 0.6);
        W(0.3, [50, 57, 66], { type: 'sine', attack: 1.2, hold: 0.8, release: 3.5, peak: 0.2, c0: 500, c1: 1400 });
        break;
      case 'danger': // 低沉不协和的涌动 (D2 + 三全音 + 小二度) 与一记低鼓
        W(0, [38, 44, 39], { type: 'sawtooth', attack: 1.5, hold: 0.5, release: 2.8, peak: 0.3, c0: 180, c1: 900, beat: 12 });
        this._ev(t + 1.5, { k: 'tom', st: true, vel: 1 });
        break;
      case 'rescue': // 温暖而充满希望的和弦 (D add9) + 轻轻扫弦 + 钟声
        [50, 57, 62, 66, 69].forEach((mi, i) => P(i * 0.07, mi, 0.55 - i * 0.03, 4.5));
        P(0.45, 76, 0.4, 4);
        W(0, [50, 57, 62, 66, 69, 76], { type: 'triangle', attack: 0.9, hold: 1.2, release: 4.5, peak: 0.28, c0: 500, c1: 2200 });
        B(0.6, 81, 0.7); B(1.0, 86, 0.6);
        break;
      case 'death': { // 缓慢下坠: 逐渐走音、渐弱的下行音阶 + 下滑的正弦 + 深沉低鸣
        let tt = 0;
        [69, 66, 64, 62, 59, 57, 54, 52, 50].forEach((mi, i) => {
          P(tt, mi, 0.75 - i * 0.06, 3.5 + i * 0.3, { bend: { type: 'sag', semi: 0.3 + i * 0.12 }, dark: i / 9, detune: -i * 6 });
          tt += 0.8 + i * 0.22;
        });
        W(0.5, [38, 26], { type: 'triangle', attack: 3.5, hold: 3, release: 6, peak: 0.3, c0: 150, c1: 500 });
        this._ev(t, { k: 'glide', st: true, f0: 440, f1: 55, dur: 9, peak: 0.07 });
        break;
      }
      case 'camp': // 安顿下来的小动机: A F# D, 再落到低音 D
        P(0, 69, 0.42, 3.5); P(0.65, 66, 0.38, 3.5); P(1.3, 62, 0.36, 4); P(2.2, 50, 0.4, 5, { dark: 0.5 });
        W(0.2, [50, 57], { type: 'sine', attack: 1.2, hold: 1, release: 4, peak: 0.18, c0: 400, c1: 900 });
        break;
      default: break;
    }
  }
}
