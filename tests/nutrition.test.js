import test from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/sim/state.js';
import { applyFood, activeFoodEffects, foodEffectSummary, nutritionModifiers, stepFoodEffects } from '../src/sim/nutrition.js';

const state = () => createState('runner', 'easy');

test('legacy food keeps old IDs while providing stronger immediate and sustained value', () => {
  const expected = {
    biscuit: [30, 0], chocolate: [18, 14], bar: [16, 12], gel: [9, 24], jerky: [22, 0], noodle: [30, 0], selfheat: [40, 0],
  };
  for (const [id, [food, stamina]] of Object.entries(expected)) {
    const st = state(); st.body.food = 0; st.body.stamina = 0;
    assert.equal(applyFood(st, id, { hot: id === 'noodle' }), true);
    assert.equal(st.body.food, food, id);
    assert.equal(st.body.stamina, stamina, id);
    assert.ok(foodEffectSummary(id).includes('持续') || foodEffectSummary(id).includes('快速') || foodEffectSummary(id).includes('热食'), id);
  }
  assert.match(foodEffectSummary('glucose'), /不替代伤病/);
  const dry = state(); dry.body.water = 50; applyFood(dry, 'dried_fruit');
  assert.equal(dry.body.water, 49);
  assert.match(foodEffectSummary('dried_fruit'), /配水/);
});

test('a weaker food cannot downgrade an already stronger same-ID effect', () => {
  const st = state();
  applyFood(st, 'bar');
  applyFood(st, 'biscuit');
  assert.deepEqual(activeFoodEffects(st).find((effect) => effect.id === 'steady_energy'), { id: 'steady_energy', label: '持续供能', minutes: 45 });
  assert.equal(nutritionModifiers(st).staminaDrain, 0.9);
  const fast = state(); applyFood(fast, 'chocolate'); applyFood(fast, 'gel'); applyFood(fast, 'glucose');
  assert.equal(nutritionModifiers(fast).staminaDrain, 0.8);
  assert.deepEqual(activeFoodEffects(fast).find((effect) => effect.id === 'quick_energy'), { id: 'quick_energy', label: '快速供能', minutes: 25 });
  const injured = state(); injured.body.health = 50; injured.body.fracture = 1; applyFood(injured, 'glucose');
  assert.equal(injured.body.health, 50);
  assert.equal(injured.body.fracture, 1);
});
test('foodEffectSummary is a stable string API and active effects expose UI shape', () => {
  assert.equal(typeof foodEffectSummary('trail_mix'), 'string');
  assert.ok(foodEffectSummary('trail_mix').length > 0);
  assert.equal(foodEffectSummary('missing'), '');
  assert.deepEqual(activeFoodEffects(state()), []);
});

test('applyFood changes nutrition without consuming inventory or hot water', () => {
  const st = state();
  st.inv.trail_mix = 1;
  st.thermos.l = 0.8; st.thermos.temp = 90;
  const before = { food: st.body.food, water: st.body.water, stamina: st.body.stamina, thermos: st.thermos.l };
  assert.equal(applyFood(st, 'trail_mix'), true);
  assert.equal(st.inv.trail_mix, 1);
  assert.equal(st.thermos.l, before.thermos);
  assert.equal(st.body.food, before.food + 14);
  assert.equal(st.body.water, before.water - 1);
  assert.equal(st.body.stamina, 100);
});

test('hot food gives bounded heat and hydration; cold preparation has no hidden heat', () => {
  const hot = state(); hot.body.core = 37.1; hot.thermos.l = 0.6;
  assert.equal(applyFood(hot, 'soup_pack', { hot: true }), true);
  assert.ok(hot.body.core <= 37.2);
  assert.ok(hot.body.water <= 100);
  assert.equal(hot.thermos.l, 0.6);
  const cold = state(); cold.body.core = 36.4;
  applyFood(cold, 'soup_pack', { hot: false });
  assert.equal(cold.body.core, 36.4);
  assert.ok(cold.body.food < 85 + 8);
});

test('nutrition values and health remain bounded for extreme starting states', () => {
  const st = state();
  Object.assign(st.body, { core: 99, health: 999, food: 99, water: 99, stamina: 99, stress: -20 });
  assert.equal(applyFood(st, 'freeze_dried', { hot: true }), true);
  assert.ok(st.body.core <= 37.6 && st.body.health <= 200);
  assert.ok(st.body.food <= 100 && st.body.water <= 100 && st.body.stamina <= 100 && st.body.stress >= 0);
});

test('same food effect refreshes in place instead of stacking entries or modifiers', () => {
  const st = state();
  applyFood(st, 'trail_mix');
  const first = activeFoodEffects(st);
  assert.deepEqual(first, [{ id: 'steady_energy', label: '持续供能', minutes: 45 }]);
  stepFoodEffects(st, 20);
  applyFood(st, 'oat_bar');
  assert.deepEqual(activeFoodEffects(st), [{ id: 'steady_energy', label: '持续供能', minutes: 35 }]);
  assert.equal(nutritionModifiers(st).staminaDrain, 0.9);
  stepFoodEffects(st, 45);
  assert.deepEqual(activeFoodEffects(st), []);
  assert.deepEqual(nutritionModifiers(st), { staminaDrain: 1, foodDrain: 1, stressGain: 1, restRecovery: 1, waterDrain: 1 });
});

test('alcohol never grants core heat and exposes risk while preserving existing risk timer', () => {
  const st = state(); st.body.core = 36.8;
  assert.equal(applyFood(st, 'baijiu'), true);
  assert.equal(st.body.core, 36.8);
  assert.equal(st.alcoholLeft, 120);
  assert.deepEqual(activeFoodEffects(st), [{ id: 'alcohol_risk', label: '饮酒后失温风险', minutes: 120 }]);
  assert.equal(nutritionModifiers(st).heatLoss, undefined);
  stepFoodEffects(st, 120);
  assert.equal(st.alcoholLeft, 120, 'legacy body simulation owns alcohol decay');
  st.alcoholLeft = 0;
  assert.deepEqual(activeFoodEffects(st), []);
});

test('stepFoodEffects ignores invalid duration and never creates effects', () => {
  const st = state();
  assert.deepEqual(stepFoodEffects(st, -10), []);
  assert.deepEqual(stepFoodEffects(st, Number.NaN), []);
  assert.deepEqual(activeFoodEffects({ foodEffects: [{ id: 'bad', label: '', minutes: 1000 }] }), []);
});
