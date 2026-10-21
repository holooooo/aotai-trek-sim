// 生理模型：核心体温、体力、饱食、水分、压力、健康、潮湿、冻伤等。
// 数值为游戏化近似，参考常见的失温与风寒指数模型。
import { ITEMS } from '../data/items.js';
import { wornItems, tentItem, bagItem, padItem, has } from './state.js';
import { airTemp, windChill } from './weather.js';
import { clamp } from '../world/noise.js';
import { ensureDifficulty, difficultyProfile, maxHealth } from './difficulty.js';
import { garmentWetness, stepGarmentMoisture } from './clothes.js';
import { nutritionModifiers, stepFoodEffects } from './nutrition.js';
import { stepStress } from './stress.js';

export function clothing(st) {
  const worn = wornItems(st);
  let clo = 0.25;
  let windproof = 0, waterproof = 0;
  for (const [slot, id] of Object.entries(worn)) {
    if (slot === 'insul' && !st.wearInsul) continue;
    const it = ITEMS[id];
    const keep = it.wetKeep ?? 0.5;
    const w = garmentWetness(st, id) / 100;
    clo += (it.clo || 0) * (1 - w * (1 - keep));
    if (slot === 'shell') { windproof = it.windproof || 0; waterproof = it.waterproof || 0; }
  }
  const shoes = worn.shoes ? ITEMS[worn.shoes] : null;
  return {
    worn, clo, windproof, waterproof,
    hat: !!worn.hat, gloves: !!worn.gloves, eyes: !!worn.eyes, gaiters: !!worn.gaiters,
    shoeDry: shoes ? shoes.wetKeep : 0, grip: shoes ? shoes.grip ?? 0.6 : 0.4,
    cotton: worn.base === 'base_cotton' || worn.mid === 'mid_hoodie',
  };
}

// ctx: { alt, exposure, hour, day, wx, inTent, camp }
export function computeEnv(st, ctx) {
  const minTemp = difficultyProfile(st).minTemp;
  const T = airTemp(ctx.alt, ctx.hour, ctx.wx, ctx.day, minTemp);
  const wind = ctx.wx.wind * ctx.wx.gust * ctx.exposure;
  const cl = clothing(st);
  const wct = Math.max(minTemp, windChill(T, wind));
  let Teff = T + (wct - T) * (1 - cl.windproof);
  let tentInfo = null;
  if (ctx.inTent && ctx.camp) {
    const tent = ITEMS[ctx.camp.tent];
    const tentWind = ctx.wx.wind * ctx.wx.gust * ctx.camp.exposure * ctx.camp.orient;
    const health = clamp(ctx.camp.health / 100, 0, 1);
    let Tin = T + tent.warmth * (0.4 + 0.6 * health) - Math.max(0, tentWind - 4) * 0.12;
    if (ctx.camp.doorIntoWind) Tin -= 3;
    Tin = Math.max(minTemp, Tin);
    Teff = Tin;
    tentInfo = { Tin, tentWind, rating: tent.windRating };
  }
  return { T, wind, wct, Teff, cl, tentInfo, precip: ctx.inTent ? 0 : ctx.wx.precip };
}

const NOTE_COOLDOWN = 90; // 分钟

// act: { mode: walk|idle|rest|sleep|crouch, effort, downhill, terrainStamina, load, snowDeep }
export function stepBody(st, env, act, minutes, role) {
  const notes = [];
  const difficulty = ensureDifficulty(st);
  const healthCap = maxHealth(st);
  const b = st.body;
  const m = role.mods;
  let remaining = minutes;
  while (remaining > 0) {
    const dt = Math.min(2, remaining);
    remaining -= dt;
    env.cl = clothing(st);
    const nutrition = nutritionModifiers(st);
    const walking = act.mode === 'walk';
    const sleeping = act.mode === 'sleep';
    const resting = act.mode === 'rest' || act.mode === 'idle' || act.mode === 'crouch';

    // —— 产热 ——
    let prod = walking ? 2.5 + act.effort * 0.9 : sleeping ? 0.9 : act.mode === 'crouch' ? 1.2 : 1.05;
    if (b.food < 5) prod *= 0.75;
    let shiver = 0;
    if (b.core < 36.7) {
      shiver = clamp((36.7 - b.core) / 1.5, 0, 1) * 1.6;
      if (b.food < 5) shiver *= 0.35;
      if (b.stamina < 3) shiver *= 0.6;
      if (b.core < 32) shiver *= clamp((b.core - 30) / 2, 0, 1); // 重度失温时寒战停止
    }
    // —— 散热 ——
    let loss;
    if (sleeping && bagItem(st)) {
      const bag = ITEMS[bagItem(st)];
      const pad = padItem(st) ? ITEMS[padItem(st)] : null;
      const r = pad ? pad.r : 0;
      let comfort = bag.comfort + (r < 2 ? (2 - r) * 5 : -(r - 2) * 1.5);
      if (st.wearInsul && wornItems(st).insul) comfort -= 5;
      comfort += (b.wet / 100) * 10;
      const R = (37 - comfort) / 0.9;
      loss = (37 - env.Teff) / R;
    } else {
      let clo = env.cl.clo;
      if (sleeping && env.tentInfo && !bagItem(st)) clo += 0.3;
      if ((resting || sleeping) && st.flags.blanketOn) clo += 0.6;
      const R = 4 + clo * 5;
      loss = (37 - env.Teff) / R;
      if (!env.cl.hat) loss *= 1.08;
      if (sleeping && env.tentInfo && !padItem(st)) loss *= 1.25;
    }
    loss *= m.heatLoss * difficulty.heatLoss;
    if (st.warmerLeft > 0) { loss *= 0.86; st.warmerLeft -= dt; }
    if (st.alcoholLeft > 0) { loss *= 1.25; st.alcoholLeft -= dt; }
    const H = prod + shiver - loss;
    let dCore = H * 0.009 * dt;
    if (b.core >= 37 && dCore > 0) {
      b.sweating = clamp(H, 0, 3);
      dCore = Math.min(dCore, (37.2 - b.core) * 0.5);
    } else {
      b.sweating = Math.max(0, b.sweating - 0.1 * dt);
    }
    b.core = clamp(b.core + dCore, 20, 37.6);
    b.shiver = shiver;

    // —— 分件潮湿：汗和雪只打湿在穿衣物，包内备用衣物保持原状 ——
    const sweatRate = walking && H > 0.35 ? (H - 0.35) * 0.55 * (st.wearInsul ? 1.3 : 1) * (env.cl.cotton ? 1.3 : 1) : 0;
    stepGarmentMoisture(st, env, act, dt, sweatRate);

    // —— 饱食、水分 ——
    const effort = walking ? act.effort : 0;
    const baseK = sleeping ? 0.65 : 1; // 睡眠时代谢较低
    b.food -= (0.024 * baseK + effort * 0.048 + shiver * 0.11) * dt * difficulty.foodDrain * nutrition.foodDrain;
    b.water -= ((0.028 + (act.alt > 3000 ? 0.008 : 0)) * baseK + effort * 0.038 + b.sweating * 0.02) * dt * difficulty.waterDrain * nutrition.waterDrain;
    b.food = clamp(b.food, 0, 100);
    b.water = clamp(b.water, 0, 100);

    // —— 体力 ——
    if (walking) {
      let drain = 0.13 * act.effort * act.terrainStamina * act.load * m.staminaDrain * difficulty.staminaDrain * nutrition.staminaDrain;
      if (act.downhill && role.id === 'veteran') drain *= 1.35;
      if (b.altSick > 30) drain *= 1.12;
      if (b.sprain > 0) drain *= 1.3;
      if (b.fracture > 0) drain *= 1.6;
      b.stamina -= drain * dt;
    } else {
      let regen = sleeping ? 0.34 : act.mode === 'rest' ? 0.75 : act.mode === 'crouch' ? 0.1 : 0.3;
      if (role.id === 'student') regen *= 1.2;
      if (b.food < 15) regen *= 0.4;
      if (b.water < 15) regen *= 0.5;
      if (b.core < 35.5) regen *= 0.3;
      if (shiver > 0.5) regen *= 0.5;
      if (env.tentInfo && env.tentInfo.tentWind > env.tentInfo.rating * 0.7) regen *= 0.6;
      b.stamina += regen * dt * nutrition.restRecovery;
    }
    b.stamina = clamp(b.stamina, 0, 100);

    // —— 冻伤、雪盲、高反 ——
    if (!env.tentInfo) {
      if (env.Teff < -15) {
        const k = (-env.Teff - 15) / 10;
        if (!env.cl.gloves) b.frostbite += 0.045 * k * dt;
        if (env.cl.shoeDry < 0.5 && b.wet > 30) b.frostbite += 0.02 * k * dt;
        if (env.wind > 15 && !env.cl.eyes) b.frostbite += 0.008 * k * dt;
      }
      if (act.sunny && !env.cl.eyes && act.alt > 3000) b.snowblind = clamp(b.snowblind + 0.007 * dt, 0, 100);
    }
    if (act.sunny === false || env.tentInfo) b.snowblind = Math.max(0, b.snowblind - 0.004 * dt);
    if ((role.id === 'student' || role.id === 'coder') && act.alt > 3300) b.altSick = clamp(b.altSick + 0.012 * dt, 0, 100);
    if (act.alt < 3000) b.altSick = Math.max(0, b.altSick - 0.03 * dt);
    b.frostbite = clamp(b.frostbite, 0, 100);

    // —— 健康 ——
    let harm = 0;
    const hurt = (v, cause) => { harm += v; if (v > 0) b.lastHarm = cause; };
    if (b.core < 34) hurt(0.02 * dt, 'hypothermia');
    if (b.core < 32) hurt(0.12 * dt, 'hypothermia');
    if (b.core < 30) hurt(0.35 * dt, 'hypothermia');
    if (b.water <= 0) hurt(0.06 * dt, 'dehydration');
    if (b.food <= 0) hurt(0.03 * dt, 'starvation');
    if (b.frostbite > 20) hurt(0.0025 * b.frostbite * dt * 0.1, 'hypothermia');
    if (b.fracture > 0) hurt(0.01 * dt, 'injury');
    b.health = clamp(b.health - harm * difficulty.damage, 0, healthCap);
    if (harm === 0 && b.core > 36 && b.food > 30 && b.water > 30 && !walking) b.health = clamp(b.health + 0.02 * dt, 0, healthCap);

    // —— 压力：伤痛持续负担、恶化冲击与有质量的睡眠缓解 ——
    stepStress(st, env, act, dt, role, nutrition);

    // —— 电量 ——
    const cold = env.T < -5 && !st.keepWarm ? 1 + (-env.T - 5) / 8 : env.T < -5 ? 1 + (-env.T - 5) / 30 : 1;
    const inBagNight = sleeping && bagItem(st);
    const coldK = inBagNight ? 1 : cold;
    st.bat.phone = clamp(st.bat.phone - (st.airplane ? 0.012 : act.signal ? 0.03 : 0.05) * coldK * dt, 0, 100);
    if (st.gpsOn && has(st, 'gps')) st.bat.gps = clamp(st.bat.gps - 0.07 * coldK * dt, 0, 100);
    if (st.gpsOn && st.bat.gps <= 0) st.gpsOn = false;
    if (st.lampOn && has(st, 'headlamp')) st.bat.headlamp = clamp(st.bat.headlamp - 0.2 * coldK * dt, 0, 100);
    if (has(st, 'satcomm')) st.bat.satcomm = clamp(st.bat.satcomm - 0.006 * coldK * dt, 0, 100);

    // —— 水结冰、保温杯降温 ——
    if (!inBagNight && env.T < -4 && st.water.liquid > 0) {
      const f = Math.min(st.water.liquid, st.water.liquid * 0.0022 * (-env.T / 10) * (st.keepWarm ? 0.5 : 1) * dt + 0.0004 * dt);
      st.water.liquid -= f;
      st.water.frozen += f;
    }
    if (st.thermos.l > 0) st.thermos.temp = Math.max(env.T, st.thermos.temp - (st.thermos.temp - env.T) * 0.0009 * dt);
    stepFoodEffects(st, dt);
  }
  // 充电宝冻死机
  if (st.powerbank > 0 && env.T < -15 && !st.keepWarm && !env.tentInfo && Math.random() < 0.0007 * minutes) {
    st.powerbank = 0;
    delete st.inv.powerbank;
    notes.push('powerbank_dead');
  }
  return notes;
}

// 体温的主观描述（非护士只能凭感觉）
export function coreFeel(core) {
  if (core >= 36.5) return '正常';
  if (core >= 35.5) return '发冷';
  if (core >= 34.5) return '寒战';
  if (core >= 33) return '意识迟钝';
  if (core >= 31) return '神志不清';
  return '濒危';
}
