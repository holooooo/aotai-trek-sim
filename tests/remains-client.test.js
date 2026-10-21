import test from 'node:test';
import assert from 'node:assert/strict';
import { RemainsClient, makeDeathRecord, remainsCell, validRemains } from '../src/sim/remains.js';

class Storage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, value); }
  removeItem(key) { this.values.delete(key); }
}
const state = () => ({ path: 'main', role: 'student', difficulty: 'normal', time: 720, body: { core: 31.2, health: 0, food: 10, water: 12, stress: 96 } });
const sample = { id: 'remain_001', world: 'aotai-winter-v1', path: 'main', x: 128, z: -64, role: 'student', difficulty: 'normal', cause: 'hypothermia', gameMinute: 720, core: 31.2, health: 0, food: 10, water: 12, stress: 96, altitude: 3400, createdAt: 1000 };
const response = (data, ok = true) => ({ ok, async json() { return data; } });

test('death records preserve actual position, cause, and a stable per-run ID', () => {
  const st = state(), pos = { x: -0.345, z: 64.129, y: 92 };
  const first = makeDeathRecord(st, pos, 'fall', 3760, 10);
  const next = makeDeathRecord(st, pos, 'injury', 3750, 20);
  assert.equal(first.id, next.id);
  assert.equal(first.x, -0.35); assert.equal(first.z, 64.13);
  assert.equal(first.cause, 'fall'); assert.equal(first.altitude, 3760);
  assert.equal(validRemains(first), true);
  assert.equal(remainsCell('main', pos).cx, -1);
});

test('offline own remains persist across clients and remain queryable within local radius', () => {
  const storage = new Storage();
  const first = new RemainsClient({ storage, fetcher: async () => { throw new Error('offline'); }, now: () => 1000 });
  first.setShared(false);
  const record = first.recordDeath(state(), { x: 100, z: -20 }, 'fall', 3450);
  const resumed = new RemainsClient({ storage, fetcher: async () => { throw new Error('offline'); }, now: () => 2000 });
  assert.equal(resumed.local.length, 1);
  assert.equal(resumed.nearby('main', { x: 140, z: -20 })[0].id, record.id);
  assert.equal(resumed.nearby('main', { x: 157, z: -20 }).length, 0);
  assert.equal(resumed.nearby('qingfengxia', { x: 100, z: -20 }).length, 0);
});

test('global disable clears visible rows, aborts in-flight reads, and sends no more network requests', async () => {
  const storage = new Storage(); let calls = 0, resolve;
  const fetcher = () => { calls++; return new Promise(r => { resolve = r; }); };
  const client = new RemainsClient({ storage, fetcher, now: () => 1000 });
  client.tick('main', { x: 1, z: 1 });
  assert.equal(calls, 1);
  const signal = client.request.signal;
  client.setEnabled(false);
  assert.equal(signal.aborted, true);
  assert.equal(client.nearby('main', { x: 1, z: 1 }).length, 0);
  client.tick('main', { x: 1, z: 1 });
  assert.equal(calls, 1);
  resolve?.(response({ remains: [sample] }));
  await new Promise(r => setImmediate(r));
  assert.equal(client.remote.length, 0); assert.equal(client.cache.size, 0);
});

test('an aborted cell read cannot repopulate rows after moving away and back', async () => {
  let resolve;
  const client = new RemainsClient({ storage: new Storage(), now: () => 1000,
    fetcher: () => new Promise(r => { resolve = r; }) });
  client.tick('main', { x: 128, z: -64 });
  client.tick('main', { x: 640, z: -64 });
  client.tick('main', { x: 128, z: -64 });
  resolve(response({ remains: [sample] }));
  await new Promise(r => setImmediate(r));
  assert.equal(client.remote.length, 0); assert.equal(client.cache.size, 0);
});

test('sharing off skips remote load but preserves locally saved bloodstains', () => {
  const storage = new Storage(); let calls = 0;
  const client = new RemainsClient({ storage, fetcher: async () => { calls++; return response({ remains: [sample] }); }, now: () => 1000 });
  client.setShared(false);
  const record = client.recordDeath(state(), { x: 128, z: -64 }, 'hypothermia', 3400);
  client.tick('main', { x: 128, z: -64 });
  assert.equal(calls, 0);
  assert.equal(client.nearby('main', { x: 128, z: -64 })[0].id, record.id);
  assert.equal(client.local[0].pending, false);
});

test('easy-mode health is recorded as a percentage of its actual maximum', () => {
  const st = state(); st.difficulty = 'easy'; st.body.health = 120;
  assert.equal(makeDeathRecord(st, { x: 0, z: 0 }, 'fall', 3000).health, 60);
});

test('disabled sharing drops pending offline records and never backfills them after re-enable', async () => {
  let calls = 0, now = 1000;
  const storage = new Storage();
  const client = new RemainsClient({ storage, now: () => now, fetcher: async () => { calls++; throw new Error('offline'); } });
  const st = state();
  client.recordDeath(st, { x: 0, z: 0 }, 'fall', 3000);
  await new Promise(r => setImmediate(r));
  assert.equal(calls, 1); assert.equal(client.local[0].pending, true);
  client.setShared(false); assert.equal(client.local[0].pending, false);
  client.setShared(true); now += 31000;
  await client.flush();
  assert.equal(calls, 1);
  assert.equal(client.nearby('main', { x: 0, z: 0 }).length, 1);
});

test('nearby reads are throttled and bounded cache prevents per-frame and revisit requests', async () => {
  let calls = 0, now = 1000;
  const client = new RemainsClient({ storage: new Storage(), now: () => now,
    fetcher: async () => { calls++; return response({ remains: [] }); } });
  client.tick('main', { x: 0, z: 0 });
  await new Promise(r => setImmediate(r));
  for (let i = 0; i < 100; i++) client.tick('main', { x: 0, z: 0 });
  assert.equal(calls, 1);
  now += 9000; client.tick('main', { x: 65, z: 0 });
  await new Promise(r => setImmediate(r));
  assert.equal(calls, 2);
  now += 9000; client.tick('main', { x: 0, z: 0 });
  assert.equal(calls, 2);
  for (let i = 2; i < 12; i++) {
    now += 9000; client.tick('main', { x: i * 64, z: 0 });
    await new Promise(r => setImmediate(r));
  }
  assert.equal(client.cache.size, 8);
});

test('already rendered records persist across the unload boundary before being removed', () => {
  const client = new RemainsClient({ storage: new Storage(), fetcher: null });
  client.local = [{ record: { ...sample, x: 0, z: 0 }, pending: false }];
  assert.equal(client.nearby('main', { x: 60, z: 0 }).length, 0);
  assert.equal(client.nearby('main', { x: 60, z: 0 }, new Set([sample.id])).length, 1);
  assert.equal(client.nearby('main', { x: 73, z: 0 }, new Set([sample.id])).length, 0);
});

test('remote results are filtered to path, adjacent cells, radius, and a bounded 24 rows', async () => {
  let now = 1000;
  const rows = Array.from({ length: 30 }, (_, i) => ({ ...sample, id: `remain_${String(i).padStart(3, '0')}`, x: 128 + i / 100 }));
  rows.push({ ...sample, id: 'remain_far_1', x: 1000 }, { ...sample, id: 'remain_path_1', path: 'dudumen' });
  const client = new RemainsClient({ storage: new Storage(), now: () => now, fetcher: async () => response({ remains: rows }) });
  client.tick('main', { x: 128, z: -64 });
  await new Promise(r => setImmediate(r));
  const nearby = client.nearby('main', { x: 128, z: -64 });
  assert.equal(nearby.length, 24);
  assert.equal(nearby.some(r => r.id === 'remain_far_1' || r.id === 'remain_path_1'), false);
  now += 8001;
  client.tick('main', { x: 1000, z: -64 });
  await new Promise(r => setImmediate(r));
  assert.equal(client.remote.length, 0);
});
