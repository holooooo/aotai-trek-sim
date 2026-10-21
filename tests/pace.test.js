import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/sim/game.js';
import { createState } from '../src/sim/state.js';
import { roleById } from '../src/data/roles.js';
import { paceProfile } from '../src/sim/pace.js';

function fixture(role = 'student') {
  const g = Object.create(Game.prototype);
  g.st = createState(role, 'normal'); g.role = roleById(role); g.crouch = false; g.grade = 0; g.over = false;
  g.here = () => ({ type: 'forest', ice: false });
  g.night = () => false;
  g.sunEl = () => 0.5; g.signal = () => 0;
  g.ctx = () => ({ alt: 2400, hour: 12, day: 0, type: 'forest', exposure: 0.2, inTent: false, wx: { temp: 0, wind: 3, gust: 1, precip: 0, overcast: 0.3, severity: 0, fog: 0 } });
  g.simCompanions = () => {}; g.simRescue = () => {}; g.thresholdNotes = () => {}; g.toast = () => {};
  g.st.companions = [];
  return g;
}

test('fast pace accelerates actual Game speed and runners gain an additional multiplier', () => {
  for (const role of ['student', 'runner']) {
    const g = fixture(role);
    const normal = g.speedFactor();
    g.st.pace = 'fast';
    assert.ok(Math.abs(g.speedFactor() / normal - (role === 'runner' ? 1.9 : 1.55)) < 1e-9);
    g.crouch = true;
    assert.equal(g.travelPace().speed, 1, 'bracing suspends fast pace');
  }
  assert.ok(paceProfile({ role: 'runner', pace: 'fast' }).speed > paceProfile({ role: 'student', pace: 'fast' }).speed);
});

test('fast pace costs more stamina, food and water over time and per distance', () => {
  for (const role of ['student', 'runner']) {
    const walk = fixture(role), fast = fixture(role);
    fast.st = structuredClone(walk.st); fast.st.pace = 'fast';
    const before = { ...walk.st.body };
    walk.simulate(20, 'walk', { skip: true }); fast.simulate(20, 'walk', { skip: true });
    for (const field of ['stamina', 'food', 'water']) {
      const normalCost = before[field] - walk.st.body[field];
      const fastCost = before[field] - fast.st.body[field];
      assert.ok(fastCost > normalCost, `${role} ${field}: ${fastCost} > ${normalCost}`);
      assert.ok(fastCost / fast.travelPace().speed > normalCost, `${role} ${field} costs more per distance too`);
    }
  }
});

test('fast pace raises real stone and ice hazard probabilities without forcing an injury', () => {
  const g = fixture(); g.visibility = () => 100;
  const seen = [];
  g.roll = (p) => { seen.push(p); return false; };
  const context = { type: 'stone', ice: true, wx: { fog: 0 } };
  const env = { cl: { worn: {}, grip: 0.6 } };
  g.rollHazards(1, context, env);
  const ordinary = seen.splice(0);
  g.st.pace = 'fast'; g.rollHazards(1, context, env);
  assert.equal(seen.length, ordinary.length);
  seen.forEach((p, i) => assert.ok(Math.abs(p / ordinary[i] - 2.4) < 1e-9));
  assert.equal(g.st.body.health, 100);
});

test('camping and unknown legacy pace values do not accelerate movement or resting metabolism', () => {
  assert.equal(paceProfile({ pace: 'fast', role: 'runner', camp: { inside: true } }).effort, 1);
  assert.equal(paceProfile({ role: 'runner' }).speed, 1);
  assert.equal(paceProfile({ pace: 'bad', role: 'runner' }).speed, 1);
  const normal = fixture(), fast = fixture();
  fast.st = structuredClone(normal.st); fast.st.pace = 'fast';
  normal.simulate(20, 'rest', { skip: true }); fast.simulate(20, 'rest', { skip: true });
  assert.deepEqual(fast.st.body, normal.st.body);
});


test('exhausted characters keep manual crawl speed and fast pace cannot accelerate crawling', () => {
  const walking = fixture('student');
  const crawling = fixture('student');
  crawling.st.body.collapsed = true;
  crawling.st.body.stamina = 0;
  const normal = walking.speedFactor();
  const crawl = crawling.speedFactor();
  assert.ok(crawl > 0, 'exhaustion keeps movement available');
  assert.ok(crawl < normal * 0.45, `${crawl} should be materially slower than ${normal}`);
  crawling.st.pace = 'fast';
  assert.equal(crawling.speedFactor(), crawl, 'fast pace is neutral while crawling');
  assert.equal(crawling.travelPace().speed, 1);
});

test('zero stamina alone does not kill ordinary roles, while hidden role ignores lethal checks', () => {
  const ordinary = fixture('student');
  ordinary.st.body.stamina = 0;
  ordinary.die = () => { ordinary.over = true; };
  ordinary.checkDeath();
  assert.equal(ordinary.over, false);
  ordinary.st.body.health = 0;
  ordinary.checkDeath();
  assert.equal(ordinary.over, true);

  const hidden = fixture('qu');
  hidden.st.body.health = 0;
  hidden.st.body.core = 20;
  hidden.die = () => { hidden.over = true; };
  hidden.checkDeath();
  assert.equal(hidden.over, false);
});
test('hidden role ignores every movement penalty while preserving fast pace and hungry crawling', () => {
  const changes = [
    g => { g.st.body.stamina = 0; },
    g => { Object.assign(g.st.body, { sprain: 1, fracture: 1, frostbite: 100, core: 20, health: 0, food: 0, water: 0, stress: 100, altSick: 100, snowblind: 100 }); },
    g => { g.here = () => ({ type: 'stone', ice: true }); g.st.inv = {}; },
    g => { g.night = () => true; g.st.lampOn = false; g.st.bat.headlamp = 0; },
    g => { g.st.inv = { camera: 100 }; },
    g => { g.st.companions = ['mou']; },
    g => { g.st.flags.snowDepth = 1.2; },
    g => { g.st.story.effects.runnerPaceUntil = g.st.time + 300; },
    g => { g.grade = 1.5; },
  ];
  for (const change of changes) {
    const g = fixture('qu'), baseline = g.speedFactor();
    change(g);
    assert.equal(g.speedFactor(), baseline);
  }
  const g = fixture('qu'), baseline = g.speedFactor();
  for (const change of changes) change(g);
  assert.equal(g.speedFactor(), baseline, 'stacked penalties cannot compound');
  g.st.pace = 'fast';
  assert.equal(g.speedFactor(), baseline * g.travelPace().speed);
  assert.ok(g.speedFactor() > baseline);
  g.st.body.collapsed = true; g.st.body.food = 10;
  const crawling = g.speedFactor();
  assert.equal(crawling, baseline * g.role.crawlSpeed);
  g.st.body.food = 0;
  assert.equal(g.speedFactor(), baseline * g.role.hungryCrawlSpeed);
  assert.ok(g.speedFactor() > crawling);
  g.st = JSON.parse(JSON.stringify(g.st));
  assert.equal(g.speedFactor(), baseline * g.role.hungryCrawlSpeed, 'saved debuffs do not slow a resumed run');
});

test('actual movement retains hidden-role auto-walk through exhaustion and ignores opposing gusts', () => {
  for (const role of ['qu', 'student']) {
    const g = fixture(role);
    g.pos = { x: 0, y: 0, z: 0 }; g.st.pos = { x: 0, z: 0 };
    g.input = { move: () => ({ mag: 0 }), crouchHeld: () => false };
    g.cam = { yaw: 0 }; g.player = { rotation: { y: 0 } };
    g.world = { height: () => 0 }; g.updateProgress = () => {};
    g.autoTarget = () => ({ x: 0, z: -20 });
    g.autoWalk = true; g.falling = false;
    g.gust = { push: 1, warn: 1, timer: 0 }; g.push = { x: 0, y: 0 };
    g.st.body.stamina = 0;
    if (role === 'qu') {
      g.push.y = 100;
      Object.assign(g.st.body, { food: 0, core: 20, health: 0, fracture: 1, frostbite: 100 });
      g.grade = 1.5; g.night = () => true;
    }
    g.updateMovement(0.1);
    assert.equal(g.st.body.collapsed, true);
    assert.equal(g.autoWalk, role === 'qu', 'ordinary exhaustion still stops auto-walk');
    if (role === 'qu') {
      const expected = 6.4 * g.role.mods.speed * g.role.hungryCrawlSpeed * 0.1;
      assert.ok(Math.abs(g.pos.z + expected) < 1e-9);
      assert.equal(g.moving, true);
      g.updateGust(0.1);
      assert.equal(g.gust.push, 0); assert.equal(g.gust.warn, 0);
    } else assert.equal(g.pos.z, 0);
  }
});

test('death in the current simulation step is not overwritten by an arriving rescue', () => {
  const g = fixture();
  g.st.body.health = 0.001; g.st.body.core = 30;
  const terminal = [];
  g.die = () => { g.over = true; terminal.push('dead'); };
  g.simRescue = () => { g.over = true; terminal.push('rescued'); };
  g.simulate(10, 'idle', { skip: true });
  assert.deepEqual(terminal, ['dead']);
});
