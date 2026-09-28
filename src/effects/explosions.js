import * as THREE from 'three';

/**
 * 3D 1090 Fruits - Explosion & Debris Physics System (ROUND 6 REWRITE)
 *
 * SPECIFICATIONS:
 * 1. "explosion effects: (explosion and the debris)"
 * 2. "cannot reuse effects because its prohibited" -> distinct geometry,
 *    particle types, debris shapes, and materials for every fruit/weapon
 *    category (box / tetrahedron / tectonic slab / crystalline shard).
 * 3. Physics Debris: Chunks launch in 3D trajectories, experience gravity,
 *    bounce off the floor (y = 0), tumble on X/Y/Z, and decelerate with
 *    friction.
 * 4. Integrates with Camera Shake with strict distance falloff.
 * 5. CINEMATIC LAYER: every explosion casts a real dynamic point light,
 *    throws rising embers (per-type color) and soft smoke billows.
 *
 * ROUND 6 - "10,000x COOLER, ZERO HITCHES":
 *  - Debris now runs on ONE InstancedMesh per debris type (4 draw calls
 *    total for ALL debris in the game, instead of up to 80 meshes per
 *    explosion). Instances glow white-hot on launch and cool to the
 *    fruit's color as they fly.
 *  - Every one-shot effect (rings, cores, shells, domes, arc webs, crack
 *    webs, fire columns, siren domes, cloud puffs) is pre-allocated in a
 *    pool: createExplosion() performs ZERO allocations and ZERO
 *    geometry/material creation, so there is no GC churn and no shader
 *    compilation hitch on first use of any fruit VFX.
 *  - Per-fruit SIGNATURE effects (auto-attached to createExplosion by
 *    type): lightning ground-arc web, quake tectonic crack web, fire
 *    rising flame column + ember fountain, alarm siren dome + rotating
 *    radar beacons, ice frost-spray shards + double frost ring, cloud
 *    condensation puff burst, asteroid heavy embers.
 *  - Upgraded signature pools: vortices gain a counter-rotating ring, a
 *    volumetric core pillar and a rising lift-ring; beams gain an outer
 *    glow hull and a traveling energy pulse.
 *  - preflight(renderer, camera) exposes every pooled effect for one
 *    renderer.compile() pass during the loading screen, so all VFX
 *    programs are warm before the first skill is cast.
 */

const FLASH_LIGHT_POOL = 6;
const EMBER_POOL = 12;
const EMBER_PER_BURST = 26;
const SMOKE_POOL = 10;
const SMOKE_PER_BURST = 6;

const SHOCK_POOL = 14;
const CORE_POOL = 14;
const SHELL_POOL = 14;
const DOME_POOL = 8;
const ARC_POOL = 4;
const CRACK_POOL = 4;
const FIRECOL_POOL = 5;
const SIREN_POOL = 4;
const CLOUDPUFF_POOL = 4;

const GRAVITY = -26.0; // m/s²
const FLOOR_Y = 0.2;

/* ===================================================================== */
/* TEXTURES (built once at import time)                                  */
/* ===================================================================== */

function makeSootTexture() {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 128;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 3, 64, 64, 62);
  g.addColorStop(0, 'rgba(8, 6, 5, 0.95)');
  g.addColorStop(0.4, 'rgba(18, 12, 9, 0.7)');
  g.addColorStop(0.75, 'rgba(30, 20, 14, 0.3)');
  g.addColorStop(1, 'rgba(30, 20, 14, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 90; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.pow(Math.random(), 0.6) * 58;
    ctx.fillStyle = `rgba(5, 4, 3, ${0.1 + Math.random() * 0.3})`;
    ctx.beginPath();
    ctx.arc(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 1 + Math.random() * 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeScorchGlowTexture() {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 128;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 62);
  g.addColorStop(0, 'rgba(255, 240, 210, 0.95)');
  g.addColorStop(0.3, 'rgba(160, 220, 255, 0.55)');
  g.addColorStop(0.7, 'rgba(80, 140, 220, 0.18)');
  g.addColorStop(1, 'rgba(80, 140, 220, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeRadialTexture(inner = 'rgba(255,255,255,0.9)', mid = 'rgba(255,255,255,0.35)', outer = 'rgba(255,255,255,0)') {
  const cv = document.createElement('canvas');
  cv.width = 64;
  cv.height = 64;
  const ctx = cv.getContext('2d');
  const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.5, mid);
  grad.addColorStop(1, outer);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}

const TEX = {
  ember: makeRadialTexture('rgba(255,235,190,1)', 'rgba(255,150,50,0.5)', 'rgba(255,80,0,0)'),
  smoke: makeRadialTexture('rgba(200,205,215,0.55)', 'rgba(150,155,165,0.25)', 'rgba(120,125,135,0)'),
  flame: makeRadialTexture('rgba(255,240,200,1)', 'rgba(255,120,20,0.75)', 'rgba(255,40,0,0)'),
  frost: makeRadialTexture('rgba(240,252,255,0.95)', 'rgba(170,225,255,0.5)', 'rgba(120,200,255,0)'),
  puff: makeRadialTexture('rgba(250,252,255,0.85)', 'rgba(215,225,240,0.4)', 'rgba(200,210,230,0)'),
};

/* ===================================================================== */
/* INSTANCED DEBRIS (one draw call per debris type for the whole game)   */
/* ===================================================================== */

const DEBRIS_CAP = 256; // instances per type

class DebrisSystem {
  constructor(scene, geo, capacity = DEBRIS_CAP) {
    this.capacity = capacity;
    this.cursor = 0;
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }), capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    // Per-instance data (pre-allocated, ring-buffered)
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.angVel = new Float32Array(capacity * 3);
    this.rot = new Float32Array(capacity * 3);
    this.baseScale = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.state = new Uint8Array(capacity); // 0 idle | 1 flying | 2 settled
    this.bounces = new Uint8Array(capacity);
    // Per-instance base color (so simultaneous explosions never bleed
    // each other's color into surviving instances)
    this.baseColors = new Float32Array(capacity * 3);

    // Scratch (no per-frame allocations)
    this.dummy = new THREE.Object3D();
    this.colorScratch = new THREE.Color();

    // Initialize: all instances hidden (zero scale), white color buffer
    const zeroMat = new THREE.Matrix4().makeScale(0, 0, 0);
    const white = new THREE.Color(0xffffff);
    for (let i = 0; i < capacity; i++) {
      this.mesh.setMatrixAt(i, zeroMat);
      this.mesh.setColorAt(i, white);
    }
    this.mesh.count = capacity;
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  }

  /**
   * Launch `count` chunks from `pos`. `baseColorHex` is the fruit's debris
   * color (instances start white-hot and cool into it).
   */
  spawn(pos, baseColorHex, count, radius, speedMul = 1.0, scaleMul = 1.0) {
    const bc = this.colorScratch.set(baseColorHex); // single scratch for the whole batch
    let spawned = 0;
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.capacity;

      const angle = Math.random() * Math.PI * 2;
      const speed = (10.0 + Math.random() * radius * 1.5) * speedMul;
      const elevation = 0.4 + Math.random() * 0.6;

      const i3 = i * 3;
      this.pos[i3] = pos.x;
      this.pos[i3 + 1] = pos.y + 0.5;
      this.pos[i3 + 2] = pos.z;
      this.vel[i3] = Math.cos(angle) * speed * (1.0 - elevation);
      this.vel[i3 + 1] = speed * elevation;
      this.vel[i3 + 2] = Math.sin(angle) * speed * (1.0 - elevation);
      this.angVel[i3] = (Math.random() - 0.5) * 12.0;
      this.angVel[i3 + 1] = (Math.random() - 0.5) * 12.0;
      this.angVel[i3 + 2] = (Math.random() - 0.5) * 12.0;
      this.rot[i3] = Math.random() * Math.PI * 2;
      this.rot[i3 + 1] = Math.random() * Math.PI * 2;
      this.rot[i3 + 2] = Math.random() * Math.PI * 2;
      this.baseScale[i] = (0.4 + Math.random() * 0.8) * scaleMul;
      this.maxLife[i] = 3.5 + Math.random() * 2.0;
      this.life[i] = 0;
      this.bounces[i] = 0;
      this.state[i] = 1;
      this.baseColors[i3] = bc.r;
      this.baseColors[i3 + 1] = bc.g;
      this.baseColors[i3 + 2] = bc.b;
      this.mesh.setColorAt(i, bc);
      spawned++;
    }
    if (spawned > 0) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt) {
    const dummy = this.dummy;
    let touched = false;

    for (let i = 0; i < this.capacity; i++) {
      const st = this.state[i];
      if (st === 0) continue;
      touched = true;
      const i3 = i * 3;

      // Lifetime advances for flying AND settled pieces (so settled
      // debris fades out and frees its slot)
      this.life[i] += dt;
      if (this.life[i] >= this.maxLife[i]) {
        this.state[i] = 0;
        dummy.position.set(0, -10000, 0);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(0.0001);
        dummy.updateMatrix();
        this.mesh.setMatrixAt(i, dummy.matrix);
        continue;
      }

      if (st === 1) {
        // Gravity + integration
        this.vel[i3 + 1] += GRAVITY * dt;
        this.pos[i3] += this.vel[i3] * dt;
        this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
        this.pos[i3 + 2] += this.vel[i3 + 2] * dt;

        // Tumble
        this.rot[i3] += this.angVel[i3] * dt;
        this.rot[i3 + 1] += this.angVel[i3 + 1] * dt;
        this.rot[i3 + 2] += this.angVel[i3 + 2] * dt;

        // Floor bounce
        if (this.pos[i3 + 1] <= FLOOR_Y) {
          this.pos[i3 + 1] = FLOOR_Y;
          this.bounces[i]++;
          if (this.bounces[i] >= 3 || Math.abs(this.vel[i3 + 1]) < 2.0) {
            this.state[i] = 2;
            this.vel[i3] = 0; this.vel[i3 + 1] = 0; this.vel[i3 + 2] = 0;
            this.angVel[i3] = 0; this.angVel[i3 + 1] = 0; this.angVel[i3 + 2] = 0;
          } else {
            this.vel[i3 + 1] = -this.vel[i3 + 1] * 0.45;
            this.vel[i3] *= 0.7;
            this.vel[i3 + 2] *= 0.7;
            this.angVel[i3] *= 0.6; this.angVel[i3 + 1] *= 0.6; this.angVel[i3 + 2] *= 0.6;
          }
        }
      }

      // Compose matrix (settled pieces stay put)
      const t = this.life[i] / this.maxLife[i];
      const fade = t > 0.7 ? (1.0 - (t - 0.7) / 0.3) : 1.0;
      const sc = Math.max(0.001, this.baseScale[i] * fade);
      dummy.position.set(this.pos[i3], this.pos[i3 + 1], this.pos[i3 + 2]);
      dummy.rotation.set(this.rot[i3], this.rot[i3 + 1], this.rot[i3 + 2]);
      dummy.scale.setScalar(sc);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);

      // Thermal glow: white-hot -> fruit color -> dim
      const hot = Math.max(0, 1.0 - t * 3.0);
      this.colorScratch.setRGB(this.baseColors[i3], this.baseColors[i3 + 1], this.baseColors[i3 + 2]);
      if (hot > 0) this.colorScratch.lerp(_WHITE, hot * 0.9);
      const dim = 1.0 - t * 0.6;
      this.colorScratch.multiplyScalar(dim);
      this.mesh.setColorAt(i, this.colorScratch);
    }

    // Upload only when something actually moved (no wasted GPU traffic)
    if (touched) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.instanceColor.needsUpdate = true;
    }
  }
}

const _WHITE = new THREE.Color(0xffffff);

/* ===================================================================== */
/* GROUND ARC WEB (lightning signature)                                  */
/* ===================================================================== */

const ARCS_PER_WEB = 26;
const ARC_SEGS = 5;

class GroundArcWeb {
  constructor(scene) {
    this.count = ARCS_PER_WEB * ARC_SEGS;
    this.positions = new Float32Array(this.count * 2 * 3);
    this.seeds = new Float32Array(ARCS_PER_WEB * 4);
    for (let i = 0; i < ARCS_PER_WEB; i++) {
      this.seeds[i * 4] = Math.random() * Math.PI * 2;
      this.seeds[i * 4 + 1] = 0.4 + Math.random() * 0.6;
      this.seeds[i * 4 + 2] = 0.4 + Math.random() * 0.6;
      this.seeds[i * 4 + 3] = Math.random() * 10;
    }
    const geo = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(this.positions, 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', attr);
    const mat = new THREE.LineBasicMaterial({
      color: 0x9ff4ff, transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: false,
    });
    this.lines = new THREE.LineSegments(geo, mat);
    this.lines.frustumCulled = false;
    this.lines.visible = false;
    scene.add(this.lines);
    this.mat = mat;
    this.active = false;
    this.elapsed = 0;
    this.duration = 0.4;
    this.phase = 0;
  }

  spawn(pos, radius, colorHex) {
    const p = this.positions;
    // Regenerate the web (new jagged pattern every strike)
    for (let a = 0; a < ARCS_PER_WEB; a++) {
      const baseA = this.seeds[a * 4] + Math.random() * 0.3;
      const lenF = this.seeds[a * 4 + 1] * (0.5 + Math.random() * 0.5);
      const jag = this.seeds[a * 4 + 2] * (0.5 + Math.random() * 0.5);
      let px = pos.x, pz = pos.z, py = 0.15;
      let prevX = px, prevZ = pz, prevY = py;
      const steps = ARC_SEGS;
      for (let s = 1; s <= steps; s++) {
        const f = s / steps;
        const r = radius * 0.85 * lenF * f;
        const a2 = baseA + (Math.random() - 0.5) * 0.55 * jag;
        px = pos.x + Math.cos(a2) * r;
        pz = pos.z + Math.sin(a2) * r;
        py = 0.15 + (s === steps ? Math.random() * radius * 0.06 : Math.random() * 0.5);
        const vi = (a * ARC_SEGS + (s - 1)) * 6;
        p[vi] = prevX; p[vi + 1] = prevY; p[vi + 2] = prevZ;
        p[vi + 3] = px; p[vi + 4] = py; p[vi + 5] = pz;
        prevX = px; prevY = py; prevZ = pz;
      }
    }
    this.lines.geometry.attributes.position.needsUpdate = true;
    this.mat.color.set(colorHex);
    this.lines.visible = true;
    this.active = true;
    this.elapsed = 0;
    this.phase = Math.random() * 10;
  }

  update(dt) {
    if (!this.active) return;
    this.elapsed += dt;
    const t = this.elapsed / this.duration;
    if (t >= 1.0) {
      this.active = false;
      this.lines.visible = false;
      return;
    }
    // Flickering discharge: fast irregular strobing that dies out
    const flicker = 0.55 + 0.45 * Math.sin(this.elapsed * 55.0 + this.phase) * Math.sin(this.elapsed * 23.0);
    this.mat.opacity = Math.pow(1.0 - t, 1.6) * Math.max(0.15, flicker) * 0.95;
  }
}

/* ===================================================================== */
/* TECTONIC CRACK WEB (quake signature)                                  */
/* ===================================================================== */

const CRACKS_PER_WEB = 14;
const CRACK_SEGS = 7;

class CrackWeb {
  constructor(scene) {
    this.count = CRACKS_PER_WEB * CRACK_SEGS;
    this.positions = new Float32Array(this.count * 2 * 3);
    const geo = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(this.positions, 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', attr);
    const mat = new THREE.LineBasicMaterial({
      color: 0x9fe8ff, transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: false,
    });
    this.lines = new THREE.LineSegments(geo, mat);
    this.lines.frustumCulled = false;
    this.lines.visible = false;
    scene.add(this.lines);
    this.mat = mat;
    this.active = false;
    this.elapsed = 0;
    this.duration = 1.4;
  }

  spawn(pos, radius, colorHex) {
    const p = this.positions;
    // Vertices are RELATIVE to the blast center so the snap-open scale
    // animation expands from the impact point, not the world origin
    for (let c = 0; c < CRACKS_PER_WEB; c++) {
      let a = (c / CRACKS_PER_WEB) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      let px = 0, pz = 0;
      const segLen = (radius * 0.9) / CRACK_SEGS;
      let prevX = px, prevZ = pz;
      for (let s = 0; s < CRACK_SEGS; s++) {
        a += (Math.random() - 0.5) * 0.7;
        px += Math.cos(a) * segLen * (0.7 + Math.random() * 0.6);
        pz += Math.sin(a) * segLen * (0.7 + Math.random() * 0.6);
        const vi = (c * CRACK_SEGS + s) * 6;
        p[vi] = prevX; p[vi + 1] = 0.22; p[vi + 2] = prevZ;
        p[vi + 3] = px; p[vi + 4] = 0.22; p[vi + 5] = pz;
        prevX = px; prevZ = pz;
      }
    }
    this.lines.geometry.attributes.position.needsUpdate = true;
    this.mat.color.set(colorHex);
    this.lines.position.set(pos.x, 0, pos.z);
    this.lines.scale.setScalar(0.3);
    this.active = true;
    this.elapsed = 0;
  }

  update(dt) {
    if (!this.active) return;
    this.elapsed += dt;
    const t = this.elapsed / this.duration;
    if (t >= 1.0) {
      this.active = false;
      this.lines.visible = false;
      return;
    }
    // Snap open fast, then simmer
    const open = Math.min(1, t * 4.5);
    this.lines.scale.setScalar(0.3 + 0.7 * (1.0 - Math.pow(1.0 - open, 3)));
    const simmer = 0.6 + 0.4 * Math.sin(this.elapsed * 9.0);
    this.mat.opacity = (t < 0.2 ? t / 0.2 : Math.pow(1.0 - (t - 0.2) / 0.8, 1.4)) * 0.85 * simmer;
  }
}

/* ===================================================================== */
/* FLAME COLUMN (fire signature)                                         */
/* ===================================================================== */

const FIRE_SPRITES = 7;

class FireColumn {
  constructor(scene, texture) {
    this.sprites = [];
    for (let i = 0; i < FIRE_SPRITES; i++) {
      const mat = new THREE.SpriteMaterial({
        map: texture, color: 0xff7722, transparent: true, opacity: 0,
        depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      });
      const s = new THREE.Sprite(mat);
      s.visible = false;
      scene.add(s);
      this.sprites.push({ s, mat, seed: Math.random() * Math.PI * 2 });
    }
    this.active = false;
    this.elapsed = 0;
    this.duration = 1.2;
    this.height = 12;
  }

  spawn(pos, radius, height, colorHex) {
    this.height = height;
    for (const sp of this.sprites) {
      sp.mat.color.set(colorHex);
      sp.mat.opacity = 0;
      sp.s.visible = true;
    }
    this.active = true;
    this.elapsed = 0;
    this.cx = pos.x;
    this.cz = pos.z;
    this.baseR = Math.max(2.5, radius * 0.22);
  }

  update(dt) {
    if (!this.active) return;
    this.elapsed += dt;
    const t = this.elapsed / this.duration;
    if (t >= 1.0) {
      this.active = false;
      for (const sp of this.sprites) sp.s.visible = false;
      return;
    }
    const grow = Math.min(1, t * 3.0);
    for (let i = 0; i < FIRE_SPRITES; i++) {
      const sp = this.sprites[i];
      const hFrac = i / (FIRE_SPRITES - 1);
      const y = 0.4 + hFrac * this.height * grow;
      const wobble = Math.sin(this.elapsed * 11.0 + sp.seed + hFrac * 4.0) * this.baseR * 0.25;
      sp.s.position.set(this.cx + wobble, y, this.cz + wobble * 0.6);
      // Base wide, tip narrow; flicker
      const base = this.baseR * (1.5 - hFrac * 0.85) * (0.85 + 0.3 * Math.sin(this.elapsed * 17.0 + sp.seed));
      const sc = Math.max(0.5, base);
      sp.s.scale.set(sc, sc * (1.2 + hFrac * 0.5), 1);
      // Envelope: fast in, hold, collapse
      const env = (t < 0.12 ? t / 0.12 : Math.pow(1.0 - (t - 0.12) / 0.88, 1.2));
      sp.mat.opacity = env * (0.75 - hFrac * 0.3);
    }
  }
}

/* ===================================================================== */
/* SIREN DOME + RADAR BEACONS (alarm signature)                          */
/* ===================================================================== */

class SirenDome {
  constructor(scene) {
    const domeGeo = new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2);
    const domeMat = new THREE.MeshBasicMaterial({
      color: 0xff2244, transparent: true, opacity: 0, side: THREE.DoubleSide,
      depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
    this.dome = new THREE.Mesh(domeGeo, domeMat);
    this.dome.visible = false;
    scene.add(this.dome);
    this.domeMat = domeMat;

    // Two crossed rotating radar beacon planes
    this.beacons = [];
    const planeGeo = new THREE.PlaneGeometry(1, 1, 1, 1);
    for (let i = 0; i < 2; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xff5533, transparent: true, opacity: 0, side: THREE.DoubleSide,
        depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      });
      const m = new THREE.Mesh(planeGeo, mat);
      m.visible = false;
      scene.add(m);
      this.beacons.push({ m, mat, phase: i * Math.PI * 0.5 });
    }
    this.active = false;
    this.elapsed = 0;
    this.duration = 1.1;
  }

  spawn(pos, radius, colorHex) {
    this.domeR = Math.max(14, radius);
    this.dome.position.set(pos.x, 0.2, pos.z);
    this.dome.scale.setScalar(0.1);
    this.domeMat.color.set(colorHex);
    this.dome.visible = true;
    const bh = Math.max(10, radius * 0.7);
    for (const b of this.beacons) {
      b.m.position.set(pos.x, bh * 0.5, pos.z);
      b.m.scale.set(radius, bh, 1);
      b.mat.color.set(colorHex);
      b.m.visible = true;
    }
    this.beaconH = bh;
    this.active = true;
    this.elapsed = 0;
  }

  update(dt) {
    if (!this.active) return;
    this.elapsed += dt;
    const t = this.elapsed / this.duration;
    if (t >= 1.0) {
      this.active = false;
      this.dome.visible = false;
      for (const b of this.beacons) b.m.visible = false;
      return;
    }
    const ease = 1.0 - Math.pow(1.0 - Math.min(1, t * 1.6), 2.4);
    this.dome.scale.setScalar(Math.max(0.1, this.domeR * ease));
    const strobe = 0.5 + 0.5 * Math.sin(this.elapsed * 26.0);
    this.domeMat.opacity = Math.pow(1.0 - t, 1.3) * (0.35 + 0.4 * strobe);
    for (const b of this.beacons) {
      b.m.rotation.y = this.elapsed * 5.0 + b.phase;
      b.mat.opacity = Math.pow(1.0 - t, 1.2) * (0.16 + 0.22 * strobe);
    }
  }
}

/* ===================================================================== */
/* CLOUD PUFF BURST (cloud signature)                                    */
/* ===================================================================== */

const CLOUD_PUFFS = 9;

class CloudPuffBurst {
  constructor(scene, texture) {
    this.sprites = [];
    for (let i = 0; i < CLOUD_PUFFS; i++) {
      const mat = new THREE.SpriteMaterial({
        map: texture, color: 0xffffff, transparent: true, opacity: 0,
        depthWrite: false, fog: false,
      });
      const s = new THREE.Sprite(mat);
      s.visible = false;
      scene.add(s);
      this.sprites.push({ s, mat, vel: new THREE.Vector3(), seed: Math.random() * Math.PI * 2 });
    }
    this.active = false;
    this.elapsed = 0;
    this.duration = 1.7;
  }

  spawn(pos, radius, colorHex) {
    for (const sp of this.sprites) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * radius * 0.3;
      sp.s.position.set(pos.x + Math.cos(a) * r, pos.y + 0.5 + Math.random() * 2, pos.z + Math.sin(a) * r);
      sp.vel.set((Math.random() - 0.5) * 8, 4 + Math.random() * 7, (Math.random() - 0.5) * 8);
      const base = Math.max(3, radius * 0.25) * (0.6 + Math.random() * 0.8);
      sp.s.scale.set(base, base, 1);
      sp.base = base;
      sp.grow = 10 + Math.random() * 9;
      sp.mat.color.set(colorHex);
      sp.mat.opacity = 0;
      sp.s.visible = true;
    }
    this.active = true;
    this.elapsed = 0;
  }

  update(dt) {
    if (!this.active) return;
    this.elapsed += dt;
    const t = this.elapsed / this.duration;
    if (t >= 1.0) {
      this.active = false;
      for (const sp of this.sprites) sp.s.visible = false;
      return;
    }
    for (const sp of this.sprites) {
      sp.s.position.addScaledVector(sp.vel, dt);
      sp.vel.multiplyScalar(1 - 0.9 * dt);
      const sc = sp.base + sp.grow * this.elapsed;
      sp.s.scale.set(sc, sc * 0.8, 1);
      sp.mat.opacity = (t < 0.18 ? t / 0.18 : Math.pow(1.0 - (t - 0.18) / 0.82, 1.3)) * 0.5;
    }
  }
}

/* ===================================================================== */
/* EMBER BURST (pooled Points, per-explosion gravity + bounce)           */
/* ===================================================================== */

class EmberBurst {
  constructor(scene, texture) {
    this.scene = scene;
    this.active = false;
    this.count = EMBER_PER_BURST;
    this.positions = new Float32Array(this.count * 3);
    this.velocities = new Float32Array(this.count * 3);
    this.life = new Float32Array(this.count);

    const geo = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(this.positions, 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', attr);
    const mat = new THREE.PointsMaterial({
      color: 0xffaa44, size: 1.1, map: texture, transparent: true, opacity: 0.9,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: false,
    });
    this.mesh = new THREE.Points(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  spawn(pos, colorHex, radius) {
    for (let i = 0; i < this.count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * radius * 0.25;
      this.positions[i * 3] = pos.x + Math.cos(a) * r;
      this.positions[i * 3 + 1] = pos.y + 0.5 + Math.random() * radius * 0.15;
      this.positions[i * 3 + 2] = pos.z + Math.sin(a) * r;

      const speed = 6 + Math.random() * (8 + radius * 0.5);
      const up = 0.35 + Math.random() * 0.55;
      this.velocities[i * 3] = Math.cos(a) * speed * (1 - up);
      this.velocities[i * 3 + 1] = speed * up;
      this.velocities[i * 3 + 2] = Math.sin(a) * speed * (1 - up);

      this.life[i] = 0.7 + Math.random() * 0.9;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.material.color.set(colorHex);
    this.mesh.visible = true;
    this.elapsed = 0;
    this.maxLife = 1.6;
    this.active = true;
  }

  update(dt) {
    if (!this.active) return;
    this.elapsed += dt;
    if (this.elapsed >= this.maxLife) {
      this.active = false;
      this.mesh.visible = false;
      return;
    }
    const pos = this.positions;
    const vel = this.velocities;
    const life = this.life;
    for (let i = 0; i < this.count; i++) {
      life[i] -= dt;
      if (life[i] <= 0) continue;
      vel[i * 3 + 1] += GRAVITY * dt;
      vel[i * 3] *= (1 - 1.6 * dt);
      vel[i * 3 + 2] *= (1 - 1.6 * dt);
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      if (pos[i * 3 + 1] < 0.15) {
        pos[i * 3 + 1] = 0.15;
        vel[i * 3 + 1] *= -0.3;
      }
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.material.opacity = Math.max(0, 1 - this.elapsed / this.maxLife) * 0.9;
  }
}

/* ===================================================================== */
/* SMOKE BURST (pooled sprites)                                          */
/* ===================================================================== */

class SmokeBurst {
  constructor(scene, texture) {
    this.scene = scene;
    this.active = false;
    this.sprites = [];
    for (let i = 0; i < SMOKE_PER_BURST; i++) {
      const mat = new THREE.SpriteMaterial({
        map: texture, color: 0x888899, transparent: true, opacity: 0.0,
        depthWrite: false, fog: false,
      });
      const s = new THREE.Sprite(mat);
      s.visible = false;
      scene.add(s);
      this.sprites.push({ sprite: s, mat, vel: new THREE.Vector3(), grow: 0, life: 0, maxLife: 1 });
    }
  }

  spawn(pos, radius, dark = true) {
    for (const s of this.sprites) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * radius * 0.3;
      s.sprite.position.set(pos.x + Math.cos(a) * r, pos.y + 0.5 + Math.random() * 2, pos.z + Math.sin(a) * r);
      s.vel.set((Math.random() - 0.5) * 6, 6 + Math.random() * 9, (Math.random() - 0.5) * 6);
      const base = 4 + Math.random() * 5;
      s.sprite.scale.set(base, base, 1);
      s.grow = 9 + Math.random() * 8;
      s.life = 0;
      s.maxLife = 1.4 + Math.random() * 1.2;
      s.mat.color.setHex(dark ? 0x2a2f3a : 0x9aa5b5);
      s.mat.opacity = 0;
      s.sprite.visible = true;
    }
    this.elapsed = 0;
    this.active = true;
  }

  update(dt) {
    if (!this.active) return;
    let any = false;
    for (const s of this.sprites) {
      s.life += dt;
      if (s.life >= s.maxLife) {
        s.sprite.visible = false;
        continue;
      }
      any = true;
      const t = s.life / s.maxLife;
      s.sprite.position.addScaledVector(s.vel, dt);
      s.vel.multiplyScalar(1 - 0.8 * dt);
      const sc = s.sprite.scale.x + s.grow * dt;
      s.sprite.scale.set(sc, sc, 1);
      s.mat.opacity = (t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85) * 0.38;
    }
    if (!any) this.active = false;
  }
}

/* ===================================================================== */
/* PER-FRUIT PALETTES (distinct per category - strict non-reuse)         */
/* ===================================================================== */

const PALETTES = {
  asteroid: { color: 0xff5500, shock: 0xff8833, debrisSys: 1, debrisColor: 0xff7733 },
  lightning:{ color: 0x00f0ff, shock: 0x88ffff, debrisSys: 1, debrisColor: 0x9ff4ff },
  quake:    { color: 0x00d0ff, shock: 0xffffff, debrisSys: 2, debrisColor: 0x66d9ff },
  alarm:    { color: 0xff0044, shock: 0xff3366, debrisSys: 0, debrisColor: 0xff2255 },
  ice:      { color: 0x88e0ff, shock: 0xcceeff, debrisSys: 3, debrisColor: 0xcdf3ff },
  fire:     { color: 0xff4400, shock: 0xffaa00, debrisSys: 1, debrisColor: 0xff8833 },
  cloud:    { color: 0xccddee, shock: 0xffffff, debrisSys: 0, debrisColor: 0xe8f4ff },
};

/* ===================================================================== */
/* EXPLOSION MANAGER                                                     */
/* ===================================================================== */

export class ExplosionManager {
  constructor(scene, cameraController, soundSystem) {
    this.scene = scene;
    this.cameraController = cameraController;
    this.sound = soundSystem;

    // Configurable settings
    this.debrisCountPerExplosion = 35;

    // ---------------------------------------------------------------
    // SHARED GEOMETRIES (built once)
    // ---------------------------------------------------------------
    this.shockwaveGeo = new THREE.RingGeometry(0.85, 1.0, 48);
    this.shockwaveGeo.rotateX(-Math.PI / 2);

    this.coreGeo = new THREE.IcosahedronGeometry(1, 2);
    this.shellGeo = new THREE.SphereGeometry(1, 20, 20);
    this.domeGeo = new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2);
    this.pillarGeo = new THREE.CylinderGeometry(0.6, 1.0, 1, 20, 1, true);
    this.beamPulseTex = TEX.ember;

    // ---------------------------------------------------------------
    // INSTANCED DEBRIS: one InstancedMesh per debris shape category
    // (alarm/asteroid boxes, lightning/fire tetrahedra, quake slabs,
    //  ice crystalline shards) - 4 draw calls total, zero allocations
    // ---------------------------------------------------------------
    this.debrisSystems = [
      new DebrisSystem(scene, new THREE.BoxGeometry(0.8, 0.8, 0.8)),
      new DebrisSystem(scene, new THREE.TetrahedronGeometry(0.7, 0)),
      new DebrisSystem(scene, new THREE.BoxGeometry(1.6, 0.4, 1.2)),
      new DebrisSystem(scene, new THREE.ConeGeometry(0.3, 1.2, 4)),
    ];

    // ---------------------------------------------------------------
    // ONE-SHOT MESH POOLS (pre-allocated, no create/dispose per blast)
    // ---------------------------------------------------------------
    this.shockRings = [];
    for (let i = 0; i < SHOCK_POOL; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide,
        depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      });
      const mesh = new THREE.Mesh(this.shockwaveGeo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.shockRings.push({ mesh, mat, active: false, elapsed: 0, duration: 0.5, maxRadius: 10, delay: 0 });
    }

    this.cores = [];
    for (let i = 0; i < CORE_POOL; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      });
      const mesh = new THREE.Mesh(this.coreGeo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.cores.push({ mesh, mat, active: false, elapsed: 0, duration: 0.3, maxScale: 8 });
    }

    this.shells = [];
    for (let i = 0; i < SHELL_POOL; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      });
      const mesh = new THREE.Mesh(this.shellGeo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.shells.push({ mesh, mat, active: false, elapsed: 0, duration: 0.45, maxScale: 10 });
    }

    this.domes = [];
    for (let i = 0; i < DOME_POOL; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide,
        depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      });
      const mesh = new THREE.Mesh(this.domeGeo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.domes.push({ mesh, mat, active: false, elapsed: 0, duration: 0.8, maxRadius: 30 });
    }

    // ---------------------------------------------------------------
    // PER-FRUIT SIGNATURE POOLS
    // ---------------------------------------------------------------
    this.arcWebs = [];
    for (let i = 0; i < ARC_POOL; i++) this.arcWebs.push(new GroundArcWeb(scene));

    this.crackWebs = [];
    for (let i = 0; i < CRACK_POOL; i++) this.crackWebs.push(new CrackWeb(scene));

    this.fireColumns = [];
    for (let i = 0; i < FIRECOL_POOL; i++) this.fireColumns.push(new FireColumn(scene, TEX.flame));

    this.sirenDomes = [];
    for (let i = 0; i < SIREN_POOL; i++) this.sirenDomes.push(new SirenDome(scene));

    this.cloudPuffs = [];
    for (let i = 0; i < CLOUDPUFF_POOL; i++) this.cloudPuffs.push(new CloudPuffBurst(scene, TEX.puff));

    // ---------------------------------------------------------------
    // CINEMATIC POOLS
    // ---------------------------------------------------------------
    this.emberTex = TEX.ember;
    this.smokeTex = TEX.smoke;

    this.flashLights = [];
    for (let i = 0; i < FLASH_LIGHT_POOL; i++) {
      const l = new THREE.PointLight(0xffaa66, 0, 300, 1.7);
      l.visible = false;
      scene.add(l);
      this.flashLights.push({ light: l, peak: 0, duration: 0.5, elapsed: 99 });
    }

    this.emberBursts = [];
    for (let i = 0; i < EMBER_POOL; i++) this.emberBursts.push(new EmberBurst(scene, this.emberTex));

    this.smokeBursts = [];
    for (let i = 0; i < SMOKE_POOL; i++) this.smokeBursts.push(new SmokeBurst(scene, this.smokeTex));

    // ---------------------------------------------------------------
    // PERSISTENT SCORCH MARKS (battlefield accumulates impact scars)
    // ---------------------------------------------------------------
    this.sootTex = makeSootTexture();
    this.scorchGlowTex = makeScorchGlowTexture();

    this.scorchPool = [];
    const scorchGeo = new THREE.CircleGeometry(1, 24);
    scorchGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 24; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: this.sootTex, transparent: true, opacity: 0, depthWrite: false, fog: false,
      });
      const mesh = new THREE.Mesh(scorchGeo, mat);
      mesh.position.y = 0.05 + i * 0.0015; // stagger to avoid z-fighting
      mesh.rotation.z = Math.random() * Math.PI * 2;
      mesh.visible = false;
      scene.add(mesh);
      this.scorchPool.push({ mesh, mat, active: false, elapsed: 0, duration: 1, baseOpacity: 0 });
    }

    this.glowPool = [];
    for (let i = 0; i < 12; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: this.scorchGlowTex, transparent: true, opacity: 0, depthWrite: false,
        blending: THREE.AdditiveBlending, fog: false,
      });
      const mesh = new THREE.Mesh(scorchGeo, mat);
      mesh.position.y = 0.07 + i * 0.0015;
      mesh.visible = false;
      scene.add(mesh);
      this.glowPool.push({ mesh, mat, active: false, elapsed: 0, duration: 1, baseOpacity: 0 });
    }

    // ---------------------------------------------------------------
    // VOLUMETRIC BLAST WALL (expanding cylinder for large explosions)
    // ---------------------------------------------------------------
    this.blastWalls = [];
    const wallGeo = new THREE.CylinderGeometry(1, 1, 1, 40, 1, true);
    for (let i = 0; i < 6; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide,
        depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      });
      const mesh = new THREE.Mesh(wallGeo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.blastWalls.push({ mesh, mat, active: false, elapsed: 0, duration: 0.5, maxR: 10, height: 8 });
    }

    // ---------------------------------------------------------------
    // ONE-PIECE-STYLE CINEMATIC SKILL VISUALS (all pooled)
    // ---------------------------------------------------------------

    // AURA BURST: expanding energy shell + ring + sparks around the caster
    this.auraBursts = [];
    const auraGeo = new THREE.IcosahedronGeometry(1, 1);
    for (let i = 0; i < 6; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0, wireframe: true,
        depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      });
      const mesh = new THREE.Mesh(auraGeo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.auraBursts.push({ mesh, mat, active: false, elapsed: 0, duration: 0.5, maxR: 8 });
    }

    // VORTEX: swirling spiral particle column + rings + core pillar + lift ring
    this.vortices = [];
    const liftRingGeo = new THREE.TorusGeometry(1, 0.05, 8, 40);
    liftRingGeo.rotateX(Math.PI / 2);
    for (let i = 0; i < 4; i++) {
      const count = 160;
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(count * 3);
      const seeds = new Float32Array(count * 2); // angle, radius-factor
      for (let j = 0; j < count; j++) {
        seeds[j * 2] = Math.random() * Math.PI * 2;
        seeds[j * 2 + 1] = Math.pow(Math.random(), 0.7);
      }
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({
        color: 0xffffff, size: 1.4, map: this.emberTex, transparent: true,
        opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      });
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      pts.visible = false;
      scene.add(pts);

      const ringMat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.5,
        side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 8, 40), ringMat);
      ring.visible = false;
      scene.add(ring);

      // Counter-rotating inner ring
      const ring2Mat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.35,
        side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      });
      const ring2 = new THREE.Mesh(new THREE.TorusGeometry(1, 0.035, 8, 40), ring2Mat);
      ring2.visible = false;
      scene.add(ring2);

      // Volumetric core pillar (open cylinder, additive)
      const pillarMat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0,
        side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      });
      const pillar = new THREE.Mesh(this.pillarGeo, pillarMat);
      pillar.visible = false;
      scene.add(pillar);

      // Rising lift-ring (traveling band up the column)
      const liftMat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0,
        side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      });
      const liftRing = new THREE.Mesh(liftRingGeo, liftMat);
      liftRing.visible = false;
      scene.add(liftRing);

      this.vortices.push({
        pts, mat, ring, ringMat, ring2, ring2Mat, pillar, pillarMat, liftRing, liftMat,
        seeds, count, active: false, elapsed: 0, duration: 3.0, radius: 12,
      });
    }

    // MEGA SHOCKWAVE: three staggered ground rings expanding to huge radius
    this.megaWaves = [];
    for (let i = 0; i < 5; i++) {
      const set = [];
      for (let r = 0; r < 3; r++) {
        const mat = new THREE.MeshBasicMaterial({
          color: 0xffffff, transparent: true, opacity: 0,
          side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
        });
        const mesh = new THREE.Mesh(this.groundRingGeoClone(), mat);
        mesh.visible = false;
        scene.add(mesh);
        set.push({ mesh, mat, delay: r * 0.14 });
      }
      this.megaWaves.push({ set, active: false, elapsed: 0, duration: 1.1, maxR: 60 });
    }

    // BEAM: thick bright energy beam + outer glow hull + traveling pulse
    this.beams = [];
    const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true);
    beamGeo.rotateX(Math.PI / 2); // axis along Z for lookAt
    for (let i = 0; i < 6; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0,
        side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      });
      const mesh = new THREE.Mesh(beamGeo, mat);
      mesh.visible = false;
      scene.add(mesh);

      const glowMat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0,
        side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      });
      const glow = new THREE.Mesh(beamGeo, glowMat);
      glow.visible = false;
      scene.add(glow);

      const pulseMat = new THREE.SpriteMaterial({
        map: this.beamPulseTex, color: 0xffffff, transparent: true, opacity: 0,
        depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      });
      const pulse = new THREE.Sprite(pulseMat);
      pulse.visible = false;
      scene.add(pulse);

      this.beams.push({ mesh, mat, glow, glowMat, pulse, pulseMat, active: false, elapsed: 0, duration: 0.32, radius: 2, from: new THREE.Vector3(), to: new THREE.Vector3() });
    }
  }

  groundRingGeoClone() {
    const g = new THREE.RingGeometry(0.88, 1.0, 48);
    g.rotateX(-Math.PI / 2);
    return g;
  }

  setDebrisCount(count) {
    this.debrisCountPerExplosion = Math.max(10, Math.min(80, count));
  }

  /**
   * LOADING-SCREEN PRE-WARM: briefly expose every pooled VFX object so
   * renderer.compile() warms all shader programs, then hide them again.
   * Eliminates first-cast shader hitches for every fruit.
   */
  preflight(renderer, camera) {
    const objs = [];
    const add = (o) => { if (o) objs.push(o); };
    for (const s of this.shockRings) add(s.mesh);
    for (const c of this.cores) add(c.mesh);
    for (const s of this.shells) add(s.mesh);
    for (const d of this.domes) add(d.mesh);
    for (const a of this.arcWebs) add(a.lines);
    for (const c of this.crackWebs) add(c.lines);
    for (const f of this.fireColumns) for (const sp of f.sprites) add(sp.s);
    for (const s of this.sirenDomes) { add(s.dome); for (const b of s.beacons) add(b.m); }
    for (const c of this.cloudPuffs) for (const sp of c.sprites) add(sp.s);
    for (const ds of this.debrisSystems) add(ds.mesh);
    for (const e of this.emberBursts) add(e.mesh);
    for (const s of this.smokeBursts) for (const sp of s.sprites) add(sp.sprite);
    for (const s of this.scorchPool) add(s.mesh);
    for (const g of this.glowPool) add(g.mesh);
    for (const w of this.blastWalls) add(w.mesh);
    for (const a of this.auraBursts) add(a.mesh);
    for (const v of this.vortices) { add(v.pts); add(v.ring); add(v.ring2); add(v.pillar); add(v.liftRing); }
    for (const w of this.megaWaves) for (const r of w.set) add(r.mesh);
    for (const b of this.beams) { add(b.mesh); add(b.glow); add(b.pulse); }
    // CRITICAL: include the pooled flash POINT LIGHTS. three.js compiles a
    // separate program variant per active-light count; without this, the
    // first explosion of a session recompiled every standard material
    // (visible one-frame hitch). Warmed here, the with-lights variant is
    // compiled during the loading screen instead.
    for (const fl of this.flashLights) add(fl.light);

    const prev = [];
    for (const o of objs) { prev.push(o.visible); o.visible = true; }
    renderer.compile(this.scene, camera);
    for (let i = 0; i < objs.length; i++) objs[i].visible = prev[i];
    return objs.length;
  }

  /** Public: spawn a small ember burst (firepits, gun impacts, etc.). */
  sparkBurst(pos, colorHex, radius = 4.0) {
    this._spawnEmbers(pos, colorHex, radius);
  }

  /** Public: quick dynamic light flash at a point (muzzle flash, etc.). */
  flashAt(pos, colorHex, radius = 1.0, duration = 0.12) {
    this._spawnFlashLight(pos, colorHex, radius, duration);
  }

  /** Place a persistent scorch mark (or bright afterimage) at an impact. */
  _markImpact(pos, radius, glow) {
    const pool = glow ? this.glowPool : this.scorchPool;
    const m = pool.find(x => !x.active) || pool[0];
    m.active = true;
    m.elapsed = 0;
    m.duration = glow ? (6 + Math.random() * 4) : (14 + Math.random() * 8);
    m.mesh.position.x = pos.x;
    m.mesh.position.z = pos.z;
    m.mesh.scale.setScalar(Math.max(2.5, radius * 0.5));
    m.baseScale = m.mesh.scale.x;
    m.baseOpacity = glow ? 0.55 : Math.min(0.75, 0.22 + radius * 0.02);
    m.mat.opacity = m.baseOpacity;
    m.mesh.visible = true;
  }

  /** Spawn an expanding volumetric blast wall for large explosions. */
  _blastWall(pos, radius, colorHex) {
    const w = this.blastWalls.find(x => !x.active) || this.blastWalls[0];
    w.active = true;
    w.elapsed = 0;
    w.duration = 0.5 + radius * 0.012;
    w.maxR = radius;
    w.height = Math.min(34, 7 + radius * 0.5);
    w.mesh.position.set(pos.x, w.height * 0.5 + 0.2, pos.z);
    w.mat.color.set(colorHex);
    w.mesh.visible = true;
  }

  /** Acquire a pooled shock ring. */
  _ring(pos, radius, colorHex, duration, delay = 0) {
    const s = this.shockRings.find(x => !x.active) || this.shockRings[0];
    s.active = true;
    s.elapsed = -delay; // negative elapsed = delayed start
    s.duration = duration;
    s.maxRadius = radius;
    s.mesh.position.set(pos.x, pos.y + 0.2, pos.z);
    s.mesh.scale.setScalar(0.1);
    s.mat.color.set(colorHex);
    s.mat.opacity = 0; // invisible during the delay window
    s.mesh.visible = true;
  }

  /** Acquire a pooled plasma core flash. */
  _core(pos, maxScale, colorHex, duration) {
    const c = this.cores.find(x => !x.active) || this.cores[0];
    c.active = true;
    c.elapsed = 0;
    c.duration = duration;
    c.maxScale = maxScale;
    c.mesh.position.copy(pos);
    c.mesh.scale.setScalar(0.2);
    c.mat.color.set(colorHex);
    c.mesh.visible = true;
  }

  /** Acquire a pooled colored energy shell. */
  _shell(pos, maxScale, colorHex, duration) {
    const s = this.shells.find(x => !x.active) || this.shells[0];
    s.active = true;
    s.elapsed = 0;
    s.duration = duration;
    s.maxScale = maxScale;
    s.mesh.position.copy(pos);
    s.mesh.scale.setScalar(0.2);
    s.mat.color.set(colorHex);
    s.mesh.visible = true;
  }

  /** Acquire a pooled expanding blast dome (cataclysm-sized hits). */
  _dome(pos, radius, colorHex, duration = 0.8) {
    const d = this.domes.find(x => !x.active) || this.domes[0];
    d.active = true;
    d.elapsed = 0;
    d.duration = duration;
    d.maxRadius = radius;
    d.mesh.position.set(pos.x, 0.2, pos.z);
    d.mesh.scale.setScalar(0.1);
    d.mat.color.set(colorHex);
    d.mesh.visible = true;
  }

  _spawnGroundArcs(pos, radius, colorHex) {
    const a = this.arcWebs.find(x => !x.active) || this.arcWebs[0];
    a.spawn(pos, radius, colorHex);
  }

  _spawnCrackWeb(pos, radius, colorHex) {
    const c = this.crackWebs.find(x => !x.active) || this.crackWebs[0];
    c.spawn(pos, radius, colorHex);
  }

  _spawnFireColumn(pos, radius, height, colorHex) {
    const f = this.fireColumns.find(x => !x.active) || this.fireColumns[0];
    f.spawn(pos, radius, height, colorHex);
  }

  _spawnSirenDome(pos, radius, colorHex) {
    const s = this.sirenDomes.find(x => !x.active) || this.sirenDomes[0];
    s.spawn(pos, radius, colorHex);
  }

  _spawnCloudPuffs(pos, radius, colorHex) {
    const c = this.cloudPuffs.find(x => !x.active) || this.cloudPuffs[0];
    c.spawn(pos, radius, colorHex);
  }

  /**
   * ONE-PIECE STYLE: energy aura shell that erupts around the caster
   * on skill use (expanding wireframe icosahedron + ring + sparks).
   */
  auraBurst(pos, colorHex, radius = 10.0) {
    const a = this.auraBursts.find(x => !x.active) || this.auraBursts[0];
    a.active = true;
    a.elapsed = 0;
    a.duration = 0.45;
    a.maxR = radius;
    a.mesh.position.copy(pos);
    a.mesh.position.y += 1.3;
    a.mat.color.set(colorHex);
    a.mesh.visible = true;
    this._spawnEmbers(pos, colorHex, radius * 0.7);
    this._blastWall(pos, radius * 0.8, colorHex);
    this._markImpact(pos, radius * 0.5, false);
  }

  /**
   * ONE-PIECE STYLE: swirling suction vortex column (spiral particles
   * + dual counter-rotating rings + core pillar + rising lift-ring)
   * used by gravity / suction / storm skills.
   */
  vortex(pos, colorHex, radius = 12.0, duration = 3.0) {
    const v = this.vortices.find(x => !x.active) || this.vortices[0];
    v.active = true;
    v.elapsed = 0;
    v.duration = duration;
    v.radius = radius;
    v.pts.position.set(pos.x, 0.3, pos.z);
    v.pts.visible = true;
    v.mat.color.set(colorHex);
    v.ring.position.set(pos.x, 0.6, pos.z);
    v.ring.rotation.x = Math.PI / 2;
    v.ringMat.color.set(colorHex);
    v.ring.visible = true;
    v.ring2.position.set(pos.x, 1.4, pos.z);
    v.ring2.rotation.x = Math.PI / 2;
    v.ring2Mat.color.set(colorHex);
    v.ring2.visible = true;
    v.pillar.position.set(pos.x, 13, pos.z);
    v.pillarMat.color.set(colorHex);
    v.pillar.visible = true;
    v.liftRing.position.set(pos.x, 1, pos.z);
    v.liftMat.color.set(colorHex);
    v.liftRing.visible = true;
    return v;
  }

  /**
   * ONE-PIECE STYLE: colossal triple staggered shockwave rings that
   * race across the battlefield (cataclysm finishers).
   */
  megaShockwave(pos, radius = 60.0, colorHex = 0xffffff) {
    const w = this.megaWaves.find(x => !x.active) || this.megaWaves[0];
    w.active = true;
    w.elapsed = 0;
    w.duration = 1.1 + radius * 0.012;
    w.maxR = radius;
    for (const r of w.set) {
      r.mesh.position.set(pos.x, 0.4, pos.z);
      r.mat.color.set(colorHex);
      r.mesh.visible = true;
      r.mat.opacity = 0;
    }
    this._blastWall(pos, radius * 0.7, colorHex);
    // White-hot core ring for the finisher impact
    this._ring(pos, radius * 0.55, 0xffffff, 0.5);
  }

  /**
   * ONE-PIECE STYLE: thick cinematic energy beam between two points,
   * with an outer glow hull and a traveling energy pulse.
   */
  beam(from, to, radius = 2.0, colorHex = 0xffffff) {
    const b = this.beams.find(x => !x.active) || this.beams[0];
    b.active = true;
    b.elapsed = 0;
    b.duration = 0.32;
    b.radius = radius;
    b.from.copy(from);
    b.to.copy(to);
    const mid = _beamMid.addVectors(from, to).multiplyScalar(0.5);
    b.mesh.position.copy(mid);
    b.mesh.lookAt(to);
    const len = from.distanceTo(to);
    b.mesh.scale.set(radius, radius, len);
    b.mat.color.set(colorHex);
    b.mesh.visible = true;

    b.glow.position.copy(mid);
    b.glow.lookAt(to);
    b.glow.scale.set(radius * 2.3, radius * 2.3, len);
    b.glowMat.color.set(colorHex);
    b.glow.visible = true;

    b.pulse.scale.setScalar(radius * 3.2);
    b.pulseMat.color.set(0xffffff);
    b.pulse.position.copy(from);
    b.pulse.visible = true;

    this._spawnFlashLight(mid, colorHex, radius * 2.0, 0.3);
  }

  _spawnFlashLight(pos, colorHex, radius, duration = 0.55) {
    let fl = this.flashLights.find(f => !f.light.visible);
    if (!fl) fl = this.flashLights[0];
    fl.light.position.set(pos.x, pos.y + Math.min(6, radius * 0.3) + 2, pos.z);
    fl.light.color.set(colorHex);
    fl.light.distance = Math.min(420, 60 + radius * 6);
    fl.light.visible = true;
    fl.peak = 120 + radius * 26;
    fl.duration = duration;
    fl.elapsed = 0;
  }

  _spawnEmbers(pos, colorHex, radius) {
    const b = this.emberBursts.find(e => !e.active);
    if (!b) return;
    b.spawn(pos, colorHex, radius);
  }

  _spawnSmoke(pos, radius, dark = true) {
    const s = this.smokeBursts.find(s => !s.active);
    if (!s) return;
    s.spawn(pos, radius, dark);
  }

  /**
   * Spawns an explosion with distinct visual style and 3D physical
   * instanced debris. ZERO allocations: every visual is acquired from
   * a pre-allocated pool.
   *
   * @param {THREE.Vector3} pos - Explosion world coordinate
   * @param {number} radius - Meter radius of the explosion blast
   * @param {string} type - 'asteroid' | 'lightning' | 'quake' | 'alarm' | 'ice' | 'fire' | 'cloud'
   * @param {number} shakeIntensity - Base intensity for camera shake
   */
  createExplosion(pos, radius = 10.0, type = 'asteroid', shakeIntensity = 1.5) {
    const pal = PALETTES[type] || PALETTES.asteroid;
    const colorHex = pal.color;
    const shockColor = pal.shock;

    // 1. Trigger distance-scaled positional camera shake
    if (this.cameraController) {
      this.cameraController.addShake(pos, shakeIntensity, 0.45 + radius * 0.02);
    }

    // 2. Play synthesized explosion audio
    if (this.sound) {
      if (type === 'quake') {
        this.sound.playQuakeBoom();
      } else if (type === 'ice') {
        this.sound.playFreezeShatter();
      } else {
        this.sound.playExplosion(Math.min(1.0, 0.5 + radius * 0.03));
      }
    }

    // 3. Pooled one-shot core: plasma core + energy shell + shock ring
    this._core(pos, radius * 0.8, 0xffffff, 0.28);
    this._shell(pos, radius * 1.05, colorHex, 0.42);
    this._ring(pos, radius, shockColor, 0.35 + radius * 0.02);
    // Secondary delayed inner ring (double-pulse punch)
    if (radius >= 10) this._ring(pos, radius * 0.62, colorHex, 0.3 + radius * 0.015, 0.07);
    // Cataclysm dome for arena-scale hits
    if (radius >= 26) this._dome(pos, radius, colorHex, 0.85);

    // 4. DYNAMIC LIGHT - the arena is really lit by the blast
    this._spawnFlashLight(pos, colorHex, radius, 0.45 + radius * 0.02);

    // 4b. Persistent scorch mark + volumetric blast wall (big blasts)
    const isGlow = (type === 'lightning' || type === 'ice' || type === 'quake');
    if (radius >= 6) this._markImpact(pos, radius, isGlow);
    if (radius >= 14) this._blastWall(pos, radius, colorHex);

    // 5. EMBERS + SMOKE (per-type personality)
    this._spawnEmbers(pos, colorHex, radius);
    if (type === 'fire' || type === 'asteroid') {
      this._spawnSmoke(pos, radius, type === 'asteroid');
    } else if (type === 'ice') {
      this._spawnSmoke(pos, radius, false);
    }

    // 6. INSTANCED PHYSICS DEBRIS (distinct shape per category)
    let count = this.debrisCountPerExplosion;
    if (radius >= 20) count += Math.floor((radius - 20) * 0.8); // big hits throw more
    if (type === 'fire') count = Math.floor(count * 1.4);       // fire shreds
    this.debrisSystems[pal.debrisSys].spawn(pos, pal.debrisColor, Math.min(96, count), radius);

    // 7. PER-FRUIT SIGNATURE VFX (the 10,000x layer)
    if (type === 'lightning') {
      this._spawnGroundArcs(pos, Math.max(8, radius * 0.9), 0x9ff4ff);
      // White-hot core ring racing the shock
      this._ring(pos, radius * 0.8, 0xffffff, 0.25);
    } else if (type === 'quake') {
      this._spawnCrackWeb(pos, Math.max(12, radius * 1.1), 0x9fe8ff);
      this._blastWall(pos, radius, colorHex);
    } else if (type === 'fire') {
      this._spawnFireColumn(pos, radius, Math.min(34, 8 + radius * 0.75), 0xff7722);
      this._spawnEmbers(pos, 0xffaa33, radius * 1.25); // ember fountain
    } else if (type === 'alarm') {
      this._spawnSirenDome(pos, radius, 0xff2244);
      this._ring(pos, radius * 0.75, 0xff6688, 0.4, 0.12);
    } else if (type === 'ice') {
      // Frost spray: fast small crystalline shards + double frost ring
      this.debrisSystems[3].spawn(pos, 0xeaf9ff, Math.min(40, Math.floor(count * 0.8)), radius * 1.4, 1.7, 0.45);
      this._ring(pos, radius * 0.85, 0xeaf9ff, 0.3, 0.1);
      this._dome(pos, Math.max(10, radius * 0.7), 0xbfeeff, 0.55);
      this._spawnSmoke(pos, radius, false);
    } else if (type === 'cloud') {
      this._spawnCloudPuffs(pos, Math.max(10, radius * 0.9), 0xf4f8ff);
      this._spawnSmoke(pos, radius, false);
    } else if (type === 'asteroid') {
      this._spawnEmbers(pos, 0xffcc55, radius * 1.3); // heavy scorched embers
    }
  }

  /**
   * Frame update for physics debris, shockwave rings, flashes and all
   * cinematic pools. Allocation-free.
   */
  update(dt) {
    // Instanced debris (4 systems, 4 draw calls)
    for (const ds of this.debrisSystems) ds.update(dt);

    // Shockwave rings (supports delayed start via negative elapsed)
    for (const s of this.shockRings) {
      if (!s.active) continue;
      s.elapsed += dt;
      if (s.elapsed < 0) continue;
      const t = s.elapsed / s.duration;
      if (t >= 1.0) {
        s.active = false;
        s.mesh.visible = false;
        continue;
      }
      const r = s.maxRadius * (1.0 - Math.pow(1.0 - t, 2.5));
      s.mesh.scale.setScalar(Math.max(0.05, r));
      s.mat.opacity = (1.0 - t) * 0.9;
    }

    // Plasma cores
    for (const c of this.cores) {
      if (!c.active) continue;
      c.elapsed += dt;
      const t = c.elapsed / c.duration;
      if (t >= 1.0) {
        c.active = false;
        c.mesh.visible = false;
        continue;
      }
      const sc = c.maxScale * Math.sin(t * Math.PI * 0.5);
      c.mesh.scale.setScalar(Math.max(0.05, sc));
      c.mat.opacity = Math.cos(t * Math.PI * 0.5);
    }

    // Energy shells
    for (const s of this.shells) {
      if (!s.active) continue;
      s.elapsed += dt;
      const t = s.elapsed / s.duration;
      if (t >= 1.0) {
        s.active = false;
        s.mesh.visible = false;
        continue;
      }
      const sc = s.maxScale * (1.0 - Math.pow(1.0 - t, 3.0));
      s.mesh.scale.setScalar(Math.max(0.05, sc));
      s.mat.opacity = Math.pow(1.0 - t, 1.6) * 0.55;
    }

    // Blast domes
    for (const d of this.domes) {
      if (!d.active) continue;
      d.elapsed += dt;
      const t = d.elapsed / d.duration;
      if (t >= 1.0) {
        d.active = false;
        d.mesh.visible = false;
        continue;
      }
      const ease = 1.0 - Math.pow(1.0 - t, 2.6);
      d.mesh.scale.setScalar(Math.max(0.05, d.maxRadius * ease));
      d.mat.opacity = Math.pow(1.0 - t, 1.8) * 0.4;
    }

    // Per-fruit signature pools
    for (const a of this.arcWebs) a.update(dt);
    for (const c of this.crackWebs) c.update(dt);
    for (const f of this.fireColumns) f.update(dt);
    for (const s of this.sirenDomes) s.update(dt);
    for (const c of this.cloudPuffs) c.update(dt);

    // Dynamic flash lights
    for (const fl of this.flashLights) {
      if (!fl.light.visible) continue;
      fl.elapsed += dt;
      const t = fl.elapsed / fl.duration;
      if (t >= 1.0) {
        fl.light.visible = false;
        fl.light.intensity = 0;
        continue;
      }
      const decay = Math.pow(1.0 - t, 2.0);
      fl.light.intensity = fl.peak * decay;
    }

    for (const e of this.emberBursts) e.update(dt);
    for (const s of this.smokeBursts) s.update(dt);

    // Persistent scorch marks: linger, then slowly fade out
    for (const m of this.scorchPool) {
      if (!m.active) continue;
      m.elapsed += dt;
      if (m.elapsed >= m.duration) {
        m.active = false;
        m.mesh.visible = false;
        continue;
      }
      const remain = m.duration - m.elapsed;
      m.mat.opacity = m.baseOpacity * Math.min(1, remain / 5.0);
      m.mesh.rotation.z += dt * 0.015;
    }
    for (const m of this.glowPool) {
      if (!m.active) continue;
      m.elapsed += dt;
      const t = m.elapsed / m.duration;
      if (t >= 1.0) {
        m.active = false;
        m.mesh.visible = false;
        continue;
      }
      const flicker = 0.8 + 0.2 * Math.sin(m.elapsed * 30.0);
      m.mat.opacity = m.baseOpacity * (1.0 - t) * flicker;
      m.mesh.scale.setScalar(m.baseScale * (1.0 + t * 0.4));
    }

    // Volumetric blast walls
    for (const w of this.blastWalls) {
      if (!w.active) continue;
      w.elapsed += dt;
      const t = w.elapsed / w.duration;
      if (t >= 1.0) {
        w.active = false;
        w.mesh.visible = false;
        continue;
      }
      const ease = 1.0 - Math.pow(1.0 - t, 2.2);
      const r = Math.max(0.001, w.maxR * ease);
      w.mesh.scale.set(r, w.height * (1.0 - t * 0.55), r);
      w.mat.opacity = (1.0 - t) * 0.3;
    }

    // Cinematic aura bursts (skill cast shells)
    for (const a of this.auraBursts) {
      if (!a.active) continue;
      a.elapsed += dt;
      const t = a.elapsed / a.duration;
      if (t >= 1.0) {
        a.active = false;
        a.mesh.visible = false;
        continue;
      }
      const ease = 1.0 - Math.pow(1.0 - t, 2.6);
      a.mesh.scale.setScalar(Math.max(0.001, a.maxR * ease));
      a.mesh.rotation.y += dt * 3.0;
      a.mesh.rotation.x += dt * 1.4;
      a.mat.opacity = (1.0 - t) * 0.85;
    }

    // Cinematic vortices (spiral suction columns with rings + pillar + lift)
    for (const v of this.vortices) {
      if (!v.active) continue;
      v.elapsed += dt;
      const t = v.elapsed / v.duration;
      if (t >= 1.0) {
        v.active = false;
        v.pts.visible = false;
        v.ring.visible = false;
        v.ring2.visible = false;
        v.pillar.visible = false;
        v.liftRing.visible = false;
        continue;
      }
      const fadeIn = Math.min(1, t * 5);
      const fadeOut = Math.min(1, (1 - t) * 4);
      v.mat.opacity = 0.9 * fadeIn * fadeOut;
      v.ringMat.opacity = 0.55 * fadeIn * fadeOut;
      v.ring2Mat.opacity = 0.4 * fadeIn * fadeOut;

      const height = 26.0 * (0.6 + 0.4 * fadeIn);

      const posAttr = v.pts.geometry.attributes.position;
      const arr = posAttr.array;
      const spin = t * 14.0;
      const pullIn = 1.0 - t * 0.75; // spirals tighten as it matures
      for (let j = 0; j < v.count; j++) {
        const angle = v.seeds[j * 2] + spin * (1.2 + v.seeds[j * 2 + 1] * 0.8);
        const rf = v.seeds[j * 2 + 1];
        const hNorm = (v.seeds[j * 2] * 0.159 + t * 1.7) % 1.0; // rising particles
        const r = v.radius * rf * pullIn * (0.35 + 0.65 * hNorm);
        arr[j * 3 + 0] = Math.cos(angle) * r;
        arr[j * 3 + 1] = hNorm * height;
        arr[j * 3 + 2] = Math.sin(angle) * r;
      }
      posAttr.needsUpdate = true;

      const rr = v.radius * (0.7 + 0.3 * Math.sin(v.elapsed * 5.0)) * pullIn;
      v.ring.scale.setScalar(Math.max(0.001, rr));
      v.ring.rotation.z += dt * 4.0;

      const rr2 = rr * 0.62;
      v.ring2.scale.setScalar(Math.max(0.001, rr2));
      v.ring2.rotation.z -= dt * 6.0;
      v.ring2.position.y = 1.4 + Math.sin(v.elapsed * 3.0) * 0.6;

      // Core pillar: grows with the column, subtly pulsing
      v.pillar.scale.set(Math.max(0.05, v.radius * 0.5 * pullIn), height, Math.max(0.05, v.radius * 0.5 * pullIn));
      v.pillar.position.y = height * 0.5;
      v.pillarMat.opacity = (0.1 + 0.05 * Math.sin(v.elapsed * 7.0)) * fadeIn * fadeOut;

      // Lift ring: travels up the column, expanding as it rises
      const liftT = (v.elapsed / v.duration);
      v.liftRing.position.y = 0.5 + liftT * height * 1.05;
      v.liftRing.scale.setScalar(Math.max(0.05, v.radius * (0.8 + liftT * 0.7) * pullIn));
      v.liftMat.opacity = Math.pow(1.0 - liftT, 1.4) * 0.5 * fadeIn;
    }

    // Colossal staggered shockwaves
    for (const w of this.megaWaves) {
      if (!w.active) continue;
      w.elapsed += dt;
      let allDone = true;
      for (const r of w.set) {
        const lt = (w.elapsed - r.delay) / (w.duration - r.delay);
        if (lt < 0) { allDone = false; continue; }
        if (lt >= 1.0) {
          r.mesh.visible = false;
          continue;
        }
        allDone = false;
        const ease = 1.0 - Math.pow(1.0 - lt, 2.4);
        const rad = Math.max(0.001, w.maxR * ease);
        r.mesh.scale.setScalar(rad);
        r.mat.opacity = (1.0 - lt) * 0.8;
      }
      if (allDone) {
        w.active = false;
      }
    }

    // Cinematic beams (core + glow hull + traveling pulse)
    for (const b of this.beams) {
      if (!b.active) continue;
      b.elapsed += dt;
      const t = b.elapsed / b.duration;
      if (t >= 1.0) {
        b.active = false;
        b.mesh.visible = false;
        b.glow.visible = false;
        b.pulse.visible = false;
        continue;
      }
      const thicken = 1.0 + Math.sin(t * Math.PI) * 0.8;
      b.mesh.scale.x = b.radius * thicken;
      b.mesh.scale.y = b.radius * thicken;
      b.glow.scale.x = b.radius * 2.3 * thicken;
      b.glow.scale.y = b.radius * 2.3 * thicken;
      b.mat.opacity = (1.0 - t * t) * 0.95;
      b.glowMat.opacity = (1.0 - t * t) * 0.28;
      // Pulse travels from -> to (with a little overshoot)
      _beamPulse.copy(b.from).lerp(b.to, Math.min(1.1, t * 1.15));
      b.pulse.position.copy(_beamPulse);
      b.pulseMat.opacity = (1.0 - t) * 0.9;
    }
  }

  getActiveDebrisCount() {
    let n = 0;
    for (const ds of this.debrisSystems) {
      for (let i = 0; i < ds.capacity; i++) if (ds.state[i] !== 0) n++;
    }
    return n;
  }
}

// Module scratch (pre-method): beam midpoint / pulse position math
const _beamMid = new THREE.Vector3();
const _beamPulse = new THREE.Vector3();
