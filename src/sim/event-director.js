// 按处境选事件：危急提醒优先，普通事件共享间隔，进度随存档保存。
const AMBIENT_IDS = new Set(['blogger_shot', 'old_tent', 'signal']);
export const AMBIENT_GAP = 75; // 游戏分钟，不是现实秒
export const isAmbient = (ev) => !!ev.ambient || AMBIENT_IDS.has(ev.id);
export const eventPriority = (ev) => ev.priority ?? (ev.id === 'undress' ? 110 : ev.id === 'hallucination' ? 100 : isAmbient(ev) ? 10 : 50);

export function chooseEvent(events, g, random = Math.random) {
  const st = g.st;
  const story = st.story;
  const pending = events.find((ev) => ev.id === story.pendingEvent);
  if (pending) return pending; // 中途刷新：从事件开始前的快照恢复，不重复结算消耗。
  const inside = !!st.camp?.inside;
  const candidates = [];
  for (const ev of events) {
    const last = st.flags['ev_' + ev.id];
    if (last !== undefined && (ev.once || st.time - last < (ev.cooldown ?? 300))) continue;
    if (inside && !ev.allowCamp && !['hallucination', 'undress'].includes(ev.id)) continue;
    if (isAmbient(ev)) {
      if (story.lastAmbientAt != null && st.time - story.lastAmbientAt < AMBIENT_GAP) continue;
      // 生死关头不弹无关闲聊；救援剧情可以标 priority >= 80。
      if ((st.body.core < 34 || st.body.health < 25) && eventPriority(ev) < 80) continue;
    }
    try { if (ev.cond(g)) candidates.push(ev); } catch (e) { console.error(`事件条件失败: ${ev.id}`, e); }
  }
  if (!candidates.length) return null;
  const priority = Math.max(...candidates.map(eventPriority));
  const pool = candidates.filter((ev) => eventPriority(ev) === priority);
  const total = pool.reduce((sum, ev) => sum + Math.max(0.01, ev.weight ?? 1), 0);
  let pick = random() * total;
  for (const ev of pool) { pick -= Math.max(0.01, ev.weight ?? 1); if (pick < 0) return ev; }
  return pool[pool.length - 1];
}

export function completeEvent(st, ev) {
  st.flags['ev_' + ev.id] = st.time;
  if (isAmbient(ev)) st.story.lastAmbientAt = st.time;
  st.story.pendingEvent = null;
}
