// A JSON encounter plan is created once, never by a condition checked every frame.
// This module intentionally imports no NPC/event definitions or world objects.
const KM_PER_UNIT = 0.04;
const REPAIR_IDS = new Set(['headlamp_contact', 'windproof_lash']);
const CRITICAL_IDS = new Set(['hallucination', 'undress', 'emergency_bivouac', 'rescue_update', 'rescue_followup']);
const CORE_RANDOM_IDS = new Set(['old_tent', 'blogger_shot', 'signal']);
const object = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

// Independent draws per id keep a reordered catalogue from changing the same seed.
function draw(seed, key) {
  const text = `${String(seed ?? 0)}:${key}`;
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  hash ^= hash >>> 16; hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15; hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 4294967296;
}
const chance = (def, fallback) => Number.isFinite(def.encounterChance) ? Math.max(0, Math.min(1, def.encounterChance)) : fallback;
function windowPoint(seed, kind, def) {
  if (!Number.isFinite(def.fromKm) || !Number.isFinite(def.toKm) || def.toKm < def.fromKm) return null;
  // Leave a trailing part of the original window so a low-frame-rate step can still spawn it.
  return def.fromKm + (def.toKm - def.fromKm) * (0.1 + 0.7 * draw(seed, `${kind}:${def.id}:position`));
}
function protectedEvent(def) {
  return !!(def.urgent || def.repair || def.followup || def.priority >= 80 || CRITICAL_IDS.has(def.id) || REPAIR_IDS.has(def.id));
}
function sampledEvent(def) {
  return !protectedEvent(def) && !!(def.randomEncounter || def.ambient || CORE_RANDOM_IDS.has(def.id));
}
const appeared = (state) => object(state) && !!(state.spawned || state.met || state.following || state.passed || state.done || state.dead || state.removed || state.fate);

/**
 * Call with {fresh:true} once for a new run; an old save with no plan becomes legacy.
 * Return the same existing JSON plan even if fresh is accidentally repeated or defs change.
 * plan.npcs[id] = {selected,atKm}; plan.events[id] = {selected,atKm?}.
 * The player's existing NPC/resource/story state is never reset or reconstructed here.
 */
export function ensureEncounters(st, npcDefs = [], eventDefs = [], { fresh = false } = {}) {
  if (!object(st)) return null;
  if (!object(st.story)) st.story = {};
  if (object(st.story.encounters)) return st.story.encounters;
  const plan = { v: 1, mode: fresh ? 'seeded' : 'legacy', npcs: {}, events: {} };
  st.story.encounters = plan;
  if (!fresh) return plan;
  for (const def of npcDefs) {
    if (!def?.id) continue;
    plan.npcs[def.id] = {
      selected: appeared(st.npcs?.[def.id]) || draw(st.seed, `npc:${def.id}:selected`) < chance(def, def.id === 'speedteam' ? 0.62 : 0.7),
      atKm: windowPoint(st.seed, 'npc', def),
    };
  }
  // The later straggler belongs to the earlier group, rather than being an unrelated clone.
  if (plan.npcs.straggler && !appeared(st.npcs?.straggler) && !plan.npcs.speedteam?.selected) plan.npcs.straggler.selected = false;
  for (const def of eventDefs) {
    if (!def?.id) continue;
    const random = sampledEvent(def);
    const entry = { selected: !random || draw(st.seed, `event:${def.id}:selected`) < chance(def, 0.64) };
    const atKm = windowPoint(st.seed, 'event', def);
    if (random && atKm != null) entry.atKm = atKm;
    plan.events[def.id] = entry;
  }
  return plan;
}

function withinWindow(st, def, entry) {
  if (def.path && st.path !== def.path) return false;
  if (Number.isFinite(entry?.atKm)) {
    const km = Number(st.s) * KM_PER_UNIT;
    if (!Number.isFinite(km) || km < entry.atKm) return false;
    if (Number.isFinite(def.toKm) && km > def.toKm) return false;
  }
  return true;
}

/** True means eligible for the caller's existing requires/condition/spawn checks. */
export function npcEncounterAllowed(st, def) {
  if (!def?.id || !object(st)) return false;
  if (appeared(st.npcs?.[def.id])) return true;
  const plan = st.story?.encounters;
  if (plan?.mode !== 'seeded') return true;
  const entry = plan.npcs?.[def.id];
  // New definitions added after this save are not retroactively drawn into a different plan.
  if (!entry) return true;
  if (!entry.selected) return false;
  if (def.id === 'straggler' && !plan.npcs?.speedteam?.selected && !appeared(st.npcs?.speedteam)) return false;
  return withinWindow(st, def, entry);
}

/** Filtering precedes normal condition/pacing checks; pending/critical/repair nodes always survive. */
export function eventEncounterAllowed(st, def) {
  if (!def?.id || !object(st)) return false;
  if (st.story?.pendingEvent === def.id || protectedEvent(def) || st.flags?.[`ev_${def.id}`] !== undefined) return true;
  const plan = st.story?.encounters;
  if (plan?.mode !== 'seeded') return true;
  const entry = plan.events?.[def.id];
  return !entry || !!entry.selected && withinWindow(st, def, entry);
}
