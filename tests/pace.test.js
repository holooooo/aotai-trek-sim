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
test('death in the current simulation step is not overwritten by an arriving rescue', () => {
  const g = fixture();
  g.st.body.health = 0.001; g.st.body.core = 30;
  const terminal = [];
  g.die = () => { g.over = true; terminal.push('dead'); };
  g.simRescue = () => { g.over = true; terminal.push('rescued'); };
  g.simulate(10, 'idle', { skip: true });
  assert.deepEqual(terminal, ['dead']);
});
