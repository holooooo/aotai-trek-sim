// Render poster.html at 4:3 (1440x1080) and 3:4 (1080x1440) -> promo/build/cover_4x3.png / cover_3x4.png
// add --guides to overlay the platform-UI safe zones for checking.
import { launch } from './cdp.mjs';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE || 'http://localhost:5199';
const guides = process.argv.includes('--guides');
for (const [r, w, h] of [['43', 720, 540], ['34', 540, 720]]) {
  const b = await launch({ width: w, height: h });
  try {
    const page = await b.open(`${BASE}/promo/poster.html?r=${r}`, { dpr: 2 });
    if (guides) await page.evaluate(`(() => { const g = document.createElement('div'); g.style.cssText = 'position:absolute;inset:0;pointer-events:none';
      g.innerHTML = '<div style="position:absolute;left:0;bottom:0;width:38%;height:22%;background:rgba(255,0,0,.35)"></div><div style="position:absolute;right:0;bottom:0;width:30%;height:22%;background:rgba(255,0,0,.35)"></div>';
      document.getElementById('p').appendChild(g); })()`);
    const m = await page.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    const f = path.join(HERE, 'build', `cover_${r === '43' ? '4x3' : '3x4'}${guides ? '_guides' : ''}.png`);
    writeFileSync(f, Buffer.from(m.result.data, 'base64'));
    console.log(f, page.logs.filter((l) => /EXC|rror/.test(l)).join(' '));
  } finally { b.kill(); }
}
