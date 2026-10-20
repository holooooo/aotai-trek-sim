import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/sim/game.js';
import { createState } from '../src/sim/state.js';
import { roleById } from '../src/data/roles.js';
import { ensureEventPacing } from '../src/sim/event-director.js';

const SAVE_KEY = 'aotai-save-v1', NPC_ID = 'linqiao';
const copy = (value) => JSON.parse(JSON.stringify(value));
function memoryStorage(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), values = new Map();
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  });
  return storage;
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const telemetry = (extra = {}) => ({
  runId: 'npc_transaction_run_01', activeSeconds: 100, startedTracked: true, endedTracked: false,
  eventKeys: [], ...extra,
});
function fixture({ state, meet } = {}) {
  const g = Object.create(Game.prototype);
  g.st = state || createState('nurse'); g.role = roleById('nurse');
  g.over = false; g.busy = false; g.eventRunning = false; g.eventSnapshot = null; g.autoWalk = true;
  if (!state) {
    g.st.time = 900; g.st.inv = { bar: 3, blanket: 1 }; g.st.body.stamina = 80;
    g.st.telemetry = telemetry();
    g.st.npcs = { [NPC_ID]: { spawned: true, met: false, done: false, fate: null, cond: 65, path: 'main', s: 200, x: 1, z: 2 } };
  }
  ensureEventPacing(g.st);
  const def = { id: NPC_ID, name: '林桥', async meet(game, npc) { if (meet) await meet(game, npc); } };
  g.npcRt = { [NPC_ID]: { id: NPC_ID, def, ns: g.st.npcs[NPC_ID], marker: { visible: true } } };
  g.pos = { x: 1, y: 80, z: 2 };
  g.toast = () => {};
  g.ui = { hideCampMenu() {}, hideCampPlacer() {}, showHud() {}, showEnding(value) { g.result = value; } };
  g.passTime = async minutes => { g.st.time += minutes; g.st.body.stamina -= 2; };
  return g;
}
function twoPartEncounter() {
  const entered = [deferred(), deferred()], decisions = [deferred(), deferred()];
  let visits = 0, dialogs = 0;
  return {
    entered, decisions,
    get visits() { return visits; },
    async meet(g, npc) {
      visits++;
      assert.equal(g.takeItem('bar'), true);
      const a = await g.dialog({ who: '林桥', choices: [{ id: 'continue', label: '继续交谈' }] });
      if (a !== 'continue') return;
      assert.equal(g.spendBattery('phone', 2), true);
      if (!await g.eventPause(8)) return;
      const b = await g.dialog({ who: '林桥', choices: [{ id: 'finish', label: '把毯子交给他' }] });
      if (b !== 'finish') return;
      assert.equal(g.takeItem('blanket'), true);
      g.setFate(npc.id, 'portrait');
    },
    attach(g) {
      g.dialog = () => {
        const index = dialogs++;
        assert.ok(index < 2, 'saving must not start another dialogue or consume again');
        entered[index].resolve();
        return decisions[index].promise;
      };
    },
  };
}

// Calling the real save method models main.js's pagehide/visibilitychange handler.
test('pagehide during the first NPC dialogue saves an unmet replay checkpoint and current telemetry', async t => {
  memoryStorage(t);
  const flow = twoPartEncounter(), g = fixture({ meet: flow.meet }); flow.attach(g);
  const before = copy(g.st), running = g.meetNpc(NPC_ID);
  await flow.entered[0].promise;
  assert.equal(g.st.npcs[NPC_ID].met, true); assert.equal(g.npcRt[NPC_ID].marker.visible, false);
  assert.equal(g.st.inv.bar, before.inv.bar - 1); assert.equal(g.autoWalk, false);
  g.st.telemetry.activeSeconds = 143;
  g.st.telemetry.eventKeys.push('start:npc:linqiao:900.000');
  g.save();
  const saved = Game.loadSave();
  assert.equal(saved.npcs[NPC_ID].met, false);
  assert.equal(saved.story.pendingNpc, NPC_ID);
  assert.equal(saved.inv.bar, before.inv.bar); assert.equal(saved.time, before.time);
  assert.deepEqual(saved.telemetry, g.st.telemetry);
  assert.equal(g.st.inv.bar, before.inv.bar - 1, 'saving does not undo the live encounter');
  flow.decisions[0].resolve('continue'); await flow.entered[1].promise;
  flow.decisions[1].resolve('finish'); await running;
});

test('repeated saves between dialogues neither double-consume nor commit a partial NPC transaction', async t => {
  memoryStorage(t);
  const flow = twoPartEncounter(), g = fixture({ meet: flow.meet }); flow.attach(g);
  const before = copy(g.st), running = g.meetNpc(NPC_ID);
  await flow.entered[0].promise; flow.decisions[0].resolve('continue'); await flow.entered[1].promise;
  const during = copy(g.st);
  for (let i = 0; i < 4; i++) {
    g.st.telemetry.activeSeconds = 145 + i;
    g.save();
    const saved = Game.loadSave();
    assert.equal(saved.story.pendingNpc, NPC_ID); assert.equal(saved.npcs[NPC_ID].met, false);
    assert.equal(saved.inv.bar, before.inv.bar); assert.equal(saved.inv.blanket, before.inv.blanket);
    assert.equal(saved.bat.phone, before.bat.phone); assert.equal(saved.time, before.time);
    assert.equal(saved.body.stamina, before.body.stamina);
    assert.equal(saved.telemetry.activeSeconds, 145 + i);
    assert.equal(g.st.inv.bar, during.inv.bar); assert.equal(g.st.bat.phone, during.bat.phone);
    assert.equal(g.st.time, during.time); assert.equal(flow.visits, 1);
  }
  flow.decisions[1].resolve('finish'); await running;
  const completed = Game.loadSave();
  assert.equal(completed.npcs[NPC_ID].met, true); assert.equal(completed.npcs[NPC_ID].fate, 'portrait');
  assert.equal(completed.story.pendingNpc, null); assert.equal(g.eventSnapshot, null);
  assert.equal(completed.inv.bar, before.inv.bar - 1); assert.equal(completed.inv.blanket, undefined);
  assert.equal(completed.bat.phone, before.bat.phone - 2); assert.equal(completed.time, before.time + 8);
  assert.deepEqual(completed.telemetry, g.st.telemetry);
});

test('NPC replay checkpoints synchronize opt-in and opt-out without committing resource changes', async t => {
  memoryStorage(t);
  const flow = twoPartEncounter(), g = fixture({ meet: flow.meet }); flow.attach(g);
  delete g.st.telemetry;
  const running = g.meetNpc(NPC_ID); await flow.entered[0].promise;
  g.st.telemetry = telemetry({ activeSeconds: 12, eventKeys: ['new-npc-key'] });
  g.save(); assert.deepEqual(Game.loadSave().telemetry, g.st.telemetry);
  delete g.st.telemetry; g.save(); g.save();
  const optedOut = Game.loadSave();
  assert.equal(Object.hasOwn(optedOut, 'telemetry'), false);
  assert.equal(optedOut.inv.bar, 3); assert.equal(optedOut.npcs[NPC_ID].met, false);
  assert.equal(optedOut.story.pendingNpc, NPC_ID);
  flow.decisions[0].resolve('continue'); await flow.entered[1].promise;
  flow.decisions[1].resolve('finish'); await running;
  assert.equal(Object.hasOwn(Game.loadSave(), 'telemetry'), false);
});

test('checkTriggers replays a pending NPC before pacing or world triggers, then charges only once on completion', async t => {
  memoryStorage(t);
  const initial = fixture(); initial.st.story.pendingNpc = NPC_ID;
  initial.st.story.pacing.started = false; initial.st.stats.walked = 0;
  initial.st.maxS = 0; initial.st.flags = {}; initial.save();
  const saved = Game.loadSave(), beforeReplay = copy(saved), flow = twoPartEncounter(), g = fixture({ state: saved, meet: flow.meet }); flow.attach(g);
  g.world = { height() { assert.fail('pending NPC replay must precede world/exit/pacing work'); } };
  const running = g.checkTriggers(0.1); await flow.entered[0].promise;
  assert.equal(g.st.story.pacing.started, false); assert.equal(g.eventRunning, true);
  assert.equal(g.st.npcs[NPC_ID].met, true); assert.equal(g.st.inv.bar, 2);
  g.save(); assert.equal(Game.loadSave().inv.bar, 3);
  flow.decisions[0].resolve('continue'); await flow.entered[1].promise;
  g.save(); assert.equal(Game.loadSave().bat.phone, beforeReplay.bat.phone);
  flow.decisions[1].resolve('finish'); await running;
  const completed = Game.loadSave();
  assert.equal(completed.inv.bar, 2); assert.equal(completed.inv.blanket, undefined);
  assert.equal(completed.bat.phone, beforeReplay.bat.phone - 2);
  assert.equal(completed.npcs[NPC_ID].fate, 'portrait'); assert.equal(completed.story.pendingNpc, null);
  assert.equal(g.eventRunning, false); assert.equal(g.eventSnapshot, null); assert.equal(flow.visits, 1);
});

test('an exception rolls NPC state and supplies back while retaining current telemetry for retry', async t => {
  memoryStorage(t);
  const g = fixture({ async meet(game) {
    game.takeItem('bar'); game.st.telemetry.activeSeconds = 167;
    game.st.telemetry.eventKeys.push('npc-before-failure');
    throw new Error('interrupted NPC fixture');
  } });
  g.start = restored => {
    g.st = restored; g.eventSnapshot = null; g.eventRunning = false;
    g.npcRt[NPC_ID].ns = restored.npcs[NPC_ID];
  };
  await assert.rejects(g.meetNpc(NPC_ID), /interrupted NPC fixture/);
  const saved = Game.loadSave();
  assert.equal(saved.inv.bar, 3); assert.equal(saved.npcs[NPC_ID].met, false);
  assert.equal(saved.story.pendingNpc, null); assert.equal(g.eventSnapshot, null);
  assert.equal(saved.telemetry.activeSeconds, 167); assert.deepEqual(saved.telemetry.eventKeys, ['npc-before-failure']);
});

test('a pending ending uses live NPC progress, and neither NPC finally nor pagehide can resurrect a completed save', async t => {
  const storage = memoryStorage(t), familyDialogue = deferred(), enteredEnding = deferred();
  const g = fixture({ async meet(game, npc) {
    game.takeItem('bar'); game.setFate(npc.id, 'portrait');
    await game.finish('retreat');
  } });
  g.st.story.threads.contactHome = true;
  g.dialog = (opts) => {
    assert.equal(opts.pollSource, 'scene:ending_family');
    enteredEnding.resolve(); return familyDialogue.promise;
  };
  const running = g.meetNpc(NPC_ID); await enteredEnding.promise;
  assert.equal(g.over, true); assert.equal(g.st.ending.pending, true);
  g.st.telemetry.activeSeconds = 180; g.save();
  const pending = Game.loadSave();
  assert.equal(pending.ending.pending, true); assert.equal(pending.npcs[NPC_ID].met, true);
  assert.equal(pending.npcs[NPC_ID].fate, 'portrait'); assert.equal(pending.inv.bar, 2);
  assert.equal(pending.telemetry.activeSeconds, 180, 'pending ending saves live data rather than rewinding the mountain snapshot');
  familyDialogue.resolve('reply'); await running;
  assert.equal(g.st.ending.pending, false); assert.equal(g.st.story.pendingNpc, null);
  assert.equal(g.eventSnapshot, null); assert.equal(g.result.type, 'retreat');
  assert.equal(storage.getItem(SAVE_KEY), null); assert.equal(Game.loadSave(), null);
  g.save(); g.save();
  assert.equal(storage.getItem(SAVE_KEY), null, 'pagehide/visibility saves after NPC completion remain a no-op at an ending');
  assert.equal(Game.loadSave(), null);
});
