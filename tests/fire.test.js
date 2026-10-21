import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureFire, lightFire, consumeFire, fireCostAvailable } from '../src/sim/fire.js';

test('lighting starts one six-unit bottle and each action consumes flame balance', () => {
  const st = { gas: { normal: 6, alpine: 0 } };
  const lit = lightFire(st);
  assert.equal(lit.ok, true);
  assert.equal(st.fire.balance, 6);
  assert.equal(fireCostAvailable(st, 2), true);
  assert.equal(consumeFire(st, 2).ok, true);
  assert.equal(st.fire.balance, 4);
  assert.equal(st.gas.normal, 4);
});

test('depleted bottle is marked scrapped and must be lit again for the next bottle', () => {
  const st = { gas: { normal: 7, alpine: 0 } };
  lightFire(st);
  const result = consumeFire(st, 6);
  assert.equal(result.scrapped, true);
  assert.equal(st.fire.active, false);
  assert.equal(st.fire.scrapped, 1);
  assert.equal(st.gas.normal, 1);
  assert.equal(lightFire(st).ok, true);
  assert.equal(st.fire.balance, 1);
  consumeFire(st, 1);
  assert.equal(st.fire.scrapped, 2);
  assert.equal(st.gas.normal, 0);
});

test('old saves receive an inactive fire state without changing gas', () => {
  const st = { gas: { normal: 3, alpine: 0 } };
  const fire = ensureFire(st);
  assert.deepEqual(fire, { active: false, fuel: null, balance: 0, scrapped: 0 });
  assert.deepEqual(st.gas, { normal: 3, alpine: 0 });
});
