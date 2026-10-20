// 游玩记录：每局结束后写入 localStorage，供标题页“游玩记录”展示。
import { EPILOGUE_LIST as ENDING_EPILOGUE_LIST } from '../data/endings.js';

const KEY = 'aotai-records-v1';
const MAX = 60;

// 可收集的主结局（id 与 ENDINGS 对应；遇难按死因区分）。
export const ENDING_LIST = [
  { id: 'sausage', name: '门口有烤肠' },
  { id: 'sigma', name: 'Sigma · 现在回家' },
  { id: 'retreat_wild', name: '半途下山' },
  { id: 'turnback', name: '及时回头' },
  { id: 'retreat', name: '原路下撤' },
  { id: 'retreat_branch', name: '南坡下撤' },
  { id: 'rescued', name: '获救' },
  { id: 'cross', name: '穿越完成' },
  { id: 'dayehai', name: '不必登顶' },
  { id: 'dead:hypothermia', name: '失温' },
  { id: 'dead:fall', name: '滑坠' },
  { id: 'dead:dehydration', name: '脱水' },
  { id: 'dead:starvation', name: '力竭' },
  { id: 'dead:injury', name: '伤重' },
];

// 与主结局分开统计的可收集故事尾声。
export const EPILOGUE_LIST = ENDING_EPILOGUE_LIST;

export const endingKey = (type, cause) => (type === 'dead' ? `dead:${cause || 'hypothermia'}` : type);

function validRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value) && typeof value.key === 'string';
}

function normalizeEpilogues(value) {
  return Array.isArray(value)
    ? [...new Set(value.filter((id) => typeof id === 'string' && EPILOGUE_LIST.some((e) => e.id === id)))]
    : [];
}

export function loadRecords() {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) || '[]');
    // 只丢弃明显损坏的条目；旧记录字段保持原样，缺少 epilogues 等新字段也照常保留。
    return Array.isArray(arr) ? arr.filter(validRecord) : [];
  } catch (e) {
    return [];
  }
}

export function addRecord(rec) {
  const list = loadRecords();
  if (validRecord(rec)) {
    list.unshift({ ...rec, epilogues: normalizeEpilogues(rec.epilogues) });
    if (list.length > MAX) list.length = MAX;
    try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) { /* 存储已满 */ }
  }
  return list;
}

export function clearRecords() {
  try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
}

export function summarize(list = loadRecords()) {
  const records = Array.isArray(list) ? list.filter(validRecord) : [];
  const unlocked = new Set(records.map((r) => r.key));
  const unlockedEpilogues = new Set(
    records.flatMap((r) => normalizeEpilogues(r.epilogues)),
  );
  const deaths = records.filter((r) => r.type === 'dead').length;
  const alive = records.length - deaths;
  const best = records.reduce((m, r) => Math.max(m, Number(r.progress) || 0), 0);
  const crossed = records.filter((r) => r.type === 'cross').length;
  return { total: records.length, deaths, alive, best, crossed, unlocked, unlockedEpilogues };
}
