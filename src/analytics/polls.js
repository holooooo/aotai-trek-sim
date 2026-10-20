import { QUESTION_OPTIONS } from '../../server/analytics-catalog.js';

// 可比较的同一道题：文案更新不重置选项ID。
export function makeQuestion(source, choices) {
  if (!/^(event|npc|scene):[a-z0-9_]+$/.test(source || '') || choices.length < 2 || choices.length > 8) return null;
  const allowed = QUESTION_OPTIONS.get(source);
  if (!allowed || choices.some(c => !allowed.has(c.id))) return null;
  const optionIds = choices.map(c => c.id).sort();
  if (new Set(optionIds).size !== optionIds.length || optionIds.some(id => !/^[a-z0-9_-]{1,32}$/.test(id))) return null;
  const questionId = `${source}:${optionIds.join('|')}`;
  return questionId.length <= 160 ? { questionId, optionIds } : null;
}

// 最大余数法使显示比例合计100%；零样本明确保留为“暂无”。
export function distribution(question, result) {
  if (!result || result.questionId !== question.questionId) return null;
  const counts = question.optionIds.map(id => result.counts?.[id]);
  if (counts.some(n => !Number.isSafeInteger(n) || n < 0)) return null;
  const total = counts.reduce((a,b) => a+b, 0);
  if (!Number.isSafeInteger(total) || result.total !== total) return null;
  if (!total) return { total, values: Object.fromEntries(question.optionIds.map(id => [id, { count: 0, percent: null }])) };
  const units = counts.map(n => n / total * 1000);
  const rounded = units.map(Math.floor);
  const order = units.map((n, i) => ({ i, fraction: n - rounded[i] })).sort((a,b) => b.fraction-a.fraction || a.i-b.i);
  for (let i=0, left=1000-rounded.reduce((a,b)=>a+b,0); i<left; i++) rounded[order[i].i]++;
  return { total, values: Object.fromEntries(question.optionIds.map((id,i) => [id, { count: counts[i], percent: rounded[i]/10 }])) };
}
