// 体素模型构建：把一堆方块合并成单个 BufferGeometry（顶点色）。
import * as THREE from 'three';

const _c = new THREE.Color();
const FACE_SHADE = { top: 1.0, bottom: 0.55, px: 0.86, nx: 0.86, pz: 0.76, nz: 0.76 };

export class VoxBuilder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.col = [];
    this.idx = [];
    this.vc = 0;
  }

  _quad(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, nx, ny, nz, r, g, b, r2 = r, g2 = g, b2 = b) {
    // a,b 顶部(或第一条边) c,d 底部，颜色可做上下渐变
    const v = this.vc;
    this.pos.push(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz);
    for (let i = 0; i < 4; i++) this.nor.push(nx, ny, nz);
    this.col.push(r, g, b, r, g, b, r2, g2, b2, r2, g2, b2);
    this.idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
    this.vc += 4;
  }

  // 顶面
  top(x0, z0, x1, z1, y, color, shade = 1) {
    _c.set(color);
    const r = _c.r * shade, g = _c.g * shade, b = _c.b * shade;
    this._quad(x0, y, z0, x0, y, z1, x1, y, z1, x1, y, z0, 0, 1, 0, r, g, b);
  }

  // 带体素环境光遮蔽的顶面：ao 为 4 个角的亮度（顺序 x0z0, x0z1, x1z1, x1z0）
  topAO(x0, z0, x1, z1, y, color, ao) {
    _c.set(color);
    const v = this.vc;
    this.pos.push(x0, y, z0, x0, y, z1, x1, y, z1, x1, y, z0);
    for (let i = 0; i < 4; i++) {
      this.nor.push(0, 1, 0);
      this.col.push(_c.r * ao[i], _c.g * ao[i], _c.b * ao[i]);
    }
    // 根据 AO 选择对角线，避免各向异性的明暗条纹
    if (ao[0] + ao[2] > ao[1] + ao[3]) this.idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
    else this.idx.push(v + 1, v + 2, v + 3, v + 1, v + 3, v);
    this.vc += 4;
  }

  // 侧面：从 y0 到 y1，dir: px nx pz nz
  side(x, z, dir, y0, y1, color, shadeTop = 1, shadeBottom = 0.6) {
    _c.set(color);
    const s = FACE_SHADE[dir];
    const rt = _c.r * s * shadeTop, gt = _c.g * s * shadeTop, bt = _c.b * s * shadeTop;
    const rb = _c.r * s * shadeBottom, gb = _c.g * s * shadeBottom, bb = _c.b * s * shadeBottom;
    if (dir === 'px') this._quad(x + 1, y1, z, x + 1, y1, z + 1, x + 1, y0, z + 1, x + 1, y0, z, 1, 0, 0, rt, gt, bt, rb, gb, bb);
    else if (dir === 'nx') this._quad(x, y1, z + 1, x, y1, z, x, y0, z, x, y0, z + 1, -1, 0, 0, rt, gt, bt, rb, gb, bb);
    else if (dir === 'pz') this._quad(x + 1, y1, z + 1, x, y1, z + 1, x, y0, z + 1, x + 1, y0, z + 1, 0, 0, 1, rt, gt, bt, rb, gb, bb);
    else this._quad(x, y1, z, x + 1, y1, z, x + 1, y0, z, x, y0, z, 0, 0, -1, rt, gt, bt, rb, gb, bb);
  }

  // 任意尺寸方块（x0,y0,z0 为最小角）
  box(x0, y0, z0, sx, sy, sz, color, bottom = false, topColor = null) {
    const x1 = x0 + sx, y1 = y0 + sy, z1 = z0 + sz;
    _c.set(topColor ?? color);
    let r = _c.r, g = _c.g, b = _c.b;
    this._quad(x0, y1, z0, x0, y1, z1, x1, y1, z1, x1, y1, z0, 0, 1, 0, r, g, b);
    _c.set(color);
    r = _c.r; g = _c.g; b = _c.b;
    let s = FACE_SHADE.px;
    this._quad(x1, y1, z0, x1, y1, z1, x1, y0, z1, x1, y0, z0, 1, 0, 0, r * s, g * s, b * s, r * s * 0.8, g * s * 0.8, b * s * 0.8);
    this._quad(x0, y1, z1, x0, y1, z0, x0, y0, z0, x0, y0, z1, -1, 0, 0, r * s, g * s, b * s, r * s * 0.8, g * s * 0.8, b * s * 0.8);
    s = FACE_SHADE.pz;
    this._quad(x1, y1, z1, x0, y1, z1, x0, y0, z1, x1, y0, z1, 0, 0, 1, r * s, g * s, b * s, r * s * 0.8, g * s * 0.8, b * s * 0.8);
    this._quad(x0, y1, z0, x1, y1, z0, x1, y0, z0, x0, y0, z0, 0, 0, -1, r * s, g * s, b * s, r * s * 0.8, g * s * 0.8, b * s * 0.8);
    if (bottom) {
      s = FACE_SHADE.bottom;
      this._quad(x0, y0, z1, x0, y0, z0, x1, y0, z0, x1, y0, z1, 0, -1, 0, r * s, g * s, b * s);
    }
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.vc > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

export const voxMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });

const matCache = new Map();
function mat(color) {
  let m = matCache.get(color);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color });
    matCache.set(color, m);
  }
  return m;
}

function cube(w, h, d, color, ox = 0, oy = 0, oz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(ox, oy, oz);
  return new THREE.Mesh(g, mat(color));
}

// —— 人物 ——
export function makeCharacter(look = {}) {
  const L = { jacket: 0x3b6fd1, pants: 0x2b3a55, hat: 0xd8d8d8, pack: 0x333333, skin: 0xe8c39e, boots: 0x3a2a1e, ...look };
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const torso = cube(0.52, 0.66, 0.3, L.jacket, 0, 0, 0);
  torso.position.y = 1.15;
  body.add(torso);

  const head = new THREE.Group();
  head.position.y = 1.48;
  head.add(cube(0.4, 0.4, 0.4, L.skin, 0, 0.2, 0));
  head.add(cube(0.44, 0.16, 0.44, L.hat, 0, 0.36, 0));
  head.add(cube(0.08, 0.06, 0.02, 0x1a1a1a, -0.09, 0.22, 0.205));
  head.add(cube(0.08, 0.06, 0.02, 0x1a1a1a, 0.09, 0.22, 0.205));
  body.add(head);

  const pack = cube(0.46, 0.62, 0.26, L.pack, 0, 0, 0);
  pack.position.set(0, 1.18, -0.28);
  body.add(pack);
  const roll = cube(0.5, 0.16, 0.16, 0x7a8a99, 0, 0, 0);
  roll.position.set(0, 1.55, -0.28);
  body.add(roll);

  const limb = (w, h, d, color, x, y, foot) => {
    const g = new THREE.Group();
    g.position.set(x, y, 0);
    g.add(cube(w, h, d, color, 0, -h / 2, 0));
    if (foot) g.add(cube(w + 0.02, 0.12, d + 0.1, foot, 0, -h + 0.06, 0.04));
    return g;
  };
  const armL = limb(0.16, 0.6, 0.18, L.jacket, -0.34, 1.44);
  const armR = limb(0.16, 0.6, 0.18, L.jacket, 0.34, 1.44);
  armL.add(cube(0.17, 0.12, 0.19, 0x222222, 0, -0.62, 0));
  armR.add(cube(0.17, 0.12, 0.19, 0x222222, 0, -0.62, 0));
  const legL = limb(0.2, 0.82, 0.22, L.pants, -0.13, 0.82, L.boots);
  const legR = limb(0.2, 0.82, 0.22, L.pants, 0.13, 0.82, L.boots);
  body.add(armL, armR, legL, legR);

  root.userData = { body, head, armL, armR, legL, legR, pack, torso, phase: 0, pose: 'stand' };
  return root;
}

// 姿势与动画：walk 速度 0..1
export function animateCharacter(ch, dt, moving, speed = 1, pose = 'stand') {
  const u = ch.userData;
  if (pose !== u.pose) {
    u.pose = pose;
    u.body.rotation.set(0, 0, 0);
    u.body.position.set(0, 0, 0);
    u.legL.rotation.set(0, 0, 0);
    u.legR.rotation.set(0, 0, 0);
    u.armL.rotation.set(0, 0, 0);
    u.armR.rotation.set(0, 0, 0);
    u.head.rotation.set(0, 0, 0);
  }
  if (pose === 'crawl') {
    u.body.position.y = -0.5;
    u.body.rotation.x = 0.72;
    u.head.rotation.x = 0.2;
    u.phase += dt * 8 * Math.max(0.5, speed);
    const a = Math.sin(u.phase) * 0.24;
    u.armL.rotation.x = -0.95 + a;
    u.armR.rotation.x = -0.95 - a;
    u.legL.rotation.x = -1.25 - a;
    u.legR.rotation.x = -1.25 + a;
    return;
  }
  if (pose === 'sit') {
    u.body.position.y = -0.62;
    u.legL.rotation.x = -1.45;
    u.legR.rotation.x = -1.4;
    u.armL.rotation.x = -0.5;
    u.armR.rotation.x = -0.6;
    u.head.rotation.x = 0.35;
    return;
  }
  if (pose === 'lie') {
    u.body.rotation.x = -Math.PI / 2;
    u.body.position.y = 0.2;
    u.body.position.z = 0.9;
    return;
  }
  if (pose === 'crouch') {
    u.body.position.y = -0.35;
    u.legL.rotation.x = -0.8;
    u.legR.rotation.x = -0.8;
    u.body.rotation.x = 0.25;
    u.armL.rotation.x = -0.6;
    u.armR.rotation.x = -0.6;
    return;
  }
  if (moving) {
    u.phase += dt * 7 * speed;
    const a = Math.sin(u.phase) * 0.6 * Math.min(1, speed + 0.3);
    u.legL.rotation.x = a;
    u.legR.rotation.x = -a;
    u.armL.rotation.x = -a * 0.8;
    u.armR.rotation.x = a * 0.8;
    u.body.position.y = Math.abs(Math.cos(u.phase)) * 0.05;
    u.body.rotation.x = 0.08;
  } else {
    u.phase *= 0.9;
    u.legL.rotation.x *= 0.8;
    u.legR.rotation.x *= 0.8;
    u.armL.rotation.x *= 0.8;
    u.armR.rotation.x *= 0.8;
    u.body.position.y = 0;
    u.body.rotation.x *= 0.8;
    u.head.rotation.y = Math.sin(performance.now() * 0.0007) * 0.25;
  }
}

// —— 帐篷（阶梯状体素 A 字帐）——
export function makeTent(color = 0xff7a1a, opts = {}) {
  const vb = new VoxBuilder();
  const len = 2.2;
  const layers = [[1.9, 0.32], [1.45, 0.3], [1.0, 0.28], [0.5, 0.22]];
  let y = 0;
  const c = new THREE.Color(color);
  layers.forEach(([w, h], i) => {
    const shade = 1 - i * 0.04;
    vb.box(-w / 2, y, -len / 2, w, h, len, c.clone().multiplyScalar(shade).getHex());
    y += h;
  });
  // 门（+z 端）
  vb.box(-0.35, 0.02, len / 2, 0.7, 0.75, 0.04, 0x2a2a2a);
  // 尾部风绳
  vb.box(-0.03, 0, -len / 2 - 0.6, 0.06, 0.06, 0.6, 0xdddddd);
  const mesh = new THREE.Mesh(vb.build(), opts.ghost
    ? new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false })
    : voxMaterial);
  const g = new THREE.Group();
  g.add(mesh);
  g.userData.mesh = mesh;
  return g;
}

export function makeCollapsedTent(color = 0xff7a1a) {
  const vb = new VoxBuilder();
  vb.box(-1.0, 0, -1.2, 2.0, 0.22, 2.4, color);
  vb.box(-0.6, 0.22, -0.8, 1.1, 0.15, 1.3, new THREE.Color(color).multiplyScalar(0.8).getHex());
  return new THREE.Mesh(vb.build(), voxMaterial);
}

// —— 告示牌 ——
const fontStack = '"ZCOOL QingKe HuangYou", "PingFang SC", "Microsoft YaHei", sans-serif';
export function makeSign(text, sub = '', opts = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = opts.bg ?? '#6b4a2b';
  ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  for (let i = 0; i < 6; i++) ctx.fillRect(0, i * 22 + 8, 256, 2);
  ctx.strokeStyle = '#3b2716';
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, 248, 120);
  ctx.fillStyle = opts.fg ?? '#f3e7cf';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${text.length > 5 ? 38 : 48}px ${fontStack}`;
  ctx.fillText(text, 128, sub ? 50 : 64);
  if (sub) {
    ctx.font = `24px ${fontStack}`;
    ctx.fillText(sub, 128, 96);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  const g = new THREE.Group();
  const board = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.9, 0.08), [
    mat(0x4a3220), mat(0x4a3220), mat(0x4a3220), mat(0x4a3220),
    new THREE.MeshLambertMaterial({ map: tex }), new THREE.MeshLambertMaterial({ map: tex }),
  ]);
  board.position.y = 1.7;
  g.add(board);
  g.add(cube(0.12, 1.4, 0.12, 0x3b2716, 0, 0.7, 0));
  g.userData.redraw = () => { tex.needsUpdate = true; };
  return g;
}

// —— 地标模型 ——
export function makeNavTower() {
  const vb = new VoxBuilder();
  const H = 9;
  for (let i = 0; i < H; i++) {
    const w = 2.6 - i * 0.22;
    const col = i % 2 === 0 ? 0xc0392b : 0xeeeeee;
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      vb.box(sx * w / 2 - 0.1, i, sz * w / 2 - 0.1, 0.2, 1, 0.2, col);
    }
    if (i % 2 === 1) {
      vb.box(-w / 2, i + 0.45, -w / 2 - 0.05, w, 0.1, 0.1, 0x888888);
      vb.box(-w / 2, i + 0.45, w / 2 - 0.05, w, 0.1, 0.1, 0x888888);
      vb.box(-w / 2 - 0.05, i + 0.45, -w / 2, 0.1, 0.1, w, 0x888888);
      vb.box(w / 2 - 0.05, i + 0.45, -w / 2, 0.1, 0.1, w, 0x888888);
    }
  }
  vb.box(-0.6, H, -0.6, 1.2, 0.2, 1.2, 0x777777);
  vb.box(-0.1, H + 0.2, -0.1, 0.2, 1.4, 0.2, 0x555555);
  return new THREE.Mesh(vb.build(), voxMaterial);
}

export function makePlaneWreck() {
  const vb = new VoxBuilder();
  const hull = 0x6f7a6a, dark = 0x3f463c, snow = 0xe8eef2;
  vb.box(-0.7, 0, -2.5, 1.4, 1.2, 4.4, hull, false, snow);
  vb.box(-0.5, 0.15, 1.9, 1.0, 0.9, 1.0, dark);
  vb.box(-3.6, 0, -0.6, 2.8, 0.18, 1.3, hull, false, snow);
  vb.box(1.2, 0, 0.2, 2.2, 0.18, 1.1, hull, false, snow);
  vb.box(4.0, 0, 1.6, 1.4, 0.14, 0.9, dark);
  vb.box(-0.15, 0, -5.4, 0.3, 1.6, 1.2, hull, false, snow);
  vb.box(-1.6, 0, -4.8, 1.1, 0.12, 0.7, dark);
  vb.box(2.6, 0, -2.6, 0.6, 0.4, 0.8, dark);
  const m = new THREE.Mesh(vb.build(), voxMaterial);
  m.rotation.y = 0.5;
  m.rotation.z = 0.08;
  return m;
}

export function makeHouse(w, d, h, wall = 0xb8a88a, roof = 0x5a4a3a, opts = {}) {
  const vb = new VoxBuilder();
  vb.box(-w / 2, 0, -d / 2, w, h, d, wall);
  for (let i = 0; i < 3; i++) {
    const inset = i * 0.5;
    vb.box(-w / 2 - 0.3 + inset, h + i * 0.4, -d / 2 - 0.3, w + 0.6 - inset * 2, 0.4, d + 0.6, roof, false, opts.snowRoof ? 0xe8eef2 : roof);
  }
  vb.box(-0.4, 0, d / 2, 0.8, 1.5, 0.06, 0x3a2a1e);
  vb.box(w / 2 - 1.2, 1.0, d / 2, 0.7, 0.6, 0.06, opts.lit ? 0xffd27a : 0x2a3a4a);
  return new THREE.Mesh(vb.build(), voxMaterial);
}

export function makeShed() {
  const vb = new VoxBuilder();
  const wood = 0x6b4a2b;
  for (const [x, z] of [[-1.5, -1.2], [1.5, -1.2], [-1.5, 1.2], [1.5, 1.2]]) vb.box(x - 0.1, 0, z - 0.1, 0.2, x > 0 ? 2.2 : 1.8, 0.2, wood);
  vb.box(-1.8, 1.8, -1.5, 3.6, 0.2, 3.0, 0x5a3e24, false, 0xe8eef2);
  vb.box(-1.6, 0, -1.3, 0.12, 1.2, 2.6, 0x5a3e24);
  return new THREE.Mesh(vb.build(), voxMaterial);
}

export function makeShrine(ruined = false) {
  const vb = new VoxBuilder();
  const stone = 0x8c8577;
  vb.box(-1.6, 0, -1.2, 3.2, 0.3, 2.4, 0x6f6a60);
  vb.box(-1.5, 0.3, -1.1, 0.4, ruined ? 1.0 : 1.6, 2.2, stone);
  vb.box(1.1, 0.3, -1.1, 0.4, ruined ? 1.4 : 1.6, 2.2, stone);
  vb.box(-1.1, 0.3, -1.1, 2.2, ruined ? 0.8 : 1.6, 0.4, stone);
  if (!ruined) {
    vb.box(-1.9, 1.9, -1.5, 3.8, 0.3, 3.0, 0x7a2e22, false, 0xe8eef2);
    vb.box(-1.4, 2.2, -1.1, 2.8, 0.3, 2.2, 0x7a2e22, false, 0xe8eef2);
    vb.box(-0.3, 0.3, -0.6, 0.6, 0.8, 0.3, 0xaa8844);
  }
  return new THREE.Mesh(vb.build(), voxMaterial);
}

export function makeFence(length = 14) {
  const vb = new VoxBuilder();
  for (let i = 0; i <= length; i += 2) {
    if (i === 6) continue; // 被剪开的缺口
    vb.box(i - 0.08, 0, -0.08, 0.16, 2.0, 0.16, 0x555555);
  }
  for (const y of [0.5, 1.1, 1.7]) {
    vb.box(0, y, -0.03, 5.6, 0.05, 0.06, 0x999999);
    vb.box(8.2, y, -0.03, length - 8.2, 0.05, 0.06, 0x999999);
  }
  return new THREE.Mesh(vb.build(), voxMaterial);
}

export function makeStall() {
  const g = new THREE.Group();
  const vb = new VoxBuilder();
  vb.box(-1.2, 0, -0.5, 2.4, 1.0, 1.0, 0xd8c8a8);
  vb.box(-1.4, 2.2, -0.9, 2.8, 0.15, 1.6, 0xd03a2a);
  vb.box(-1.3, 0, -0.85, 0.12, 2.2, 0.12, 0x777777);
  vb.box(1.18, 0, -0.85, 0.12, 2.2, 0.12, 0x777777);
  // 烤肠机
  vb.box(-0.5, 1.0, -0.3, 1.0, 0.35, 0.6, 0xbbbbbb);
  for (let i = 0; i < 5; i++) vb.box(-0.42 + i * 0.2, 1.36, -0.25, 0.1, 0.1, 0.5, 0xb5532a);
  g.add(new THREE.Mesh(vb.build(), voxMaterial));
  const glow = new THREE.PointLight(0xffaa55, 6, 10, 1.5);
  glow.position.set(0, 1.8, 0.6);
  g.add(glow);
  return g;
}

export function makeFlag(color = 0xff5a1f) {
  const vb = new VoxBuilder();
  vb.box(-0.06, 0, -0.06, 0.12, 3.2, 0.12, 0x777777);
  vb.box(0.06, 2.4, -0.03, 1.2, 0.7, 0.06, color);
  return new THREE.Mesh(vb.build(), voxMaterial);
}

export function makeArrow(color = 0xffffff) {
  const g = new THREE.Group();
  const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false });
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 1.6), m);
  shaft.position.z = -0.4;
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.8, 4), m);
  head.rotation.x = Math.PI / 2;
  head.position.z = 0.75;
  g.add(shaft, head);
  return g;
}

// 光点（NPC/事件提示）
export function makeMarker(color = 0xffcc33) {
  const g = new THREE.Group();
  const m = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true });
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.16), m);
  bar.position.y = 0.42;
  const dot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), m);
  g.add(bar, dot);
  g.renderOrder = 10;
  return g;
}
