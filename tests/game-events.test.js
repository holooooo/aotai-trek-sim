import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/sim/game.js';
import { createState } from '../src/sim/state.js';
import { roleById } from '../src/data/roles.js';
import { ITEMS } from '../src/data/items.js';
import { EVENTS } from '../src/data/events.js';
import { EXPANDED_EVENTS } from '../src/data/events-expanded.js';
import { REPORTED_EVENTS } from '../src/data/events-reported.js';
import { chooseEvent, completeEvent, AMBIENT_GAP, ensureEventPacing, DIALOG_GAP } from '../src/sim/event-director.js';
import { collectEpilogues, ensureStoryState } from '../src/sim/stories.js';
import { addRecord, summarize, loadRecords } from '../src/sim/records.js';

const storage = new Map();
globalThis.localStorage = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) };
function fixture(role = 'nurse') {
  const g = Object.create(Game.prototype);
  g.st = createState(role); g.role = roleById(role); g.pos = { x: 5, y: 80, z: 5 };
  Object.assign(g.st, { time: 1600, s: 600, maxS: 600, warmers: 8, thermos: { l: 1, temp: 80 }, companions: ['mou'], npcs: { mou: { following: true, met: true, cond: 90, fate: 'together' } } });
  for (const id of Object.keys(ITEMS)) if (!['water', 'gas', 'warmer'].includes(ITEMS[id].kind)) g.st.inv[id] = 2;
  g.st.flags.gateDone = true;
  g.st.stats.walked = 300;
  Object.assign(ensureEventPacing(g.st), {elapsed:200,nextAmbientAt:0});
  g.wx = () => ({ wind: 20, severity: 0.8, precip: 0.8, overcast: 0.8 });
  g.signal = () => 2; g.airT = () => -20; g.daylight = () => true; g.foggy = () => true; g.night = () => true;
  g.isWalking = () => true; g.onExposedRidge = () => true; g.over = false;
  g.ui = { setBusy() {}, showCampMenu() {}, dialog: async () => 'cancel', toast() {}, flash() {}, hideCampMenu() {}, hideCampPlacer() {}, showHud() {}, showEnding: (v) => { g.result = v; } };
  g.toast = () => {}; g.save = Game.prototype.save;
  g.eventPause = async (minutes) => { g.st.time += minutes; return !g.over; };
  g.beginCamp = async () => { g.camped = true; };
  g.retreat = (kind) => { g.st.dir = kind === 'back' ? -1 : 1; };
  g.packCamp = async () => { g.st.camp = null; };
  g.waitForRescue = async () => {};
  g.sos = async () => ({ ok: false });
  g.updateRescuePosition = () => true;
  g.cam = { yaw: 0 };
  return g;
}

test('event ids are unique, with 18 core first encounters and 3 researched events', () => {
  const all = [...EVENTS, ...EXPANDED_EVENTS, ...REPORTED_EVENTS];
  assert.equal(new Set(all.map((e) => e.id)).size, all.length);
  assert.equal(EXPANDED_EVENTS.filter((e) => !e.followup).length, 18);
  assert.equal(EXPANDED_EVENTS.filter((e) => e.role).length, 6);
  assert.equal(EXPANDED_EVENTS.filter((e) => e.followup).length, 3);
  assert.equal(REPORTED_EVENTS.length, 3);
});

test('director protects urgent events and respects global/camp cooldowns', () => {
  const g = fixture();
  const normal = { id: 'normal', once: true, ambient: true, priority: 20, cond: () => true };
  const urgent = { id: 'undress', once: false, cooldown: 240, cond: () => true };
  assert.equal(chooseEvent([normal, urgent], g).id, 'undress');
  completeEvent(g.st, urgent);
  assert.equal(chooseEvent([normal, urgent], g), null);
  g.st.story.pacing.elapsed += DIALOG_GAP + 45;
  assert.equal(chooseEvent([normal, urgent], g).id, 'normal');
  completeEvent(g.st, normal);
  assert.equal(chooseEvent([{ ...normal, id: 'other' }], g), null);
  g.st.time += AMBIENT_GAP;
  g.st.story.pacing.elapsed += DIALOG_GAP + 45;
  g.st.camp = { inside: true };
  assert.equal(chooseEvent([{ ...normal, id: 'other' }], g), null);
  assert.equal(chooseEvent([{ ...normal, id: 'other', allowCamp: true }], g).id, 'other');
  g.st.body.core = 33;
  assert.equal(chooseEvent([{ ...normal, id: 'other', allowCamp: true }], g), null);
  g.st.flags.ev_undress = 0; g.st.time = 10;
  assert.equal(chooseEvent([urgent], g), null, 'time zero is a valid event timestamp');
});

test('every new choice executes with the real Game resource and story helpers', async () => {
  for (const ev of [...EXPANDED_EVENTS, ...REPORTED_EVENTS]) {
    let options;
    const probe = fixture(ev.role || 'nurse');
    probe.st.camp = { inside: true, health: 55, tent: 'tent_alpine' };
    probe.st.rescue = { self: true, x: 5, z: 5, moved: false, method: 'sat', eta: 3000, npcs: [] };
    probe.storyDialog = async (_id, opts) => { options = opts.choices; return null; };
    await ev.run(probe);
    assert.ok(options?.length >= 2, ev.id);
    for (const option of options.filter((c) => !c.disabled)) {
      const g = fixture(ev.role || 'nurse');
      g.st.camp = { inside: true, health: 55, tent: 'tent_alpine' };
      g.st.rescue = { self: true, x: 5, z: 5, moved: false, method: 'sat', eta: 3000, npcs: [] };
      g.dialog = async () => option.id;
      await ev.run(g);
      assert.ok(Object.values(g.st.bat).every((v) => v >= 0 && v <= 100), ev.id);
      assert.ok(g.st.thermos.l >= 0, ev.id);
      assert.ok(Object.values(g.st.inv).every((n) => n >= 0), ev.id);
      assert.ok(g.st.body.stress >= 0 && g.st.body.stress <= 100, ev.id);
    }
  }
});

test('sharing and swapping consume real inventory; repair choices restore persistent faults', async () => {
  const g = fixture(); g.dialog = async () => 'share';
  await EXPANDED_EVENTS.find((e) => e.id === 'hot_water_share').run(g);
  assert.equal(g.st.thermos.l, 0.75);
  assert.equal(g.storyValue('hotWaterShared'), true);
  const lamp = EXPANDED_EVENTS.find((e) => e.id === 'headlamp_contact');
  g.dialog = async (_opts) => 'fix';
  await lamp.run(g);
  assert.equal(g.st.story.effects.headlampFault, false);
});

test('event save is a replayable pre-choice snapshot, not a double deduction', async () => {
  storage.clear();
  const g = fixture(); g.st.inv.bar = 2;
  const ev = { id: 'snapshot_probe', once: true, ambient: true, async run(game) {
    game.takeItem('bar'); game.save();
    const loaded = Game.loadSave();
    assert.equal(loaded.inv.bar, 2);
    assert.equal(loaded.story.pendingEvent, ev.id);
  } };
  await g.runScheduledEvent(ev);
  assert.equal(Game.loadSave().inv.bar, 1);
  assert.equal(Game.loadSave().story.pendingEvent, null);
  assert.equal(g.st.flags.ev_snapshot_probe, g.st.time);
});

test('legacy saves and records survive, while epilogues collect independently', () => {
  storage.clear();
  const old = createState('student'); delete old.story;
  ensureStoryState(old); assert.deepEqual(old.story.choices, {});
  storage.set('aotai-records-v1', JSON.stringify([{ key: 'cross', type: 'cross', progress: 12 }]));
  assert.equal(loadRecords().length, 1);
  addRecord({ key: 'dayehai', type: 'dayehai', epilogues: ['honest', 'honest', 'invalid'] });
  const sum = summarize();
  assert.equal(sum.total, 2); assert.ok(sum.unlocked.has('cross')); assert.deepEqual([...sum.unlockedEpilogues], ['honest']);
});

test('epilogues require surviving companions and actual rescue, not sending a message', () => {
  const g = fixture('blogger');
  Object.assign(g.st.story.threads, { rescueContact: true, reportCompleted: true, honestFootage: true });
  g.st.body.fracture = 1;
  const fates = [{ name: '小牟', fate: 'together' }];
  assert.deepEqual(collectEpilogues(g.st, 'retreat', fates), ['together', 'report', 'honest', 'aftermath']);
  g.st.rescue = { moved: false };
  assert.ok(collectEpilogues(g.st, 'rescued', fates).includes('beacon'));
  g.st.rescue.moved = true;
  assert.ok(!collectEpilogues(g.st, 'rescued', fates).includes('beacon'));
  g.st.npcs.mou.dead = true;
  assert.ok(!collectEpilogues(g.st, 'retreat', fates).includes('together'));
  assert.deepEqual(collectEpilogues(g.st, 'dead', fates), []);
});

test('updating a rescue position uses real communications and cannot teleport rescue', () => {
  const g = fixture(); delete g.updateRescuePosition;
  g.st.rescue = { self: true, x: 100, z: 100, moved: true, eta: 1601 };
  const before = g.st.bat.satcomm;
  assert.equal(g.updateRescuePosition(), true);
  assert.equal(g.st.rescue.moved, false);
  assert.equal(g.st.rescue.x, 5);
  assert.equal(g.st.bat.satcomm, before - 4);
  assert.ok(g.st.rescue.eta >= g.st.time + 120);
  g.st.bat.satcomm = 0; g.st.bat.phone = 0;
  assert.equal(g.updateRescuePosition(), false);
});

test('survival ending actually offers handover, and records the resulting epilogue', async () => {
  storage.clear();
  const g = fixture(); g.st.story.threads.reportNote = true;
  g.dialog = async () => 'report';
  await g.finish('dayehai');
  assert.ok(g.result.epilogues.includes('report'));
  assert.equal(g.result.type, 'dayehai');
  assert.equal(loadRecords()[0].key, 'dayehai');
  assert.ok(loadRecords()[0].epilogues.includes('report'));
});


test('a failed event rolls back resource deductions rather than saving a partial transaction', async () => {
  storage.clear();
  const g = fixture(); g.st.inv.bar = 3;
  g.start = (st) => { g.st = st; g.eventSnapshot = null; };
  const original = console.error;
  try {
    console.error = () => {};
    await g.runScheduledEvent({ id: 'fail', async run(game) { game.takeItem('bar'); throw new Error('fixture'); } });
  } finally { console.error = original; }
  assert.equal(g.st.inv.bar, 3);
  assert.equal(Game.loadSave().inv.bar, 3);
  assert.equal(Game.loadSave().story.pendingEvent, null);
});

test('SOS updates an existing position once, including the shared followup timestamp', async () => {
  const g = fixture(); delete g.sos; delete g.updateRescuePosition;
  delete g.st.inv.satcomm;
  g.st.bat.phone = 8;
  g.st.rescue = { self: true, x: 100, z: 100, moved: true, eta: 1700 };
  assert.deepEqual(await g.sos(), { ok: true });
  assert.equal(g.st.bat.phone, 3);
  assert.equal(g.st.rescue.x, 5);
  assert.equal(g.storyValue('rescueUpdatedAt'), g.st.time);
});

test('unfinished ending dialogs resume their checkpoint without losing previous answers', async () => {
  storage.clear();
  const g = fixture();
  Object.assign(g.st.story.threads, { reportNote: true, contactHome: true });
  let answerFamily;
  g.dialog = async (opts) => opts.who.includes('移交') || opts.who.includes('线索') ? 'report' : new Promise((resolve) => { answerFamily = resolve; });
  const finishing = g.finish('dayehai');
  await Promise.resolve(); await Promise.resolve();
  const checkpoint = Game.loadSave();
  assert.equal(checkpoint.ending.pending, true);
  assert.equal(checkpoint.ending.reportResolved, true);
  assert.equal(checkpoint.story.resolutions.length, 1);
  const restored = fixture(); restored.st = checkpoint;
  const prompts = [];
  restored.dialog = async (opts) => { prompts.push(opts.who); return 'reply'; };
  await restored.finish('dayehai');
  assert.equal(prompts.length, 1);
  assert.ok(restored.result.epilogues.includes('report'));
  assert.equal(restored.result.resolutions.length, 2);
  assert.equal(loadRecords().length, 1);
  // 模拟旧页面被关闭，停止其结算，避免重复提交记录。
  g.st = null; answerFamily('later'); await finishing;
});

test('reporting a separate clue does not silently report Chen', async () => {
  storage.clear();
  const g = fixture();
  Object.assign(g.st.story.threads, { reportNote: true, reportNoteCompleted: true, reportCompleted: true });
  g.st.flags.reportChen = true;
  g.st.npcs.chen = { met: true, fate: 'reportLater' };
  let prompted = false;
  g.dialog = async () => { prompted = true; return 'leave'; };
  await g.finish('retreat');
  assert.ok(prompted);
  assert.equal(g.result.fates.find((f) => f.name === '老陈').fate, 'unknown');
  assert.ok(g.result.epilogues.includes('report'), 'the already handed-over clue remains collected');
});

test('cooking stops when skipping time ends the run', async () => {
  const g = fixture(); g.st.thermos.l = 0;
  g.exposure = () => 0.1;
  g.skip = async () => { g.over = true; };
  const before = g.st.body.core;
  await g.cook();
  assert.equal(g.st.thermos.l, 0);
  assert.equal(g.st.body.core, before);
});
