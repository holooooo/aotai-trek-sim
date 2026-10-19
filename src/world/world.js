// 场景：渲染器、画质、区块流式加载、光照（日/月光 + 阴影）、雾、天空与天气特效、后期。
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildChunk, CS, CAIRNS } from './chunk.js';
import { columnInfo, mainPath, branches, waypointPos, LAKES } from './terrain.js';
import { Sky } from './sky.js';
import { WeatherFX } from './weatherfx.js';
import {
  makeSign, makeNavTower, makePlaneWreck, makeHouse, makeShed, makeShrine, makeFence, makeFlag, makeStall,
} from './models.js';

export const QUALITY = {
  low: { name: '流畅', dpr: 1, shadow: 0, extent: 0, radius: 3, post: false, bloom: false, lampShadow: false },
  mid: { name: '均衡', dpr: 1.5, shadow: 1024, extent: 40, radius: 4, post: false, bloom: false, lampShadow: false },
  high: { name: '精美', dpr: 2, shadow: 2048, extent: 62, radius: 6, post: true, bloom: true, lampShadow: true },
};
const QKEY = 'aotai-quality';

const C = {
  fogDay: new THREE.Color(0xc4d0da),
  fogDayStorm: new THREE.Color(0xd9e0e6),
  fogNight: new THREE.Color(0x182233),
  fogDusk: new THREE.Color(0xd9a48a),
  sunWarm: new THREE.Color(0xffc48a),
  sunNoon: new THREE.Color(0xfff4e4),
  moon: new THREE.Color(0x9fb6e8),
  hemiDay: new THREE.Color(0xdfe9f5),
  hemiNight: new THREE.Color(0x6a82b8),
  groundDay: new THREE.Color(0x9aa6b2),
  groundNight: new THREE.Color(0x1c2230),
};

// 调色：暗角、颗粒、饱和度、冷色偏移（失温时画面发灰发蓝）
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.32 },
    uGrain: { value: 0.035 },
    uSat: { value: 1.05 },
    uCold: { value: 0 },
    uLift: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime, uVignette, uGrain, uSat, uCold, uLift;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, uSat);
      c.rgb = mix(c.rgb, c.rgb * vec3(0.82, 0.93, 1.12) + vec3(0.0, 0.01, 0.03), uCold);
      c.rgb += uLift;
      vec2 d = vUv - 0.5;
      float v = 1.0 - dot(d, d) * (uVignette * 2.6);
      c.rgb *= clamp(v, 0.0, 1.0);
      c.rgb += (hash(vUv * 1000.0 + uTime) - 0.5) * uGrain * (0.6 + l);
      gl_FragColor = c;
    }`,
};

export class World {
  constructor(canvas, { mobile }) {
    this.mobile = mobile;
    let q = null;
    try { q = localStorage.getItem(QKEY); } catch (e) { /* ignore */ }
    this.qname = QUALITY[q] ? q : mobile ? 'mid' : 'high';
    this.q = QUALITY[this.qname];

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 700);
    this.scene.fog = new THREE.Fog(C.fogDay, 30, 220);
    this.scene.background = C.fogDay.clone();

    this.hemi = new THREE.HemisphereLight(0xdfe9f5, 0x50565e, 0.75);
    this.key = new THREE.DirectionalLight(0xfff1dc, 1.3); // 太阳或月亮（投影光）
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.06;
    this.key.shadow.camera.near = 1;
    this.key.shadow.camera.far = 340;
    this.scene.add(this.hemi, this.key, this.key.target);

    this.headlamp = new THREE.SpotLight(0xfff0d8, 0, 36, 0.52, 0.55, 1.1);
    this.headlamp.shadow.mapSize.set(512, 512);
    this.headlamp.shadow.bias = -0.002;
    this.scene.add(this.headlamp, this.headlamp.target);

    this.sky = new Sky(this.scene, { quality: this.qname });
    this.wfx = new WeatherFX(this.scene, { quality: this.qname });

    this.chunks = new Map();
    this.time = 0;
    this._buildLandmarks();
    this.applyQuality(this.qname, true);
    window.addEventListener('resize', () => this.resize());
  }

  // —— 画质 ——
  applyQuality(name, initial = false) {
    this.qname = name;
    this.q = QUALITY[name];
    try { localStorage.setItem(QKEY, name); } catch (e) { /* ignore */ }
    const q = this.q;
    this.radius = this.mobile ? Math.min(q.radius, 4) : q.radius;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.dpr));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    const sh = q.shadow > 0;
    this.renderer.shadowMap.enabled = sh;
    this.key.castShadow = sh;
    if (sh) {
      this.key.shadow.mapSize.set(q.shadow, q.shadow);
      const e = q.extent;
      Object.assign(this.key.shadow.camera, { left: -e, right: e, top: e, bottom: -e });
      this.key.shadow.camera.updateProjectionMatrix();
      if (this.key.shadow.map) { this.key.shadow.map.dispose(); this.key.shadow.map = null; }
    }
    this.headlamp.castShadow = q.lampShadow;
    for (const c of this.chunks.values()) { c.mesh.castShadow = sh; c.mesh.receiveShadow = sh; }
    this.scene.traverse((o) => { if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; }); } });
    if (!initial) { this.sky.setQuality(name); this.wfx.setQuality(name); }
    this.wfx.pixelRatio = this.renderer.getPixelRatio();
    this._setupPost();
  }

  _setupPost() {
    if (this.composer) { this.composer.dispose?.(); this.composer = null; }
    if (!this.q.post) return;
    const w = window.innerWidth, h = window.innerHeight;
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    if (this.q.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.32, 0.55, 0.88);
      this.composer.addPass(this.bloom);
    }
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
  }

  setGrade({ cold = 0, desat = 0, vignette = 0 }) {
    if (!this.grade) return;
    const u = this.grade.uniforms;
    u.uCold.value = cold;
    u.uSat.value = 1.06 - desat * 0.7;
    u.uVignette.value = 0.3 + vignette * 0.5;
  }

  shadowify(obj) {
    const sh = this.q.shadow > 0;
    obj.traverse((o) => { if (o.isMesh) { o.castShadow = sh; o.receiveShadow = sh; } });
    return obj;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setSize(w, h);
      this.bloom?.resolution.set(w, h);
    }
  }

  // —— 区块 ——
  ensureChunks(px, pz, budgetMs = 8) {
    const ccx = Math.floor(px / CS), ccz = Math.floor(pz / CS);
    const R = this.radius;
    const want = [];
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dz * dz > R * R + 1) continue;
        const k = (ccx + dx) + ',' + (ccz + dz);
        if (!this.chunks.has(k)) want.push({ k, cx: ccx + dx, cz: ccz + dz, d: dx * dx + dz * dz });
      }
    }
    want.sort((a, b) => a.d - b.d);
    const t0 = performance.now();
    const sh = this.q.shadow > 0;
    for (const w of want) {
      if (performance.now() - t0 > budgetMs && this.chunks.size > 0) break;
      const c = buildChunk(w.cx, w.cz);
      c.mesh.castShadow = sh;
      c.mesh.receiveShadow = sh;
      this.scene.add(c.mesh);
      this.chunks.set(w.k, c);
    }
    for (const [k, c] of this.chunks) {
      const [cx, cz] = k.split(',').map(Number);
      const dx = cx - ccx, dz = cz - ccz;
      if (dx * dx + dz * dz > (R + 2) * (R + 2)) {
        this.scene.remove(c.mesh);
        c.mesh.geometry.dispose();
        this.chunks.delete(k);
      }
    }
    return want.length;
  }

  loadAllAround(px, pz) {
    let left = 1;
    let guard = 0;
    while (left > 0 && guard++ < 400) left = this.ensureChunks(px, pz, 1e9);
  }

  height(x, z) {
    const fx = Math.floor(x), fz = Math.floor(z);
    const cx = Math.floor(fx / CS), cz = Math.floor(fz / CS);
    const c = this.chunks.get(cx + ',' + cz);
    if (c) {
      const N = CS + 2;
      return c.hs[(fz - c.z0 + 1) * N + (fx - c.x0 + 1)];
    }
    return columnInfo(fx, fz).h;
  }

  // —— 地标 ——
  _place(obj, x, z, rotY = 0, yOff = 0) {
    obj.position.set(x, this._groundAt(x, z) + yOff, z);
    obj.rotation.y = rotY;
    this.scene.add(obj);
    this.landmarks.push(obj);
    return obj;
  }

  _groundAt(x, z) {
    let h = -Infinity;
    for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]]) h = Math.max(h, columnInfo(Math.floor(x) + dx, Math.floor(z) + dz).h);
    return h;
  }

  _buildLandmarks() {
    this.landmarks = [];
    this.windows = [];
    const off = (p, side, along = 0) => ({ x: p.x - p.dz * side + p.dx * along, z: p.z + p.dx * side + p.dz * along });
    const faceRot = (p) => Math.atan2(-p.dx, -p.dz);
    const lit = (house, x, z) => {
      const l = new THREE.PointLight(0xffb866, 0, 14, 1.6);
      l.position.set(x, this._groundAt(x, z) + 1.6, z);
      this.scene.add(l);
      this.windows.push(l);
      return house;
    };
    for (const wp of mainPath.waypoints) {
      const p = waypointPos(wp.id);
      const sp = off(p, -3.2, 2);
      this._place(makeSign(wp.name, `海拔约${wp.alt}m`), sp.x, sp.z, faceRot(p));
      switch (wp.id) {
        case 'tangkou': {
          const houses = [[-9, -6], [-10, 6], [-20, -7], [-22, 8], [8, -9]];
          houses.forEach(([a, sd], i) => {
            const q = off(p, sd, a);
            this._place(makeHouse(5, 4, 2.6, i === 0 ? 0xc9b48f : 0xb8a88a, 0x4a3a2e, { snowRoof: true, lit: i < 3 }), q.x, q.z, faceRot(p) + (sd > 0 ? Math.PI : 0));
            if (i < 3) lit(null, q.x, q.z);
          });
          const q = off(p, 4.5, -3);
          this._place(makeSign('塘口小卖部', '烟酒 · 矿泉水 · 泡面', { bg: '#8b1e1e' }), q.x, q.z, faceRot(p));
          const q2 = off(p, 4.5, -6);
          this._place(makeSign('烤肠：无', '本店不卖', { bg: '#f1e6c8', fg: '#8b1e1e' }), q2.x, q2.z, faceRot(p));
          break;
        }
        case 'gate': {
          const q = off(p, 7, 0);
          this._place(makeHouse(4, 3.5, 2.4, 0xd8d0c0, 0x2e5e3e, { snowRoof: true, lit: true }), q.x, q.z, faceRot(p) + Math.PI / 2);
          lit(null, q.x, q.z);
          const f = off(p, -7, 3);
          const fence = makeFence(14);
          fence.position.set(f.x, this._groundAt(f.x, f.z), f.z);
          fence.rotation.y = Math.atan2(p.dx, p.dz) + Math.PI / 2;
          this.scene.add(fence);
          this.landmarks.push(fence);
          const s2 = off(p, -4, -2);
          this._place(makeSign('禁止穿越', '鳌太线 违者罚款', { bg: '#b3261e' }), s2.x, s2.z, faceRot(p));
          break;
        }
        case 'daohang': { const q = off(p, 5, 0); this._place(makeNavTower(), q.x, q.z, 0.3); break; }
        case 'yaowang': { const q = off(p, 5, 0); this._place(makeShrine(true), q.x, q.z, faceRot(p)); break; }
        case 'feiji': { const q = off(p, 7, 4); this._place(makePlaneWreck(), q.x, q.z, 0.2, -0.4); break; }
        case 'c2800': { const q = off(p, -6, 1); this._place(makeShed(), q.x, q.z, faceRot(p)); break; }
        case 'leigong': { const q = off(p, 5, 1); this._place(makeShrine(true), q.x, q.z, faceRot(p) + 0.4); break; }
        case 'dayehai': {
          const q = off(p, -7, 2);
          this._place(makeHouse(6, 5, 2.8, 0xd9d4c8, 0x2a5d8f, { snowRoof: true, lit: true }), q.x, q.z, faceRot(p));
          lit(null, q.x, q.z);
          const fq = off(p, -3.5, 6);
          this._place(makeFlag(0xff5a1f), fq.x, fq.z, 0);
          break;
        }
        case 'baxian': { const q = off(p, 0, 7); this._place(makeShrine(false), q.x, q.z, faceRot(p) + Math.PI); break; }
        default: break;
      }
    }
    for (const b of Object.values(branches)) {
      const end = b.pointAt(b.length - 3);
      const q = off(end, -3, 0);
      this._place(makeSign(b.def.endName, '有路了'), q.x, q.z, faceRot(end));
      const h = off(end, 6, 4);
      this._place(makeHouse(4, 4, 2.4, 0xb8a88a, 0x4a3a2e, { snowRoof: true, lit: true }), h.x, h.z, faceRot(end));
      lit(null, h.x, h.z);
      const start = b.pointAt(10);
      const sq = off(start, 3, 0);
      this._place(makeSign('南坡下撤', '→ 核桃坪', { bg: '#2e5e3e' }), sq.x, sq.z, faceRot(start));
    }
    for (const o of this.landmarks) o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  }

  // 幻觉中的烤肠摊
  showHallucination(x, z, show) {
    if (show && !this.hallu) {
      this.hallu = makeStall();
      this.scene.add(this.hallu);
    }
    if (this.hallu) {
      this.hallu.visible = show;
      if (show) this.hallu.position.set(x, this._groundAt(x, z), z);
    }
  }

  // —— 大气 ——
  // env: { hour, sunEl, overcast, visibility, fogginess, precip, spindrift, wind:{x,z}, blizzard, exposure,
  //        breath, footstep, lamp, cloudSea, flash }
  updateAtmosphere(env, dt, center) {
    this.time += dt;
    const el = env.sunEl;
    const dayK = THREE.MathUtils.smoothstep(el, -0.14, 0.22);
    const duskK = Math.max(0, 1 - Math.abs(el - 0.03) / 0.2) * (1 - env.overcast * 0.75);
    const fog = env.fogginess;

    // 太阳：东升（+x）→ 正午偏南（+z）→ 西落（-x）
    const phi = Math.PI * THREE.MathUtils.clamp((env.hour - 7.8) / 10, -0.15, 1.15);
    const sunH = Math.max(-0.4, el) * 0.62;
    const sunDir = new THREE.Vector3(Math.cos(phi) * Math.cos(sunH), Math.sin(sunH), Math.sin(phi) * Math.cos(sunH)).normalize();
    const mphi = phi + Math.PI * 0.85;
    const moonDir = new THREE.Vector3(Math.cos(mphi) * 0.55, 0.78, Math.sin(mphi) * 0.55 - 0.25).normalize();

    // 雾色
    const fogCol = new THREE.Color().copy(C.fogNight).lerp(env.blizzard || fog > 0.7 ? C.fogDayStorm : C.fogDay, dayK);
    fogCol.lerp(C.fogDusk, duskK * 0.45 * (1 - fog));
    if (env.flash) fogCol.lerp(new THREE.Color(0xffffff), env.flash);
    this.scene.fog.color.copy(fogCol);
    this.scene.background.copy(fogCol);
    this.scene.fog.far = THREE.MathUtils.lerp(this.scene.fog.far, env.visibility, Math.min(1, dt * 1.5));
    this.scene.fog.near = Math.min(this.scene.fog.far * 0.1, 18);

    // 主光：白天是太阳，夜里是月亮；在晨昏时强度过零，切换不可见
    const sunUp = el > -0.04;
    const keyDir = sunUp ? sunDir : moonDir;
    const sunI = THREE.MathUtils.smoothstep(el, -0.04, 0.12) * (1.7 - env.overcast * 1.2) * (1 - fog * 0.45);
    const moonI = THREE.MathUtils.smoothstep(-el, 0.04, 0.2) * 0.55 * (1 - env.overcast * 0.75);
    this.key.intensity = sunUp ? sunI : moonI;
    if (sunUp) this.key.color.copy(C.sunWarm).lerp(C.sunNoon, THREE.MathUtils.smoothstep(el, 0.05, 0.45));
    else this.key.color.copy(C.moon);
    const e = this.q.extent || 40;
    const texel = (2 * e) / (this.q.shadow || 1024);
    const cx = Math.round(center.x / texel) * texel, cz = Math.round(center.z / texel) * texel;
    this.key.target.position.set(cx, center.y, cz);
    this.key.position.set(cx + keyDir.x * 160, center.y + keyDir.y * 160, cz + keyDir.z * 160);

    this.hemi.intensity = 0.42 + dayK * (0.78 + env.overcast * 0.3) + fog * 0.25 * dayK;
    this.hemi.color.copy(C.hemiNight).lerp(C.hemiDay, dayK);
    this.hemi.groundColor.copy(C.groundNight).lerp(C.groundDay, dayK);

    const hq = this.qname === 'high';
    for (const w of this.windows) { w.visible = hq; w.intensity = (1 - dayK) * 9 + 1; }

    if (this.bloom) this.bloom.strength = 0.22 + (1 - dayK) * 0.18 + (env.blizzard ? -0.12 : 0);

    // 天空
    this.sky.update(dt, {
      camera: this.camera, center, sunDir, moonDir, dayK, duskK, overcast: env.overcast, fog, precip: env.precip,
      fogColor: fogCol, wind: env.wind, time: this.time, cloudSeaY: 42, cloudSea: env.cloudSea ?? 0,
    });

    // 天气粒子
    const lightColor = new THREE.Color().copy(this.hemi.color).multiplyScalar(0.35 + dayK * 0.65);
    lightColor.lerp(C.sunWarm, duskK * 0.3);
    this.wfx.update(dt, {
      camera: this.camera, center: new THREE.Vector3(center.x, center.y, center.z), wind: env.wind,
      precip: env.precip, blizzard: !!env.blizzard, fog, spindrift: !!env.spindrift, exposure: env.exposure ?? 1,
      dayK, lightColor,
      breath: env.breath || { active: false, pos: new THREE.Vector3(), dir: { x: 0, z: 1 }, cold: 0, rate: 0.3 },
      footstep: env.footstep || null,
      lamp: env.lamp || { on: false, pos: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, 1) },
    });
  }

  setHeadlamp(on, pos, dir) {
    this.headlamp.intensity = on ? 46 : 0;
    if (on) {
      this.headlamp.position.set(pos.x, pos.y + 1.6, pos.z);
      this.headlamp.target.position.set(pos.x + dir.x * 8, pos.y - 0.4, pos.z + dir.z * 8);
    }
  }

  render() {
    if (this.grade) this.grade.uniforms.uTime.value = this.time % 100;
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}

export { CAIRNS, LAKES };
