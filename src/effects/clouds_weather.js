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
 *  RAIN:   LineSegments streaks (one draw call per shaft) - each drop is a
 *          short segment aligned with its slanted velocity, plus 5 scrolling
 *          rain-curtain sheets and pooled ground splash rings.
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

// Built once per page load (shared across managers)
let WEATHER_TEX = null;
export function precomputeWeatherTextures() {
  if (WEATHER_TEX) return WEATHER_TEX;
  WEATHER_TEX = {
    puff: makeCloudPuffTexture(),
    vortex: makeVortexTexture(),
    dust: makeDustTexture(),
    curtain: makeCurtainTexture(),
  };
  return WEATHER_TEX;
}

// =====================================================================
// Module-level scratch objects (pre-allocated: zero per-frame allocation)
// =====================================================================
const _v3a = new THREE.Vector3();
const _v3b = new THREE.Vector3();

// =====================================================================
// RAINSHAFT - streak lines + curtain sheets + splash rings + mist
// =====================================================================
class RainShaft {
  constructor(manager, centerPos, width, height, particleCount) {
    const tex = manager.tex;
    const count = particleCount;
    this.scene = manager.scene;
    this.center = centerPos.clone();
    this.width = width;
    this.height = height;
    this.count = count;
    this.elapsed = 0;
    this.duration = 12.0;
    this.windX = (Math.random() - 0.5) * 9;
    this.windZ = (Math.random() - 0.5) * 9;

    // PRE-ALLOCATED buffers (pre-method): 2 vertices per drop (top, bottom)
    this.positions = new Float32Array(count * 6);
    this.velX = new Float32Array(count);
    this.velY = new Float32Array(count);
    this.velZ = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      this.respawnDrop(i, true);
      this.velX[i] = this.windX + (Math.random() - 0.5) * 5;
      this.velY[i] = -(58 + Math.random() * 42);
      this.velZ[i] = this.windZ + (Math.random() - 0.5) * 5;
    }

    const geo = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(this.positions, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', posAttr);

    this.mat = new THREE.LineBasicMaterial({
      color: 0xcfe3f5,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      fog: false,
    });
    this.lines = new THREE.LineSegments(geo, this.mat);
    this.lines.frustumCulled = false;
    this.scene.add(this.lines);

    // Rain curtain sheets (scrolling streak texture) - the visible "shaft"
    this.curtainGroup = new THREE.Group();
    this.curtainGroup.position.set(centerPos.x, height * 0.5, centerPos.z);
    this.curtainTex = tex.curtain.clone();
    this.curtainTex.needsUpdate = true;
    this.curtainTex.wrapS = THREE.RepeatWrapping;
    this.curtainTex.wrapT = THREE.RepeatWrapping;
    this.curtainTex.repeat.set(3, 4);
    const sheetW = width * 0.85;
    const sheetH = height * 0.92;
    this.curtainMat = new THREE.MeshBasicMaterial({
      map: this.curtainTex,
      color: 0x9fc4e0,
      transparent: true,
      opacity: 0.1,
      side: THREE.DoubleSide,
      depthWrite: false,
      fog: false,
    });
    const sheetGeo = new THREE.PlaneGeometry(sheetW, sheetH);
    for (let i = 0; i < 5; i++) {
      const sheet = new THREE.Mesh(sheetGeo, this.curtainMat);
      sheet.position.y = -height * 0.02;
      sheet.rotation.y = (i / 5) * Math.PI;
      this.curtainGroup.add(sheet);
    }
    this.scene.add(this.curtainGroup);

    // Ground mist puffs
    this.mist = [];
    for (let i = 0; i < 5; i++) {
      const m = new THREE.SpriteMaterial({
        map: tex.puff, color: 0xbcd2e8, transparent: true, opacity: 0.14,
        depthWrite: false, fog: false,
      });
      const sp = new THREE.Sprite(m);
      const a = (i / 5) * Math.PI * 2 + Math.random();
      const r = Math.random() * width * 0.4;
      sp.position.set(centerPos.x + Math.cos(a) * r, 2.5 + Math.random() * 3, centerPos.z + Math.sin(a) * r);
      const s = width * (0.25 + Math.random() * 0.2);
      sp.scale.set(s, s * 0.45, 1);
      this.scene.add(sp);
      this.mist.push(sp);
    }

    // Shared splash ring pool (from manager)
    this.splashPool = manager.splashPool;
  }

  respawnDrop(i, initial = false) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * (this.width * 0.5);
    this.positions[i * 6 + 0] = this.center.x + Math.cos(a) * r;
    this.positions[i * 6 + 1] = initial
      ? this.center.y + Math.random() * this.height * 0.9
      : this.center.y + (Math.random() * 0.3 + 0.65) * this.height;
    this.positions[i * 6 + 2] = this.center.z + Math.sin(a) * r;
  }

  update(dt) {
    this.elapsed += dt;
    const lifeT = this.elapsed / this.duration;
    const env = Math.min(1, lifeT * 5) * Math.min(1, (1 - lifeT) * 4);
    this.mat.opacity = 0.34 * env;
    this.curtainMat.opacity = 0.1 * env;
    this.curtainTex.offset.y -= dt * 1.6; // rain scrolling down the sheets
    this.curtainGroup.rotation.y += dt * 0.15;

    const pos = this.positions;
    const streak = 0.03; // seconds of velocity visualized as streak length
    for (let i = 0; i < this.count; i++) {
      const i6 = i * 6;
      pos[i6 + 0] += this.velX[i] * dt;
      pos[i6 + 1] += this.velY[i] * dt;
      pos[i6 + 2] += this.velZ[i] * dt;

      const topY = pos[i6 + 1];
      const botY = topY + this.velY[i] * streak;

      if (botY <= 0.2) {
        // Ground hit: pooled splash ring (statistically, not per drop)
        if (Math.random() < 0.09) this.splashPool.spawn(pos[i6 + 0], pos[i6 + 2]);
        this.respawnDrop(i);
        pos[i6 + 1] += (this.height * 0.02) * Math.random();
      }

      // Streak: bottom vertex trails behind along velocity
      pos[i6 + 3] = pos[i6 + 0] - this.velX[i] * streak;
      pos[i6 + 4] = topY - this.velY[i] * streak; // velY negative => +len
      pos[i6 + 5] = pos[i6 + 2] - this.velZ[i] * streak;
    }
    this.lines.geometry.attributes.position.needsUpdate = true;

    // Mist drift + fade
    for (let m = 0; m < this.mist.length; m++) {
      const sp = this.mist[m];
      sp.position.x += Math.sin(this.elapsed * 0.4 + m * 2) * dt * 2;
      sp.position.z += Math.cos(this.elapsed * 0.3 + m * 1.7) * dt * 1.5;
      sp.material.opacity = 0.14 * env;
    }
  }

  dispose() {
    this.scene.remove(this.lines);
    this.scene.remove(this.curtainGroup);
    this.mat.dispose();
    this.curtainMat.dispose();
    this.curtainTex.dispose();
    this.lines.geometry.dispose();
    for (const sp of this.mist) {
      this.scene.remove(sp);
      sp.material.dispose();
    }
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

    // Enemy suction toward the vortex core
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
        enemy.takeDamage(250 * dt, false);
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
      this.rain.mat.opacity = 0.34 * Math.max(0, 1 - st / (this.duration * 0.7));
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
const MAX_ACTIVE_CLOUDS = 7;

class Cloud {
  constructor(manager, pos, isSupercellForced, maxRadius) {
    this.manager = manager;
    const tex = manager.tex;
    this.scene = manager.scene;
    this.pos = pos.clone();
    this.maxRadius = maxRadius;
    this.isSupercell = isSupercellForced || Math.random() < 0.35;
    this.stage = 'humilis';
    this.growthTimer = 0;
    this.growthDuration = 10.0;
    this.lifeDuration = 120.0;
    this.elapsed = 0;
    this.lightningTimer = 0;
    this.rainshaftActive = false;

    this.group = new THREE.Group();
    this.group.position.set(pos.x, 90, pos.z);
    this.scene.add(this.group);

    // 3 layers: base (wide, dark), mid, anvil (top)
    this.layers = [
      { y: -14, spread: 1.0,  puffs: 12, dark: true,  h: 0.45 },
      { y: 0,    spread: 0.8,  puffs: 11, dark: false, h: 0.7 },
      { y: 16,   spread: 0.9,  puffs: 9,  dark: false, h: 0.55 },
    ];

    this.matLight = new THREE.SpriteMaterial({
      map: tex.puff, color: 0xf4f8fc, transparent: true, opacity: 0.62,
      depthWrite: false, fog: false,
    });
    this.matDark = new THREE.SpriteMaterial({
      map: tex.puff, color: 0x8b97a8, transparent: true, opacity: 0.5,
      depthWrite: false, fog: false,
    });

    this.puffs = [];
    for (const layer of this.layers) {
      for (let i = 0; i < layer.puffs; i++) {
        const mat = layer.dark ? this.matDark : this.matLight;
        const sp = new THREE.Sprite(mat);
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * 38 * layer.spread;
        sp.position.set(Math.cos(a) * r, layer.y + (Math.random() - 0.5) * 10, Math.sin(a) * r);
        const s = 22 + Math.random() * 26;
        sp.scale.set(s, s * layer.h * (0.8 + Math.random() * 0.4), 1);
        this.group.add(sp);
        // Per-puff drift => the cloud morphs slowly (internal circulation)
        this.puffs.push({
          sp,
          baseR: Math.sqrt(sp.position.x * sp.position.x + sp.position.z * sp.position.z),
          ang: Math.atan2(sp.position.z, sp.position.x),
          angVel: (0.008 + Math.random() * 0.02) * (Math.random() > 0.5 ? 1 : -1),
          bob: Math.random() * 10,
          yBase: sp.position.y,
        });
      }
    }

    // Supercell mesocyclone: 4 big dark puffs slowly orbiting the core
    this.meso = [];
    this.mesoMat = new THREE.SpriteMaterial({
      map: tex.puff, color: 0x2c2440, transparent: true, opacity: 0,
      depthWrite: false, fog: false,
    });
    for (let i = 0; i < 4; i++) {
      const sp = new THREE.Sprite(this.mesoMat);
      const s = 34 + Math.random() * 10;
      sp.scale.set(s, s * 0.8, 1);
      sp.position.y = 6;
      this.group.add(sp);
      this.meso.push({ sp, a: (i / 4) * Math.PI * 2 });
    }
    this.groupScale = 0.5; // current growth scale (for anvil spreading)
    this.anvilSpread = 1.0; // capped supercell anvil spread

    // In-cloud lightning flash sprites (pooled per cloud: 3)
    this.flashes = [];
    for (let i = 0; i < 3; i++) {
      const m = new THREE.SpriteMaterial({
        map: tex.puff, color: 0xdfefff, transparent: true, opacity: 0,
        depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      });
      const sp = new THREE.Sprite(m);
      sp.visible = false;
      this.group.add(sp);
      this.flashes.push({ sp, mat: m, life: 0 });
    }
  }

  setStage(stage) {
    if (this.stage === stage) return;
    this.stage = stage;
    const c = CLOUD_STAGES[stage];
    this.matLight.color.setHex(c.light);
    this.matDark.color.setHex(c.dark);
  }

  update(dt) {
    this.elapsed += dt;
    if (this.elapsed >= this.lifeDuration) return 'dead';

    // Fade out during the last 15% of life
    let lifeFade = 1;
    if (this.elapsed > this.lifeDuration * 0.85) {
      lifeFade = (this.lifeDuration - this.elapsed) / (this.lifeDuration * 0.15);
    }
    this.matLight.opacity = 0.62 * lifeFade;
    this.matDark.opacity = 0.5 * lifeFade;
    this.mesoMat.opacity = (this.stage === 'supercell' ? 0.7 : 0) * lifeFade;

    // Dynamic growth (0.5x -> 3x over 10s), stage evolution
    if (this.growthTimer < this.growthDuration) {
      this.growthTimer += dt;
      const growthT = this.growthTimer / this.growthDuration;
      const s = 0.5 + growthT * 2.5;
      this.groupScale = s;
      this.group.scale.set(s, s * 0.8, s);
      if (growthT > 0.4) this.setStage('congestus');
      if (growthT > 0.8) {
        this.setStage(this.isSupercell ? 'supercell' : 'cumulonimbus');
        if (!this.rainshaftActive) {
          this.rainshaftActive = true;
          this.manager.createRainshaftInternal(this.pos, this.maxRadius * 0.6, 90, 380);
        }
      }
    }

    // Per-puff drift: each puff slowly orbits + bobs => living, morphing cloud
    for (const p of this.puffs) {
      p.ang += p.angVel * dt;
      const wobble = 1 + 0.06 * Math.sin(this.elapsed * 0.5 + p.bob);
      p.sp.position.x = Math.cos(p.ang) * p.baseR * wobble;
      p.sp.position.z = Math.sin(p.ang) * p.baseR * wobble;
      p.sp.position.y = p.yBase + Math.sin(this.elapsed * 0.4 + p.bob) * 1.6;
    }

    // Mesocyclone rotation (supercell)
    if (this.stage === 'supercell') {
      for (const m of this.meso) {
        m.a += dt * 0.35;
        m.sp.position.x = Math.cos(m.a) * 16;
        m.sp.position.z = Math.sin(m.a) * 16;
      }
      // Flattened anvil spread (capped at 1.6x)
      this.anvilSpread = Math.min(1.6, this.anvilSpread + dt * 0.04);
      const s = this.groupScale;
      this.group.scale.set(s * this.anvilSpread, s * 0.8, s * this.anvilSpread);
    }

    // In-cloud + ground lightning from mature clouds
    if (this.stage === 'cumulonimbus' || this.stage === 'supercell') {
      this.lightningTimer += dt;
      const strikeRate = this.stage === 'supercell' ? 0.9 : 1.8;
      if (this.lightningTimer >= strikeRate) {
        this.lightningTimer = 0;
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

        // In-cloud flash: bright additive puff inside the cloud
        const f = this.flashes.find(x => x.life <= 0) || this.flashes[0];
        f.life = 0.35;
        f.sp.visible = true;
        f.sp.position.set(
          (Math.random() - 0.5) * 40,
          5 + Math.random() * 20,
          (Math.random() - 0.5) * 40
        );
        const fs = 30 + Math.random() * 24;
        f.sp.scale.set(fs, fs * 0.7, 1);
        f.mat.opacity = 0.9;
      }
    }

    // Flash decay
    for (const f of this.flashes) {
      if (f.life > 0) {
        f.life -= dt;
        f.mat.opacity = Math.max(0, (f.life / 0.35) * 0.9 * (0.6 + 0.4 * Math.sin(f.life * 80)));
        if (f.life <= 0) f.sp.visible = false;
      }
    }

    // Gentle horizontal drift
    this.group.position.x += Math.sin(this.elapsed * 0.1) * dt * 1.5;
    this.group.position.z += Math.cos(this.elapsed * 0.08) * dt * 1.5;
  }

  dispose() {
    this.scene.remove(this.group);
    this.matLight.dispose();
    this.matDark.dispose();
    this.mesoMat.dispose();
    for (const f of this.flashes) f.mat.dispose();
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
// MANAGER
// =====================================================================
export class CloudWeatherManager {
  constructor(scene, lightningManager, explosionManager) {
    this.scene = scene;
    this.lightning = lightningManager;
    this.explosions = explosionManager;

    // Pre-computed shared textures (built once per page - "pre-method")
    this.tex = precomputeWeatherTextures();

    this.activeClouds = [];
    this.activeRainshafts = [];
    this.activeTornadoes = [];
    this.activeMicrobursts = [];
    this.activeTsunamis = [];
    this.splashPool = new SplashPool(scene);

    // Rising flood plane for Nimbostratus Flooding
    this.floodPlane = null;
    this.floodBaseY = null;
    this.floodHeight = 0;
    this.floodTargetHeight = 0;
    this.floodTime = 0;
  }

  /** Internal helper: create a rainshaft registered in the manager's list. */
  createRainshaftInternal(centerPos, width, height, particleCount, register = true) {
    const rs = new RainShaft(this, centerPos, width, height, particleCount);
    // register=false -> owned by the caller (e.g. MicroBurst updates/disposes it itself)
    if (register) this.activeRainshafts.push(rs);
    return rs;
  }

  /**
   * Spawns a fluid rainshaft: slanted streak lines + scrolling rain-curtain
   * sheets + ground mist + splash rings.
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
  spawnGrowingCloud(pos, isSupercellForced = false, maxRadius = 150) {
    // Cap active clouds for perf (oldest expires fast)
    if (this.activeClouds.length >= MAX_ACTIVE_CLOUDS) {
      this.activeClouds[0].lifeDuration = Math.min(this.activeClouds[0].lifeDuration, this.activeClouds[0].elapsed + 6);
    }
    const cl = new Cloud(this, pos, isSupercellForced, maxRadius);
    this.activeClouds.push(cl);
    return cl;
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
