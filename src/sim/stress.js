// Game-scale mental strain. This changes stress only; rest here never heals an injury.
const finite = (n, fallback = 0) => Number.isFinite(n) ? n : fallback;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, finite(n, lo)));
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const ZERO = () => ({ gain: 0, relief: 0, shock: 0 });
const INJURY_COSTS = {
  fracture: [12, 10],
  sprain: [8],
  frostbite: [3, 4, 6, 7],
};
function injuryStages(body = {}) {
  return {
    fracture: body.fracture > 0.5 ? 2 : body.fracture > 0 ? 1 : 0,
    sprain: body.sprain > 0 ? 1 : 0,
    frostbite: [10, 30, 60, 85].filter((threshold) => finite(body.frostbite) >= threshold).length,
  };
}

/**
 * Call at Game.start, before new injuries can occur. Missing psychology belongs to
 * a legacy save: existing injuries become its baseline rather than a fresh shock.
 * Retains unrelated psychology fields and serializes entirely as JSON.
 */
export function ensurePsychology(st) {
  if (!object(st) || !object(st.body)) return null;
  const stages = injuryStages(st.body);
  if (!object(st.psychology)) st.psychology = {};
  const p = st.psychology;
  if (p.v !== 1 || !object(p.injuries)) { p.v = 1; p.injuries = { ...stages }; }
  for (const [id, stage] of Object.entries(stages)) {
    const stored = p.injuries[id];
    p.injuries[id] = Number.isInteger(stored) && stored >= 0 && stored <= INJURY_COSTS[id].length ? stored : stage;
  }
  return p;
}

/**
 * Advance game minutes; directly updates body.stress and persistent injury stages.
 * {gain,relief} are integrated ongoing points before the 0..100 cap; shock is a
 * separate, once-per-worsening impulse. Positive sources use role/nutrition gains;
 * acute injury shock uses the role gain only. A repeated call or reload cannot
 * reapply the same injury shock. Improvement records the new baseline, so a later
 * re-injury is a new event. No other body field, resource, clock or RNG is changed.
 */
export function stepStress(st, env = {}, act = {}, minutes, role = {}, nutrition = { stressGain: 1 }) {
  if (!object(st?.body) || !Number.isFinite(minutes) || minutes <= 0) return ZERO();
  const b = st.body, p = ensurePsychology(st), stages = injuryStages(b);
  const roleGain = clamp(finite(role.mods?.stressGain, 1), 0, 3);
  const nutritionGain = clamp(finite(nutrition?.stressGain, 1), 0, 3);
  let shock = 0;
  for (const [id, stage] of Object.entries(stages)) {
    for (let level = p.injuries[id]; level < stage; level++) shock += INJURY_COSTS[id][level];
    p.injuries[id] = stage;
  }
  shock *= roleGain;

  const core = finite(b.core, 37), health = finite(b.health, 100);
  const food = finite(b.food, 100), water = finite(b.water, 100), stamina = finite(b.stamina, 100);
  const severity = clamp(act.severity, 0, 1);
  const night = !!act.night;
  // Preserve the original body pressure sources, including the old fixed thresholds.
  let gainRate = (night ? 0.018 : 0) + severity * 0.05;
  if (act.lost) gainRate += 0.11;
  if (core < 35.5) gainRate += 0.05;
  if (health < 50) gainRate += 0.03;
  if (food < 20 || water < 20) gainRate += 0.02;
  if (act.alone) gainRate += 0.004;
  if (finite(b.altSick) > 40) gainRate += 0.01;

  // Pain and depleted reserves remain present after the initial shock has passed.
  gainRate += clamp(b.fracture, 0, 1) * 0.12;
  gainRate += clamp(b.sprain, 0, 1) * 0.04;
  gainRate += clamp(b.frostbite, 0, 100) * 0.00055;
  gainRate += clamp((25 - stamina) / 25, 0, 1) * 0.055;
  gainRate += clamp((20 - food) / 20, 0, 1) * 0.07;
  gainRate += clamp((20 - water) / 20, 0, 1) * 0.07;
  gainRate += clamp((35.5 - core) / 2, 0, 2) * 0.04;
  gainRate += clamp((50 - health) / 50, 0, 1) * 0.045;

  let reliefRate = 0;
  if (env.tentInfo && core > 36) reliefRate += 0.035;
  if (act.mode === 'rest' && !night) reliefRate += 0.015 * (role.id === 'runner' ? 0.4 : 1);
  if (act.companions > 0) reliefRate += 0.02;
  if (severity < 0.15 && !night) reliefRate += 0.012;
  if (act.signal && role.id === 'blogger' && !st.airplane) reliefRate += 0.02;

  // Warm, fed, hydrated sleep relieves strain per minute. Cold/hunger/thirst do
  // not unlock this benefit; their ongoing sources above keep being simulated.
  if (act.mode === 'sleep' && core >= 36 && food >= 25 && water >= 25 && health > 0) {
    reliefRate += 0.16 * clamp(finite(role.mods?.sleepRecovery, 1), 0, 3);
  }
  const gain = gainRate * roleGain * nutritionGain * minutes;
  const relief = reliefRate * minutes;
  b.stress = clamp(finite(b.stress) + gain + shock - relief, 0, 100);
  return { gain, relief, shock };
}
