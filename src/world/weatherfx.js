// weatherfx.js —— 天气粒子特效：降雪 / 地吹雪 / 雾团 / 呼吸白气 / 脚印
// Weather particle FX: GPU snowfall, spindrift, fog banks, breath vapor, footprints.
//
// 约定：y 向上，1 unit = 1 voxel；所有 ShaderMaterial 都支持 scene.fog，并包含
// tonemapping / colorspace chunk（顺序与 three 内置材质一致：tonemap -> colorspace -> fog）。
// Everything is parented under one THREE.Group; dispose() removes + frees it all.
import * as THREE from 'three';

// 各档位粒子数量 (far/near = 雪花远/近层, spin = 地吹雪, fog = 雾团 sprite 数)
const QUALITY = {
  low: { far: 1200, near: 600, spin: 300, fog: 16 },
  mid: { far: 3500, near: 1500, spin: 900, fog: 28 },
  high: { far: 8000, near: 3000, spin: 1800, fog: 40 },
};
// 雪层参数：box 为包围相机的循环盒，size 为世界尺寸(最小,最大)，sway/turb 为摇摆/湍流幅度
const LAYERS = [
  { key: 'far', box: [80, 44, 80], size: [0.08, 0.16], sway: 1.2, turb: 2.2, alpha: 0.75, order: 3 },
  { key: 'near', box: [26, 26, 26], size: [0.03, 0.075], sway: 0.5, turb: 0.9, alpha: 0.9, order: 4 },
];
const BREATH_POOL = 80;
const FOOT_POOL = 200;
const SNOW_RGB = [0.94, 0.97, 1.0];
const LAMP_RGB = [1.0, 0.86, 0.62]; // 头灯暖白

// ---------------------------------------------------------------- helpers
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
// 帧率无关的指数平滑 / frame-rate independent exponential smoothing
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
function mulberry32(a) { // 可复现的伪随机 / seeded PRNG
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 程序化云雾贴图：多层 value-noise fbm + 噪声扭曲的径向遮罩，边缘强制归零（无方形边）。
// Procedural cloud blob as a DataTexture (no canvas needed, works in Node too).
function makeCloudTexture(size = 256) {
  const rnd = mulberry32(20240);
  const levels = [4, 8, 16, 32].map((n, k) => {
    const g = new Float32Array(n * n);
    for (let i = 0; i < g.length; i++) g[i] = rnd();
    return { n, g, c: Math.cos(k * 0.9), s: Math.sin(k * 0.9), ox: rnd() * n, oy: rnd() * n };
  });
  const fbm = (u, v) => { // 每层旋转 + 平移的周期晶格，避免横竖条纹 / rotated periodic lattices avoid axis-aligned banding
    let sum = 0, amp = 0.5, norm = 0;
    for (const { n, g, c, s, ox, oy } of levels) {
      const x = (u * c - v * s) * n + ox + n * 4, y = (u * s + v * c) * n + oy + n * 4;
      const xi = Math.floor(x), yi = Math.floor(y), fx = smoothstep(0, 1, x - xi), fy = smoothstep(0, 1, y - yi);
      const x0 = xi % n, x1 = (xi + 1) % n, y0 = (yi % n) * n, y1 = ((yi + 1) % n) * n;
      const top = g[y0 + x0] + (g[y0 + x1] - g[y0 + x0]) * fx;
      const bot = g[y1 + x0] + (g[y1 + x1] - g[y1 + x0]) * fx;
      sum += amp * (top + (bot - top) * fy); norm += amp; amp *= 0.5;
    }
    return sum / norm;
  };
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / (size - 1), v = y / (size - 1);
      const r = Math.hypot(u - 0.5, v - 0.5) * 2;
      const n1 = fbm(u, v), n2 = fbm(1 - v * 0.9, u * 0.9 + 0.05);
      const mask = (1 - smoothstep(0.2, 0.95, r + (n2 - 0.5) * 0.45)) * (1 - smoothstep(0.8, 1.0, r));
      const a = mask * (0.3 + 0.7 * Math.min(1, n1 * 1.5));
      const k = (y * size + x) * 4;
      data[k] = data[k + 1] = data[k + 2] = 255;
      data[k + 3] = Math.round(clamp(a, 0, 1) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------- GLSL
// 头灯锥形光束：锥角约 20°~35° 软边，距离 6~18 衰减 / headlamp cone test (shared by snow + spindrift)
const LAMP_GLSL = /* glsl */`
uniform float uLampOn;
uniform vec3 uLampPos;
uniform vec3 uLampDir;
float lampBeam(vec3 wp) {
  vec3 d = wp - uLampPos;
  float dist = max(length(d), 1e-3);
  float cone = smoothstep(0.82, 0.94, dot(d / dist, uLampDir));
  return cone * (1.0 - smoothstep(6.0, 18.0, dist)) * smoothstep(0.5, 2.0, dist) * uLampOn;
}`;
// 软椭圆粒子：uDir 为屏幕空间运动方向，stretch>1 时沿运动方向拉成条纹 / soft ellipse oriented along screen-space motion
const SHAPE_GLSL = /* glsl */`
float flakeShape(vec2 dir, float stretch, float core) {
  vec2 pc = gl_PointCoord - 0.5; pc.y = -pc.y;
  vec2 q = vec2(dot(pc, dir), dot(pc, vec2(-dir.y, dir.x)) * stretch);
  return 1.0 - smoothstep(core, 1.0, length(q) * 2.0);
}`;
// 雪花/地吹雪共用的片元：基础色 * 环境光，光束内混入暖白并增亮
const LIT_FRAG = (core, boost) => /* glsl */`
uniform vec3 uColor;
uniform vec3 uLampColor;
uniform vec2 uDir;
uniform float uStretch;
varying float vAlpha;
varying float vLamp;
#include <fog_pars_fragment>
${SHAPE_GLSL}
void main() {
  float a = flakeShape(uDir, uStretch, ${core}) * vAlpha;
  if (a < 0.003) discard;
  vec3 col = mix(uColor, uLampColor, vLamp) * (1.0 + vLamp * ${boost});
  gl_FragColor = vec4(col, min(1.0, a * (1.0 + vLamp * 1.5)));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

// 降雪：种子在单位盒内，位置在顶点着色器里由 时间/风/摇摆 动画并 mod 回绕到相机周围的盒子
// Snow: positions are unit-box seeds; the vertex shader animates + wraps them around the camera.
const SNOW_VERT = /* glsl */`
attribute vec4 aRand;           // x 尺寸 / y 速度 / z 相位 / w 密度排名
uniform float uTime, uFallDist, uSpread, uSway, uTurb, uScale, uAlpha, uDensity, uMinPx, uMaxPx, uStretch;
uniform vec2 uDrift, uSize;
uniform vec3 uBox, uCenter;
varying float vAlpha;
varying float vLamp;
#include <fog_pars_vertex>
${LAMP_GLSL}
void main() {
  float ph = aRand.z * 6.2831853;
  vec3 p = position * uBox;
  p.y  -= uFallDist * (0.65 + 0.7 * aRand.y);            // 下落(重的更快)
  p.xz += uDrift * (1.0 - uSpread * aRand.y);            // 风漂移(重的更慢)
  p += vec3(sin(uTime * 0.9 + ph), sin(uTime * 1.3 + ph * 1.7) * 0.35, cos(uTime * 0.7 + ph * 1.3)) * uSway * (0.6 + 0.8 * aRand.x);
  p += vec3(sin(uTime * 2.7 + ph * 3.1 + position.y * 17.0),     // 暴风雪湍流
            cos(uTime * 3.1 + ph * 2.3 + position.x * 13.0),
            sin(uTime * 2.3 + ph * 1.9 + position.z * 11.0)) * uTurb;
  vec3 rel = mod(p - uCenter + 0.5 * uBox, uBox) - 0.5 * uBox;   // 回绕进以相机为中心的盒子
  vec3 wp = uCenter + rel;
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  float depth = max(-mvPosition.z, 0.05);
  float raw = mix(uSize.x, uSize.y, aRand.x * aRand.x) * uScale / depth * (1.0 + (uStretch - 1.0) * 0.5); // 条纹时整体放大
  float lamp = lampBeam(wp);
  gl_PointSize = clamp(raw * (1.0 + 0.7 * lamp), uMinPx, uMaxPx);
  vec3 e = abs(rel) / uBox;
  float edge = 1.0 - smoothstep(0.36, 0.5, max(e.x, max(e.y, e.z)));  // 盒边淡出，掩盖回绕
  float dd = uDensity * 1.08;
  float rank = 1.0 - smoothstep(dd - 0.08, dd, aRand.w);              // 按密度逐渐出现
  vAlpha = uAlpha * edge * rank * smoothstep(0.5, 2.0, depth) * clamp(raw / uMinPx, 0.35, 1.0);
  vLamp = lamp;
  #include <fog_vertex>
}`;

// 地吹雪：玩家周围 36x3.2x36 的盒子，沿风高速平流，越靠近地面越密
const SPIN_VERT = /* glsl */`
attribute vec4 aRand;
uniform float uTime, uScale, uAlpha, uDensity, uGust, uMinPx, uMaxPx;
uniform vec2 uDrift, uWindDir, uSize;
uniform vec3 uBox, uCenter;      // uCenter = 玩家脚底 / player feet
varying float vAlpha;
varying float vLamp;
#include <fog_pars_vertex>
${LAMP_GLSL}
void main() {
  float ph = aRand.z * 6.2831853;
  vec3 p = vec3(position.x, pow(position.y, 1.7), position.z) * uBox;
  p.xz += uDrift * (0.75 + 0.5 * aRand.y);
  p.xz += vec2(-uWindDir.y, uWindDir.x) * sin(uTime * 0.8 + ph + p.y * 2.0) * 1.2;   // 侧向蛇形
  p.y  += sin(uTime * 1.9 + ph) * 0.18 * uGust;                                      // 阵风起伏
  vec2 rel = mod(p.xz - uCenter.xz + 0.5 * uBox.xz, uBox.xz) - 0.5 * uBox.xz;
  vec3 wp = vec3(uCenter.x + rel.x, uCenter.y - 1.0 + p.y, uCenter.z + rel.y);
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  float depth = max(-mvPosition.z, 0.05);
  float raw = mix(uSize.x, uSize.y, aRand.x) * uScale / depth;
  gl_PointSize = clamp(raw, uMinPx, uMaxPx);
  vec2 e = abs(rel) / uBox.xz;
  float edge = 1.0 - smoothstep(0.34, 0.5, max(e.x, e.y));
  float dd = uDensity * 1.08;
  float rank = 1.0 - smoothstep(dd - 0.08, dd, aRand.w);
  vAlpha = uAlpha * edge * rank * smoothstep(1.0, 3.5, depth) * (0.5 + 0.5 * aRand.x)
         * (1.0 - smoothstep(0.75, 1.0, position.y));
  vLamp = lampBeam(wp);
  #include <fog_vertex>
}`;

// 呼吸白气：CPU 更新 position/size/alpha 三个属性（池很小）
const BREATH_VERT = /* glsl */`
attribute float aSize;
attribute float aAlpha;
uniform float uScale;
varying float vAlpha;
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = viewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  float depth = max(-mvPosition.z, 0.05);
  gl_PointSize = clamp(aSize * uScale / depth, 1.0, 160.0);
  vAlpha = aAlpha * smoothstep(0.25, 1.2, depth);   // 贴脸时淡出
  #include <fog_vertex>
}`;
const BREATH_FRAG = /* glsl */`
uniform vec3 uColor;
varying float vAlpha;
#include <fog_pars_fragment>
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float a = 1.0 - smoothstep(0.0, 1.0, r);
  a = a * a * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

// 创建带 fog / tonemap 支持的 ShaderMaterial / material factory
function makeMaterial(vertexShader, fragmentShader, uniforms) {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, uniforms]),
    vertexShader, fragmentShader, transparent: true, depthWrite: false, fog: true,
  });
}
const lampUniforms = () => ({
  uLampOn: { value: 0 }, uLampPos: { value: new THREE.Vector3() }, uLampDir: { value: new THREE.Vector3(0, 0, -1) },
  uLampColor: { value: new THREE.Color().setRGB(...LAMP_RGB) },
});
const litUniforms = () => ({
  uTime: { value: 0 }, uScale: { value: 800 }, uAlpha: { value: 0 }, uDensity: { value: 0 },
  uMinPx: { value: 1.5 }, uMaxPx: { value: 22 }, uColor: { value: new THREE.Color() },
  uDir: { value: new THREE.Vector2(0, -1) }, uStretch: { value: 1 }, ...lampUniforms(),
});

// ---------------------------------------------------------------- WeatherFX
export class WeatherFX {
  constructor(scene, { quality = 'mid' } = {}) {
    this.scene = scene;
    this.quality = QUALITY[quality] ? quality : 'mid';
    this.time = 0;
    // 可选覆盖：渲染器像素比 / 视口像素高度（默认取 window）
    this.pixelRatio = null; this.viewportHeight = null;
    this.group = new THREE.Group();
    this.group.name = 'WeatherFX';
    scene.add(this.group);

    // 平滑状态 / smoothed state
    this._snowK = 0; this._bz = 0; this._dens = 0; this._sd = 0; this._fogOp = 0; this._lampK = 0;
    this._fall = 0; this._dx = 0; this._dz = 0; this._sdx = 0; this._sdz = 0; this._cy = null;
    this._tint = new THREE.Color(1, 1, 1);
    this._camQ = new THREE.Quaternion(); this._v = new THREE.Vector3();
    this._dir = new THREE.Vector2(); this._rnd = mulberry32(7);

    this._buildSnow(); this._buildSpindrift(); this._buildFogBanks(); this._buildBreath(); this._buildFootprints();
  }

  // ---- 构建 / build ------------------------------------------------------
  _makeSeedGeometry(count, seed) {
    const rnd = mulberry32(seed), pos = new Float32Array(count * 3), rr = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = rnd(); pos[i * 3 + 1] = rnd(); pos[i * 3 + 2] = rnd();
      rr[i * 4] = rnd(); rr[i * 4 + 1] = rnd(); rr[i * 4 + 2] = rnd();
      rr[i * 4 + 3] = (i + 0.5) / count; // 索引即密度排名 -> setDrawRange 可直接裁剪
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aRand', new THREE.BufferAttribute(rr, 4));
    g.userData.count = count;
    return g;
  }

  _buildSnow() {
    const q = QUALITY[this.quality];
    if (!this._snow) {
      this._snow = LAYERS.map((cfg, k) => {
        const mat = makeMaterial(SNOW_VERT, LIT_FRAG('0.15', '1.8'), {
          ...litUniforms(), uBox: { value: new THREE.Vector3(...cfg.box) }, uCenter: { value: new THREE.Vector3() },
          uFallDist: { value: 0 }, uDrift: { value: new THREE.Vector2() }, uSpread: { value: 0.35 },
          uSway: { value: cfg.sway }, uTurb: { value: 0 }, uSize: { value: new THREE.Vector2(...cfg.size) },
        });
        const points = new THREE.Points(this._makeSeedGeometry(q[cfg.key], 101 + k), mat);
        points.frustumCulled = false; points.renderOrder = cfg.order; points.visible = false;
        this.group.add(points);
        return { cfg, mat, points };
      });
    } else {
      this._snow.forEach((l, k) => { l.points.geometry.dispose(); l.points.geometry = this._makeSeedGeometry(q[l.cfg.key], 101 + k); });
    }
  }

  _buildSpindrift() {
    const n = QUALITY[this.quality].spin;
    if (!this._spin) {
      const mat = makeMaterial(SPIN_VERT, LIT_FRAG('0.0', '1.2'), {
        ...litUniforms(), uBox: { value: new THREE.Vector3(36, 3.2, 36) }, uCenter: { value: new THREE.Vector3() },
        uDrift: { value: new THREE.Vector2() }, uWindDir: { value: new THREE.Vector2(1, 0) },
        uSize: { value: new THREE.Vector2(0.35, 0.9) }, uGust: { value: 0 },
      });
      mat.uniforms.uMaxPx.value = 64; mat.uniforms.uMinPx.value = 3;
      const points = new THREE.Points(this._makeSeedGeometry(n, 303), mat);
      points.frustumCulled = false; points.renderOrder = 2; points.visible = false;
      this.group.add(points);
      this._spin = { mat, points };
    } else {
      this._spin.points.geometry.dispose(); this._spin.points.geometry = this._makeSeedGeometry(n, 303);
    }
  }

  _buildFogBanks() {
    this._clearFog();
    this._cloudTex = this._cloudTex || makeCloudTexture(256);
    const rnd = this._rnd;
    this._banks = [];
    for (let i = 0; i < QUALITY[this.quality].fog; i++) {
      const mat = new THREE.SpriteMaterial({
        map: this._cloudTex, transparent: true, depthWrite: false, fog: true, opacity: 0, rotation: rnd() * Math.PI * 2,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.renderOrder = 1; sprite.visible = false;
      const scale = 14 + rnd() * 20;
      sprite.scale.set(scale, scale * (0.55 + rnd() * 0.3), 1); // 扁一点，更像雾带
      this.group.add(sprite);
      this._banks.push({
        sprite, mat, x: 0, z: 0, yRel: -3 + rnd() * 13, scale, variation: 0.5 + rnd() * 0.5, fadeIn: 1,
        vx: (rnd() - 0.5) * 1.2, vz: (rnd() - 0.5) * 1.2, seed: rnd() * 100, placed: false,
      });
    }
  }

  _clearFog() {
    if (!this._banks) return;
    for (const b of this._banks) { this.group.remove(b.sprite); b.mat.dispose(); }
    this._banks = null;
  }

  _buildBreath() {
    const N = BREATH_POOL, g = new THREE.BufferGeometry();
    const aPos = new THREE.BufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const aSize = new THREE.BufferAttribute(new Float32Array(N), 1).setUsage(THREE.DynamicDrawUsage);
    const aAlpha = new THREE.BufferAttribute(new Float32Array(N), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', aPos); g.setAttribute('aSize', aSize); g.setAttribute('aAlpha', aAlpha);
    const mat = makeMaterial(BREATH_VERT, BREATH_FRAG, { uScale: { value: 800 }, uColor: { value: new THREE.Color() } });
    const points = new THREE.Points(g, mat);
    points.frustumCulled = false; points.renderOrder = 6;
    this.group.add(points);
    this._breath = {
      geo: g, mat, points, aPos, aSize, aAlpha, vel: new Float32Array(N * 3),
      age: new Float32Array(N).fill(1), life: new Float32Array(N).fill(1), a0: new Float32Array(N),
      head: 0, timer: 0.25, alive: 0,
    };
  }

  _buildFootprints() {
    const geo = new THREE.PlaneGeometry(0.22, 0.34);
    geo.rotateX(-Math.PI / 2); // 躺平在 XZ 面，长边沿局部 Z
    const mat = new THREE.MeshLambertMaterial({
      color: 0xb7c2cc, transparent: true, opacity: 0.85, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, FOOT_POOL);
    mesh.frustumCulled = false; mesh.renderOrder = -1;
    const z = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < FOOT_POOL; i++) mesh.setMatrixAt(i, z);
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
    this._foot = {
      mesh, geo, mat, x: new Float32Array(FOOT_POOL), y: new Float32Array(FOOT_POOL), z: new Float32Array(FOOT_POOL),
      ry: new Float32Array(FOOT_POOL), age: new Float32Array(FOOT_POOL), cover: new Float32Array(FOOT_POOL),
      live: new Uint8Array(FOOT_POOL), head: 0, side: 1, acc: 0, dummy: new THREE.Object3D(),
    };
  }

  setQuality(q) {
    if (!QUALITY[q] || q === this.quality) return;
    this.quality = q;
    this._buildSnow(); this._buildSpindrift(); this._buildFogBanks();
  }

  // ---- 每帧更新 / per-frame -------------------------------------------------
  update(dt, s) {
    dt = clamp(dt, 0, 0.1);
    this.time += dt;
    const cam = s.camera, wind = s.wind, ws = Math.hypot(wind.x, wind.z);

    // 环境色：lightColor 加一个偏蓝的保底，避免夜里粒子全黑 / ambient tint with a bluish floor
    const lc = s.lightColor;
    this._tint.setRGB(Math.max(lc.r, 0.1), Math.max(lc.g, 0.13), Math.max(lc.b, 0.22));

    // 点精灵像素尺度 = 视口高(px) / (2 tan(fov/2))
    const dpr = this.pixelRatio || (typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1);
    const vh = this.viewportHeight || (typeof window !== 'undefined' ? window.innerHeight * dpr : 720);
    this._scale = vh / (2 * Math.tan((cam.fov * Math.PI) / 360));
    this._dpr = dpr;
    cam.getWorldQuaternion(this._camQ).invert(); // 世界 -> 相机旋转，用于把运动向量投到屏幕

    // 头灯强度平滑（白天被冲淡）
    this._lampK = damp(this._lampK, s.lamp.on ? 1 - 0.75 * s.dayK : 0, 6, dt);

    this._updateSnow(dt, s, ws);
    this._updateSpindrift(dt, s, ws);
    this._updateFogBanks(dt, s, ws);
    this._updateBreath(dt, s);
    this._updateFootprints(dt, s);
  }

  // 把世界速度向量投到屏幕：写入归一化方向到 this._dir，返回“在屏幕平面内的比例”(0..1)
  _screenDir(vx, vy, vz) {
    this._v.set(vx, vy, vz).applyQuaternion(this._camQ);
    const m = Math.hypot(this._v.x, this._v.y), l = this._v.length() || 1;
    if (m > 1e-4) this._dir.set(this._v.x / m, this._v.y / m); else this._dir.set(0, -1);
    return m / l;
  }

  _applyCommon(u, s, alphaMul, minPx, maxPx) { // 共用 uniform：时间/尺度/颜色/头灯
    u.uTime.value = this.time; u.uScale.value = this._scale;
    u.uMinPx.value = minPx * this._dpr; u.uMaxPx.value = maxPx * this._dpr;
    u.uColor.value.setRGB(...SNOW_RGB).multiply(this._tint);
    u.uAlpha.value = alphaMul; u.uLampOn.value = this._lampK;
    u.uLampPos.value.copy(s.lamp.pos); u.uLampDir.value.copy(s.lamp.dir).normalize();
  }

  _updateSnow(dt, s, ws) {
    const p = s.precip, w = s.wind;
    this._bz = damp(this._bz, s.blizzard ? 1 : 0, 1.2, dt);
    this._snowK = damp(this._snowK, p < 0.02 ? 0 : 1, 1.5, dt);
    const on = this._snowK > 0.01, bz = this._bz;
    for (const l of this._snow) l.points.visible = on;
    if (!on) return;
    // 速度在 CPU 积分(双精度)，着色器只拿累积位移；暴风雪时水平速度逼近风速，下落变缓
    const fall = lerp(1.8 + 1.2 * p, 1.1, bz), windK = lerp(0.3, 0.95, bz);
    this._fall += fall * dt; this._dx += w.x * windK * dt; this._dz += w.z * windK * dt;
    this._dens = damp(this._dens, lerp(0.12 + 0.88 * p, 1, bz * 0.8), 1.5, dt);
    const inPlane = this._screenDir(w.x * windK, -fall, w.z * windK);
    const stretch = 1 + bz * 1.8 * Math.min(ws / 14, 1) * smoothstep(0.15, 0.6, inPlane); // 暴风雪拉成条纹
    for (const l of this._snow) {
      const u = l.mat.uniforms;
      this._applyCommon(u, s, l.cfg.alpha * this._snowK * (0.35 + 0.65 * p), 1.5, 22);
      u.uCenter.value.copy(s.camera.position);
      u.uFallDist.value = this._fall; u.uDrift.value.set(this._dx, this._dz);
      u.uSpread.value = lerp(0.35, 0.08, bz);
      u.uSway.value = l.cfg.sway * (1 + ws / 20); u.uTurb.value = l.cfg.turb * bz;
      u.uDensity.value = this._dens; u.uDir.value.copy(this._dir); u.uStretch.value = stretch;
      l.points.geometry.setDrawRange(0, Math.ceil(l.points.geometry.userData.count * Math.min(1, this._dens * 1.08 + 0.02)));
    }
  }

  _updateSpindrift(dt, s, ws) {
    // 触发条件：spindrift 或 blizzard；强度随风速与暴露度增长
    const base = s.spindrift || s.blizzard ? 1 : 0, expo = clamp(s.exposure, 0, 1.3);
    this._sd = damp(this._sd, clamp(base * smoothstep(3, 18, ws) * (0.3 + 0.55 * expo), 0, 1), 1.2, dt);
    const sp = this._spin, on = this._sd > 0.01;
    sp.points.visible = on;
    if (!on) return;
    this._sdx += s.wind.x * dt; this._sdz += s.wind.z * dt;
    const u = sp.mat.uniforms, inPlane = this._screenDir(s.wind.x, 0, s.wind.z);
    this._applyCommon(u, s, 0.45 * this._sd, 3, 64);
    u.uCenter.value.copy(s.center); u.uDrift.value.set(this._sdx, this._sdz);
    u.uWindDir.value.set(ws > 0.01 ? s.wind.x / ws : 1, ws > 0.01 ? s.wind.z / ws : 0);
    u.uDensity.value = this._sd; u.uGust.value = this._sd;
    u.uDir.value.copy(this._dir); // 风向在屏幕上的投影；风沿视线时退化为圆点
    u.uStretch.value = 1 + (1.4 + Math.min(ws / 6, 3)) * smoothstep(0.1, 0.5, inPlane);
    sp.points.geometry.setDrawRange(0, Math.ceil(sp.points.geometry.userData.count * Math.min(1, this._sd * 1.08 + 0.02)));
  }

  _placeFog(b, s, ws, anywhere) {
    const rnd = this._rnd, c = s.center;
    let ang = rnd() * Math.PI * 2, r;
    if (anywhere) r = 8 + 37 * Math.sqrt(rnd());                      // 初始：8..45 圆盘内均匀
    else {
      r = 30 + rnd() * 14;                                            // 重生：上风侧外圈 ±69°
      if (ws > 0.3) ang = Math.atan2(-s.wind.z, -s.wind.x) + (rnd() - 0.5) * 2.4;
      b.fadeIn = 0;
    }
    b.x = c.x + Math.cos(ang) * r; b.z = c.z + Math.sin(ang) * r; b.placed = true;
  }

  _updateFogBanks(dt, s, ws) {
    // 目标不透明度：雾 + 暴风雪 + 少量降雪；平滑过渡
    const target = clamp(s.fog * 0.55 + (s.blizzard ? 0.35 : 0) + s.precip * 0.1, 0, 0.75);
    this._fogOp = damp(this._fogOp, target, 1.0, dt);
    const on = this._fogOp > 0.004;
    this._cy = this._cy === null ? s.center.y : damp(this._cy, s.center.y, 2, dt);
    const wx = ws > 0.3 ? s.wind.x / ws : 0, wz = ws > 0.3 ? s.wind.z / ws : 0, cam = s.camera.position, c = s.center;
    for (const b of this._banks) {
      if (!b.placed) this._placeFog(b, s, ws, true);
      if (!on) { b.sprite.visible = false; continue; } // 不可见时仅隐藏(位置冻结)
      b.x += (s.wind.x * 0.55 + b.vx) * dt; b.z += (s.wind.z * 0.55 + b.vz) * dt;
      const rx = b.x - c.x, rz = b.z - c.z, d = Math.hypot(rx, rz);
      if (d > 45 || rx * wx + rz * wz > 43) this._placeFog(b, s, ws, false); // 跑到下风太远 -> 上风重生
      b.fadeIn = Math.min(1, b.fadeIn + dt * 0.5);
      const y = this._cy + b.yRel + Math.sin(this.time * 0.1 + b.seed) * 0.8;
      b.sprite.position.set(b.x, y, b.z);
      const dc = b.sprite.position.distanceTo(cam);
      const op = this._fogOp * b.variation * b.fadeIn * (1 - smoothstep(32, 44, d)) * smoothstep(4, 4 + b.scale * 0.4, dc);
      b.mat.opacity = op; b.mat.color.copy(this._tint);
      b.sprite.visible = op > 0.004;
    }
  }

  _updateBreath(dt, s) {
    const B = this._breath, br = s.breath, w = s.wind, rnd = this._rnd;
    const P = B.aPos.array, S = B.aSize.array, A = B.aAlpha.array, V = B.vel;
    // 呼气：每 1/rate 秒喷出 ~6 个粒子
    if (br.active && br.cold > 0.05) {
      B.timer -= dt;
      if (B.timer <= 0) {
        B.timer = Math.max(0, B.timer + 1 / Math.max(0.1, br.rate));
        for (let k = 0; k < 6; k++) {
          const i = B.head, j = i * 3, sp = 0.6 * (0.75 + 0.5 * rnd());
          B.head = (B.head + 1) % BREATH_POOL;
          P[j] = br.pos.x + (rnd() - 0.5) * 0.08; P[j + 1] = br.pos.y + (rnd() - 0.5) * 0.05; P[j + 2] = br.pos.z + (rnd() - 0.5) * 0.08;
          V[j] = br.dir.x * sp + w.x * 0.25 + (rnd() - 0.5) * 0.18;
          V[j + 1] = 0.15 + (rnd() - 0.5) * 0.1;
          V[j + 2] = br.dir.z * sp + w.z * 0.25 + (rnd() - 0.5) * 0.18;
          B.age[i] = 0; B.life[i] = 1.4 * (0.85 + 0.3 * rnd()); B.a0[i] = 0.5 * br.cold * (0.8 + 0.4 * rnd());
        }
      }
    } else B.timer = Math.min(B.timer, 0.25);

    let alive = 0;
    const drag = Math.min(1, dt * 1.5);
    for (let i = 0; i < BREATH_POOL; i++) {
      if (B.age[i] >= B.life[i]) { if (A[i] !== 0) { A[i] = 0; S[i] = 0; } continue; }
      alive++;
      const j = i * 3, t = (B.age[i] += dt) / B.life[i];
      V[j] += (w.x * 0.25 - V[j]) * drag; V[j + 2] += (w.z * 0.25 - V[j + 2]) * drag; // 水平速度衰减到风的 25%
      P[j] += V[j] * dt; P[j + 1] += V[j + 1] * dt; P[j + 2] += V[j + 2] * dt;
      S[i] = 0.15 + 0.55 * (1 - (1 - t) * (1 - t));                              // 0.15 -> 0.7 膨胀
      A[i] = t >= 1 ? 0 : B.a0[i] * Math.pow(1 - t, 1.4) * Math.min(1, t / 0.06); // 快速淡入，缓慢淡出
    }
    if (alive > 0 || B.alive > 0) { B.aPos.needsUpdate = B.aSize.needsUpdate = B.aAlpha.needsUpdate = true; }
    B.alive = alive; B.points.visible = alive > 0 || B.timer < 0.3;
    B.mat.uniforms.uScale.value = this._scale;
    B.mat.uniforms.uColor.value.setRGB(0.92, 0.95, 1.0).multiply(this._tint);
  }

  _stamp(f) {
    const F = this._foot, i = F.head, side = (F.side = -F.side);
    F.head = (F.head + 1) % FOOT_POOL;
    const c = Math.cos(f.rotY), sn = Math.sin(f.rotY); // 局部 X 轴经 Y 旋转后 = (cos, 0, -sin)
    F.x[i] = f.x + c * 0.12 * side; F.z[i] = f.z - sn * 0.12 * side; F.y[i] = f.y + 0.02;
    F.ry[i] = f.rotY; F.age[i] = 0; F.cover[i] = 0; F.live[i] = 1;
    this._footSet(i, 1);
  }

  _footSet(i, sc) {
    const F = this._foot, d = F.dummy;
    d.position.set(F.x[i], F.y[i], F.z[i]); d.rotation.set(0, F.ry[i], 0); d.scale.setScalar(sc);
    d.updateMatrix(); F.mesh.setMatrixAt(i, d.matrix); F.mesh.instanceMatrix.needsUpdate = true;
  }

  _updateFootprints(dt, s) {
    const F = this._foot;
    if (s.footstep) this._stamp(s.footstep);
    // 降雪时脚印被逐渐覆盖：累计“雪中时间”，寿命 = 60s*(1-precip)（下限 10s）；覆盖进度单调不回退
    if (s.precip < 0.02) return;
    F.acc += dt;
    if (F.acc < 0.25) return; // 4Hz 足够
    const life = Math.max(10, 60 * (1 - s.precip)), step = F.acc;
    F.acc = 0;
    for (let i = 0; i < FOOT_POOL; i++) {
      if (!F.live[i]) continue;
      F.age[i] += step;
      F.cover[i] = Math.max(F.cover[i], F.age[i] / life);
      const sc = 1 - F.cover[i];
      if (sc <= 0.02) { F.live[i] = 0; this._footSet(i, 0); } else this._footSet(i, sc);
    }
  }

  // ---- 释放 / dispose ---------------------------------------------------------
  dispose() {
    this.scene.remove(this.group);
    for (const l of this._snow) { l.points.geometry.dispose(); l.mat.dispose(); }
    this._spin.points.geometry.dispose(); this._spin.mat.dispose();
    this._clearFog();
    if (this._cloudTex) this._cloudTex.dispose();
    this._breath.geo.dispose(); this._breath.mat.dispose();
    this._foot.mesh.dispose(); this._foot.geo.dispose(); this._foot.mat.dispose();
    this.group.clear();
  }
}
