import test from 'node:test';
import assert from 'node:assert/strict';
import { BRANCHES, KM_PER_UNIT, altToVox, voxToAlt } from '../src/data/route.js';
import { mainPath, branches, columnInfo, heightAt } from '../src/world/terrain.js';
import { Game } from '../src/sim/game.js';
import { createState } from '../src/sim/state.js';
import { roleById } from '../src/data/roles.js';
import { travelEnding, canFreeDescent } from '../src/sim/exits.js';

const IDS = ['hetaoping', 'qingfengxia', 'dudumen', 'diaoyutai'];
const close = (actual, expected, tolerance = 1e-3, label = '') => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected}`);
const at = (path, s) => { const p = path.pointAt(s); return { x: p.x, z: p.z, y: heightAt(p.x, p.z) }; };
function game(branch) {
  const g = Object.create(Game.prototype);
  g.st = createState('nurse'); g.role = roleById('nurse'); g.st.path = 'main';
  g.st.s = branch.fromS; g.st.maxS = branch.fromS; g.st.dir = 1; g.st.flags = {};
  g.pos = at(mainPath, branch.fromS); g.offTrail = 0; g.cam = { yaw: 0.7 };
  g.autoWalk = false; g.toast = () => {}; g.log = () => {}; g.saves = 0;
  g.save = () => { g.saves++; };
  return g;
}

test('all four branches have explicit fictional boundaries, source links, basis and warnings', () => {
  assert.deepEqual(Object.keys(BRANCHES), IDS); assert.deepEqual(Object.keys(branches), IDS);
  for (const [id, def] of Object.entries(BRANCHES)) {
    assert.equal(def.id, id); assert.equal(def.fictional, true, id);
    for (const key of ['basis', 'warning', 'desc', 'endName']) assert.ok(typeof def[key] === 'string' && def[key].trim().length > 0, `${id}:${key}`);
    assert.ok(def.sourceLinks.length > 0, id);
    for (const source of def.sourceLinks) { assert.ok(source.label); assert.match(source.url, /^https:\/\//); }
    assert.ok(mainPath.waypoints.some(wp => wp.id === def.fromWaypoint));
    assert.ok(def.lengthKm > 0); assert.ok(def.endAlt < 1600);
  }
});

test('branch origins join their main-route waypoint in position and elevation and each endpoint has its declared altitude', () => {
  const gaps = [];
  for (const b of Object.values(branches)) {
    const start = b.pointAt(0), junction = mainPath.pointAt(b.fromS);
    close(Math.hypot(start.x - junction.x, start.z - junction.z), 0, 1e-3, `${b.id}:start position`);
    assert.equal(mainPath.waypoints.find(w => w.id === b.def.fromWaypoint).s, b.fromS);
    const gap = voxToAlt(b.elevAt(0)) - voxToAlt(mainPath.elevAt(b.fromS));
    if (Math.abs(gap) > 1) gaps.push({ id: b.id, deltaMeters: Math.round(gap * 100) / 100 });
    close(voxToAlt(b.elevAt(b.length)), b.def.endAlt, 0.01, `${b.id}:endpoint altitude`);
    assert.ok(Math.abs(b.length * KM_PER_UNIT - b.def.lengthKm) < 0.1, `${b.id}:game distance`);
  }
  assert.deepEqual(gaps, [], 'the same physical junction cannot have two materially different route elevations');
});

test('mathematical branch queries and real terrain columns stay finite along every branch and endpoint', () => {
  for (const b of Object.values(branches)) {
    for (let i = 0; i <= 80; i++) {
      const s = b.length * i / 80, p = b.pointAt(s), near = b.nearest(p.x, p.z), ground = columnInfo(Math.floor(p.x), Math.floor(p.z));
      for (const value of [p.x, p.z, p.dx, p.dz, b.elevAt(s), near.s, near.d, ground.h, ground.d, ground.s]) assert.ok(Number.isFinite(value), `${b.id}:${i}`);
      close(near.d, 0, 1e-3, `${b.id}:on path`); close(near.s, s, 1e-3, `${b.id}:progress`);
    }
    const end = at(b, b.length);
    close(voxToAlt(end.y), b.def.endAlt, 25.01, `${b.id}:actual endpoint ground`);
  }
});

test('nearby branch choices use the real Game query without teleporting and remote or off-trail IDs are refused', () => {
  for (const b of Object.values(branches)) {
    const g = game(b), pos = { ...g.pos }, time = g.st.time;
    assert.ok(g.nearbyBranches().some(candidate => candidate.id === b.id)); assert.equal(g.canBranch(), true);
    g.retreat(b.id);
    assert.equal(g.st.path, b.id); assert.equal(g.st.dir, 1); assert.deepEqual(g.pos, pos); assert.equal(g.st.time, time);
    close(g.st.s, b.nearest(pos.x, pos.z).s); assert.equal(g.saves, 1);
    const remote = game(b); remote.st.s = 4; remote.pos = at(mainPath, 4);
    const before = JSON.stringify({ state: remote.st, pos: remote.pos, yaw: remote.cam.yaw });
    remote.retreat(b.id); remote.retreat('unregistered-branch');
    assert.equal(JSON.stringify({ state: remote.st, pos: remote.pos, yaw: remote.cam.yaw }), before, `${b.id}:remote refusal`);
    assert.equal(remote.saves, 0);
    const off = game(b); off.offTrail = 30;
    off.retreat(b.id); assert.equal(off.st.path, 'main'); assert.equal(off.saves, 0);
  }
});

test('real movement queries enter every branch and walking back rejoins main with dir=-1', () => {
  for (const b of Object.values(branches)) {
    const g = game(b);
    g.pos = at(b, 24); const entering = { ...g.pos };
    g.updateProgress();
    assert.equal(g.st.path, b.id, `${b.id}:automatic entry`); assert.equal(g.st.dir, 1);
    close(g.st.s, 24, 1e-3); assert.deepEqual(g.pos, entering, 'progress updates cannot move the player');
    const progress = g.st.s;
    g.retreat('junction'); assert.equal(g.st.path, b.id); assert.equal(g.st.s, progress); assert.equal(g.st.dir, -1);
    assert.deepEqual(g.pos, entering, 'requesting a return cannot jump to the junction');
    g.pos = at(mainPath, b.fromS - 3); const returning = { ...g.pos };
    g.updateProgress();
    assert.equal(g.st.path, 'main', `${b.id}:automatic return`); assert.equal(g.st.dir, -1);
    close(g.st.s, b.fromS - 3, 1e-3); assert.deepEqual(g.pos, returning);
  }
});

test('branch endings require their own actual contact point while grounded, outside camp and on-route', () => {
  for (const b of Object.values(branches)) {
    const st = createState('nurse'), end = at(b, b.length);
    st.path = b.id; st.s = b.length; st.flags.freeDescent = false;
    assert.equal(travelEnding(st, end, { groundY: end.y }), 'retreat_branch', b.id);
    assert.equal(travelEnding(st, end, { falling: true, groundY: end.y }), null);
    assert.equal(travelEnding(st, { ...end, y: end.y + 4 }, { groundY: end.y }), null);
    st.camp = { inside: true }; assert.equal(travelEnding(st, end), null); st.camp = null;
    const p = b.pointAt(b.length), off = { x: p.x - p.dz * 40, z: p.z + p.dx * 40, y: end.y };
    assert.ok(b.nearest(off.x, off.z).d > 12); assert.equal(travelEnding(st, off), null, `${b.id}:off-route`);
    for (const other of Object.values(branches)) {
      if (other.id === b.id) continue;
      assert.equal(travelEnding(st, at(other, other.length)), null, `${b.id}:another branch endpoint is not this endpoint`);
    }
    const early = at(b, b.length - 6.5);
    assert.ok(voxToAlt(early.y) < 1600, `${b.id}:test point really is below 1600m`);
    st.s = b.nearest(early.x, early.z).s;
    assert.equal(travelEnding(st, early), null, `${b.id}:low altitude before completing this branch is not an ending`);
  }
});

test('stale end-progress cannot replace physically reaching the branch contact point', () => {
  const premature = [];
  for (const b of Object.values(branches)) {
    const st = createState('nurse'), middle = at(b, b.length * 0.5);
    st.path = b.id; st.s = b.length; st.flags.freeDescent = false;
    const result = travelEnding(st, middle, { groundY: middle.y });
    if (result !== null) premature.push({ id: b.id, result });
  }
  assert.deepEqual(premature, [], 'contact requires physical endpoint proximity as well as progress and route proximity');
});

test('wild descent retains its unlock, strict low-altitude, grounding and camp rules', () => {
  const st = createState('nurse'), pos = { x: 5000, z: -4000, y: altToVox(1575) };
  assert.equal(canFreeDescent(st), false); assert.equal(travelEnding(st, pos), null);
  st.maxS = branches.hetaoping.fromS + 20; st.flags.freeDescent = true;
  assert.equal(canFreeDescent(st), true); assert.equal(travelEnding(st, pos), 'retreat_wild');
  assert.equal(travelEnding(st, { ...pos, y: altToVox(1600) }), null);
  assert.equal(travelEnding(st, pos, { falling: true }), null);
  assert.equal(travelEnding(st, { ...pos, y: pos.y + 4 }, { groundY: pos.y }), null);
  st.camp = { inside: true }; assert.equal(travelEnding(st, pos), null); st.camp = null;
  st.path = 'diaoyutai'; st.s = 10;
  assert.equal(travelEnding(st, pos), 'retreat_wild', 'explicit wild descent remains distinct from completing a predefined branch');
});
