import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/sim/game.js';
import { createState } from '../src/sim/state.js';
import { roleById } from '../src/data/roles.js';

function fixture({ flat = true, wind = 20, air = -2 } = {}) {
  const st = createState('nurse', 'easy');
  st.time = 600;
  st.pos = { x: 10, z: 10 };
  st.inv.stove = 1;
  st.inv.pot = 1;
  st.gas = { normal: 2, alpine: 0 };
  st.thermos = { l: 0, temp: 20 };
  st.body.water = 50;
  st.camp = { inside: true, bivy: false, collapsed: false, health: 100, tent: 'tent_alpine', x: 10, z: 10, rot: 0, exposure: 1, orient: 1 };

  const game = Object.create(Game.prototype);
  game.st = st;
  game.role = roleById(st.role);
  game.pos = { x: 10, y: 80, z: 10 };
  game.over = false;
  game.busy = false;
  game.eventRunning = false;
  game.eventCamera = { active: false };
  game.skipCalls = [];
  game.wx = () => ({ wind, gust: 1, temp: air, overcast: 0, fog: 0, precip: 0, dirDeg: 0, vis: 100, severity: 0 });
  game.airT = () => air;
  game.exposure = () => 1;
  game.updateLampState = () => ({ on: false });
  game.roll = () => false;
  game.world = { height: () => flat ? 80 : 82.5 };
  game.ui = {
    setBusy: () => {}, hideCampMenu: () => {}, showCampMenu: () => {},
  };
  game.toast = () => {};
  game.save = () => {};
  game.skip = async (minutes, mode) => {
    game.skipCalls.push({ minutes, mode, inTent: game.inTent(), x: game.pos.x, z: game.pos.z });
    st.time += minutes;
    return null;
  };
  return game;
}

function assertRestored(game, origin = { x: 10, y: 80, z: 10 }) {
  assert.equal(game.st.camp.inside, true);
  assert.deepEqual(game.st.pos, { x: origin.x, z: origin.z });
  assert.deepEqual(game.pos, origin);
}

test('cooking from a sound tent cooks outside on level ground, then restores the tent position', async () => {
  const game = fixture({ wind: 20, air: -2 });
  const beforeWater = game.st.body.water;
  await game.cook(true);
  assert.deepEqual(game.skipCalls, [{ minutes: 25, mode: 'idle', inTent: false, x: 13, z: 10 }]);
  assertRestored(game);
  assert.equal(game.st.gas.normal, 0, 'windy outside cooking consumes two normal gas units');
  assert.equal(game.st.body.water, beforeWater + 6);
});

test('cooking duration and normal gas use follow outside wind and cold conditions', async () => {
  const calm = fixture({ wind: 2, air: 5 });
  await calm.cook(true);
  assert.deepEqual(calm.skipCalls.map(({ minutes, mode, inTent }) => ({ minutes, mode, inTent })), [{ minutes: 15, mode: 'idle', inTent: false }]);
  assert.equal(calm.st.gas.normal, 1);

  const cold = fixture({ wind: 2, air: -20 });
  await cold.cook(true);
  assert.deepEqual(cold.skipCalls.map(({ minutes, mode, inTent }) => ({ minutes, mode, inTent })), [{ minutes: 15, mode: 'idle', inTent: false }]);
  assert.equal(cold.st.gas.normal, 0, 'cold normal-gas cooking consumes two units even when the flame succeeds');
});

test('cooking refuses a nearby uneven spot without spending gas or changing water', async () => {
  const game = fixture({ flat: false });
  const before = { gas: structuredClone(game.st.gas), water: game.st.body.water, pos: structuredClone(game.st.pos) };
  await game.cook(true);
  assert.deepEqual(game.skipCalls, []);
  assert.deepEqual(game.st.gas, before.gas);
  assert.equal(game.st.body.water, before.water);
  assert.deepEqual(game.st.pos, before.pos);
  assert.equal(game.st.camp.inside, true);
});

test('collapsed or unhealthy tents are never treated as inside during cooking', async () => {
  for (const change of [
    (st) => { st.camp.collapsed = true; },
    (st) => { st.camp.health = 0; },
  ]) {
    const game = fixture({ wind: 2, air: 5 });
    change(game.st);
    assert.equal(game.inTent(), false);
    await game.cook(true);
    assert.equal(game.skipCalls[0].inTent, false);
    assert.equal(game.skipCalls[0].mode, 'idle');
    assert.equal(game.st.camp.inside, false, 'an unusable tent must not regain inside status');
  }
});

test('death or tent collapse during the outside boil never re-enters the tent or adds water', async () => {
  for (const interrupt of ['death', 'collapse']) {
    const game = fixture({ wind: 2, air: 5 });
    const beforeWater = game.st.body.water;
    game.skip = async (minutes, mode) => {
      game.skipCalls.push({ minutes, mode, inTent: game.inTent() });
      if (interrupt === 'death') game.over = true;
      else game.st.camp.collapsed = true;
      game.st.time += minutes;
      return null;
    };
    await game.cook(true);
    assert.equal(game.st.camp.inside, false, interrupt);
    assert.equal(game.st.body.water, beforeWater, interrupt);
    assert.equal(game.pos.x, 13, interrupt);
    assert.equal(game.pos.z, 10, interrupt);
  }
});
