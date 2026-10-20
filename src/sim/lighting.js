// 以环境亮度而非固定钟点控制头灯。双阈值避免晨昏反复闪灯，手动模式不被覆盖。
const clamp = n => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
export function ambientBrightness({ sunEl = 0, wx = {}, terrain = 'ridge' } = {}) {
  const daylight = clamp((sunEl + 0.08) / 0.34);
  const cloud = 1 - clamp(wx.overcast) * 0.55;
  const fog = 1 - clamp(wx.fog) * 0.5;
  const shade = terrain === 'forest' ? 0.58 : terrain === 'village' ? 0.85 : 1;
  return clamp(daylight * cloud * fog * shade);
}
export function ensureLampMode(st) {
  if (!['auto', 'on', 'off'].includes(st.lampMode)) st.lampMode = 'auto';
  return st.lampMode;
}
export function updateLamp(st, context = {}) {
  const mode = ensureLampMode(st), before = !!st.lampOn;
  const brightness = ambientBrightness(context);
  const ready = (st.inv?.headlamp || 0) > 0 && (st.bat?.headlamp || 0) > 0;
  const inside = context.inTent ?? !!(st.camp?.inside && !st.camp.bivy && !st.camp.collapsed && st.camp.health > 0);
  if (!ready || mode === 'off') st.lampOn = false;
  else if (mode === 'on') st.lampOn = true;
  else if (inside) st.lampOn = false;
  else st.lampOn = before ? brightness < 0.3 : brightness < 0.18;
  return { on: st.lampOn, changed: st.lampOn !== before, mode, brightness };
}
