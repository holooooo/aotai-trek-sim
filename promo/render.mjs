// Render the composed promo page: stepped on a virtual clock (1/30 s per frame) in headless Chrome.
// usage: node promo/render.mjs [--stills 0.6,2.4,...] [--from 0 --to 60]   ->  promo/build/frames/final/0001.jpg ...
import { launch } from './cdp.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const W = 540, H = 960, DPR = 2, FPS = 30;
const BASE = process.env.BASE || 'http://localhost:5199';
const stills = arg('stills', null);
const from = +arg('from', 0), to = +arg('to', 1e9);

const CLOCK = `(() => {
  let now = 1000; const q = [];
  performance.now = () => now;
  window.requestAnimationFrame = (cb) => { q.push(cb); return q.length; };
  window.cancelAnimationFrame = () => {};
  window.__step = (dt) => { now += dt * 1000; for (const c of q.splice(0)) c(now); };
})();`;

const b = await launch({ width: W, height: H });
try {
  const page = await b.open(`${BASE}/promo/compose.html`, { dpr: DPR, init: CLOCK });
  const ready = await page.evaluate('window.READY === true').catch(() => false);
  if (!ready) { console.log('not ready', page.logs.join('\n')); process.exit(1); }
  const dur = await page.evaluate('window.DURATION');
  if (stills) {
    const dir = path.join(HERE, 'build/stills'); mkdirSync(dir, { recursive: true });
    for (const ts of stills.split(',').map(Number)) {
      await page.evaluate(`renderFrame(${ts})`);
      const f = path.join(dir, `final_${ts.toFixed(2)}.jpg`);
      writeFileSync(f, await page.screenshot(90));
      console.log(f);
    }
  } else {
    const dir = path.join(HERE, 'build/frames/final'); mkdirSync(dir, { recursive: true });
    const N = Math.round(dur * FPS), t0 = Date.now();
    for (let f = 0; f < N; f++) {
      if (f < from * FPS || f >= to * FPS) continue;
      await page.evaluate(`renderFrame(${(f / FPS).toFixed(4)})`);
      writeFileSync(path.join(dir, String(f + 1).padStart(4, '0') + '.jpg'), await page.screenshot(88));
      if (f % 90 === 0) console.log(`final ${f}/${N} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
    console.log('done final', N, 'frames', ((Date.now() - t0) / 1000).toFixed(0) + 's');
  }
  const errs = page.logs.filter((l) => /EXC|rror/.test(l));
  if (errs.length) console.log(errs.slice(0, 6).join('\n'));
} finally { b.kill(); }
