import { makeQuestion } from '../analytics/polls.js';
// 游戏主控：移动、模拟循环、危险判定、扎营、救援、路遇驴友、结局。
import * as THREE from 'three';
import { mainPath, branches, columnInfo, WANXIAN } from '../world/terrain.js';
import { makeCharacter, animateCharacter, makeTent, makeCollapsedTent, makeArrow, makeMarker } from '../world/models.js';
import { TERRAIN, KM_PER_UNIT, voxToAlt } from '../data/route.js';
import { ITEMS } from '../data/items.js';
import { roleById } from '../data/roles.js';
import { NPCS, npcById } from '../data/npcs.js';
import { EVENTS } from '../data/events.js';
import { EXPANDED_EVENTS } from '../data/events-expanded.js';
import { REPORTED_EVENTS } from '../data/events-reported.js';
import { chooseEvent, completeEvent, advanceEventPacing, ensureEventPacing, recordDialog } from './event-director.js';
import { ensureStoryState, collectEpilogues } from './stories.js';
import { paceProfile } from './pace.js';
import { EventCamera } from './event-camera.js';
import { makeEventProp } from '../world/event-subjects.js';
import { travelEnding, canFreeDescent } from './exits.js';
import { difficultyProfile, maxHealth, ensureDifficulty } from './difficulty.js';
import { weatherAt, windVectors, airTemp, sunElevation, beaufort, compassName } from './weather.js';
import { computeEnv, stepBody, coreFeel } from './body.js';
import { has, removeItem, addItem, packWeight, packCapacity, tentItem, wornItems } from './state.js';
import { ensureClothes, changeClothing, canDryClothes, dryableClothes, beginClothesDrying, garmentWetness } from './clothes.js';
import { ensureLampMode, updateLamp } from './lighting.js';
import { ensurePsychology } from './stress.js';
import { applyFood, foodEffectSummary } from './nutrition.js';
import { ensureEncounters, npcEncounterAllowed, eventEncounterAllowed } from './encounters.js';
import { RANDOM_EVENTS } from '../data/events-random.js';
import { STRESS_EVENTS } from '../data/events-stress.js';
import { EXIT_EVENTS } from '../data/events-exits.js';
import { clamp, lerp } from '../world/noise.js';
import { addRecord, loadRecords, summarize, endingKey, ENDING_LIST, EPILOGUE_LIST } from './records.js';

export const TIME_SCALE = 4; // 游戏分钟 / 现实秒
const BASE_SPEED = 3.2;
const SAVE_KEY = 'aotai-save-v1';
const NPC_COND = { straggler: 30, wu: 35, boy: 30, chen: 25, yu: 55, mou: 90, speedteam: 80 };
const PASS_FATE = { wu: 'died', boy: 'died', straggler: 'died', yu: 'waited', chen: 'died', mou: 'safe', speedteam: 'danger' };
const ALL_EVENTS = [...EVENTS, ...EXPANDED_EVENTS, ...REPORTED_EVENTS, ...RANDOM_EVENTS, ...STRESS_EVENTS, ...EXIT_EVENTS];
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

export class Game {
  constructor(world, ui, input, audio) {
    this.world = world;
    this.ui = ui;
    this.input = input;
    this.audio = audio;
    this.st = null;
    this.cam = { yaw: 0, pitch: 0.42, dist: 9.5, idle: 0 };
    this.camTarget = new THREE.Vector3();
    this.eventCamera = new EventCamera({ reducedMotion: globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false });
    this._displayTarget = new THREE.Vector3();
    this.pos = new THREE.Vector3();
    this.npcRt = {};
    this.noteCd = {};
    this.push = new THREE.Vector2();
    this.gust = { timer: 6, warn: 0, push: 0 };
  }

  // ———————————————————— 生命周期 ————————————————————
  start(st, { fresh = false } = {}) {
    this.eventCamera?.reset();
    this.clearEventActor();
    this.st = st;
    ensureStoryState(st);
    ensureDifficulty(st);
    ensureEventPacing(st);
    ensureClothes(st);
    ensurePsychology(st);
    ensureLampMode(st);
    ensureEncounters(st, NPCS, ALL_EVENTS, { fresh });
    st.pace = st.pace === 'fast' ? 'fast' : 'walk';
    this.role = roleById(st.role);
    this.over = false;
    this.busy = false;
    this.eventRunning = false;
    this.eventSnapshot = null;
    this.autoWalk = false;
    this.crouch = false;
    this.campPlacing = null;
    this.lure = null;
    this.vy = 0;
    this.falling = false;
    this.edgeHold = 0;
    this.moving = false;
    this.restTimer = 0;
    this.grade = 0;
    this.driftAngle = 0;
    this.expCache = { x: 1e9, z: 1e9, t: -1e9, v: 1 };
    this.lastEventCheck = 0;
    this.hudTimer = 0;
    this.saveTimer = 0;
    this.noteCd = {};

    for (const id of Object.keys(this.npcRt)) this._removeNpcMeshes(id);
    this.npcRt = {};
    if (this.player) this.world.scene.remove(this.player);
    if (this.tentMesh) { this.world.scene.remove(this.tentMesh); this.tentMesh = null; }

    if (!st.pos) {
      const p = mainPath.pointAt(4);
      st.pos = { x: p.x, z: p.z };
      st.s = 4;
    }
    this.player = this.world.shadowify(makeCharacter(this.role.look));
    this.world.scene.add(this.player);
    this.world.loadAllAround(st.pos.x, st.pos.z);
    const g = this.world.height(st.pos.x, st.pos.z);
    this.pos.set(st.pos.x, g, st.pos.z);
    this.player.position.copy(this.pos);
    const p = this.path().pointAt(st.s);
    const fdx = p.dx * st.dir, fdz = p.dz * st.dir;
    this.cam.yaw = Math.atan2(-fdx, -fdz);
    this.player.rotation.y = Math.atan2(fdx, fdz);
    this.camTarget.set(this.pos.x, this.pos.y + 1.5, this.pos.z);
    if (this.world.camera) {
      const { yaw, pitch, dist } = this.cam;
      this.world.camera.position.set(this.camTarget.x + Math.sin(yaw) * Math.cos(pitch) * dist, this.camTarget.y + Math.sin(pitch) * dist, this.camTarget.z + Math.cos(yaw) * Math.cos(pitch) * dist);
      this.world.camera.position.y = Math.max(this.world.camera.position.y, this.world.height(this.world.camera.position.x, this.world.camera.position.z) + 1.2);
      this.world.camera.lookAt(this.camTarget);
      this._displayTarget.copy(this.camTarget);
    }

    // 恢复驴友与营地
    for (const [id, ns] of Object.entries(st.npcs)) {
      if (ns.spawned && !ns.removed && !ns.dead) this._createNpcMeshes(npcById(id), ns);
    }
    if (st.camp) this._placeTentMesh();
    this.ui.showHud(true);
    this.refreshHud(true);
    if (st.ending?.pending) void this.finish(st.ending.type, st.ending.cause);
    else if (st.camp?.inside && !st.story.pendingEvent && !st.story.pendingNpc) this.ui.showCampMenu(this.campMenuInfo());
  }

  dispose() {
    this.eventCamera?.reset();
    this.clearEventActor();
    for (const id of Object.keys(this.npcRt)) this._removeNpcMeshes(id);
    this.npcRt = {};
    if (this.player) { this.world.scene.remove(this.player); this.player = null; }
    if (this.tentMesh) { this.world.scene.remove(this.tentMesh); this.tentMesh = null; }
    if (this.campPlacing) this.cancelCamp();
    this.world.showHallucination(0, 0, false);
    this.world.setHeadlamp(false);
    this.audio?.setWind(0, false);
    this.st = null;
    this.over = true;
  }

  // ———————————————————— 基础查询 ————————————————————
  path() { return this.st.path === 'main' ? mainPath : branches[this.st.path]; }
  get flags() { return this.st.flags; }
  roll(p) { return Math.random() < p; }
  isNurse() { return this.st.role === 'nurse'; }
  hasItem(id) { return has(this.st, id); }
  hasInsul() { return !!wornItems(this.st).insul; }
  inTent() { const c = this.st.camp; return !!(c?.inside && !c.bivy && !c.collapsed && c.health > 0); }
  hour() { return (((this.st.time % 1440) + 1440) % 1440) / 60; }
  day() { return Math.floor(this.st.time / 1440); }
  sunEl() { return sunElevation(this.hour()); }
  night() { return this.sunEl() < -0.05; }
  daylight() { return this.sunEl() > 0.05; }
  wx() { return weatherAt(this.st.schedule, this.st.time); }
  updateLampState() {
    const p = this.st.pos;
    const terrain = p ? columnInfo(Math.floor(p.x), Math.floor(p.z)).type : 'village';
    return updateLamp(this.st, { sunEl: this.sunEl(), wx: this.wx(), terrain });
  }
  setLampMode(mode) {
    if (!this.st || this.over || this.busy || this.eventRunning || !['auto', 'on', 'off'].includes(mode)) return;
    this.st.lampMode = mode;
    const result = this.updateLampState();
    this.toast(mode === 'auto' ? `头灯已设为自动：当前${result.on ? '照明' : '熄灭'}。` : mode === 'on' ? result.on ? '头灯已手动打开。' : '没有可用的头灯或电量不足。' : '头灯已手动关闭；自动模式不会覆盖此设置。', 'info');
    this.save();
    this.refreshHud(true);
  }
  foggy() { return this.wx().fog > 0.6; }
  here() { return columnInfo(Math.floor(this.pos.x), Math.floor(this.pos.z)); }
  alt() { return voxToAlt(this.world.height(this.pos.x, this.pos.z)); }
  airT() { return airTemp(this.alt(), this.hour(), this.wx(), this.day()); }
  isWalking() { return this.moving; }
  isResting() { return !this.moving && this.restTimer > 8; }
  fate(id) { return this.st.npcs[id]?.fate ?? null; }

  atWaypoint(id) {
    if (!this.st.visited[id] || this.st.path !== 'main') return false;
    const wp = mainPath.waypoints.find((w) => w.id === id);
    return Math.abs(this.st.s - wp.s) < 30;
  }
  inWanxian() { return this.st.path === 'main' && this.st.s > WANXIAN.from && this.st.s < WANXIAN.to; }

  signal() {
    if (this.st.path !== 'main') {
      const b = this.path();
      return this.st.s > b.length - 50 ? 1 : 0;
    }
    let best = 0;
    for (const wp of mainPath.waypoints) {
      if (!wp.signal) continue;
      const d = Math.abs(this.st.s - wp.s);
      if (d < 16) best = Math.max(best, wp.signal);
      else if (d < 34) best = Math.max(best, wp.signal - 1);
    }
    return best;
  }

  exposure() {
    const now = performance.now();
    const c = this.expCache;
    if (Math.hypot(this.pos.x - c.x, this.pos.z - c.z) < 1 && now - c.t < 1500) return c.v;
    c.v = this.exposureAt(this.pos.x, this.pos.z);
    c.x = this.pos.x; c.z = this.pos.z; c.t = now;
    return c.v;
  }

  exposureAt(x, z) {
    const info = columnInfo(Math.floor(x), Math.floor(z));
    const base = { village: 0.4, forest: 0.35, meadow: 0.75, ridge: 1.0, knife: 1.15, stone: 0.9, plateau: 0.85 }[info.type] ?? 0.9;
    let e = base;
    const alt = voxToAlt(info.h);
    if (alt < 2900) e *= 0.65;
    const { from } = windVectors(this.wx().dirDeg);
    const h0 = this.world.height(x, z);
    let rise = 0;
    for (const k of [1.5, 3, 4.5, 6, 8]) {
      const h = this.world.height(x + from.x * k, z + from.z * k);
      rise = Math.max(rise, (h - h0) / k);
    }
    const shelter = clamp(rise * 1.5, 0, 0.72);
    e *= 1 - shelter;
    let crest = true;
    for (const [dx, dz] of [[3, 0], [-3, 0], [0, 3], [0, -3]]) if (this.world.height(x + dx, z + dz) > h0) crest = false;
    if (crest && info.type !== 'forest') e *= 1.12;
    return clamp(e, 0.15, 1.3);
  }

  windDanger() { return clamp((this.wx().wind * this.exposure() - 8) / 15, 0, 1); }
  onExposedRidge() { const t = this.here().type; return (t === 'ridge' || t === 'knife') && this.exposure() > 0.8; }

  visibility() {
    const wx = this.wx();
    let v = wx.vis;
    const el = this.sunEl();
    if (el < 0.02) {
      const lamp = this.st.lampOn && has(this.st, 'headlamp') && this.st.bat.headlamp > 0;
      const nightVis = lamp ? (this.st.story.effects.headlampFault ? 14 : 26) : 7 + (1 - wx.overcast) * 10;
      v = Math.min(v, lerp(nightVis, v, clamp((el + 0.15) / 0.17, 0, 1)));
    }
    v *= 1 - this.st.body.snowblind / 160;
    if (this.st.body.core < 33.5) v *= 0.75;
    return Math.max(5, v);
  }

  // ———————————————————— 帧更新 ————————————————————
  update(dt) {
    if (!this.st || this.over) return;
    dt = Math.min(dt, 0.1);
    this.updateLampState();
    const modal = this.ui.modalOpen;
    const canAct = !modal && !this.busy && !this.eventRunning;
    this.moving = false;
    if (canAct && !(this.st.camp && this.st.camp.inside)) this.updateMovement(dt);
    if (canAct) {
      this.restTimer = this.moving ? 0 : this.restTimer + dt;
      const pacing = advanceEventPacing(this.st, dt, this.moving);
      // 未移动的新局只展示操作界面，不偷跑时间、扣资源或自动弹事件。
      if (this.st.story.pendingEvent || this.st.story.pendingNpc) {
        this.checkTriggers(dt);
      } else if (pacing.started) {
        this.simulate(dt * TIME_SCALE);
        this.updateGust(dt);
        this.checkTriggers(dt);
      }
    }
    this.updateNpcs(dt);
    this.updateVisuals(dt);
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) { this.refreshHud(); this.hudTimer = 0.12; }
    this.saveTimer += dt;
    if (this.saveTimer > 20 && canAct) { this.save(); this.saveTimer = 0; }
  }

  activity() {
    if (this.st.camp && this.st.camp.inside) return 'rest';
    if (this.crouch) return 'crouch';
    if (this.moving) return 'walk';
    return 'idle';
  }

  // ———————————————————— 移动 ————————————————————
  travelPace() { return paceProfile(this.st, this.crouch); }

  togglePace() {
    if (!this.st || this.over || this.busy || this.eventRunning || this.ui.modalOpen) return;
    this.st.pace = this.st.pace === 'fast' ? 'walk' : 'fast';
    this.log(this.st.pace === 'fast' ? '切换速穿配速' : '恢复常速行进');
    this.toast(this.st.pace === 'fast' ? '速穿：步子加快，消耗和受伤风险也会提高。' : '你放缓了脚步，恢复常速。', this.st.pace === 'fast' ? 'warn' : 'info');
    this.save();
    this.refreshHud(true);
  }

  speedFactor() {
    const st = this.st, b = st.body;
    const info = this.here();
    let f = this.role.mods.speed * (TERRAIN[info.type]?.speed ?? 0.8);
    if (info.ice && !has(st, 'crampons') && !has(st, 'microspikes')) f *= 0.65;
    if (b.stamina < 25) f *= 0.5 + (b.stamina / 25) * 0.5;
    if (b.sprain > 0) f *= 0.6;
    if (b.fracture > 0) f *= b.fracture >= 1 ? 0.4 : 0.6;
    if (b.core < 35) f *= 0.85;
    if (b.core < 33) f *= 0.65;
    if (b.frostbite > 60) f *= 0.85;
    const w = packWeight(st), cap = packCapacity(st);
    if (w > cap) f *= 0.75;
    if (this.night() && !(st.lampOn && st.bat.headlamp > 0)) f *= 0.5;
    if (st.flags.snowDepth > 0.5 && info.type === 'forest') f *= 0.85;
    for (const id of st.companions) f = Math.min(f, (npcById(id)?.speed ?? 1) * this.role.mods.speed);
    f *= this.travelPace().speed;
    if (st.story.effects.runnerPaceUntil > st.time) f *= 0.85;
    if (st.story.effects.sharedLoadUntil > st.time && st.companions.length) f *= 1.06;
    if (this.grade > 0.05) f *= clamp(1 - this.grade * 0.45, 0.45, 1);
    return f;
  }

  autoTarget() {
    const st = this.st;
    const path = this.path();
    if (this.lure) return this.lure;
    const near = path.nearestNear(this.pos.x, this.pos.z, st.s, 60);
    const vis = this.visibility();
    const gps = st.gpsOn && st.bat.gps > 0 && has(st, 'gps');
    if (near.d > 5.5) {
      if (gps || vis > near.d + 8) return path.pointAt(near.s);
      return null;
    }
    const p = path.pointAt(near.s + st.dir * 7);
    if (!gps && vis < 45) {
      this.driftAngle = clamp(this.driftAngle + (Math.random() - 0.5) * 0.08, -0.9, 0.9);
      const checked = st.story.effects.navigationCheckedUntil > st.time;
      const doubtful = st.story.effects.navigationDoubtUntil > st.time;
      const k = (1 - vis / 45) * (checked ? 0.35 : doubtful ? 1.2 : 0.9);
      const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
      const a = this.driftAngle * k;
      return { x: this.pos.x + dx * Math.cos(a) - dz * Math.sin(a), z: this.pos.z + dx * Math.sin(a) + dz * Math.cos(a) };
    }
    this.driftAngle *= 0.95;
    return p;
  }

  updateMovement(dt) {
    const st = this.st, b = st.body;
    const inp = this.input.move();
    this.crouch = this.input.crouchHeld();
    let mx = 0, mz = 0;
    if (inp.mag > 0.08) {
      const y = this.cam.yaw;
      const fx = -Math.sin(y), fz = -Math.cos(y);
      const rx = Math.cos(y), rz = -Math.sin(y);
      mx = fx * inp.y + rx * inp.x;
      mz = fz * inp.y + rz * inp.x;
      const L = Math.hypot(mx, mz);
      const m = Math.min(1, inp.mag);
      mx = (mx / L) * m; mz = (mz / L) * m;
      if (this.lure && inp.mag > 0.5) this._clearLure(false);
    } else if (this.autoWalk) {
      const t = this.autoTarget();
      if (!t) {
        this.autoWalk = false;
        this.toast('看不见路标了，无法判断方向。打开GPS，或者等雾散、天亮。', 'warn', 5000);
      } else {
        const dx = t.x - this.pos.x, dz = t.z - this.pos.z;
        const L = Math.hypot(dx, dz);
        if (L > 0.3) { mx = dx / L; mz = dz / L; }
      }
    }
    if (b.collapsed) {
      if (b.stamina > 14) { b.collapsed = false; this.toast('你缓过来一点了。', 'info'); }
      else { mx = 0; mz = 0; }
    }
    if (this.crouch) { mx = 0; mz = 0; }
    let pushX = 0, pushZ = 0;
    if (this.gust.push > 0) { pushX = this.push.x; pushZ = this.push.y; }

    const speed = BASE_SPEED * this.speedFactor();
    const dx = mx * speed * dt + pushX * dt;
    const dz = mz * speed * dt + pushZ * dt;
    if (Math.abs(dx) + Math.abs(dz) > 1e-4) {
      const g0 = this.world.height(this.pos.x, this.pos.z);
      const moved = this._tryMove(dx, dz, g0, dt, this.gust.push > 0);
      if (moved && (mx || mz)) {
        this.moving = true;
        const g1 = this.world.height(this.pos.x, this.pos.z);
        const dist = Math.hypot(dx, dz) || 1;
        this.grade = lerp(this.grade, clamp((g1 - g0) / dist, -1.5, 1.5), 0.1);
        this.player.rotation.y = lerpAngle(this.player.rotation.y, Math.atan2(mx, mz), Math.min(1, dt * 10));
        st.stats.walked += dist;
        if (this.audio) this.audio.step(dt, speed);
      }
    } else {
      this.grade *= 0.9;
    }
    if (b.stamina <= 0 && this.moving && !b.collapsed) {
      b.collapsed = true;
      this.autoWalk = false;
      this.toast('你的腿一软，坐倒在雪里。体力耗尽了——休息、吃东西。', 'danger', 5000);
    }

    // 竖直方向
    const ground = this.world.height(this.pos.x, this.pos.z);
    if (this.falling) {
      this.vy -= 30 * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= ground) {
        const h = this.fallStartY - ground;
        this.pos.y = ground;
        this.falling = false;
        this.vy = 0;
        if (h > 2.5) this.fall(h);
      }
    } else if (this.pos.y - ground > 2.4) {
      this.falling = true;
      this.fallStartY = this.pos.y;
      this.vy = 0;
    } else {
      this.pos.y = lerp(this.pos.y, ground, Math.min(1, dt * (ground > this.pos.y ? 18 : 10)));
    }
    st.pos.x = this.pos.x;
    st.pos.z = this.pos.z;
    this.updateProgress();
  }

  _tryMove(dx, dz, g0, dt, forced) {
    const test = (nx, nz) => {
      const g1 = this.world.height(nx, nz);
      if (g1 - g0 > 1.05) return 'block';
      if (g0 - g1 > 2.2 && !forced) return 'edge';
      return 'ok';
    };
    let nx = this.pos.x + dx, nz = this.pos.z + dz;
    let r = test(nx, nz);
    if (r === 'block') {
      if (test(this.pos.x + dx, this.pos.z) === 'ok') { nz = this.pos.z; r = 'ok'; }
      else if (test(this.pos.x, this.pos.z + dz) === 'ok') { nx = this.pos.x; r = 'ok'; }
    }
    if (r === 'edge') {
      this.edgeHold += dt;
      if (this.edgeHold < 0.5) {
        if (!this.noteCd.edge || performance.now() - this.noteCd.edge > 3000) {
          this.noteCd.edge = performance.now();
          this.toast('前面是陡坎。继续推摇杆会跳下去。', 'warn', 2500);
        }
        return false;
      }
      this.edgeHold = 0;
      r = 'ok';
    } else this.edgeHold = 0;
    if (r !== 'ok') return false;
    this.pos.x = nx;
    this.pos.z = nz;
    return true;
  }

  updateProgress() {
    const st = this.st;
    // 主线 ↔ 所有虚构下撤支线；靠真实移动进入，不传送。
    if (st.path === 'main') {
      const nm = mainPath.nearestNear(this.pos.x, this.pos.z, st.s, 60);
      for (const b of Object.values(branches)) {
        if (Math.abs(st.s - b.fromS) >= 90) continue;
        const nb = b.nearest(this.pos.x, this.pos.z);
        if (nb.d < 3 && nb.s > 14 && nm.d > 10) {
          st.path = b.id; st.s = nb.s; st.dir = 1;
          this.toast(`你走进了${b.def.name}。这是游戏改编分支。`, 'info');
          break;
        }
      }
    } else {
      const b = branches[st.path];
      const nb = b.nearestNear(this.pos.x, this.pos.z, st.s, 40);
      const nm = mainPath.nearest(this.pos.x, this.pos.z);
      if (nb.s < 10 && nm.d < nb.d) { st.path = 'main'; st.s = nm.s; st.dir = -1; this.toast('你回到了主线山脊，朝塘口方向。', 'info'); }
    }
    const path = this.path();
    const near = st.flags.freeDescent ? path.nearest(this.pos.x, this.pos.z) : path.nearestNear(this.pos.x, this.pos.z, st.s, 60);
    st.s = near.s;
    this.offTrail = near.d;
    if (st.path === 'main' && this.offTrail < 35) st.maxS = Math.max(st.maxS, st.s);
    const nav = this.role.mods.nav * (st.gpsOn && st.bat.gps > 0 ? 1.6 : 1);
    const lostAt = 16 * nav;
    const wasLost = st.flags.lost;
    st.flags.lost = near.d > lostAt;
    if (st.flags.lost && !wasLost) this.toast('你偏离了路线。四周的地形看起来都差不多……', 'danger', 5000);
    if (!st.flags.lost && wasLost) { this.toast('你找回了路。', 'good'); this.addStress(-5); }
    const alt = voxToAlt(this.pos.y);
    st.stats.maxAlt = Math.max(st.stats.maxAlt, alt);
  }

  // ———————————————————— 阵风 ————————————————————
  updateGust(dt) {
    const st = this.st;
    const wx = this.wx();
    const eff = wx.wind * wx.gust * this.exposure();
    if (eff < 12.5 || (st.camp && st.camp.inside) || this.falling) {
      this.gust.timer = Math.max(this.gust.timer, 4);
      this.gust.warn = 0;
      if (this.gust.push > 0) this.gust.push -= dt;
      return;
    }
    if (this.gust.push > 0) this.gust.push -= dt;
    if (this.gust.warn > 0) {
      this.gust.warn -= dt;
      if (this.gust.warn <= 0) {
        const { to } = windVectors(wx.dirDeg);
        if (this.crouch) {
          if (this.roll(0.3)) this.toast('你压低重心，扛住了这阵风。', 'good', 1800);
        } else {
          const f = (eff - 9) * 0.22;
          this.push.set(to.x * f, to.z * f);
          this.gust.push = 0.65;
          this.audio?.gustHit();
          if (this.roll(clamp((eff - 14) / 30, 0, 0.35))) {
            this.hurt(3, 'fall');
            this.addStress(6);
            this.toast('一阵狂风把你掀翻在地！', 'danger', 2500);
          }
        }
      }
    } else {
      this.gust.timer -= dt;
      if (this.gust.timer <= 0) {
        this.gust.warn = 1.1;
        this.gust.timer = (5 + Math.random() * 9) * clamp(22 / eff, 0.5, 1.5);
        this.ui.gustWarn();
        this.audio?.gustWarn();
      }
    }
  }

  // ———————————————————— 模拟 ————————————————————
  ctx() {
    const st = this.st;
    const h = this.world.height(this.pos.x, this.pos.z);
    const info = this.here();
    const camp = st.camp && st.camp.inside && !st.camp.bivy ? st.camp : null;
    const wx = this.wx();
    let exposure = this.exposure();
    if (st.camp && st.camp.bivy) exposure *= 0.8;
    return { alt: voxToAlt(h), hour: this.hour(), day: this.day(), wx, exposure, inTent: !!camp, camp, type: info.type, ice: info.ice };
  }

  simulate(minutes, modeOverride, opts = {}) {
    const st = this.st;
    this.updateLampState();
    const c = this.ctx();
    const env = computeEnv(st, c);
    if (env.tentInfo && st.story.effects.tentLeak) {
      env.Teff -= 2;
      env.tentInfo.Tin -= 2;
      env.precip = c.wx.precip * 0.15;
    }
    this.env = env;
    this.c = c;
    const mode = modeOverride ?? this.activity();
    const T = TERRAIN[c.type] ?? TERRAIN.ridge;
    const w = packWeight(st), cap = packCapacity(st);
    let load = 1 + Math.max(0, w - 6) * 0.03 * (this.role.mods.heavyLoad ?? 1);
    if (w > cap) load *= 1.4;
    const sunEl = this.sunEl();
    const effort = clamp(1 + Math.max(0, this.grade) * 2.2 + Math.max(0, -this.grade) * 0.5, 0.7, 2.6) * (st.story.effects.runnerPaceUntil > st.time ? 0.8 : 1) * this.travelPace().effort;
    const act = {
      mode, effort, downhill: this.grade < -0.12, terrainStamina: T.stamina * (st.flags.snowDepth > 0.5 ? 1.12 : 1),
      load, snowDeep: T.snow + (st.flags.snowDepth || 0), alt: c.alt,
      sunny: c.wx.overcast < 0.4 && sunEl > 0.1, night: sunEl < -0.05, severity: c.wx.severity,
      lost: !!st.flags.lost, alone: st.companions.length === 0, companions: st.companions.length, signal: this.signal() > 0,
    };
    st.flags.blanketOn = has(st, 'blanket') && (mode === 'rest' || mode === 'sleep' || mode === 'idle');
    const notes = stepBody(st, env, act, minutes, this.role);
    st.time += minutes;
    this.updateLampState();

    // 积雪
    st.flags.snowDepth = clamp((st.flags.snowDepth || 0) + (c.wx.precip * 0.004 - 0.0008) * minutes, 0, 1.2);

    // 营地
    if (st.camp && env.tentInfo) {
      const over = env.tentInfo.tentWind - env.tentInfo.rating;
      if (over > 0) st.camp.health = Math.max(0, st.camp.health - over * 0.07 * minutes);
    }
    this.simCompanions(minutes, c, env, mode);
    if (!opts.skip && mode === 'walk') this.rollHazards(minutes, c, env);

    st.stats.minCore = Math.min(st.stats.minCore, st.body.core);
    st.stats.coldestFelt = Math.min(st.stats.coldestFelt, env.inTent ? env.Teff : env.Teff);
    for (const n of notes) if (n === 'powerbank_dead') this.toast('充电宝在低温下冻死机了，再也开不了机。', 'danger', 5000);
    this.thresholdNotes(env);
    this.checkDeath();
    if (!this.over) this.simRescue();
  }

  rollHazards(minutes, c, env) {
    const st = this.st, b = st.body;
    const vis = this.visibility();
    minutes *= this.travelPace().risk;
    const fatigue = 1 + (1 - b.stamina / 100);
    const cl = env.cl;
    if (c.type === 'stone') {
      let p = 0.0011 * fatigue * (has(st, 'poles') ? 0.6 : 1) * (cl.worn.shoes === 'boots' ? 0.65 : 1)
        * (vis < 40 ? 1.5 : 1) * (this.night() ? 2 : 1) * (b.stress > 60 ? 1.3 : 1);
      if (this.roll(p * minutes)) {
        if (b.sprain > 0 && this.roll(0.25)) {
          b.fracture = Math.max(b.fracture, 1);
          this.hurt(15, 'injury');
          this.addStress(15);
          this.toast('石块在脚下翻滚——你重重摔倒，小腿传来一声闷响。骨折了。', 'danger', 6000);
        } else {
          b.sprain = 1;
          this.hurt(6, 'injury');
          this.addStress(8);
          this.toast('一块松动的石头翻了过来。你崴了脚。', 'danger', 4500);
        }
      }
    }
    const icy = (c.type === 'knife' || c.type === 'ridge' || c.ice) && (st.flags.snowDepth > 0.2 || c.wx.fog > 0.5 || c.ice);
    if (icy) {
      const ice = has(st, 'crampons') ? ITEMS.crampons.ice : has(st, 'microspikes') ? ITEMS.microspikes.ice : 0;
      const p = 0.0009 * (1 - ice) * (1.4 - cl.grip * 0.5) * fatigue * (has(st, 'poles') ? 0.7 : 1) * (this.night() ? 1.8 : 1);
      if (this.roll(p * minutes)) {
        if (c.type === 'knife' && this.roll(0.22)) {
          this.fall(6 + Math.random() * 14, '脚下是一层暗冰。你滑了出去，沿着雪坡一路往下……');
        } else {
          this.hurt(4, 'fall');
          this.addStress(6);
          this.toast('脚下打滑，你摔了一跤。冰爪能减少这种事。', 'warn', 3500);
        }
      }
    }
    if (this.night() && !(st.lampOn && st.bat.headlamp > 0) && this.roll(0.004 * minutes)) {
      this.hurt(5, 'injury');
      this.addStress(6);
      this.toast('黑暗里你被石头绊倒了。', 'warn');
    }
  }

  thresholdNotes(env) {
    const b = this.st.body;
    const note = (key, cond, text, kind = 'warn', cd = 120) => {
      if (!cond) return;
      const last = this.noteCd[key];
      if (last !== undefined && this.st.time - last < cd) return;
      this.noteCd[key] = this.st.time;
      this.toast(text, kind, 5000);
    };
    note('shiver', b.core < 36.3 && b.core >= 35, '你开始发抖了。', 'warn', 240);
    if (b.core < 35 && !this.noteCd.hypoSting) { this.noteCd.hypoSting = true; this.music?.stinger('danger'); }
    if (b.core > 35.6) this.noteCd.hypoSting = false;
    note('hypo1', b.core < 35 && b.core >= 33.5, '寒战越来越剧烈，手指不听使唤——轻度失温。吃热的、穿上保暖层、找地方避风。', 'danger', 120);
    note('hypo2', b.core < 33.5, '你的思维变得很慢，周围的声音好像隔了一层……', 'danger', 90);
    note('hungry', b.food < 20 && b.food > 5, '饿得发慌。身体没有燃料，就产不出热量。', 'warn', 180);
    note('starve', b.food <= 5, '你已经没有任何能量了。', 'danger', 120);
    note('thirst', b.water < 20, '口渴得厉害。冬季脱水同样致命。', 'warn', 180);
    note('wet', b.wet > 50, '衣服湿透了，保暖能力大打折扣。', 'warn', 240);
    note('tired', b.stamina < 15 && this.moving, '腿像灌了铅。', 'warn', 90);
    note('frost', b.frostbite > 25, '手指和脚趾失去了知觉——冻伤。', 'danger', 300);
    note('snowblind', b.snowblind > 50, '眼睛刺痛流泪——雪盲。雪镜不是装饰品。', 'warn', 300);
    note('altsick', b.altSick > 40, '头疼欲裂，有点恶心——轻微高反。', 'warn', 360);
    note('phone', this.st.bat.phone < 15 && this.st.bat.phone > 0, '手机电量不足15%。', 'warn', 600);
    note('lamp', this.st.lampOn && this.st.bat.headlamp < 10, '头灯快没电了。', 'warn', 300);
    if (env.tentInfo && this.st.camp) note('tentwind', env.tentInfo.tentWind > env.tentInfo.rating * 0.8, '帐篷被风吹得猎猎作响，帐杆在弯。', 'danger', 120);
  }

  checkDeath() {
    const b = this.st.body;
    if (this.over) return;
    if (b.core < 28) return this.die('hypothermia');
    if (b.health <= 0) return this.die(b.lastHarm || 'hypothermia');
  }

  hurt(v, cause) {
    const b = this.st.body;
    b.health = clamp(b.health - v * difficultyProfile(this.st).damage, 0, maxHealth(this.st));
    b.lastHarm = cause;
    this.ui.flash('hurt');
    this.checkDeath();
  }

  addStress(v) {
    const b = this.st.body;
    b.stress = clamp(b.stress + (v > 0 ? v * this.role.mods.stressGain : v), 0, 100);
  }

  fall(h, msg) {
    const b = this.st.body;
    this.autoWalk = false;
    this.addStress(10 + h);
    if (msg) this.toast(msg, 'danger', 5000);
    if (h > 16) return this.die('fall');
    if (h > 10) {
      this.hurt(60 + Math.random() * 20, 'fall');
      b.fracture = 1;
      this.toast('你摔断了腿。剧痛之下，你几乎站不起来。', 'danger', 6000);
    } else if (h > 6) {
      this.hurt(28, 'fall');
      if (this.roll(0.5)) { b.fracture = 1; this.toast('落地时你听到了骨头的声音。骨折。', 'danger', 6000); }
      else { b.sprain = 1; this.toast('你重重摔在石头上，崴了脚。', 'danger', 5000); }
    } else if (h > 3) {
      this.hurt(10, 'fall');
      if (this.roll(0.4)) b.sprain = 1;
      this.toast('你从陡坎上摔了下去。', 'warn', 3500);
    } else this.hurt(2, 'fall');
  }

  // ———————————————————— 触发器 ————————————————————
  checkTriggers(dt) {
    const st = this.st;
    if (this.eventRunning || this.over) return;
    if (st.story.pendingEvent) {
      const pending = ALL_EVENTS.find((ev) => ev.id === st.story.pendingEvent);
      if (pending) return this.runScheduledEvent(pending);
      st.story.pendingEvent = null;
    }
    if (st.story.pendingNpc) {
      const id = st.story.pendingNpc;
      if (this.npcRt[id]) return this.runEvent(() => this.meetNpc(id), { focus: { npc: id } });
      st.story.pendingNpc = null;
    }
    const exit = travelEnding(st, this.pos, { falling: this.falling, groundY: this.world.height(this.pos.x, this.pos.z) });
    if (exit) return this.finish(exit);
    if (!ensureEventPacing(st).started) return;
    // 管护站
    if (!st.flags.gateDone && st.path === 'main' && st.s > 30) return this.runEvent(() => this.gateScene(), { focus: { landmark: 'gate' } });
    // 途经点
    if (st.path === 'main') {
      for (const wp of mainPath.waypoints) {
        if (st.visited[wp.id]) continue;
        if (Math.abs(st.s - wp.s) < 10 && this.offTrail < 18) {
          st.visited[wp.id] = st.time;
          this.ui.card(wp.name, `海拔约 ${wp.alt} m · ${wp.km} km`, wp.desc);
          this.music?.stinger('waypoint');
          this.log(`抵达${wp.name}`);
          this.addStress(-3);
          this.save();
          if (wp.end) return this.finish('cross');
          if (wp.id === 'dayehai') return this.runEvent(() => this.dayehaiScene(), { focus: { landmark: 'dayehai' } });
        }
      }
    }
    // 天气预兆
    const wx = this.wx();
    const lead = has(st, 'watch') ? 240 : st.role === 'veteran' ? 170 : 110;
    for (let i = wx.idx + 1; i < Math.min(st.schedule.length, wx.idx + 3); i++) {
      const e = st.schedule[i];
      if (!e.warn || st.warned[e.t]) continue;
      if (e.t - st.time < lead && e.t > st.time) {
        st.warned[e.t] = true;
        if (st.camp && st.camp.inside) continue;
        const name = e.warn === 'fog' ? '大雾' : e.warn === 'gale' ? '大风' : '冷锋';
        this.toast(`天气预警：${name}将至。提前评估避风、扎营或下撤。`, 'warn', 6000);
        this.log(`天气预警：${name}将至`);
        this.save();
        break;
      }
    }
    // 日落提醒
    const hr = this.hour();
    const dkey = 'sunset' + this.day();
    if (hr > 16.3 && hr < 18 && !st.flags[dkey] && !(st.camp && st.camp.inside)) {
      st.flags[dkey] = true;
      this.toast('太阳快落山了。冬天的夜晚有十四个小时——天黑前找好营地。', 'warn', 6000);

    }

    // 诱惑（幻觉）
    if (this.lure) {
      const d = Math.hypot(this.pos.x - this.lure.x, this.pos.z - this.lure.z);
      this.lure.t = (this.lure.t || 0) + dt;
      if (d < 3 || this.lure.t > 40) this._clearLure(true);
    }
    // 呼救声
    for (const [id, rt] of Object.entries(this.npcRt)) {
      if (!rt.def.calls || rt.ns.met) continue;
      const d = Math.hypot(this.pos.x - rt.ns.x, this.pos.z - rt.ns.z);
      if (d < 32 && !st.flags['heard_' + id]) {
        st.flags['heard_' + id] = true;
        this.toast('风声里，你好像听到有人在喊"有人吗——"。声音从路边的石缝那边传来。', 'info', 6000);
      }
    }
    // 驴友
    this.checkNpcSpawns();
    for (const [id, rt] of Object.entries(this.npcRt)) {
      const ns = rt.ns;
      if (ns.met || ns.done || ns.following) continue;
      const d = Math.hypot(this.pos.x - ns.x, this.pos.z - ns.z);
      if (d < 3.6) return this.runEvent(() => this.meetNpc(id), { focus: { npc: id } });
      if (ns.path === st.path && st.dir > 0 && st.s > ns.s + 36) {
        ns.done = true;
        ns.fate = PASS_FATE[id] ?? null;
        ns.passed = true;
        if (rt.marker) rt.marker.visible = false;
      }
    }
    // 条件候选池，而不是数组中第一个命中的事件。
    this.lastEventCheck += dt;
    if (this.lastEventCheck > 1.4) {
      this.lastEventCheck = 0;
      const ev = chooseEvent(ALL_EVENTS.filter(def => eventEncounterAllowed(st, def)), this);
      if (ev) return this.runScheduledEvent(ev);
    }
  }

  repairEquipment(id) {
    if (this.busy || this.eventRunning || this.over) return;
    const ev = EXPANDED_EVENTS.find((e) => e.id === id);
    if (ev && (id === 'headlamp_contact' && this.st.story.effects.headlampFault || id === 'windproof_lash' && this.st.story.effects.tentLeak && this.st.camp?.inside)) return this.runScheduledEvent(ev);
  }

  async runScheduledEvent(ev) {
    if (this.eventRunning || this.over) return;
    const st = this.st;
    st.story.pendingEvent = ev.id;
    // 事件结算是一个存档事务：刷新恢复到对话前，不会重复消耗物资。
    this.eventSnapshot = JSON.stringify(st);
    this.ui.hideCampMenu();
    this.save();
    try {
      await this.runEvent(async () => {
        await ev.run(this);
        if (!this.over && this.st === st) completeEvent(st, ev);
      }, { propagate: true, paced: true, focus: { event: ev.id } });
    } catch (error) {
      if (this.st === st && !this.over) {
        const restored = JSON.parse(this.eventSnapshot);
        restored.story.pendingEvent = null;
        restored.story.lastAmbientAt = restored.time;
        this.start(restored);
        this.save();
        this.toast('这段事件未能完成，已恢复到选择前的状态。', 'warn');
      }
    } finally {
      this.eventSnapshot = null;
      if (this.st === st) {
        this.save();
        if (!this.over && st.camp?.inside && !this.campPlacing) this.ui.showCampMenu(this.campMenuInfo());
      }
    }
  }

  async storyDialog(id, opts) {
    const st = this.st;
    const choice = await this.dialog({ ...opts, sub: opts.sub ?? '虚构情境 · 选择会影响后续' });
    if (this.over || this.st !== st) return null;
    const label = opts.choices.find((c) => c.id === choice)?.label ?? choice;
    st.story.choices[id] = choice;
    st.story.decisions.push({ id, choice, label, time: st.time, who: opts.who });
    if (st.story.decisions.length > 80) st.story.decisions.shift();
    this.log(`${opts.who}：${label}`);
    return choice;
  }

  recordStory(key, value = true) { this.st.story.threads[key] = value; }
  storyValue(key) { return this.st.story.threads[key]; }
  giveItem(id, n = 1) { if (n > 0) addItem(this.st, id, n); }
  takeItem(id, n = 1) {
    if (!(n > 0) || (this.st.inv[id] || 0) < n) return false;
    return removeItem(this.st, id, n);
  }
  spendBattery(key, n) {
    if (!(n >= 0) || !(key in this.st.bat) || this.st.bat[key] < n) return false;
    this.st.bat[key] = clamp(this.st.bat[key] - n, 0, 100);
    return true;
  }
  changeBody(key, delta) {
    if (this.over || !Number.isFinite(delta) || !(key in this.st.body)) return;
    if (key === 'stress') return this.addStress(delta);
    const bounds = key === 'core' ? [20, 37.6] : key === 'health' ? [0, maxHealth(this.st)] : ['sprain', 'fracture'].includes(key) ? [0, 1] : [0, 100];
    if (key === 'health' && delta < 0) delta *= difficultyProfile(this.st).damage;
    this.st.body[key] = clamp(this.st.body[key] + delta, ...bounds);
    if (key === 'health' && delta < 0) this.st.body.lastHarm = 'injury';
    this.checkDeath();
  }
  async eventPause(minutes) {
    const st = this.st;
    await this.passTime(minutes);
    return this.st === st && !this.over;
  }
  updateRescuePosition() {
    const st = this.st, r = st.rescue;
    if (!r || !r.self || !this.comms().any) return false;
    const method = this.comms().sat ? 'satcomm' : 'phone';
    if (!this.spendBattery(method, method === 'satcomm' ? 4 : 5)) return false;
    const moved = Math.hypot(this.pos.x - r.x, this.pos.z - r.z) > 10;
    r.x = this.pos.x; r.z = this.pos.z; r.moved = false; r.near = false;
    if (moved) r.eta = Math.max(r.eta, st.time + 120);
    this.recordStory('rescueContact');
    this.recordStory('rescueUpdated');
    this.recordStory('rescueUpdatedAt', st.time);
    this.save();
    this.log('向救援队更新了当前位置');
    this.toast('新位置已确认。接下来不要擅自离开，必要转移时继续保持联系。', 'good', 6000);
    return true;
  }

  clearEventActor() {
    if (this._eventActor) {
      this.world.scene.remove(this._eventActor);
      // 工厂材质共享，只释放本次临时模型独有的几何体。
      this._eventActor.traverse((o) => o.geometry?.dispose());
      this._eventActor = null;
    }
    this._eventFocus = null;
  }

  beginEventFocus(spec) {
    if (!this.eventCamera || !this.world?.camera || !this.world?.scene || this.eventCamera.reducedMotion) return false;
    this.clearEventActor();
    let target, kind = 'self', id = spec.npc || spec.landmark || spec.event;
    if (spec.object?.position) { target = spec.object.position.clone().add(new THREE.Vector3(0, 1.2, 0)); kind = 'object'; }
    const npc = spec.npc && this.npcRt[spec.npc];
    if (npc?.group) {
      target = npc.group.position.clone().add(new THREE.Vector3(0, 1.2, 0));
      kind = 'npc';
    }
    const sites = { navtower: ['daohang', 5, 0, 3], plane: ['feiji', 7, 4, 1], leigong: ['leigong', 5, 1, 1.3], ridge_wind: ['aoliang', -3.2, 2, 1.8], gate: ['gate', 7, 0, 1.5], dayehai: ['dayehai', -7, 2, 1.5] };
    const site = sites[spec.landmark || spec.event];
    if (!target && site) {
      const wp = mainPath.waypoints.find((w) => w.id === site[0]);
      const p = mainPath.pointAt(wp.s), x = p.x - p.dz * site[1] + p.dx * site[2], z = p.z + p.dx * site[1] + p.dz * site[2];
      const object = this.world.landmarks?.reduce((best, o) => !best || Math.hypot(o.position.x - x, o.position.z - z) < Math.hypot(best.position.x - x, best.position.z - z) ? o : best, null);
      if (object && Math.hypot(object.position.x - this.pos.x, object.position.z - this.pos.z) < 40) {
        target = object.position.clone().add(new THREE.Vector3(0, site[3], 0)); kind = 'landmark';
      }
    }
    const companionEvents = new Set(['shared_load', 'reported_solo_probe']);
    if (!target && companionEvents.has(spec.event)) {
      const rt = this.st.companions.map((n) => this.npcRt[n]).find((r) => r?.group && !r.ns.dead);
      if (rt) { target = rt.group.position.clone().add(new THREE.Vector3(0, 1.2, 0)); kind = 'npc'; }
    }
    if (!target && spec.event === 'windproof_lash' && this.tentMesh) { target = this.tentMesh.position.clone().add(new THREE.Vector3(0, .8, 0)); kind = 'object'; }
    const props = new Set(['takin', 'loose_marker', 'false_trail']);
    const visitors = new Set(['hot_water_share', 'mutual_followup', 'coder_overload', 'reported_last_seen']);
    if (!target && (visitors.has(spec.event) || props.has(spec.event) || spec.event === 'old_tent')) {
      const yaw = this.cam.yaw;
      for (const side of [1.8, -1.8, 0]) {
        const x = this.pos.x + Math.sin(yaw) * 3.5 + Math.cos(yaw) * side;
        const z = this.pos.z + Math.cos(yaw) * 3.5 - Math.sin(yaw) * side;
        const y = this.world.height(x, z);
        if (!Number.isFinite(y) || Math.abs(y - this.pos.y) > 2.2) continue;
        const actor = props.has(spec.event) ? makeEventProp(spec.event) : spec.event === 'old_tent' ? makeCollapsedTent(0x8b8879) : makeCharacter({ jacket: 0xc18b50, hat: 0xd6d0ba, pack: 0x454f50 });
        actor.position.set(x, y, z); actor.rotation.y = Math.atan2(this.pos.x - x, this.pos.z - z);
        actor.userData.eventVisitor = visitors.has(spec.event);
        this._eventActor = this.world.shadowify(actor); this.world.scene.add(actor);
        target = actor.position.clone().add(new THREE.Vector3(0, spec.event === 'old_tent' ? .5 : 1.2, 0)); kind = visitors.has(spec.event) ? 'visitor' : 'object';
        break;
      }
    }
    target ||= this.pos.clone().add(new THREE.Vector3(0, 1.2, 0));
    const ok = this.eventCamera.focus(target, { position: this.world.camera.position, lookAt: this._displayTarget || this.camTarget, player: this.pos });
    if (ok) this._eventFocus = { kind, id, target: target.clone() };
    else this.clearEventActor();
    return ok;
  }

  async runEvent(fn, { propagate = false, focus = null, paced = false } = {}) {
    if (this.eventRunning) return;
    const st = this.st, serial = this._dialogSerial || 0;
    const previousSource = this._pollSource;
    this._pollSource = focus?.event ? `event:${focus.event}` : focus?.npc ? `npc:${focus.npc}` : focus?.landmark ? `scene:${focus.landmark}` : null;
    const source = this._pollSource, encounter = `${source}:${st.time.toFixed(3)}`;
    if (source) {
      this.analytics?.track('event_started', st, { eventId: source, uniqueKey: `start:${encounter}` });
      if (this.analytics?.enabled) this.save();
    }
    this.eventRunning = true;
    const focused = focus ? this.beginEventFocus?.(focus) : false;
    try {
      await fn();
      if (source && this.st === st) this.analytics?.track('event_completed', st, { eventId: source, uniqueKey: `complete:${encounter}` });
    }
    catch (e) { console.error(e); if (propagate) throw e; }
    finally {
      this._pollSource = previousSource;
      if (this.st === st) {
        if (!paced && !this.over && (this._dialogSerial || 0) !== serial) recordDialog(st);
        if (focused) this.eventCamera?.end();
        if (this.over) { this.eventCamera?.reset(); this.clearEventActor(); }
        this.eventRunning = false;
      }
    }
  }

  async gateScene() {
    const st = this.st;
    const c = await this.dialog({
      who: '管护站', sub: '12月31日 · 凌晨',
      text: [
        '管护站的灯还亮着。铁丝网上挂着一块红色的牌子："禁止穿越鳌太线 违者依法处罚"。',
        '铁丝网有一处被剪开的缺口，雪地上有几串新鲜的脚印。',
        '2012到2017年，至少46人在这条山脊上失踪或遇难。2018年起，鳌太穿越被明令禁止。',
      ],
      choices: [
        { id: 'go', label: '从缺口钻过去', sub: '违法进山' },
        { id: 'home', label: '回去。去景区吃烤肠', sub: '太白山国家森林公园有索道、栈道和烤肠' },
      ],
    });
    if (c === 'home') return this.finish('sausage');
    st.flags.gateDone = true;
    st.flags.illegal = true;
    const c2 = await this.dialog({
      who: '手机', sub: '网上的"攻略"',
      text: ['你想起网上的"攻略"：进山前把手机调成飞行模式，免得被基站定位、被罚款。', '可是一旦出事，救援队也同样找不到你。'],
      choices: [
        { id: 'air', label: '开飞行模式', sub: '躲避监测' },
        { id: 'keep', label: '保持开机', sub: '有信号的地方，至少能报警' },
      ],
    });
    st.airplane = c2 === 'air';
    this.toast(st.airplane ? '手机已开启飞行模式。' : '手机保持开机。', 'info');
    this.log(st.airplane ? '开启飞行模式，钻过铁丝网' : '钻过铁丝网，进入鳌太线');
    this.save();
  }

  async dayehaiScene() {
    const st = this.st;
    st.fines += 5000;
    const c = await this.dialog({
      who: '大爷海', sub: '保护区工作人员',
      text: [
        '湖边小屋里走出来一个穿着橙色冲锋衣的工作人员，上下打量了你一眼。',
        '"从鳌山那边过来的？"他叹了口气，"先进屋暖和一下吧。罚款的事，下山再说。"',
        '屋里有热水。你已经很久没有见过这么暖和的地方了。',
        '这是本局虚构接应情节。现实中高山区域可能封闭，小屋、索道、工作人员和通讯均不能保证可用。',
      ],
      choices: [
        { id: 'summit', label: '休整后登顶拔仙台', sub: '还有约3公里' },
        { id: 'down', label: '跟工作人员从景区下山', sub: '穿越到此为止' },
      ],
    });
    st.body.core = Math.max(st.body.core, 36.8);
    st.body.wet = Math.min(st.body.wet, 10);
    st.body.water = Math.max(st.body.water, 70);
    st.body.stamina = Math.max(st.body.stamina, 70);
    st.body.stress = Math.max(0, st.body.stress - 30);
    st.time += 120;
    for (const id of st.companions) if (st.npcs[id]) st.npcs[id].cond = 100;
    if (c === 'down') return this.finish('dayehai');
    this.toast('你在屋里喝了两杯热水，重新出发。', 'good');
  }

  async weatherWarning(e) {
    const st = this.st;
    const watch = has(st, 'watch');
    const nextCamp = this.nextCampInfo();
    const texts = {
      fog: ['山谷里的云在往上涌，翻过山脊时变成了白茫茫的一片。', '要起雾了。大雾里，十几米外的路标就会消失。'],
      front: [
        '风向变了。西边的天空压过来一道铅灰色的云墙，太阳像被人掐灭了一样。',
        watch ? '【气压表】三小时内气压下降了5hPa——冷锋要来了。' : '空气里有一股潮湿的寒意。',
      ],
      gale: ['远处山脊上扬起了一道道雪雾，风声越来越尖。', '接下来会有大风。在刃脊和山梁上，风能把人推下去。'],
    }[e.warn];
    const choices = [
      { id: 'push', label: `赶往${nextCamp.name}`, sub: nextCamp.km ? `还有约 ${nextCamp.km.toFixed(1)} km` : '' },
      { id: 'camp', label: '就地找背风处扎营', sub: tentItem(st) ? '在风雪来临前搭好帐篷' : '你没有帐篷——只能找石头背风处' },
      { id: 'retreat', label: '开始下撤', sub: this.canBranch() ? '原路返回 / 附近的改编支线' : '原路返回' },
    ];
    if (e.warn === 'fog' && has(st, 'gps')) choices.push({ id: 'gps', label: '打开GPS，继续走', sub: '耗电' });
    const c = await this.dialog({ who: '天气要变了', sub: e.warn === 'fog' ? '大雾' : e.warn === 'gale' ? '大风' : '冷锋过境', text: texts, choices });
    if (c === 'camp') this.beginCamp();
    else if (c === 'retreat') await this.retreatMenu();
    else if (c === 'gps') { st.gpsOn = true; this.toast('GPS 已打开。', 'info'); }
    else this.toast('你加快了脚步。', 'info');
  }

  nextCampInfo() {
    const st = this.st;
    if (st.path !== 'main') return { name: this.path().def?.name || '虚构支线', km: (this.path().length - st.s) * KM_PER_UNIT };
    const list = mainPath.waypoints.filter((w) => (w.camp || w.end) && (st.dir > 0 ? w.s > st.s + 5 : w.s < st.s - 5));
    const wp = st.dir > 0 ? list[0] : list[list.length - 1];
    if (!wp) return { name: '塘口', km: st.s * KM_PER_UNIT };
    return { name: wp.name, km: Math.abs(wp.s - st.s) * KM_PER_UNIT };
  }

  // ———————————————————— 驴友 ————————————————————
  checkNpcSpawns() {
    const st = this.st;
    if (st.dir < 0) return;
    const km = st.s * KM_PER_UNIT;
    for (const def of NPCS) {
      if (st.npcs[def.id]?.spawned) continue;
      if (def.path !== st.path) continue;
      if (!npcEncounterAllowed(st, def)) continue;
      if (km < def.fromKm || km > def.toKm) continue;
      if (def.requires && !def.requires(this)) continue;
      this.spawnNpc(def);
    }
  }

  spawnNpc(def) {
    const st = this.st;
    const path = def.path === 'main' ? mainPath : branches[def.path];
    const s = clamp(st.s + 18, 2, path.length - 4);
    const p = path.pointAt(s);
    const x = p.x - p.dz * def.side, z = p.z + p.dx * def.side;
    const ns = { spawned: true, x, z, s, path: def.path, cond: NPC_COND[def.id] ?? 60, fate: null, met: false, rot: Math.atan2(-p.dx, -p.dz) };
    st.npcs[def.id] = ns;
    this._createNpcMeshes(def, ns);
  }

  _createNpcMeshes(def, ns) {
    const group = new THREE.Group();
    const chars = [];
    const looks = def.looks || [def.look];
    looks.forEach((look, i) => {
      const ch = makeCharacter(look);
      if (look.pack === null) { ch.userData.pack.visible = false; }
      ch.position.set((i % 2) * 1.2 - (looks.length > 1 ? 0.6 : 0), 0, Math.floor(i / 2) * 1.2);
      ch.rotation.y = i * 0.7;
      animateCharacter(ch, 0, false, 1, ns.following ? 'stand' : def.pose);
      group.add(ch);
      chars.push(ch);
    });
    const gy = this.world.height(ns.x, ns.z);
    group.position.set(ns.x, gy, ns.z);
    group.rotation.y = ns.rot ?? 0;
    this.world.shadowify(group);
    this.world.scene.add(group);
    let tent = null;
    if (def.tentNearby || def.collapsedTent) {
      tent = def.collapsedTent ? makeCollapsedTent(0x3f7fbf) : makeTent(0x2e8b57);
      tent.position.set(ns.x + 2.2, this.world.height(ns.x + 2.2, ns.z), ns.z);
      tent.rotation.y = 0.6;
      this.world.shadowify(tent);
      this.world.scene.add(tent);
    }
    let marker = null;
    if (!ns.met && !ns.done) {
      marker = makeMarker(0xffc23a);
      marker.position.set(0, 2.6, 0);
      group.add(marker);
    }
    this.npcRt[def.id] = { id: def.id, def, ns, group, chars, tent, marker, walk: null };
  }

  _removeNpcMeshes(id) {
    const rt = this.npcRt[id];
    if (!rt) return;
    this.world.scene.remove(rt.group);
    if (rt.tent) this.world.scene.remove(rt.tent);
    delete this.npcRt[id];
  }

  async meetNpc(id) {
    const st = this.st, rt = this.npcRt[id];
    if (!rt || !st || this.over) return;
    const ownsSnapshot = !this.eventSnapshot;
    st.story.pendingNpc = id;
    if (ownsSnapshot) this.eventSnapshot = JSON.stringify(st);
    this.save();
    rt.ns.met = true;
    if (rt.marker) rt.marker.visible = false;
    this.autoWalk = false;
    this.log(`遇到了${rt.def.name}`);
    try {
      await rt.def.meet(this, rt);
      if (this.st === st) st.story.pendingNpc = null;
    } catch (error) {
      if (ownsSnapshot && this.st === st && !this.over) {
        const restored = JSON.parse(this.eventSnapshot);
        if (st.telemetry) restored.telemetry = st.telemetry; else delete restored.telemetry;
        restored.story.pendingNpc = null;
        this.start(restored);
        this.save();
        this.toast('这次交谈未能完成，已恢复到交谈前。', 'warn');
      }
      throw error;
    } finally {
      if (this.st === st) {
        if (ownsSnapshot) this.eventSnapshot = null;
        this.save();
      }
    }
  }

  updateNpcs(dt) {
    const st = this.st;
    if (!st) return;
    if (this.eventRunning) {
      for (const rt of Object.values(this.npcRt)) {
        const pose = rt.ns.dead ? 'lie' : rt.ns.following ? (this.st.camp?.inside ? 'sit' : 'stand') : rt.def.pose;
        rt.chars?.forEach((c) => animateCharacter(c, dt, false, 1, pose));
      }
      return;
    }
    let idx = 0;
    for (const [id, rt] of Object.entries(this.npcRt)) {
      const ns = rt.ns;
      if (rt.marker) rt.marker.position.y = 2.6 + Math.sin(performance.now() * 0.004) * 0.15;
      if (rt.walk) {
        rt.walk.t += dt;
        const path = ns.path === 'main' ? mainPath : branches[ns.path];
        rt.walk.s += rt.walk.dir * 2.6 * dt;
        const p = path.pointAt(rt.walk.s);
        ns.x = p.x; ns.z = p.z;
        rt.group.position.set(p.x, this.world.height(p.x, p.z), p.z);
        rt.group.rotation.y = Math.atan2(p.dx * rt.walk.dir, p.dz * rt.walk.dir);
        rt.chars.forEach((c, i) => { c.rotation.y = 0; animateCharacter(c, dt, true, 1, 'stand'); });
        if (rt.walk.t > 12) { ns.removed = true; this._removeNpcMeshes(id); }
        continue;
      }
      if (ns.following && !ns.dead) {
        const inCamp = st.camp && st.camp.inside;
        const behind = 2.2 + idx * 1.6;
        const ry = this.player.rotation.y;
        const tx = inCamp ? st.camp.x + 2.2 + idx : this.pos.x - Math.sin(ry) * behind;
        const tz = inCamp ? st.camp.z + 1.5 : this.pos.z - Math.cos(ry) * behind;
        const dx = tx - ns.x, dz = tz - ns.z;
        const d = Math.hypot(dx, dz);
        const ch = rt.chars[0];
        if (d > 0.4) {
          const sp = Math.min(d * 2.5, 6) * dt;
          ns.x += (dx / d) * sp;
          ns.z += (dz / d) * sp;
          rt.group.rotation.y = lerpAngle(rt.group.rotation.y, Math.atan2(dx, dz), Math.min(1, dt * 6));
          ch.rotation.y = 0;
          animateCharacter(ch, dt, true, 1, 'stand');
        } else animateCharacter(ch, dt, false, 1, inCamp ? 'sit' : 'stand');
        if (d > 40) { ns.x = this.pos.x; ns.z = this.pos.z; }
        const gy = this.world.height(ns.x, ns.z);
        rt.group.position.set(ns.x, lerp(rt.group.position.y, gy, Math.min(1, dt * 10)), ns.z);
        idx++;
      } else {
        for (const c of rt.chars) animateCharacter(c, dt, false, 1, ns.dead ? 'lie' : rt.def.pose);
      }
    }
  }

  simCompanions(minutes, c, env, mode) {
    const st = this.st;
    for (const id of [...st.companions]) {
      const ns = st.npcs[id];
      if (!ns || ns.dead) continue;
      const inShelter = env.tentInfo || (st.path === 'main' && st.visited.dayehai && Math.abs(st.s - mainPath.waypoints.find((w) => w.id === 'dayehai').s) < 20);
      let d = 0.006 + c.wx.severity * 0.045 + (this.night() ? 0.012 : 0) + (mode === 'walk' ? 0.01 : 0);
      if (id === 'mou') d *= 0.25;
      if (inShelter) d = -0.03;
      ns.cond = clamp(ns.cond - d * minutes, 0, 100);
      if (ns.cond <= 0) {
        ns.dead = true;
        ns.following = false;
        ns.fate = 'died';
        st.companions = st.companions.filter((x) => x !== id);
        const rt = this.npcRt[id];
        if (rt) for (const ch of rt.chars) animateCharacter(ch, 0, false, 1, 'lie');
        this.addStress(30);
        this.toast(`${npcById(id).name}倒在了雪地里，再也没有醒过来。`, 'danger', 7000);
        this.log(`${npcById(id).name}没能撑下去`);
      }
    }
  }

  // —— NPC 剧情接口 ——
  setFate(id, f) { if (this.st.npcs[id]) this.st.npcs[id].fate = f; }
  npcCond(id, d) { const ns = this.st.npcs[id]; if (ns) ns.cond = clamp(ns.cond + d, 0, 100); }
  despawn(id, remove = true) {
    const rt = this.npcRt[id];
    if (!rt) return;
    rt.ns.done = true;
    if (rt.marker) rt.marker.visible = false;
    if (remove) { rt.ns.removed = true; this._removeNpcMeshes(id); }
  }
  walkAway(id, dir = 1) {
    const rt = this.npcRt[id];
    if (!rt) return;
    rt.ns.done = true;
    if (rt.marker) rt.marker.visible = false;
    rt.walk = { dir: dir * this.st.dir, s: rt.ns.s, t: 0 };
  }
  recruit(id) {
    const st = this.st;
    const ns = st.npcs[id];
    if (!ns) return;
    ns.following = true;
    ns.done = true;
    if (!st.companions.includes(id)) st.companions.push(id);
    const rt = this.npcRt[id];
    if (rt) {
      if (rt.marker) rt.marker.visible = false;
      for (const ch of rt.chars) animateCharacter(ch, 0, false, 1, 'stand');
    }
  }
  persuadeChance(base) { return clamp(base + this.role.mods.persuade * 0.5 - (this.st.body.stress > 60 ? 0.12 : 0), 0.05, 0.95); }
  warmLabel() {
    const st = this.st, a = [];
    if (st.warmers > 0) a.push(`暖宝宝×${st.warmers}`);
    if (has(st, 'blanket')) a.push('保温毯');
    if (st.thermos.l >= 0.25 && st.thermos.temp > 40) a.push('热水');
    return a.length ? a.join(' / ') : '你没有多余的保暖物资';
  }
  feedLabel() {
    const f = this._pickFood();
    return f ? `你有${ITEMS[f].name}` : '你没有多余的食物';
  }
  _pickFood() {
    return Object.keys(this.st.inv).filter(id => has(this.st, id) && ITEMS[id]?.kind === 'food' && !ITEMS[id].alcohol)
      .sort((a, b) => (ITEMS[b].food || 0) - (ITEMS[a].food || 0) || a.localeCompare(b))[0] || null;
  }
  feedNpc(id) {
    const st = this.st;
    const f = this._pickFood();
    let what = null;
    if (f) { removeItem(st, f); this.npcCond(id, 14); what = ITEMS[f].name; }
    if (st.thermos.l >= 0.25) { st.thermos.l -= 0.25; this.npcCond(id, st.thermos.temp > 40 ? 12 : 4); what = what ? what + '和热水' : '热水'; }
    else if (st.water.liquid >= 0.25) { st.water.liquid -= 0.25; this.npcCond(id, 4); what = what ? what + '和水' : '水'; }
    return what;
  }
  warmNpc(id) {
    const st = this.st;
    const got = [];
    if (st.warmers > 0) { st.warmers--; this.npcCond(id, 10); got.push('暖宝宝'); }
    if (has(st, 'blanket')) { removeItem(st, 'blanket'); this.npcCond(id, 12); got.push('保温毯'); }
    if (st.thermos.l >= 0.25 && st.thermos.temp > 40) { st.thermos.l -= 0.25; this.npcCond(id, 12); got.push('热水'); }
    return got.length ? got.join('、') : null;
  }
  treatNpc(id) {
    if (has(this.st, 'firstaid')) { removeItem(this.st, 'firstaid'); this.npcCond(id, this.isNurse() ? 25 : 15); return true; }
    this.npcCond(id, 4);
    return false;
  }
  needsSupply() {
    const st = this.st;
    const food = ['biscuit', 'jerky', 'chocolate', 'bar', 'noodle', 'selfheat', 'gel'].reduce((a, id) => a + (st.inv[id] || 0), 0);
    return (has(st, 'stove') && st.gas.normal + st.gas.alpine < 3) || food < 4;
  }
  npcGiveSupply() {
    const st = this.st;
    if (st.flags.gotSupply) return null;
    st.flags.gotSupply = true;
    if (has(st, 'stove') && st.gas.normal + st.gas.alpine < 3) { st.gas.alpine += 6; return '一罐高山气罐'; }
    const food = ['biscuit', 'jerky', 'chocolate', 'bar', 'noodle', 'selfheat', 'gel'].reduce((a, id) => a + (st.inv[id] || 0), 0);
    if (food < 4) { addItem(st, 'biscuit', 3); return '三块压缩饼干'; }
    st.warmers += 3;
    return '几片暖宝宝';
  }
  forecastText() {
    const st = this.st;
    const wx = this.wx();
    const up = st.schedule.slice(wx.idx + 1, wx.idx + 5).filter((e) => e.t - st.time < 18 * 60);
    const bad = up.find((e) => ['blizzard', 'heavysnow', 'gale'].includes(e.w));
    if (bad) {
      const h = Math.round((bad.t - st.time) / 60);
      return `我手表气压一直在掉。估计${h <= 3 ? '马上' : `再过${h}个小时左右`}就要变天，${bad.w === 'gale' ? '大风' : '暴风雪'}。`;
    }
    const fog = up.find((e) => e.w === 'fog');
    if (fog) return '前面一会儿可能起雾。雾里千万跟紧路条，石头上看不出脚印。';
    return '天气暂时还行，但这山上的天说变就变。';
  }

  comms() {
    const st = this.st;
    const sat = has(st, 'satcomm') && st.bat.satcomm > 3;
    const phone = st.bat.phone > 3 && !st.airplane && this.signal() > 0;
    return { sat, phone, any: sat || phone };
  }
  commsLabel() {
    const c = this.comms();
    if (c.sat) return '用北斗卫星通讯器（精确坐标）';
    if (c.phone) return '用手机报警（有信号）';
    if (this.st.airplane && this.signal() > 0) return '手机还开着飞行模式';
    if (this.st.bat.phone <= 3) return '手机没电了';
    return '没有信号，也没有卫星通讯器';
  }

  async sos({ forNpc = null } = {}) {
    const st = this.st;
    if (!forNpc && st.rescue?.self && st.rescue.moved) return { ok: this.updateRescuePosition() };
    const c = this.comms();
    if (!c.any) { this.toast(this.commsLabel(), 'warn'); return { ok: false }; }
    const method = c.sat ? 'sat' : 'phone';
    if (method === 'phone') {
      st.bat.phone = Math.max(0, st.bat.phone - 5);
      if (this.signal() < 2 && this.roll(0.3)) {
        this.toast('只有一格信号，电话打到一半断了。再试一次？', 'warn', 4000);
        return { ok: false };
      }
    } else st.bat.satcomm = Math.max(0, st.bat.satcomm - 4);
    const accurate = method === 'sat' || st.flags.livePos || has(st, 'gps');
    this.recordStory('rescueContact');
    if (st.rescue) {
      if (forNpc && !st.rescue.npcs.includes(forNpc)) st.rescue.npcs.push(forNpc);
      if (!forNpc && !st.rescue.self) { st.rescue.self = true; st.rescue.x = this.pos.x; st.rescue.z = this.pos.z; this.toast('你把自己的位置也报给了救援队。', 'info'); return { ok: true }; }
      this.toast('救援队已经在路上了，他们会一起找到这里。', 'info');
      return { ok: true };
    }
    const frac = st.path === 'main' ? clamp(st.s / mainPath.length, 0, 1) : 0.15 + 0.2 * (1 - st.s / this.path().length);
    let hours = 6 + 30 * Math.sin(Math.PI * frac);
    if (this.wx().severity > 0.6) hours *= 1.4;
    if (!accurate) hours *= 1.3;
    if (method === 'phone' && !accurate) hours *= 1.1;
    const eta = Math.round(hours * 60);
    const searchDelay = this.rescueSearchRate() * 240;
    st.rescue = { at: st.time, eta: st.time + eta + searchDelay, searchDelay, x: this.pos.x, z: this.pos.z, method, npcs: forNpc ? [forNpc] : [], self: !forNpc, moved: false, near: false };
    this.log(`发出求救（${method === 'sat' ? '卫星' : '手机'}）`);
    await this.say('求救已发出', [
      method === 'sat' ? '北斗通讯器屏幕上跳出一行字：坐标已发送。' : `接警员问了你的位置。${accurate ? '你报出了GPS坐标。' : '你只能描述附近的地形……'}`,
      '救援队接到了消息，正在组织进山。抵达时间暂时无法确认。',
      '原地等待，扎营保暖，保存体力和电量。不要乱走——救援队会去你报告的位置找你。',
    ], '原地等待');
    return { ok: true };
  }

  rescueSearchRate() {
    const terrain = clamp(((this.offTrail || 0) - 12) / 90, 0, 1) * 0.35;
    const reading = this.visibility ? this.visibility() : 260;
    const visibility = Number.isFinite(reading) ? reading : 260;
    const obscured = clamp((90 - visibility) / 90, 0, 1) * 0.4;
    return terrain + obscured;
  }

  simRescue(minutes = 0) {
    const st = this.st;
    const r = st.rescue;
    if (!r) return;
    // 按已过去的游戏时间积累搜索阻力；即使一直有雾，进度也不会停止。
    const delay = Math.max(0, minutes) * this.rescueSearchRate();
    r.eta += delay;
    r.searchDelay = (r.searchDelay || 0) + delay;
    const d = Math.hypot(this.pos.x - r.x, this.pos.z - r.z);
    if (r.self && d > 45 && !r.moved) {
      r.moved = true;
      r.eta += (r.eta - st.time) * 0.5 + 240;
      this.toast('你离开了报告的位置。救援队到了那里会找不到你。', 'danger', 6000);
    }
    if (!r.near && r.eta - st.time < 60 && d < 60) {
      r.near = true;
      this.toast('远处传来哨声和人声——救援队快到了！', 'good', 6000);
    }
    if (st.time >= r.eta) {
      if (r.self && d < 50) return this.finish('rescued');
      for (const id of r.npcs) if (st.npcs[id] && st.npcs[id].fate !== 'died') st.npcs[id].fate = 'rescued';
      st.rescue = null;
      if (r.self) this.toast('救援队到了你报告的位置，却没有找到你。', 'warn', 6000);
      else if (r.npcs.length) this.toast(`后来你听说：救援队找到了${r.npcs.map((id) => npcById(id).name).join('、')}。`, 'good', 6000);
    }
  }

  nearbyBranches() {
    const st = this.st;
    return st.path === 'main' && (this.offTrail || 0) < 25
      ? Object.values(branches).filter(b => Math.abs(st.s - b.fromS) < 24) : [];
  }

  async retreatMenu() {
    const st = this.st, nearby = this.nearbyBranches();
    const choices = [];
    if (st.path === 'main' && st.dir > 0) choices.push({ id: 'back', label: '原路返回塘口', sub: `游戏路程约 ${(st.s * KM_PER_UNIT).toFixed(1)} km` });
    if (st.path !== 'main' && st.dir > 0) choices.push({ id: 'junction', label: '沿已走过的支线返回主脊岔口', sub: '仍须自己走回去，不会传送' });
    if (canFreeDescent(st)) choices.push({ id: 'free', label: '从这里自行寻找下撤方向', sub: '手动控制，不自动寻路；低海拔不代表现实脱险' });
    for (const b of nearby) choices.push({ id: b.id, label: b.def.name, sub: `游戏设定约${b.def.lengthKm} km · 并非已核实的现实道路` });
    if (st.dir < 0) choices.push({ id: 'forward', label: st.path === 'main' ? '掉头，继续往太白山方向' : '掉头，继续沿当前支线下行' });
    choices.push({ id: 'cancel', label: '再想想' });
    const c = await this.dialog({ who: '下撤', text: ['下撤仍会耗费体力、食物和时间。能否回到山下，不只取决于海拔是否降低。', '虚线支线参考历史事故区域或原计划；起点、方位、连接、里程和接触点均为游戏虚构，不是现实撤离指南。'], choices });
    if (this.over || this.st !== st) return;
    if (c === 'back' || c === 'junction' || c === 'free' || nearby.some(b => b.id === c)) this.retreat(c);
    if (c === 'forward') { st.flags.freeDescent = false; st.dir = 1; this.cam.yaw += Math.PI; this.toast('你转过身，继续当前路线的前向行程。', 'info'); this.save(); }
  }

  canBranch() { return this.nearbyBranches().length > 0; }

  retreat(kind) {
    const st = this.st;
    if (kind === 'free') {
      if (!canFreeDescent(st)) return;
      st.flags.freeDescent = true; this.autoWalk = false; this.lure = null;
      this.log('开始自行下撤');
      this.toast('你开始自己寻找下山方向。游戏地形不是现实导航。', 'info', 5000);
      this.save(); return;
    }
    if (kind === 'back' || kind === 'junction') {
      st.flags.freeDescent = false;
      if (st.dir > 0) this.cam.yaw += Math.PI;
      st.dir = -1;
      this.log(st.path === 'main' ? '决定原路下撤' : '决定返回支线岔口');
      this.toast(st.path === 'main' ? '你决定原路返回塘口。' : '你沿已经走过的支线返回主脊岔口。', 'info', 5000);
    } else {
      const b = this.nearbyBranches().find(b => b.id === kind);
      if (!b) return;
      st.flags.freeDescent = false; st.path = b.id; st.dir = 1;
      st.s = b.nearest(this.pos.x, this.pos.z).s;
      const p = b.pointAt(st.s + 5);
      this.cam.yaw = Math.atan2(-p.dx, -p.dz);
      this.log(`决定进入${b.def.name}`);
      this.toast(`你转向${b.def.name}，仍需实际走完整段行程。`, 'info', 5000);
    }
    this.save();
  }

  // ———————————————————— 扎营 ————————————————————
  async beginCamp() {
    const st = this.st;
    if (st.camp || this.campPlacing) return;
    const tent = tentItem(st);
    if (!tent) {
      const c = await this.dialog({
        who: '扎营', text: ['你没有帐篷。', '在零下二十度的山脊上露宿，能不能活过今晚，取决于你的睡袋、衣服和你选的那块石头。'],
        choices: [
          { id: 'bivy', label: '找块背风的大石头，露宿一晚', sub: `风暴露：${this.exposureLabel(this.exposure())}` },
          { id: 'cancel', label: '再走走，找更好的地方' },
        ],
      });
      if (c !== 'bivy') return;
      st.camp = { bivy: true, x: this.pos.x, z: this.pos.z, inside: true, exposure: this.exposure() };
      this.ui.showCampMenu(this.campMenuInfo());
      return;
    }
    let maxH = -1e9, minH = 1e9;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const h = this.world.height(this.pos.x + dx, this.pos.z + dz);
      maxH = Math.max(maxH, h); minH = Math.min(minH, h);
    }
    if (maxH - minH > 1) { this.toast('这里地面坑洼不平，没法扎营。找一块平一点的地方。', 'warn'); return; }
    this.autoWalk = false;
    const { from } = windVectors(this.wx().dirDeg);
    const rot = Math.atan2(from.x, from.z) + Math.PI * (0.3 + Math.random() * 1.4);
    const ghost = makeTent(ITEMS[tent].windRating > 15 ? 0xff7a1a : 0xf2c12e, { ghost: true });
    ghost.position.set(this.pos.x + Math.sin(this.player.rotation.y) * 2, this.world.height(this.pos.x, this.pos.z), this.pos.z + Math.cos(this.player.rotation.y) * 2);
    this.world.scene.add(ghost);
    const arrows = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const a = makeArrow(0xbfe3ff);
      a.position.set((i - 1) * 2.2, 2.6, 0);
      arrows.add(a);
    }
    this.world.scene.add(arrows);
    this.campPlacing = { rot, ghost, arrows, tent };
    this.ui.showCampPlacer(this.campPlacerInfo(), {
      rotate: (d) => { this.campPlacing.rot += d; this.ui.updateCampPlacer(this.campPlacerInfo()); },
      best: () => { this.campPlacing.rot = Math.atan2(-from.x, -from.z); this.ui.updateCampPlacer(this.campPlacerInfo()); },
      confirm: () => this.confirmCamp(),
      cancel: () => this.cancelCamp(),
    });
  }

  orientInfo(rot) {
    const { from } = windVectors(this.wx().dirDeg);
    const door = { x: Math.sin(rot), z: Math.cos(rot) };
    const dot = door.x * from.x + door.z * from.z;
    let orient, label, grade;
    if (dot < -0.7) { orient = 0.7; label = '尾部迎风'; grade = 'good'; }
    else if (dot > 0.7) { orient = 1.1; label = '门朝来风（灌风、积雪）'; grade = 'bad'; }
    else if (Math.abs(dot) < 0.4) { orient = 1.35; label = '侧面迎风（易被吹塌）'; grade = 'bad'; }
    else { orient = dot < 0 ? 0.9 : 1.15; label = dot < 0 ? '斜向尾部迎风' : '斜向门朝风'; grade = 'mid'; }
    return { orient, label, grade, doorIntoWind: dot > 0.7 };
  }

  exposureLabel(e) { return e < 0.45 ? '低（背风）' : e < 0.8 ? '中' : '高（风口）'; }

  campPlacerInfo() {
    const cp = this.campPlacing;
    const e = this.exposure();
    const o = this.orientInfo(cp.rot);
    const wx = this.wx();
    const tent = ITEMS[cp.tent];
    const eff = wx.wind * e * o.orient;
    const novice = this.st.role === 'student';
    cp.ghost.rotation.y = cp.rot;
    const { to } = windVectors(wx.dirDeg);
    cp.arrows.position.set(cp.ghost.position.x - to.x * 3, cp.ghost.position.y, cp.ghost.position.z - to.z * 3);
    cp.arrows.rotation.y = Math.atan2(to.x, to.z);
    const tint = novice ? 0xffffff : o.grade === 'good' && e < 0.8 ? 0x8cff8c : o.grade === 'bad' || e > 1 ? 0xff8c8c : 0xffe08c;
    cp.ghost.userData.mesh.material.color.setHex(tint);
    return {
      windDir: compassName(wx.dirDeg) + '风',
      windMs: Math.round(wx.wind * wx.gust),
      exposure: novice ? (e > 0.8 ? '感觉风挺大' : '感觉还行') : this.exposureLabel(e),
      orient: novice ? '看不出来哪样摆更好' : o.label,
      grade: novice ? 'mid' : o.grade,
      risk: novice ? '' : eff > tent.windRating ? `风力约${Math.round(eff)}m/s，超过帐篷抗风能力（${tent.windRating}m/s）` : `帐篷承受风力约${Math.round(eff)}m/s / 抗风${tent.windRating}m/s`,
      canBest: this.st.role === 'veteran',
      tip: '在背风坡、大石头后扎营；帐篷尾部（低矮的一端）对着来风，门开在下风向。',
    };
  }

  cancelCamp() {
    const cp = this.campPlacing;
    if (!cp) return;
    this.world.scene.remove(cp.ghost);
    this.world.scene.remove(cp.arrows);
    this.campPlacing = null;
    this.ui.hideCampPlacer();
  }

  async confirmCamp() {
    const st = this.st;
    const cp = this.campPlacing;
    const e = this.exposure();
    const o = this.orientInfo(cp.rot);
    const gx = cp.ghost.position.x, gz = cp.ghost.position.z;
    this.cancelCamp();
    let t = 30 * (st.body.frostbite > 50 ? 1.5 : 1) * (this.wx().wind > 15 ? 1.5 : 1) * (st.role === 'veteran' ? 0.7 : 1);
    this.ui.setBusy('搭帐篷……');
    await this.skip(t, 'idle');
    this.ui.setBusy(null);
    if (this.over) return;
    st.camp = { x: gx, z: gz, rot: cp.rot, tent: cp.tent, exposure: e, orient: o.orient, doorIntoWind: o.doorIntoWind, health: 100, inside: true, collapsed: false };
    this._placeTentMesh();
    this.log(`在${this.placeName()}扎营`);
    this.music?.stinger('camp');
    this.save();
    this.ui.showCampMenu(this.campMenuInfo());
  }

  _placeTentMesh() {
    const st = this.st;
    if (this.tentMesh) this.world.scene.remove(this.tentMesh);
    if (st.camp.bivy) { this.tentMesh = null; return; }
    const tent = ITEMS[st.camp.tent];
    this.tentMesh = st.camp.collapsed ? makeCollapsedTent(tent.windRating > 15 ? 0xff7a1a : 0xf2c12e) : makeTent(tent.windRating > 15 ? 0xff7a1a : 0xf2c12e);
    this.tentMesh.position.set(st.camp.x, this.world.height(st.camp.x, st.camp.z), st.camp.z);
    this.tentMesh.rotation.y = st.camp.rot;
    this.world.shadowify(this.tentMesh);
    this.world.scene.add(this.tentMesh);
  }

  campMenuInfo() {
    const st = this.st;
    const env = this.env;
    return {
      bivy: !!st.camp.bivy,
      tentHealth: st.camp.bivy ? null : Math.round(st.camp.health),
      inside: env ? Math.round(env.Teff) : null,
      canCook: has(st, 'stove') && has(st, 'pot') && st.gas.normal + st.gas.alpine > 0,
      canSos: this.comms().any,
      canDry: canDryClothes(st),
      rescue: st.rescue?.self ? true : null,
      night: this.night() || this.hour() > 15.5,
    };
  }

  async dryClothes() {
    const st = this.st;
    if (!st || this.over || this.busy || this.eventRunning) return;
    if (!canDryClothes(st)) return this.toast('需要在完好、已进入的帐篷里晾挂。露宿或塌帐不能这样干燥衣物。', 'warn');
    if (st.body.core < 35) return this.toast('你已经明显失温，先避风保暖；现在不适合脱衣晾挂。', 'danger');
    const ids = dryableClothes(st);
    if (!ids.length) return this.toast('没有可晾挂的湿衣。先在背包里脱下要处理的湿衣，并留足干燥保暖层。', 'info', 6500);
    this.ui.hideCampMenu();
    this.ui.closeSheet?.();
    const list = ids.map(id => `${ITEMS[id].name} ${Math.round(garmentWetness(st, id))}%`).join('、');
    const choice = await this.dialog({
      pollSource: 'utility:dry_clothes', who: '晾干湿衣', sub: '通风晾挂 · 帐内禁止明火烘烤',
      text: [`准备晾挂：${list}。`, '低温干燥需要时间，棉质和羽绒会更慢；湿衣必须先脱下，保留干燥保暖层。不能在封闭帐篷内使用炉具取暖或烘衣，存在火灾和一氧化碳风险。'],
      choices: [
        { id: 'air', label: '通风晾挂30分钟', sub: '不消耗燃料，寒冷时干燥较慢' },
        { id: 'assisted', label: '用暖宝宝辅助晾挂30分钟', sub: `消耗1片，剩余${st.warmers}片；不直接贴皮肤，不包裹密封`, disabled: st.warmers <= 0 },
        { id: 'back', label: '暂不处理' },
      ],
    });
    if (this.over || this.st !== st) return;
    if (choice === 'air' || choice === 'assisted') {
      const started = beginClothesDrying(st, { assisted: choice === 'assisted' });
      if (started) {
        const before = started.ids.reduce((sum, id) => sum + garmentWetness(st, id), 0);
        this.ui.setBusy('通风晾挂衣物……', true);
        const reason = await this.skip(30, 'rest', { check: () => st.body.core < 35 ? 'cold' : st.camp?.collapsed || !st.camp?.inside ? 'camp' : null });
        this.ui.setBusy(null);
        if (this.over || this.st !== st) return;
        const after = started.ids.reduce((sum, id) => sum + garmentWetness(st, id), 0);
        if (reason) { ensureClothes(st).drying = []; this.toast('你停止晾挂，先重新整理保暖和营地。', 'warn', 5000); }
        else this.toast(`衣物平均潮湿度降低了${Math.max(0, (before - after) / started.ids.length).toFixed(1)}个百分点；留在帐内未穿的衣物会继续晾挂。`, 'info', 6500);
        this.save();
      }
    }
    if (!this.over && st.camp?.inside) this.ui.showCampMenu(this.campMenuInfo());
  }

  async packCamp() {
    const st = this.st;
    if (!st.camp) return;
    this.ui.hideCampMenu();
    if (!st.camp.bivy) {
      this.ui.setBusy('收帐篷……');
      await this.skip(st.camp.collapsed ? 25 : 15, 'idle');
      this.ui.setBusy(null);
      if (this.over || this.st !== st) return;
      if (this.tentMesh) this.world.scene.remove(this.tentMesh);
      this.tentMesh = null;
      if (st.camp.collapsed) { st.story.effects.tentLeak = false; removeItem(st, st.camp.tent); this.toast('帐篷已经坏了，你把它扔下了。', 'warn'); }
    }
    st.camp = null;
    ensureClothes(st).drying = [];
    this.player.visible = true;
    this.save();
  }

  async sleep() {
    const st = this.st;
    const hr = this.hour();
    let minutes;
    if (hr >= 7.5 && hr < 15.5) minutes = 120;
    else minutes = ((7.5 - hr + 24) % 24) * 60;
    this.ui.hideCampMenu();
    this.ui.setBusy(st.camp.bivy ? '露宿……' : '睡觉……', true);
    const startCore = st.body.core;
    let minCore = st.body.core;
    let left = minutes;
    let coldWoke = false, snowDone = false;
    while (left > 0 && !this.over) {
      const reason = await this.skip(left, 'sleep', {
        check: () => {
          minCore = Math.min(minCore, st.body.core);
          if (st.camp && !st.camp.bivy && !st.camp.collapsed && st.camp.health <= 0) return 'collapse';
          if (!coldWoke && st.body.core < 35.2) return 'cold';
          if (!snowDone && st.camp && !st.camp.bivy && this.wx().precip > 0.7 && this.roll(0.025)) return 'snow';
          return null;
        },
        onStep: (m) => { left -= m; },
      });
      if (!reason || this.over) break;
      this.ui.setBusy(null);
      if (reason === 'collapse') await this.tentCollapse();
      if (reason === 'cold') { coldWoke = true; const goOn = await this.coldWake(); if (!goOn) { left = 0; break; } }
      if (reason === 'snow') {
        snowDone = true;
        const c = await this.dialog({ pollSource: 'scene:camp_snow', who: '深夜', text: ['帐篷顶被积雪压得越来越低，几乎贴到了你的脸。'], choices: [{ id: 'clear', label: '爬出去清雪', sub: '穿好衣服，去帐篷外面看看' }, { id: 'ignore', label: '不管了，继续睡' }] });
        if (c === 'clear') { st.body.core -= 0.3; st.camp.health = Math.min(100, st.camp.health + 10); await this.skip(15, 'idle'); }
        else st.camp.health -= 35;
      }
      if (!st.camp) break;
      this.ui.setBusy(st.camp.bivy ? '露宿……' : '睡觉……', true);
    }
    this.ui.setBusy(null);
    if (this.over) return;
    st.stats.nights++;
    const msg = minCore < 35 ? `你几乎一夜没睡。夜里最冷的时候，你抖得停不下来。` : minCore < 36.3 ? '夜里冻醒了好几次。' : '你睡了一个还算安稳的觉。';
    this.toast(msg, minCore < 35 ? 'danger' : 'info', 5000);
    this.save();
    if (st.camp) this.ui.showCampMenu(this.campMenuInfo());
  }

  async tentCollapse() {
    const st = this.st;
    this.addStress(20);
    const c = await this.dialog({
      pollSource: 'scene:tent_collapse', who: '帐篷塌了', text: ['一阵狂风，帐杆"啪"地一声断了。湿冷的帐布糊在你脸上，风从每一个缝隙里灌进来。'],
      choices: [
        { id: 'fix', label: '钻出去，在风雪里重新加固', sub: '摸黑找回帐杆和绳子，试着重新撑起来' },
        { id: 'hold', label: '裹着塌掉的帐篷硬撑到天亮' },
      ],
    });
    if (c === 'fix') {
      st.body.core -= 0.7;
      st.body.wet += 10;
      await this.skip(30, 'idle');
      st.camp.health = 40;
      this.toast('你用石头压住了帐角，勉强把帐篷撑了起来。', 'warn');
    } else {
      st.camp.collapsed = true;
      st.camp.health = 0;
      st.camp.exposure = Math.max(st.camp.exposure, 0.6);
      this._placeTentMesh();
    }
  }

  async coldWake() {
    const st = this.st;
    const choices = [];
    if (has(st, 'stove') && has(st, 'pot') && st.gas.normal + st.gas.alpine > 0) choices.push({ id: 'cook', label: '烧一壶热水', sub: '灌进水瓶塞进睡袋，再喝几口' });
    if (st.thermos.l >= 0.25 && st.thermos.temp > 40) choices.push({ id: 'drink', label: '喝保温杯里的热水' });
    if (this._pickFood()) choices.push({ id: 'eat', label: '吃点东西', sub: '身体需要燃料来产热' });
    if (st.warmers > 0) choices.push({ id: 'warmer', label: '贴暖宝宝', sub: `剩 ${st.warmers} 片` });
    if (!st.wearInsul && this.hasInsul()) choices.push({ id: 'insul', label: '穿上保暖层再睡' });
    choices.push({ id: 'move', label: '在睡袋里做仰卧起坐', sub: '消耗体力产热' });
    choices.push({ id: 'sleep', label: '继续睡' });
    choices.push({ id: 'up', label: '不睡了，起来' });
    const c = await this.dialog({ pollSource: 'scene:cold_wake', who: '冻醒', text: ['你被冻醒了，止不住地发抖。帐篷内壁上结满了霜。', `现在是 ${fmtClock(st.time)}。离天亮还有很久。`], choices });
    if (c === 'cook') await this.cook(true);
    if (c === 'drink') this.drinkThermos();
    if (c === 'eat') this.eat(this._pickFood());
    if (c === 'warmer') this.useWarmer();
    if (c === 'insul') await this.setInsulation(true);
    if (c === 'move') { st.body.stamina -= 8; st.body.core += 0.25; st.body.food -= 2; }
    return c !== 'up';
  }

  async restFor(minutes) {
    const st = this.st;
    this.autoWalk = false;
    this.ui.setBusy(`休息 ${minutes} 分钟……`, true);
    let warned = false;
    await this.skip(minutes, 'rest', { check: () => (!warned && st.body.core < 34.8 ? 'cold' : null) });
    this.ui.setBusy(null);
    if (!this.over && st.body.core < 34.8) this.toast('坐着不动，你越来越冷了。', 'danger');
  }

  async waitForRescue() {
    const st = this.st;
    if (!st.rescue) return;
    this.ui.setBusy('等待救援……', true);
    await this.skip(240, st.camp && st.camp.inside ? 'rest' : 'idle', {
      check: () => (st.body.core < 34 && this.roll(0.08) ? 'cold' : null),
    });
    this.ui.setBusy(null);
    if (!this.over) this.toast(st.body.core < 34 ? '你冷得受不了，必须做点什么。' : '还没有等到救援队。你检查了一遍衣物和补给。', st.body.core < 34 ? 'danger' : 'info');
  }

  async skip(minutes, mode, opts = {}) {
    this.busy = true;
    let done = 0;
    let reason = null;
    const step = opts.step ?? 10;
    while (done < minutes && !this.over) {
      const m = Math.min(step, minutes - done);
      this.simulate(m, mode, { skip: true });
      done += m;
      opts.onStep?.(m);
      if (this.over) break;
      reason = opts.check?.() ?? null;
      if (reason) break;
      await nextFrame();
    }
    this.busy = false;
    return reason;
  }

  async passTime(min) { await this.skip(min, this.st.camp && this.st.camp.inside ? 'rest' : 'idle'); }

  // ———————————————————— 物品使用 ————————————————————
  async setInsulation(worn) {
    const id = wornItems(this.st).insul;
    if (!id) return null;
    if (!!this.st.wearInsul === !!worn) return { unchanged: true };
    return this.equipClothing(id, { allowEvent: true });
  }

  async removeOuterClothing() {
    const c = wornItems(this.st);
    const id = c.shell || (this.st.wearInsul && c.insul) || c.mid || c.base;
    return id ? this.equipClothing(id, { allowEvent: true }) : null;
  }

  async equipClothing(id, { allowEvent = false } = {}) {
    const st = this.st;
    if (!st || this.over || this.busy || this.eventRunning && !allowEvent || !has(st, id) || ITEMS[id]?.kind !== 'cloth') return;
    this.autoWalk = false;
    const env = computeEnv(st, this.ctx());
    const change = changeClothing(st, id, env);
    if (!change) return;
    this.ui.setBusy('调整穿着……');
    await this.skip(change.minutes, this.inTent() ? 'rest' : 'idle');
    this.ui.setBusy(null);
    if (this.over || this.st !== st) return;
    this.toast(`${change.worn ? '穿上' : '脱下'}${ITEMS[id].name}。${change.coreCost > 0.04 ? '冷空气从衣缝里钻进来，换装消耗了体温。' : ''}`, change.coreCost > 0.15 ? 'warn' : 'info', 4500);
    this.save();
    this.refreshHud(true);
    return change;
  }

  eat(id) {
    const st = this.st;
    const it = ITEMS[id];
    if (!st || this.over || it?.kind !== 'food' || !has(st, id)) return;
    const hot = !!(it.needsHot && st.thermos.l >= 0.3 && st.thermos.temp > 50);
    if (!applyFood(st, id, { hot })) return;
    removeItem(st, id);
    if (hot) st.thermos.l = Math.max(0, st.thermos.l - 0.3);
    let msg = it.needsHot ? hot ? `用热水泡了${it.name}。热汤让你缓过了一口气。` : `没有热水，你干嚼了${it.name}；补给较少，口中更干。` : it.heat ? `吃了热腾腾的${it.name}。` : `吃了${it.name}。`;
    if (it.alcohol) msg = '喝下白酒后你觉得皮肤暖了，但那是血管扩张的错觉，核心热量流失更快。';
    if (id === 'chocolate' && this.airT() < -10) msg = '巧克力冻得像石头，你含了一会儿才化开。';
    if (!it.alcohol && (!it.needsHot || hot)) { const summary = foodEffectSummary(id); if (summary) msg += ` ${summary}`; }
    this.toast(msg, it.alcohol ? 'warn' : 'info', 5000);
    this.save();
  }

  drinkThermos() {
    const st = this.st, b = st.body;
    if (st.thermos.l < 0.05) return this.toast('保温杯空了。', 'warn');
    const v = Math.min(0.25, st.thermos.l);
    st.thermos.l -= v;
    b.water = clamp(b.water + v * 32, 0, 100);
    if (st.thermos.temp > 42) {
      b.core = Math.min(37.2, b.core + 0.35);
      this.addStress(-4);
      this.toast(`喝了口热水（${Math.round(st.thermos.temp)}℃）。暖意从胃里散开。`, 'good');
    } else this.toast('保温杯里的水已经凉了。', 'info');
  }

  drinkWater() {
    const st = this.st, b = st.body;
    if (st.water.liquid < 0.05) return this.toast(st.water.frozen > 0.1 ? '水瓶里只剩冰坨。需要炉头化开。' : '没有水了。', 'warn');
    const v = Math.min(0.25, st.water.liquid);
    st.water.liquid -= v;
    b.water = clamp(b.water + v * 32, 0, 100);
    b.core -= 0.05;
    this.toast('冰凉的水顺着喉咙下去，你打了个寒战。', 'info');
  }

  eatSnow() {
    const b = this.st.body;
    b.water = clamp(b.water + 3, 0, 100);
    b.core -= 0.3;
    this.addStress(2);
    this.toast('你抓了把雪塞进嘴里。解不了多少渴，却冻得牙疼——吃雪会消耗宝贵的体温。', 'warn', 5000);
  }

  async cook(silent = false) {
    const st = this.st;
    if (!has(st, 'stove') || !has(st, 'pot')) return this.toast('需要炉头和锅。', 'warn');
    if (st.gas.normal + st.gas.alpine <= 0) return this.toast('气罐用完了。', 'warn');
    const camp = st.camp, wasInside = !!camp?.inside;
    const origin = { x: this.pos.x, y: this.pos.y, z: this.pos.z };
    if (wasInside && !camp.bivy) {
      const options = [0, Math.PI / 2, Math.PI, -Math.PI / 2].map(a => {
        const x = camp.x + Math.cos((camp.rot || 0) + a) * 3;
        const z = camp.z + Math.sin((camp.rot || 0) + a) * 3;
        return { x, z, y: this.world.height(x, z) };
      });
      const spot = options.find(p => Number.isFinite(p.y) && Math.abs(p.y - origin.y) <= 1.2);
      if (!spot) return this.toast('帐外附近没有可站稳的烧水位置。不要在帐内点炉。', 'warn');
      Object.assign(this.pos, spot);
      st.pos = { x: spot.x, z: spot.z };
    }
    if (wasInside) { camp.inside = false; this.ui.hideCampMenu(); }
    this.updateLampState();
    const T = this.airT();
    const windy = this.wx().wind * this.exposure() > 10;
    this.ui.setBusy('在帐外烧水……');
    let ok = true;
    if (st.gas.alpine > 0) {
      st.gas.alpine -= windy ? 2 : 1;
    } else {
      const cold = T < -6 && !st.keepWarm;
      if (cold && this.roll(0.45)) {
        st.gas.normal -= 1;
        ok = false;
      } else st.gas.normal -= cold || windy ? 2 : 1;
    }
    st.gas.alpine = Math.max(0, st.gas.alpine);
    st.gas.normal = Math.max(0, st.gas.normal);
    try {
      await this.skip(windy ? 25 : 15, 'idle', { check: () => wasInside && (camp.collapsed || camp.health <= 0) ? 'camp' : null });
    } finally {
      if (this.st === st) {
        this.ui.setBusy(null);
        if (wasInside && !this.over && st.camp === camp && !camp.collapsed && (camp.bivy || camp.health > 0)) {
          camp.inside = true; Object.assign(this.pos, origin);
          st.pos = { x: origin.x, z: origin.z };
          if (!this.eventRunning) this.ui.showCampMenu(this.campMenuInfo());
        }
        this.updateLampState(); this.save();
      }
    }
    if (this.over || this.st !== st) return;
    if (wasInside && (camp.collapsed || !camp.bivy && camp.health <= 0)) {
      this.toast('烧水被帐篷倒塌打断了。请先处理营地，不要重新钻进破损帐篷。', 'warn');
      return;
    }
    if (!ok) {
      this.toast('普通气罐冻透了，火苗只有黄豆大，半天也没烧开。（把气罐揣在怀里，或者买高山气罐）', 'warn', 6000);
      return;
    }
    if (st.water.frozen > 0) { const m = Math.min(st.water.frozen, 0.5); st.water.frozen -= m; st.water.liquid += m * 0.0; }
    if (has(st, 'thermos') && st.thermos.l < 0.95) {
      st.thermos.l = Math.min(1, st.thermos.l + 0.6);
      st.thermos.temp = 90;
      st.body.water = clamp(st.body.water + 6, 0, 100);
      st.body.core = Math.min(37.2, st.body.core + 0.2);
      if (!silent) this.toast('化了一锅雪水，灌满了保温杯，顺手喝了两口。', 'good');
    } else {
      st.body.water = clamp(st.body.water + 18, 0, 100);
      st.body.core = Math.min(37.2, st.body.core + 0.45);
      this.addStress(-5);
      if (!silent) this.toast('化了一锅雪水，趁热喝了下去。', 'good');
    }
    if (silent) this.toast('热水下肚，抖得没那么厉害了。', 'good');
    this.save();
  }

  useWarmer() {
    const st = this.st;
    if (st.warmers <= 0) return;
    st.warmers--;
    st.warmerLeft = 480;
    this.toast('暖宝宝贴在了后腰上。', 'info');
  }

  useFirstAid() {
    const st = this.st, b = st.body;
    if (!has(st, 'firstaid')) return;
    if (b.sprain <= 0 && b.fracture <= 0 && b.health > maxHealth(st) * 0.85) return this.toast('你没有需要处理的伤。', 'info');
    removeItem(st, 'firstaid');
    const k = this.role.mods.firstAid;
    if (b.fracture > 0) { b.fracture = 0.5; b.health = clamp(b.health + 8 + 10 * k, 0, maxHealth(st)); this.toast('你用夹板固定了骨折的部位。疼得满头冷汗，但能慢慢走了。', 'good', 4500); }
    else if (b.sprain > 0) { if (this.roll(0.5 + 0.5 * k)) b.sprain = 0; b.health = clamp(b.health + 6 + 8 * k, 0, maxHealth(st)); this.toast(b.sprain ? '你缠紧了脚踝，还是有点疼。' : '你用绷带固定好了脚踝。', 'good'); }
    else { b.health = clamp(b.health + 10 + 10 * k, 0, maxHealth(st)); this.toast('你处理了身上的擦伤和冻伤。', 'good'); }
  }

  careNpc(id, what) {
    const st = this.st;
    let ok = false;
    if (what === 'hot' && st.thermos.l >= 0.25) { st.thermos.l -= 0.25; this.npcCond(id, st.thermos.temp > 40 ? 15 : 5); ok = true; }
    if (what === 'food') { const f = this._pickFood(); if (f) { removeItem(st, f); this.npcCond(id, 12); ok = true; } }
    if (what === 'warmer' && st.warmers > 0) { st.warmers--; this.npcCond(id, 10); ok = true; }
    this.toast(ok ? `${npcById(id).name}的状况好了一点。` : '你没有可以给的东西。', ok ? 'good' : 'warn');
  }

  charge(dev) {
    const st = this.st;
    if (st.powerbank <= 0) return this.toast('充电宝没电了。', 'warn');
    st.powerbank -= 1;
    st.bat[dev] = Math.min(100, st.bat[dev] + 60);
    if (st.powerbank <= 0) delete st.inv.powerbank;
    this.toast('充上电了。', 'info');
  }

  // ———————————————————— 结局 ————————————————————
  die(cause) {
    if (this.over) return;
    this.log('遇难');
    this.finish('dead', cause);
  }

  async finish(type, cause) {
    if (this.over) return;
    this.over = true;
    this.autoWalk = false;
    const st = this.st;
    const resuming = !!st.ending?.pending;
    st.ending = resuming ? st.ending : { type, cause, pending: true };
    this.ui.hideCampMenu();
    if (!resuming) st.story.resolutions = [];
    // 山下后续也是存档的一部分；刷新后继续结算，不能退回山上。
    const checkpoint = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(st)); } catch (e) { /* 存储受限不阻止结局呈现 */ } };
    checkpoint();
    // 这些发生在虚构的下山之后，不消耗山上剩余电量，也不保证他人获救。
    if (type !== 'dead' && type !== 'sausage' && (st.flags.reportChen && !st.story.threads.chenReportCompleted || st.story.threads.reportNote && !st.story.threads.reportNoteCompleted) && !st.ending.reportResolved) {
      const c = await this.dialog({ pollSource: 'scene:ending_report', who: '下山以后 · 一条尚未移交的线索', sub: '虚构后续',
        text: ['你记下了遇险者的最后位置与时间。现在终于可以向警方完整说明情况。'],
        choices: [{ id: 'report', label: '移交位置、时间与伤情记录' }, { id: 'leave', label: '先把记录留在手机里' }] });
      if (this.st !== st) return;
      st.ending.reportResolved = true;
      if (c === 'report') {
        if (st.flags.reportChen) st.story.threads.chenReportCompleted = true;
        if (st.story.threads.reportNote) st.story.threads.reportNoteCompleted = true;
        st.story.threads.reportCompleted = true;
      }
      st.story.resolutions.push({ title: '山下的报警', text: c === 'report' ? '你把所见情况交给了警方。搜救人员接下了线索；能否找到他，还需要继续确认。' : '那条位置记录仍留在手机里，没有进入搜救信息。' });
    }
    checkpoint();
    if (type !== 'dead' && st.story.threads.contactHome && !st.ending.familyResolved) {
      const c = await this.dialog({ pollSource: 'scene:ending_family', who: '山下 · 回一条消息', sub: '虚构后续', text: ['手机重新接通了网络，家人的消息还停在那句“你现在在哪儿？”上。'],
        choices: [{ id: 'reply', label: '告诉他们：我下山了' }, { id: 'later', label: '先休息，稍后联系' }] });
      if (this.st !== st) return;
      st.ending.familyResolved = true;
      st.story.threads.familyReplied = c === 'reply';
      st.story.resolutions.push({ title: '山下还有人等', text: c === 'reply' ? '你发出了平安消息。这一次，对方很快回了电话。' : '你把电话放在手边，打算休息后再向家人说明。' });
    }
    checkpoint();
    this.music?.stinger(type === 'dead' ? 'death' : type === 'rescued' ? 'rescue' : 'waypoint');
    if (type === 'retreat_branch' && !st.story.threads.exitBranchRecorded) {
      const def = branches[st.path]?.def;
      st.story.threads.exitBranchRecorded = st.path;
      st.story.resolutions.push({ title: def?.name || '支线下撤', text: `你走到了${def?.endName || '游戏接触点'}。连接、里程和抵达后的接应仅是虚构游戏结果；真实报道不证明该路线可以走通。` });
    }
    const fates = [];
    for (const [id, ns] of Object.entries(st.npcs)) {
      const def = npcById(id);
      if (!def || (!ns.met && !ns.passed)) continue;
      let f = ns.fate;
      if (ns.following && !ns.dead) {
        if (type === 'dead') f = id === 'mou' ? 'safe' : 'died';
        else if (type === 'rescued') f = def.fates.rescued ? 'rescued' : 'survived';
        else f = def.fates.survived ? 'survived' : def.fates.followed ? 'followed' : 'together';
      }
      if (f === 'reportLater') f = type === 'dead' ? 'died' : st.story.threads.chenReportCompleted ? 'reported' : 'unknown';
      if (f === 'following') f = 'died';
      if (st.rescue && st.rescue.npcs.includes(id) && type === 'rescued') f = 'rescued';
      const text = f === 'reported' ? '你下山后向警方移交了老陈的位置与状况。搜救正在跟进；此时还不能确认他的最终结局。' : f === 'unknown' ? '你没有移交那条位置记录。你不知道他后来怎样了。' : def.fates[f];
      if (text) fates.push({ name: def.name, age: def.age, fate: f, text });
    }
    const realMin = Math.round((Date.now() - st.stats.startedAt) / 60000);
    const stats = {
      days: Math.max(1, Math.ceil((st.time - 330) / 1440)),
      time: fmtDateTime(st.time),
      dist: (st.stats.walked * KM_PER_UNIT).toFixed(1),
      progress: (st.maxS * KM_PER_UNIT).toFixed(1),
      maxAlt: Math.round(st.stats.maxAlt),
      minCore: st.stats.minCore.toFixed(1),
      coldest: Math.round(st.stats.coldestFelt),
      nights: st.stats.nights,
      realMin,
      fines: st.flags.illegal ? (st.fines || 0) + (type === 'dayehai' || type === 'cross' || type === 'rescued' || type === 'retreat' || type === 'retreat_branch' || type === 'retreat_wild' || type === 'sigma' ? 5000 : 0) : 0,
      rescueCost: type === 'rescued' ? 80000 : 0,
      insurance: !!st.flags.insurance,
    };
    if (stats.fines > 5000) stats.fines = 5000;
    st.ending.pending = false;
    this.analytics?.track('run_ended', st, { ending: type, cause: cause || undefined, death: type === 'dead', activeSeconds: st.telemetry?.activeSeconds || 0 });
    void this.analytics?.flush();
    localStorage.removeItem(SAVE_KEY);
    // 游玩记录
    const epilogues = collectEpilogues(st, type, fates);
    const key = endingKey(type, cause);
    const previous = summarize();
    const isNew = !previous.unlocked.has(key);
    const newEpilogues = epilogues.filter((id) => !previous.unlockedEpilogues.has(id));
    const okFates = ['safe', 'rescued', 'survived', 'followed', 'together', 'helped', 'warned', 'waited'];
    const records = addRecord({
      at: Date.now(), role: this.role.id, roleName: this.role.short, difficulty: st.difficulty, key, type, cause: cause || null,
      progress: Number(stats.progress), dist: Number(stats.dist), days: stats.days, maxAlt: stats.maxAlt,
      minCore: Number(stats.minCore), realMin: realMin, nights: stats.nights,
      saved: fates.filter((f) => okFates.includes(f.fate)).length, lost: fates.filter((f) => f.fate === 'died').length,
      exitBranch: type === 'retreat_branch' ? st.path : null,
      epilogues, decisions: st.story.decisions.slice(-12), resolutions: st.story.resolutions,
    });
    const sum = summarize(records);
    stats.collected = `${ENDING_LIST.filter((e) => sum.unlocked.has(e.id)).length} / ${ENDING_LIST.length}`;
    stats.epilogueCollected = `${sum.unlockedEpilogues.size} / ${EPILOGUE_LIST.length}`;
    stats.newEnding = isNew;
    stats.runs = sum.total;
    this.ui.showHud(false);
    this.ui.hideCampMenu();
    this.ui.hideCampPlacer();
    this.ui.showEnding({ type, cause, role: this.role, stats, fates, epilogues, newEpilogues, decisions: st.story.decisions, resolutions: st.story.resolutions });
  }

  // ———————————————————— 视觉 ————————————————————
  updateVisuals(dt) {
    const st = this.st;
    if (!st) return;
    const wx = this.wx();
    const inCamp = st.camp && st.camp.inside;
    this.player.visible = !(inCamp && !st.camp.bivy);
    this.player.position.copy(this.pos);
    const pose = inCamp && st.camp.bivy ? 'sit' : this.crouch ? 'crouch' : st.body.collapsed ? 'sit' : (!this.moving && this.restTimer > 2 && this.busy) ? 'sit' : 'stand';
    animateCharacter(this.player, dt, this.moving, this.speedFactor(), pose);

    // 相机
    const rawCamera = this.input.cameraDelta();
    const cd = this.eventCamera?.active ? { active: false, dx: 0, dy: 0, zoom: 1 } : rawCamera;
    if (cd.active) this.cam.idle = 0; else this.cam.idle += dt;
    this.cam.yaw -= cd.dx * 0.006;
    this.cam.pitch = clamp(this.cam.pitch + cd.dy * 0.004, 0.06, 1.35);
    this.cam.dist = clamp(this.cam.dist * cd.zoom, 3.5, 30);
    if (this.moving && this.autoWalk && this.cam.idle > 1.5) {
      const want = this.player.rotation.y + Math.PI;
      this.cam.yaw = lerpAngle(this.cam.yaw, want, Math.min(1, dt * 0.8));
    }
    const focus = inCamp && !st.camp.bivy ? new THREE.Vector3(st.camp.x, this.world.height(st.camp.x, st.camp.z), st.camp.z) : this.pos;
    if (inCamp && !st.camp.bivy && this.cam.idle > 3 && !this.eventCamera?.active) this.cam.yaw += dt * 0.05;
    this.camTarget.lerp(new THREE.Vector3(focus.x, focus.y + 1.5, focus.z), Math.min(1, dt * 8));
    const cp = this.cam.pitch, cy = this.cam.yaw, dist = this.cam.dist;
    const camPos = new THREE.Vector3(
      this.camTarget.x + Math.sin(cy) * Math.cos(cp) * dist,
      this.camTarget.y + Math.sin(cp) * dist,
      this.camTarget.z + Math.cos(cy) * Math.cos(cp) * dist,
    );
    const eventShot = this.eventCamera?.sample(dt, camPos, this.camTarget);
    if (eventShot) camPos.copy(eventShot.position);
    const lookAt = eventShot?.target || this.camTarget;
    const gh = this.world.height(camPos.x, camPos.z) + 1.2;
    if (camPos.y < gh) camPos.y = gh;
    if (this.gust.push > 0) camPos.x += (Math.random() - 0.5) * 0.15;
    if (st.body.shiver > 0.6) camPos.y += (Math.random() - 0.5) * 0.04 * st.body.shiver;
    this.world.camera.position.copy(camPos);
    this.world.camera.lookAt(lookAt);
    this._displayTarget.copy(lookAt);
    if (!this.eventCamera?.active && this._eventFocus) this.clearEventActor();
    if (this._eventActor?.userData.eventVisitor) animateCharacter(this._eventActor, dt, false, 1, 'stand');

    // 区块
    this.world.ensureChunks(this.pos.x, this.pos.z, this.world.mobile ? 5 : 8);

    // 大气
    const { to } = windVectors(wx.dirDeg);
    const windS = wx.wind * wx.gust;
    const sunEl = this.sunEl();
    // 能见度以玩家为基准：雾的远端要加上相机到玩家的距离，否则玩家自己会被雾吞没
    let vis = this.visibility() + this.cam.dist * 0.9;
    const ry = this.player.rotation.y;
    const fwd = { x: Math.sin(ry), z: Math.cos(ry) };
    const lampOn = st.lampOn && has(st, 'headlamp') && st.bat.headlamp > 0;
    const exp = inCamp && !st.camp?.bivy ? 0.3 : this.exposure();
    // 脚印：在雪地上每走一步留一个
    let footstep = null;
    if (this.moving && !this.falling) {
      this._stepAcc = (this._stepAcc || 0) + Math.hypot(this.pos.x - (this._lastFx ?? this.pos.x), this.pos.z - (this._lastFz ?? this.pos.z));
      if (this._stepAcc > 0.55) {
        this._stepAcc = 0;
        const info = this.here();
        if (!info.ice && info.type !== 'village') footstep = { x: this.pos.x, y: this.world.height(this.pos.x, this.pos.z), z: this.pos.z, rotY: ry };
      }
    }
    this._lastFx = this.pos.x; this._lastFz = this.pos.z;
    const T = this.env ? this.env.T : -10;
    const altNow = voxToAlt(this.pos.y);
    this.world.updateAtmosphere({
      hour: this.hour(), sunEl, overcast: wx.overcast, visibility: vis, fogginess: wx.fog,
      precip: wx.precip, spindrift: wx.spindrift || windS * this.exposure() > 15,
      wind: { x: to.x * windS, z: to.z * windS }, blizzard: wx.blizzard, exposure: exp,
      breath: {
        active: !(inCamp && !st.camp.bivy) && this.player.visible,
        pos: new THREE.Vector3(this.pos.x + fwd.x * 0.3, this.pos.y + (this.crouch ? 1.2 : 1.62), this.pos.z + fwd.z * 0.3),
        dir: fwd, cold: clamp((4 - T) / 18, 0, 1),
        rate: 0.22 + (1 - st.body.stamina / 100) * 0.45 + (this.moving ? 0.18 : 0) + (st.body.stress > 70 ? 0.2 : 0),
      },
      footstep,
      lamp: { on: lampOn, pos: new THREE.Vector3(this.pos.x, this.pos.y + 1.6, this.pos.z), dir: new THREE.Vector3(fwd.x, -0.25, fwd.z).normalize() },
      cloudSea: clamp((altNow - 2950) / 300, 0, 1) * (1 - wx.fog) * (1 - wx.precip) * (wx.overcast < 0.8 ? 1 : 0.35),
    }, dt, this.pos);
    const lampVisible = lampOn && (!st.story.effects.headlampFault || Math.floor(performance.now() / 600) % 4 !== 0);
    this.world.setHeadlamp(lampVisible, this.pos, fwd);

    // 屏幕效果
    const b = st.body;
    const coldK = clamp((36.6 - b.core) / 4, 0, 1);
    this.world.setGrade({ cold: coldK, desat: clamp((35.2 - b.core) / 3.5, 0, 1) * 0.8 + clamp((b.stress - 75) / 25, 0, 1) * 0.25, vignette: clamp((b.stress - 50) / 50, 0, 1) + clamp((40 - b.health) / 40, 0, 1) });
    this.ui.setEffects({
      cold: coldK,
      hurt: clamp((50 - b.health) / 50, 0, 1),
      stress: clamp((b.stress - 60) / 40, 0, 1),
      white: (wx.blizzard ? 0.2 : wx.fog > 0.8 ? 0.07 : 0) * clamp((sunEl + 0.1) / 0.3, 0, 1),
      blur: clamp((b.snowblind - 40) / 60, 0, 1) + clamp((33.5 - b.core) / 3, 0, 1),
      dark: b.collapsed ? 0.5 : 0,
      frost: clamp((-T - 12) / 20, 0, 1) * (inCamp && !st.camp?.bivy ? 0.3 : 1),
      wind: wx.blizzard ? 1 : clamp((windS * this.exposure() - 12) / 12, 0, 1),
    });
    this.audio?.setWind(clamp(windS * (inCamp && !st.camp?.bivy ? 0.4 : this.exposure()) / 25, 0, 1), inCamp && !st.camp?.bivy);
    if (this.tentMesh && st.camp) {
      const k = clamp(windS * (st.camp.exposure || 0.5) / 25, 0, 1);
      const t = performance.now() * 0.001;
      this.tentMesh.scale.set(1 + Math.sin(t * 9) * 0.015 * k, 1 - Math.abs(Math.sin(t * 7.3)) * 0.04 * k, 1);
    }
  }

  refreshHud(force) {
    const st = this.st;
    if (!st || (this.over && !force)) return;
    const wx = this.wx();
    const T = this.airT();
    const exp = st.camp && st.camp.inside && !st.camp.bivy ? 0 : this.exposure();
    const windS = wx.wind * wx.gust * exp;
    const env = this.env;
    const path = this.path();
    let next = null;
    if (st.path === 'main') {
      const list = mainPath.waypoints.filter((w) => (st.dir > 0 ? w.s > st.s + 3 : w.s < st.s - 3));
      const wp = st.dir > 0 ? list[0] : list[list.length - 1];
      if (wp) next = { name: wp.name, km: Math.abs(wp.s - st.s) * KM_PER_UNIT };
      else if (st.dir < 0) next = { name: '塘口村', km: st.s * KM_PER_UNIT };
    } else next = { name: path.def.endName, km: (path.length - st.s) * KM_PER_UNIT };
    const gps = st.gpsOn && has(st, 'gps') && st.bat.gps > 0;
    let gpsArrow = null;
    if (gps) {
      const near = path.nearestNear(this.pos.x, this.pos.z, st.s, 60);
      const tgt = near.d > 4 ? path.pointAt(near.s) : path.pointAt(near.s + st.dir * 10);
      const ang = Math.atan2(tgt.x - this.pos.x, tgt.z - this.pos.z);
      gpsArrow = { rel: ang - (this.cam.yaw + Math.PI), off: Math.round(near.d * 40) };
    }
    const b = st.body;
    this.ui.hud({
      date: fmtDate(st.time), clock: fmtClock(st.time), day: this.day() + 1,
      weather: wx.name, wicon: wx.icon, wid: wx.id, night: this.night(),
      maxKm: st.path === 'main' ? st.maxS * KM_PER_UNIT : st.s * KM_PER_UNIT, onMain: st.path === 'main', visited: st.visited,
      air: Math.round(T), feel: Math.round(env ? env.Teff : T),
      wind: Math.round(windS), bft: beaufort(windS), windDir: compassName(wx.dirDeg),
      windRel: Math.atan2(-Math.sin((wx.dirDeg * Math.PI) / 180), Math.cos((wx.dirDeg * Math.PI) / 180)) - (this.cam.yaw + Math.PI),
      alt: Math.round(voxToAlt(this.pos.y)),
      km: st.path === 'main' ? st.s * KM_PER_UNIT : st.s * KM_PER_UNIT,
      route: st.flags.freeDescent ? '自行下撤' : st.path === 'main' ? (st.dir > 0 ? '鳌山 → 太白' : '下撤 → 塘口') : path.def.name,
      total: st.path === 'main' ? mainPath.length * KM_PER_UNIT : path.length * KM_PER_UNIT,
      next: st.flags.freeDescent ? null : next,
      core: b.core, coreFeel: coreFeel(b.core), showCore: !!this.role.mods.showCore,
      maxHealth: maxHealth(st), difficulty: difficultyProfile(st).name, stamina: b.stamina, food: b.food, water: b.water, stress: b.stress, health: b.health, wet: b.wet,
      status: {
        lost: st.flags.lost, sprain: b.sprain > 0, fracture: b.fracture > 0, frost: b.frostbite > 25,
        shiver: b.shiver > 0.3, sweat: b.sweating > 0.5 && this.moving, snowblind: b.snowblind > 50, alt: b.altSick > 40,
        wet: b.wet > 40, collapsed: b.collapsed, drunk: st.alcoholLeft > 0, warmer: st.warmerLeft > 0,
      },
      phone: Math.round(st.bat.phone), airplane: st.airplane, signal: st.airplane ? -1 : this.signal(),
      gpsArrow, compass: has(st, 'compass') || gps ? this.cam.yaw : null,
      fast: st.pace === 'fast', auto: this.autoWalk, crouch: this.crouch, inCamp: !!(st.camp && st.camp.inside),
      rescue: st.rescue?.self ? true : null,
      companions: st.companions.map((id) => ({ id, name: npcById(id).name, cond: st.npcs[id].cond })),
      insul: st.wearInsul, hasInsul: this.hasInsul(),
      gustDanger: windS > 12.5,
    });
  }

  // ———————————————————— 杂项 ————————————————————
  placeName() {
    const st = this.st;
    if (st.path !== 'main') return branches[st.path].def.name + '途中';
    let best = null, bd = 1e9;
    for (const wp of mainPath.waypoints) { const d = Math.abs(wp.s - st.s); if (d < bd) { bd = d; best = wp; } }
    return bd < 40 ? best.name + '附近' : best.name + '一带的山脊上';
  }

  hallucinationSpot() {
    const st = this.st;
    const p = this.path().pointAt(st.s + st.dir * 22);
    const side = Math.random() < 0.5 ? 1 : -1;
    return { x: p.x - p.dz * 24 * side, z: p.z + p.dx * 24 * side };
  }

  setLure(spot) {
    this.lure = { x: spot.x, z: spot.z, t: 0 };
    this.autoWalk = true;
  }

  _clearLure(reached) {
    if (!this.lure) return;
    this.lure = null;
    this.world.showHallucination(0, 0, false);
    this.autoWalk = false;
    if (reached) { this.addStress(8); this.toast('光灭了。那里什么都没有，只有雪。你离路线更远了。', 'danger', 5000); }
  }

  log(text) {
    this.st.log.push({ t: this.st.time, text });
    if (this.st.log.length > 80) this.st.log.shift();
  }

  toast(text, kind = 'info', ms) { this.ui.toast(text, kind, ms); }
  async dialog(opts) {
    const st = this.st;
    if (this._eventFocus?.id === 'hallucination' && this.world.hallu?.visible) this.beginEventFocus({ object: this.world.hallu, event: 'hallucination' });
    this._dialogSerial = (this._dialogSerial || 0) + 1;
    const poll = makeQuestion(opts.pollSource || this._pollSource, opts.choices);
    const result = await this.ui.dialog({ ...opts, poll });
    if (!this.eventRunning && this.st === st && !this.over) recordDialog(st);
    return result;
  }
  say(who, text, ok = '继续') { return this.dialog({ who, text, choices: [{ id: 'ok', label: ok }] }); }

  save() {
    if (!this.st || this.over && !this.st.ending?.pending) return;
    try {
      let data = this.st;
      if (this.eventSnapshot && !this.over) {
        data = JSON.parse(this.eventSnapshot);
        if (this.st.telemetry) data.telemetry = this.st.telemetry;
        else delete data.telemetry;
        this.eventSnapshot = JSON.stringify(data);
      }
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch (e) { /* 存储受限不阻止剧情 */ }
  }

  static loadSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const st = JSON.parse(raw);
      if (!st || st.v !== 1 || st.ending && !st.ending.pending) return null;
      ensureStoryState(st);
      return st;
    } catch (e) { return null; }
  }
  static clearSave() { localStorage.removeItem(SAVE_KEY); }
}

export function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export function fmtClock(t) {
  const m = ((Math.floor(t) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
export function fmtDate(t) {
  const d = Math.floor(t / 1440);
  return d === 0 ? '12月31日' : `1月${d}日`;
}
export function fmtDateTime(t) { return `${fmtDate(t)} ${fmtClock(t)}`; }
