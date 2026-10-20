import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureEncounters, npcEncounterAllowed, eventEncounterAllowed } from '../src/sim/encounters.js';
import { EXTRA_NPCS } from '../src/data/npcs-extra.js';
import { RANDOM_EVENTS } from '../src/data/events-random.js';

const group = { id: 'speedteam', path: 'main', fromKm: 3.5, toKm: 7.5 };
const straggler = { id: 'straggler', path: 'main', fromKm: 20, toKm: 26 };
const npcs = [group, straggler, ...EXTRA_NPCS];
const state = (seed = 1) => ({ seed, path: 'main', s: 0, npcs: {}, flags: {}, story: { threads: {} } });
const clone = (value) => JSON.parse(JSON.stringify(value));

test('same seed builds the same JSON plan independent of definition order or global randomness', () => {
  const a = state(1979), b = state(1979);
  const original = Math.random;
  try {
    Math.random = () => { throw new Error('encounters must not consume global randomness'); };
    const first = ensureEncounters(a, npcs, RANDOM_EVENTS, { fresh: true });
    const reversed = ensureEncounters(b, [...npcs].reverse(), [...RANDOM_EVENTS].reverse(), { fresh: true });
    assert.deepEqual(first, reversed);
    assert.deepEqual(clone(first), first);
    assert.equal(first.mode, 'seeded');
    assert.equal(first.v, 1);
  } finally { Math.random = original; }
});

test('different seeds vary NPC presence and trigger positions; four-person group is optional', () => {
  const groupPresence = new Set(), groupPositions = new Set(), eventSubsets = new Set();
  for (let seed = 0; seed < 100; seed++) {
    const st = state(seed), plan = ensureEncounters(st, npcs, RANDOM_EVENTS, { fresh: true });
    groupPresence.add(plan.npcs.speedteam.selected);
    groupPositions.add(plan.npcs.speedteam.atKm);
    eventSubsets.add(Object.entries(plan.events).filter(([, v]) => v.selected).map(([id]) => id).join(','));
    assert.ok(!plan.npcs.straggler.selected || plan.npcs.speedteam.selected, `dependent encounter at seed ${seed}`);
    for (const def of npcs) {
      const at = plan.npcs[def.id].atKm;
      assert.ok(at >= def.fromKm && at <= def.toKm, `${def.id}:${at}`);
    }
  }
  assert.equal(groupPresence.size, 2);
  assert.ok(groupPositions.size > 80);
  assert.ok(eventSubsets.size > 20, 'ordinary events are a varying subset rather than all events on every run');
});

test('NPC spawning waits for its planned km and retains the original route window', () => {
  const def = { id: 'test_hiker', path: 'main', fromKm: 10, toKm: 20, encounterChance: 1 };
  const st = state(34), plan = ensureEncounters(st, [def], [], { fresh: true });
  const at = plan.npcs.test_hiker.atKm;
  st.s = (at - 0.01) / 0.04; assert.equal(npcEncounterAllowed(st, def), false);
  st.s = (at + 0.01) / 0.04; assert.equal(npcEncounterAllowed(st, def), true);
  st.path = 'hetaoping'; assert.equal(npcEncounterAllowed(st, def), false);
  st.path = 'main'; st.s = 20.01 / 0.04; assert.equal(npcEncounterAllowed(st, def), false);
});

test('event eligibility checks the per-run window but never evaluates the condition itself', () => {
  let checked = false;
  const def = { id: 'random_window', path: 'main', fromKm: 20, toKm: 40, randomEncounter: true, encounterChance: 1, cond() { checked = true; return false; } };
  const st = state(4), plan = ensureEncounters(st, [], [def], { fresh: true });
  const at = plan.events.random_window.atKm;
  st.s = (at - 0.01) / 0.04; assert.equal(eventEncounterAllowed(st, def), false);
  st.s = (at + 0.01) / 0.04; assert.equal(eventEncounterAllowed(st, def), true);
  st.s = 41 / 0.04; assert.equal(eventEncounterAllowed(st, def), false);
  assert.equal(checked, false, 'the director retains control over conditions and pacing');
});

test('loading or accidentally requesting fresh again does not redraw an existing profile', () => {
  const st = state(777), plan = ensureEncounters(st, npcs, RANDOM_EVENTS, { fresh: true });
  const saved = clone(st), before = clone(plan);
  saved.seed = 999;
  assert.deepEqual(ensureEncounters(saved, [...npcs, { id: 'future_npc' }], [], { fresh: true }), before);
  assert.equal(ensureEncounters(st, [], [], { fresh: false }), plan, 'same plan object is retained in-memory');
  assert.deepEqual(st.story.encounters, before);
});

test('legacy saves with no plan stay fully eligible without touching existing NPCs or resources', () => {
  const st = state(8);
  st.inv = { bar: 1 }; st.time = 1500;
  st.npcs.speedteam = { spawned: true, met: true, fate: 'danger', cond: 61 };
  const oldNpc = st.npcs.speedteam, before = clone(st);
  const plan = ensureEncounters(st, npcs, RANDOM_EVENTS);
  assert.equal(plan.mode, 'legacy');
  assert.equal(st.npcs.speedteam, oldNpc);
  for (const def of npcs) assert.equal(npcEncounterAllowed(st, def), true);
  for (const def of RANDOM_EVENTS) assert.equal(eventEncounterAllowed(st, def), true);
  const after = clone(st); delete after.story.encounters;
  assert.deepEqual(after, before);
  assert.equal(ensureEncounters(st, npcs, RANDOM_EVENTS, { fresh: true }), plan, 'a legacy profile is never upgraded by redrawing');
});

test('already appeared NPCs survive exclusion, changed path and out-of-window progress', () => {
  const st = state(), def = { ...group, encounterChance: 0 };
  ensureEncounters(st, [def], [], { fresh: true });
  st.path = 'hetaoping'; st.s = 99999;
  for (const status of ['spawned', 'met', 'following', 'passed', 'done', 'dead', 'removed']) {
    st.npcs.speedteam = { [status]: true, cond: 42 };
    assert.equal(npcEncounterAllowed(st, def), true, status);
  }
  st.npcs.speedteam = { fate: 'warned' };
  assert.equal(npcEncounterAllowed(st, def), true);
});

test('straggler requires selection of speedteam while already-spawned legacy state is preserved', () => {
  const st = state();
  const defs = [{ ...group, encounterChance: 0 }, { ...straggler, encounterChance: 1 }];
  const plan = ensureEncounters(st, defs, [], { fresh: true });
  assert.equal(plan.npcs.straggler.selected, false);
  st.s = 23 / 0.04;
  assert.equal(npcEncounterAllowed(st, straggler), false);
  st.npcs.straggler = { spawned: true, cond: 40 };
  assert.equal(npcEncounterAllowed(st, straggler), true);
});

test('pending, urgent, repair, follow-up and previously visited event nodes bypass the random subset', () => {
  const st = state();
  const defs = [
    { id: 'pending', ambient: true, encounterChance: 0 },
    { id: 'priority', priority: 80, ambient: true, encounterChance: 0 },
    { id: 'urgent', urgent: true, ambient: true, encounterChance: 0 },
    { id: 'repair', repair: true, ambient: true, encounterChance: 0 },
    { id: 'followup', followup: true, ambient: true, encounterChance: 0 },
    { id: 'headlamp_contact', ambient: true, encounterChance: 0 },
    { id: 'windproof_lash', ambient: true, encounterChance: 0 },
    { id: 'hallucination', encounterChance: 0 },
    { id: 'seen_before', ambient: true, encounterChance: 0 },
  ];
  const plan = ensureEncounters(st, [], defs, { fresh: true });
  for (const entry of Object.values(plan.events)) entry.selected = false; // even stale/excluded plans cannot block protected nodes
  st.story.pendingEvent = 'pending'; st.flags.ev_seen_before = 0;
  for (const def of defs) assert.equal(eventEncounterAllowed(st, def), true, def.id);
});

test('a plain notification or non-random condition stays eligible while ordinary ambient can be excluded', () => {
  const st = state();
  const normal = { id: 'ordinary', ambient: true, encounterChance: 0 };
  const plain = { id: 'sweat_tip', encounterChance: 0 };
  ensureEncounters(st, [], [normal, plain], { fresh: true });
  assert.equal(eventEncounterAllowed(st, normal), false);
  assert.equal(eventEncounterAllowed(st, plain), true);
});

test('definitions added after a saved plan do not mutate or regenerate that plan', () => {
  const st = state(), plan = ensureEncounters(st, npcs, RANDOM_EVENTS, { fresh: true });
  const before = JSON.stringify(plan);
  assert.equal(npcEncounterAllowed(st, { id: 'future_person' }), true);
  assert.equal(eventEncounterAllowed(st, { id: 'future_event' }), true);
  assert.equal(JSON.stringify(plan), before);
});

test('missing state or malformed definitions return safely without global state', () => {
  assert.equal(ensureEncounters(null), null);
  assert.equal(npcEncounterAllowed(null, group), false);
  assert.equal(eventEncounterAllowed(state(), null), false);
  assert.equal(npcEncounterAllowed(state(), group), true, 'pure checks never lazily reroll a plan');
});
