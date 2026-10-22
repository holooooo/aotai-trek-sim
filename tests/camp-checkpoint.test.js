import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Game } from '../src/sim/game.js';
import { createState } from '../src/sim/state.js';
import { roleById } from '../src/data/roles.js';
import { createCampCheckpoint, restoreCampCheckpoint, ensureCampCheckpoint } from '../src/sim/camp-checkpoint.js';
import { loadRecords } from '../src/sim/records.js';
import { NPCS } from '../src/data/npcs.js';

const SAVE = 'aotai-save-v1';
const copy = value => JSON.parse(JSON.stringify(value));
function storage(t) {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), values = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  } });
  t.after(() => old ? Object.defineProperty(globalThis, 'localStorage', old) : delete globalThis.localStorage);
  return values;
}
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function fixture() {
  const g = new Game({ scene: new THREE.Scene(), height: () => 80, loadAllAround() {}, shadowify: o => o, showHallucination() {} }, {}, {});
  g.st = createState('nurse', 'spring'); g.role = roleById(g.st.role);
  Object.assign(g.st, { pos: { x: 3, z: 5 }, time: 600, s: 200, maxS: 220 });
  g.pos.set(3, 80, 5); g.over = false; g.busy = false; g.eventRunning = false;
  g.player = new THREE.Group(); g.placeName = () => '测试营地';
  g.ui = { hideCampMenu() {}, hideCampPlacer() {}, setBusy() {}, closeSheet() {}, showHud() {}, toast() {}, showCampMenu() {},
    showEnding: ending => { g.result = ending; } };
  g.refreshHud = () => {};
  g.skip = async minutes => { g.st.time += minutes; };
  const tracked = [], remains = [];
  g.analytics = { track: (...args) => tracked.push(args), flush() {} };
  g.remains = { recordDeath: (...args) => remains.push(args), reset() {} };
  return { g, tracked, remains };
}
async function checkpoint(g, camp = { tent: 'tent_alpine', collapsed: false }) {
  g.st.camp = { inside: true, ...camp };
  await g.packCamp();
  assert.ok(g.st.campCheckpoint);
}

test('successful tent pack snapshots post-pack time, exact position and supplies independently', async t => {
  storage(t); const { g } = fixture(); g.st.inv.bar = 3;
  g.st.clothes.drying = ['base_merino'];
  g.st.telemetry = { runId: 'camp_test_123', activeSeconds: 10 };
  await checkpoint(g);
  const cp = copy(g.st.campCheckpoint);
  assert.equal(cp.state.time, 615); assert.equal(cp.state.camp, null);
  assert.deepEqual(cp.state.pos, { x: 3, z: 5 }); assert.deepEqual(cp.state.clothes.drying, []);
  assert.equal(cp.state.telemetry, undefined); assert.equal(cp.state.campCheckpoint, undefined);
  g.st.inv.bar = 1; g.st.body.health = 20; g.st.pos.x = 50;
  assert.deepEqual(g.st.campCheckpoint, cp);
  assert.equal(Game.loadSave().campCheckpoint.state.inv.bar, 3);
});

test('bivy and collapsed packs record actual aftermath; newer checkpoint replaces without nesting', async t => {
  storage(t); const { g } = fixture();
  await checkpoint(g, { bivy: true }); assert.equal(g.st.campCheckpoint.state.time, 600);
  g.st.inv.tent_alpine = 1; g.st.story.effects.tentLeak = true;
  await checkpoint(g, { tent: 'tent_alpine', collapsed: true });
  assert.equal(g.st.campCheckpoint.state.time, 625);
  assert.equal(g.st.campCheckpoint.state.inv.tent_alpine, undefined);
  assert.equal(g.st.campCheckpoint.state.story.effects.tentLeak, false);
  assert.equal(g.st.campCheckpoint.state.campCheckpoint, undefined);
});

test('missing, duplicate, dead, busy and transactional packs cannot overwrite a checkpoint', async t => {
  storage(t); const { g } = fixture(); await checkpoint(g);
  const cp = copy(g.st.campCheckpoint);
  for (const key of ['over', 'busy', 'eventRunning', 'eventSnapshot']) {
    g.st.camp = { bivy: true }; g[key] = true; await g.packCamp();
    assert.deepEqual(g.st.campCheckpoint, cp); g[key] = false;
  }
  g.st.camp = null; await g.packCamp(); assert.deepEqual(g.st.campCheckpoint, cp);
  g.st.camp = { tent: 'tent_alpine' }; g.skip = async () => { g.over = true; };
  await g.packCamp(); assert.deepEqual(g.st.campCheckpoint, cp);
});

test('continuing restores full gameplay repeatedly, keeps live telemetry, and does not finalize a death', async t => {
  storage(t); const { g, tracked, remains } = fixture();
  g.st.inv.bar = 3; await checkpoint(g); const cp = copy(g.st.campCheckpoint);
  g.st.telemetry = { runId: 'camp_test_123', activeSeconds: 150, eventKeys: ['already-sent'], endedTracked: false };
  g.st.body.health = 0; g.st.time = 900; g.st.inv.bar = 0; g.st.story.threads.afterCamp = true;
  g.ui.dialog = async options => { assert.equal(options.poll, undefined); return 'continue'; };
  await g.finish('dead', 'injury');
  assert.equal(g.st.time, cp.state.time); assert.equal(g.st.body.health, cp.state.body.health);
  assert.equal(g.st.inv.bar, 3); assert.equal(g.st.story.threads.afterCamp, undefined);
  assert.equal(g.st.ending, null); assert.equal(g.st.camp, null); assert.equal(g.over, false);
  assert.equal(g.autoWalk, false); assert.equal(g.falling, false); assert.equal(g.busy, false);
  assert.deepEqual(g.st.telemetry, { runId: 'camp_test_123', activeSeconds: 150, eventKeys: ['already-sent'], endedTracked: false });
  g.st.inv.bar = 1; g.st.body.health = 0; await g.finish('dead', 'fall');
  assert.equal(g.st.inv.bar, 3); assert.deepEqual(g.st.campCheckpoint, cp);
  assert.equal(tracked.length, 0); assert.equal(remains.length, 0); assert.equal(loadRecords().length, 0);
  assert.equal(Game.loadSave().ending, null);
});

test('pending death choice survives pagehide and reload; accepting records one normal ending', async t => {
  const values = storage(t); const { g, tracked, remains } = fixture(); await checkpoint(g);
  const choice = deferred(); g.ui.dialog = () => choice.promise;
  const pending = g.finish('dead', 'fall'); g.save();
  const saved = Game.loadSave(); assert.equal(saved.ending.pending, true); assert.ok(saved.campCheckpoint);
  assert.equal(tracked.length, 0); assert.equal(remains.length, 0);
  const { g: resumed, tracked: settled, remains: markers } = fixture();
  resumed.st = saved; resumed.ui.dialog = async () => 'accept';
  await resumed.finish(saved.ending.type, saved.ending.cause);
  assert.equal(resumed.result.type, 'dead'); assert.equal(resumed.result.cause, 'fall');
  assert.equal(settled.filter(([type]) => type === 'run_ended').length, 1); assert.equal(markers.length, 1);
  assert.equal(loadRecords().length, 1); assert.equal(values.get(SAVE), undefined);
  resumed.save(); await resumed.finish('dead', 'fall');
  assert.equal(loadRecords().length, 1); assert.equal(values.get(SAVE), undefined);
  // Closing the old page cannot settle the replacement page's state.
  g.st = null; choice.resolve('accept'); await pending;
});

test('legacy and damaged checkpoint fields are ignored while the main save remains playable', t => {
  const values = storage(t); const { g } = fixture();
  delete g.st.campCheckpoint; values.set(SAVE, JSON.stringify(g.st));
  assert.equal(Game.loadSave().campCheckpoint, null);
  const base = createCampCheckpoint(g.st, '营地'); assert.ok(base);
  for (const damage of [cp => { cp.v = 99; }, cp => { cp.state.path = 'bad'; }, cp => { cp.state.pos.x = null; },
    cp => { cp.state.npcs = { wu: null }; }, cp => { cp.state.npcs = { unknown: { spawned: true, x: 0, z: 0 } }; },
    cp => { cp.state.rescue = { npcs: null }; }, cp => { cp.state.body.health = 0; }, cp => { cp.state.seed++; },
    cp => { cp.state.campCheckpoint = {}; }, cp => { cp.state.telemetry = {}; }]) {
    const cp = copy(base); damage(cp); g.st.campCheckpoint = cp;
    values.set(SAVE, JSON.stringify(g.st)); const loaded = Game.loadSave();
    assert.ok(loaded); assert.equal(loaded.campCheckpoint, null); assert.equal(loaded.time, 600);
  }
  g.st.campCheckpoint = base; assert.ok(ensureCampCheckpoint(g.st));
  const fresh = createState('nurse'); assert.equal(fresh.campCheckpoint, null);
});

test('restores are independent and dehydrated living characters can create a checkpoint', () => {
  const { g } = fixture(); g.st.body.water = 0;
  g.st.campCheckpoint = createCampCheckpoint(g.st, '营地'); assert.ok(g.st.campCheckpoint);
  const a = restoreCampCheckpoint(g.st), b = restoreCampCheckpoint(g.st);
  a.inv.bar = 99; assert.notEqual(b.inv.bar, 99); assert.notEqual(g.st.campCheckpoint.state.inv.bar, 99);
});

test('old skip RAF cannot advance restored time or clear its busy flag', async t => {
  const old = globalThis.requestAnimationFrame, frame = deferred();
  globalThis.requestAnimationFrame = callback => { frame.resolve(callback); };
  t.after(() => { if (old) globalThis.requestAnimationFrame = old; else delete globalThis.requestAnimationFrame; });
  const { g } = fixture(); let simulated = 0;
  g.simulate = minutes => { simulated++; g.st.time += minutes; };
  const running = Game.prototype.skip.call(g, 60, 'idle'); const callback = await frame.promise;
  const restored = copy(g.st); restored.time = 615; g.st = restored; g.over = false; g.busy = true;
  callback(); assert.equal(await running, 'state');
  assert.equal(simulated, 1); assert.equal(g.st.time, 615); assert.equal(g.busy, true);
});

test('old sleep and pack continuations cannot modify a newly restored state', async () => {
  for (const action of ['sleep', 'packCamp', 'confirmCamp', 'tentCollapse', 'restFor', 'waitForRescue']) {
    const { g } = fixture(); const old = g.st, restored = copy(g.st);
    old.camp = { tent: 'tent_alpine', inside: true }; old.rescue = { self: true };
    g.hour = () => 10; g.exposure = () => 1; g.orientInfo = () => ({}); g.addStress = () => {};
    g.campPlacing = { ghost: { position: { x: 1, z: 2 } }, rot: 0 }; g.cancelCamp = () => {};
    g.wx = () => ({ wind: 0 }); g.ui.dialog = async () => 'fix';
    g.skip = async () => { g.st = restored; g.over = false; g.busy = true; return 'state'; };
    await g[action](60);
    assert.deepEqual(g.st, restored, action); assert.equal(restored.camp, null, action);
    assert.equal(g.busy, true, action);
  }
});

test('NPC time-consuming persuasion stops when passTime reports death', async () => {
  for (const id of ['speedteam', 'wu']) {
    let dialogs = 0, changed = 0;
    const game = { dialog: async () => { dialogs++; return 'persuade'; }, passTime: async () => false,
      persuadeChance: () => 1, roll: () => { changed++; return true; }, commsLabel: () => '', comms: () => ({}),
      st: { role: 'nurse' }, addStress() {}, isNurse: () => true, npcCond() {}, say: async () => { dialogs++; } };
    await NPCS.find(n => n.id === id).meet(game, { id, ns: {} });
    assert.equal(dialogs, 1, id); assert.equal(changed, 0, id);
  }
});
