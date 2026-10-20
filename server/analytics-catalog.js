// Stable server-side identifiers only; no player text or rendered dialogue reaches D1.
// Keep this catalogue in sync when adding a source or an option to the game.
export const ROLES = new Set(['student', 'veteran', 'blogger', 'runner', 'nurse', 'coder']);
export const DIFFICULTIES = new Set(['easy', 'normal', 'hardcore']);
export const ENDINGS = new Set(['sausage', 'sigma', 'retreat_wild', 'turnback', 'retreat', 'retreat_branch', 'rescued', 'cross', 'dayehai', 'dead']);
export const CAUSES = new Set(['hypothermia', 'fall', 'dehydration', 'starvation', 'injury', 'exhaustion']);
export const EVENT_IDS = new Set([
  'ridge_wind', 'navtower', 'plane', 'leigong', 'old_tent', 'blogger_shot', 'keepwarm_tip', 'sweat_tip', 'rest_cold_tip', 'water_frozen', 'hallucination', 'undress', 'takin', 'signal',
  'ridge_shelter', 'hot_water_share', 'family_callback', 'rescue_update', 'loose_marker', 'hand_warmth', 'windproof_lash', 'false_trail', 'headlamp_contact', 'fuel_check', 'emergency_bivouac', 'shared_load',
  'student_shortcut', 'veteran_confidence', 'blogger_honest_cut', 'runner_heat', 'nurse_triage', 'coder_overload', 'mutual_followup', 'family_followup', 'rescue_followup',
  'reported_solo_probe', 'reported_weather_turn', 'reported_last_seen',
]);
export const NPC_IDS = new Set(['speedteam', 'straggler', 'mou', 'wu', 'boy', 'chen', 'yu']);
export const SCENE_IDS = new Set(['gate', 'dayehai', 'camp_snow', 'tent_collapse', 'cold_wake', 'ending_report', 'ending_family']);
export const ITEM_CATEGORIES = Object.freeze(Object.fromEntries([
  ['tool', ['pack_day', 'pack_trail', 'pack_40', 'pack_70', 'lighter', 'headlamp', 'poles', 'microspikes', 'crampons', 'compass', 'gps', 'satcomm', 'powerbank', 'watch', 'whistle', 'camera']],
  ['camp', ['tent_light', 'tent_alpine', 'bag_summer', 'bag_3s', 'bag_winter', 'pad_foam', 'pad_air']],
  ['cloth', ['base_cotton', 'base_synth', 'base_merino', 'mid_hoodie', 'mid_fleece', 'insul_down', 'insul_synth', 'insul_coat', 'shell_pro', 'shell_cheap', 'poncho', 'pants_jeans', 'pants_hard', 'shoes_sneaker', 'shoes_trail', 'boots', 'gloves', 'mitts', 'hat', 'goggles', 'gaiters']],
  ['food', ['biscuit', 'chocolate', 'jerky', 'bar', 'gel', 'noodle', 'selfheat', 'baijiu', 'sausage']],
  ['water', ['water', 'water_jug', 'thermos', 'hotwater_fill', 'stove', 'pot', 'gas', 'gas_alpine']],
  ['med', ['blanket', 'firstaid', 'warmer', 'glucose', 'insurance']],
].flatMap(([category, ids]) => ids.map((id) => [id, category]))));

const eventOptions = {
  old_tent: ['check', 'leave'],
  blogger_shot: ['shoot', 'safe', 'no'], keepwarm_tip: ['yes', 'no'], hallucination: ['go', 'stop'], undress: ['strip', 'hold'], takin: ['back', 'shout', 'run'], signal: ['call', 'sos', 'live', 'no'],
  ridge_shelter: ['check', 'camp', 'push'], hot_water_share: ['share', 'guide', 'decline'], family_callback: ['call', 'text', 'later'], rescue_update: ['update', 'hold', 'camp'], loose_marker: ['check', 'camp', 'follow'],
  hand_warmth: ['warmer', 'insulate', 'move'], windproof_lash: ['patch', 'stitch', 'stay'], false_trail: ['check', 'track', 'stop'], headlamp_contact: ['fix', 'warm', 'defer'], fuel_check: ['cook', 'save', 'retreat'],
  emergency_bivouac: ['camp', 'sos', 'retreat'], shared_load: ['accept', 'rest', 'decline'], student_shortcut: ['check', 'stay', 'try'], veteran_confidence: ['check', 'retreat', 'push'], blogger_honest_cut: ['honest', 'hype', 'save'],
  runner_heat: ['slow', 'eat', 'push'], nurse_triage: ['sos', 'camp', 'aid'], coder_overload: ['drop', 'share', 'repack'], mutual_followup: ['check', 'trade', 'wave'], family_followup: ['reply', 'sos', 'save'], rescue_followup: ['hold', 'camp', 'wait'],
  reported_solo_probe: ['together', 'probe', 'back'], reported_weather_turn: ['shelter', 'layer', 'push'], reported_last_seen: ['note', 'send', 'decline'],
};
const npcOptions = {
  speedteam: ['persuade', 'warn', 'leave'], straggler: ['warm', 'sos', 'take', 'leave', 'stay', 'go'], mou: ['ask', 'together', 'trade', 'go'], wu: ['thermos', 'persuade', 'sos', 'leave'],
  boy: ['aid', 'feed', 'sos', 'leave', 'stay', 'go', 'take', 'leave2'], chen: ['feed', 'take', 'sos', 'leave'], yu: ['coord', 'take', 'stay', 'leave', 'go'],
};
export const QUESTION_OPTIONS = new Map([
  ...Object.entries(eventOptions).map(([id, options]) => [`event:${id}`, new Set(options)]),
  ...Object.entries(npcOptions).map(([id, options]) => [`npc:${id}`, new Set(options)]),
  ['scene:gate', new Set(['go', 'home', 'air', 'keep'])],
  ['scene:dayehai', new Set(['summit', 'down'])],
  ['scene:camp_snow', new Set(['clear', 'ignore'])],
  ['scene:tent_collapse', new Set(['fix', 'hold'])],
  ['scene:cold_wake', new Set(['cook', 'drink', 'eat', 'warmer', 'insul', 'move', 'sleep', 'up'])],
  ['scene:ending_report', new Set(['report', 'leave'])],
  ['scene:ending_family', new Set(['reply', 'later'])],
]);

export function validEventId(id) {
  if (EVENT_IDS.has(id)) return true;
  if (typeof id !== 'string') return false;
  const parts = id.split(':');
  if (parts.length !== 2) return false;
  const [kind, base] = parts;
  return kind === 'event' ? EVENT_IDS.has(base) : kind === 'npc' ? NPC_IDS.has(base) : kind === 'scene' && SCENE_IDS.has(base);
}
