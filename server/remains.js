import { ROLES, DIFFICULTIES, CAUSES } from './analytics-catalog.js';

export const MAX_BODY_BYTES = 2048;
export const REMAINS_CELL_SIZE = 64;
export const REMAINS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_REMAINS = 24;
const WORLD = 'aotai-winter-v1';
const PATHS = new Set(['main', 'hetaoping', 'qingfengxia', 'dudumen', 'diaoyutai']);
const REMAINS_CAUSES = new Set([...CAUSES].filter((cause) => cause !== 'exhaustion'));
const FIELDS = ['id', 'world', 'path', 'x', 'z', 'role', 'difficulty', 'cause', 'gameMinute', 'core', 'health', 'food', 'water', 'stress', 'altitude'];
const QUERY_FIELDS = ['world', 'path', 'cx', 'cz'];
const ID = /^[A-Za-z0-9_-]{8,96}$/;
class ApiError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
const invalid = (code = 'invalid_request') => { throw new ApiError(400, code); };
const member = (value, values, code) => { if (!values.has(value)) invalid(code); return value; };
function number(value, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) invalid('invalid_number');
  return value;
}
function coordinate(value) {
  number(value, -100000, 100000);
  if (Math.abs(value * 100 - Math.round(value * 100)) > 1e-7) invalid('invalid_coordinate_precision');
  return Math.round(value * 100) / 100;
}
function world(value) { if (value !== WORLD) invalid('invalid_world'); return value; }

export function validateRemains(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => !FIELDS.includes(key))) invalid('unknown_fields');
  if (typeof input.id !== 'string' || !ID.test(input.id)) invalid('invalid_identifier');
  return {
    id: input.id, world: world(input.world), path: member(input.path, PATHS, 'invalid_path'),
    x: coordinate(input.x), z: coordinate(input.z),
    role: member(input.role, ROLES, 'invalid_role'), difficulty: member(input.difficulty, DIFFICULTIES, 'invalid_difficulty'),
    cause: member(input.cause, REMAINS_CAUSES, 'invalid_cause'),
    gameMinute: number(input.gameMinute, 0, 1000000), core: number(input.core, 0, 45),
    health: number(input.health, 0, 100), food: number(input.food, 0, 100),
    water: number(input.water, 0, 100), stress: number(input.stress, 0, 100), altitude: number(input.altitude, -1000, 10000),
  };
}

export function validateNearbyQuery(params) {
  if ([...params.keys()].some((key) => !QUERY_FIELDS.includes(key)) || QUERY_FIELDS.some((key) => params.getAll(key).length !== 1)) invalid('invalid_query');
  const cell = (key) => {
    const raw = params.get(key);
    if (!/^-?(?:0|[1-9]\d{0,8})$/.test(raw)) invalid('invalid_cell');
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < -1000000000 || value > 1000000000) invalid('invalid_cell');
    return value;
  };
  return { world: world(params.get('world')), path: member(params.get('path'), PATHS, 'invalid_path'), cx: cell('cx'), cz: cell('cz') };
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', Vary: 'Origin', ...(status === 405 ? { Allow: 'GET, POST' } : {}),
  } });
}
function checkOrigin(request) {
  const origin = request.headers.get('Origin');
  if (request.headers.get('Sec-Fetch-Site') === 'cross-site' || origin && origin !== new URL(request.url).origin || request.method === 'POST' && !origin) throw new ApiError(403, 'same_origin_required');
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
  const data = new Uint8Array(bytes); let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)); }
  catch { invalid('invalid_json'); }
}
function database(env, writing = false) {
  if (!env?.DB?.prepare || writing && !env.DB.batch) throw new ApiError(503, 'remains_unavailable');
  return env.DB;
}
const INSERT = `INSERT OR IGNORE INTO remains
  (id,world,path,x,z,cell_x,cell_z,role,difficulty,cause,game_minute,core,health,food,water,stress,altitude,created_at,expires_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`;
const NEARBY = `SELECT id,world,path,x,z,role,difficulty,cause,game_minute AS gameMinute,core,health,food,water,stress,altitude,created_at AS createdAt
  FROM remains INDEXED BY remains_nearby
  WHERE world=? AND path=? AND cell_x IN (?,?,?) AND cell_z IN (?,?,?) AND expires_at>?
  ORDER BY ((x-?)*(x-?)+(z-?)*(z-?)) ASC, created_at DESC, id ASC LIMIT 24`;

export async function handleRemains({ request, env }) {
  try {
    if (!['GET', 'POST'].includes(request.method)) return json({ error: 'method_not_allowed' }, 405);
    checkOrigin(request);
    const params = new URL(request.url).searchParams;
    if (request.method === 'GET') {
      const query = validateNearbyQuery(params), now = Date.now();
      const db = database(env), x = (query.cx + 0.5) * REMAINS_CELL_SIZE, z = (query.cz + 0.5) * REMAINS_CELL_SIZE;
      const result = await db.prepare(NEARBY).bind(query.world, query.path,
        query.cx - 1, query.cx, query.cx + 1, query.cz - 1, query.cz, query.cz + 1, now, x, x, z, z).all();
      if (result.success === false || !Array.isArray(result.results)) throw new ApiError(503, 'remains_unavailable');
      const remains = result.results.slice(0, MAX_REMAINS).map((row) => {
        const data = Object.fromEntries(FIELDS.map((field) => [field, row[field]]));
        const createdAt = number(row.createdAt, now - REMAINS_TTL_MS + 1, now);
        if (!Number.isSafeInteger(createdAt)) throw new ApiError(503, 'remains_unavailable');
        return { ...validateRemains(data), createdAt };
      });
      return json({ remains });
    }
    if ([...params.keys()].length) invalid('invalid_query');
    const data = validateRemains(await readJson(request)), db = database(env, true), now = Date.now();
    const results = await db.batch([
      // Expiry cleanup is bounded and uses its own index, rather than scanning all markers.
      db.prepare('DELETE FROM remains WHERE id IN (SELECT id FROM remains WHERE expires_at<=? ORDER BY expires_at LIMIT 100)').bind(now),
      db.prepare(INSERT).bind(data.id, data.world, data.path, data.x, data.z,
        Math.floor(data.x / REMAINS_CELL_SIZE), Math.floor(data.z / REMAINS_CELL_SIZE),
        data.role, data.difficulty, data.cause, data.gameMinute, data.core, data.health, data.food, data.water, data.stress, data.altitude, now, now + REMAINS_TTL_MS),
    ]);
    if (results.some((result) => result.success === false) || !Array.isArray(results[1]?.results)) throw new ApiError(503, 'remains_unavailable');
    return json({ recorded: results[1].results.length > 0 });
  } catch (error) {
    return json({ error: error instanceof ApiError ? error.code : 'remains_unavailable' }, error instanceof ApiError ? error.status : 503);
  }
}
