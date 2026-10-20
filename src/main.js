// 入口：组装世界、输入、音频、界面与游戏，管理标题场景与主循环。
import './style.css';
import './hud.css';
import { AnalyticsClient } from './analytics/client.js';
import * as THREE from 'three';
import { World } from './world/world.js';
import { Input } from './ui/input.js';
import { GameAudio } from './ui/audio.js';
import { Music } from './ui/music.js';
import { UI } from './ui/ui.js';
import { Game } from './sim/game.js';
import { waypointPos } from './world/terrain.js';
import { sunElevation } from './sim/weather.js';

const mobile = matchMedia('(pointer: coarse)').matches || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
const canvas = document.getElementById('c');
const world = new World(canvas, { mobile });
const input = new Input({
  canvas,
  joyZone: document.getElementById('joy'),
  joyBase: document.getElementById('joyBase'),
  joyKnob: document.getElementById('joyKnob'),
  isMobile: mobile,
});
const audio = new GameAudio();
const music = new Music(audio);
const analytics = new AnalyticsClient({ fetcher: (...args) => (import.meta.env.PROD || globalThis.__AOTAI_TEST_ANALYTICS__) ? fetch(...args) : Promise.reject(new Error('local-only')) });
const ui = new UI({ mobile, audio, input });
ui.analytics = analytics;
ui.music = music;
const game = new Game(world, ui, input, audio);
game.music = music;
game.analytics = analytics;
ui.game = game;

const clamp01 = (v) => Math.max(0, Math.min(1, v));
// 根据玩家处境计算配乐情绪
function musicMood() {
  if (ui.screenOpen === 'ending') {
    const tone = ui.endingTone;
    return { scene: tone === 'good' ? 'ending_good' : tone === 'bad' ? 'ending_bad' : 'ending_mixed', calm: 0.5, tension: 0.2, danger: 0, night: false, severity: 0, altitude: 3000, cold: 0, heartRate: 0.2 };
  }
  const st = game.st;
  if (mode !== 'trek' || !st) return { scene: 'title', calm: 0.8, tension: 0.15, danger: 0, night: false, severity: 0.2, altitude: 3475, cold: 0, heartRate: 0.2 };
  const b = st.body;
  const wx = game.wx();
  const exp = game.exposure();
  const night = game.night();
  const cold = clamp01((36.4 - b.core) / 4);
  const danger = Math.max(
    clamp01((35.6 - b.core) / 3), clamp01((45 - b.health) / 45), st.flags.lost ? 0.55 : 0,
    wx.blizzard && exp > 0.7 ? 0.7 : wx.severity > 0.6 ? wx.severity * 0.5 * exp : 0,
    b.collapsed ? 0.8 : 0, clamp01((b.stress - 75) / 25) * 0.7, st.rescue ? 0.25 : 0,
  );
  const tension = Math.max(night ? 0.45 : 0, wx.severity * 0.75, cold * 1.2, (1 - b.stamina / 100) * 0.5, b.stress / 140, (100 - b.food) / 250);
  const calm = clamp01(1 - tension * 1.1 - danger);
  return {
    scene: st.camp && st.camp.inside ? 'camp' : 'trek',
    calm, tension: clamp01(tension), danger: clamp01(danger), night, severity: wx.severity,
    altitude: game.alt(), cold, heartRate: clamp01(0.2 + danger * 0.6 + (b.stress / 100) * 0.3 + (game.moving ? 0.15 : 0)),
  };
}

let mode = 'title';
const title = { center: null, angle: 0.6 };

function setupTitleScene() {
  const p = waypointPos('daohang');
  const y = world.height(p.x, p.z);
  title.center = new THREE.Vector3(p.x + 6, y + 3, p.z);
}

function titleUpdate(dt) {
  const c = title.center;
  world.ensureChunks(c.x, c.z, mobile ? 6 : 10);
  title.angle += dt * 0.035;
  const r = mobile ? 34 : 42;
  world.camera.position.set(c.x + Math.sin(title.angle) * r, c.y + 15, c.z + Math.cos(title.angle) * r);
  world.camera.lookAt(c.x, c.y + 2, c.z);
  const hour = 16.9;
  world.updateAtmosphere({
    hour, sunEl: sunElevation(hour), overcast: 0.25, visibility: 190, fogginess: 0.15,
    precip: 0.18, spindrift: false, wind: { x: 3, z: 2 }, blizzard: false, exposure: 0.8, cloudSea: 0.9,
  }, dt, c);
  world.setHeadlamp(false);
}

function startTrek(st, fresh) {
  mode = 'trek';
  analytics.beginRun(st, { fresh });
  void analytics.flush();
  ui.closeScreen();
  game.start(st, { fresh });
  if (fresh) {
    game.toast(mobile
      ? '拖动左下摇杆移动 · 右侧划动转视角'
      : 'WASD移动 · 拖拽转视角 · F沿路走', 'info', 6000);
  }
}

const app = {
  toggleAnalytics() {
    analytics.setEnabled(!analytics.enabled);
    if (analytics.enabled && game.st && !game.over) analytics.beginRun(game.st, { fresh: false });
    if (!analytics.enabled) {
      if (game.st) delete game.st.telemetry;
      try { const saved = Game.loadSave(); if (saved?.telemetry) { delete saved.telemetry; localStorage.setItem('aotai-save-v1', JSON.stringify(saved)); } } catch {}
    }
    game.save();
    ui.toast(analytics.enabled ? '已参与匿名统计，可随时在菜单中关闭' : '已停止上报，清除本机统计标识与待发送队列', 'info');
  },
  toTitle() {
    mode = 'title';
    game.dispose();
    ui.showHud(false);
    ui.hideCampMenu();
    ui.hideCampPlacer();
    ui.closeSheet();
    setupTitleScene();
    ui.showTitle({ hasSave: !!Game.loadSave() });
  },
  continueGame() {
    const st = Game.loadSave();
    if (st) startTrek(st, false);
  },
  depart(st) {
    Game.clearSave();
    startTrek(st, true);
  },
  quit() {
    Game.clearSave();
    app.toTitle();
  },
  toggleAuto() {
    const st = game.st;
    if (!st || game.over) return;
    if (st.camp && st.camp.inside) return game.toast('先收起营地再出发。', 'warn');
    if (st.flags.freeDescent) return game.toast('自行下撤时请手动移动；下撤菜单可切回既有路线。', 'info');
    game.autoWalk = !game.autoWalk;
    if (game.autoWalk && st.body.collapsed) game.toast('你现在走不动。先休息、吃点东西。', 'warn');
  },
  togglePace() { game.togglePace(); },
  restMenu() {
    const st = game.st;
    if (!st || game.over || (st.camp && st.camp.inside)) return;
    game.runEvent(async () => {
      const choices = [
        { id: '30', label: '休息30分钟', sub: st.wearInsul || !game.hasInsul() ? '' : '记得先穿上保暖层' },
        { id: '120', label: '休息2小时' },
      ];
      if (st.rescue?.self) choices.push({ id: 'wait', label: '原地等待救援', sub: '抵达时间无法确认' });
      choices.push({ id: 'no', label: '算了' });
      const c = await game.dialog({ who: '休息', text: ['在寒风里坐下来，身体会很快变冷。找块背风的石头，穿上保暖层，吃点东西。'], choices });
      if (c === '30' || c === '120') await game.restFor(Number(c));
      if (c === 'wait') await game.waitForRescue();
    });
  },
  camp() {
    if (!game.st || game.over) return;
    game.beginCamp();
  },
  retreat() {
    if (!game.st || game.over) return;
    game.runEvent(() => game.retreatMenu());
  },
  sos() {
    const st = game.st;
    if (!st || game.over) return;
    if (st.rescue?.self && st.rescue.moved) return game.updateRescuePosition();
    if (st.rescue && st.rescue.self) return game.toast('救援队已经接到消息。请保存体力，保持联系，原地等待。', 'info');
    if (!game.comms().any) return game.toast(game.commsLabel(), 'warn', 4500);
    game.runEvent(async () => {
      const c = await game.dialog({
        who: '求救', text: ['一旦报警，几十名救援队员会冒着风雪上山。', '求救之后，留在原地，不要乱走。'],
        choices: [{ id: 'y', label: '求救', sub: game.commsLabel() }, { id: 'n', label: '再坚持一下' }],
      });
      if (c === 'y') await game.sos({});
    });
  },
};
ui.app = app;
if (import.meta.env.DEV) Object.assign(window, { __game: game, __ui: ui, __world: world, __app: app });

// 快捷键
input.onKey((k) => {
  if (mode !== 'trek' || !game.st || game.over || ui.dialogOpen || ui.screenOpen) return;
  if (k === 'escape') {
    if (ui.sheetOpen) return ui.closeSheet();
    if (game.campPlacing) return game.cancelCamp();
    return ui.openMenu();
  }
  if (k === 'b' || k === 'i' || k === 'tab') return ui.toggleSheet('pack');
  if (k === 'm') return ui.toggleSheet('map');
  if (ui.sheetOpen || game.busy || game.eventRunning) return;
  if (k === 'f') app.toggleAuto();
  else if (k === 'v') app.togglePace();
  else if (k === 'r') app.restMenu();
  else if (k === 'c') app.camp();
  else if (k === 'x') app.retreat();
  else if (k === 'h') app.sos();
});

// 音频需要用户手势解锁
const unlock = () => audio.unlock();
window.addEventListener('pointerdown', unlock);
window.addEventListener('keydown', unlock);
function checkpointAnalytics() {
  if (mode === 'trek' && game.st && !game.over) analytics.track('run_checkpoint', game.st, { activeSeconds: game.st.telemetry?.activeSeconds || 0, uniqueKey: `lifecycle:${Math.floor(game.st.telemetry?.activeSeconds || 0)}` });
  game.save();
  void analytics.flush();
}
document.addEventListener('visibilitychange', () => { if (document.hidden) checkpointAnalytics(); });
window.addEventListener('pagehide', checkpointAnalytics);

// 主循环
let last = performance.now();
let frames = 0, analyticsTimer = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (mode === 'trek') {
    if (!document.hidden && game.st && !game.over && !game.busy && !game.eventRunning && !ui.modalOpen && game.st.story?.pacing?.started) analytics.tick(game.st, dt);
    game.update(dt);
  }
  else titleUpdate(dt);
  if ((analyticsTimer += dt) >= 15) { analyticsTimer = 0; void analytics.flush(); }
  music.update(dt, musicMood());
  world.render();
  if (++frames === 30) document.getElementById('boot').classList.add('gone');
  requestAnimationFrame(frame);
}

setupTitleScene();
world.ensureChunks(title.center.x, title.center.z, 60);
ui.showTitle({ hasSave: !!Game.loadSave() });
requestAnimationFrame(frame);
