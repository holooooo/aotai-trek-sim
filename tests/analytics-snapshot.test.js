import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/sim/game.js';

const SAVE_KEY = 'aotai-save-v1';
const copy = (value) => JSON.parse(JSON.stringify(value));
function memoryStorage(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  });
  return storage;
}
const state = () => ({
  v: 1, time: 900, money: 600,
  body: { health: 90, stamina: 70 },
  inv: { bar: 2, blanket: 1 },
  story: { pendingEvent: 'hot_water_share', choices: {}, threads: {}, decisions: [], effects: {} },
});
const telemetry = (extra = {}) => ({
  runId: 'stable_run_0001', activeSeconds: 125,
  startedTracked: true, endedTracked: false,
  eventKeys: ['start:event:hot_water_share:900.000'],
  ...extra,
});

// A result screen can enable analytics while the gameplay save remains a pre-choice snapshot.
test('enabling statistics during a story saves the new run identity without committing choice effects', (t) => {
  const storage = memoryStorage(t), before = state();
  const snapshot = JSON.stringify(before), live = copy(before);
  live.time += 8; live.inv.bar--; live.body.stamina -= 4;
  live.story.choices.hot_water_share = 'share';
  live.telemetry = telemetry();
  const game = { st: live, over: false, eventSnapshot: snapshot };
  Game.prototype.save.call(game);
  const saved = JSON.parse(storage.getItem(SAVE_KEY));
  assert.deepEqual(saved.telemetry, live.telemetry, 'refresh must reuse the already voted run identity');
  const { telemetry: savedIdentity, ...savedGameplay } = saved;
  assert.deepEqual(savedGameplay, before, 'resource/time/answer transaction stays at the pre-choice checkpoint');
  assert.equal(Game.loadSave().telemetry.runId, savedIdentity.runId);
  assert.equal(live.inv.bar, 1, 'saving does not roll back the running game in memory');
});

test('event replay checkpoint carries current deduplication metadata and cumulative active time', (t) => {
  const storage = memoryStorage(t), before = state();
  before.telemetry = telemetry({ activeSeconds: 100, eventKeys: [] });
  const live = copy(before);
  live.telemetry.activeSeconds = 143;
  live.telemetry.eventKeys.push('start:event:hot_water_share:900.000');
  live.story.threads.hotWaterShared = true;
  live.money -= 40;
  const game = { st: live, over: false, eventSnapshot: JSON.stringify(before) };
  Game.prototype.save.call(game);
  const saved = JSON.parse(storage.getItem(SAVE_KEY));
  assert.deepEqual(saved.telemetry, live.telemetry, 'reload retains the encounter dedup key as well as run id');
  assert.equal(saved.money, before.money);
  assert.deepEqual(saved.story, before.story);
  assert.equal(before.telemetry.activeSeconds, 100, 'the original state object is not mutated');
});

test('opting out during an event removes snapshot run identity and cannot restore it on the next save', (t) => {
  const storage = memoryStorage(t), before = state();
  before.telemetry = telemetry();
  const live = copy(before);
  delete live.telemetry;
  live.inv.blanket = 0;
  const game = { st: live, over: false, eventSnapshot: JSON.stringify(before) };
  Game.prototype.save.call(game);
  Game.prototype.save.call(game);
  const saved = JSON.parse(storage.getItem(SAVE_KEY));
  assert.equal(Object.hasOwn(saved, 'telemetry'), false);
  assert.equal(Object.hasOwn(Game.loadSave(), 'telemetry'), false);
  assert.equal(saved.inv.blanket, 1, 'opting out does not commit gameplay deductions');
});

test('pending ending saves live resolutions and new run identity rather than the mountain snapshot', (t) => {
  const storage = memoryStorage(t), before = state();
  const live = copy(before);
  live.time = 1100;
  live.story.pendingEvent = null;
  live.story.threads.chenReportCompleted = true;
  live.story.resolutions = [{ title: '山下的报警', text: '已移交虚构线索' }];
  live.ending = { type: 'retreat', pending: true, reportResolved: true };
  live.telemetry = telemetry();
  const game = { st: live, over: true, eventSnapshot: JSON.stringify(before) };
  Game.prototype.save.call(game);
  assert.deepEqual(JSON.parse(storage.getItem(SAVE_KEY)), live);
  const resumed = Game.loadSave();
  assert.equal(resumed.ending.pending, true);
  assert.equal(resumed.ending.reportResolved, true);
  assert.equal(resumed.telemetry.runId, live.telemetry.runId);
  assert.equal(resumed.story.pendingEvent, null);
});

test('saving after a completed ending cannot recreate a cleared game save', (t) => {
  const storage = memoryStorage(t), st = state();
  st.ending = { type: 'retreat', pending: true };
  st.telemetry = telemetry();
  const game = { st, over: true, eventSnapshot: JSON.stringify(state()) };
  Game.prototype.save.call(game);
  assert.notEqual(storage.getItem(SAVE_KEY), null, 'the unfinished ending is initially resumable');
  st.ending.pending = false;
  st.telemetry.endedTracked = true;
  Game.clearSave();
  Game.prototype.save.call(game);
  assert.equal(storage.getItem(SAVE_KEY), null, 'pagehide/visibility save after run completion remains a no-op');
  assert.equal(Game.loadSave(), null);
});

test('ordinary game saves remain live saves and never invent analytics metadata', (t) => {
  const storage = memoryStorage(t), st = state();
  st.story.pendingEvent = null;
  st.time += 30;
  const game = { st, over: false, eventSnapshot: null };
  Game.prototype.save.call(game);
  assert.deepEqual(JSON.parse(storage.getItem(SAVE_KEY)), st);
  assert.equal(Object.hasOwn(JSON.parse(storage.getItem(SAVE_KEY)), 'telemetry'), false);
  st.telemetry = telemetry();
  Game.prototype.save.call(game);
  assert.deepEqual(JSON.parse(storage.getItem(SAVE_KEY)).telemetry, st.telemetry);
});
