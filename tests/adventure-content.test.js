import test from 'node:test';
import assert from 'node:assert/strict';
import { EXTRA_NPCS } from '../src/data/npcs-extra.js';
import { RANDOM_EVENTS } from '../src/data/events-random.js';
import { Game } from '../src/sim/game.js';
import { createState } from '../src/sim/state.js';
import { roleById } from '../src/data/roles.js';

function fixture() {
  const g = Object.create(Game.prototype);
  g.st = createState('nurse'); g.role = roleById('nurse'); g.over = false;
  Object.assign(g.st, { time: 1400, s: 1800, maxS: 1800, thermos: { l: 1, temp: 75 } });
  Object.assign(g.st.body, { stamina: 60, stress: 55, food: 60, water: 60 });
  for (const id of ['bar', 'biscuit', 'chocolate', 'blanket', 'firstaid', 'headlamp', 'gps']) g.st.inv[id] = 3;
  g.pos = { x: 12, y: 80, z: 4 }; g.npcRt = {};
  g.ui = { toast() {}, flash() {} }; g.toast = () => {};
  g.signal = () => 1; g.airT = () => -15; g.daylight = () => true; g.night = () => true;
  g.wx = () => ({ wind: 15 });
  g.eventPause = async (minutes) => { g.st.time += minutes; return !g.over; };
  return g;
}
function personFixture(def) {
  const g = fixture();
  g.st.npcs[def.id] = { spawned: true, met: true, cond: 60, s: g.st.s, path: 'main', fate: null };
  const npc = { id: def.id, def, ns: g.st.npcs[def.id], chars: [], marker: null };
  g.npcRt[def.id] = npc;
  return { g, npc };
}
const economics = (g) => JSON.stringify({ time: g.st.time, body: g.st.body, inv: g.st.inv, bat: g.st.bat, thermos: g.st.thermos });
function bounded(g, label) {
  for (const value of Object.values(g.st.inv)) assert.ok(Number.isInteger(value) && value >= 0, `${label}:inventory`);
  for (const value of Object.values(g.st.bat)) assert.ok(Number.isFinite(value) && value >= 0 && value <= 100, `${label}:battery`);
  assert.ok(g.st.thermos.l >= 0 && g.st.thermos.l <= 1, `${label}:water`);
  assert.ok(g.st.body.stress >= 0 && g.st.body.stress <= 100, `${label}:stress`);
}

test('extra NPC and random-event exports have unique IDs and complete integration metadata', () => {
  assert.ok(EXTRA_NPCS.length >= 5);
  assert.ok(RANDOM_EVENTS.length >= 8);
  const ids = [...EXTRA_NPCS, ...RANDOM_EVENTS].map((def) => def.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const def of [...EXTRA_NPCS, ...RANDOM_EVENTS]) {
    assert.match(def.id, /^[a-z][a-z0-9_]+$/);
    assert.equal(def.path, 'main');
    assert.ok(Number.isFinite(def.fromKm) && def.fromKm >= 0 && def.toKm > def.fromKm && def.toKm <= 113, def.id);
    assert.ok(def.optionIds.length >= 2 && def.optionIds.length <= 8, def.id);
    assert.equal(new Set(def.optionIds).size, def.optionIds.length, def.id);
  }
  for (const def of EXTRA_NPCS) {
    assert.ok(def.name && def.look && def.fates && typeof def.meet === 'function', def.id);
    assert.ok(Number.isFinite(def.speed) && def.speed > 0, def.id);
  }
  for (const def of RANDOM_EVENTS) assert.ok(def.once && def.ambient && def.randomEncounter && def.priority < 80 && typeof def.cond === 'function' && typeof def.run === 'function', def.id);
});

test('every NPC option executes with real Game resource helpers and a distinct observable cost', async () => {
  for (const def of EXTRA_NPCS) {
    const probe = personFixture(def); let choices;
    probe.g.dialog = async (opts) => { choices = opts.choices; return null; };
    await def.meet(probe.g, probe.npc);
    assert.deepEqual(choices.map((c) => c.id).sort(), [...def.optionIds].sort(), def.id);
    const consequences = new Set();
    for (const option of choices) {
      assert.equal(option.disabled, false, `${def.id}:${option.id} fixture has all needed resources`);
      const { g, npc } = personFixture(def), before = economics(g);
      g.dialog = async () => option.id;
      await def.meet(g, npc);
      assert.notEqual(economics(g), before, `${def.id}:${option.id} has an actual cost/benefit`);
      assert.equal(g.storyValue(`npc_${def.id}_choice`), option.id);
      assert.ok(def.fates[g.st.npcs[def.id].fate], `${def.id}:${option.id} has a resolvable fate`);
      assert.deepEqual(Object.keys(g.st.npcs), [def.id], 'no dependency on encountering somebody else');
      assert.equal(g.st.rescue, null, 'conversation does not invent a rescue');
      assert.deepEqual(g.pos, { x: 12, y: 80, z: 4 }, 'conversation does not teleport');
      consequences.add(economics(g)); bounded(g, `${def.id}:${option.id}`);
    }
    assert.equal(consequences.size, choices.length, `${def.id} alternatives produce different consequences`);
  }
});

test('every random event option executes with real Game helpers and leaves a different result', async () => {
  for (const def of RANDOM_EVENTS) {
    const probe = fixture(); let choices;
    probe.dialog = async (opts) => { choices = opts.choices; return null; };
    await def.run(probe);
    assert.deepEqual(choices.map((c) => c.id).sort(), [...def.optionIds].sort(), def.id);
    const consequences = new Set();
    for (const option of choices) {
      const g = fixture(), before = economics(g);
      g.dialog = async () => option.id;
      await def.run(g);
      assert.notEqual(economics(g), before, `${def.id}:${option.id}`);
      assert.equal(g.storyValue(`random_${def.id}`), option.id);
      assert.equal(g.st.rescue, null);
      assert.deepEqual(g.pos, { x: 12, y: 80, z: 4 });
      consequences.add(economics(g)); bounded(g, `${def.id}:${option.id}`);
    }
    assert.equal(consequences.size, choices.length, def.id);
  }
});

test('cancelling an unfinished new dialogue has no gameplay side effects', async () => {
  for (const def of EXTRA_NPCS) {
    const { g, npc } = personFixture(def), before = JSON.stringify(g.st);
    g.dialog = async () => null;
    await def.meet(g, npc);
    assert.equal(JSON.stringify(g.st), before, def.id);
  }
  for (const def of RANDOM_EVENTS) {
    const g = fixture(), before = economics(g), threads = JSON.stringify(g.st.story.threads), effects = JSON.stringify(g.st.story.effects);
    g.dialog = async () => null;
    await def.run(g);
    assert.equal(economics(g), before, def.id);
    assert.equal(JSON.stringify(g.st.story.threads), threads, def.id);
    assert.equal(JSON.stringify(g.st.story.effects), effects, def.id);
  }
});

test('missing supplies disable transfers and forced disabled choices cannot create resources', async () => {
  const transfers = [
    ['linqiao', 'trade'], ['heyan', 'tape'], ['luomo', 'swap'], ['qiaoan', 'message'], ['qiaoan', 'water'], ['suyan', 'food'],
  ];
  for (const [id, option] of transfers) {
    const def = EXTRA_NPCS.find((d) => d.id === id), { g, npc } = personFixture(def);
    g.st.inv = {}; g.st.thermos.l = 0; g.st.bat.phone = 0;
    let displayed;
    g.dialog = async (opts) => { displayed = opts.choices.find((c) => c.id === option); return option; };
    const before = economics(g);
    await def.meet(g, npc);
    assert.equal(displayed.disabled, true, `${id}:${option}`);
    assert.equal(economics(g), before, `${id}:${option} transfer is guarded even after a stale UI`);
    assert.equal(g.st.npcs[id].fate, null);
  }
  for (const [id, option] of [['pack_rattle', 'pad'], ['paper_route', 'compare'], ['paper_route', 'photo'], ['tent_neighbor_song', 'share'], ['ridge_echo', 'call']]) {
    const def = RANDOM_EVENTS.find((d) => d.id === id), g = fixture();
    g.st.inv = {}; g.st.bat.phone = 0; g.st.bat.gps = 0; g.st.bat.headlamp = 0;
    const before = economics(g);
    let displayed;
    g.dialog = async (opts) => { displayed = opts.choices.find((c) => c.id === option); return option; };
    await def.run(g);
    assert.equal(displayed.disabled, true, `${id}:${option}`);
    assert.equal(economics(g), before, `${id}:${option}`);
  }
});

test('time passing into death cannot grant traded goods or recruit companions afterward', async () => {
  const cases = [['linqiao', 'trade'], ['heyan', 'together'], ['luomo', 'swap'], ['suyan', 'together']];
  for (const [id, option] of cases) {
    const def = EXTRA_NPCS.find((d) => d.id === id), { g, npc } = personFixture(def);
    const beforeBars = g.st.inv.bar, beforeBiscuits = g.st.inv.biscuit;
    g.dialog = async () => option;
    g.eventPause = async () => { g.over = true; return false; };
    await def.meet(g, npc);
    assert.ok(g.st.inv.bar <= beforeBars);
    assert.ok(g.st.inv.biscuit <= beforeBiscuits);
    assert.equal(g.st.companions.length, 0);
    assert.equal(g.st.npcs[id].fate, null);
  }
});

test('navigation comparison spends real device charge without fixing location or clearing lost state', async () => {
  const def = RANDOM_EVENTS.find((d) => d.id === 'paper_route'), g = fixture();
  g.st.flags.lost = true; const s = g.st.s, battery = g.st.bat.gps;
  g.dialog = async () => 'compare';
  await def.run(g);
  assert.equal(g.st.bat.gps, battery - 3);
  assert.equal(g.st.flags.lost, true); assert.equal(g.st.s, s);
  assert.equal(g.st.story.effects.navigationCheckedUntil, g.st.time + 100);
});

test('new event conditions retain route/km limits even when a legacy plan allows every definition', () => {
  const g = fixture();
  for (const def of RANDOM_EVENTS) {
    g.st.path = 'main'; g.st.s = (def.fromKm - 0.1) / 0.04;
    assert.equal(def.cond(g), false, `${def.id}:before`);
    g.st.s = (def.toKm + 0.1) / 0.04;
    assert.equal(def.cond(g), false, `${def.id}:after`);
    g.st.path = 'hetaoping'; g.st.s = (def.fromKm + 0.1) / 0.04;
    assert.equal(def.cond(g), false, `${def.id}:branch`);
  }
});

test('an unsent draft does not claim family contact or rescue and event conditions never draw randomness', async () => {
  const g = fixture(); g.signal = () => 0;
  g.dialog = async () => 'voice';
  await RANDOM_EVENTS.find((d) => d.id === 'phone_draft').run(g);
  assert.equal(g.storyValue('contactHome'), undefined);
  assert.equal(g.st.rescue, null);
  const original = Math.random;
  try {
    Math.random = () => { throw new Error('condition must be deterministic'); };
    for (const def of RANDOM_EVENTS) assert.doesNotThrow(() => def.cond(g), def.id);
  } finally { Math.random = original; }
});
