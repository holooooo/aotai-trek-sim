import test from 'node:test';
import assert from 'node:assert/strict';
import { mainPath, branches, columnInfo } from '../src/world/terrain.js';
import { voxToAlt } from '../src/data/route.js';

const ground = (x, z) => columnInfo(Math.floor(x), Math.floor(z)).h;

test('the physical village road continues past the Sigma window without an impassable step', () => {
  const p = mainPath.pointAt(0); let prev;
  for (let along = 4; along >= -35; along -= .25) {
    const h = ground(p.x + p.dx * along, p.z + p.dz * along);
    if (prev !== undefined) assert.ok(Math.abs(h - prev) <= 1, `village road step at ${along}`);
    prev = h;
  }
});

test('the actual branch terrain descends continuously and ends below 1600', () => {
  const b = branches.hetaoping; let prev;
  for (let s = 0; s <= b.length; s += 1) {
    const p = b.pointAt(s), h = ground(p.x, p.z);
    if (prev !== undefined) {
      assert.ok(h - prev <= 1, `uphill obstruction at ${s}`);
      assert.ok(prev - h <= 2, `falling shortcut at ${s}`);
    }
    prev = h;
  }
  assert.ok(voxToAlt(prev) < 1600);
});

test('wide lowland queries agree with an exhaustive route search', () => {
  for (const s of [1250, 1400, 1700, 2000]) {
    const p = mainPath.pointAt(s);
    for (const d of [80, 150, 220, 235]) {
      const x = p.x - p.dz * d, z = p.z + p.dx * d;
      let best = Infinity;
      for (let i = 0; i < mainPath.n - 1; i++) best = Math.min(best, mainPath._segDist(i, x, z).d2);
      assert.ok(Math.abs(mainPath.nearest(x, z).d - Math.sqrt(best)) < .001, `wrong segment at ${s}/${d}`);
    }
  }
});

test('the village road reconnects to outer terrain without a cliff', () => {
  const p = mainPath.pointAt(0); let prev;
  for (let along = -35; along >= -84; along -= .25) {
    const h = ground(p.x + p.dx * along, p.z + p.dz * along);
    if (prev !== undefined) assert.ok(Math.abs(h - prev) <= 1, `outer road cliff at ${along}`);
    prev = h;
  }
});

test('post-camp lowland exists away from both predefined route centers', () => {
  const p = mainPath.pointAt(1400), x = p.x - p.dz * 270, z = p.z + p.dx * 270;
  assert.ok(mainPath.nearest(x, z).d > 100);
  assert.ok(branches.hetaoping.nearest(x, z).d > 14);
  assert.ok(voxToAlt(ground(x, z)) < 1600);
});
