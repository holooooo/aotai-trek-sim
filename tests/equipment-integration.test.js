import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Game } from '../src/sim/game.js';
import { makeCharacter } from '../src/world/models.js';
import { createState, wornItems } from '../src/sim/state.js';
import { roleById } from '../src/data/roles.js';
import { computeEnv, stepBody } from '../src/sim/body.js';
import { ensureClothes, garmentWetness, isClothWorn, changeClothing } from '../src/sim/clothes.js';

const weather = () => ({ wind: 20, gust: 1, temp: -6, overcast: 0.2, fog: 0, precip: 0, dirDeg: 0, vis: 100, severity: 0 });

function fixture(role = 'nurse') {
  const st = createState(role, 'easy');
  st.pos = { x: 4, z: 4 };
  st.time = 600;
  st.body.core = 36.8;
  st.warmers = 2;
  st.inv.insul_down = 1;
  ensureClothes(st);
  const game = Object.create(Game.prototype);
  game.st = st;
  game.role = roleById(role);
  game.over = false;
  game.busy = false;
  game.eventRunning = false;
  game.autoWalk = true;
  game.pos = { x: st.pos.x, y: 0, z: st.pos.z };
  game.skipCalls = [];
  game.wx = weather;
  game.sunEl = () => -0.2;
  game.hour = () => 10;
  game.day = () => 0;
  game.exposure = () => 1;
  game.here = () => ({ type: 'ridge', ice: false });
  game.signal = () => 0;
  game.night = () => true;
  game.inTent = () => !!(st.camp?.inside && !st.camp?.bivy);
  game.ctx = () => ({ alt: 3000, hour: 10, day: 0, wx: weather(), exposure: 1, inTent: game.inTent(), camp: st.camp?.inside ? st.camp : null, type: 'ridge', ice: false });
  game.ui = {
    setBusy() {}, hideCampMenu() {}, closeSheet() {}, showCampMenu() {},
  };
  game.toast = () => {};
  game.save = () => {};
  game.refreshHud = () => {};
  game.dialog = async () => 'back';
  game.skip = async (minutes, mode) => {
    game.skipCalls.push({ minutes, mode });
    const context = game.ctx();
    const env = computeEnv(st, context);
    stepBody(st, env, {
      mode, effort: 0, downhill: false, terrainStamina: 1, load: 1, snowDeep: 0,
      alt: context.alt, sunny: false, night: true, severity: 0, lost: false,
      alone: true, companions: 0, signal: false,
    }, minutes, game.role);
    st.time += minutes;
    return null;
  };
  return game;
}

function intactTent(st) {
  st.camp = { inside: true, bivy: false, collapsed: false, health: 100, tent: 'tent_alpine' };
  st.inv.tent_alpine = 1;
}

function dampDetachedMidLayer(st) {
  st.body.wet = 80;
  ensureClothes(st);
  assert.equal(isClothWorn(st, 'mid_fleece'), true);
  changeClothing(st, 'mid_fleece', { Teff: 10 });
  assert.equal(isClothWorn(st, 'mid_fleece'), false);
  assert.equal(garmentWetness(st, 'mid_fleece'), 80);
}

test('Game.equipClothing uses the real exchange duration and cold core cost', async () => {
  const game = fixture();
  const beforeTime = game.st.time;
  const beforeCore = game.st.body.core;
  await game.equipClothing('mid_fleece');
  assert.deepEqual(game.skipCalls, [{ minutes: 2, mode: 'idle' }]);
  assert.equal(game.st.time, beforeTime + 2);
  assert.ok(game.st.body.core < beforeCore, 'cold exchange must cost core temperature');
  assert.equal(isClothWorn(game.st, 'mid_fleece'), false);
  await game.equipClothing('mid_fleece');
  assert.equal(game.st.time, beforeTime + 4);
  assert.equal(isClothWorn(game.st, 'mid_fleece'), true);
});

test('Game.dryClothes requires an intact entered tent and detached wet garments', async () => {
  const noTent = fixture();
  dampDetachedMidLayer(noTent.st);
  await noTent.dryClothes();
  assert.equal(noTent.st.warmers, 2);
  assert.equal(noTent.skipCalls.length, 0);

  const worn = fixture();
  intactTent(worn.st);
  worn.st.body.wet = 80;
  ensureClothes(worn.st);
  await worn.dryClothes();
  assert.equal(worn.st.warmers, 2);
  assert.equal(worn.skipCalls.length, 0);
});

test('Game.dryClothes consumes one warmer and dries over time without instant completion', async () => {
  const game = fixture();
  intactTent(game.st);
  dampDetachedMidLayer(game.st);
  const before = garmentWetness(game.st, 'mid_fleece');
  game.dialog = async () => 'assisted';
  await game.dryClothes();
  const after = garmentWetness(game.st, 'mid_fleece');
  assert.equal(game.st.warmers, 1);
  assert.deepEqual(game.skipCalls, [{ minutes: 30, mode: 'rest' }]);
  assert.ok(after < before, 'drying should make progress');
  assert.ok(after > 0, 'thirty minutes must not instantly dry a wet garment');
  assert.ok(game.st.time >= 630, 'drying consumes the advertised thirty minutes');
});

test('Game lamp mode reaches the actual render calls', () => {
  const game = fixture();
  game.st.inv.headlamp = 1;
  game.st.bat.headlamp = 100;
  game.st.lampMode = 'auto';
  const atmospheres = [], renderedLamp = [];
  game.pos = new THREE.Vector3(4, 80, 4);
  game.player = makeCharacter(game.role.look);
  game.cam = { yaw: 0, pitch: 0.42, dist: 9.5, idle: 0 };
  game.camTarget = new THREE.Vector3();
  game._displayTarget = new THREE.Vector3();
  game.eventCamera = { active: false, sample: () => null };
  game.input = { cameraDelta: () => ({ active: false, dx: 0, dy: 0, zoom: 1 }) };
  game.gust = { push: 0 };
  game.moving = false; game.crouch = false; game.restTimer = 0; game.falling = false;
  game.speedFactor = () => 1;
  game.visibility = () => 100;
  game.clearEventActor = () => {};
  game.ui.setEffects = () => {};
  game.world = {
    mobile: true,
    height: () => 80,
    camera: { position: new THREE.Vector3(), lookAt() {} },
    ensureChunks() {},
    updateAtmosphere: (state) => atmospheres.push(state),
    setHeadlamp: (on) => renderedLamp.push(on),
    setGrade() {},
  };

  game.setLampMode('off');
  game.updateVisuals(0.016);
  assert.equal(atmospheres.at(-1).lamp.on, false);
  assert.equal(renderedLamp.at(-1), false);
  game.setLampMode('on');
  game.updateVisuals(0.016);
  assert.equal(atmospheres.at(-1).lamp.on, true);
  assert.equal(renderedLamp.at(-1), true);
  game.setLampMode('auto');
  game.updateVisuals(0.016);
  assert.equal(atmospheres.at(-1).lamp.on, true, 'auto illuminates outdoors at night');
  assert.equal(renderedLamp.at(-1), true);
  game.st.camp = { inside: true, bivy: false, collapsed: false, health: 100, tent: 'tent_alpine', x: 4, z: 4 };
  game.updateLampState();
  game.updateVisuals(0.016);
  assert.equal(atmospheres.at(-1).lamp.on, false, 'auto turns off inside a sound tent');
  assert.equal(renderedLamp.at(-1), false);
});

test('cold-wake insulation must use the equipped garment path and its exchange cost', async () => {
  const game = fixture();
  assert.equal(game.st.wearInsul, false);
  assert.ok(wornItems(game.st).insul);
  const beforeTime = game.st.time;
  const beforeCore = game.st.body.core;
  game.dialog = async () => 'insul';
  await game.coldWake();
  assert.equal(game.st.wearInsul, true);
  assert.ok(game.skipCalls.length > 0, 'cold-wake dressing must consume exchange time');
  assert.ok(game.st.time > beforeTime, 'cold-wake dressing must advance game time');
  assert.ok(game.st.body.core < beforeCore, 'cold-wake dressing must apply cold exchange cost');
  assert.equal(wornItems(game.st).insul, game.st.clothes.equipped.insul);
});

test('cold-wake cannot turn on insulation when the manual insulation slot is empty', async () => {
  const game = fixture();
  game.st.clothes.equipped.insul = null;
  game.st.clothes.manualSlots = ['insul'];
  game.st.wearInsul = false;
  game.dialog = async () => 'insul';
  await game.coldWake();
  assert.equal(game.st.wearInsul, false);
  assert.equal(game.st.clothes.equipped.insul, null);
});
