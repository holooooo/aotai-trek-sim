// Render film.html shots: stepped on a virtual clock (1/30 s per frame) in headless Chrome (Metal WebGL2).
// usage: node promo/shoot.mjs <shot> [--stills 0,2.5,5] [--w 540 --h 960 --dpr 2] [--out dir] [--q 92]
//   full shot -> promo/build/frames/<shot>/0001.jpg ...   stills -> promo/build/stills/<shot>_<t>.jpg
import { launch } from './cdp.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const name = process.argv[2];
const W = +arg('w', 540), H = +arg('h', 960), DPR = +arg('dpr', 2), FPS = 30, Q = +arg('q', 92);
const stills = arg('stills', null);
const BASE = process.env.BASE || 'http://localhost:5199';
const extra = arg('params', '');

const b = await launch({ width: W, height: H });
try {
  const page = await b.open(`${BASE}/promo/film.html?shot=${name}${extra ? '&' + extra : ''}`, { dpr: DPR });
  const ready = await page.evaluate('window.READY === true').catch(() => false);
  if (!ready) { console.log('not ready', page.logs.join('\n')); process.exit(1); }
  const dur = await page.evaluate('window.DURATION');
  await page.evaluate(`__warm(${+arg('warm', 90)})`);
  if (stills) {
    const dir = path.join(HERE, 'build/stills'); mkdirSync(dir, { recursive: true });
    for (const ts of stills.split(',').map(Number)) {
      await page.evaluate(`__seek(${ts})`);
      const f = path.join(dir, `${name}${W > H ? '_w' : W === H ? '_sq' : ''}_${ts.toFixed(1)}.jpg`);
      writeFileSync(f, await page.screenshot(Q));
      console.log(f);
    }
  } else {
    const dir = arg('out', path.join(HERE, 'build/frames', name)); mkdirSync(dir, { recursive: true });
    const N = Math.round(dur * FPS), t0 = Date.now();
    for (let f = 0; f < N; f++) {
      await page.evaluate('__step(1/30)');
      writeFileSync(path.join(dir, String(f + 1).padStart(4, '0') + '.jpg'), await page.screenshot(Q));
      if (f % 60 === 0) console.log(`${name} ${f}/${N} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
    console.log('done', name, N, 'frames', ((Date.now() - t0) / 1000).toFixed(0) + 's');
  }
  const errs = page.logs.filter((l) => /EXC|rror/.test(l));
  if (errs.length) console.log(errs.slice(0, 5).join('\n'));
} finally { b.kill(); }
