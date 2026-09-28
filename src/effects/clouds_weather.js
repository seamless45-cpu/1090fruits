import * as THREE from 'three';

/**
 * 3D 1090 Fruits - ULTRA-DYNAMIC CLOUD & WEATHER SYSTEM (Round 5)
 *
 * Reworked from "basic particles + cones" into physically-motivated,
 * procedurally-textured weather:
 *
 *  PRE-COMPUTED TEXTURES (generated ONCE at module load, "pre-method"):
 *   - FBM fractal-noise cloud puffs (real fluffy silhouette, not radial dots)
 *   - Vortex disc texture (tornado funnel slices with spiral holes)
 *   - Radial dust texture (ground dust skirts & microburst donut)
 *   - Vertical streak noise (rain curtain sheets)
 *
 *  RAIN:   GPU-simulated Points drops (one draw call per shaft) - each drop
 *          falls/wraps/drifts entirely in the vertex shader from uTime
 *          (zero CPU per frame), plus 5 scrolling rain-curtain sheets and
 *          pooled ground splash rings.
 *  TORNADO: 16 billboard funnel slices with per-slice TEXTURE ROTATION
 *          (differential rotation, faster near the ground), an hourglass
 *          kink, top-lag bend, dark mesocyclone tint, orbiting debris and
 *          a ground dust skirt. Grows in, dissipates out.
 *  MICROBURST: descending anvil core -> impact -> expanding dust donut,
 *          radial ground-scraping wind streaks, mega shockwave rings and a
 *          dense downburst rain shaft.
 *  CLOUDS: 3-layer (base / mid / anvil) puff clusters with per-puff drift,
 *          stage evolution cumulus -> cumulonimbus -> supercell, rotating
 *          mesocyclone + in-cloud lightning flashes.
 *
 *  PERFORMANCE "pre-methods":
 *   - ALL buffers (Float32Array) allocated up-front, zero per-frame allocs
 *   - module-level scratch vectors (no `new Vector3` in hot loops)
 *   - shared geometries, pooled splash rings, capped cloud count
 */

// =====================================================================
// PRE-COMPUTED TEXTURES (module scope - built once, shared by all systems)
// =====================================================================

function valueNoise2D(size, octaves, seed = 7) {
  // Value noise with bilinear interpolation + FBM octaves -> Float32Array 0..1
  const grid = new Float32Array((size + 1) * (size + 1));
  let s = seed;
  const rand = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
  for (let i = 0; i < grid.length; i++) grid[i] = rand();

  const sample = (x, y) => {
    const xi = x | 0, yi = y | 0;
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = grid[yi * (size + 1) + xi];
    const b = grid[yi * (size + 1) + xi + 1];
    const c = grid[(yi + 1) * (size + 1) + xi];
    const d = grid[(yi + 1) * (size + 1) + xi + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };

  const out = new Float32Array(size * size);
  const n = size; // noise grid dimension
  let amp = 1, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        // Wrap octave coordinates back into the noise grid
        const gx = ((x * freq) / size * n) % n;
        const gy = ((y * freq) / size * n) % n;
        out[y * size + x] += sample(gx, gy) * amp;
      }
    }
    norm += amp;
    amp *= 0.55;
    freq *= 2.03;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

function makeCloudPuffTexture() {
  // Fractal puffs: noise-modulated falloff = irregular cottony edge
  const size = 160;
  const noise = valueNoise2D(64, 5, 11);
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);
  const c = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - c) / c, dy = (y - c) / c;
      const d = Math.sqrt(dx * dx + dy * dy);
      const n = noise[(y / size * 64 | 0) * 64 + (x / size * 64 | 0)];
      // Edge pushed in/out by fractal noise; brighter core with slight top light
      const edge = d - (n - 0.5) * 0.55;
      let a = Math.max(0, 1 - edge / 0.92);
      a = a * a * (3 - 2 * a); // smoothstep
      const light = 0.82 + 0.18 * Math.max(0, 1 - dy * 1.4);
      const v = Math.floor(255 * a * light);
      const i = (y * size + x) * 4;
      img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = Math.min(255, v + 8);
      img.data[i + 3] = Math.floor(255 * a);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeVortexTexture() {
  // Dark swirling disc with spiral "holes" - used for tornado funnel slices
  const size = 200;
  const noise = valueNoise2D(64, 5, 29);
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);
  const c = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - c) / c, dy = (y - c) / c;
      const d = Math.sqrt(dx * dx + dy * dy);
      const ang = Math.atan2(dy, dx);
      // Spiral banding: radius-modulated angle => rotating spiral arms
      const n = noise[(y / size * 64 | 0) * 64 + (x / size * 64 | 0)];
      const spiral = 0.5 + 0.5 * Math.sin(ang * 3 + d * 14);
      let a = Math.max(0, 1 - d / 0.95);
      a = a * a * (3 - 2 * a);
      const density = a * (0.35 + 0.65 * (spiral * 0.55 + n * 0.45));
      const i = (y * size + x) * 4;
      img.data[i] = Math.floor(90 * density + 40 * a);
      img.data[i + 1] = Math.floor(98 * density + 44 * a);
      img.data[i + 2] = Math.floor(112 * density + 52 * a);
      img.data[i + 3] = Math.floor(235 * density);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeDustTexture() {
  // Radial ground dust with directional grain
  const size = 200;
  const noise = valueNoise2D(64, 4, 53);
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);
  const c = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - c) / c, dy = (y - c) / c;
      const d = Math.sqrt(dx * dx + dy * dy);
      const n = noise[(y / size * 64 | 0) * 64 + (x / size * 64 | 0)];
      let a = Math.max(0, 1 - d / 0.98);
      a = Math.pow(a, 1.7);
      const density = a * (0.4 + 0.6 * n);
      const i = (y * size + x) * 4;
      img.data[i] = Math.floor(168 * density + 30 * a);
      img.data[i + 1] = Math.floor(150 * density + 26 * a);
      img.data[i + 2] = Math.floor(118 * density + 20 * a);
      img.data[i + 3] = Math.floor(200 * density);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeCurtainTexture() {
  // Vertical streak noise for rain curtain sheets
  const size = 128;
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Streaks: strong vertical continuity, sparse bright columns
      const col = (Math.sin(x * 12.9898) * 43758.5453) % 1;
      const bright = Math.abs(col) > 0.82 ? 0.7 : 0.25;
      const flicker = 0.75 + 0.25 * Math.sin(y * 0.35 + x * 3.7);
      const v = Math.floor(255 * bright * flicker);
      const i = (y * size + x) * 4;
      img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeRainStreakTexture() {
  // Single raindrop: narrow vertical streak with soft ends (for the
  // precipitation Points). Rendered into a 64x64 canvas with alpha so
  // each Point reads as one visible falling drop, not a square.
  const size = 64;
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);
  const halfW = 2.6; // streak half-width in px
  for (let y = 0; y < size; y++) {
    // Vertical envelope: soft head/tail, bright mid-body
    const t = y / (size - 1);
    const env = Math.sin(t * Math.PI); // 0 at both ends
    const head = t < 0.28 ? 1.0 : 0.72; // slightly brighter head
    for (let x = 0; x < size; x++) {
      const d = Math.abs(x - (size - 1) / 2);
      const across = d < halfW ? 1.0 : (d < halfW + 1.4 ? (halfW + 1.4 - d) / 1.4 : 0);
      const a = Math.floor(255 * env * head * across);
      const i = (y * size + x) * 4;
      img.data[i] = 214; img.data[i + 1] = 230; img.data[i + 2] = 255; img.data[i + 3] = a;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Built once per page load (shared across managers)
let WEATHER_TEX = null;
export function precomputeWeatherTextures() {
  if (WEATHER_TEX) return WEATHER_TEX;
  WEATHER_TEX = {
    puff: makeCloudPuffTexture(),
    vortex: makeVortexTexture(),
    dust: makeDustTexture(),
    curtain: makeCurtainTexture(),
    rainStreak: makeRainStreakTexture(),
  };
  return WEATHER_TEX;
}

// =====================================================================
// Module-level scratch objects (pre-allocated: zero per-frame allocation)
// =====================================================================
const _v3a = new THREE.Vector3();
const _v3b = new THREE.Vector3();

// =====================================================================
// RAINSHAFT - GPU precipitation + curtain sheets + splash rings + mist
// =====================================================================
const MIST_PER_SHAFT = 5;

class RainShaft {
  // ------------------------------------------------------------------
  // GPU PRECIPITATION (Rework v4):
  // The old shaft simulated every drop on the CPU (fall + streak mirror
  // + wrap = ~10k float ops AND two full buffer uploads per shaft per
  // frame; max-storm scenes run 14-26 shafts simultaneously). The rework
  // moves the entire simulation into the vertex shader: drops are seeded
  // once at spawn and fall/wrap/drift purely from a uTime uniform.
  // Per-frame CPU cost: 4 uniform writes. Buffer uploads: ZERO.
  // ------------------------------------------------------------------
  constructor(manager, centerPos, width, height, particleCount, opts = null) {
    const tex = manager.tex;
    const count = particleCount;
    this.scene = manager.scene;
    this.center = centerPos.clone();
    this.width = width;
    this.height = height;
    this.count = count;
    this.elapsed = 0;
    this.simTime = Math.random() * 40; // desync shafts so they don't pulse together
    this.duration = opts && opts.duration != null ? opts.duration : 12.0;
    // Optional movement so rain can trail a moving squall cell
    // or follow a hurricane eyewall orbit.
    this.vel = opts && opts.vel ? opts.vel.clone() : null;
    this.orbit = opts && opts.orbit ? opts.orbit : null;
    this.windX = (Math.random() - 0.5) * 9;
    this.windZ = (Math.random() - 0.5) * 9;
    this._env = 0;
    this._splashTimer = 0;

    // Seed attributes (written ONCE at spawn - never re-uploaded):
    //   position = spawn offset on a unit disc scaled to the shaft radius
    //   aSpeed   = fall speed m/s (58-100, as the old CPU sim)
    //   aSeed    = per-drop phase offset so drops don't fall in lockstep
    const offsets = new Float32Array(count * 3);
    const speeds = new Float32Array(count);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * (width * 0.5);
      offsets[i * 3] = Math.cos(a) * r;
      offsets[i * 3 + 1] = 0;
      offsets[i * 3 + 2] = Math.sin(a) * r;
      speeds[i] = 58 + Math.random() * 42;
      seeds[i] = Math.random();
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(offsets, 3));
    geo.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, height * 0.5, 0), width + height);

    this.dropMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTime: { value: 0 },
        uCenter: { value: this.center.clone() },
        uHeight: { value: height },
        uWind: { value: new THREE.Vector2(this.windX, this.windZ) },
        uOpacity: { value: 0.6 },
        uMap: { value: tex.rainStreak },
      },
      vertexShader: /* glsl */`
        attribute float aSpeed;
        attribute float aSeed;
        uniform float uTime;
        uniform vec3 uCenter;
        uniform float uHeight;
        uniform vec2 uWind;
        varying float vFade;
        void main() {
          // Fall from the cloud base to the ground, then wrap (mod)
          float cycle = uHeight / aSpeed;
          float t = mod(uTime + aSeed * cycle, cycle);
          vec3 p;
          p.x = position.x + uWind.x * t * 0.35;       // slanted drift
          p.z = position.z + uWind.y * t * 0.35;
          p.y = uHeight * 0.92 - aSpeed * t;           // base -> ground
          p += uCenter;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = 4.5 * (300.0 / max(1.0, -mv.z));
          // Fade out right at the ground and right at the cloud base
          vFade = smoothstep(0.0, 6.0, p.y) * smoothstep(uHeight * 0.95, uHeight * 0.8, p.y);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D uMap;
        uniform float uOpacity;
        varying float vFade;
        void main() {
          vec4 tex = texture2D(uMap, gl_PointCoord);
          float a = tex.a * uOpacity * vFade;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vec3(0.86, 0.93, 1.0), a);
        }`,
    });
    this.dropGeo = geo;
    this.drops = new THREE.Points(geo, this.dropMat);
    this.drops.frustumCulled = false;
    this.drops.renderOrder = 1;
    this.scene.add(this.drops);

    // Compatibility alias for systems that tinted the old LineBasicMaterial
    this.mat = this.dropMat;

    // Rain curtain sheets (scrolling streak texture) - the visible "shaft"
    this.curtainGroup = new THREE.Group();
    this.curtainGroup.position.set(centerPos.x, height * 0.5, centerPos.z);
    this.curtainTex = tex.curtain.clone();
    this.curtainTex.needsUpdate = true;
    this.curtainTex.wrapS = THREE.RepeatWrapping;
    this.curtainTex.wrapT = THREE.RepeatWrapping;
    this.curtainTex.repeat.set(5, 6);
    const sheetW = width * 0.85;
    const sheetH = height * 0.92;
    this.curtainMat = new THREE.MeshBasicMaterial({
      map: this.curtainTex,
      color: 0xaac9e6,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
      depthWrite: false,
      fog: false,
    });
    // The 5 curtain sheets are merged into ONE mesh (5 quads, baked corners).
    const sheetGeo = new THREE.PlaneGeometry(sheetW, sheetH);
    const base = sheetGeo.attributes.position.array; // 4 corners of the XY quad
    const merged = new THREE.BufferGeometry();
    const SHEETS = 5;
    const mPos = new Float32Array(SHEETS * base.length);
    const mUv = new Float32Array(SHEETS * 8);
    const mIdx = [];
    const uv0 = sheetGeo.attributes.uv.array;
    const m4 = new THREE.Matrix4();
    const yOff = -height * 0.02;
    for (let i = 0; i < SHEETS; i++) {
      const theta = (i / SHEETS) * Math.PI;
      m4.makeRotationY(theta);
      const v = new THREE.Vector3();
      for (let c = 0; c < 4; c++) {
        v.set(base[c * 3], base[c * 3 + 1] + yOff, base[c * 3 + 2]).applyMatrix4(m4);
        mPos[i * base.length + c * 3 + 0] = v.x;
        mPos[i * base.length + c * 3 + 1] = v.y;
        mPos[i * base.length + c * 3 + 2] = v.z;
      }
      mUv.set(uv0, i * 8);
      const o = i * 4;
      mIdx.push(o, o + 1, o + 2, o, o + 2, o + 3);
    }
    merged.setAttribute('position', new THREE.BufferAttribute(mPos, 3));
    merged.setAttribute('uv', new THREE.BufferAttribute(mUv, 2));
    merged.setIndex(mIdx);
    this.curtainMesh = new THREE.Mesh(merged, this.curtainMat);
    this.curtainGroup.add(this.curtainMesh);
    sheetGeo.dispose();
    this.scene.add(this.curtainGroup);

    // Ground mist: ONE static Points draw call (opacity animates only)
    const MIST = MIST_PER_SHAFT;
    const mistPos = new Float32Array(MIST * 3);
    for (let i = 0; i < MIST; i++) {
      const a = (i / MIST) * Math.PI * 2 + Math.random();
      const r = Math.random() * width * 0.4;
      mistPos[i * 3] = Math.cos(a) * r;
      mistPos[i * 3 + 1] = 2.5 + Math.random() * 3;
      mistPos[i * 3 + 2] = Math.sin(a) * r;
    }
    this.mistGeo = new THREE.BufferGeometry();
    this.mistGeo.setAttribute('position', new THREE.BufferAttribute(mistPos, 3));
    this.mistMat = new THREE.PointsMaterial({
      map: tex.puff, color: 0xbcd2e8, transparent: true, opacity: 0.14,
      depthWrite: false, size: width * 0.4, sizeAttenuation: true, fog: false,
    });
    this.mist = new THREE.Points(this.mistGeo, this.mistMat);
    this.mist.position.set(centerPos.x, 0, centerPos.z);
    this.mist.frustumCulled = false;
    this.scene.add(this.mist);

    // Shared splash ring pool (from manager)
    this.splashPool = manager.splashPool;
  }

  /** External intensity override (e.g. MicroBurst inner rain fade). */
  setIntensity(x) {
    this._intensity = Math.max(0, Math.min(1, x));
  }

  update(dt) {
    this.elapsed += dt;
    this.simTime += dt;
    const lifeT = this.elapsed / this.duration;
    const env = Math.min(1, lifeT * 5) * Math.min(1, (1 - lifeT) * 4);
    this._env = env;
    const intensity = this._intensity != null ? this._intensity : 1.0;

    // GPU uniforms (the entire "simulation")
    this.dropMat.uniforms.uTime.value = this.simTime;
    const op = 0.6 * env * intensity;
    this.dropMat.uniforms.uOpacity.value = op;
    this.dropMat.opacity = op; // observable for HUD/tests

    // Follow a moving squall cell / hurricane orbit: translate the seed
    // space via the uCenter uniform - no buffer rewrites.
    if (this.orbit) {
      const o = this.orbit;
      this.center.x = o.center.x + Math.cos(o.angle) * o.radius;
      this.center.z = o.center.z + Math.sin(o.angle) * o.radius;
      this.dropMat.uniforms.uCenter.value.copy(this.center);
      this.curtainGroup.position.x = this.center.x;
      this.curtainGroup.position.z = this.center.z;
      this.mist.position.x = this.center.x;
      this.mist.position.z = this.center.z;
    } else if (this.vel) {
      this.center.x += this.vel.x * dt;
      this.center.z += this.vel.z * dt;
      this.dropMat.uniforms.uCenter.value.copy(this.center);
      this.curtainGroup.position.x = this.center.x;
      this.curtainGroup.position.z = this.center.z;
      this.mist.position.x = this.center.x;
      this.mist.position.z = this.center.z;
    }

    // Curtain + mist fades
    this.curtainMat.opacity = 0.3 * env * intensity;
    this.curtainTex.offset.y -= dt * 1.6; // rain scrolling down the sheets
    this.curtainGroup.rotation.y += dt * 0.15;
    this.mistMat.opacity = 0.14 * env * intensity;

    // Ground splashes: statistical emitter at the same average rate the old
    // per-drop coin-flip produced (~20/s), without tracking every drop.
    if (env > 0.05 && intensity > 0.05) {
      this._splashTimer += dt * 18 * env * intensity;
      while (this._splashTimer >= 1) {
        this._splashTimer -= 1;
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * this.width * 0.5;
        this.splashPool.spawn(this.center.x + Math.cos(a) * r, this.center.z + Math.sin(a) * r);
      }
    }
  }

  dispose() {
    this.scene.remove(this.drops);
    this.scene.remove(this.curtainGroup);
    this.dropMat.dispose();
    this.curtainMat.dispose();
    this.curtainTex.dispose();
    this.dropGeo.dispose();
    if (this.curtainMesh) this.curtainMesh.geometry.dispose();
    this.scene.remove(this.mist);
    this.mistGeo.dispose();
    this.mistMat.dispose();
  }
}

// =====================================================================
// TORNADO - 16 rotating funnel slices + kink + bend + debris + dust skirt
// =====================================================================
const TORNADO_SLICES = 16;

class Tornado {
  constructor(manager, centerPos, baseRadius, height, windSpeedMph, duration) {
    const tex = manager.tex;
    this.scene = manager.scene;
    this.center = centerPos.clone();
    this.baseRadius = baseRadius;
    this.height = height;
    this.windSpeedMph = windSpeedMph;
    this.duration = duration;
    this.elapsed = 0;
    this.seed = Math.random() * 10;
    this.intensity = 0;

    // Funnel slices: each a billboard disc with its own rotating texture
    this.group = new THREE.Group();
    this.slices = [];
    for (let i = 0; i < TORNADO_SLICES; i++) {
      const m = new THREE.SpriteMaterial({
        map: tex.vortex,
        color: 0xb9c6d4,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        fog: false,
      });
      const sp = new THREE.Sprite(m);
      this.group.add(sp);
      this.slices.push({ sp, mat: m, h: (i + 0.5) / TORNADO_SLICES });
    }
    this.scene.add(this.group);

    // Ground dust skirt (two layers, opposite rotation)
    this.dust = [];
    for (let i = 0; i < 2; i++) {
      const m = new THREE.SpriteMaterial({
        map: tex.dust, color: 0xcdb89a, transparent: true, opacity: 0.4,
        depthWrite: false, fog: false,
      });
      const sp = new THREE.Sprite(m);
      sp.position.y = 2.5 + i * 1.5;
      sp.scale.y = 0.5; // flatten the dust disc
      this.group.add(sp);
      this.dust.push({ sp, mat: m, spin: (i === 0 ? 1 : -0.7) * (0.5 + windSpeedMph / 400) });
    }

    // Orbiting debris (rocks hurled around the funnel surface)
    const dCount = 48;
    this.debrisCount = dCount;
    this.debrisPos = new Float32Array(dCount * 3); // PRE-ALLOCATED
    this.debrisData = [];
    for (let i = 0; i < dCount; i++) {
      this.debrisData.push({
        h: Math.random(),
        a: Math.random() * Math.PI * 2,
        speed: 5 + (1 - Math.random()) * 9,
        rOff: 1.15 + Math.random() * 0.5,
        up: 8 + Math.random() * 14,
      });
    }
    const dGeo = new THREE.BufferGeometry();
    const dAttr = new THREE.BufferAttribute(this.debrisPos, 3);
    dAttr.setUsage(THREE.DynamicDrawUsage);
    dGeo.setAttribute('position', dAttr);
    this.debrisMat = new THREE.PointsMaterial({
      color: 0x59626e, size: 2.2, transparent: true, opacity: 0.85,
      depthWrite: false, fog: false,
    });
    this.debris = new THREE.Points(dGeo, this.debrisMat);
    this.debris.frustumCulled = false;
    this.scene.add(this.debris);
  }

  /** Funnel radius at normalized height (0 ground -> 1 cloud base) */
  radiusAt(h) {
    // Street-wide base, wide cloud-base top, hourglass kink mid-funnel
    const profile = 0.42 + Math.pow(h, 1.35) * 3.1;
    const kink = 1 + 0.22 * Math.sin(h * 7.0 + this.elapsed * 2.1 + this.seed) * (0.25 + 0.75 * Math.sin(h * Math.PI));
    return this.baseRadius * profile * kink * this.intensity;
  }

  /** Top-lag bend: the funnel top sways behind the base (like a whip) */
  bendOffset(h, out) {
    const bend = this.intensity * this.baseRadius * 0.9;
    out.x = Math.sin(this.elapsed * 0.42 + this.seed) * bend * h * h;
    out.z = Math.cos(this.elapsed * 0.31 + this.seed * 1.7) * bend * h * h;
  }

  update(dt, enemyList) {
    this.elapsed += dt;
    const t = this.elapsed / this.duration;

    // Envelope: grow in (15%), mature, dissipate (25%)
    const fadeIn = Math.min(1, t / 0.15);
    const fadeOut = Math.min(1, (1 - t) / 0.25);
    this.intensity = Math.min(fadeIn, fadeOut) * (0.85 + 0.15 * Math.sin(this.elapsed * 3.1));
    // Slow wander of the funnel base
    this.center.x += Math.sin(this.elapsed * 0.5 + this.seed) * dt * 3.2;
    this.center.z += Math.cos(this.elapsed * 0.4 + this.seed) * dt * 3.2;

    this.group.position.set(this.center.x, 0, this.center.z);

    // Funnel slices
    for (const s of this.slices) {
      const h = s.h;
      this.bendOffset(h, _v3a);
      const r = this.radiusAt(h);
      s.sp.position.set(_v3a.x, h * this.height, _v3a.z);
      // Flatten the disc (viewed edge-on from the ground)
      s.sp.scale.set(r * 2, r * 2 * 0.42, 1);
      // Differential rotation: much faster near the ground
      s.mat.rotation += dt * (5.5 + (1 - h) * 10.5);
      // Denser mid-funnel, fading at the very top
      const density = 0.62 * (0.45 + 0.55 * Math.sin(Math.min(1, h * 1.25) * Math.PI));
      s.mat.opacity = 0.5 * this.intensity * density;
    }

    // Dust skirt
    const baseR = this.radiusAt(0.02);
    for (const d of this.dust) {
      this.bendOffset(0.02, _v3a);
      d.sp.position.x = _v3a.x;
      d.sp.position.z = _v3a.z;
      const dr = baseR * (3.4 + (this.dust.indexOf(d) === 0 ? 0 : 1.6));
      d.sp.scale.set(dr * 2, dr * 0.9, 1);
      d.mat.rotation += dt * d.spin;
      d.mat.opacity = 0.42 * this.intensity * (0.8 + 0.2 * Math.sin(this.elapsed * 5 + d.spin));
    }

    // Orbiting debris
    const dp = this.debrisPos;
    for (let i = 0; i < this.debrisCount; i++) {
      const d = this.debrisData[i];
      d.a += d.speed * dt;
      d.h += (d.up / this.height) * dt;
      if (d.h > 1) d.h = 0;
      const h = d.h;
      this.bendOffset(h, _v3a);
      const r = this.radiusAt(h) * d.rOff;
      dp[i * 3 + 0] = this.center.x + _v3a.x + Math.cos(d.a) * r;
      dp[i * 3 + 1] = h * this.height;
      dp[i * 3 + 2] = this.center.z + _v3a.z + Math.sin(d.a) * r;
    }
    this.debris.geometry.attributes.position.needsUpdate = true;
    this.debrisMat.opacity = 0.85 * this.intensity;

    // Enemy suction toward the vortex core.
    // ACCURACY + PERF: damage is applied in 0.25s ticks (62.5/tick = same
    // 250 DPS) instead of a sub-pixel-per-frame trickle that spawned dozens
    // of tiny floating numbers every second.
    this._suckTick = (this._suckTick || 0) + dt;
    const doTick = this._suckTick >= 0.25;
    if (doTick) this._suckTick = 0;
    const suckRadius = 60.0;
    for (const enemy of enemyList) {
      if (!enemy.mesh) continue;
      const dx = this.center.x - enemy.mesh.position.x;
      const dz = this.center.z - enemy.mesh.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < suckRadius && dist > 0.001) {
        const pull = (14.0 / dist) * dt;
        enemy.mesh.position.x += dx * pull;
        enemy.mesh.position.z += dz * pull;
        if (doTick) enemy.takeDamage(62.5, false, 'status');
      }
    }
  }

  dispose() {
    this.scene.remove(this.group);
    this.scene.remove(this.debris);
    for (const s of this.slices) s.mat.dispose();
    for (const d of this.dust) d.mat.dispose();
    this.debrisMat.dispose();
    this.debris.geometry.dispose();
  }
}

// =====================================================================
// MICROBURST - descending anvil -> impact -> dust donut + wind streaks
// =====================================================================
class MicroBurst {
  constructor(manager, pos, size, duration) {
    const tex = manager.tex;
    this.scene = manager.scene;
    this.pos = pos.clone();
    this.size = size;
    this.duration = duration;
    this.elapsed = 0;
    this.impactDone = false;

    this.group = new THREE.Group();
    this.group.position.set(pos.x, 0, pos.z);
    this.scene.add(this.group);

    // Descending anvil core: 5 dark puffs
    this.anvil = [];
    for (let i = 0; i < 5; i++) {
      const m = new THREE.SpriteMaterial({
        map: tex.puff, color: 0x46525f, transparent: true, opacity: 0,
        depthWrite: false, fog: false,
      });
      const sp = new THREE.Sprite(m);
      const a = (i / 5) * Math.PI * 2;
      sp.position.set(Math.cos(a) * size * 0.18, 95, Math.sin(a) * size * 0.18);
      const s = size * (0.32 + Math.random() * 0.18);
      sp.scale.set(s, s * 0.55, 1);
      this.group.add(sp);
      this.anvil.push(sp);
    }

    // Expanding dust donut (2 layers)
    this.donut = [];
    for (let i = 0; i < 2; i++) {
      const m = new THREE.SpriteMaterial({
        map: tex.dust, color: i === 0 ? 0xd8c4a4 : 0x8f8474, transparent: true, opacity: 0,
        depthWrite: false, fog: false,
      });
      const sp = new THREE.Sprite(m);
      sp.position.y = 2 + i * 2;
      sp.scale.set(1, 0.5, 1);
      this.group.add(sp);
      this.donut.push({ sp, mat: m, delay: i * 0.35, spin: (i === 0 ? 1 : -0.65) * 0.8 });
    }

    // Radial ground-scraping wind streaks (single LineSegments - one draw call)
    const sCount = 42;
    this.streakCount = sCount;
    this.streakPos = new Float32Array(sCount * 6); // PRE-ALLOCATED
    this.streakData = [];
    for (let i = 0; i < sCount; i++) {
      const a = (i / sCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
      this.streakData.push({
        a,
        r0: size * (0.08 + Math.random() * 0.2),
        speed: size * (0.9 + Math.random() * 0.9),
        len: 4 + Math.random() * 7,
        y: 0.6 + Math.random() * 3.5,
      });
    }
    const sGeo = new THREE.BufferGeometry();
    const sAttr = new THREE.BufferAttribute(this.streakPos, 3);
    sAttr.setUsage(THREE.DynamicDrawUsage);
    sGeo.setAttribute('position', sAttr);
    this.streakMat = new THREE.LineBasicMaterial({
      color: 0xcbb794, transparent: true, opacity: 0, depthWrite: false, fog: false,
    });
    this.streaks = new THREE.LineSegments(sGeo, this.streakMat);
    this.streaks.frustumCulled = false;
    this.group.add(this.streaks);

    // Dense downburst rain inside (mb-owned: NOT registered in the manager's
    // list, otherwise it would be double-updated and double-disposed)
    this.rain = manager.createRainshaftInternal(pos, size * 0.8, 130, Math.min(500, size * 3), false);
  }

  update(dt) {
    this.elapsed += dt;
    const t = this.elapsed / this.duration;
    if (t >= 1) return 'dead';

    // Phase 1: anvil slams down (0 -> 0.12 of life), then dissolves
    const slamT = Math.min(1, this.elapsed / 0.75);
    const slamEase = slamT * slamT * (3 - 2 * slamT);
    const anvilY = 95 - slamEase * 88;
    for (let i = 0; i < this.anvil.length; i++) {
      const sp = this.anvil[i];
      sp.position.y = anvilY;
      const fade = slamT < 0.95 ? Math.min(1, this.elapsed * 4) : Math.max(0, (0.95 - (this.elapsed / this.duration) * 0.4));
      sp.material.opacity = 0.75 * (slamT < 1 ? fade : 0);
      if (slamT >= 1) sp.material.opacity = Math.max(0, 0.75 - (this.elapsed - 0.75) * 1.6);
    }

    // Impact: shockwave rings + (shake is added by the casting skill)
    if (!this.impactDone && this.elapsed >= 0.75) {
      this.impactDone = true;
      if (this.manager && this.manager.explosions) {
        this.manager.explosions.megaShockwave(this.pos, this.size * 0.9, 0xcbb794);
      }
    }

    // Phase 2: dust donut expansion
    for (const d of this.donut) {
      const lt = this.elapsed - 0.75 - d.delay;
      if (lt < 0) { d.mat.opacity = 0; continue; }
      const p = lt / 2.6;
      if (p >= 1) { d.mat.opacity = 0; continue; }
      const ease = 1 - Math.pow(1 - p, 2.4);
      const r = this.size * (0.2 + ease * 0.85);
      d.sp.scale.set(r * 2, r * 0.7, 1);
      d.mat.rotation += dt * d.spin;
      d.mat.opacity = 0.55 * (1 - p) * (1 - p);
    }

    // Phase 3: radial wind streaks racing outward from the impact center
    const st = this.elapsed - 0.7;
    if (st > 0) {
      const sp = this.streakPos;
      for (let i = 0; i < this.streakCount; i++) {
        const d = this.streakData[i];
        // Radius grows with decaying speed (wind dies as it spreads)
        const r = d.r0 + d.speed * (1 - Math.exp(-st * 0.55)) * 0.55;
        const a = d.a + Math.sin(st * 0.8 + i) * 0.06; // turbulent wobble
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const i6 = i * 6;
        sp[i6 + 0] = x; sp[i6 + 1] = d.y; sp[i6 + 2] = z;
        // Streak points tangentially outward
        sp[i6 + 3] = x + Math.cos(a) * d.len;
        sp[i6 + 4] = d.y + 0.4;
        sp[i6 + 5] = z + Math.sin(a) * d.len;
      }
      this.streaks.geometry.attributes.position.needsUpdate = true;
      this.streakMat.opacity = Math.max(0, 0.5 * (1 - st / (this.duration * 0.8)));
    }

    // Inner rain fades with the event
    if (this.rain) {
      this.rain.update(dt);
      this.rain.setIntensity(Math.max(0, 1 - st / (this.duration * 0.7)));
    }
  }

  dispose() {
    this.scene.remove(this.group);
    for (const sp of this.anvil) sp.material.dispose();
    for (const d of this.donut) d.mat.dispose();
    this.streakMat.dispose();
    this.streaks.geometry.dispose();
    if (this.rain) this.rain.dispose();
  }
}

// =====================================================================
// CLOUD - 3-layer evolving cluster (base / mid / anvil)
// =====================================================================
const CLOUD_STAGES = {
  humilis:       { light: 0xf4f8fc, dark: 0x9aa7b8 },
  congestus:     { light: 0xe8eef6, dark: 0x7c8899 },
  cumulonimbus:  { light: 0xcdd8e4, dark: 0x55606f },
  supercell:     { light: 0x8f88ad, dark: 0x3a3352 },
};
const MAX_ACTIVE_CLOUDS = 12; // one GPU draw call each (round 7)

// =====================================================================
// GPU VOLUMETRIC CLOUD (Round 7)
//
// Replaces the 32-sprite billboard cloud (32+ draw calls, flat camera-
// facing puffs, per-puff CPU drift) with ONE THREE.Points draw call per
// cloud. Every puff's motion is computed in the VERTEX SHADER from uTime:
//   - differential orbital circulation (top + core rotate faster => the
//     mesocyclone is visible as actual rotation, not a static ring)
//   - churning living edges (two incommensurate sine waves per puff)
//   - stage-driven tower growth + anvil top spread
//   - sunlit-from-above shading (bright tops, churning dark base)
//   - in-cloud lightning: puffs near the flash height ignite from inside
//   - manual exp fog (ShaderMaterial bypasses the scene fog)
//
// Cost: 1 draw call + ~1100 lightweight points per cloud. The CPU only
// touches a handful of uniforms per frame. This is the single biggest
// draw-call cut in the whole game (7 clouds: ~240 calls -> 7 calls).
// =====================================================================

const CLOUD_VERT = `
  attribute float aSeed;
  attribute float aH;
  attribute float aAng;
  attribute float aRad;
  attribute float aSize;

  uniform float uTime;
  uniform float uRadius;     // cloud radius in meters at scale 1.0
  uniform float uFlat;       // vertical squash (nimbostratus decks)
  uniform float uChurn;      // edge churning speed
  uniform float uSpin;       // base orbital circulation speed
  uniform float uCoreSpin;   // extra spin for core puffs (mesocyclone)
  uniform float uTower;      // vertical stretch (stage)
  uniform float uAnvil;      // anvil top spread multiplier
  uniform float uFlash;      // in-cloud flash intensity 0..1
  uniform float uFlashY;     // flash height, local meters

  varying float vShade;
  varying float vSeed;
  varying float vFlash;
  varying float vDist;

  float hash11(float n) { return fract(sin(n) * 43758.5453123); }

  void main() {
    float seed = aSeed * 6.2831853;

    // Differential rotation: higher puffs + core puffs orbit faster
    float rot = 1.0 + aH * 0.45 + (1.0 - aRad) * uCoreSpin;
    float ang = aAng + uTime * uSpin * rot;

    // Living churning edge (two incommensurate sines per puff)
    float churn = 1.0
      + 0.10 * sin(uTime * (0.9 * uChurn) + seed * 3.1)
      + 0.07 * sin(uTime * (1.7 * uChurn) + seed * 7.3);

    // Ellipsoid profile: wide flat base narrowing upward; anvil bulge
    // at the top for storm stages
    float yF = aH;                          // 0 base .. 1 top
    float profile = 1.0 - 0.42 * yF;
    float anvil = 1.0 + max(0.0, yF - 0.58) * 2.8 * (uAnvil - 1.0);
    float rad = aRad * churn * profile * anvil;

    float x = cos(ang) * rad;
    float z = sin(ang) * rad;

    // Vertical column: tower with stage + slow internal breathing
    float y = (yF - 0.40) * uTower + sin(uTime * 0.5 * uChurn + seed * 5.2) * 0.10;

    vec3 p = vec3(x, y * uFlat, z) * uRadius;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;

    float ps = aSize * (14.0 + 30.0 * hash11(aSeed * 7.1));
    gl_PointSize = min(180.0, ps * (300.0 / max(1.0, -mv.z)));

    // Sunlit-from-above shading (the classic cumulus look)
    vShade = mix(0.30, 1.05, smoothstep(-0.55, 0.8, y));
    vSeed = aSeed;

    // In-cloud lightning: puffs near the flash height light from inside
    vFlash = uFlash * smoothstep(15.0, 0.0, abs(p.y - uFlashY))
             * (0.5 + 0.5 * hash11(aSeed * 13.7));

    vDist = -mv.z;
  }
`;

const CLOUD_FRAG = `
  uniform vec3 uColorTop;
  uniform vec3 uColorBase;
  uniform float uOpacity;
  uniform float uFogDensity;
  uniform vec3 uFogColor;

  varying float vShade;
  varying float vSeed;
  varying float vFlash;
  varying float vDist;

  void main() {
    vec2 q = gl_PointCoord - 0.5;
    float d = length(q) * 2.0;
    // Multi-lobe soft puff silhouette, varied per puff via seed
    float lobe = 0.78 + 0.22 * sin(vSeed * 17.0 + q.x * 9.0) * sin(vSeed * 23.0 + q.y * 7.0);
    float a = smoothstep(1.0, 0.12, d) * lobe;
    a *= 0.30; // per-puff density; many overlapping puffs build the body
    if (a * uOpacity < 0.004) discard;

    vec3 col = mix(uColorBase, uColorTop, clamp(vShade, 0.0, 1.0));
    // Lightning interior flash: white-hot from inside the cloud
    col = mix(col, vec3(1.0, 0.97, 0.90), vFlash);

    // Manual exponential fog (matches the scene's FogExp2)
    float fogF = 1.0 - exp(-uFogDensity * uFogDensity * vDist * vDist);
    col = mix(col, uFogColor, clamp(fogF, 0.0, 1.0));

    gl_FragColor = vec4(col, a * uOpacity);
  }
`;

/** Stage -> shader parameter table (tower, circulation, churn, anvil). */
const CLOUD_STAGE_PARAMS = {
  humilis:      { tower: 1.00, spin: 0.035, coreSpin: 0.10, churn: 0.55 },
  congestus:    { tower: 1.30, spin: 0.050, coreSpin: 0.20, churn: 0.75 },
  cumulonimbus: { tower: 1.65, spin: 0.065, coreSpin: 0.35, churn: 1.00 },
  supercell:    { tower: 1.90, spin: 0.100, coreSpin: 1.10, churn: 1.30 },
};

class CloudField {
  /**
   * One GPU soft-particle volumetric cloud = ONE THREE.Points draw call.
   * All motion lives in the vertex shader; the CPU only touches uniforms.
   */
  constructor(scene, position, particleCount = 1100) {
    this.scene = scene;
    const count = particleCount;
    const positions = new Float32Array(count * 3); // placeholder (motion is in-shader)
    const seeds = new Float32Array(count);
    const hs = new Float32Array(count);
    const angs = new Float32Array(count);
    const rads = new Float32Array(count);
    const sizes = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      seeds[i] = Math.random();
      hs[i] = Math.pow(Math.random(), 0.85);      // height 0..1, base-weighted
      angs[i] = Math.random() * Math.PI * 2;
      rads[i] = Math.pow(Math.random(), 0.62);    // radial fraction, edge-weighted
      sizes[i] = 0.6 + Math.random() * 0.9;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geo.setAttribute('aH', new THREE.BufferAttribute(hs, 1));
    geo.setAttribute('aAng', new THREE.BufferAttribute(angs, 1));
    geo.setAttribute('aRad', new THREE.BufferAttribute(rads, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    // Static geometry; fixed loose bounds (shader displaces puffs)
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 12, 0), 320);

    this.material = new THREE.ShaderMaterial({
      vertexShader: CLOUD_VERT,
      fragmentShader: CLOUD_FRAG,
      transparent: true,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTime: { value: 0 },
        uRadius: { value: 55 },
        uFlat: { value: 1.0 },
        uChurn: { value: 0.55 },
        uSpin: { value: 0.035 },
        uCoreSpin: { value: 0.10 },
        uTower: { value: 1.0 },
        uAnvil: { value: 1.0 },
        uFlash: { value: 0 },
        uFlashY: { value: 10 },
        uColorTop: { value: new THREE.Color(0xf4f8fc) },
        uColorBase: { value: new THREE.Color(0x9aa7b8) },
        uOpacity: { value: 0.66 },
        uFogDensity: { value: 0.0011 },
        uFogColor: { value: new THREE.Color(0x0a1420) },
      },
    });

    this.points = new THREE.Points(geo, this.material);
    this.points.position.copy(position);
    this.points.frustumCulled = false; // shader displaces puffs beyond base bounds
    scene.add(this.points);
  }

  setStageParams(stage) {
    const p = CLOUD_STAGE_PARAMS[stage] || CLOUD_STAGE_PARAMS.humilis;
    const u = this.material.uniforms;
    u.uTower.value = p.tower;
    u.uSpin.value = p.spin;
    u.uCoreSpin.value = p.coreSpin;
    u.uChurn.value = p.churn;
  }

  setStageColors(lightHex, darkHex) {
    this.material.uniforms.uColorTop.value.setHex(lightHex);
    this.material.uniforms.uColorBase.value.setHex(darkHex);
  }

  dispose() {
    this.scene.remove(this.points);
    this.points.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * Storm cell. Public API unchanged (pos/stage/setStage/update/dispose/
 * lifeDuration/elapsed/maxRadius/isSupercell/group) - skills and the
 * manager keep working. New: movement (vel / orbit), altitude, flat
 * decks (nimbostratus), stretched walls (derecho), wall clouds.
 */
class Cloud {
  constructor(manager, pos, isSupercellForced, maxRadius, opts = {}) {
    this.manager = manager;
    this.scene = manager.scene;
    this.pos = pos.clone();
    this.maxRadius = maxRadius;
    this.isSupercell = isSupercellForced || Math.random() < 0.35;
    this.stage = opts.startStage || 'humilis';
    this.maxStage = opts.maxStage || (this.isSupercell ? 'supercell' : 'cumulonimbus');
    this.growthTimer = 0;
    this.growthDuration = opts.growthDuration != null ? opts.growthDuration : 10.0;
    this.growthDone = !!opts.startStage && opts.startStage !== 'humilis';
    this.lifeDuration = opts.lifeDuration != null ? opts.lifeDuration : 120.0;
    this.elapsed = 0;
    this.lightningTimer = 0;
    this.rainshaftActive = false;
    this.rainOnSpawn = !!opts.rainOnSpawn;

    // Movement / shaping options
    this.vel = opts.vel ? opts.vel.clone() : null;      // moving clouds (squall line, derecho)
    this.orbit = opts.orbit || null;                     // { center, radius, speed, angle }
    this.altitude = opts.altitude != null ? opts.altitude : 120;
    this.flat = opts.flat != null ? opts.flat : 1.0;     // vertical squash (nimbostratus deck)
    this.spinOverride = opts.spin != null ? opts.spin : null; // wall clouds
    this.anvilSpread = 1.0;
    this.flash = 0;
    this.flashY = 10;

    this.field = new CloudField(this.scene,
      new THREE.Vector3(this.pos.x, this.altitude, this.pos.z),
      opts.particles != null ? opts.particles : 1100);
    this.field.material.uniforms.uFlat.value = this.flat;
    if (this.spinOverride != null) this.field.material.uniforms.uSpin.value = this.spinOverride;
    this.field.setStageParams(this.stage);
    this.field.setStageColors(CLOUD_STAGES[this.stage].light, CLOUD_STAGES[this.stage].dark);

    this.group = this.field.points; // legacy reference (manager/skills may hold it)
    this.points = this.field.points;
    this.groupScale = this.growthDone ? 1.6 : 0.5;
    this._applyScale();

    if (this.rainOnSpawn) {
      this.rainshaftActive = true;
      const rs = this.manager.createRainshaftInternal(
        this.pos, this.maxRadius * 0.7, this.altitude, 500, true,
        this.vel ? { vel: this.vel, duration: this.lifeDuration } : { duration: this.lifeDuration });
      if (this.orbit) rs.orbit = this.orbit; // eyewall rain follows the cell
    }
  }

  _applyScale() {
    const s = this.groupScale;
    this.points.scale.set(s, s * 0.8, s);
  }

  setStage(stage) {
    if (this.stage === stage) return;
    this.stage = stage;
    const c = CLOUD_STAGES[stage];
    this.field.setStageColors(c.light, c.dark);
    this.field.setStageParams(stage);
    if (this.spinOverride != null) this.field.material.uniforms.uSpin.value = this.spinOverride;
  }

  triggerFlash() {
    this.flash = 1.0;
    this.flashY = 2 + Math.random() * 22;
  }

  /** Fire in-cloud + ground lightning with distance-correct thunder. */
  _strikeLightning() {
    const strikePos = _v3b.set(
      this.pos.x + (Math.random() - 0.5) * this.maxRadius * 0.8,
      0,
      this.pos.z + (Math.random() - 0.5) * this.maxRadius * 0.8
    );
    const isHyperbolt = this.stage === 'supercell' && Math.random() < 0.45;
    const color = isHyperbolt ? '#ffffff' : '#00f0ff';
    this.manager.lightning.strikeBolt(strikePos, 100, color, 0.35, 32);
    this.manager.lightning.flash(strikePos, color, isHyperbolt ? 1.2 : 0.7, 0.3);
    this.manager.explosions.createExplosion(strikePos, isHyperbolt ? 16 : 8, 'lightning', isHyperbolt ? 3.0 : 1.2);

    this.triggerFlash();

    // Thunder: light arrives instantly, sound arrives d/343s later -
    // playThunder schedules the whole rumble at that physical delay.
    const snd = this.manager.sound;
    const pp = this.manager.playerPos;
    if (snd && pp) {
      const dx = strikePos.x - pp.x, dz = strikePos.z - pp.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      const dist01 = Math.min(1, d / 900);
      const pan = Math.max(-1, Math.min(1, dx / Math.max(1, d)));
      snd.playThunder(dist01, pan, isHyperbolt ? 1.15 : 1.0);
    }
  }

  update(dt) {
    this.elapsed += dt;
    if (this.elapsed >= this.lifeDuration) return 'dead';

    // Fade out during the last 15% of life
    let lifeFade = 1;
    if (this.elapsed > this.lifeDuration * 0.85) {
      lifeFade = (this.lifeDuration - this.elapsed) / (this.lifeDuration * 0.15);
    }
    this.field.material.uniforms.uOpacity.value = 0.66 * lifeFade;
    this.field.material.uniforms.uTime.value = this.elapsed;

    // Dynamic growth (0.5x -> 3x), stage evolution along the cap
    if (!this.growthDone && this.growthTimer < this.growthDuration) {
      this.growthTimer += dt;
      const growthT = this.growthTimer / this.growthDuration;
      const s = 0.5 + growthT * 2.5;
      this.groupScale = s;
      this._applyScale();
      const stages = this.maxStage === 'supercell'
        ? ['congestus', 'supercell']
        : (this.maxStage === 'cumulonimbus' ? ['congestus', 'cumulonimbus'] : ['congestus']);
      if (growthT > 0.4) this.setStage(stages[0]);
      if (growthT > 0.8) this.setStage(stages[stages.length - 1]);
      if (!this.rainshaftActive) {
        this.rainshaftActive = true;
        // Rain falls from the cloud base (altitude), not a fixed height
        this.manager.createRainshaftInternal(this.pos, this.maxRadius * 0.6, this.altitude, 500);
      }
    }

    // Supercell: anvil spreads (capped at 1.6x)
    if (this.stage === 'supercell') {
      this.anvilSpread = Math.min(1.6, this.anvilSpread + dt * 0.04);
      this.field.material.uniforms.uAnvil.value = this.anvilSpread;
    }

    // In-cloud + ground lightning from mature clouds
    if (this.stage === 'cumulonimbus' || this.stage === 'supercell') {
      this.lightningTimer += dt;
      const strikeRate = this.stage === 'supercell' ? 0.9 : 1.8;
      if (this.lightningTimer >= strikeRate) {
        this.lightningTimer = 0;
        this._strikeLightning();
      }
    }

    // In-cloud flash decay with fast flicker
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt / 0.35);
      this.field.material.uniforms.uFlash.value =
        this.flash * (0.65 + 0.35 * Math.sin(this.elapsed * 70));
      this.field.material.uniforms.uFlashY.value = this.flashY;
    }

    // Movement: orbit (hurricane cells) > linear (squall/derecho) > drift
    if (this.orbit) {
      const o = this.orbit;
      o.angle += dt * o.speed;
      this.pos.x = o.center.x + Math.cos(o.angle) * o.radius;
      this.pos.z = o.center.z + Math.sin(o.angle) * o.radius;
      this.points.position.x = this.pos.x;
      this.points.position.z = this.pos.z;
    } else if (this.vel) {
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
      this.points.position.x = this.pos.x;
      this.points.position.z = this.pos.z;
    } else {
      // Gentle horizontal drift
      this.pos.x += Math.sin(this.elapsed * 0.1) * dt * 1.5;
      this.pos.z += Math.cos(this.elapsed * 0.08) * dt * 1.5;
      this.points.position.x = this.pos.x;
      this.points.position.z = this.pos.z;
    }
  }

  dispose() {
    this.field.dispose();
  }
}
// =====================================================================
// TSUNAMI - kept from round 2/3 (water wall + foam crest + spray)
// =====================================================================
class Tsunami {
  constructor(manager, originPos, direction, width, height, speed, isLarge) {
    const tex = manager.tex;
    const group = new THREE.Group();

    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x0a4a7a, roughness: 0.25, metalness: 0.3,
      transparent: true, opacity: 0.8, emissive: 0x001a33,
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, 8), waterMat);
    group.add(mesh);

    const foamMat = new THREE.MeshBasicMaterial({
      color: 0xd8f4ff, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    const foam = new THREE.Mesh(new THREE.BoxGeometry(width * 1.02, height * 0.22, 9), foamMat);
    foam.position.y = height * 0.45;
    group.add(foam);

    const sprayMat = new THREE.SpriteMaterial({
      map: tex.puff, color: 0xcfeaff, transparent: true, opacity: 0.4,
      depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
    for (let i = 0; i < 4; i++) {
      const sp = new THREE.Sprite(sprayMat);
      const a = (i / 4) * Math.PI * 2;
      sp.position.set(Math.cos(a) * width * 0.3, height * 0.5 + Math.random() * 3, Math.sin(a) * 5);
      const s = 8 + Math.random() * 10;
      sp.scale.set(s, s * 0.5, 1);
      group.add(sp);
    }

    group.position.copy(originPos);
    group.position.y = height * 0.5;
    const lookTarget = _v3a.copy(originPos).add(direction);
    group.lookAt(lookTarget.x, group.position.y, lookTarget.z);
    manager.scene.add(group);

    this.mesh = group;
    this.waterMat = waterMat;
    this.foamMat = foamMat;
    this.foam = foam;
    this.sprayMat = sprayMat;
    this.direction = direction.clone().normalize();
    this.speed = speed * (isLarge ? 0.9 : 1.1);
    this.height = height;
    this.width = width;
    this.isLarge = isLarge;
    this.duration = 8.0;
    this.elapsed = 0;
    this.animSeed = Math.random() * 10;
  }

  update(dt, enemyList) {
    this.elapsed += dt;
    if (this.elapsed >= this.duration) return 'dead';

    this.mesh.position.addScaledVector(this.direction, this.speed * dt);
    this.mesh.position.y = this.height * 0.5 + Math.sin(this.elapsed * 3 + this.animSeed) * 0.8;
    this.foamMat.opacity = 0.65 + 0.25 * Math.sin(this.elapsed * 9 + this.animSeed);

    for (const enemy of enemyList) {
      if (!enemy.mesh) continue;
      if (enemy.mesh.position.distanceTo(this.mesh.position) < this.width * 0.6) {
        const dmg = this.isLarge ? 800 : 260;
        enemy.takeDamage(dmg, false);
        enemy.mesh.position.addScaledVector(this.direction, 8.0 * dt);
      }
    }
  }

  dispose() {
    this.mesh.parent && this.mesh.parent.remove(this.mesh);
    this.waterMat.dispose();
    this.foamMat.dispose();
    this.sprayMat.dispose();
  }
}

// =====================================================================
// SPLASH RING POOL (shared across all rainshafts)
// =====================================================================
class SplashPool {
  constructor(scene) {
    this.pool = [];
    const geo = new THREE.RingGeometry(0.85, 1.0, 14);
    geo.rotateX(-Math.PI / 2);
    this.geo = geo;
    for (let i = 0; i < 24; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xbfe0f5, transparent: true, opacity: 0,
        depthWrite: false, fog: false, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.pool.push({ mesh, mat, life: 99, maxLife: 0.38 });
    }
  }

  spawn(x, z) {
    const s = this.pool.find(p => !p.mesh.visible) || this.pool[0];
    s.mesh.position.set(x, 0.25, z);
    s.mesh.visible = true;
    s.life = s.maxLife;
    s.mesh.scale.setScalar(0.4);
    s.mat.opacity = 0.4;
  }

  update(dt) {
    for (const s of this.pool) {
      if (!s.mesh.visible) continue;
      s.life -= dt;
      if (s.life <= 0) {
        s.mesh.visible = false;
        continue;
      }
      const p = 1 - s.life / s.maxLife;
      s.mesh.scale.setScalar(0.4 + p * 2.2);
      s.mat.opacity = 0.4 * (1 - p);
    }
  }
}


// =====================================================================
// HAIL FIELD (Round 7)
// Golf-ball sized ice pellets dropping from a storm cell. ONE instanced
// mesh (single draw call) for up to 160 stones; SoA state, zero per-frame
// allocation. Stones fall with wind wobble, shatter on impact (flash +
// sparks + 50% shatter damage to enemies within radius), or bounce once.
// =====================================================================
const HAIL_CAP = 160;

class HailField {
  constructor(manager, centerPos, radius, duration) {
    this.manager = manager;
    this.scene = manager.scene;
    this.center = centerPos.clone();
    this.radius = radius;
    this.duration = duration;
    this.elapsed = 0;
    this.windX = (Math.random() - 0.5) * 10;
    this.windZ = (Math.random() - 0.5) * 10;

    // SoA state (pre-allocated)
    this.px = new Float32Array(HAIL_CAP);
    this.py = new Float32Array(HAIL_CAP);
    this.pz = new Float32Array(HAIL_CAP);
    this.vx = new Float32Array(HAIL_CAP);
    this.vy = new Float32Array(HAIL_CAP);
    this.vz = new Float32Array(HAIL_CAP);
    this.state = new Uint8Array(HAIL_CAP); // 0 dead, 1 falling, 2 shattering, 3 bouncing
    this.t = new Float32Array(HAIL_CAP);
    this.size = new Float32Array(HAIL_CAP);
    this.seed = new Float32Array(HAIL_CAP);
    this._cursor = 0;
    this._acc = 0;

    const geo = new THREE.IcosahedronGeometry(1, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xdfeeff, roughness: 0.35, metalness: 0.05,
      emissive: 0x223344, emissiveIntensity: 0.25,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, HAIL_CAP);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = false;
    this.mesh.frustumCulled = false;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
    for (let i = 0; i < HAIL_CAP; i++) this._writeInstance(i, 0);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.scene.add(this.mesh);
  }

  _writeInstance(i, scale) {
    this._p.set(this.px[i], this.py[i], this.pz[i]);
    this._s.setScalar(scale);
    this._q.identity();
    this._m.compose(this._p, this._q, this._s);
    this.mesh.setMatrixAt(i, this._m);
  }

  _spawn() {
    // Find a dead slot (round-robin scan is fine for 160)
    let slot = -1;
    for (let k = 0; k < HAIL_CAP; k++) {
      const i = (this._cursor + k) % HAIL_CAP;
      if (this.state[i] === 0) { slot = i; break; }
    }
    if (slot < 0) return;
    this._cursor = (slot + 1) % HAIL_CAP;
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * this.radius * 0.55;
    this.px[slot] = this.center.x + Math.cos(a) * r;
    this.py[slot] = 95 + Math.random() * 45;
    this.pz[slot] = this.center.z + Math.sin(a) * r;
    this.vx[slot] = this.windX + (Math.random() - 0.5) * 6;
    this.vy[slot] = -(18 + Math.random() * 12);
    this.vz[slot] = this.windZ + (Math.random() - 0.5) * 6;
    this.size[slot] = 0.7 + Math.random() * 0.9; // golf-ball sized
    this.seed[slot] = Math.random() * 10;
    this.t[slot] = 0;
    this.state[slot] = 1;
  }

  update(dt, enemyList, playerPos) {
    this.elapsed += dt;

    // Spawn cadence ramps up then tapers
    const lifeT = this.elapsed / this.duration;
    if (lifeT < 0.75) {
      this._acc += dt * (14 + lifeT * 26);
      while (this._acc >= 1) { this._acc -= 1; this._spawn(); }
    }

    let shattered = 0;
    for (let i = 0; i < HAIL_CAP; i++) {
      const st = this.state[i];
      if (st === 0) continue;
      this.t[i] += dt;

      if (st === 1) {
        // Falling: gravity + wobble
        this.vy[i] -= 34 * dt;
        if (this.vy[i] < -62) this.vy[i] = -62;
        this.px[i] += (this.vx[i] + Math.sin(this.t[i] * 5 + this.seed[i]) * 2.0) * dt;
        this.pz[i] += (this.vz[i] + Math.cos(this.t[i] * 5 + this.seed[i]) * 2.0) * dt;
        this.py[i] += this.vy[i] * dt;

        if (this.py[i] <= 0.4) {
          this.py[i] = 0.4;
          // Shatter or bounce
          if (Math.random() < 0.62) {
            this.state[i] = 2;
            this.t[i] = 0;
            shattered++;
            this._onShatter(i, enemyList, playerPos);
          } else {
            this.state[i] = 3;
            this.t[i] = 0;
            this.vy[i] = -this.vy[i] * 0.38;
            this.vx[i] *= 0.55; this.vz[i] *= 0.55;
          }
        }
      } else if (st === 2) {
        // Shatter fade-out
        if (this.t[i] > 0.22) { this.state[i] = 0; this._writeInstance(i, 0); }
        else this._writeInstance(i, this.size[i] * (1 - this.t[i] / 0.22));
      } else if (st === 3) {
        // Bounce then settle
        this.vy[i] -= 34 * dt;
        this.px[i] += this.vx[i] * dt;
        this.pz[i] += this.vz[i] * dt;
        this.py[i] += this.vy[i] * dt;
        if (this.py[i] <= 0.35 && this.vy[i] < 0) { this.py[i] = 0.35; this.vy[i] = 0; }
        if (this.t[i] > 0.9) { this.state[i] = 0; this._writeInstance(i, 0); }
        else this._writeInstance(i, this.size[i]);
      }
    }

    // Hail chitter audio (throttled by shatter count)
    if (shattered > 0 && this.manager.sound) {
      this.manager.sound.playHail(shattered / 4);
    }

    this.mesh.instanceMatrix.needsUpdate = true;
  }

  _onShatter(i, enemyList, playerPos) {
    const x = this.px[i], z = this.pz[i];
    const exp = this.manager.explosions;
    if (exp) {
      exp.flashAt(new THREE.Vector3(x, 0.6, z), 0xbfe3ff, 2.2, 0.1);
      if (Math.random() < 0.4) exp.sparkBurst(new THREE.Vector3(x, 0.6, z), 0xdff4ff, 2.4);
    }
    // 50% shatter damage to enemies within 16m (skill: 30% of max HP)
    if (enemyList && Math.random() < 0.5) {
      for (const enemy of enemyList) {
        if (!enemy.mesh) continue;
        const dx = enemy.mesh.position.x - x, dz = enemy.mesh.position.z - z;
        if (dx * dx + dz * dz < 16 * 16) {
          enemy.takeDamage((enemy.maxHp || 100) * 0.30, false);
          break;
        }
      }
    }
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

// =====================================================================
// MANAGER
// =====================================================================
export class CloudWeatherManager {
  constructor(scene, lightningManager, explosionManager, soundSystem = null) {
    this.scene = scene;
    this.lightning = lightningManager;
    this.explosions = explosionManager;
    this.sound = soundSystem; // round 7: thunder + storm ambience

    // Pre-computed shared textures (built once per page - "pre-method")
    this.tex = precomputeWeatherTextures();

    this.activeClouds = [];
    this.activeRainshafts = [];
    this.activeTornadoes = [];
    this.activeMicrobursts = [];
    this.activeTsunamis = [];
    this.activeHail = []; // round 7: hailstorm fields
    this.splashPool = new SplashPool(scene);

    // Round 7: live storm intensity (drives ambience + arena lighting)
    this.playerPos = null;
    this._stormLevel = 0;
    this._stormTimer = 0;

    // Rising flood plane for Nimbostratus Flooding
    this.floodPlane = null;
    this.floodBaseY = null;
    this.floodHeight = 0;
    this.floodTargetHeight = 0;
    this.floodTime = 0;
  }

  /** Internal helper: create a rainshaft registered in the manager's list. */
  createRainshaftInternal(centerPos, width, height, particleCount, register = true, opts = null) {
    const rs = new RainShaft(this, centerPos, width, height, particleCount, opts);
    // register=false -> owned by the caller (e.g. MicroBurst updates/disposes it itself)
    if (register) this.activeRainshafts.push(rs);
    return rs;
  }

  /**
   * Spawns a fluid rainshaft: GPU-simulated streak drops + scrolling
   * rain-curtain sheets + ground mist + splash rings.
   */
  createRainshaft(centerPos, width = 60, height = 150, particleCount = 450) {
    return this.createRainshaftInternal(centerPos, width, height, particleCount);
  }

  /**
   * Spawns a realistic condensation-funnel tornado.
   */
  createTornado(centerPos, baseRadius = 6, height = 160, windSpeedMph = 200, duration = 10) {
    const tn = new Tornado(this, centerPos, baseRadius, height, windSpeedMph, duration);
    this.activeTornadoes.push(tn);
    return tn;
  }

  /**
   * Spawns a Microburst: downdraft anvil slamming the floor, then a radial
   * dust donut + ground-scraping wind streaks + mega shockwave rings.
   */
  createMicroburst(pos, size = 150, duration = 10) {
    const mb = new MicroBurst(this, pos, size, duration);
    mb.manager = this;
    this.activeMicrobursts.push(mb);
    return mb;
  }

  /**
   * Dynamic Growing Cloud (Cumulus -> Cumulonimbus -> Supercell)
   */
  spawnGrowingCloud(pos, isSupercellForced = false, maxRadius = 150, opts = null) {
    // Cap active clouds for perf (oldest expires fast)
    if (this.activeClouds.length >= MAX_ACTIVE_CLOUDS) {
      this.activeClouds[0].lifeDuration = Math.min(this.activeClouds[0].lifeDuration, this.activeClouds[0].elapsed + 6);
    }
    const cl = new Cloud(this, pos, isSupercellForced, maxRadius, opts || {});
    this.activeClouds.push(cl);
    return cl;
  }

  /**
   * Round 7 cinematic: a SQUALL LINE - a fast-moving wall of mature storm
   * cells trailing a rain curtain + gust front. Used by atmospheric
   * instability / derecho skills. Returns the array of cells.
   */
  spawnSquallLine(origin, dirVec, count = 5, speed = 22, cellRadius = 90) {
    // Cells line up along the PERPENDICULAR (the wall face), with a small
    // diagonal depth stagger per cell - a real squall line is tilted, not
    // a straight wall. The whole line translates along dirVec.
    const cells = [];
    const perp = new THREE.Vector3(-dirVec.z, 0, dirVec.x);
    const len = 52; // meters between cells along the wall
    for (let i = 0; i < count; i++) {
      const along = (i - (count - 1) * 0.5) * len;
      const off = origin.clone()
        .addScaledVector(perp, along)
        .addScaledVector(dirVec, i * 9); // diagonal tilt
      cells.push(this.spawnGrowingCloud(off, true, cellRadius, {
        vel: dirVec.clone().multiplyScalar(speed),
        startStage: 'cumulonimbus',
        maxStage: 'cumulonimbus',
        growthDuration: 2.0,
        lifeDuration: 40,
        rainOnSpawn: true,
        particles: 900,
      }));
    }
    return cells;
  }

  /**
   * Round 7 cinematic: a rotating WALL CLOUD - the dark, low, rotating
   * cloud base that sits over a tornado's updraft.
   */
  spawnWallCloud(pos, radius = 40, duration = 12, spin = 0.5) {
    return this.spawnGrowingCloud(pos, true, radius, {
      altitude: 75, flat: 0.62, spin,
      startStage: 'supercell', maxStage: 'supercell',
      growthDuration: 1.5, lifeDuration: duration,
      particles: 700, rainOnSpawn: true,
    });
  }

  /**
   * Round 7 cinematic: a full HURRICANE disc - a ring of orbiting storm
   * cells around a calm eye, an eyewall rain ring, and a ground vortex.
   */
  spawnHurricane(center, ringRadius = 80, duration = 16) {
    const eyeCenter = center.clone();
    const n = 8;
    const speed = (Math.PI * 2) / (ringRadius / 16); // orbit period ~ringRadius/16 s
    const cells = [];
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * Math.PI * 2;
      const orbit = { center: eyeCenter, radius: ringRadius, speed, angle };
      const p = new THREE.Vector3(
        eyeCenter.x + Math.cos(angle) * ringRadius, 0,
        eyeCenter.z + Math.sin(angle) * ringRadius);
      cells.push(this.spawnGrowingCloud(p, true, 60, {
        orbit,
        altitude: 110,
        startStage: 'supercell', maxStage: 'supercell',
        growthDuration: 2.5, lifeDuration: duration,
        particles: 750,
      }));
    }
    // Eyewall rain ring: 6 dense shafts on the ring
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const p = new THREE.Vector3(
        eyeCenter.x + Math.cos(a) * ringRadius, 0,
        eyeCenter.z + Math.sin(a) * ringRadius);
      this.createRainshaft(p, 50, 130, 520);
    }
    return { center: eyeCenter, cells, ringRadius, duration };
  }

  /**
   * Round 7: spawn a hailstorm under a storm cell (HAILSTORM skill).
   */
  spawnHailstorm(centerPos, radius = 70, duration = 12) {
    const hf = new HailField(this, centerPos, radius, duration);
    this.activeHail.push(hf);
    return hf;
  }

  /** Current 0..1 storm intensity (used by the arena for sky dimming). */
  getStormLevel() {
    return this._stormLevel;
  }

  /**
   * Boot pre-warm: compile the cloud shader AND the GPU rain shader once up
   * front so the first spawned cloud / storm never hitches on a compile.
   */
  preflight(renderer, camera) {
    const probe = this.spawnGrowingCloud(new THREE.Vector3(500, 0, 500), false, 80, {
      lifeDuration: 0.001, particles: 300,
    });
    // One minimal rain shaft: warms the precipitation program (removed the
    // same frame, so nothing is visible or simulated afterwards)
    const probeRain = this.createRainshaftInternal(new THREE.Vector3(500, 0, 500), 20, 40, 8, false, { duration: 0.001 });
    renderer.compile(this.scene, camera);
    probe.dispose();
    probeRain.dispose();
    return 2;
  }

  /**
   * Spawns Quake Tsunami Wave Wall with a white foam crest
   */
  spawnTsunami(originPos, direction, width = 60, height = 15, speed = 40, isLarge = false) {
    const ts = new Tsunami(this, originPos, direction, width, height, speed, isLarge);
    this.activeTsunamis.push(ts);
    return ts;
  }

  /**
   * Trigger Nimbostratus Flooding (rising water plane with live ripples)
   */
  startNimbostratusFlood(duration = 20) {
    if (!this.floodPlane) {
      const geo = new THREE.PlaneGeometry(1600, 1600, 24, 24);
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x0a2b42, roughness: 0.12, metalness: 0.75,
        transparent: true, opacity: 0.62, emissive: 0x00121e,
      });
      this.floodPlane = new THREE.Mesh(geo, mat);
      this.floodPlane.position.set(0, -1, 0);
      this.floodBaseY = new Float32Array(geo.attributes.position.count * 3);
      this.floodBaseY.set(geo.attributes.position.array);
      this.scene.add(this.floodPlane);
    }
    this.floodTargetHeight = 3.5; // Water rises to 3.5m
  }

  update(dt, enemyList = [], playerPos = null) {
    this.playerPos = playerPos;
    // Round 7: compute live storm intensity at ~2Hz -> storm ambience audio.
    this._stormTimer += dt;
    if (this._stormTimer >= 0.5) {
      this._stormTimer = 0;
      let lvl = 0;
      for (const cl of this.activeClouds) {
        if (cl.stage === 'cumulonimbus' || cl.stage === 'supercell') lvl += 0.22;
        else if (cl.stage === 'congestus') lvl += 0.10;
      }
      lvl += Math.min(0.3, this.activeRainshafts.length * 0.07);
      lvl += Math.min(0.25, this.activeHail.length * 0.12);
      if (this.floodPlane) lvl += 0.15;
      if (this.activeTornadoes.length) lvl += 0.15;
      this._stormLevel = lvl > 1 ? 1 : lvl;
      if (this.sound) this.sound.setStormAmbience(this._stormLevel);
    }

    // 1. Rainshafts
    for (let i = this.activeRainshafts.length - 1; i >= 0; i--) {
      const rs = this.activeRainshafts[i];
      rs.update(dt);
      if (rs.elapsed >= rs.duration) {
        rs.dispose();
        this.activeRainshafts.splice(i, 1);
      }
    }
    this.splashPool.update(dt);

    // 2. Tornadoes
    for (let i = this.activeTornadoes.length - 1; i >= 0; i--) {
      const tn = this.activeTornadoes[i];
      tn.update(dt, enemyList);
      if (tn.elapsed >= tn.duration) {
        tn.dispose();
        this.activeTornadoes.splice(i, 1);
      }
    }

    // 3. Microbursts
    for (let i = this.activeMicrobursts.length - 1; i >= 0; i--) {
      const mb = this.activeMicrobursts[i];
      mb.update(dt);
      if (mb.elapsed >= mb.duration) {
        mb.dispose();
        this.activeMicrobursts.splice(i, 1);
      }
    }

    // 4. Clouds
    for (let i = this.activeClouds.length - 1; i >= 0; i--) {
      const cl = this.activeClouds[i];
      cl.update(dt);
      if (cl.elapsed >= cl.lifeDuration) {
        cl.dispose();
        this.activeClouds.splice(i, 1);
      }
    }

    // 4b. Hail fields (round 7)
    for (let i = this.activeHail.length - 1; i >= 0; i--) {
      const hf = this.activeHail[i];
      hf.update(dt, enemyList, playerPos);
      if (hf.elapsed >= hf.duration) {
        hf.dispose();
        this.activeHail.splice(i, 1);
      }
    }

    // 5. Tsunamis
    for (let i = this.activeTsunamis.length - 1; i >= 0; i--) {
      const ts = this.activeTsunamis[i];
      ts.update(dt, enemyList);
      if (ts.elapsed >= ts.duration) {
        ts.dispose();
        this.activeTsunamis.splice(i, 1);
      }
    }

    // 6. Flooding (rising plane + live surface ripples)
    if (this.floodPlane) {
      this.floodTime += dt;
      if (this.floodHeight < this.floodTargetHeight) {
        this.floodHeight = Math.min(this.floodTargetHeight, this.floodHeight + dt * 0.4);
      }
      this.floodPlane.position.y = this.floodHeight;
      // Two travelling sine waves across the surface (pre-allocated base)
      const posAttr = this.floodPlane.geometry.attributes.position;
      const arr = posAttr.array;
      const base = this.floodBaseY;
      const t = this.floodTime;
      for (let i = 0; i < posAttr.count; i++) {
        const x = base[i * 3];
        const z = base[i * 3 + 2];
        arr[i * 3 + 1] = Math.sin(x * 0.02 + t * 1.4) * 0.18
          + Math.sin(z * 0.017 - t * 1.1) * 0.18
          + Math.sin((x + z) * 0.011 + t * 0.7) * 0.1;
      }
      posAttr.needsUpdate = true;
    }
  }
}
