import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleRemains, MAX_BODY_BYTES, REMAINS_TTL_MS, validateNearbyQuery, validateRemains } from '../server/remains.js';

const schema = readFileSync(new URL('../migrations/0002_remains.sql', import.meta.url), 'utf8');
function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(schema);
  const execute = (sql, args) => {
    const statement = sqlite.prepare(sql);
    const reading = /^\s*(?:SELECT|PRAGMA)/i.test(sql) || /\bRETURNING\b/i.test(sql);
    return reading ? { results: statement.all(...args) } : { results: [], meta: statement.run(...args) };
  };
  const wrap = (sql, args = []) => ({
    bind(...bound) { return wrap(sql, bound); },
    async all() { return execute(sql, args); },
    async run() { return execute(sql, args); },
    execute() { return execute(sql, args); },
  });
  return {
    sqlite,
    prepare: wrap,
    async batch(statements) {
      sqlite.exec('BEGIN');
      try { const results = statements.map((statement) => statement.execute()); sqlite.exec('COMMIT'); return results; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
}
const origin = 'https://aotai.example';
let sequence = 0;
const base = (overrides = {}) => ({
  id: `remain_${++sequence}`, world: 'aotai-winter-v1', path: 'main', x: 128.25, z: -64.5,
  role: 'student', difficulty: 'normal', cause: 'hypothermia', gameMinute: 620,
  core: 31.5, health: 0, food: 12, water: 18, stress: 92, altitude: 3400, ...overrides,
});
const post = (data, headers = {}) => new Request(`${origin}/api/remains`, {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data),
});
const get = (query) => new Request(`${origin}/api/remains?${new URLSearchParams(query)}`);

test('valid remains are accepted once and duplicate IDs are idempotent', async () => {
  const DB = database(), data = base();
  let response = await handleRemains({ request: post(data), env: { DB } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { recorded: true });
  response = await handleRemains({ request: post({ ...data, x: 9999, cause: 'fall' }), env: { DB } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { recorded: false });
  const row = DB.sqlite.prepare('SELECT * FROM remains WHERE id=?').get(data.id);
  assert.equal(row.x, data.x); assert.equal(row.cause, data.cause);
  assert.equal(row.cell_x, Math.floor(data.x / 64)); assert.equal(row.cell_z, Math.floor(data.z / 64));
  assert.equal(row.expires_at - row.created_at, REMAINS_TTL_MS);
});

test('nearby query uses the requested path and adjacent 3x3 cells, excludes expired rows, and caps at 24', async () => {
  const DB = database();
  const center = base({ id: 'remain_center', x: 128, z: 128 });
  const neighbor = base({ id: 'remain_neighbor', x: 192, z: 192 });
  const outsideCell = base({ id: 'remain_farcell', x: 256, z: 128 });
  const wrongPath = base({ id: 'remain_wrongpath', path: 'qingfengxia', x: 128, z: 128 });
  for (const item of [center, neighbor, outsideCell, wrongPath]) await handleRemains({ request: post(item), env: { DB } });
  DB.sqlite.prepare('UPDATE remains SET created_at=?, expires_at=? WHERE id=?').run(Date.now() - REMAINS_TTL_MS - 1, Date.now() - 1, center.id);
  for (let i = 0; i < 30; i++) {
    const item = base({ id: `remain_bulk_${String(i).padStart(2, '0')}`, x: 64 + i * 0.01, z: 64 });
    await handleRemains({ request: post(item), env: { DB } });
  }
  const response = await handleRemains({ request: get({ world: 'aotai-winter-v1', path: 'main', cx: '2', cz: '2' }), env: { DB } });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.remains.length, 24);
  assert.equal(data.remains.some((item) => item.id === center.id), false);
  assert.equal(data.remains.some((item) => item.id === neighbor.id), true);
  assert.equal(data.remains.some((item) => item.id === outsideCell.id), false);
  assert.equal(data.remains.some((item) => item.id === wrongPath.id), false);
  for (const item of data.remains) assert.deepEqual(Object.keys(item).sort(), ['altitude', 'cause', 'core', 'createdAt', 'difficulty', 'food', 'gameMinute', 'health', 'id', 'path', 'role', 'stress', 'water', 'world', 'x', 'z'].sort());
});

test('strict validation rejects unknown fields, bad ranges, precision, and invalid query cells', async () => {
  const DB = database();
  for (const value of [
    { ...base(), privateText: 'no' }, { ...base(), id: 'short' }, { ...base(), x: 1.001 },
    { ...base(), core: 46 }, { ...base(), altitude: -1001 }, { ...base(), cause: 'exhaustion' }, { ...base(), path: 'unknown' },
  ]) assert.equal((await handleRemains({ request: post(value), env: { DB } })).status, 400);
  for (const query of [
    { world: 'wrong', path: 'main', cx: '2', cz: '2' }, { world: 'aotai-winter-v1', path: 'main', cx: '2.5', cz: '2' },
    { world: 'aotai-winter-v1', path: 'main', cx: '2', cz: '1000000001' }, { world: 'aotai-winter-v1', path: 'main', cx: '2', cz: '2', extra: 'x' },
  ]) assert.equal((await handleRemains({ request: get(query), env: { DB } })).status, 400);
  assert.throws(() => validateRemains({ ...base(), x: 0.001 }));
  assert.throws(() => validateNearbyQuery(new URLSearchParams({ world: 'aotai-winter-v1', path: 'main', cx: '2' })));
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS count FROM remains').get().count, 0);
});

test('method, same-origin, JSON content type, and streaming body limits are enforced', async () => {
  const DB = database(), data = base();
  assert.equal((await handleRemains({ request: new Request(`${origin}/api/remains`, { method: 'PUT' }), env: { DB } })).status, 405);
  const noOrigin = post(data); noOrigin.headers.delete('Origin');
  assert.equal((await handleRemains({ request: noOrigin, env: { DB } })).status, 403);
  assert.equal((await handleRemains({ request: post(data, { Origin: 'https://evil.example' }), env: { DB } })).status, 403);
  assert.equal((await handleRemains({ request: post(data, { 'Content-Type': 'text/plain' }), env: { DB } })).status, 415);
  assert.equal((await handleRemains({ request: post(data, { 'Content-Length': String(MAX_BODY_BYTES + 1) }), env: { DB } })).status, 413);
  const malformed = new Request(`${origin}/api/remains`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{' });
  assert.equal((await handleRemains({ request: malformed, env: { DB } })).status, 400);
  assert.equal((await handleRemains({ request: get({ world: 'aotai-winter-v1', path: 'main', cx: '2', cz: '2', cx2: '2' }), env: { DB } })).status, 400);
});

test('missing database degrades to 503 without exposing storage details', async () => {
  const data = base();
  const postResponse = await handleRemains({ request: post(data), env: {} });
  assert.equal(postResponse.status, 503); assert.deepEqual(await postResponse.json(), { error: 'remains_unavailable' });
  const getResponse = await handleRemains({ request: get({ world: 'aotai-winter-v1', path: 'main', cx: '2', cz: '2' }), env: {} });
  assert.equal(getResponse.status, 503); assert.deepEqual(await getResponse.json(), { error: 'remains_unavailable' });
});
