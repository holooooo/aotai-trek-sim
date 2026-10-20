import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLES, roleById } from '../src/data/roles.js';
import { ITEMS } from '../src/data/items.js';
import { createState } from '../src/sim/state.js';
import { applyFood } from '../src/sim/nutrition.js';
import { stepStress } from '../src/sim/stress.js';

const NEW_ROLE_IDS = ['cook', 'geographer', 'porter', 'photographer'];
const ORIGINAL_ROLE_IDS = ['student', 'veteran', 'blogger', 'runner', 'nurse', 'coder'];
const MOD_KEYS = new Set([
  'staminaDrain', 'speed', 'heatLoss', 'stressGain', 'nav', 'firstAid', 'persuade',
  'heavyLoad', 'foodComfort', 'sleepRecovery', 'keepWarmElectronics', 'showCore',
]);
const LOOK_KEYS = ['jacket', 'pants', 'hat', 'pack', 'skin'];

const stressState = () => ({
  body: { stress: 60, core: 37, health: 100, stamina: 80, food: 80, water: 80, fracture: 0, sprain: 0, frostbite: 0, altSick: 0 },
});
const sleep = { mode: 'sleep', night: true, severity: 0, lost: false, alone: false, companions: 0, signal: false };

for (const id of NEW_ROLE_IDS) {
  test(`${id} has complete role data, valid gear, and a constructible state`, () => {
    const role = roleById(id);
    assert.ok(role, id);
    assert.equal(role.id, id);
    assert.ok(role.name && role.short && role.tagline && role.desc, id);
    assert.ok(Number.isSafeInteger(role.money) && role.money > 0, id);
    assert.ok(Array.isArray(role.skills) && role.skills.length >= 2, `${id} skills`);
    assert.ok(Array.isArray(role.flaws) && role.flaws.length >= 2, `${id} flaws`);
    assert.deepEqual(Object.keys(role.look).sort(), [...LOOK_KEYS].sort(), `${id} look`);
    for (const value of Object.values(role.look)) assert.ok(Number.isInteger(value) && value >= 0 && value <= 0xffffff, `${id} look color`);
    for (const [key, value] of Object.entries(role.mods)) {
      assert.ok(MOD_KEYS.has(key), `${id} unknown mod ${key}`);
      if (typeof value === 'number') assert.ok(Number.isFinite(value) && value >= 0, `${id} invalid ${key}`);
      else assert.equal(typeof value, 'boolean', `${id} invalid ${key}`);
    }
    for (const [itemId, quantity] of Object.entries(role.inv)) {
      assert.ok(ITEMS[itemId], `${id} missing item ${itemId}`);
      assert.ok(Number.isSafeInteger(quantity) && quantity > 0, `${id} invalid quantity ${itemId}`);
    }
    const st = createState(id, 'easy');
    assert.equal(st.role, id);
    assert.equal(st.money, role.money);
    assert.ok(st.body && st.inv && st.bat, `${id} state shape`);
    for (const [itemId, quantity] of Object.entries(role.inv)) {
      if (itemId === 'water') assert.equal(st.water.liquid, ITEMS.water.liters * quantity, `${id} water`);
      else if (itemId === 'gas') assert.equal(st.gas.normal, ITEMS.gas.units * quantity, `${id} gas`);
      else if (itemId === 'gas_alpine') assert.equal(st.gas.alpine, ITEMS.gas_alpine.units * quantity, `${id} alpine gas`);
      else if (itemId === 'warmer') assert.equal(st.warmers, ITEMS.warmer.pieces * quantity, `${id} warmers`);
      else if (itemId === 'powerbank') assert.equal(st.inv.powerbank, quantity, `${id} powerbank inventory`);
      else assert.equal(st.inv[itemId], quantity, `${id} inventory ${itemId}`);
    }
  });
}

test('all original role IDs remain available through roleById', () => {
  assert.deepEqual(ORIGINAL_ROLE_IDS.map((id) => roleById(id)?.id), ORIGINAL_ROLE_IDS);
  assert.equal(new Set(ROLES.map((role) => role.id)).size, ROLES.length);
});

test('cook foodComfort is consumed by real food stress relief', () => {
  const cook = createState('cook', 'easy');
  const ordinary = createState('student', 'easy');
  cook.body.stress = ordinary.body.stress = 60;
  assert.equal(applyFood(cook, 'selfheat', { hot: true }), true);
  assert.equal(applyFood(ordinary, 'selfheat', { hot: true }), true);
  assert.ok(cook.body.stress < ordinary.body.stress, 'cook should gain stronger comfort from hot food');
});

test('porter sleepRecovery increases only the extra warm-fed sleep relief', () => {
  const porter = stressState();
  const ordinary = stressState();
  const baseline = stepStress(ordinary, {}, sleep, 60, roleById('runner'));
  const enhanced = stepStress(porter, {}, sleep, 60, roleById('porter'));
  assert.equal(enhanced.gain, baseline.gain);
  assert.equal(enhanced.relief, baseline.relief * 1.2);
  assert.equal(porter.body.stress < ordinary.body.stress, true);
});

test('photographer sleep weakness and geographer stress reduction are consumed by stepStress', () => {
  const photographer = stressState();
  const ordinarySleep = stressState();
  const baselineSleep = stepStress(ordinarySleep, {}, sleep, 60, roleById('runner'));
  const reducedSleep = stepStress(photographer, {}, sleep, 60, roleById('photographer'));
  assert.equal(reducedSleep.relief, baselineSleep.relief * 0.85);

  const pressure = { ...sleep, mode: 'walk', night: false, severity: 0.5 };
  const ordinaryWalk = stepStress(stressState(), {}, pressure, 20, roleById('runner'));
  const calmWalk = stepStress(stressState(), {}, pressure, 20, roleById('geographer'));
  assert.ok(Math.abs(calmWalk.gain - ordinaryWalk.gain * 0.82) < 1e-12);
});

test('new roles expose the intended actual tradeoff mods', () => {
  assert.equal(roleById('cook').mods.foodComfort, 1.4);
  assert.equal(roleById('geographer').mods.nav, 1.65);
  assert.equal(roleById('porter').mods.heavyLoad, 0.6);
  assert.equal(roleById('porter').mods.sleepRecovery, 1.2);
  assert.equal(roleById('photographer').mods.persuade, 0.9);
  assert.equal(roleById('photographer').mods.sleepRecovery, 0.85);
});
