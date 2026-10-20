// 入口：组装世界、输入、音频、界面与游戏，管理标题场景与主循环。
import './style.css';
import './hud.css';
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
const ui = new UI({ mobile, audio, input });
ui.music = music;
const game = new Game(world, ui, input, audio);
game.music = music;
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
  ui.closeScreen();
  game.start(st);
  if (fresh) {
    game.runEvent(async () => {
      await game.dialog({
        who: '塘口村 · 凌晨5:30', sub: '12月31日 · 元旦假期',
        text: [
          '天还没亮。村子里只有几声狗叫，远处的山脊在星光下是一道黑色的剪影。',
          '从这里到太白山拔仙台，大约113公里山脊。没有补给点，大部分路段没有信号。',
          mobile
            ? '左下角拖动摇杆移动，右侧拖动屏幕转视角。点【沿路走】会自动沿路线前进。'
            : 'WASD 移动，鼠标拖拽转视角，F 沿路走，空格按住稳住，B 背包，M 地图。',
        ],
        choices: [{ id: 'go', label: '出发' }],
      });
      game.toast('沿着路边的玛尼堆和红布条走。天黑、起雾时它们会很难看清。', 'info', 6000);
    });
  }
}

const app = {
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
document.addEventListener('visibilitychange', () => { if (document.hidden && mode === 'trek') game.save(); });

// 主循环
let last = performance.now();
let frames = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (mode === 'trek') game.update(dt);
  else titleUpdate(dt);
  music.update(dt, musicMood());
  world.render();
  if (++frames === 30) document.getElementById('boot').classList.add('gone');
  requestAnimationFrame(frame);
}

setupTitleScene();
world.ensureChunks(title.center.x, title.center.z, 60);
ui.showTitle({ hasSave: !!Game.loadSave() });
requestAnimationFrame(frame);
