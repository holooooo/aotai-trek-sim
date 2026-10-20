import test from 'node:test';
import assert from 'node:assert/strict';
import { AnalyticsClient, ANALYTICS_STORAGE_KEYS } from '../src/analytics/client.js';
import { validateTelemetry } from '../server/analytics.js';

class MemoryStorage {
  constructor(entries = {}) { this.data = new Map(Object.entries(entries)); }
  getItem(key) { return this.data.has(key) ? this.data.get(key) : null; }
  setItem(key, value) { this.data.set(key, String(value)); }
  removeItem(key) { this.data.delete(key); }
}

const state = (overrides = {}) => ({ role: 'runner', difficulty: 'normal', ...overrides });
const response = (body, status = 200) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const flushTimers = () => new Promise((resolve) => setImmediate(resolve));
const question = { questionId: 'event:old_tent:check|leave', optionIds: ['check', 'leave'] };

function enabledClient(fetcher, options = {}) {
  const storage = options.storage || new MemoryStorage();
  const client = new AnalyticsClient({ storage, fetcher, now: options.now || (() => 1700000000000), timeoutMs: options.timeoutMs || 20, ...options });
  client.setEnabled(true);
  return { client, storage };
}

test('默认关闭，不生成visitor、不入队且track无副作用', () => {
  const storage = new MemoryStorage();
  const calls = [];
  const client = new AnalyticsClient({ storage, fetcher: (...args) => { calls.push(args); } });
  const st = state();
  assert.equal(client.enabled, false);
  assert.equal(client.track('shop_buy', st, { itemId: 'water', quantity: 1, cost: 2 }), null);
  assert.equal(client.beginRun(st, { fresh: true }), null);
  assert.equal(st.telemetry, undefined);
  assert.equal(client.flush() instanceof Promise, true);
  assert.equal(storage.getItem(ANALYTICS_STORAGE_KEYS.VISITOR_KEY), null);
  assert.equal(calls.length, 0);
});

test('启用后匿名visitor持久化，关闭清理visitor和有限队列', () => {
  const { client, storage } = enabledClient(async () => response({ accepted: 0 }));
  assert.equal(client.enabled, true);
  const visitor = storage.getItem(ANALYTICS_STORAGE_KEYS.VISITOR_KEY);
  assert.match(visitor, /^[A-Za-z0-9_-]{8,96}$/);
  const st = state();
  client.beginRun(st, { fresh: true });
  client.track('event_started', st, { eventId: 'old_tent', coordinates: { x: 1, y: 2 }, text: 'secret' });
  assert.ok(JSON.parse(storage.getItem(ANALYTICS_STORAGE_KEYS.QUEUE_KEY)).length > 0);
  client.setEnabled(false);
  assert.equal(client.enabled, false);
  assert.equal(storage.getItem(ANALYTICS_STORAGE_KEYS.CONSENT_KEY), null);
  assert.equal(storage.getItem(ANALYTICS_STORAGE_KEYS.VISITOR_KEY), null);
  assert.equal(storage.getItem(ANALYTICS_STORAGE_KEYS.QUEUE_KEY), null);
});

test('shop在beginRun前建立draft run，fresh启动保留同一runId且只产生一次run_started', () => {
  const { client } = enabledClient(async () => response({ accepted: 0 }));
  const st = state();
  const purchase = client.track('shop_buy', st, { itemId: 'water', quantity: 2, cost: 20 });
  assert.ok(purchase);
  const draftId = st.telemetry.runId;
  assert.equal(st.telemetry.startedTracked, false);
  client.beginRun(st, { fresh: true });
  assert.equal(st.telemetry.runId, draftId);
  const queue = client.queue;
  assert.equal(queue.filter((event) => event.type === 'run_started').length, 1);
});

test('fresh开始新run，续档保留runId并记录resume，不重复started/ended', () => {
  const { client } = enabledClient(async () => response({ accepted: 0 }));
  const st = state();
  const first = client.beginRun(st, { fresh: true });
  client.track('run_ended', st, { ending: 'dead', cause: 'fall', death: false });
  assert.equal(client.track('run_ended', st, { ending: 'cross' }), null);
  const second = client.beginRun(st, { fresh: true });
  assert.notEqual(second, first);
  const resumed = { ...st, telemetry: { runId: first, activeSeconds: 4, startedTracked: true, endedTracked: false } };
  client.beginRun(resumed, { fresh: false });
  assert.equal(resumed.telemetry.runId, first);
  assert.equal(client.queue.filter((event) => event.type === 'run_started').length, 2);
  assert.equal(client.queue.filter((event) => event.type === 'run_resumed').length, 1);
});

test('事件可选uniqueKey去重，tick每120秒checkpoint且主动时间有界累计', () => {
  const { client } = enabledClient(async () => response({ accepted: 0 }));
  const st = state();
  client.beginRun(st, { fresh: true });
  client.track('event_started', st, { eventId: 'old_tent', uniqueKey: 'event:old_tent:1' });
  client.track('event_started', st, { eventId: 'old_tent', uniqueKey: 'event:old_tent:1' });
  client.tick(st, 119);
  client.tick(st, 3);
  client.tick(st, 240);
  assert.equal(st.telemetry.activeSeconds, 362);
  assert.equal(client.queue.filter((event) => event.type === 'event_started').length, 1);
  assert.equal(client.queue.filter((event) => event.type === 'run_checkpoint').length, 3);
});

test('telemetry只发送字段白名单，dead使用主结局、cause和death=true', async () => {
  const requests = [];
  const { client } = enabledClient(async (url, options) => { requests.push({ url, options }); return response({ accepted: 10 }); });
  const st = state();
  client.beginRun(st, { fresh: true });
  client.track('run_ended', st, { ending: 'dead', cause: 'fall', death: false, coordinates: { x: 4 }, narrative: 'do not send' });
  const sent = JSON.parse((await client.flush()).sent ? requests[0].options.body : '{}');
  const ending = sent.events.find((event) => event.type === 'run_ended');
  assert.equal(ending.ending, 'dead');
  assert.equal(ending.cause, 'fall');
  assert.equal(ending.death, true);
  assert.equal('coordinates' in ending, false);
  assert.equal('narrative' in ending, false);
  for (const event of sent.events) assert.deepEqual(Object.keys(event).filter((key) => !['id', 'runId', 'type', 'at', 'role', 'difficulty', 'activeSeconds', 'fresh', 'eventId', 'itemId', 'quantity', 'cost', 'ending', 'cause', 'death'].includes(key)), []);
});

test('flush单flight，2xx移除；500和网络失败保留并可重试', async () => {
  let calls = 0;
  const { client } = enabledClient(async () => { calls++; return response({ error: 'retry' }, calls === 1 ? 500 : 204); });
  const st = state();
  client.beginRun(st, { fresh: true });
  const first = client.flush();
  assert.equal(first, client.flush());
  await first;
  assert.equal(client.queue.length, 1);
  await client.flush();
  assert.equal(client.queue.length, 0);
  assert.equal(calls, 2);
});

test('timeout、fetcher抛错和无localStorage都不抛异常', async () => {
  const timeoutClient = new AnalyticsClient({ storage: new MemoryStorage(), fetcher: () => new Promise(() => {}), timeoutMs: 5 });
  timeoutClient.setEnabled(true);
  const st = state(); timeoutClient.beginRun(st, { fresh: true });
  await assert.doesNotReject(timeoutClient.flush());
  const noStorage = new AnalyticsClient({ storage: null, fetcher: () => { throw new Error('offline'); } });
  assert.doesNotThrow(() => noStorage.setEnabled(true));
  assert.doesNotThrow(() => noStorage.track('event_started', state(), { eventId: 'old_tent' }));
  await assert.doesNotReject(noStorage.choose(null, question, 'check'));
});

test('同意时choice为POST，无同意时choice只发GET且结果校验不过不阻塞玩法', async () => {
  const requests = [];
  const fetcher = async (url, options) => {
    requests.push({ url, options });
    return response({ questionId: question.questionId, total: 3, counts: { check: 2, leave: 1 }, unexpected: 9 });
  };
  const disabled = new AnalyticsClient({ storage: new MemoryStorage(), fetcher });
  const readOnly = await disabled.choose(null, question, 'check');
  assert.equal(readOnly, null);
  assert.equal(requests[0].options.method, 'GET');
  assert.match(requests[0].url, /questionId=event%3Aold_tent%3Acheck%7Cleave/);
  const { client } = enabledClient(fetcher);
  const st = state(); client.beginRun(st, { fresh: true });
  const submitted = await client.choose(st, question, 'check');
  assert.equal(submitted, null, 'unexpected result fields must be rejected');
  assert.equal(requests.at(-1).options.method, 'POST');
  const body = JSON.parse(requests.at(-1).options.body);
  assert.equal(body.optionId, 'check');
  assert.equal(body.questionId, question.questionId);
  assert.deepEqual(body.optionIds, ['check', 'leave']);
});

test('choice响应body挂起时在超时内返回null而不阻塞玩法', async () => {
  const client = new AnalyticsClient({ storage: new MemoryStorage(), timeoutMs: 5, fetcher: async () => ({ status: 200, ok: true, json: () => new Promise(() => {}) }) });
  const started = Date.now();
  const result = await client.choose(null, question, 'check');
  assert.equal(result, null);
  assert.ok(Date.now() - started < 500, 'body timeout should be bounded');
});


test('valid choice distribution returns counts and total only, without fabricated percentages', async () => {
  const fetcher = async () => response({ questionId: question.questionId, total: 3, counts: { check: 2, leave: 1 } });
  const client = new AnalyticsClient({ storage: new MemoryStorage(), fetcher });
  const result = await client.choose(null, question, 'check');
  assert.deepEqual(result, { questionId: question.questionId, total: 3, counts: { check: 2, leave: 1 } });
  assert.equal('percent' in result, false);
});

test('生成的全部遥测事件通过服务端validateTelemetry，包括命名空间来源和死亡结局', () => {
  const { client, storage } = enabledClient(async () => response({ accepted: 0 }));
  const st = state();
  client.beginRun(st, { fresh: true });
  client.track('shop_buy', st, { itemId: 'water', quantity: 2, cost: 20, ignored: 'secret' });
  client.track('shop_refund', st, { itemId: 'water', quantity: 1, cost: 10 });
  client.track('event_started', st, { eventId: 'event:old_tent' });
  client.track('event_completed', st, { eventId: 'npc:chen' });
  client.track('event_completed', st, { eventId: 'scene:ending_report' });
  client.tick(st, 120);
  client.track('run_ended', st, { ending: 'dead', cause: 'fall', death: false });
  const validated = validateTelemetry({ visitorId: storage.getItem(ANALYTICS_STORAGE_KEYS.VISITOR_KEY), events: client.queue });
  assert.equal(validated.events.length, 8);
  assert.deepEqual(validated.events.filter((event) => event.type.startsWith('event_')).map((event) => event.eventId), ['event:old_tent', 'npc:chen', 'scene:ending_report']);
  const ended = validated.events.find((event) => event.type === 'run_ended');
  assert.equal(ended.ending, 'dead');
  assert.equal(ended.death, true);
  assert.equal(ended.cause, 'fall');
});

test('持久队列加载时裁剪未知字段并拒绝无效事件', () => {
  const visitorId = 'visitor_00000001';
  const event = { id: 'event_00000001', runId: 'run_00000001', type: 'run_checkpoint', at: 1700000000000, role: 'runner', activeSeconds: 120, coordinates: { x: 1 } };
  const storage = new MemoryStorage({
    [ANALYTICS_STORAGE_KEYS.CONSENT_KEY]: 'true',
    [ANALYTICS_STORAGE_KEYS.VISITOR_KEY]: visitorId,
    [ANALYTICS_STORAGE_KEYS.QUEUE_KEY]: JSON.stringify([event, { ...event, id: 'event_00000002', type: 'private_text', body: 'do not send' }]),
  });
  const requests = [];
  const client = new AnalyticsClient({ storage, fetcher: async (_url, options) => { requests.push(options); return response({ accepted: 1 }); } });
  assert.equal(client.queue.length, 1);
  assert.equal('coordinates' in client.queue[0], false);
  return client.flush().then(() => {
    const payload = JSON.parse(requests[0].body);
    assert.equal(payload.events.length, 1);
    assert.equal('coordinates' in payload.events[0], false);
    assert.equal(payload.events[0].type, 'run_checkpoint');
  });
});

test('遥测持久队列最多100条且单个请求最多25条', async () => {
  let body;
  const { client, storage } = enabledClient(async (_url, options) => { body = JSON.parse(options.body); return response({ accepted: body.events.length }); });
  const st = state(); client.beginRun(st, { fresh: true });
  for (let i = 0; i < 105; i++) client.track('event_completed', st, { eventId: 'old_tent', uniqueKey: `event-${i}` });
  assert.equal(client.queue.length, 100);
  assert.equal(JSON.parse(storage.getItem(ANALYTICS_STORAGE_KEYS.QUEUE_KEY)).length, 100);
  const result = await client.flush();
  assert.equal(body.events.length, 25);
  assert.equal(result.sent, 25);
  assert.equal(client.queue.length, 75);
});
