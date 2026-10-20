import test from 'node:test';
import assert from 'node:assert/strict';
import { STRESS_EVENTS } from '../src/data/events-stress.js';
import { ITEMS } from '../src/data/items.js';
import { Game } from '../src/sim/game.js';
import { createState } from '../src/sim/state.js';
import { roleById } from '../src/data/roles.js';
import { ensurePsychology, stepStress } from '../src/sim/stress.js';
import { chooseEvent, completeEvent, ensureEventPacing } from '../src/sim/event-director.js';
import { ensureEncounters, eventEncounterAllowed } from '../src/sim/encounters.js';

function fixture(def) {
  const g = Object.create(Game.prototype);
  g.st = createState('nurse'); g.role = roleById('nurse'); g.over = false;
  Object.assign(g.st, { time: 1300, s: 1600, maxS: 1600, thermos: { l: 1, temp: 75 }, companions: ['mou'] });
  Object.assign(g.st.body, { stress: 78, core: 37, health: 100, stamina: 55, food: 30, water: 30, sprain: 1, fracture: 0.5, frostbite: 15 });
  ensurePsychology(g.st); g.st.psychology.injuries = { fracture: 1, sprain: 1, frostbite: 1 };
  g.st.npcs = { mou: { following: true, met: true, dead: false, cond: 80, fate: 'together' } };
  g.st.inv = { bar: 2, biscuit: 2, chocolate: 2, gps: 1, headlamp: 1, tent_alpine: 1 };
  g.st.camp = def?.id === 'stress_recheck' ? null : { inside: true, tent: 'tent_alpine', health: 100, collapsed: false, bivy: false };
  g.st.flags.gateDone = true; g.st.flags.lost = true; g.st.stats.walked = 80;
  const pacing = ensureEventPacing(g.st); pacing.started = true; pacing.elapsed = 200; pacing.nextAmbientAt = 0;
  g.pos = { x: 5, y: 80, z: 8 }; g.foggy = () => true; g.signal = () => 0; g.airT = () => -4;
  g.wx = () => ({ wind: 10, severity: 0.2, precip: 0, fog: 0.8 });
  g.ui = { hideCampMenu() {}, showCampMenu() {}, setBusy() {}, toast() {}, flash() {} };
  g.toast = () => {}; g.save = () => {}; g.campMenuInfo = () => ({}); g.waits = [];
  // Keep the public Game dialogue, inventory, food, thermos and sleep methods real.
  // Replace only world-dependent time simulation and visuals with a bounded clock.
  g.skip = async (minutes, mode, opts = {}) => {
    g.waits.push({ minutes, mode });
    stepStress(g.st, { tentInfo: g.st.camp?.inside ? {} : null }, { mode, night: g.night(), severity: 0.2, companions: g.st.companions.length }, minutes, g.role);
    g.st.time += minutes; opts.onStep?.(minutes);
    return null;
  };
  return g;
}
const economics = (g) => JSON.stringify({ time: g.st.time, body: g.st.body, inv: g.st.inv, bat: g.st.bat, thermos: g.st.thermos });
const injury = (g) => ({ sprain: g.st.body.sprain, fracture: g.st.body.fracture, frostbite: g.st.body.frostbite, health: g.st.body.health });

test('at least six pressure scenes declare thresholds, choices and repeat cooldowns without random exclusion', () => {
  assert.ok(STRESS_EVENTS.length >= 6);
  assert.equal(new Set(STRESS_EVENTS.map(ev => ev.id)).size, STRESS_EVENTS.length);
  for (const def of STRESS_EVENTS) {
    assert.ok(def.stressMin >= 50 && def.stressMin <= 85, def.id);
    assert.equal(def.once, false); assert.ok(def.cooldown >= 720, def.id);
    assert.ok(def.priority < 80, 'recovery dialogue cannot displace urgent hazards');
    assert.equal(def.ambient, false);
    assert.ok(def.optionIds.length >= 2 && new Set(def.optionIds).size === def.optionIds.length, def.id);
    const g = fixture(def);
    ensureEncounters(g.st, [], [def], { fresh: true });
    assert.equal(eventEncounterAllowed(g.st, def), true, `${def.id} remains available to every run when its condition is met`);
  }
});

test('pressure thresholds and event-director cooldowns are honored by every new scene', () => {
  for (const def of STRESS_EVENTS) {
    const g = fixture(def);
    g.st.body.stress = def.stressMin - 0.1; assert.equal(def.cond(g), false, `${def.id}:below`);
    g.st.body.stress = def.stressMin; assert.equal(def.cond(g), true, `${def.id}:threshold`);
    assert.equal(chooseEvent([def], g), def);
    completeEvent(g.st, def);
    g.st.story.pacing.elapsed += 500;
    g.st.time += def.cooldown - 1; assert.equal(chooseEvent([def], g), null, `${def.id}:cooldown`);
    g.st.time += 1; assert.equal(chooseEvent([def], g), def, `${def.id}:eligible again`);
  }
});

test('every declared choice executes with public Game helpers, actual costs and distinct consequences', async () => {
  for (const def of STRESS_EVENTS) {
    const probe = fixture(def); let choices;
    probe.dialog = async (opts) => { choices = opts.choices; return null; };
    await def.run(probe);
    assert.deepEqual(choices.map(c => c.id).sort(), [...def.optionIds].sort(), def.id);
    const results = new Set();
    for (const option of choices) {
      assert.equal(option.disabled, false, `${def.id}:${option.id}`);
      const g = fixture(def), before = economics(g), beforeInjury = injury(g);
      g.dialog = async () => option.id;
      await def.run(g);
      assert.notEqual(economics(g), before, `${def.id}:${option.id} has a gameplay effect/cost`);
      assert.equal(g.storyValue(def.id), option.id);
      assert.deepEqual(injury(g), beforeInjury, 'emotional scenes cannot cure physical injuries');
      assert.equal(g.st.flags.lost, true, 'reassurance cannot invent a known location');
      assert.deepEqual(g.pos, { x: 5, y: 80, z: 8 }); assert.equal(g.st.rescue, null);
      assert.ok(g.st.body.stress >= 0 && g.st.body.stress <= 100);
      for (const n of Object.values(g.st.inv)) assert.ok(n >= 0);
      for (const n of Object.values(g.st.bat)) assert.ok(n >= 0 && n <= 100);
      results.add(economics(g));
    }
    assert.equal(results.size, choices.length, `${def.id} alternatives have different results`);
  }
});

test('missing batteries, food, water or companion disable the relevant choice and cannot grant free relief', async () => {
  for (const [id, option] of [
    ['stress_checklist', 'read'], ['stress_recheck', 'gps'], ['stress_recheck', 'notes'],
    ['stress_ration', 'eat'], ['stress_ration', 'water'], ['stress_company', 'talk'], ['stress_company', 'voice'],
  ]) {
    const def = STRESS_EVENTS.find(ev => ev.id === id), g = fixture(def);
    g.st.inv = {}; g.st.bat.phone = g.st.bat.gps = 0; g.st.thermos.l = 0; g.st.companions = [];
    const before = economics(g); let displayed;
    g.dialog = async (opts) => { displayed = opts.choices.find(c => c.id === option); return option; };
    await def.run(g);
    assert.equal(displayed.disabled, true, `${id}:${option}`);
    assert.equal(economics(g), before, `${id}:${option} remains guarded if an old UI tries to choose it`);
  }
});

test('the food and water scene really consumes inventory/thermos and replenishes through existing Game methods', async () => {
  const def = STRESS_EVENTS.find(ev => ev.id === 'stress_ration');
  const eating = fixture(def), foodBefore = eating.st.body.food, bars = eating.st.inv.bar;
  eating.dialog = async () => 'eat'; await def.run(eating);
  assert.equal(eating.st.inv.bar, bars - 1); assert.ok(eating.st.body.food > foodBefore);
  const drinking = fixture(def), waterBefore = drinking.st.body.water, liters = drinking.st.thermos.l;
  drinking.dialog = async () => 'water'; await def.run(drinking);
  assert.equal(drinking.st.thermos.l, liters - 0.25); assert.ok(drinking.st.body.water > waterBefore);
});

test('the ration scene accepts every catalogued non-alcohol food, including new foods and self-heating meals', async () => {
  const def = STRESS_EVENTS.find(ev => ev.id === 'stress_ration');
  for (const [id, item] of Object.entries(ITEMS)) {
    if (item.kind !== 'food' || item.alcohol) continue;
    const g = fixture(def); g.st.inv = { [id]: 1 }; let disabled;
    g.dialog = async (opts) => { disabled = opts.choices.find(c => c.id === 'eat').disabled; return 'eat'; };
    await def.run(g);
    assert.equal(disabled, false, id); assert.equal(g.hasItem(id), false, `${id}: actually consumed`);
    assert.equal(g.storyValue('stress_ration'), 'eat', id);
  }
  const g = fixture(def);
  g.st.inv = Object.fromEntries(Object.entries(ITEMS).filter(([, item]) => item.kind === 'food' && item.alcohol).map(([id]) => [id, 1]));
  const before = economics(g); let disabled;
  g.dialog = async (opts) => { disabled = opts.choices.find(c => c.id === 'eat').disabled; return 'eat'; };
  await def.run(g); assert.equal(disabled, true); assert.equal(economics(g), before);
});

test('the shelter event calls the real automatic sleep schedule, not a fictional fixed hour', async () => {
  const def = STRESS_EVENTS.find(ev => ev.id === 'restless_shelter'), g = fixture(def);
  const before = g.st.body.stress, start = g.st.time, expected = ((7.5 - g.hour() + 24) % 24) * 60;
  g.dialog = async () => 'sleep'; await def.run(g);
  assert.ok(Math.abs(g.st.time - start - expected) < 1e-9);
  assert.equal(g.st.stats.nights, 1);
  assert.deepEqual(g.waits, [{ minutes: expected, mode: 'sleep' }]);
  assert.ok(g.st.body.stress < before, 'warm supplied sleep uses the new per-minute pressure relief');
  const bad = fixture(def); bad.st.camp.collapsed = true; assert.equal(def.cond(bad), false);
  bad.st.camp.collapsed = false; bad.st.body.core = 34; assert.equal(def.cond(bad), false);
});

test('GPS comparison costs battery but cannot clear lost state or move the player; private voice does not claim contact', async () => {
  const gps = STRESS_EVENTS.find(ev => ev.id === 'stress_recheck'), g = fixture(gps), s = g.st.s, charge = g.st.bat.gps;
  g.dialog = async () => 'gps'; await gps.run(g);
  assert.equal(g.st.bat.gps, charge - 3); assert.equal(g.st.flags.lost, true); assert.equal(g.st.s, s);
  assert.equal(g.st.story.effects.navigationCheckedUntil, g.st.time + 90);
  const speaking = STRESS_EVENTS.find(ev => ev.id === 'stress_company'), solo = fixture(speaking);
  solo.st.companions = []; solo.dialog = async () => 'voice'; await speaking.run(solo);
  assert.equal(solo.storyValue('contactHome'), undefined); assert.equal(solo.st.rescue, null);
});

test('a death/time interruption prevents post-pause reassurance; cancelled scenes do not alter resources', async () => {
  for (const [id, option] of [['stress_checklist', 'sort'], ['pain_focus', 'pause'], ['stress_recheck', 'gps'], ['stress_company', 'quiet'], ['restless_shelter', 'sort']]) {
    const def = STRESS_EVENTS.find(ev => ev.id === id), g = fixture(def), before = g.st.body.stress;
    g.dialog = async () => option; g.eventPause = async () => { g.over = true; return false; };
    await def.run(g); assert.equal(g.st.body.stress, before, `${id}:${option}`);
  }
  for (const def of STRESS_EVENTS) {
    const g = fixture(def), before = economics(g);
    g.dialog = async () => null; await def.run(g); assert.equal(economics(g), before, def.id);
  }
});

test('conditions are deterministic and inspect state without initializing or modifying it', () => {
  const original = Math.random, fixtures = STRESS_EVENTS.map(def => ({ def, g: fixture(def) }));
  try {
    Math.random = () => { throw new Error('conditions must not sample'); };
    for (const { def, g } of fixtures) {
      const before = JSON.stringify(g.st);
      assert.equal(def.cond(g), true, def.id); assert.equal(JSON.stringify(g.st), before, def.id);
    }
  } finally { Math.random = original; }
});
