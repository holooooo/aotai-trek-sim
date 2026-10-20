import test from 'node:test';
import assert from 'node:assert/strict';
import { ensurePsychology, stepStress } from '../src/sim/stress.js';

const state = () => ({
  time: 500, airplane: false, inv: { firstaid: 1 }, thermos: { l: 1, temp: 80 },
  body: { stress: 60, core: 37, health: 100, stamina: 80, food: 80, water: 80, fracture: 0, sprain: 0, frostbite: 0, altSick: 0 },
});
const role = { id: 'nurse', mods: { stressGain: 1, sleepRecovery: 1 } };
const act = (extra = {}) => ({ mode: 'walk', severity: 0.2, night: false, lost: false, alone: false, companions: 0, signal: false, ...extra });
const almost = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message || ''}: ${actual} vs ${expected}`);
const copied = (value) => JSON.parse(JSON.stringify(value));

// These expectations describe the old environmental sources as well as the new
// user-facing outcomes, rather than making the body implementation a test oracle.
test('night, bad weather, lost route, solitude and altitude pressure sources are preserved', () => {
  for (const [change, expected] of [
    [{ night: true }, 0.028], [{ lost: true }, 0.12], [{ alone: true }, 0.014], [{ severity: 1 }, 0.05],
  ]) {
    const s = state(), result = stepStress(s, {}, act(change), 10, role);
    almost(result.gain, expected * 10); almost(s.body.stress, 60 + expected * 10);
  }
  const s = state(); s.body.altSick = 50;
  almost(stepStress(s, {}, act(), 10, role).gain, 0.2);
});

test('legacy daytime rest, shelter, companionship and blogger contact relief are retained', () => {
  for (const [env, action, who, expected] of [
    [{ tentInfo: {} }, act(), role, 0.035],
    [{}, act({ mode: 'rest' }), role, 0.015],
    [{}, act({ mode: 'rest' }), { id: 'runner', mods: {} }, 0.006],
    [{}, act({ companions: 1 }), role, 0.02],
    [{}, act({ severity: 0 }), role, 0.012],
    [{}, act({ signal: true }), { id: 'blogger', mods: {} }, 0.02],
  ]) almost(stepStress(state(), env, action, 10, who).relief, expected * 10);
  const s = state(); s.airplane = true;
  assert.equal(stepStress(s, {}, act({ signal: true }), 10, { id: 'blogger', mods: {} }).relief, 0);
});

test('ongoing injuries, exhaustion, hunger, thirst, cold and low health each add pressure', () => {
  const baseline = stepStress(state(), {}, act(), 20, role).gain;
  for (const [key, value] of [['fracture', 1], ['sprain', 1], ['frostbite', 70], ['stamina', 0], ['food', 0], ['water', 0], ['core', 34], ['health', 20]]) {
    const s = state(); s.body[key] = value; ensurePsychology(s);
    const result = stepStress(s, {}, act(), 20, role);
    assert.ok(result.gain > baseline, key);
    assert.equal(result.shock, 0, 'persistent distress is independent of an already known injury shock');
    assert.ok(s.body.stress > 60, key);
  }
});

test('a new fracture causes a large one-time shock, then ongoing pain rather than repeated shocks', () => {
  const s = state(); ensurePsychology(s); s.body.fracture = 1;
  const first = stepStress(s, {}, act(), 1, role);
  assert.ok(first.shock >= 20); assert.ok(s.body.stress > 80);
  const second = stepStress(s, {}, act(), 1, role);
  assert.equal(second.shock, 0); assert.ok(second.gain > 0.1);
  const restored = copied(s);
  assert.equal(stepStress(restored, {}, act(), 1, role).shock, 0, 'reload does not replay the injury');
  assert.deepEqual(restored.psychology.injuries, s.psychology.injuries);
});

test('a recovered sprain and a treated fracture can cause a new shock only if they worsen again', () => {
  const s = state(); ensurePsychology(s);
  s.body.sprain = 1; const first = stepStress(s, {}, act(), 1, role).shock; assert.ok(first > 0);
  s.body.sprain = 0; assert.equal(stepStress(s, {}, act(), 1, role).shock, 0);
  s.body.sprain = 1; assert.equal(stepStress(s, {}, act(), 1, role).shock, first);
  s.body.fracture = 1; stepStress(s, {}, act(), 1, role);
  s.body.fracture = 0.5; assert.equal(stepStress(s, {}, act(), 1, role).shock, 0);
  s.body.fracture = 1; assert.ok(stepStress(s, {}, act(), 1, role).shock > 0);
});

test('fractional frostbite progression triggers only at new severity bands, not every physics step', () => {
  const s = state(); ensurePsychology(s);
  for (const level of [0.1, 2, 9.9]) { s.body.frostbite = level; assert.equal(stepStress(s, {}, act(), 1, role).shock, 0); }
  s.body.frostbite = 10; assert.ok(stepStress(s, {}, act(), 1, role).shock > 0);
  for (const level of [10.01, 14, 29.99]) { s.body.frostbite = level; assert.equal(stepStress(s, {}, act(), 1, role).shock, 0); }
  s.body.frostbite = 30; assert.ok(stepStress(s, {}, act(), 1, role).shock > 0);
  s.body.frostbite = 85; const sudden = stepStress(s, {}, act(), 1, role).shock;
  assert.ok(sudden > 0); assert.equal(stepStress(s, {}, act(), 1, role).shock, 0);
});

test('legacy injured saves become a baseline without a replayed shock and preserve unrelated state', () => {
  const s = state(); Object.assign(s.body, { fracture: 1, sprain: 1, frostbite: 65 });
  s.psychology = { memo: 'saved separately' };
  const beforeBody = copied(s.body), beforeInv = copied(s.inv);
  const p = ensurePsychology(s);
  assert.equal(p.memo, 'saved separately'); assert.deepEqual(s.body, beforeBody); assert.deepEqual(s.inv, beforeInv);
  assert.equal(stepStress(s, {}, act(), 5, role).shock, 0);
  assert.deepEqual(copied(s.psychology), s.psychology, 'state contains JSON data only');
});

test('warm fed hydrated sleep visibly lowers stress per minute without healing or changing supplies', () => {
  const s = state(); s.body.sprain = 1; ensurePsychology(s);
  const before = copied(s), result = stepStress(s, { tentInfo: {} }, act({ mode: 'sleep', night: true }), 120, role);
  assert.ok(result.relief > result.gain); assert.ok(s.body.stress < 45, 'rest has a noticeable cumulative effect');
  const body = { ...s.body }; body.stress = before.body.stress;
  assert.deepEqual(body, before.body, 'sleep stress relief cannot heal an injury or replenish body reserves');
  const withoutPsychology = copied(s); delete withoutPsychology.psychology; withoutPsychology.body.stress = before.body.stress;
  const beforeWithoutPsychology = copied(before); delete beforeWithoutPsychology.psychology;
  assert.deepEqual(withoutPsychology, beforeWithoutPsychology, 'no resources or clock are altered');
});

test('cold, starving or dehydrated sleep cannot unlock restorative sleep relief', () => {
  for (const changes of [{ core: 34.5 }, { food: 0 }, { water: 0 }, { core: 35.8 }]) {
    const s = state(); Object.assign(s.body, changes);
    const result = stepStress(s, { tentInfo: {} }, act({ mode: 'sleep', night: true, alone: true }), 120, role);
    assert.ok(s.body.stress >= 60, JSON.stringify(changes));
    assert.ok(result.gain >= result.relief, JSON.stringify(changes));
  }
});

test('sleepRecovery changes sleeping relief while nutrition scales ongoing gains, not acute trauma', () => {
  const slow = state(), fast = state();
  const sleeping = act({ mode: 'sleep', night: true });
  const low = stepStress(slow, {}, sleeping, 60, { id: 'a', mods: { sleepRecovery: 0.5 } });
  const high = stepStress(fast, {}, sleeping, 60, { id: 'b', mods: { sleepRecovery: 1.5 } });
  assert.ok(high.relief > low.relief); assert.ok(fast.body.stress < slow.body.stress);
  const withFood = state(), withoutFood = state();
  ensurePsychology(withFood); ensurePsychology(withoutFood); withFood.body.fracture = withoutFood.body.fracture = 1;
  const reduced = stepStress(withFood, {}, act(), 1, role, { stressGain: 0.7 });
  const ordinary = stepStress(withoutFood, {}, act(), 1, role);
  assert.ok(reduced.gain < ordinary.gain); assert.equal(reduced.shock, ordinary.shock);
});

test('splitting identical conditions into physics steps does not alter accumulated stress or shocks', () => {
  const whole = state(), split = state(); ensurePsychology(whole); ensurePsychology(split);
  whole.body.fracture = split.body.fracture = 1;
  const a = stepStress(whole, {}, act(), 60, role), totals = { gain: 0, relief: 0, shock: 0 };
  for (let i = 0; i < 30; i++) {
    const next = stepStress(split, {}, act(), 2, role);
    for (const key of Object.keys(totals)) totals[key] += next[key];
  }
  almost(whole.body.stress, split.body.stress);
  for (const key of Object.keys(totals)) almost(a[key], totals[key], key);
});

test('stress remains bounded; invalid or zero durations have no effects or initialization', () => {
  const s = state();
  for (const duration of [0, -1, NaN, Infinity, undefined]) {
    const before = copied(s);
    assert.deepEqual(stepStress(s, {}, act(), duration, role), { gain: 0, relief: 0, shock: 0 });
    assert.deepEqual(s, before);
  }
  ensurePsychology(s); s.body.fracture = 1;
  stepStress(s, {}, act({ night: true, lost: true }), 10000, role); assert.equal(s.body.stress, 100);
  s.body.fracture = 0;
  stepStress(s, { tentInfo: {} }, act({ mode: 'sleep', night: true }), 10000, role); assert.equal(s.body.stress, 0);
  assert.deepEqual(stepStress(null, {}, {}, 1, role), { gain: 0, relief: 0, shock: 0 });
});
