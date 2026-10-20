// 事件节奏使用可存档的“可操作时间”，休息快进和读对话不会跳过安静期。
const AMBIENT_IDS = new Set(['blogger_shot', 'old_tent', 'signal']);
const NOTIFICATION_IDS = new Set(['sweat_tip', 'rest_cold_tip']);
export const AMBIENT_GAP = 300; // 游戏分钟；另有现实游玩时间门槛
export const FIRST_EVENT_GRACE = 60;
export const DIALOG_GAP = 105;
export const URGENT_GAP = 12;
export const isAmbient = (ev) => !!ev.ambient || AMBIENT_IDS.has(ev.id);
export const eventPriority = (ev) => ev.priority ?? (ev.id === 'undress' ? 110 : ev.id === 'hallucination' ? 100 : isAmbient(ev) ? 10 : 50);
export const isUrgent = (ev) => eventPriority(ev) >= 80;
export const isNotification = (ev) => NOTIFICATION_IDS.has(ev.id);
const jitter = (st, count = 0) => ((Math.abs(Number(st.seed) || 0) + count * 104729) % 1009) / 1009;

export function ensureEventPacing(st) {
  st.story ||= {};
  let p = st.story.pacing;
  if (!p || p.v !== 1) {
    p = st.story.pacing = {
      v: 1, elapsed: 0,
      started: (st.stats?.walked || 0) > 1 || (st.maxS || 0) > 8 || !!st.flags?.gateDone || !!st.camp || !!st.rescue,
      nextAmbientAt: FIRST_EVENT_GRACE + jitter(st) * 30,
      lastDialogAt: null, dialogs: 0,
    };
  }
  return p;
}

export function advanceEventPacing(st, dt, moving = false) {
  const p = ensureEventPacing(st);
  if (moving || (st.stats?.walked || 0) > 1 || st.camp || st.rescue) p.started = true;
  if (p.started && Number.isFinite(dt) && dt > 0) p.elapsed += dt;
  return p;
}

export function recordDialog(st) {
  const p = ensureEventPacing(st);
  p.lastDialogAt = p.elapsed;
  p.dialogs++;
  p.nextAmbientAt = Math.max(p.nextAmbientAt, p.elapsed + DIALOG_GAP + jitter(st, p.dialogs) * 45);
}

export function chooseEvent(events, g, random = Math.random) {
  const st = g.st, story = st.story;
  const pending = events.find((ev) => ev.id === story.pendingEvent);
  if (pending) return pending; // 刷新仍恢复原来的未完成选择，不重新抽取。
  const p = ensureEventPacing(st);
  const inside = !!st.camp?.inside;
  const candidates = [];
  for (const ev of events) {
    const last = st.flags['ev_' + ev.id];
    if (last !== undefined && (ev.once || st.time - last < (ev.cooldown ?? 300))) continue;
    if (inside && !ev.allowCamp && !['hallucination', 'undress'].includes(ev.id)) continue;
    if (isUrgent(ev)) {
      if (p.lastDialogAt != null && p.elapsed - p.lastDialogAt < URGENT_GAP) continue;
    } else if (isNotification(ev)) {
      if (!p.started || p.elapsed < 8) continue;
    } else {
      if (!p.started || (st.stats?.walked || 0) < 12 || p.elapsed < p.nextAmbientAt) continue;
      if (story.lastAmbientAt != null && st.time - story.lastAmbientAt < AMBIENT_GAP) continue;
      if (st.body.core < 34 || st.body.health < 25) continue;
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
  if (!isNotification(ev)) recordDialog(st);
  st.story.pendingEvent = null;
}
