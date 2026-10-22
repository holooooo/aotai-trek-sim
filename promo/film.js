// Promo film shots, rendered with the game's own World (terrain, sky, weather FX, voxel models).
// Each shot is a pure function of its local time t plus a fixed-dt stepping of the weather particles,
// so a shot always renders the same when stepped from its start (shoot.mjs does exactly that).
const FONT = new FontFace('ZCOOL QingKe HuangYou', 'url(/.fontsrc/ZCOOLQingKeHuangYou-Regular.ttf)');
document.fonts.add(await FONT.load());   // signs are drawn into canvases when the world is built

const THREE = await import('three');
const { World } = await import('../src/world/world.js');
const { mainPath, waypointPos, columnInfo } = await import('../src/world/terrain.js');
const { CAIRNS } = await import('../src/world/chunk.js');
const M = await import('../src/world/models.js');
const { sunElevation } = await import('../src/sim/weather.js');

const P = new URLSearchParams(location.search);
const canvas = document.getElementById('c');
try { localStorage.setItem('aotai-quality', 'high'); } catch (e) { /* ignore */ }
const world = new World(canvas, { mobile: false });
world.radius = +(P.get('radius') || 8);
const cam = world.camera;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
const ease = (x) => { x = clamp(x); return 1 - Math.pow(1 - x, 3); };

// —— 场景工具 ——
const ground = (x, z) => world.height(x, z);
/** point on the main path at arc length s, pushed `side` voxels to the right and `fwd` along the path */
function along(s, side = 0, fwd = 0, path = mainPath) {
  const p = path.pointAt(s + fwd);
  const x = p.x - p.dz * side, z = p.z + p.dx * side;
  return { x, z, y: ground(x, z), dx: p.dx, dz: p.dz, yaw: Math.atan2(p.dx, p.dz) };
}
const wpS = (id) => waypointPos(id).s;
const load = (x, z) => world.loadAllAround(x, z);

const HIKER = { jacket: 0xff5a1f, pants: 0x2b3a55, hat: 0xe8eef2, pack: 0x2b2f36, skin: 0xe8c39e, boots: 0x3a2a1e };
function hiker(look = HIKER) {
  const h = world.shadowify(M.makeCharacter(look));
  world.scene.add(h);
  return h;
}
function place(obj, x, z, yaw = 0, yOff = 0) {
  obj.position.set(x, ground(x, z) + yOff, z);
  obj.rotation.y = yaw;
  world.scene.add(obj);
  world.shadowify(obj);
  return obj;
}

let lastFoot = null;
/** weather + light; mirrors Game.updateVisuals */
function atmo(o, dt, center, extra = {}) {
  const hour = o.hour ?? 10;
  const w = o.wind ?? { x: 3, z: 2 };
  world.updateAtmosphere({
    hour, sunEl: sunElevation(hour), overcast: o.overcast ?? 0.2, visibility: o.vis ?? 220, fogginess: o.fog ?? 0.1,
    precip: o.precip ?? 0, spindrift: !!o.spindrift, wind: w, blizzard: !!o.blizzard, exposure: o.exposure ?? 1,
    cloudSea: o.cloudSea ?? 0, flash: o.flash ?? 0, ...extra,
  }, dt, center);
  world.setGrade({ cold: o.cold ?? 0, desat: o.desat ?? 0, vignette: o.vignette ?? 0 });
  if (o.fogFar) { world.scene.fog.far = o.fogFar; world.scene.fog.near = o.fogNear ?? 40; }
  world.renderer.toneMappingExposure = o.exposureK ?? 1.3;
}
function breathOf(h, cold = 1, rate = 0.35) {
  const ry = h.rotation.y;
  return { active: true, pos: V(h.position.x + Math.sin(ry) * 0.3, h.position.y + 1.62, h.position.z + Math.cos(ry) * 0.3), dir: { x: Math.sin(ry), z: Math.cos(ry) }, cold, rate };
}
function lampOf(h, on = true) {
  const ry = h.rotation.y;
  world.setHeadlamp(on, h.position, { x: Math.sin(ry), z: Math.cos(ry) });
  return { on, pos: V(h.position.x, h.position.y + 1.6, h.position.z), dir: V(Math.sin(ry), -0.25, Math.cos(ry)).normalize() };
}
function footOf(h, moving) {
  if (!moving) return null;
  const p = h.position;
  if (lastFoot && Math.hypot(p.x - lastFoot.x, p.z - lastFoot.z) < 0.55) return null;
  lastFoot = { x: p.x, z: p.z };
  return { x: p.x, y: ground(p.x, p.z), z: p.z, rotY: h.rotation.y };
}
function look(from, to) {
  cam.position.copy(from);
  const gh = ground(from.x, from.z) + 0.8;
  if (cam.position.y < gh) cam.position.y = gh;
  cam.lookAt(to);
}
function shake(k, t) {
  cam.position.x += Math.sin(t * 61.7) * 0.06 * k + Math.sin(t * 23.1) * 0.04 * k;
  cam.position.y += Math.sin(t * 47.3 + 1) * 0.05 * k;
}
const walkTo = (h, s0, s1, side, t, t0, t1) => {
  const u = clamp((t - t0) / (t1 - t0));
  const a = along(lerp(s0, s1, u), side);
  h.position.set(a.x, a.y, a.z);
  h.rotation.y = a.yaw;
  return a;
};

// —— 镜头 ——
// setup() builds the set; frame(t, dt) poses everything for local time t (seconds) and steps the FX.
const SHOTS = {};
const offAt = (p, side, al) => ({ x: p.x - p.dz * side + p.dx * al, z: p.z + p.dx * side + p.dz * al });

// 0. 钩子：大雪里迎面走来的人，风把雪吹成线
SHOTS.hook = {
  dur: 4.2,
  setup(S) {
    S.s0 = wpS('feiji') - 30;
    const a = along(S.s0, 0);
    load(a.x, a.z);
    S.h = hiker();
  },
  frame(S, t, dt) {
    const a = walkTo(S.h, S.s0, S.s0 + 3.2, 0.1, t, 0, 5);
    M.animateCharacter(S.h, dt, true, 0.5);
    S.h.rotation.z = Math.sin(t * 1.7) * 0.04 - 0.07;
    S.h.userData.head.rotation.x = 0.25;
    const k = ease(t / 5);
    const c = along(S.s0 + 3.2 * clamp(t / 5) + 4.6 - k * 1.0, -1.7 + k * 0.5);
    look(V(c.x, a.y + 1.75, c.z), V(a.x, a.y + 1.3, a.z));
    shake(0.35, t);
    atmo({ hour: 15.3, overcast: 1, vis: 30, fog: 0.8, precip: 0.9, wind: { x: -16, z: 10 }, spindrift: true, cold: 0.45, vignette: 0.35 }, dt, S.h.position,
      { breath: breathOf(S.h, 1, 0.6), footstep: footOf(S.h, true) });
  },
};

// 1b. 刃脊航拍：飞机梁，两侧是陡坡，云海在下面
SHOTS.ridge2 = {
  dur: 3.4,
  setup(S) {
    S.p = waypointPos('feiji');
    load(S.p.x, S.p.z);
    S.h = hiker();
  },
  frame(S, t, dt) {
    const a = walkTo(S.h, S.p.s - 14, S.p.s - 11, 0, t, 0, 5);
    M.animateCharacter(S.h, dt, true, 0.6);
    const u = ease(t / 5);
    const c = along(S.p.s - 34 + u * 6, -14 + u * 3);
    look(V(c.x, a.y + 16 - u * 4, c.z), V(lerp(a.x, S.p.x, 0.5), a.y - 1, lerp(a.z, S.p.z, 0.5)));
    atmo({ hour: 14.2, overcast: 0.15, vis: 260, fog: 0.05, precip: 0, wind: { x: 6, z: 3 }, cloudSea: 1, fogNear: 60, fogFar: 480, desat: -0.1 }, dt, S.h.position,
      { breath: breathOf(S.h, 0.8), footstep: footOf(S.h, true) });
  },
};

// 1. 山脊航拍：日出，导航架，橙色的人在山脊上
SHOTS.ridge = {
  dur: 3.6,
  setup(S) {
    S.s0 = wpS('aoliang') + 40;
    const a = along(S.s0 + 30, 0);
    load(a.x, a.z);
    S.h = hiker();
  },
  frame(S, t, dt) {
    const a = walkTo(S.h, S.s0 + 33, S.s0 + 37, 0, t, 0, 6);
    M.animateCharacter(S.h, dt, true, 0.6);
    const u = ease(t / 6);
    const c = along(S.s0 + 10 + u * 8, 5 - u * 2);
    const target = along(S.s0 + 70, 0);
    look(V(c.x, a.y + 12 - u * 3.5, c.z), V(target.x, target.y + 3 - u * 1.5, target.z));
    atmo({ hour: 8.15, overcast: 0.05, vis: 260, fog: 0.04, precip: 0, wind: { x: 4, z: 2 }, cloudSea: 1, fogNear: 60, fogFar: 520, desat: -0.12 }, dt, S.h.position,
      { breath: breathOf(S.h, 0.8), footstep: footOf(S.h, true) });
  },
};

// 2. 雾中石海：玛尼堆，冷灰，缓慢推进
SHOTS.fog = {
  dur: 3.4,
  setup(S) {
    S.s0 = wpS('qiaomai') + 10;
    const a = along(S.s0, 0);
    load(a.x, a.z);
    S.cairn = CAIRNS.find((c) => c.path === 'main' && c.s > S.s0 + 6);
  },
  frame(S, t, dt) {
    const c = S.cairn;
    const u = t / 6;
    const p = along(c.s - 9 + u * 3, -1.5);
    look(V(p.x, p.y + 2.2 - u * 0.4, p.z), V(c.x, ground(c.x, c.z) + 1.0, c.z));
    atmo({ hour: 15.2, overcast: 0.95, vis: 26, fog: 1, precip: 0.08, wind: { x: 3, z: 1 }, desat: 0.55, vignette: 0.4, cold: 0.4 }, dt, V(p.x, p.y, p.z));
  },
};

// 4. 塘口村：凌晨，"烤肠：无 本店不卖"
SHOTS.village = {
  dur: 2.4,
  setup(S) {
    S.p = waypointPos('tangkou');
    load(S.p.x, S.p.z);
  },
  frame(S, t, dt) {
    const p = S.p;
    const sg = offAt(p, 4.5, -6);
    const u = ease(t / 5);
    const c = offAt(p, 1.4 + u * 0.3, -10.3 + u * 0.9);
    look(V(c.x, ground(c.x, c.z) + 1.8, c.z), V(sg.x, ground(sg.x, sg.z) + 1.6, sg.z));
    atmo({ hour: 7.45, overcast: 0.1, vis: 160, fog: 0.08, precip: 0.05, wind: { x: 1, z: 1 } }, dt, V(c.x, 0, c.z));
  },
};

// 5. 阵风：刃脊上被风推出半步，然后压低重心
SHOTS.gust = {
  dur: 4,
  hit: 1.1,
  setup(S) {
    S.s0 = wpS('feiji') + 12;
    const a = along(S.s0, 0);
    load(a.x, a.z);
    S.h = hiker();
  },
  frame(S, t, dt) {
    const hit = SHOTS.gust.hit;
    const g = smooth((t - hit) / 0.3) * (1 - smooth((t - hit - 0.7) / 0.7));
    const walking = t < hit + 0.1;
    const a = along(S.s0 + Math.min(t, hit) * 0.9, 0.15 + smooth((t - hit) / 0.35) * 1.0);
    S.h.position.set(a.x, a.y, a.z);
    S.h.rotation.y = a.yaw + g * 0.6;
    const crouch = t > hit + 0.45;
    M.animateCharacter(S.h, dt, walking, 0.6, crouch ? 'crouch' : 'stand');
    S.h.rotation.z = -g * 0.4;
    const c = along(S.s0 + 6.0, -1.4);
    look(V(c.x, a.y + 2.3, c.z), V(a.x, a.y + 1.0, a.z));
    shake(0.3 + g * 2.4, t);
    atmo({ hour: 13.5, overcast: 0.35, vis: 170, fog: 0.12, precip: 0, wind: { x: 19, z: -6 }, spindrift: true, cold: 0.2 }, dt, S.h.position,
      { breath: breathOf(S.h, 1, 0.6), footstep: footOf(S.h, walking) });
  },
};

// 6. 暴风雪：白茫茫，路标消失
SHOTS.blizzard = {
  dur: 4,
  setup(S) {
    S.s0 = wpS('shuiwozi') + 40;
    const a = along(S.s0, 0);
    load(a.x, a.z);
    S.h = hiker();
  },
  frame(S, t, dt) {
    const a = walkTo(S.h, S.s0, S.s0 + 2.8, 0.4, t, 0, 5);
    M.animateCharacter(S.h, dt, true, 0.45);
    S.h.rotation.z = -0.08;
    const u = t / 5;
    const c = along(S.s0 - 3.2 - u * 0.8, -1.0);
    look(V(c.x, a.y + 2.0, c.z), V(a.x, a.y + 1.2, a.z));
    shake(0.35, t);
    atmo({ hour: 15.6, overcast: 1, vis: 15, fog: 0.95, precip: 1, blizzard: true, wind: { x: -20, z: 10 }, spindrift: true, cold: 0.5 }, dt, S.h.position,
      { breath: breathOf(S.h, 1, 0.6), lamp: lampOf(S.h), footstep: footOf(S.h, true) });
  },
};

// 6b. 血迹：发现 → 靠近 → 查看自己与匿名行程的死因；无尸体或魂魄回放。
// Capture with ?shot=bloodtrail. Main edit can use these local-time beats without changing other shots.
SHOTS.bloodtrail = {
  dur: 7,
  inspect: 3.35,
  anonymous: 5.05,
  danmaku: 4.25,
  async setup(S) {
    const { makeBloodstain, placeBloodstain, disposeBloodstain } = await import('../src/world/bloodstain.js');
    S.s0 = wpS('qiaomai') + 24;
    S.spot = along(S.s0 + 3.7, 0.65);
    S.otherSpot = along(S.s0 + 5.1, -0.55);
    load(S.spot.x, S.spot.z);
    S.h = hiker();
    S.blood = makeBloodstain({ own: true, seed: 'promo-previous-run' });
    S.otherBlood = makeBloodstain({ own: false, seed: 'promo-anonymous-run' });
    placeBloodstain(S.blood, S.spot, ground);
    placeBloodstain(S.otherBlood, S.otherSpot, ground);
    world.scene.add(S.blood, S.otherBlood);
    window.addEventListener('pagehide', () => {
      disposeBloodstain(S.blood);
      disposeBloodstain(S.otherBlood);
    }, { once: true });
    S.ui = document.getElementById('bloodtrail-ui');
    S.ui.hidden = false;
    S.uiParts = Object.fromEntries(['discovery', 'prompt', 'prompt-fill', 'record', 'record-title', 'record-cause', 'record-detail', 'danmaku', 'subtitle'].map((id) => [id, document.getElementById(`blood-${id}`)]));
  },
  frame(S, t, dt) {
    const shot = SHOTS.bloodtrail;
    const approach = smooth((t - 0.55) / 2.15);
    const crouch = smooth((t - 2.75) / 0.4);
    const other = smooth((t - shot.anonymous + 0.15) / 0.5);
    const a = along(S.s0 + approach * 2.15, 0.1 + approach * 0.15);
    const target = V(S.spot.x, S.spot.y + 0.06, S.spot.z).lerp(V(S.otherSpot.x, S.otherSpot.y + 0.06, S.otherSpot.z), other);
    S.h.position.set(a.x, a.y, a.z);
    S.h.rotation.y = a.yaw + other * 0.15;
    const walking = t > 0.55 && t < 2.7;
    M.animateCharacter(S.h, dt, walking, 0.5, crouch > 0.5 ? 'crouch' : 'stand');
    S.h.userData.head.rotation.x = 0.16 + crouch * 0.28;
    const push = ease((t - 0.25) / 3.1);
    const c = along(S.s0 - 3.7 + push * 3.65, -2.45 + push * 0.6);
    look(V(c.x, Math.max(c.y, a.y) + 2.7 - push * 0.7, c.z), V(lerp(a.x, target.x, 0.68 + push * 0.23), lerp(a.y + 0.95, target.y, push * 0.9), lerp(a.z, target.z, 0.68 + push * 0.23)));
    atmo({ hour: 16.3, overcast: 0.9, vis: 42, fog: 0.7, precip: 0.06, wind: { x: 3, z: 1 }, desat: 0.22, vignette: 0.3, cold: 0.32 }, dt, S.h.position,
      { breath: breathOf(S.h, 1, 0.45), footstep: footOf(S.h, walking) });

    // All overlay timing uses t, including the danmaku: __warm / __seek remain deterministic.
    const ui = S.uiParts;
    const fade = (start, end, inTime = 0.18, outTime = 0.18) => smooth((t - start) / inTime) * (1 - smooth((t - end) / outTime));
    ui.discovery.style.opacity = fade(0.45, 2.2);
    ui.prompt.style.opacity = fade(2.25, shot.inspect - 0.16);
    ui.prompt.style.transform = `translate(-50%,${(1 - ease((t - 2.25) / 0.18)) * 8}px)`;
    ui['prompt-fill'].style.transform = `scaleX(${clamp((t - 2.8) / (shot.inspect - 2.8))})`;
    ui.record.style.opacity = fade(shot.inspect, shot.dur - 0.18);
    ui.record.style.transform = `translate(-50%,${(1 - ease((t - shot.inspect) / 0.22)) * 14}px)`;
    const anonymous = t >= shot.anonymous;
    ui['record-title'].textContent = anonymous ? '匿名行程记录' : '你上一次行程的血迹';
    ui['record-cause'].textContent = anonymous ? '死因 · 滑坠' : '死因 · 失温';
    ui['record-detail'].textContent = anonymous ? '刃脊 · 阵风中继续行走' : '体温 32.8℃ · 湿衣 · 夜间停步';
    ui.record.dataset.record = anonymous ? 'anonymous' : 'own';
    const commentT = clamp((t - shot.danmaku) / (shot.dur - shot.danmaku));
    ui.danmaku.style.opacity = t >= shot.danmaku && t < shot.dur ? 1 : 0;
    ui.danmaku.style.transform = `translateX(${lerp(innerWidth + 16, -ui.danmaku.offsetWidth - 16, commentT)}px)`;
    ui.subtitle.style.opacity = P.get('narrated') === '1' ? 0 : fade(0.55, shot.dur - 0.18);
    ui.subtitle.style.transform = 'translateX(-50%)';
    S.ui.dataset.phase = t < 2.25 ? 'discover' : t < shot.inspect ? 'approach' : anonymous ? 'anonymous' : 'own';
  },
};

// 7. 幻觉：雾夜里亮起一个烤肠摊，摊主在招手；然后熄灭
function glowSprite(color = '255,190,110', size = 7) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const x = cv.getContext('2d'); const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, `rgba(${color},0.85)`); g.addColorStop(0.35, `rgba(${color},0.32)`); g.addColorStop(1, `rgba(${color},0)`);
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true }));
  sp.scale.set(size, size, 1);
  return sp;
}
SHOTS.stall = {
  dur: 7,
  off: 5.2,                   // local time the stall blinks out
  setup(S) {
    S.s0 = wpS('shuiwozi') - 30;
    const a = along(S.s0, 0);
    load(a.x, a.z);
    S.h = hiker();
    S.spot = along(S.s0 + 11, 0.8);
    world.showHallucination(S.spot.x, S.spot.z, true);
    world.hallu.rotation.y = along(S.s0).yaw + Math.PI;
    S.vendor = M.makeCharacter({ jacket: 0xf2efe6, pants: 0x3a3a3a, hat: 0xffffff, pack: 0xf2efe6 });
    S.vendor.userData.pack.visible = false;
    S.vendor.position.set(0, 0, -0.95);
    world.hallu.add(S.vendor);
    S.halo = glowSprite(); S.halo.position.set(0, 1.6, 0.3); world.hallu.add(S.halo);
    const glow = world.hallu.children[1]; glow.distance = 16; glow.position.z = 1.2;
  },
  frame(S, t, dt) {
    const a = along(S.s0 + Math.min(t, 3) * 0.3, -0.4);
    S.h.position.set(a.x, a.y, a.z);
    S.h.rotation.y = Math.atan2(S.spot.x - a.x, S.spot.z - a.z);
    M.animateCharacter(S.h, dt, t < 3, 0.35, 'stand');
    M.animateCharacter(S.vendor, dt, false, 0, 'stand');
    S.vendor.userData.armR.rotation.x = -2.6;
    S.vendor.userData.armR.rotation.z = 0.35 + Math.sin(t * 7) * 0.35;      // 来一根？
    const off = SHOTS.stall.off;
    const on = t < off - 0.3 || (t < off && Math.sin(t * 70) > 0);
    world.hallu.visible = on;
    world.hallu.children[1].intensity = 12 + Math.sin(t * 13) * 1.2;
    S.halo.material.opacity = 0.75 + Math.sin(t * 5) * 0.1;
    const u = ease(t / 7);
    const c = along(S.s0 - 5.0 + u * 2.0, -1.9 + u * 0.3);
    look(V(c.x, a.y + 2.5 - u * 0.3, c.z), V(S.spot.x, a.y + 1.2, S.spot.z));
    atmo({ hour: 22.5, overcast: 0.7, vis: 30, fog: 0.75, precip: 0.25, wind: { x: 2, z: 1 }, cold: 0.45, desat: 0.15, vignette: 0.5 }, dt, S.h.position,
      { breath: breathOf(S.h, 1, 0.5), lamp: lampOf(S.h, false), footstep: footOf(S.h, t < 3) });
  },
};

// —— 景区门口的烤肠摊 ——
function makeSausage() {
  const g = new THREE.Group();
  const m = (c) => new THREE.MeshLambertMaterial({ color: c });
  const box = (w, h, d, c, rx = 0, x = 0) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m(c)); b.rotation.x = rx; b.position.x = x; g.add(b); return b; };
  box(1.2, 0.15, 0.15, 0x8a3a20);
  box(1.2, 0.15, 0.15, 0x9e4426, Math.PI / 4);
  box(1.12, 0.03, 0.06, 0xd98a5e).position.y = 0.075;
  box(1.3, 0.1, 0.1, 0x7d3019);
  for (let i = 0; i < 6; i++) box(0.025, 0.158, 0.158, 0x5a2410, (i % 2) * Math.PI / 4, -0.45 + i * 0.18);
  return g;
}
function makeSausageStall() {
  const g = new THREE.Group();
  const vb = new M.VoxBuilder();
  vb.box(-1.3, 0, -0.55, 2.6, 1.0, 1.1, 0xd8c8a8);              // counter
  vb.box(-1.35, 0.98, -0.6, 2.7, 0.08, 1.2, 0xb8a88a);
  vb.box(-1.25, 0, -0.95, 0.12, 2.3, 0.12, 0x777777);
  vb.box(1.13, 0, -0.95, 0.12, 2.3, 0.12, 0x777777);
  for (let i = 0; i < 7; i++) vb.box(-1.5 + i * 0.43, 2.3, -1.0, 0.43, 0.16, 1.75, i % 2 ? 0xf2efe6 : 0xd03a2a); // striped canopy
  vb.box(-0.75, 1.06, -0.4, 1.5, 0.12, 0.8, 0x9ea4a8);           // grill tray
  vb.box(-0.8, 1.06, -0.45, 0.06, 0.32, 0.9, 0xc4c9cd);
  vb.box(0.74, 1.06, -0.45, 0.06, 0.32, 0.9, 0xc4c9cd);
  g.add(new THREE.Mesh(vb.build(), M.voxMaterial));
  const rollers = new THREE.MeshLambertMaterial({ color: 0xe6e8ea });
  const sausages = [];
  for (let i = 0; i < 4; i++) {
    const z = -0.3 + i * 0.2;
    const r = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.04, 0.04), rollers);
    r.position.set(0, 1.2, z);
    g.add(r);
    const s = makeSausage();
    s.scale.setScalar(0.86);
    s.position.set(0, 1.29, z);
    g.add(s);
    sausages.push(s);
  }
  // banner
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
  const x = cv.getContext('2d');
  x.fillStyle = '#d03a2a'; x.fillRect(0, 0, 512, 128);
  x.fillStyle = '#fff3d6'; x.font = '76px "ZCOOL QingKe HuangYou"'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('现烤烤肠 · 5元', 256, 68);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.65), new THREE.MeshLambertMaterial({ map: tex }));
  banner.position.set(0, 2.78, 0.62);
  g.add(banner);
  const glow = new THREE.PointLight(0xffaa55, 3, 6, 1.5);
  glow.position.set(0, 1.9, 0.5);
  g.add(glow);
  g.userData.sausages = sausages;
  return g;
}


// —— 自建布景：在东塬前的平坦高山塬上搭"管护站"和"景区门口" ——
// The real gate sits in dense forest (trees block every angle), so the promo builds clean sets on a flat plateau.
// Sets live in a local frame: +z is "forward" (the way the camera looks), +x to the left, y = 0 on the platform.
function sunYaw(hour, turn = 0) {
  const phi = Math.PI * clamp((hour - 7.8) / 10, -0.15, 1.15);
  return Math.atan2(-Math.sin(phi), -Math.cos(phi)) + turn;   // local +z points away from the sun (+turn)
}
function makeSet(al, side, yaw, W, D, paint) {
  const p = waypointPos('dongyuan');
  const c = offAt(p, side, al);
  load(c.x, c.z);
  const g = new THREE.Group();
  g.rotation.y = yaw;
  const fx = Math.sin(yaw), fz = Math.cos(yaw), lx = Math.cos(yaw), lz = -Math.sin(yaw);
  const toWorld = (x, z) => ({ x: c.x + lx * x + fx * z, z: c.z + lz * x + fz * z });
  const hs = [];
  for (let x = -W / 2; x <= W / 2; x++) for (let z = -D / 2; z <= D / 2; z++) { const q = toWorld(x, z); hs.push(ground(q.x, q.z)); }
  hs.sort((a, b) => a - b);
  const top = hs[Math.floor(hs.length * 0.97)] + 0.04, bottom = hs[0] - 3;
  const vb = new M.VoxBuilder();
  for (let x = -W / 2; x < W / 2; x++) for (let z = -D / 2; z < D / 2; z++) {
    const h = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; const r = h - Math.floor(h);
    vb.top(x, z, x + 1, z + 1, 0, paint(x + 0.5, z + 0.5, r), 0.95 + r * 0.05);
  }
  vb.box(-W / 2, bottom - top, -D / 2, W, top - bottom - 0.001, D, 0x9097a0);
  const plat = new THREE.Mesh(vb.build(), M.voxMaterial);
  g.add(plat);
  g.position.set(c.x, top, c.z);
  world.scene.add(g);
  g.updateMatrixWorld(true);
  const set = { g, top, toWorld, yaw, add(o, x, y, z, ry = 0) { o.position.set(x, y, z); o.rotation.y = ry; g.add(o); world.shadowify(o); return o; } };
  // world position of a local point
  set.w = (x, y, z) => { const q = toWorld(x, z); return V(q.x, top + y, q.z); };
  return set;
}
function pine(s = 1) {
  const vb = new M.VoxBuilder();
  vb.box(-0.2, 0, -0.2, 0.4, 1.0, 0.4, 0x4a3424);
  let y = 0.8;
  for (const [w, h] of [[2.6, 1.0], [2.0, 0.95], [1.4, 0.85], [0.8, 0.7]]) { vb.box(-w / 2, y, -w / 2, w, h, w, 0x23452f, false, 0xe8eef2); y += h * 0.82; }
  const m = new THREE.Mesh(vb.build(), M.voxMaterial);
  m.scale.setScalar(s);
  return m;
}
function canvasPlane(w, h, draw, cw = 1024) {
  const ch = Math.round(cw * h / w);
  const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
  draw(cv.getContext('2d'), cw, ch);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ map: tex }));
}
const FONT_CN = '"ZCOOL QingKe HuangYou"';

// 管护站布景
function gateSet(hour) {
  const S = makeSet(-68, 0, sunYaw(hour, 1.0), 30, 30, (x, z, r) => (Math.abs(x) < 0.9 + r * 0.3 && z < 14 ? 0xc9ced2 : 0xeef3f7));
  S.add(M.makeFence(14), 7, 0, 0, Math.PI);             // fence across the trail, the cut gap sits on the trail
  S.add(M.makeSign('禁止穿越', '鳌太线 违者依法处罚', { bg: '#b3261e' }), -2.4, 0, -1.4);
  const house = S.add(M.makeHouse(4.2, 3.6, 2.5, 0xd8d0c0, 0x2e5e3e, { snowRoof: true, lit: true }), 6.2, 0, -3.5, -Math.PI / 2);
  const lamp = new THREE.PointLight(0xffb866, 7, 14, 1.6); lamp.position.set(4.6, 1.6, -3.5); S.g.add(lamp);
  S.add(M.makeSign('管护站', '太白山国家级自然保护区', { bg: '#2e5e3e' }), 3.6, 0, -6.2);
  // fresh footprints through the gap
  const fp = new THREE.MeshLambertMaterial({ color: 0xa9b4bd });
  for (let i = 0; i < 18; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.03, 0.34), fp); m.position.set((i % 2 ? 0.22 : -0.22) + Math.sin(i * 0.7) * 0.3, 0.02, 0.6 + i * 0.62); S.g.add(m); }
  for (const [x, z, s] of [[-9, 3, 1.2], [-11.5, -2, 1.0], [-8.5, 9, 1.4], [10.5, 6, 1.3], [12, -1, 1.1], [9.5, 12, 1.5], [-12, 12, 1.2], [13, -8, 1.0]]) S.add(pine(s), x, 0, z, x * 0.3);
  S.house = house; S.lamp = lamp;
  return S;
}

// 景区门口布景：牌坊、烤肠摊、索道
function scenicSet(hour) {
  const S = makeSet(-16, 2, sunYaw(hour, 0.5), 30, 34, (x, z, r) => (Math.abs(x) < 8 && z > -9 && z < 8 ? ((Math.floor(x) + Math.floor(z)) % 2 ? 0xbab4a8 : 0xa9a397) : 0xeef3f7));
  // 牌坊
  const vb = new M.VoxBuilder();
  for (const x of [-3.6, 3.0]) { vb.box(x, 0, -0.3, 0.6, 3.8, 0.6, 0x9e2b25); vb.box(x - 0.15, 0, -0.45, 0.9, 0.5, 0.9, 0x8c8577); }
  vb.box(-4.2, 3.5, -0.4, 8.4, 0.5, 0.8, 0x9e2b25);
  vb.box(-4.8, 4.0, -0.8, 9.6, 0.35, 1.6, 0x2f4a45, false, 0xe8eef2);
  vb.box(-4.0, 4.35, -0.55, 8.0, 0.35, 1.1, 0x2f4a45, false, 0xe8eef2);
  S.add(new THREE.Mesh(vb.build(), M.voxMaterial), 0, 0, 5);
  const plaque = canvasPlane(5.6, 0.95, (x, w, h) => {
    x.fillStyle = '#1d3557'; x.fillRect(0, 0, w, h); x.strokeStyle = '#d9a441'; x.lineWidth = 10; x.strokeRect(8, 8, w - 16, h - 16);
    x.fillStyle = '#f2c14e'; x.font = `${h * 0.66}px ${FONT_CN}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('太白山国家森林公园', w / 2, h * 0.54);
  });
  plaque.rotation.y = Math.PI; S.g.add(plaque); plaque.position.set(0, 3.0, 4.66);
  // stall, sign, tourists
  S.stall = S.add(makeSausageStall(), -4.6, 0, 1.0, Math.PI + 0.25);
  S.add(M.makeSign('景区入口', '有索道 有烤肠', { bg: '#2e5e3e' }), 5.2, 0, -1.5, Math.PI + 0.2);
  const tA = hiker({ jacket: 0x3b6fd1, pants: 0x2b3a55, hat: 0xd8d8d8, pack: 0x333333 });
  const tB = hiker({ jacket: 0xf4b400, pants: 0x1f1f1f, hat: 0xff6f91, pack: 0x444444 });
  const tC = hiker({ jacket: 0x00a6a6, pants: 0x111111, hat: 0xffffff, pack: 0x333333 });
  world.scene.remove(tA, tB, tC);
  S.add(tA, 1.6, 0, 7.5, Math.PI); S.add(tB, 2.4, 0, 7.8, Math.PI + 0.3); S.add(tC, -6.6, 0, -1.6, 0.9);
  S.tourists = [tA, tB, tC];
  // 索道
  const a = V(-10, 6, 17), b = V(-34, 46, 112);
  const cable = (off) => { const A = a.clone().add(off), B = b.clone().add(off); const len = A.distanceTo(B); const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, len), new THREE.MeshLambertMaterial({ color: 0x3a3f44 })); m.position.copy(A).lerp(B, 0.5); m.lookAt(S.g.localToWorld(B.clone())); S.g.add(m); return [A, B]; };
  S.lines = [cable(V(0, 0, 0)), cable(V(1.6, 0, 0))];
  const pv = new M.VoxBuilder(); pv.box(-0.3, 0, -0.3, 0.6, 6.4, 0.6, 0x6b7177); pv.box(-1.2, 6.0, -0.2, 3.2, 0.3, 0.4, 0x6b7177);
  S.add(new THREE.Mesh(pv.build(), M.voxMaterial), -10, 0, 17);
  S.gondolas = [];
  for (let k = 0; k < 10; k++) {
    const gv = new M.VoxBuilder(); gv.box(-0.05, 0, -0.05, 0.1, 0.7, 0.1, 0x3a3f44); gv.box(-0.5, -0.9, -0.45, 1.0, 0.9, 0.9, k % 2 ? 0xd03a2a : 0xf2efe6); gv.box(-0.52, -0.55, -0.3, 1.04, 0.3, 0.6, 0x9fc7e0);
    const m = new THREE.Mesh(gv.build(), M.voxMaterial); S.g.add(m); S.gondolas.push(m);
  }
  for (const [x, z, s] of [[-11, 2, 1.3], [-12, 9, 1.5], [11, 3, 1.2], [12.5, 10, 1.6], [-13, -6, 1.1], [13, -5, 1.2], [9, 15, 1.4], [-6, 16, 1.3]]) S.add(pine(s), x, 0, z, x * 0.2);
  return S;
}
function animScenic(S, t, dt) {
  for (const [i, s] of S.stall.userData.sausages.entries()) s.rotation.x = t * (1.6 + (i % 2) * 0.3) + i;
  S.gondolas.forEach((m, k) => {
    const dir = k % 2 ? -1 : 1, line = S.lines[k % 2];
    let u = ((k >> 1) / 5 + dir * t * 0.012) % 1; if (u < 0) u += 1;
    m.position.copy(line[0]).lerp(line[1], u);
  });
  const [tA, tB, tC] = S.tourists;
  M.animateCharacter(tA, dt, false, 0); tA.userData.armL.rotation.x = -1.4; tA.userData.armR.rotation.x = -1.4; // taking a photo
  M.animateCharacter(tB, dt, false, 0); tB.userData.armR.rotation.x = -0.4 - Math.max(0, Math.sin(t * 2)) * 0.6;
  M.animateCharacter(tC, dt, false, 0); tC.userData.armR.rotation.x = -1.3 - Math.max(0, Math.sin(t * 2.6 + 1)) * 0.4;
}

// 3. 管护站：天将亮未亮，"禁止穿越"
SHOTS.gate = {
  dur: 3.4,
  setup(S) { S.set = gateSet(7.62); },
  frame(S, t, dt) {
    const u = ease(t / 5);
    const cp = S.set.w(-1.5 + u * 0.3, 1.75, -8.6 + u * 2.2);
    look(cp, S.set.w(-2.3, 1.55, -1.2));
    atmo({ hour: 7.62, overcast: 0.25, vis: 160, fog: 0.12, precip: 0.12, wind: { x: 2, z: 1 } }, dt, cp);
  },
};

// 8. 转身：管护站铁丝网前，人转身往回走
SHOTS.turn = {
  dur: 2.8,
  setup(S) {
    S.set = gateSet(8.3);
    S.h = hiker(); world.scene.remove(S.h); S.set.g.add(S.h);
  },
  frame(S, t, dt) {
    const turnT = 0.9;
    const k = smooth((t - turnT) / 0.6);
    const walk = Math.max(0, t - turnT - 0.35) * 1.25;
    S.h.position.set(0.1, 0, -1.6 - walk);
    S.h.rotation.y = Math.PI * k;
    M.animateCharacter(S.h, dt, t > turnT + 0.35, 0.85);
    const cp = S.set.w(0.1, 1.9, -8.8 - walk * 0.55);
    look(cp, S.set.w(-0.9, 1.4, -0.5 - walk * 0.6));
    const hp = S.h.getWorldPosition(V(0, 0, 0)), ry = S.h.rotation.y + S.set.yaw;
    atmo({ hour: 8.3, overcast: 0.1, vis: 200, fog: 0.06, precip: 0.04, wind: { x: 2, z: 1 }, desat: -0.1 }, dt, hp,
      { breath: { active: true, pos: V(hp.x + Math.sin(ry) * 0.3, hp.y + 1.62, hp.z + Math.cos(ry) * 0.3), dir: { x: Math.sin(ry), z: Math.cos(ry) }, cold: 0.8, rate: 0.4 } });
  },
};

// 9. 景区门口：晴天，人在烤肠摊前吃烤肠，背后是索道
SHOTS.sausage = {
  dur: 2.8,
  setup(S) {
    S.set = scenicSet(11.5);
    S.h = hiker(); world.scene.remove(S.h); S.set.g.add(S.h);
    S.stick = makeSausage(); S.stick.scale.setScalar(0.3); S.stick.rotation.y = Math.PI / 2;
    S.h.userData.armR.add(S.stick); S.stick.position.set(0, -0.66, 0.18);
  },
  frame(S, t, dt) {
    animScenic(S.set, t, dt);
    S.h.position.set(-2.4, 0, 0.2);
    S.h.rotation.y = Math.PI + 0.5;
    M.animateCharacter(S.h, dt, false, 0, 'stand');
    const up = smooth((t - 0.6) / 0.5);
    S.h.userData.armR.rotation.x = -0.3 - up * 2.5 + Math.sin(t * 9) * 0.08 * up;
    S.h.userData.armR.rotation.z = up * 0.25;
    S.h.userData.head.rotation.x = -up * 0.2;
    const u = ease(t / 5);
    const cp = S.set.w(-1.6 + u * 0.4, 3.3 - u * 0.5, -15.5 + u * 3.0);
    look(cp, S.set.w(-2.0, 2.3, 2.5));
    atmo({ hour: 11.5, overcast: 0.05, vis: 260, fog: 0.02, precip: 0, wind: { x: 1, z: 1 }, desat: -0.15, fogNear: 50, fogFar: 380 }, dt, cp,
      { breath: { active: true, pos: S.set.w(-4.6, 1.45, 1.0), dir: { x: 0, z: 0 }, cold: 0.8, rate: 0.5 } });
  },
};

// 10. 烤肠特写：滚动的烤肠
SHOTS.grill = {
  dur: 4,
  setup(S) { S.set = scenicSet(11.5); },
  frame(S, t, dt) {
    animScenic(S.set, t, dt);
    const sp = S.set.stall.position, ry = S.set.stall.rotation.y;
    const u = ease(t / 4);
    const ang = ry - 0.45 + u * 0.6, R = 2.0 - u * 0.35;
    const cl = V(sp.x + Math.sin(ang) * R, 2.1 - u * 0.12, sp.z + Math.cos(ang) * R);
    look(S.set.g.localToWorld(cl), S.set.g.localToWorld(V(sp.x, 1.22, sp.z)));
    atmo({ hour: 11.5, overcast: 0.05, vis: 260, fog: 0.02, precip: 0, wind: { x: 0.5, z: 0.3 }, desat: 0.05, fogNear: 50, fogFar: 380 }, dt, S.set.w(sp.x, 0, sp.z),
      { breath: { active: true, pos: S.set.g.localToWorld(V(sp.x, 1.42, sp.z)), dir: { x: 0, z: 0 }, cold: 0.9, rate: 0.6 } });
  },
};

// 11. 结尾：日落，导航架，云海
SHOTS.outro = {
  dur: 10.5,
  setup(S) {
    S.p = waypointPos('daohang');
    load(S.p.x, S.p.z);
    S.h = hiker();
  },
  frame(S, t, dt) {
    const a = along(S.p.s - 7, 0.3);
    S.h.position.set(a.x, a.y, a.z);
    S.h.rotation.y = -Math.PI / 2;
    M.animateCharacter(S.h, dt, false, 0, 'stand');
    const u = t / 9;
    const ang = 1.25 + u * 0.4;
    const R = 32 - u * 5;
    const cx = S.p.x + Math.sin(ang) * R, cz = S.p.z + Math.cos(ang) * R;
    look(V(cx, a.y + 11 - u * 2, cz), V(S.p.x - 10, a.y + 6, S.p.z));
    atmo({ hour: 17.6, overcast: 0.1, vis: 260, fog: 0.05, precip: 0, wind: { x: 3, z: 2 }, cloudSea: 1, fogNear: 60, fogFar: 520, desat: -0.12 }, dt, S.h.position,
      { breath: breathOf(S.h, 0.8) });
  },
};

// 侦察：用 URL 参数摆机位（只用于挑景）
SHOTS.scout = {
  dur: 1,
  setup(S) { S.p = waypointPos(P.get('wp') || 'tangkou'); load(S.p.x, S.p.z); },
  frame(S, t, dt) {
    const n = (k, d) => +(P.get(k) ?? d);
    const c = offAt(S.p, n('side', 0), n('al', -10)), tg = offAt(S.p, n('tside', 0), n('tal', 0));
    look(V(c.x, ground(c.x, c.z) + n('h', 2), c.z), V(tg.x, ground(tg.x, tg.z) + n('th', 1), tg.z));
    atmo({ hour: n('hour', 11.5), overcast: 0.05, vis: 260, fog: 0.02, fogNear: 80, fogFar: 600 }, dt, V(c.x, 0, c.z));
  },
};

// —— 驱动 ——
const name = P.get('shot') || 'ridge';
const shot = SHOTS[name];
const S = {};
let t = 0;
if (shot) {
  await shot.setup(S);
  if (S.h) S.h.position.set(0, -100, 0);
}
function stepTo(dt) {
  window.__vclock(dt);
  shot.frame(S, t, dt);
  world.render();
  t += dt;
}
window.SHOTS = Object.fromEntries(Object.entries(SHOTS).map(([k, v]) => [k, v.dur]));
window.DURATION = shot ? shot.dur : 0;
/** warm the particles before t = 0, then each call renders the next frame */
window.__warm = (n, dt = 1 / 30) => { const t0 = t; for (let i = 0; i < n; i++) { t = t0 - (n - i) * dt; stepTo(dt); } t = t0; return true; };
window.__step = (dt = 1 / 30) => { stepTo(dt); return t; };
window.__seek = (time, dt = 1 / 30) => { while (t < time - 1e-6) stepTo(dt); return t; };
window.READY = true;
