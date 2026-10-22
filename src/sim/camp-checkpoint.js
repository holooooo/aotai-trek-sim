// 篝火式回溯：随本局主存档保存，快照不含自身或遥测，避免递归和跨局串档。
import { roleById } from '../data/roles.js';
import { DIFFICULTIES } from './difficulty.js';
import { branches } from '../world/terrain.js';
import { WEATHER } from './weather.js';
import { npcById } from '../data/npcs.js';

const difficulties = new Set(DIFFICULTIES.map(({ id }) => id));
const paths = new Set(['main', ...Object.keys(branches)]);
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const clone = value => JSON.parse(JSON.stringify(value));
const nonnegative = value => finite(value) && value >= 0;

function validState(st) {
  if (!object(st) || st.v !== 1 || !roleById(st.role) || !difficulties.has(st.difficulty) || !paths.has(st.path)) return false;
  if (!finite(st.seed) || !nonnegative(st.time) || !nonnegative(st.s) || !nonnegative(st.maxS) || ![-1, 1].includes(st.dir)) return false;
  if (!object(st.pos) || !finite(st.pos.x) || !finite(st.pos.z) || st.camp !== null || st.ending !== null) return false;
  if (!object(st.story) || st.story.pendingEvent || st.story.pendingNpc) return false;
  if (!object(st.body) || !['core', 'health', 'stamina', 'food', 'water', 'stress', 'wet', 'frostbite', 'sprain', 'fracture', 'snowblind', 'altSick', 'shiver', 'sweating'].every(key => finite(st.body[key]))) return false;
  if (st.body.core < 28 || st.body.health <= 0) return false;
  if (!['inv', 'water', 'thermos', 'gas', 'bat', 'npcs', 'flags', 'warned', 'visited', 'stats'].every(key => object(st[key]))) return false;
  if (!Object.values(st.inv).every(nonnegative) || !Object.values(st.bat).every(nonnegative)) return false;
  if (!['liquid', 'frozen'].every(key => nonnegative(st.water[key])) || !nonnegative(st.thermos.l) || !finite(st.thermos.temp)) return false;
  if (!['normal', 'alpine'].every(key => nonnegative(st.gas[key]))) return false;
  if (!['minCore', 'maxAlt', 'walked', 'startedAt', 'coldestFelt', 'nights'].every(key => finite(st.stats[key]))) return false;
  if (!Array.isArray(st.companions) || !Array.isArray(st.log) || !Array.isArray(st.schedule) || !st.schedule.length) return false;
  if (!st.companions.every(id => npcById(id) && object(st.npcs[id]))) return false;
  if (!Object.entries(st.npcs).every(([id, ns]) => npcById(id) && object(ns) && (!ns.spawned || ns.dead || ns.removed || finite(ns.x) && finite(ns.z)))) return false;
  if (st.rescue != null && (!object(st.rescue) || !Array.isArray(st.rescue.npcs) || !st.rescue.npcs.every(id => !!npcById(id)) || !['x', 'z', 'eta'].every(key => finite(st.rescue[key])))) return false;
  return st.schedule.every(entry => object(entry) && finite(entry.t) && Object.hasOwn(WEATHER, entry.w));
}

export function validCampCheckpoint(checkpoint, owner) {
  if (!object(checkpoint) || checkpoint.v !== 1 || typeof checkpoint.place !== 'string' || checkpoint.place.length > 120) return false;
  const snapshot = checkpoint.state;
  if (!validState(snapshot) || Object.hasOwn(snapshot, 'campCheckpoint') || Object.hasOwn(snapshot, 'telemetry')) return false;
  return !owner || snapshot.seed === owner.seed && snapshot.role === owner.role && snapshot.difficulty === owner.difficulty;
}

export function ensureCampCheckpoint(st) {
  if (!validCampCheckpoint(st.campCheckpoint, st)) st.campCheckpoint = null;
  return st.campCheckpoint;
}

export function createCampCheckpoint(st, place) {
  if (!validState(st)) return null;
  // Exclude before cloning: snapshot size stays constant after repeated camping.
  const { campCheckpoint, telemetry, ...gameplay } = st;
  const checkpoint = { v: 1, place: String(place || '营地').slice(0, 120), state: clone(gameplay) };
  return validCampCheckpoint(checkpoint, st) ? checkpoint : null;
}

export function restoreCampCheckpoint(st) {
  if (!validCampCheckpoint(st.campCheckpoint, st)) return null;
  const restored = clone(st.campCheckpoint.state);
  // A bonfire can be retried until a later successful pack replaces it.
  restored.campCheckpoint = clone(st.campCheckpoint);
  // It is a retry of this run, not an ending. Never roll telemetry back with gameplay.
  if (st.telemetry) restored.telemetry = clone(st.telemetry);
  return restored;
}
