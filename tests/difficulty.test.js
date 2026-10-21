import test from 'node:test';
import assert from 'node:assert/strict';
import { DIFFICULTIES, difficultyProfile, maxHealth, ensureDifficulty, setDifficulty } from '../src/sim/difficulty.js';
import { createState } from '../src/sim/state.js';
import { stepBody, computeEnv } from '../src/sim/body.js';
import { airTemp, WEATHER } from '../src/sim/weather.js';
import { Game } from '../src/sim/game.js';
import { roleById } from '../src/data/roles.js';

const role = roleById('nurse');
const env = (temperature = -15) => ({
  T: temperature, Teff: temperature, wind: 4, wct: temperature, precip: 0, tentInfo: null,
  cl: { clo: 2, windproof: 0.8, waterproof: 0.8, hat: true, gloves: true, eyes: true, gaiters: true, shoeDry: 1, cotton: false },
});
const act = (mode = 'walk') => ({ mode, effort: 1, downhill: false, terrainStamina: 1, load: 1, snowDeep: 0,
  alt: 2500, sunny: false, night: false, severity: 0, lost: false, alone: false, companions: 0, signal: true });
const state = (difficulty) => {
  const st = createState('nurse', difficulty);
  st.powerbank = 0;
  return st;
};

// 真正执行 stepBody，避免仅验证配置但遗漏内部的 100 上限。
test('new games default to easy with double health; spring, normal and hardcore retain explicit profiles', () => {
  const spring = createState('nurse', 'spring');
  const easy = createState('nurse');
  assert.equal(easy.difficulty, 'easy');
  assert.equal(easy.body.health, 200);
  assert.equal(spring.body.health, 240);
  assert.equal(createState('nurse', 'normal').body.health, 100);
  assert.equal(createState('nurse', 'hardcore').body.health, 100);
  assert.deepEqual(DIFFICULTIES.map((profile) => profile.id), ['spring', 'easy', 'normal', 'hardcore']);
});

test('spring air, wind chill and tent temperatures stay above freezing across all weather and elevations', () => {
  const st = JSON.parse(JSON.stringify(state('spring')));
  assert.equal(ensureDifficulty(st).id, 'spring');
  const g = Object.create(Game.prototype); g.st = st;
  const floor = difficultyProfile(st).minTemp;
  let coldBaseline = false;
  for (const [id, weather] of Object.entries(WEATHER)) {
    const wx = { ...weather, gust: 1.5 };
    for (const alt of [1500, 2500, 3767, 4200]) for (const hour of [2, 6, 14, 22]) for (const day of [0, 2, 5]) {
      const ctx = { alt, hour, day, wx, exposure: 1, inTent: false, camp: null };
      g.alt = () => alt; g.hour = () => hour; g.day = () => day; g.wx = () => wx;
      const env = computeEnv(st, ctx), label = `${id}:${alt}:${hour}:${day}`;
      assert.ok(env.T >= floor && env.wct >= floor && env.Teff >= floor, label);
      assert.equal(g.airT(), env.T, `HUD and simulation agree: ${label}`);
      const baseline = computeEnv(state('easy'), ctx);
      assert.equal(baseline.T, airTemp(alt, hour, wx, day), 'easy retains its winter temperature');
      coldBaseline ||= baseline.T < 0;
      ctx.inTent = true;
      ctx.camp = { tent: 'tent_light', exposure: 1, orient: 1, health: 1, doorIntoWind: true };
      const tent = computeEnv(st, ctx);
      assert.ok(tent.Teff >= floor && tent.tentInfo.Tin >= floor, `tent: ${label}`);
    }
  }
  assert.ok(floor > 0 && coldBaseline);
});

test('read-only difficulty lookup falls back to normal for old or invalid states', () => {
  const old = { body: { health: 41 } };
  assert.equal(difficultyProfile(old).id, 'normal');
  assert.equal(difficultyProfile('invalid').id, 'normal');
  assert.equal(difficultyProfile(null).id, 'normal');
  assert.equal('difficulty' in old, false);
  assert.equal(maxHealth('easy'), 200);
  assert.equal(maxHealth({ difficulty: 'hardcore' }), 100);
});

test('legacy save normalization preserves existing damage and injuries', () => {
  const old = state('normal');
  delete old.difficulty;
  Object.assign(old.body, { health: 43.7, core: 33.2, fracture: 0.5, frostbite: 65, sprain: 1 });
  const beforeBody = { ...old.body };
  assert.equal(ensureDifficulty(old).id, 'normal');
  assert.equal(old.difficulty, 'normal');
  assert.deepEqual(old.body, beforeBody);
  old.body.health = 0;
  ensureDifficulty(old);
  assert.equal(old.body.health, 0, 'migration must not revive a dead player');
  old.difficulty = 'broken'; old.body.health = 130;
  ensureDifficulty(old);
  assert.equal(old.difficulty, 'normal');
  assert.equal(old.body.health, 100);
});

test('switching new-game difficulty preserves health ratio and all other state', () => {
  const st = state('easy');
  Object.assign(st.body, { health: 150, fracture: 0.5, core: 35.8, frostbite: 55 });
  const otherBody = { ...st.body }; delete otherBody.health;
  const inventory = { ...st.inv };
  assert.equal(setDifficulty(st, 'hardcore').id, 'hardcore');
  assert.equal(st.body.health, 75);
  setDifficulty(st, 'easy');
  assert.equal(st.body.health, 150);
  const afterBody = { ...st.body }; delete afterBody.health;
  assert.deepEqual(afterBody, otherBody);
  assert.deepEqual(st.inv, inventory);
  st.body.health = 0; setDifficulty(st, 'normal');
  assert.equal(st.body.health, 0);
});

test('easy has exactly normal physiology, apart from its health reserve and cap', () => {
  const easy = state('easy'), normal = state('normal');
  // 同一起始健康、同一环境与行动；轻松不能偷偷放慢散热或消耗。
  easy.body.health = normal.body.health = 80;
  stepBody(easy, env(), act(), 20, role);
  stepBody(normal, env(), act(), 20, role);
  assert.deepEqual(easy.body, normal.body);
  assert.deepEqual(easy.bat, normal.bat);
  assert.deepEqual(easy.water, normal.water);
});

test('real stepBody never clamps easy health 200 to the normal cap', () => {
  const easy = state('easy');
  stepBody(easy, env(10), act(), 10, role);
  assert.equal(easy.body.health, 200);
  assert.equal(maxHealth(easy), 200);
});

test('natural recovery respects each difficulty health cap', () => {
  for (const id of ['easy', 'normal', 'hardcore']) {
    const st = state(id);
    st.body.health = maxHealth(st) - 0.05;
    stepBody(st, env(20), act('rest'), 10, role);
    assert.equal(st.body.health, maxHealth(st), id);
    stepBody(st, env(20), act('rest'), 10, role);
    assert.equal(st.body.health, maxHealth(st), `${id}: no overheal`);
  }
});

test('hardcore increases real heat loss, exertion, food and water consumption', () => {
  const normal = state('normal'), hardcore = state('hardcore');
  stepBody(normal, env(), act(), 20, role);
  stepBody(hardcore, env(), act(), 20, role);
  assert.ok(hardcore.body.core < normal.body.core, 'greater heat loss');
  assert.ok(hardcore.body.stamina < normal.body.stamina, 'greater stamina drain');
  assert.ok(hardcore.body.food < normal.body.food, 'greater food drain');
  assert.ok(hardcore.body.water < normal.body.water, 'greater water drain');
});

test('hardcore multiplies physiological injury damage without changing easy damage', () => {
  const results = {};
  for (const id of ['easy', 'normal', 'hardcore']) {
    const st = state(id);
    st.body.health = 80;
    st.body.fracture = 1;
    stepBody(st, env(20), act('rest'), 10, role);
    results[id] = 80 - st.body.health;
    assert.equal(st.body.lastHarm, 'injury');
  }
  assert.ok(Math.abs(results.easy - results.normal) < 1e-9);
  assert.ok(Math.abs(results.hardcore - results.normal * difficultyProfile('hardcore').damage) < 1e-9);
});

test('stepBody automatically treats a legacy save as normal, without clearing injuries', () => {
  const old = state('normal'), expected = state('normal');
  delete old.difficulty;
  for (const st of [old, expected]) Object.assign(st.body, { health: 55, fracture: 0.5, frostbite: 35 });
  stepBody(old, env(), act(), 12, role);
  stepBody(expected, env(), act(), 12, role);
  assert.equal(old.difficulty, 'normal');
  assert.deepEqual(old.body, expected.body);
  assert.equal(old.body.fracture, 0.5);
});
