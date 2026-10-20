import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleChoices, handleTelemetry, MAX_BODY_BYTES, validateQuestion } from '../server/analytics.js';
import { EVENT_IDS, ITEM_CATEGORIES, NPC_IDS } from '../server/analytics-catalog.js';
import { EVENTS } from '../src/data/events.js';
import { EXPANDED_EVENTS } from '../src/data/events-expanded.js';
import { REPORTED_EVENTS } from '../src/data/events-reported.js';
import { ITEMS } from '../src/data/items.js';
import { NPCS } from '../src/data/npcs.js';

const schema = readFileSync(new URL('../migrations/0001_analytics.sql', import.meta.url), 'utf8');
function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(schema);
  const wrap = (sql, args = []) => ({
    bind(...bound) { return wrap(sql, bound); },
    async all() { return execute(sql, args); },
    async run() { return execute(sql, args); },
    execute() { return execute(sql, args); },
  });
  function execute(sql, args) {
    const statement = sqlite.prepare(sql);
    const reading = /^\s*SELECT/i.test(sql) || /\bRETURNING\b/i.test(sql);
    return reading ? { results: statement.all(...args) } : { results: [], meta: statement.run(...args) };
  }
  return {
    sqlite,
    prepare: wrap,
    async batch(statements) {
      sqlite.exec('BEGIN');
      try { const results = statements.map((s) => s.execute()); sqlite.exec('COMMIT'); return results; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
}
const origin = 'https://aotai.example';
let sequence = 0;
const nextId = () => `event_${++sequence}_unique`;
const visitorId = () => `visitor_${++sequence}_unique`;
const event = (type, extra = {}) => ({ id: nextId(), runId: 'run_00000001', type, at: 1792500000000, role: 'student', difficulty: 'normal', ...extra });
const post = (path, data, headers = {}) => new Request(`${origin}/api/${path}`, {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data),
});
const get = (questionId, optionIds) => new Request(`${origin}/api/choices?${new URLSearchParams({ questionId, optionIds: optionIds.join(',') })}`);
const question = { questionId: 'event:old_tent:check|leave', optionIds: ['leave', 'check'] };
const totals = (db) => db.sqlite.prepare('SELECT * FROM analytics_overview').get();

// Handler contract tests use actual SQLite and the production SQL/trigger migration.
test('telemetry is event-id idempotent, including duplicate ids inside one atomic batch', async () => {
  const DB = database(), visitor = visitorId(), started = event('run_started', { fresh: true });
  const payload = { visitorId: visitor, events: [started, started] };
  let response = await handleTelemetry({ request: post('telemetry', payload), env: { DB } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { accepted: 1, duplicates: 1 });
  response = await handleTelemetry({ request: post('telemetry', payload), env: { DB } });
  assert.deepEqual(await response.json(), { accepted: 0, duplicates: 2 });
  assert.equal(totals(DB).players, 1); assert.equal(totals(DB).run_started, 1); assert.equal(totals(DB).telemetry_events, 1);
});

test('run aggregates ignore repeated start/end and use cumulative active time maximum', async () => {
  const DB = database(), visitor = visitorId();
  const response = await handleTelemetry({ request: post('telemetry', { visitorId: visitor, events: [
    event('run_started', { fresh: true }), event('run_started', { fresh: true }),
    event('run_checkpoint', { activeSeconds: 120 }), event('run_checkpoint', { activeSeconds: 30 }),
    event('run_resumed', { fresh: false }), event('run_ended', { ending: 'dead', cause: 'fall', death: true, activeSeconds: 150 }),
    event('run_ended', { ending: 'cross', death: false, activeSeconds: 150 }),
  ] }), env: { DB } });
  assert.equal(response.status, 200);
  const summary = totals(DB);
  assert.equal(summary.run_started, 1); assert.equal(summary.run_resumed, 1);
  assert.equal(summary.ended_runs, 1); assert.equal(summary.deaths, 1);
  assert.equal(summary.active_seconds, 150); assert.equal(summary.active_runs, 1);
  assert.equal(summary.avg_active_seconds_per_active_run, 150);
  const ending = DB.sqlite.prepare('SELECT * FROM analytics_endings').get();
  assert.equal(ending.ending, 'dead'); assert.equal(ending.cause, 'fall'); assert.equal(ending.total, 1);
});

test('event, item/category, ending unlock and per-device means stay independently aggregated', async () => {
  const DB = database(), visitor = visitorId();
  const rows = [
    event('event_started', { eventId: 'old_tent' }), event('event_completed', { eventId: 'old_tent' }),
    event('shop_buy', { itemId: 'bar', quantity: 2, cost: 40 }), event('shop_refund', { itemId: 'bar', quantity: 1, cost: 20 }),
    event('run_ended', { ending: 'dayehai' }),
    event('run_ended', { runId: 'run_00000002', ending: 'dayehai' }),
    event('run_ended', { runId: 'run_00000003', ending: 'retreat' }),
  ];
  assert.equal((await handleTelemetry({ request: post('telemetry', { visitorId: visitor, events: rows }), env: { DB } })).status, 200);
  const events = DB.sqlite.prepare('SELECT * FROM analytics_event_totals').get();
  assert.equal(events.started, 1); assert.equal(events.completed, 1);
  const shop = DB.sqlite.prepare('SELECT * FROM analytics_shop_categories').get();
  assert.equal(shop.category, 'food'); assert.equal(shop.bought_quantity, 2); assert.equal(shop.refunded_quantity, 1);
  assert.equal(shop.buy_cost, 40); assert.equal(shop.refund_cost, 20);
  assert.equal(totals(DB).unique_ending_unlocks, 2);
  assert.equal(totals(DB).avg_unlocked_endings_per_device, 2);
  assert.equal((await handleTelemetry({ request: post('telemetry', { visitorId: visitorId(), events: [event('run_started')] }), env: { DB } })).status, 200);
  assert.equal(totals(DB).avg_unlocked_endings_per_device, 1, 'all observed devices, including no ending, are the denominator');
});

test('first choice per visitor/run/question wins and retry never casts another vote', async () => {
  const DB = database(), payload = { visitorId: visitorId(), runId: 'run_00000001', ...question, optionId: 'check' };
  let response = await handleChoices({ request: post('choices', payload), env: { DB } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { questionId: question.questionId, total: 1, counts: { check: 1, leave: 0 }, recorded: true, previousOptionId: 'check' });
  response = await handleChoices({ request: post('choices', { ...payload, optionId: 'leave' }), env: { DB } });
  assert.deepEqual(await response.json(), { questionId: question.questionId, total: 1, counts: { check: 1, leave: 0 }, recorded: false, previousOptionId: 'check' });
  await handleChoices({ request: post('choices', { ...payload, runId: 'run_00000002', optionId: 'leave' }), env: { DB } });
  const rotated = await handleChoices({ request: post('choices', { ...payload, visitorId: visitorId(), optionId: 'leave' }), env: { DB } });
  assert.deepEqual(await rotated.json(), { questionId: question.questionId, total: 2, counts: { check: 1, leave: 1 }, recorded: false }, 'run/question uniqueness survives an altered visitor id without disclosing the previous vote');
  response = await handleChoices({ request: get(question.questionId, question.optionIds), env: { DB } });
  assert.deepEqual(await response.json(), { questionId: question.questionId, total: 2, counts: { check: 1, leave: 1 } });
});

test('zero samples are explicit zero, and different question/option sets cannot pollute each other', async () => {
  const DB = database(), visitor = visitorId();
  const a = { questionId: 'event:signal:call|no', optionIds: ['call', 'no'] };
  const b = { questionId: 'event:signal:call|live|no', optionIds: ['call', 'live', 'no'] };
  await handleChoices({ request: post('choices', { visitorId: visitor, runId: 'run_00000001', ...a, optionId: 'call' }), env: { DB } });
  const response = await handleChoices({ request: get(b.questionId, b.optionIds), env: { DB } });
  assert.deepEqual(await response.json(), { questionId: b.questionId, total: 0, counts: { call: 0, live: 0, no: 0 } });
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM choice_questions').get().n, 1, 'read-only query does not create rows');
});

test('invalid fields, types, ids and event-specific values reject the entire batch before writing', async () => {
  const DB = database(), visitor = visitorId();
  const badEvents = [
    event('unknown'), { ...event('run_started'), text: 'private' }, event('run_started', { role: 'invented' }),
    event('run_started', { difficulty: 'invented' }), event('run_started', { at: 'yesterday' }),
    event('run_checkpoint', { activeSeconds: -1 }), event('shop_buy', { itemId: 'invented', quantity: 1, cost: 10 }),
    event('shop_buy', { itemId: 'bar', quantity: 0, cost: 10 }), event('shop_refund', { itemId: 'bar', quantity: 1, cost: -10 }),
    event('event_started', { eventId: 'invented' }), event('event_started', { eventId: 'npc:wu:' }), event('event_started', { eventId: 'scene:gate:extra' }), event('run_ended', { ending: 'invented' }),
    event('run_ended', { ending: 'dead', cause: 'invented' }), event('run_ended', { ending: 'retreat', cause: 'fall' }),
    event('run_ended', { ending: 'dead', death: false }), event('run_started', { fresh: false }),
    { ...event('run_started'), id: "'; DROP TABLE telemetry_events;--" },
  ];
  for (const bad of badEvents) {
    const response = await handleTelemetry({ request: post('telemetry', { visitorId: visitor, events: [event('run_started'), bad] }), env: { DB } });
    assert.equal(response.status, 400, JSON.stringify(bad));
  }
  assert.equal(totals(DB).telemetry_events, 0);
  for (const payload of [{ visitorId: visitor, events: [] }, { visitorId: visitor, events: Array.from({ length: 26 }, () => event('run_checkpoint')) }, { visitorId: visitor, events: [event('run_started')], ip: '1.1.1.1' }]) {
    assert.equal((await handleTelemetry({ request: post('telemetry', payload), env: { DB } })).status, 400);
  }
});

test('question ids, canonical option suffixes and known source/option sets are enforced', async () => {
  const DB = database(), base = { visitorId: visitorId(), runId: 'run_00000001', ...question, optionId: 'check' };
  const bad = [
    { questionId: 'event:invented:check|leave' }, { questionId: 'event:old_tent:leave|check' },
    { questionId: 'event:old_tent:check|other', optionIds: ['check', 'other'] },
    { optionIds: ['check', 'check'] }, { optionId: 'missing' }, { optionIds: ['check'] },
    { questionId: 'event:old_tent:检查|leave' }, { questionId: 'x'.repeat(161) }, { visitorId: 'short' },
  ];
  for (const value of bad) assert.equal((await handleChoices({ request: post('choices', { ...base, ...value }), env: { DB } })).status, 400);
  assert.throws(() => validateQuestion('scene:gate:go|home', ['home', 'go', 'go']));
  assert.deepEqual(validateQuestion('scene:gate:go|home', ['home', 'go']).optionIds, ['go', 'home']);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM choice_votes').get().n, 0);
});

test('same-origin, JSON and streaming payload limits are applied before database access', async () => {
  const env = { DB: database() }, payload = { visitorId: visitorId(), events: [event('run_started')] };
  assert.equal((await handleTelemetry({ request: post('telemetry', payload, { Origin: 'https://evil.example' }), env })).status, 403);
  assert.equal((await handleTelemetry({ request: post('telemetry', payload, { 'Sec-Fetch-Site': 'cross-site' }), env })).status, 403);
  const missing = post('telemetry', payload); missing.headers.delete('Origin');
  assert.equal((await handleTelemetry({ request: missing, env })).status, 403);
  assert.equal((await handleTelemetry({ request: post('telemetry', payload, { 'Content-Type': 'text/plain' }), env })).status, 415);
  const large = post('telemetry', { visitorId: visitorId(), events: [], padding: 'x'.repeat(MAX_BODY_BYTES) });
  assert.equal((await handleTelemetry({ request: large, env })).status, 413);
  const announced = post('telemetry', payload, { 'Content-Length': String(MAX_BODY_BYTES + 1) });
  assert.equal((await handleTelemetry({ request: announced, env })).status, 413);
  const malformed = new Request(`${origin}/api/telemetry`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{' });
  assert.equal((await handleTelemetry({ request: malformed, env })).status, 400);
  assert.equal((await handleTelemetry({ request: new Request(`${origin}/api/telemetry`), env })).status, 405);
});

test('unavailable DB and optional Cloudflare rate limit fail softly with explicit status', async () => {
  const payload = { visitorId: visitorId(), events: [event('run_started')] };
  assert.equal((await handleTelemetry({ request: post('telemetry', payload), env: {} })).status, 503);
  assert.equal((await handleTelemetry({ request: post('telemetry', payload), env: { DB: database(), ANALYTICS_RATE_LIMIT: { limit: async () => ({ success: false }) } } })).status, 429);
});

test('explicit system story scenes accept only their known option ids', async () => {
  const DB = database(), visitor = visitorId();
  const scenes = {
    camp_snow: ['clear', 'ignore'], tent_collapse: ['fix', 'hold'],
    cold_wake: ['cook', 'drink', 'eat', 'warmer', 'insul', 'move', 'sleep', 'up'],
    ending_report: ['report', 'leave'], ending_family: ['reply', 'later'],
  };
  for (const [scene, options] of Object.entries(scenes)) {
    const questionId = `scene:${scene}:${[...options].sort().join('|')}`;
    const response = await handleChoices({ request: post('choices', { visitorId: visitor, runId: 'run_00000001', questionId, optionIds: options, optionId: options[0] }), env: { DB } });
    assert.equal(response.status, 200, scene);
    assert.equal((await response.json()).total, 1);
    assert.equal((await handleTelemetry({ request: post('telemetry', { visitorId: visitor, events: [event('event_started', { eventId: `scene:${scene}` })] }), env: { DB } })).status, 200, scene);
  }
});

test('server catalogue covers actual event/NPC/item ids without copying private payload fields', () => {
  assert.deepEqual([...EVENT_IDS].sort(), [...EVENTS, ...EXPANDED_EVENTS, ...REPORTED_EVENTS].map((e) => e.id).sort());
  assert.deepEqual([...NPC_IDS].sort(), NPCS.map((e) => e.id).sort());
  assert.deepEqual(ITEM_CATEGORIES, Object.fromEntries(Object.entries(ITEMS).map(([id, item]) => [id, item.cat])));
});

test('SQL batch transaction rolls back aggregate side effects together with raw rows', async () => {
  const DB = database();
  await assert.rejects(DB.batch([
    DB.prepare('INSERT INTO analytics_visitors (visitor_id,created_at) VALUES (?,?)').bind(visitorId(), 1),
    DB.prepare('INSERT INTO no_such_table (id) VALUES (?)').bind('bad'),
  ]));
  assert.equal(totals(DB).players, 0);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM analytics_visitors').get().n, 0);
});
