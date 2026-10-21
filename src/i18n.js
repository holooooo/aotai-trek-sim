const STORAGE_KEY = 'aotai-locale-v1';
const SUPPORTED = new Set(['zh-CN', 'en']);
const FALLBACK = 'zh-CN';

const MESSAGES = {
  'zh-CN': {
    titleKicker: 'QINLING · 3767M · WINTER',
    titleMain: '鳌太线',
    titleEdition: '3D版',
    titleSub: '冬季穿越模拟器',
    tagline: '门口没有烤肠的山，不要爬。',
    continue: '继续行程',
    continueSmall: '读取存档',
    start: '开始',
    startSmall: '选择身份',
    records: '游玩记录',
    recordsEmpty: '还没有记录',
    recordsCount: (count) => `${count} 局`,
    archive: '事故档案',
    archiveSmall: '真实案例',
    about: '说明',
    aboutSmall: '操作 · 机制',
    language: 'English',
    privacyText: '匿名统计默认开启，使用随机浏览器编号汇总游玩、道具、事件与结局；匿名统计不保存姓名、IP或现实地理位置。死亡血迹的游戏坐标共享由下方独立开关控制。Cloudflare处理基础网络连接信息。你可随时关闭；关闭后停止上报并清除本机标识与队列，旧本地历史不会补报。选择比例仍可只读查看。',
    analyticsOn: '匿名统计已开启 · 点击关闭',
    analyticsOff: '匿名统计已关闭 · 点击开启',
    remainsTitle: '死亡血迹',
    remainsText: '地面血迹记录自己过去行程和附近玩家的死因，仅是游戏标记。只加载附近记录；关闭后停止显示、查询和新增共享。',
    remainsOn: '死亡血迹已开启 · 点击关闭',
    remainsOff: '死亡血迹已关闭 · 点击开启',
    sharedOn: '匿名共享已开启',
    sharedOff: '仅显示本机记录',
    remainsDetails: '共享仅含随机记录编号、游戏坐标、角色、死因和最终状态，保留30天；独立于匿名统计。关闭共享会丢弃待发记录，重新开启不会补报旧记录。本机最多保存60条。',
    clearRemains: '清空本机血迹',
    footer1: '本游戏根据公开报道改编，人物均为化名或虚构。鳌太线位于太白山国家级自然保护区，',
    footer2: '自2018年起禁止穿越',
    footer3: '。',
    footer4: '游戏中的路线、海拔与数值均为近似，',
    footer5: '不能作为任何出行参考',
    footer6: '。',
  },
  en: {
    titleKicker: 'QINLING · 3767M · WINTER',
    titleMain: 'AOTAI LINE',
    titleEdition: '3D EDITION',
    titleSub: 'WINTER CROSSING SIMULATOR',
    tagline: "A mountain without grilled sausages at the gate is a mountain you shouldn't climb.",
    continue: 'CONTINUE',
    continueSmall: 'LOAD SAVE',
    start: 'START',
    startSmall: 'CHOOSE IDENTITY',
    records: 'RECORDS',
    recordsEmpty: 'No runs yet',
    recordsCount: (count) => `${count} RUNS`,
    archive: 'CASE FILES',
    archiveSmall: 'REAL CASES',
    about: 'HOW TO PLAY',
    aboutSmall: 'CONTROLS · SYSTEMS',
    language: '中文',
    privacyText: 'Anonymous analytics is on by default. A random browser ID summarizes play, items, events, and endings; it does not store your name, IP address, or real-world location. Death-remnant sharing has its own switch below. Cloudflare processes basic network connection data. You can turn this off at any time; disabling it stops reports and clears the local ID and queue. Historical records remain read-only.',
    analyticsOn: 'ANONYMOUS ANALYTICS ON · TURN OFF',
    analyticsOff: 'ANONYMOUS ANALYTICS OFF · TURN ON',
    remainsTitle: 'DEATH REMNANTS',
    remainsText: 'Ground marks record your past run and nearby players’ causes of death as game markers. Only nearby records load; turning this off stops display, queries, and new sharing.',
    remainsOn: 'DEATH REMNANTS ON · TURN OFF',
    remainsOff: 'DEATH REMNANTS OFF · TURN ON',
    sharedOn: 'ANONYMOUS SHARING ON',
    sharedOff: 'LOCAL RECORDS ONLY',
    remainsDetails: 'Sharing includes only a random record ID, game coordinates, role, cause of death, and final state. Records expire after 30 days and are separate from analytics. Turning sharing off discards pending uploads; this device keeps up to 60 local marks.',
    clearRemains: 'CLEAR LOCAL MARKS',
    footer1: 'Based on public reports; people are fictional or use aliases. The Aotai Line is in Taibai Mountain National Nature Reserve, ',
    footer2: 'closed to crossings since 2018',
    footer3: '.',
    footer4: 'Routes, elevations, and values are approximate and ',
    footer5: 'must not be used for trip planning',
    footer6: '.',
  },
};

function storage() {
  try { return globalThis.localStorage; } catch { return null; }
}

export function getLocale(store = storage()) {
  try { return SUPPORTED.has(store?.getItem?.(STORAGE_KEY)) ? store.getItem(STORAGE_KEY) : FALLBACK; } catch { return FALLBACK; }
}

export function setLocale(locale, store = storage()) {
  const next = SUPPORTED.has(locale) ? locale : FALLBACK;
  try { store?.setItem?.(STORAGE_KEY, next); } catch { /* private mode or quota */ }
  return next;
}

export function toggleLocale(store = storage()) {
  return setLocale(getLocale(store) === 'en' ? 'zh-CN' : 'en', store);
}

export function translate(locale, key, vars = {}) {
  const value = MESSAGES[locale]?.[key] ?? MESSAGES[FALLBACK][key] ?? key;
  if (typeof value === 'function') return value(vars.count ?? 0);
  return String(value).replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? `{${name}}`));
}

export const LOCALE_STORAGE_KEY = STORAGE_KEY;
export const LOCALES = Object.freeze([...SUPPORTED]);
