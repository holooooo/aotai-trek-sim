// 游玩记录：每局结束后写入 localStorage，供标题页"游玩记录"展示。
const KEY = 'aotai-records-v1';
const MAX = 60;

// 可收集的结局（id 与 ENDINGS 对应；遇难按死因区分）
export const ENDING_LIST = [
  { id: 'sausage', name: '门口有烤肠' },
  { id: 'turnback', name: '及时回头' },
  { id: 'retreat', name: '原路下撤' },
  { id: 'retreat_branch', name: '南坡下撤' },
  { id: 'rescued', name: '获救' },
  { id: 'cross', name: '穿越完成' },
  { id: 'dead:hypothermia', name: '失温' },
  { id: 'dead:fall', name: '滑坠' },
  { id: 'dead:dehydration', name: '脱水' },
  { id: 'dead:starvation', name: '力竭' },
  { id: 'dead:injury', name: '伤重' },
];

export const endingKey = (type, cause) => (type === 'dead' ? `dead:${cause || 'hypothermia'}` : type);

export function loadRecords() {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

export function addRecord(rec) {
  const list = loadRecords();
  list.unshift(rec);
  if (list.length > MAX) list.length = MAX;
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) { /* 存储已满 */ }
  return list;
}

export function clearRecords() {
  try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
}

export function summarize(list = loadRecords()) {
  const unlocked = new Set(list.map((r) => r.key));
  const deaths = list.filter((r) => r.type === 'dead').length;
  const alive = list.length - deaths;
  const best = list.reduce((m, r) => Math.max(m, Number(r.progress) || 0), 0);
  const crossed = list.filter((r) => r.type === 'cross').length;
  return { total: list.length, deaths, alive, best, crossed, unlocked };
}
