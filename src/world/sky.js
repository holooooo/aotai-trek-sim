// Sky system for the ridge-hiking game: gradient dome (sun / moon / stars),
// voxel cloud layer and the 云海 cloud sea.
//
// Colour-space notes (important for the seamless horizon):
//  * THREE.Fog colour is mixed in fog_fragment AFTER tonemapping + sRGB encoding, so fogged
//    terrain ends up exactly at `fogColor` on screen. The dome therefore uses
//    `toneMapped: false` so that its horizon/below-horizon pixels are also exactly `fogColor`
//    (it still includes the tonemapping/colorspace chunks so the shader stays conventional).
//  * Clouds and cloud sea are normal tone-mapped, fogged materials.
//
// Render orders: dome -10, voxel clouds 0 (opaque), cloud sea 1 (transparent).
import * as THREE from 'three';

const DOME_RADIUS = 620;
const SEA_SIZE = 1600;
const CLOUD_PITCHES = [12, 16, 20, 24]; // cell size per (quantised) overcast level: coarser voxels for a deck
const CLOUD_WL1 = 110, CLOUD_WL2 = 45;  // noise wavelengths (units) for cluster shape / detail

// Per-quality configuration.
const QUALITY = {
  low:  { clouds: 0,   cloudRadius: 0,   octaves: 2, seaLayers: 1 },
  mid:  { clouds: 450, cloudRadius: 360, octaves: 3, seaLayers: 1 },
  high: { clouds: 900, cloudRadius: 520, octaves: 4, seaLayers: 2 },
};

// Palette (hex -> linear working space via THREE.Color).
const C = {
  zenDay: new THREE.Color('#4f7fb8'), horDay: new THREE.Color('#bcd3e6'),
  zenNight: new THREE.Color('#050a14'), horNight: new THREE.Color('#142033'),
  greyDay: new THREE.Color('#9aa4ad'), greyNight: new THREE.Color('#121820'),
  duskA: new THREE.Color('#f29a6b'), duskB: new THREE.Color('#e87a8a'),
  sunLow: new THREE.Color('#ff7430'), sunHigh: new THREE.Color('#fff4dc'),
  cloudWarm: new THREE.Color('#ffc59e'), cloudGrey: new THREE.Color('#8e979f'),
  cloudDark: new THREE.Color('#5d646b'), cloudNight: new THREE.Color('#222c42'),
  seaDayL: new THREE.Color('#ffffff'), seaDayS: new THREE.Color('#aebed2'),
  seaDuskL: new THREE.Color('#ffc09a'), seaDuskS: new THREE.Color('#b57a92'),
  seaNightL: new THREE.Color('#3f5276'), seaNightS: new THREE.Color('#16223a'),
  seaGrey: new THREE.Color('#c4ccd4'),
};

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// ---- cheap CPU value noise (periodic lattice of 256 -> drift can wrap forever) ----
function hash2(x, y, seed) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const x0 = xi & 255, x1 = (xi + 1) & 255, y0 = yi & 255, y1 = (yi + 1) & 255;
  const a = hash2(x0, y0, seed), b = hash2(x1, y0, seed), c = hash2(x0, y1, seed), d = hash2(x1, y1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

// ======================================================================================
// Sky dome shader
// ======================================================================================
const DOME_VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = position;                                   // dome is never rotated -> object dir == world dir
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_Position.z = gl_Position.w * 0.99999;           // always at the far plane
  }
`;

const DOME_FRAG = /* glsl */`
  uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uFogColor;
  uniform vec3 uSunDir; uniform vec3 uMoonDir; uniform vec3 uSunCol;
  uniform vec3 uDuskA; uniform vec3 uDuskB;
  uniform float uDuskK; uniform float uOvercast; uniform float uFog;
  uniform float uSunVis; uniform float uMoonVis; uniform float uStarAmt; uniform float uTime;
  varying vec3 vDir;
  #include <common>
  #include <dithering_pars_fragment>

  // Hash without sine (Dave Hoskins)
  float hash31(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
  vec2 hash32(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xx + p.yz) * p.zy); }

  // Sparse procedural stars: project the direction on the dominant cube face, one hashed star per cell.
  vec3 stars(vec3 d) {
    vec3 a = abs(d);
    vec2 uv; float face;
    if (a.x >= a.y && a.x >= a.z) { uv = d.yz / a.x; face = d.x > 0.0 ? 0.0 : 1.0; }
    else if (a.y >= a.z)          { uv = d.xz / a.y; face = d.y > 0.0 ? 2.0 : 3.0; }
    else                          { uv = d.xy / a.z; face = d.z > 0.0 ? 4.0 : 5.0; }
    vec2 g = uv * 70.0;
    vec3 key = vec3(floor(g), face);
    if (hash31(key) > 0.028) return vec3(0.0);                   // ~2.8% of cells hold a star
    vec2 pr = hash32(key + 17.0);
    float b = hash31(key + 5.0);                                 // brightness: few bright, many faint
    vec2 c = 0.3 + 0.4 * pr;                                     // keep the glow inside its cell
    float s = 1.0 - smoothstep(0.0, 0.09 + 0.16 * b, length(fract(g) - c));
    float tw = 0.78 + 0.22 * sin(uTime * (1.5 + 4.0 * pr.x) + b * 60.0);   // twinkle
    return mix(vec3(0.65, 0.78, 1.0), vec3(1.0, 0.88, 0.7), pr.y) * (s * s) * (0.4 + 1.1 * b * b) * tw;
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;

    // 1. vertical gradient horizon -> zenith (uHorizon is already mixed with the fog colour)
    vec3 col = mix(uHorizon, uZenith, smoothstep(0.0, 1.0, pow(max(h, 0.0), 0.45)));

    // 2. dusk / dawn band: strongest around the sun's azimuth, a faint belt all around
    vec2 saz = normalize(uSunDir.xz + vec2(1e-5));
    vec2 daz = normalize(d.xz + vec2(1e-5));
    float azd = dot(saz, daz) * 0.5 + 0.5;                       // 1 toward the sun's azimuth
    float hh = max(h, 0.0);
    float glow = (0.18 + 0.82 * pow(max(azd, 0.0), 3.0)) * exp(-hh * 5.5);
    vec3 duskCol = mix(uDuskA, uDuskB, clamp(hh * 2.2 + (1.0 - azd) * 0.55, 0.0, 1.0));
    col = mix(col, duskCol, clamp(glow * uDuskK * 0.9, 0.0, 1.0));

    // 3. horizon haze converges to the exact scene fog colour (and below the horizon IS the fog colour)
    float haze = 1.0 - smoothstep(0.0, 0.05 + 0.30 * uFog, h);
    col = mix(col, uFogColor, haze);

    // 4. sun: sharp disc + mie-like halos; disc hidden by overcast, a faint diffuse glow survives
    float sd = max(dot(d, uSunDir), 0.0);
    float clearK = 1.0 - uOvercast;
    float sunStr = uSunVis * smoothstep(-0.02, 0.03, h) * (1.0 - 0.9 * uFog);
    float disc = smoothstep(0.99905, 0.99935, sd) * clearK * clearK;
    float halo = (pow(sd, 700.0) + 0.35 * pow(sd, 60.0)) * clearK + 0.12 * pow(sd, 8.0) * (0.5 + 0.5 * clearK);
    col = mix(col, uSunCol, clamp(disc * sunStr, 0.0, 1.0));
    col += uSunCol * halo * sunStr;

    // 5. moon: small pale disc + faint glow, night / clear only
    float md = max(dot(d, uMoonDir), 0.0);
    float moonStr = uMoonVis * smoothstep(-0.02, 0.04, h) * clearK * (1.0 - 0.8 * uFog);
    vec3 moonCol = vec3(0.66, 0.73, 0.86);
    col = mix(col, moonCol, smoothstep(0.99940, 0.99955, md) * moonStr);
    col += moonCol * (0.22 * pow(md, 220.0) + 0.06 * pow(md, 30.0)) * moonStr;

    // 6. stars (only above the horizon, killed by day / overcast / fog)
    col += stars(d) * uStarAmt * smoothstep(0.02, 0.18, h) * (1.0 - haze);

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <dithering_fragment>
  }
`;

// ======================================================================================
// Cloud sea (云海) shader
// ======================================================================================
const SEA_VERT = /* glsl */`
  varying vec3 vWorld;
  #include <fog_pars_vertex>
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const SEA_FRAG = /* glsl */`
  #ifndef OCTAVES
  #define OCTAVES 3
  #endif
  uniform vec3 uLight; uniform vec3 uShade; uniform vec3 uLightDir; uniform vec2 uOffset;
  uniform float uOpacity; uniform float uTime; uniform float uSeaY; uniform float uScale;
  uniform float uSeed; uniform float uShadeK; uniform float uRadius;
  varying vec3 vWorld;
  #include <fog_pars_fragment>

  const mat2 ROT = mat2(1.6, 1.2, -1.2, 1.6);
  float hash21(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
               mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  // 2-octave fbm (cheap; used for domain warp + sun-offset shading probe)
  float fbmLow(vec2 p) { return (0.5 * vnoise(p) + 0.25 * vnoise(ROT * p)) / 0.75; }
  // OCTAVES-octave fbm; 'low' returns the first two octaves of the same sum
  float fbm(vec2 p, out float low) {
    float a = 0.5, s = 0.0, n = 0.0; low = 0.0;
    for (int i = 0; i < OCTAVES; i++) {
      s += a * vnoise(p); n += a;
      if (i == 1) low = s / n;
      p = ROT * p; a *= 0.5;
    }
    return s / n;
  }

  void main() {
    // distance fades: far edge of the plane, and "near the camera" when the viewer sinks below the sea
    float dist = length(vWorld.xz - cameraPosition.xz);
    float radial = 1.0 - smoothstep(uRadius * 0.55, uRadius * 0.97, dist);
    float below = clamp((uSeaY + 4.0 - cameraPosition.y) / 16.0, 0.0, 1.0);
    float nearFade = mix(1.0, smoothstep(0.0, 1.0, (dist - below * 260.0) / 140.0), below);
    float vis = uOpacity * radial * nearFade;
    if (vis < 0.003) discard;

    // billowy coverage: domain-warped fbm in world space (stable while the plane follows the player)
    vec2 p = (vWorld.xz - uOffset) * uScale + uSeed;
    float w = fbmLow(p * 0.55 + vec2(uTime * 0.004, -uTime * 0.003));
    vec2 q = p + (w - 0.5) * vec2(1.8, -1.4);
    float low;
    float n = fbm(q, low);
    float cov = smoothstep(0.30, 0.52, n);

    // fake top lighting: slope of the low-frequency "height" toward the light
    float lowS = fbmLow(q + uLightDir.xz * 0.15);
    float lit = clamp(0.6 + (low - lowS) * uShadeK, 0.0, 1.0);
    float thick = smoothstep(0.42, 0.72, n);
    vec3 col = mix(uShade, uLight, clamp(lit * (0.5 + 0.5 * thick) + 0.1 + 0.2 * thick, 0.0, 1.0));
    if (!gl_FrontFacing) col *= vec3(0.55, 0.60, 0.70);          // underside seen from the valley

    gl_FragColor = vec4(col, cov * vis);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

// ======================================================================================
export class Sky {
  constructor(scene, { quality = 'mid' } = {}) {
    this.scene = scene;
    this._tmpV = new THREE.Vector3();
    this._tmpA = new THREE.Color();
    this._tmpB = new THREE.Color();
    this._lightDir = new THREE.Vector3();
    this._m4 = new THREE.Matrix4();

    this._buildDome();
    this._seaGeo = new THREE.PlaneGeometry(SEA_SIZE, SEA_SIZE);
    this._seaGeo.rotateX(-Math.PI / 2);
    this.seaLayers = [this._makeSeaLayer(0, 1.0, 0, 1.0), this._makeSeaLayer(1.5, 1.7, 41.7, 0.55)];

    // cloud state (drift is accumulated in doubles; mesh offset carries the sub-layout motion)
    this.clouds = null;
    this._cloudMat = null;
    this._offsets = null;
    this._driftX = 0; this._driftZ = 0;
    this._cloudY = null;
    this._layoutTimer = 1; this._layoutKey = '';
    this._layoutDrift = [0, 0]; this._layoutY = 0;

    this.quality = null;
    this.setQuality(quality);
  }

  // ---------------------------------------------------------------------------- quality
  setQuality(q) {
    const cfg = QUALITY[q] || QUALITY.mid;
    this.quality = QUALITY[q] ? q : 'mid';
    this._cfg = cfg;

    // cloud sea: octave count (shader define) and optional second layer
    this.seaLayers.forEach((L, i) => {
      L.mat.defines.OCTAVES = cfg.octaves;
      L.mat.needsUpdate = true;
      L.enabled = i < cfg.seaLayers;
      L.mesh.visible = L.enabled && L.mesh.visible;
    });

    // voxel clouds: rebuild with the new instance count / radius (none for 'low')
    this._disposeClouds();
    if (cfg.clouds > 0) {
      const geo = new THREE.BoxGeometry(1, 1, 1);
      this._cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
      const mesh = new THREE.InstancedMesh(geo, this._cloudMat, cfg.clouds);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.renderOrder = 0;
      this.scene.add(mesh);
      this.clouds = mesh;
      this._buildOffsets(cfg.cloudRadius / CLOUD_PITCHES[0]);
      this._layoutKey = ''; // force re-layout on next update
    }
  }

  // All (di, dj) cell offsets within `ring` cells, sorted by distance (nearest cloud cells win the instance budget).
  _buildOffsets(ring) {
    const r = Math.ceil(ring), list = [];
    for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
      const d = Math.hypot(i, j);
      if (d <= ring) list.push([i, j, d]);
    }
    list.sort((a, b) => a[2] - b[2]);
    this._offsets = {
      n: list.length,
      di: Int16Array.from(list, (e) => e[0]),
      dj: Int16Array.from(list, (e) => e[1]),
      d: Float32Array.from(list, (e) => e[2]),
    };
  }

  // ---------------------------------------------------------------------------- builders
  _buildDome() {
    const geo = new THREE.SphereGeometry(DOME_RADIUS, 32, 16);
    const mat = new THREE.ShaderMaterial({
      vertexShader: DOME_VERT,
      fragmentShader: DOME_FRAG,
      uniforms: {
        uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
        uFogColor: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
        uSunCol: { value: new THREE.Color() },
        uDuskA: { value: C.duskA.clone() }, uDuskB: { value: C.duskB.clone() },
        uDuskK: { value: 0 }, uOvercast: { value: 0 }, uFog: { value: 0 },
        uSunVis: { value: 1 }, uMoonVis: { value: 0 }, uStarAmt: { value: 0 }, uTime: { value: 0 },
      },
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: false,   // horizon must equal the (post-tonemap mixed) fog colour exactly
      dithering: true,     // hides 8-bit banding in the dark gradients
    });
    this.dome = new THREE.Mesh(geo, mat);
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    this.scene.add(this.dome);
  }

  _makeSeaLayer(yOff, scrollK, seed, opacityK) {
    const mat = new THREE.ShaderMaterial({
      vertexShader: SEA_VERT,
      fragmentShader: SEA_FRAG,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uLight: { value: new THREE.Color() }, uShade: { value: new THREE.Color() },
        uLightDir: { value: new THREE.Vector3(0, 1, 0) }, uOffset: { value: new THREE.Vector2() },
        uOpacity: { value: 0 }, uTime: { value: 0 }, uSeaY: { value: 40 },
        uScale: { value: yOff ? 0.0058 : 0.0085 }, uSeed: { value: seed },
        uShadeK: { value: 5 }, uRadius: { value: SEA_SIZE * 0.5 },
      }]),
      defines: { OCTAVES: 3 },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    });
    const mesh = new THREE.Mesh(this._seaGeo, mat);
    mesh.renderOrder = 1;
    mesh.frustumCulled = false;
    mesh.visible = false;
    this.scene.add(mesh);
    return { mesh, mat, yOff, scrollK, opacityK, offset: new THREE.Vector2(), enabled: true };
  }

  // ---------------------------------------------------------------------------- per-frame
  update(dt, s) {
    dt = Math.min(Math.max(dt, 0), 0.25);
    s.camera.getWorldPosition(this._tmpV);
    this._updateDome(s, this._tmpV);
    this._updateClouds(dt, s);
    this._updateSea(dt, s);
  }

  _updateDome(s, camPos) {
    this.dome.position.copy(camPos);
    const u = this.dome.material.uniforms;
    const dayK = clamp01(s.dayK), oc = clamp01(s.overcast), fog = clamp01(s.fog);

    // night -> day palette, flattened toward grey by overcast, thickened by fog
    const zen = u.uZenith.value.copy(C.zenNight).lerp(C.zenDay, dayK);
    const hor = u.uHorizon.value.copy(C.horNight).lerp(C.horDay, dayK);
    const grey = this._tmpA.copy(C.greyNight).lerp(C.greyDay, dayK);
    zen.lerp(grey.multiplyScalar(0.93), oc * 0.9);          // slightly darker grey overhead
    hor.lerp(grey.multiplyScalar(1 / 0.93), oc * 0.95);
    zen.lerp(s.fogColor, 0.85 * fog);                       // dense fog = whiteout overhead too
    hor.lerp(s.fogColor, 0.5 + 0.5 * fog);                  // horizon band -> fog colour
    u.uFogColor.value.copy(s.fogColor);

    u.uSunDir.value.copy(s.sunDir);
    u.uMoonDir.value.copy(s.moonDir);
    u.uSunCol.value.copy(C.sunLow).lerp(C.sunHigh, smooth(0.0, 0.35, s.sunDir.y)); // redder near the horizon
    u.uSunVis.value = smooth(-0.05, 0.02, s.sunDir.y);
    u.uMoonVis.value = 1 - smooth(0.25, 0.85, dayK);
    u.uStarAmt.value = (1 - dayK) * (1 - oc) * (1 - fog);
    u.uDuskK.value = clamp01(s.duskK) * (1 - 0.7 * oc);
    u.uOvercast.value = oc;
    u.uFog.value = fog;
    u.uTime.value = s.time % 3600;
  }

  _updateClouds(dt, s) {
    const mesh = this.clouds;
    const wind = s.wind || { x: 0, z: 0 };
    // the cloud field streams past with the wind (drift in doubles, noise lattice wraps by itself)
    this._driftX += wind.x * dt * 0.6;
    this._driftZ += wind.z * dt * 0.6;
    if (!mesh) return;

    const center = s.center;
    const dayK = clamp01(s.dayK), oc = clamp01(s.overcast);
    // cloud base height follows the player's altitude, smoothed so layout steps never pop
    this._cloudY = this._cloudY === null ? center.y : this._cloudY + (center.y - this._cloudY) * Math.min(1, dt * 0.5);

    // tint: warm at dusk, grey when overcast, darker in precipitation, blue-dark at night
    const col = this._cloudMat.color.set(0xffffff);
    col.lerp(C.cloudWarm, clamp01(s.duskK) * 0.75 * (1 - oc));
    col.lerp(C.cloudGrey, oc * 0.8);
    col.lerp(C.cloudDark, clamp01(s.precip) * 0.6);
    const night = 1 - smooth(0.0, 0.45, dayK);
    col.lerp(C.cloudNight, night);
    // emissive lift keeps cloud undersides from going charcoal (day only)
    this._cloudMat.emissive.copy(col).multiplyScalar(0.3 * (1 - night));

    // re-layout only when the quantised overcast level or the player's cell changes, or every ~0.5 s
    const pitchIdx = Math.round(oc * 3), pitch = CLOUD_PITCHES[pitchIdx];
    const ci = Math.floor((center.x - this._driftX) / pitch), cj = Math.floor((center.z - this._driftZ) / pitch);
    this._layoutTimer += dt;
    const key = `${pitchIdx},${ci},${cj}`;
    if (key !== this._layoutKey || this._layoutTimer >= 0.5) {
      this._layoutKey = key;
      this._layoutTimer = 0;
      this._layout(center, oc, pitch, ci, cj);
    }
    // between layouts the whole mesh carries the wind drift and the height smoothing
    mesh.position.set(this._driftX - this._layoutDrift[0], this._cloudY - this._layoutY, this._driftZ - this._layoutDrift[1]);
  }

  // Fill the instance buffer with flattened boxes for the active cells around the player.
  _layout(center, oc, pitch, ci, cj) {
    const mesh = this.clouds, off = this._offsets, m = this._m4;
    const max = this._cfg.clouds, R = this._cfg.cloudRadius, maxRing = R / pitch;
    const thr = 0.66 - 0.44 * oc;              // coverage threshold: sparse puffs -> dense deck
    const baseY = this._cloudY, dx = this._driftX, dz = this._driftZ;
    const idxFadeFrom = max * 0.88;
    let n = 0;
    for (let k = 0; k < off.n && n < max; k++) {
      if (off.d[k] > maxRing) break;
      const i = ci + off.di[k], j = cj + off.dj[k];
      const fx = i * pitch, fz = j * pitch;                     // position in the drifting field
      const f = 0.62 * vnoise(fx / CLOUD_WL1, fz / CLOUD_WL1, 1) + 0.38 * vnoise(fx / CLOUD_WL2, fz / CLOUD_WL2, 2);
      if (f < thr) continue;
      const r1 = hash2(i, j, 11), r2 = hash2(i, j, 12), r3 = hash2(i, j, 13), r4 = hash2(i, j, 14);
      const x = fx + dx + (r3 - 0.5) * pitch * 0.5, z = fz + dz + (r4 - 0.5) * pitch * 0.5;
      // shrink toward the radius edge / the end of the instance budget so clouds never pop in
      const dist = Math.hypot(x - center.x, z - center.z);
      let edge = 1 - smooth(R * 0.82, R, dist);
      if (n > idxFadeFrom) edge *= 1 - (n - idxFadeFrom) / (max - idxFadeFrom);
      if (edge < 0.03) continue;
      const grow = smooth(thr, thr + 0.06, f);                  // clouds swell as coverage rises
      const sc = (0.65 + 0.35 * grow) * edge;
      const w = pitch * (0.75 + 0.55 * r1 + 0.25 * oc) * sc;
      const d = pitch * (0.75 + 0.55 * r2 + 0.25 * oc) * sc;
      const h = (2 + 1.5 * r1 + 0.8 * grow + 0.7 * oc) * (0.6 + 0.4 * grow) * edge;
      const ny = vnoise(fx / 220, fz / 220, 3);                 // slowly varying altitude
      const y = baseY + 55 + 25 * clamp01((ny - 0.2) / 0.6) + (r2 - 0.5) * 3;
      m.makeScale(w, h, d).setPosition(x, y, z);
      mesh.setMatrixAt(n++, m);
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    this._layoutDrift[0] = dx; this._layoutDrift[1] = dz; this._layoutY = baseY;
  }

  _updateSea(dt, s) {
    const wind = s.wind || { x: 0, z: 0 };
    const sea = clamp01(s.cloudSea), on = sea > 0.01;
    const dayK = clamp01(s.dayK), duskK = clamp01(s.duskK), oc = clamp01(s.overcast);

    // lighting direction: sun by day, moon by night (smooth blend, no flip at twilight)
    const wSun = smooth(-0.15, 0.1, s.sunDir.y);
    const ld = this._lightDir.copy(s.sunDir).multiplyScalar(wSun).addScaledVector(s.moonDir, (1 - wSun) * 0.5);
    ld.normalize();
    const relief = 7 + 8 * (1 - Math.abs(ld.y)); // low light -> stronger relief

    // palette: night -> day, pink-gold at dusk, a little greyer when overcast
    const light = this._tmpA.copy(C.seaNightL).lerp(C.seaDayL, dayK).lerp(C.seaDuskL, duskK * 0.85).lerp(C.seaGrey, oc * 0.3);
    const shade = this._tmpB.copy(C.seaNightS).lerp(C.seaDayS, dayK).lerp(C.seaDuskS, duskK * 0.85);
    light.multiplyScalar(1.3);                   // headroom so day-time tops read as bright white after ACES

    for (const L of this.seaLayers) {
      const show = on && L.enabled;
      L.mesh.visible = show;
      if (!show) continue;
      L.offset.x += wind.x * dt * 0.35 * L.scrollK;
      L.offset.y += wind.z * dt * 0.35 * L.scrollK;
      L.mesh.position.set(s.center.x, s.cloudSeaY + L.yOff, s.center.z);
      const u = L.mat.uniforms;
      u.uOffset.value.copy(L.offset);
      u.uOpacity.value = sea * 0.85 * L.opacityK;
      u.uTime.value = (s.time * L.scrollK) % 3600;
      u.uSeaY.value = s.cloudSeaY + L.yOff;
      u.uLight.value.copy(light);
      u.uShade.value.copy(shade);
      u.uLightDir.value.copy(ld);
      u.uShadeK.value = relief;
    }
  }

  // ---------------------------------------------------------------------------- cleanup
  _disposeClouds() {
    if (!this.clouds) return;
    this.scene.remove(this.clouds);
    this.clouds.geometry.dispose();
    this._cloudMat.dispose();
    this.clouds.dispose();
    this.clouds = null;
    this._cloudMat = null;
  }

  dispose() {
    this._disposeClouds();
    this.scene.remove(this.dome);
    this.dome.geometry.dispose();
    this.dome.material.dispose();
    for (const L of this.seaLayers) {
      this.scene.remove(L.mesh);
      L.mat.dispose();
    }
    this._seaGeo.dispose();
  }
}
