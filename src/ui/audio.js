// GameAudio: fully procedural sound (Web Audio API only, no audio files).
//
// Graph:  [wind loop + one-shots] -> master GainNode -> DynamicsCompressor -> destination
//
// Every public method is a safe no-op until unlock() has produced a running
// AudioContext, and none of them ever throw (audio must never break the game).

const STORAGE_KEY = 'aotai-muted';
const MASTER_LEVEL = 0.7;   // overall loudness when not muted
const WIND_TRIM = 4;        // brown noise through a band-pass is very quiet; make up the level
const EPS = 0.0001;         // "silence" for exponential ramps (they cannot reach 0)

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => (v > 0 ? (v < 1 ? v : 1) : 0);

/** Disconnect every node once `src` finishes, so one-shots leave nothing behind. */
function disconnectOnEnd(src, nodes) {
  src.onended = () => {
    for (const n of nodes) { try { n.disconnect(); } catch (e) { /* already gone */ } }
  };
}

/** White noise buffer (flat spectrum) used for bursts: footsteps, whistles, whooshes. */
function makeWhite(ctx, seconds) {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/**
 * Brown noise buffer (leaky-integrated white, -6 dB/oct) for the wind bed. The
 * tail is equal-power cross-faded into the head so the loop point is seamless.
 */
function makeBrown(ctx, seconds) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const fade = Math.floor(ctx.sampleRate * 0.3);
  const raw = new Float32Array(n + fade);
  let last = 0;
  for (let i = 0; i < raw.length; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    raw[i] = last;
  }
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const out = buf.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    if (i < fade) {
      const a = (i / fade) * Math.PI * 0.5;
      out[i] = raw[i] * Math.sin(a) + raw[n + i] * Math.cos(a); // out[0] continues raw[n-1]
    } else {
      out[i] = raw[i];
    }
    const v = Math.abs(out[i]);
    if (v > peak) peak = v;
  }
  const k = peak > 0 ? 0.9 / peak : 1;
  for (let i = 0; i < n; i++) out[i] *= k;
  return buf;
}

export class GameAudio {
  constructor() {
    this._ctx = null;          // AudioContext, created lazily in unlock()
    this._failed = false;      // true if Web Audio is unavailable / graph build threw
    this._muted = false;
    try { this._muted = localStorage.getItem(STORAGE_KEY) === '1'; } catch (e) { /* no storage */ }

    this._stepT = 0;           // footstep accumulator (seconds)
    this._foot = 1;            // alternates +1 / -1 for left/right panning
    this._nextBeat = 0;        // ctx time of the next heartbeat
    this._lastAlert = -10;     // ctx time of the last alert()
    this._lastLevel = -1;      // last wind level actually applied (-1 => force first apply)
    this._lastMuffled = null;
    this._nextHowl = 0;        // ctx time at which the howl LFO rates are re-randomised
  }

  /** Call on a user gesture; idempotent. Builds the graph, resumes, starts the wind loop. */
  unlock() {
    try {
      if (!this._ctx) {
        if (this._failed) return;
        const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AC) { this._failed = true; return; }
        const ctx = new AC();
        try { this._build(ctx); } catch (e) { try { ctx.close(); } catch (e2) { /* ignore */ } throw e; }
        this._ctx = ctx; // assigned last: public methods stay inert until fully built
        if (typeof document !== 'undefined') {
          document.addEventListener('visibilitychange', () => {
            const c = this._ctx;
            if (!c) return;
            try {
              const p = document.hidden ? c.suspend() : c.resume();
              if (p && p.catch) p.catch(() => {});
            } catch (e) { /* ignore */ }
          });
        }
      }
      if (this._ctx.state !== 'running' && !(typeof document !== 'undefined' && document.hidden)) {
        const p = this._ctx.resume();
        if (p && p.catch) p.catch(() => {});
      }
    } catch (e) {
      this._failed = true;
      this._ctx = null;
    }
  }

  get muted() { return this._muted; }

  /** 供背景音乐模块共享：AudioContext 与主输出节点（未解锁前为 null） */
  get context() { return this._ctx; }
  get output() { return this._ctx ? this._master : null; }

  setMuted(b) {
    this._muted = !!b;
    try { localStorage.setItem(STORAGE_KEY, this._muted ? '1' : '0'); } catch (e) { /* ignore */ }
    if (!this._ctx) return;
    try { this._master.gain.setTargetAtTime(this._muted ? 0 : MASTER_LEVEL, this._ctx.currentTime, 0.06); } catch (e) { /* ignore */ }
  }

  /** level 0..1, muffled = inside a tent. Called every frame, so it only touches the graph on real changes. */
  setWind(level, muffled) {
    if (!this._live()) return;
    try {
      const lv = clamp01(+level || 0);
      const m = !!muffled;
      const t = this._ctx.currentTime;

      // Every 4-9 s pick new slow LFO rates so the howl never repeats audibly.
      if (t >= this._nextHowl) {
        this._nextHowl = t + 4 + Math.random() * 5;
        this._lfoA.frequency.setTargetAtTime(0.07 + Math.random() * 0.14, t, 2);
        this._lfoB.frequency.setTargetAtTime(0.2 + Math.random() * 0.3, t, 2);
      }

      if (Math.abs(lv - this._lastLevel) <= 0.02 && m === this._lastMuffled) return;
      this._lastLevel = lv;
      this._lastMuffled = m;

      const base = (0.05 + lv * 0.55) * (m ? 0.6 : 1);
      const freq = (300 + lv * 900) * (m ? 0.55 : 1); // lower centre too, or the tent lowpass leaves almost nothing
      this._windGain.gain.setTargetAtTime(base, t, 0.3);
      this._windBp.frequency.setTargetAtTime(freq, t, 0.3);
      this._windLp.frequency.setTargetAtTime(m ? 350 : 3000, t, 0.25);
      // Howl depth grows with wind strength: gain wobble stays < base so it never inverts phase.
      this._ampMod.gain.setTargetAtTime(base * 0.45 * lv, t, 0.3);
      this._freqMod.gain.setTargetAtTime(lv * 350 * (m ? 0.55 : 1), t, 0.3);
    } catch (e) { /* never throw */ }
  }

  /** Footsteps: call every frame while walking. speed ~0.3..1.3. */
  step(dt, speed) {
    if (!this._live()) return;
    try {
      this._stepT += dt > 0 ? Math.min(dt, 0.1) : 0;
      const sp = Math.max(0.1, Math.min(2, +speed || 0));
      const interval = 1 / (1.6 * sp + 0.4);
      if (this._stepT < interval) return;
      this._stepT -= interval;

      const t = this._ctx.currentTime;
      this._foot = -this._foot;
      const pan = this._foot * 0.25;
      const rate = 0.85 + Math.random() * 0.3;
      const peak = 0.2 + Math.random() * 0.2;
      const hp = 1500 + Math.random() * 1500;
      // Two grains ~40 ms apart sound more like compressing snow than a single click.
      this._burst({ type: 'highpass', f0: hp, t, dur: 0.12, peak, rate, pan });
      this._burst({ type: 'highpass', f0: hp * 1.2, t: t + 0.035 + Math.random() * 0.02, dur: 0.07, peak: peak * 0.6, rate: rate * 1.1, pan });
    } catch (e) { /* never throw */ }
  }

  /** ~1.1 s rising whistle announcing an incoming gust. */
  gustWarn() {
    if (!this._live()) return;
    try {
      const t = this._ctx.currentTime;
      // A Q=14 band-pass passes only ~6% of the noise, hence the large peak gain.
      this._burst({ type: 'bandpass', f0: 600, f1: 2200, q: 14, t, dur: 1.1, peak: 3.5, attack: 0.9 });
    } catch (e) { /* never throw */ }
  }

  /** ~0.7 s heavy whoosh plus a low thump when the gust arrives. */
  gustHit() {
    if (!this._live()) return;
    try {
      const t = this._ctx.currentTime;
      this._burst({ type: 'lowpass', f0: 1600, f1: 250, t, dur: 0.7, peak: 1.1, attack: 0.05, rate: 0.7 });
      this._tone('sine', 70, 40, t, 0.6, 0.55, 0.01);
    } catch (e) { /* never throw */ }
  }

  /** Very short UI tick. */
  click() {
    if (!this._live()) return;
    try { this._tone('sine', 1800, 1800, this._ctx.currentTime, 0.025, 0.07, 0.002); } catch (e) { /* never throw */ }
  }

  /** Two-tone danger warning, rate-limited to once per 1.5 s. */
  alert() {
    if (!this._live()) return;
    try {
      const t = this._ctx.currentTime;
      if (t - this._lastAlert < 1.5) return;
      this._lastAlert = t;
      this._tone('square', 880, 880, t, 0.09, 0.04);
      this._tone('square', 660, 660, t + 0.1, 0.09, 0.04);
    } catch (e) { /* never throw */ }
  }

  /** level 0..1, called every frame. Soft lub-dub whose tempo and volume follow level. */
  heartbeat(level) {
    if (!(level > 0.05) || !this._live()) return;
    try {
      const t = this._ctx.currentTime;
      if (t < this._nextBeat) return; // cheap per-frame path: one comparison
      const lv = clamp01(level);
      this._nextBeat = t + lerp(1.1, 0.45, lv);
      const vol = lv * 0.35;
      this._tone('sine', 68, 55, t, 0.14, vol, 0.01);               // lub
      this._tone('sine', 58, 48, t + 0.17, 0.12, vol * 0.75, 0.01); // dub
    } catch (e) { /* never throw */ }
  }

  // ---------------------------------------------------------------- internals

  /** True only while the context exists and is actually running (not suspended/hidden). */
  _live() { return !!this._ctx && this._ctx.state === 'running'; }

  /** Create all long-lived nodes and start the (silent) wind loop. */
  _build(ctx) {
    this._white = makeWhite(ctx, 2);   // 2 s is plenty: bursts start at a random offset
    this._brown = makeBrown(ctx, 4);   // looping wind bed

    this._master = ctx.createGain();
    this._master.gain.value = this._muted ? 0 : MASTER_LEVEL;
    const comp = ctx.createDynamicsCompressor(); // tames overlapping gust + footsteps
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.005;
    comp.release.value = 0.2;
    this._master.connect(comp);
    comp.connect(ctx.destination);

    // Wind: brown loop -> trim -> bandpass -> lowpass -> gain -> master
    const src = ctx.createBufferSource();
    src.buffer = this._brown;
    src.loop = true;
    const trim = ctx.createGain();
    trim.gain.value = WIND_TRIM;
    this._windBp = ctx.createBiquadFilter();
    this._windBp.type = 'bandpass';
    this._windBp.Q.value = 0.8;
    this._windBp.frequency.value = 300;
    this._windLp = ctx.createBiquadFilter();
    this._windLp.type = 'lowpass';
    this._windLp.frequency.value = 3000;
    this._windGain = ctx.createGain();
    this._windGain.gain.value = 0; // silent until setWind() is called
    src.connect(trim); trim.connect(this._windBp); this._windBp.connect(this._windLp);
    this._windLp.connect(this._windGain); this._windGain.connect(this._master);

    // Howl: two slow sine LFOs (rates re-randomised in setWind) summed on a bus that
    // modulates both the band-pass centre frequency and the wind gain.
    this._lfoA = ctx.createOscillator(); this._lfoA.frequency.value = 0.13;
    this._lfoB = ctx.createOscillator(); this._lfoB.frequency.value = 0.37;
    const ga = ctx.createGain(); ga.gain.value = 0.6;
    const gb = ctx.createGain(); gb.gain.value = 0.4;
    const bus = ctx.createGain();
    this._lfoA.connect(ga); ga.connect(bus);
    this._lfoB.connect(gb); gb.connect(bus);
    this._freqMod = ctx.createGain(); this._freqMod.gain.value = 0; // depth in Hz
    this._ampMod = ctx.createGain();  this._ampMod.gain.value = 0;  // depth in gain units
    bus.connect(this._freqMod); this._freqMod.connect(this._windBp.frequency);
    bus.connect(this._ampMod);  this._ampMod.connect(this._windGain.gain);

    src.start();
    this._lfoA.start();
    this._lfoB.start();
  }

  /** Gain node with a linear attack to `peak`, then exponential decay to silence at t+dur. */
  _env(t, peak, attack, dur) {
    const g = this._ctx.createGain();
    g.gain.setValueAtTime(EPS, t);
    g.gain.linearRampToValueAtTime(Math.max(peak, EPS), t + attack);
    g.gain.exponentialRampToValueAtTime(EPS, t + dur);
    return g;
  }

  /** One-shot filtered white-noise burst. Filter may sweep f0 -> f1 over `dur`. */
  _burst({ type, f0, f1 = f0, q = 1, t, dur, peak, attack = 0.004, rate = 1, pan = 0 }) {
    const ctx = this._ctx;
    const buf = this._white;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate; // resampling shifts the noise colour: cheap "pitch" variation
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.Q.value = q;
    filt.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) filt.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = this._env(t, peak, attack, dur);
    src.connect(filt); filt.connect(g);
    const nodes = [src, filt, g];
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p); p.connect(this._master);
      nodes.push(p);
    } else {
      g.connect(this._master);
    }
    disconnectOnEnd(src, nodes);
    src.start(t, Math.random() * Math.max(0, buf.duration - dur * rate - 0.05));
    src.stop(t + dur + 0.03);
  }

  /** One-shot oscillator blip with optional exponential pitch glide f0 -> f1. */
  _tone(type, f0, f1, t, dur, peak, attack = 0.003) {
    const ctx = this._ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = this._env(t, peak, attack, dur);
    osc.connect(g); g.connect(this._master);
    disconnectOnEnd(osc, [osc, g]);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }
}
