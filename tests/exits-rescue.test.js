import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/sim/game.js';
import { createState } from '../src/sim/state.js';
import { roleById } from '../src/data/roles.js';
import { travelEnding, canFreeDescent } from '../src/sim/exits.js';
import { mainPath, branches } from '../src/world/terrain.js';
import { altToVox } from '../src/data/route.js';

function village(along, side = 0) {
  const p = mainPath.pointAt(0);
  return { x: p.x + p.dx * along - p.dz * side, z: p.z + p.dz * along + p.dx * side, y: altToVox(1740) };
}
function game() {
  const g = Object.create(Game.prototype);
  g.st = createState('nurse'); g.role = roleById('nurse'); g.pos = village(4); g.offTrail = 0;
  g.visibility = () => 260; g.toast = () => {}; g.log = () => {}; g.save = () => {};
  g.finish = (type) => { g.result = type; }; g.over = false;
  return g;
}

test('Sigma needs actual walking past the village stall, not clamped route progress', () => {
  const st = createState('student');
  assert.equal(travelEnding(st, village(4)), null);
  assert.equal(travelEnding(st, village(-25)), null, 'teleporting outside without passing the stall is not enough');
  st.stats.walked = 12;
  assert.equal(travelEnding(st, village(-6, 4.5)), null);
  assert.equal(st.flags.passedHomeStall, true);
  assert.equal(travelEnding(st, village(-25)), 'sigma');
  assert.equal(travelEnding(st, village(-25), { falling: true }), null);
});

test('free descent unlocks after 2800 and only succeeds below 1600 while grounded', () => {
  const st = createState('student');
  assert.equal(canFreeDescent(st), false);
  st.maxS = branches.hetaoping.fromS + 20; st.flags.freeDescent = true;
  assert.equal(canFreeDescent(st), true);
  const pos = { x: 2000, z: 300, y: altToVox(1600) };
  assert.equal(travelEnding(st, pos), null, 'strictly below threshold');
  pos.y = altToVox(1575);
  assert.equal(travelEnding(st, pos), 'retreat_wild');
  assert.equal(travelEnding(st, pos, { falling: true }), null);
  assert.equal(travelEnding(st, { ...pos, y: pos.y + 4 }, { groundY: pos.y }), null);
  st.camp = { inside: true }; assert.equal(travelEnding(st, pos), null);
});

test('choosing free descent does not teleport or force a return along the route', () => {
  const g = game(); g.st.maxS = branches.hetaoping.fromS + 50;
  g.autoWalk = true; const pos = { ...g.pos };
  g.retreat('free');
  assert.deepEqual(g.pos, pos); assert.equal(g.st.flags.freeDescent, true); assert.equal(g.autoWalk, false);
  g.cam = { yaw: 0 }; g.retreat('back'); assert.equal(g.st.flags.freeDescent, false); assert.equal(g.st.dir, -1);
});

test('rescue delay grows with poor visibility and off-trail distance, yet remains finite', () => {
  const g = game();
  assert.equal(g.rescueSearchRate(), 0);
  g.visibility = () => 15; const fog = g.rescueSearchRate();
  g.offTrail = 130; assert.ok(g.rescueSearchRate() > fog); assert.ok(g.rescueSearchRate() < 1);
  g.st.rescue = { self: true, at: 0, eta: 600, x: g.pos.x, z: g.pos.z, npcs: [], moved: false };
  g.st.time = 60; g.simRescue(60);
  assert.ok(g.st.rescue.eta > 600);
  assert.ok(g.st.rescue.searchDelay > 0);
  g.visibility = () => 260; g.offTrail = 0;
  const eta = g.st.rescue.eta; g.st.time = eta; g.simRescue(0);
  assert.equal(g.result, 'rescued');
});

test('an NPC-only rescue cannot complete the player run', () => {
  const g = game();
  g.st.rescue = { self: false, at: 0, eta: 10, x: g.pos.x, z: g.pos.z, npcs: [], moved: false };
  g.st.time = 20; g.simRescue(0);
  assert.equal(g.result, undefined); assert.equal(g.st.rescue, null);
});

test('easy health is preserved by injury, event changes and first aid', () => {
  const g = game();
  g.ui = { flash() {} }; g.roll = () => false;
  g.hurt(5, 'injury'); assert.equal(g.st.body.health, 195);
  g.changeBody('health', 2); assert.equal(g.st.body.health, 197);
  g.st.inv.firstaid = 1; g.st.body.sprain = 1; g.useFirstAid(); assert.equal(g.st.body.health, 200);
  g.st.difficulty = 'hardcore'; g.st.body.health = 100;
  g.hurt(10, 'injury'); assert.equal(g.st.body.health, 86.5);
});
