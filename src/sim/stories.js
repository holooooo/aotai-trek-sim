// 连续剧情状态与结局尾声判定。所有故事状态均可 JSON 序列化。
import { npcById } from '../data/npcs.js';

const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const SURVIVING_FATES = new Set(['safe', 'rescued', 'survived', 'followed', 'together', 'helped', 'warned', 'waited']);

/** 为旧存档补齐故事字段，保留已有选择、线程、效果和根对象引用。 */
export function ensureStoryState(st) {
  if (!isObject(st)) return {
    choices: {},
    threads: {},
    decisions: [],
    effects: {},
  };
  const story = isObject(st.story) ? st.story : {};
  if (!isObject(story.choices)) story.choices = {};
  if (!isObject(story.threads)) story.threads = {};
  if (!Array.isArray(story.decisions)) story.decisions = [];
  if (!isObject(story.effects)) story.effects = {};
  if (isObject(st)) st.story = story;
  return story;
}

function hasSurvivingCompanion(st, fates) {
  if (!Array.isArray(st?.companions) || !isObject(st.npcs) || !Array.isArray(fates)) return false;
  return st.companions.some((id) => {
    const ns = st.npcs[id];
    if (!ns?.following || ns.dead || ns.fate === 'died' || (Number.isFinite(ns.cond) && ns.cond <= 0)) return false;
    const name = npcById(id)?.name;
    const finalFate = fates.find((f) => f && (f.id === id || (name && f.name === name)));
    return !!finalFate && SURVIVING_FATES.has(finalFate.fate);
  });
}

/**
 * 接收 Game 最终计算的 [{name, fate, text, ...}]，返回可叠加、顺序稳定的尾声 id。
 * 同行尾声同时校验真实同行状态和最终 fate，远处获救或仅被提醒的 NPC 不算同行。
 */
export function collectEpilogues(st, type, fates = []) {
  const story = ensureStoryState(st);
  if (!st || type === 'dead') return [];
  const result = [];
  const body = st.body || {};

  if (type !== 'sausage' && hasSurvivingCompanion(st, fates)) result.push('together');
  // Game.updateRescuePosition 在重新报点后重置 moved；最终获救也须靠近报告位置。
  if (type === 'rescued' && story.threads.rescueContact && st.rescue && !st.rescue.moved) result.push('beacon');
  if (story.threads.reportCompleted) result.push('report');
  if (st.role === 'blogger' && story.threads.honestFootage) result.push('honest');
  if (type !== 'sausage' && (
    Number(body.frostbite) >= 60 || Number(body.fracture) >= 1 ||
    (Number.isFinite(body.health) && body.health < 40)
  )) result.push('aftermath');
  return result;
}
