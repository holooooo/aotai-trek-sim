export const FIRE_BOTTLE_UNITS = 6;

function number(value, fallback = 0) { return Number.isFinite(value) ? Math.max(0, value) : fallback; }

export function ensureFire(st) {
  if (!st || typeof st !== 'object') return { active: false, fuel: null, balance: 0, scrapped: 0 };
  if (!st.fire || typeof st.fire !== 'object') st.fire = { active: false, fuel: null, balance: 0, scrapped: 0 };
  st.fire.active = !!st.fire.active && (st.fire.fuel === 'normal' || st.fire.fuel === 'alpine') && number(st.fire.balance) > 0;
  st.fire.balance = number(st.fire.balance);
  st.fire.scrapped = Math.max(0, Math.floor(number(st.fire.scrapped)));
  if (!st.fire.active) { st.fire.fuel = null; st.fire.balance = 0; }
  return st.fire;
}

export function lightFire(st) {
  const fire = ensureFire(st);
  if (fire.active) return { ok: false, reason: 'already_lit', fire };
  const fuel = number(st.gas?.alpine) > 0 ? 'alpine' : number(st.gas?.normal) > 0 ? 'normal' : null;
  if (!fuel) return { ok: false, reason: 'empty', fire };
  fire.active = true;
  fire.fuel = fuel;
  fire.balance = Math.min(FIRE_BOTTLE_UNITS, number(st.gas[fuel]));
  return { ok: true, fuel, fire };
}

export function fireCostAvailable(st, cost = 1) {
  const fire = ensureFire(st);
  return fire.active && Number.isFinite(cost) && cost > 0 && fire.balance >= cost;
}

export function consumeFire(st, cost = 1) {
  const fire = ensureFire(st);
  if (!fireCostAvailable(st, cost)) return { ok: false, reason: fire.active ? 'insufficient' : 'unlit', fire };
  const fuel = fire.fuel;
  fire.balance -= cost;
  st.gas[fuel] = Math.max(0, number(st.gas[fuel]) - cost);
  let scrapped = false;
  if (fire.balance <= 0) {
    fire.active = false;
    fire.fuel = null;
    fire.balance = 0;
    fire.scrapped += 1;
    scrapped = true;
  }
  return { ok: true, fuel, cost, scrapped, fire };
}
