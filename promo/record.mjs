// Record the real game UI (mobile portrait, 405x720 CSS @ 8/3 = 1080x1920) on a virtual clock:
// rAF, performance.now and setTimeout only advance when we step 1/30 s, so every capture is smooth and repeatable.
// usage: node promo/record.mjs [title,roles,shop,hud,gate]   ->  promo/build/frames/rec_<seg>/0001.jpg ...
// Needs the dev server (npm run dev / launch.json "aotai-dev") on :5199 — dev mode exposes window.__game/__app.
import { launch } from './cdp.mjs';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE || 'http://localhost:5199';
const FPS = 30, W = 405, H = 720, DPR = 1080 / 405;
const only = process.argv[2] ? process.argv[2].split(',') : null;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const CLOCK = `(() => {
  let now = 1000, tid = 1; const q = [], timers = new Map();
  performance.now = () => now;
  window.requestAnimationFrame = (cb) => { q.push(cb); return q.length; };
  window.cancelAnimationFrame = () => {};
  window.setTimeout = (fn, ms = 0, ...a) => { const id = tid++; timers.set(id, { at: now + (+ms || 0), fn: typeof fn === 'function' ? () => fn(...a) : () => {} }); return id; };
  window.clearTimeout = (id) => { timers.delete(id); };
  window.setInterval = (fn, ms = 0, ...a) => { const id = tid++; const arm = () => timers.set(id, { at: now + Math.max(1, +ms || 0), fn: () => { arm(); fn(...a); } }); arm(); return id; };
  window.clearInterval = (id) => { timers.delete(id); };
  window.__step = (dt) => {
    now += dt * 1000;
    for (let guard = 0; guard < 200; guard++) {
      let best = null;
      for (const [id, t] of timers) if (t.at <= now && (!best || t.at < best[1].at)) best = [id, t];
      if (!best) break;
      timers.delete(best[0]);
      try { best[1].fn(); } catch (e) { console.error(e); }
    }
    for (const c of q.splice(0)) { try { c(now); } catch (e) { console.error(e); } }
  };
  window.__touch = (x, y, on) => {
    let d = document.getElementById('__touch');
    if (!d) { d = document.createElement('div'); d.id = '__touch';
      d.style.cssText = 'position:fixed;z-index:99999;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;background:rgba(255,255,255,.38);border:2px solid rgba(255,255,255,.9);box-shadow:0 0 16px rgba(0,0,0,.4);pointer-events:none';
      document.documentElement.appendChild(d); }
    d.style.left = x + 'px'; d.style.top = y + 'px'; d.style.opacity = on ? 1 : 0; d.style.transform = on ? 'scale(1)' : 'scale(1.5)';
  };
  try { localStorage.clear(); localStorage.setItem('aotai-quality', 'high'); } catch (e) {}
})();`;

const b = await launch({ width: W, height: H });
try {
  const page = await b.open(BASE + '/', { dpr: DPR, mobile: true, ua: UA, touch: true, init: CLOCK, noWait: true });
  const ev = page.evaluate;
  await page.send('Animation.enable');
  const step = async (n = 1) => { for (let i = 0; i < n; i++) await ev('__step(1/30), 1'); };
  // boot: the game hides its splash after 30 frames
  for (let i = 0; i < 900; i++) {
    await step();
    if (await ev(`!!window.__game && document.getElementById('boot').classList.contains('gone')`).catch(() => false)) break;
  }
  await step(45);
  console.log('booted', page.logs.filter((l) => /EXC|rror/.test(l)).slice(0, 3).join('\n'));

  const center = (sel, text) => ev(`(() => {
    const els = [...document.querySelectorAll(${JSON.stringify(sel)})];
    const e = ${text ? `els.find((x) => x.textContent.includes(${JSON.stringify(text)}))` : 'els[0]'};
    if (!e) return null; const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2];
  })()`);
  const click = (sel, text) => ev(`(() => {
    const els = [...document.querySelectorAll(${JSON.stringify(sel)})];
    const e = ${text ? `els.find((x) => x.textContent.includes(${JSON.stringify(text)}))` : 'els[0]'};
    if (e) e.click(); return !!e;
  })()`);
  let rate = 0.25, tLast = Date.now();
  // capture `secs` seconds; act(t) runs before each frame (t = local seconds)
  async function capture(name, secs, act) {
    const dir = path.join(HERE, 'build/frames', 'rec_' + name);
    rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
    const N = Math.round(secs * FPS);
    for (let f = 0; f < N; f++) {
      if (act) await act(f / FPS, f);
      await step();
      writeFileSync(path.join(dir, String(f + 1).padStart(4, '0') + '.jpg'), await page.screenshot(92));
      // keep CSS animations in step with video time: they run on wall-clock, our frames don't
      const real = (Date.now() - tLast) / 1000; tLast = Date.now();
      rate = rate * 0.8 + 0.2 * Math.min(1, (1 / FPS) / Math.max(0.005, real));
      if (f % 10 === 0) await page.send('Animation.setPlaybackRate', { playbackRate: rate });
    }
    console.log('captured', name, N, 'rate', rate.toFixed(2));
  }
  const tap = async (sel, text, hold = 0.25) => {
    const c = await center(sel, text);
    if (!c) { console.log('tap: not found', sel, text); return false; }
    await ev(`__touch(${c[0]}, ${c[1]}, 1)`);
    await step(Math.round(hold * FPS));
    await click(sel, text);
    await ev(`__touch(${c[0]}, ${c[1]}, 0)`);
    return true;
  };
  const want = (s) => !only || only.includes(s);
  // a press that lands mid-capture: show the finger for a few frames, then click
  const pressAt = (sel, text, t0) => async (t) => {
    if (Math.abs(t - t0) < 0.5 / FPS) { const c = await center(sel, text); if (c) await ev(`__touch(${c[0]}, ${c[1]}, 1)`); }
    if (Math.abs(t - t0 - 0.2) < 0.5 / FPS) { await click(sel, text); await ev(`__touch(0, 0, 0)`); }
  };

  // —— 1. 标题页 ——
  if (want('title')) await capture('title', 4.5);

  // —— 2. 选身份：先停在大学生，再滑到程序员 ——
  await click('.menu button, button', '开始');
  await step(20);
  if (want('roles')) {
    // the role cards are a horizontal carousel on phones
    const target = await ev(`(() => { const s = document.querySelector('.roles'), c = document.querySelector('[data-id="coder"]'); s.scrollLeft = 0; return c.offsetLeft - s.offsetLeft - (s.clientWidth - c.offsetWidth) / 2; })()`);
    const pickStudent = pressAt('[data-act="pick"][data-id="student"]', null, 0.5);
    const pickCoder = pressAt('[data-act="pick"][data-id="coder"]', null, 3.45);
    await capture('roles', 6.0, async (t) => {
      await pickStudent(t);
      const u = Math.min(1, Math.max(0, (t - 2.15) / 1.05)), k = u * u * (3 - 2 * u);
      if (t > 2.1 && t < 3.4) await ev(`document.querySelector('.roles').scrollLeft = ${target * k}`);
      await pickCoder(t);
    });
  }
  await click('[data-act="pick"][data-id="nurse"]');
  await step(5);
  await click('[data-act="go"]');
  await step(20);

  // —— 3. 商店：护士（能读出准确体温），点"食物"看烤肠 ——
  if (want('shop')) {
    await capture('shop', 3.6, pressAt('.shop-tabs button', '食物', 0.35));
    console.log('RECT shop.soldout', JSON.stringify(await ev(`(() => { const r = document.querySelector('.item.soldout').getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })()`)));
  } else await click('.shop-tabs button', '食物');
  // 买点像样的装备，出发
  await ev(`(() => {
    const buy = { camp: ['tent_alpine', 'bag_winter', 'pad_foam'], cloth: ['insul_down', 'mitts'], food: ['baijiu', 'noodle', 'chocolate', 'chocolate'], water: ['water', 'water', 'stove', 'pot', 'gas_alpine'], tool: ['headlamp', 'microspikes'] };
    for (const [cat, ids] of Object.entries(buy)) {
      document.querySelector('.shop-tabs button[data-id="' + cat + '"]')?.click();
      for (const id of ids) document.querySelector('[data-act="plus"][data-id="' + id + '"]')?.click();
    }
  })()`);
  await click('[data-act="depart"]');
  await step(20);
  for (let i = 0; i < 3; i++) { await click('.choice', '出发'); await step(15); }
  await step(30);

  // —— 4. 山脊上的 HUD：体温一路往下掉 ——
  if (want('hud')) {
    await ev(`(() => {
      const g = __game, st = g.st;
      g.checkTriggers = () => {}; g.updateGust = () => {}; g.checkNpcSpawns = () => {}; g.thresholdNotes = () => {};
      const s = 352; const p = g.path().pointAt(s);
      st.s = s; st.maxS = s; st.pos = { x: p.x, z: p.z }; st.time = 12 * 60 + 40;
      st.wearInsul = true; st.body.core = 36.5; st.body.stamina = 72; st.body.wet = 8;
      g.start(st); g.autoWalk = true;
    })()`);
    await step(60);
    await ev(`(() => { document.getElementById('card').innerHTML = ''; document.getElementById('card').className = ''; document.getElementById('toasts').innerHTML = ''; const css = document.createElement('style'); css.textContent = '#toasts{top:214px!important;bottom:auto!important}'; document.head.appendChild(css); })()`);
    const core = (t) => (t < 2.6 ? 36.4 : t < 4.1 ? 35.8 : t < 6.2 ? 35.2 : 34.4);
    const wet = (t) => 8 + Math.max(0, Math.min(1, (t - 5.0) / 1.4)) * 55;
    await capture('hud', 9.0, async (t) => {
      await ev(`(() => { const b = __game.st.body; b.core = ${core(t)}; b.wet = ${wet(t)}; __game.refreshHud(true); })()`);
      if (Math.abs(t - 1.8) < 0.5 / FPS) await ev(`__game.toast('一口白酒下肚，一股暖流涌遍全身……其实那是皮肤血管扩张的错觉，核心的热量正在流失。', 'warn', 2600)`);
      if (Math.abs(t - 3.4) < 0.5 / FPS) await ev(`__game.toast('你抓了把雪塞进嘴里。解不了多少渴，却冻得牙疼——吃雪会消耗宝贵的体温。', 'warn', 2600)`);
      if (Math.abs(t - 5.2) < 0.5 / FPS) await ev(`__game.toast('你开始出汗了。走路时穿着羽绒服，汗水会打湿衣物——湿了就不保暖了。', 'warn', 3000)`);
    });
  }

  // —— 5. 管护站：选"回去。去景区吃烤肠"，看最佳结局 ——
  if (want('gate')) {
    await ev(`(() => {
      const g = __game, st = g.st;
      g.autoWalk = false; g.checkTriggers = () => {}; g.updateGust = () => {}; g.thresholdNotes = () => {};
      const s = g.path().waypoints.find((w) => w.id === 'gate').s - 6; const p = g.path().pointAt(s);
      st.s = s; st.pos = { x: p.x, z: p.z }; st.time = 5 * 60 + 40; st.body.core = 36.8; st.body.wet = 0; st.wearInsul = true;
      g.start(st);
    })()`);
    await step(45);
    // no tips or place cards over the gate dialog
    await ev(`(() => { const c = document.getElementById('card'); c.innerHTML = ''; c.className = ''; document.getElementById('toasts').innerHTML = '';
      __game.ui.card = () => {}; __game._toast = __game.toast; __game.toast = () => {}; })()`);
    await step(5);
    await capture('gate', 6.5, async (t) => {
      if (Math.abs(t - 0.1) < 0.5 / FPS) await ev(`__game.runEvent(() => __game.gateScene()), 1`);
      if (Math.abs(t - 2.0) < 0.5 / FPS) console.log('RECT gate.choice', JSON.stringify(await ev(`[...document.querySelectorAll('.choice')].map((e) => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })`)));
      await pressAt('.choice', '回去', 2.3)(t);
    });
    console.log('RECT end.stamp', JSON.stringify(await ev(`(() => { const r = document.querySelector('.end-head .stamp').getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })()`)));
    console.log('RECT end.lines', JSON.stringify(await ev(`[...document.querySelectorAll('.end-story p')].map((e) => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })`)));
  }
  const errs = page.logs.filter((l) => /EXC|rror/.test(l));
  if (errs.length) console.log(errs.slice(0, 8).join('\n'));
} finally { b.kill(); }
