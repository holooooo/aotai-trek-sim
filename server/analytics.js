import { ROLES, DIFFICULTIES, ENDINGS, CAUSES, ITEM_CATEGORIES, QUESTION_OPTIONS, validEventId } from './analytics-catalog.js';

export const MAX_BODY_BYTES = 32 * 1024;
const TYPES = new Set(['run_started', 'run_resumed', 'run_checkpoint', 'shop_buy', 'shop_refund', 'event_started', 'event_completed', 'run_ended']);
const ID = /^[A-Za-z0-9_-]{8,96}$/;
const OPTION = /^[A-Za-z0-9_-]{1,32}$/;
const COMMON = ['id', 'runId', 'type', 'at', 'role', 'difficulty', 'activeSeconds'];
const EXTRA = {
  run_started: ['fresh'], run_resumed: ['fresh'], run_checkpoint: [],
  shop_buy: ['itemId', 'quantity', 'cost'], shop_refund: ['itemId', 'quantity', 'cost'],
  event_started: ['eventId'], event_completed: ['eventId'], run_ended: ['ending', 'cause', 'death'],
};
const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const own = (v, key) => Object.prototype.hasOwnProperty.call(v, key);
class ApiError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
const invalid = (code = 'invalid_request') => { throw new ApiError(400, code); };
function keys(value, allowed) {
  if (!isObject(value) || Object.keys(value).some((key) => !allowed.includes(key))) invalid('unknown_fields');
}
function identifier(value) { if (typeof value !== 'string' || !ID.test(value)) invalid('invalid_identifier'); return value; }
function member(value, set, code) { if (!set.has(value)) invalid(code); return value; }
function number(value, min, max, integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || integer && !Number.isSafeInteger(value)) invalid('invalid_number');
  return value;
}

export function validateTelemetry(body) {
  keys(body, ['visitorId', 'events']);
  const visitorId = identifier(body.visitorId);
  if (!Array.isArray(body.events) || body.events.length < 1 || body.events.length > 25) invalid('invalid_batch');
  const events = body.events.map((input) => {
    if (!isObject(input) || !TYPES.has(input.type)) invalid('invalid_event_type');
    keys(input, [...COMMON, ...EXTRA[input.type]]);
    const e = { id: identifier(input.id), runId: identifier(input.runId), type: input.type, at: number(input.at, 0, 4102444800000, true) };
    if (own(input, 'role')) e.role = member(input.role, ROLES, 'invalid_role');
    if (own(input, 'difficulty')) e.difficulty = member(input.difficulty, DIFFICULTIES, 'invalid_difficulty');
    if (own(input, 'activeSeconds')) e.activeSeconds = number(input.activeSeconds, 0, 604800);
    if (own(input, 'fresh')) {
      if (typeof input.fresh !== 'boolean' || input.fresh !== (e.type === 'run_started')) invalid('invalid_fresh');
      e.fresh = input.fresh;
    }
    if (e.type.startsWith('shop_')) {
      if (typeof input.itemId !== 'string' || !own(ITEM_CATEGORIES, input.itemId)) invalid('invalid_item');
      e.itemId = input.itemId; e.quantity = number(input.quantity, 1, 100, true); e.cost = number(input.cost, 0, 1000000);
      e.itemCategory = ITEM_CATEGORIES[e.itemId];
    }
    if (e.type.startsWith('event_')) {
      if (!validEventId(input.eventId)) invalid('invalid_source');
      e.eventId = input.eventId;
    }
    if (e.type === 'run_ended') {
      e.ending = member(input.ending, ENDINGS, 'invalid_ending');
      if (e.ending === 'dead') e.cause = own(input, 'cause') ? member(input.cause, CAUSES, 'invalid_cause') : 'hypothermia';
      else if (own(input, 'cause') && input.cause !== null) invalid('unexpected_cause');
      if (own(input, 'death') && (typeof input.death !== 'boolean' || input.death !== (e.ending === 'dead'))) invalid('invalid_death');
      e.death = e.ending === 'dead';
    }
    return e;
  });
  return { visitorId, events };
}

export function validateQuestion(questionId, optionIds) {
  if (typeof questionId !== 'string' || questionId.length > 160 || !/^[A-Za-z0-9_:|\-]+$/.test(questionId)) invalid('invalid_question');
  if (!Array.isArray(optionIds) || optionIds.length < 2 || optionIds.length > 8 || optionIds.some((id) => typeof id !== 'string' || !OPTION.test(id))) invalid('invalid_options');
  const sorted = [...optionIds].sort();
  if (new Set(sorted).size !== sorted.length) invalid('duplicate_options');
  const pieces = questionId.split(':');
  if (pieces.length !== 3) invalid('invalid_question');
  const source = `${pieces[0]}:${pieces[1]}`;
  const allowed = QUESTION_OPTIONS.get(source);
  if (!allowed || sorted.some((id) => !allowed.has(id))) invalid('unknown_question_source_or_option');
  if (questionId !== `${source}:${sorted.join('|')}`) invalid('noncanonical_question');
  return { questionId, optionIds: sorted };
}

export function validateChoice(body) {
  keys(body, ['visitorId', 'runId', 'questionId', 'optionId', 'optionIds']);
  const visitorId = identifier(body.visitorId), runId = identifier(body.runId);
  const question = validateQuestion(body.questionId, body.optionIds);
  if (!question.optionIds.includes(body.optionId)) invalid('invalid_option');
  return { visitorId, runId, ...question, optionId: body.optionId };
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Vary': 'Origin',
  } });
}
function checkOrigin(request, writing) {
  const origin = request.headers.get('Origin');
  const site = request.headers.get('Sec-Fetch-Site');
  if (site === 'cross-site' || origin && origin !== new URL(request.url).origin || writing && !origin) throw new ApiError(403, 'same_origin_required');
}
async function readJson(request) {
  const length = request.headers.get('Content-Length');
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) throw new ApiError(413, 'body_too_large');
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type') || '')) throw new ApiError(415, 'json_required');
  if (!request.body) invalid('missing_body');
  const reader = request.body.getReader();
  const chunks = []; let bytes = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_BODY_BYTES) { await reader.cancel(); throw new ApiError(413, 'body_too_large'); }
    chunks.push(value);
  }
  const data = new Uint8Array(bytes); let at = 0;
  for (const chunk of chunks) { data.set(chunk, at); at += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)); }
  catch { invalid('invalid_json'); }
}

// Optional Cloudflare rate-limit binding; bounded isolate-local fallback is deliberately modest.
// No IP/UA is read or stored. A self-issued visitorId is not an authenticated identity.
const windows = new Map();
async function rateLimit(env, visitorId) {
  if (env.ANALYTICS_RATE_LIMIT?.limit) {
    const result = await env.ANALYTICS_RATE_LIMIT.limit({ key: visitorId });
    if (!result.success) throw new ApiError(429, 'rate_limited');
    return;
  }
  const now = Date.now(), old = windows.get(visitorId);
  const window = old && now - old.at < 60000 ? old : { at: now, count: 0 };
  if (window.count >= 120) throw new ApiError(429, 'rate_limited');
  window.count++;
  if (windows.size >= 2048 && !windows.has(visitorId)) windows.delete(windows.keys().next().value);
  windows.set(visitorId, window);
}
function database(env) {
  if (!env.DB?.prepare || !env.DB?.batch) throw new ApiError(503, 'analytics_unavailable');
  return env.DB;
}
const INSERT_EVENT = `INSERT OR IGNORE INTO telemetry_events
  (id,visitor_id,run_id,type,at,received_at,role,difficulty,event_id,item_id,item_category,quantity,cost,ending,cause,active_seconds,death,fresh)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`;
function eventStatement(db, visitorId, e, now) {
  return db.prepare(INSERT_EVENT).bind(e.id, visitorId, e.runId, e.type, e.at, now,
    e.role ?? null, e.difficulty ?? null, e.eventId ?? null, e.itemId ?? null, e.itemCategory ?? null,
    e.quantity ?? null, e.cost ?? null, e.ending ?? null, e.cause ?? null, e.activeSeconds ?? null,
    e.death == null ? null : Number(e.death), e.fresh == null ? null : Number(e.fresh));
}

export async function handleTelemetry({ request, env }) {
  try {
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    checkOrigin(request, true);
    const data = validateTelemetry(await readJson(request));
    await rateLimit(env, data.visitorId);
    const db = database(env), now = Date.now();
    const results = await db.batch(data.events.map((e) => eventStatement(db, data.visitorId, e, now)));
    const accepted = results.reduce((sum, result) => sum + (result.results?.length || 0), 0);
    return json({ accepted, duplicates: data.events.length - accepted });
  } catch (error) {
    return json({ error: error instanceof ApiError ? error.code : 'analytics_unavailable' }, error instanceof ApiError ? error.status : 503);
  }
}

function summary(question, rows) {
  const counts = Object.fromEntries(question.optionIds.map((id) => [id, 0]));
  for (const row of rows || []) if (own(counts, row.option_id)) counts[row.option_id] = Number(row.total) || 0;
  return { questionId: question.questionId, total: Object.values(counts).reduce((a, b) => a + b, 0), counts };
}

export async function handleChoices({ request, env }) {
  try {
    if (!['GET', 'POST'].includes(request.method)) return json({ error: 'method_not_allowed' }, 405);
    checkOrigin(request, request.method === 'POST');
    if (request.method === 'GET') {
      const params = new URL(request.url).searchParams;
      if ([...params.keys()].some((key) => !['questionId', 'optionIds'].includes(key)) || params.getAll('questionId').length !== 1 || params.getAll('optionIds').length !== 1) invalid('invalid_query');
      const question = validateQuestion(params.get('questionId'), (params.get('optionIds') || '').split(','));
      const db = database(env);
      const result = await db.prepare('SELECT option_id,total FROM choice_counts WHERE question_id=?').bind(question.questionId).all();
      return json(summary(question, result.results));
    }
    const data = validateChoice(await readJson(request));
    await rateLimit(env, data.visitorId);
    const db = database(env);
    const results = await db.batch([
      db.prepare('INSERT OR IGNORE INTO choice_questions (question_id,option_ids) VALUES (?,?)').bind(data.questionId, JSON.stringify(data.optionIds)),
      db.prepare('INSERT OR IGNORE INTO choice_votes (visitor_id,run_id,question_id,option_id,received_at) VALUES (?,?,?,?,?) RETURNING option_id').bind(data.visitorId, data.runId, data.questionId, data.optionId, Date.now()),
      db.prepare('SELECT option_id,total FROM choice_counts WHERE question_id=?').bind(data.questionId),
      db.prepare('SELECT option_id FROM choice_votes WHERE visitor_id=? AND run_id=? AND question_id=?').bind(data.visitorId, data.runId, data.questionId),
    ]);
    const recorded = !!results[1].results?.length;
    const previousOptionId = results[3].results?.[0]?.option_id;
    return json({ ...summary(data, results[2].results), recorded, ...(previousOptionId ? { previousOptionId } : {}) });
  } catch (error) {
    return json({ error: error instanceof ApiError ? error.code : 'analytics_unavailable' }, error instanceof ApiError ? error.status : 503);
  }
}
