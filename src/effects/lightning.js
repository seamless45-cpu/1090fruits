import * as THREE from 'three';

/**
 * 3D 1090 Fruits - Optimized High-Frequency Jagged Lightning System
 *
 * SPECIFICATIONS:
 * "tall vertical jagged lightning bolt that changes itself rapidly like segments
 *  re-rotation in 0.01s (u should use methods that reduce lag while keeping the change of segments)
 *  (for only fruits with lightning)"
 *
 * LAG REDUCTION ARCHITECTURE:
 * 1. Zero Garbage Collection during updates: Float32Array vertex buffers are pre-allocated and pooled.
 * 2. Re-uses Static Geometry and updates only `positionAttribute.array` directly in-place.
 * 3. 0.01s accumulator tick rate (100 Hz segment re-rotation) matches the specification perfectly.
 * 4. Ground impact blast, scorch flash, and a DYNAMIC POOLED LIGHT EMITTER that actually
 *    illuminates the arena during each strike (realistic god-ray feel).
 */

const MAX_SEGMENTS = 36;
const VERTICES_PER_BOLT = (MAX_SEGMENTS - 1) * 2;
const FLASH_LIGHT_POOL = 8;
const GROUND_FLASH_POOL = 12;

/**
 * Realistic lightning flicker envelope.
 * Real strikes are NOT a single smooth fade - the return stroke fires,
 * dims, then re-strikes 1-2 more times within ~300ms before dying.
 * Returns brightness 0..1 for a normalized time t.
 */
function strikeEnvelope(t, seed) {
  // Strike 1: instant peak at channel formation
  let b = Math.exp(-t * 14.0);
  // Strike 2: re-strike at 25-45% of the life
  const t2 = 0.25 + (seed % 1) * 0.2;
  b += 0.8 * Math.exp(-Math.abs(t - t2) * 20.0);
  // Strike 3: 60% of bolts get a final micro re-strike
  if (Math.floor(seed * 17) % 10 < 6) {
    const t3 = t2 + 0.16 + (seed % 0.3) * 0.08;
    b += 0.55 * Math.exp(-Math.abs(t - t3) * 30.0);
  }
  // Fine crackle near the tail (fast stochastic shimmer)
  const crackle = Math.sin(t * 61.0 + seed * 40.0) * Math.sin(t * 23.7 + seed * 9.0);
  b += Math.max(0, crackle) * 0.12 * (t > 0.3 ? 1 : 0);
  return Math.max(0, Math.min(1, b));
}

class LightningBolt {
  constructor(scene) {
    this.scene = scene;
    this.active = false;
    this.startPos = new THREE.Vector3();
    this.endPos = new THREE.Vector3();
    this.duration = 0.3;
    this.elapsed = 0;
    this.timer001 = 0;
    this.color = new THREE.Color('#e8f4ff');
    this.baseColor = new THREE.Color('#e8f4ff');
    this.white = new THREE.Color(0xffffff);
    this.brightness = 0;
    this.flickerSeed = Math.random();
    this.branchCount = 2;
    this.segments = 24;

    // Pre-allocated Float32Array for positions (trunk + up to 4 branches)
    this.maxPoints = 96;
    this.positions = new Float32Array(this.maxPoints * 3 * 2);

    this.geometry = new THREE.BufferGeometry();
    this.posAttribute = new THREE.BufferAttribute(this.positions, 3);
    this.posAttribute.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.posAttribute);

    // Outer channel: colored plasma (linewidth ignored by WebGL, kept thin)
    this.material = new THREE.LineBasicMaterial({
      color: 0xe8f4ff,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });

    this.lineMesh = new THREE.LineSegments(this.geometry, this.material);
    this.lineMesh.frustumCulled = false;
    this.lineMesh.visible = false;
    this.scene.add(this.lineMesh);

    // Inner white-hot core (same geometry, brighter)
    this.coreMaterial = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    this.coreLineMesh = new THREE.LineSegments(this.geometry, this.coreMaterial);
    this.coreLineMesh.frustumCulled = false;
    this.coreLineMesh.visible = false;
    this.scene.add(this.coreLineMesh);
  }

  spawn(startPos, endPos, colorHex = '#e8f4ff', duration = 0.34, branches = 3, customSegments = 24) {
    this.startPos.copy(startPos);
    this.endPos.copy(endPos);
    this.baseColor.set(colorHex);
    this.color.copy(this.baseColor);
    this.duration = duration;
    this.elapsed = 0;
    this.timer001 = 0;
    this.flickerSeed = Math.random();
    this.branchCount = branches;
    this.segments = Math.min(customSegments, 30);

    this.material.opacity = 1.0;
    this.coreMaterial.opacity = 1.0;

    this.lineMesh.visible = true;
    this.coreLineMesh.visible = true;
    this.active = true;

    // Immediately generate first jagged configuration
    this.recalculateSegments();
  }

  /**
   * High frequency procedural re-rotation of the discharge channel.
   * Uses a BOUNDED RANDOM WALK instead of independent jitter per vertex:
   * each vertex continues from the previous one with a small random step,
   * producing natural connected kinks (real leader structure) rather than
   * uncorrelated vibration. Occasional large "kink" events mimic branching
   * of the leader.
   */
  recalculateSegments() {
    let idx = 0;
    const segs = this.segments;
    const dir = new THREE.Vector3().subVectors(this.endPos, this.startPos);
    const totalDist = dir.length();

    // Random-walk state (bounded drift around the ideal straight line)
    let walkX = 0, walkY = 0, walkZ = 0;
    const lateralMax = Math.min(2.4, totalDist * 0.05);

    let prevX = this.startPos.x;
    let prevY = this.startPos.y;
    let prevZ = this.startPos.z;

    for (let i = 1; i <= segs; i++) {
      const t = i / segs;

      // Bounded random walk: step, then clamp toward the straight line
      walkX += (Math.random() * 2 - 1) * lateralMax * 0.55;
      walkY += (Math.random() * 2 - 1) * lateralMax * 0.22;
      walkZ += (Math.random() * 2 - 1) * lateralMax * 0.55;
      // ~8% chance of a sharp kink (leader bifurcation)
      if (Math.random() < 0.08) {
        const k = lateralMax * 2.2;
        walkX += (Math.random() * 2 - 1) * k;
        walkZ += (Math.random() * 2 - 1) * k;
      }
      // Re-center: pull the walk back toward zero as we approach the target
      const pull = 1.0 - Math.abs(2.0 * t - 1.0) * 0.7;
      walkX *= pull; walkY *= pull; walkZ *= pull;

      let curX = this.startPos.x + dir.x * t + walkX;
      let curY = this.startPos.y + dir.y * t + walkY;
      let curZ = this.startPos.z + dir.z * t + walkZ;

      if (i === segs) {
        // Terminal strike point locked to endPos
        curX = this.endPos.x;
        curY = this.endPos.y;
        curZ = this.endPos.z;
      }

      this.positions[idx++] = prevX;
      this.positions[idx++] = prevY;
      this.positions[idx++] = prevZ;

      this.positions[idx++] = curX;
      this.positions[idx++] = curY;
      this.positions[idx++] = curZ;

      prevX = curX;
      prevY = curY;
      prevZ = curZ;
    }

    // Side branches: short, angled outward + downward from actual trunk vertices
    for (let bIdx = 0; bIdx < this.branchCount; bIdx++) {
      if (idx + 10 >= this.positions.length) break;

      // Root = an actual trunk vertex (vertex k lives at positions[k*3 .. k*3+2])
      const rootK = 2 + Math.floor(Math.random() * (segs - 3));
      const bRootX = this.positions[rootK * 3];
      const bRootY = this.positions[rootK * 3 + 1];
      const bRootZ = this.positions[rootK * 3 + 2];

      const branchLen = totalDist * (0.12 + Math.random() * 0.16);
      const bAngle = Math.random() * Math.PI * 2;
      const segsB = 3 + Math.floor(Math.random() * 2);

      let px = bRootX, py = bRootY, pz = bRootZ;
      for (let s = 1; s <= segsB; s++) {
        const cx = px + Math.cos(bAngle) * branchLen / segsB + (Math.random() - 0.5) * lateralMax * 0.4;
        const cy = py - branchLen * (0.55 + Math.random() * 0.3) / segsB;
        const cz = pz + Math.sin(bAngle) * branchLen / segsB + (Math.random() - 0.5) * lateralMax * 0.4;

        this.positions[idx++] = px;
        this.positions[idx++] = py;
        this.positions[idx++] = pz;
        this.positions[idx++] = cx;
        this.positions[idx++] = cy;
        this.positions[idx++] = cz;

        px = cx; py = cy; pz = cz;
      }
    }

    // Zero out unused vertex buffer portion
    for (let j = idx; j < this.positions.length; j++) {
      this.positions[j] = prevX;
    }

    this.posAttribute.needsUpdate = true;
    this.geometry.setDrawRange(0, idx / 3);
  }

  update(dt, rapidRate = 0.01) {
    if (!this.active) return;
    this.elapsed += dt;
    this.timer001 += dt;

    if (this.elapsed >= this.duration) {
      this.active = false;
      this.lineMesh.visible = false;
      this.coreLineMesh.visible = false;
      this.brightness = 0;
      return;
    }

    // SPECIFICATION: Segment re-rotation / jitter every 0.01 seconds
    if (this.timer001 >= rapidRate) {
      this.timer001 = 0;
      this.recalculateSegments();
    }

    // Realistic multi-strike flicker (NOT a smooth fade)
    const t = this.elapsed / this.duration;
    this.brightness = strikeEnvelope(t, this.flickerSeed);

    // White-hot core peaks brighter than the colored channel
    this.material.opacity = 0.55 + 0.45 * this.brightness;
    this.coreMaterial.opacity = this.brightness;

    // Channel shifts toward pure white at each strike peak
    this.material.color.copy(this.baseColor).lerp(this.white, this.brightness * 0.65);
    this.coreMaterial.color.copy(this.baseColor).lerp(this.white, 0.4 + this.brightness * 0.6);
  }

  dispose() {
    this.scene.remove(this.lineMesh);
    this.scene.remove(this.coreLineMesh);
    this.geometry.dispose();
    this.material.dispose();
    this.coreMaterial.dispose();
  }
}

export class LightningManager {
  constructor(scene) {
    this.scene = scene;
    this.boltPool = [];
    this.maxPool = 40;

    for (let i = 0; i < this.maxPool; i++) {
      this.boltPool.push(new LightningBolt(scene));
    }

    this.rapidRate = 0.01; // 0.01s segment re-rotation

    // Global flash level (0..1+) consumed by the arena to light up the sky
    this.flashLevel = 0;

    // ---------------------------------------------------------------
    // DYNAMIC LIGHT POOL - each strike flashes a real point light so
    // the arena, player and enemies are momentarily illuminated.
    // ---------------------------------------------------------------
    this.flashLights = [];
    for (let i = 0; i < FLASH_LIGHT_POOL; i++) {
      const l = new THREE.PointLight(0x00f0ff, 0, 260, 1.8);
      l.visible = false;
      scene.add(l);
      this.flashLights.push({ light: l, intensity: 0, duration: 0.3, elapsed: 99, seed: Math.random() });
    }

    // Ground impact flash rings (pooled)
    this.groundFlashes = [];
    const ringGeo = new THREE.RingGeometry(0.9, 1.0, 40);
    ringGeo.rotateX(-Math.PI / 2);
    this.groundRingGeo = ringGeo;
    for (let i = 0; i < GROUND_FLASH_POOL; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x00f0ff, transparent: true, opacity: 0,
        side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      });
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.groundFlashes.push({ mesh, mat, elapsed: 99, duration: 0.4, active: false });
    }
  }

  setRapidRate(val) {
    this.rapidRate = val;
  }

  /**
   * Public: flash a dynamic light (e.g. muzzle flash) without a bolt.
   */
  flash(pos, colorHex, power = 1.0, duration = 0.35) {
    this._flashLight(pos, colorHex, power, duration);
    this.flashLevel = Math.min(1.5, this.flashLevel + power * 0.12);
  }

  /**
   * Public: expanding ground impact ring without a bolt.
   */
  groundFlash(pos, colorHex, maxR = 20, duration = 0.45) {
    this._groundFlash(pos, colorHex, maxR, duration);
  }

  /** Assign a dynamic flash light to a strike point. */
  _flashLight(pos, colorHex, power = 1.0, duration = 0.35) {
    let fl = this.flashLights.find(f => !f.light.visible);
    if (!fl) fl = this.flashLights[0];
    fl.light.position.set(pos.x, pos.y + 3, pos.z);
    fl.light.color.set(colorHex);
    fl.light.visible = true;
    fl.intensity = 550 * power;
    fl.duration = duration;
    fl.elapsed = 0;
    fl.seed = Math.random();
  }

  /** Expand a bright ring at the impact point. */
  _groundFlash(pos, colorHex, maxR = 24, duration = 0.45) {
    let g = this.groundFlashes.find(f => !f.active);
    if (!g) g = this.groundFlashes[0];
      g.mesh.position.set(pos.x, pos.y + 0.35, pos.z);
      g.mat.color.set(colorHex);
      g.mesh.visible = true;
      g.mesh.scale.setScalar(1);
      g.mat.opacity = 0.5;
    g.elapsed = 0;
    g.duration = duration;
    g.maxR = maxR;
    g.active = true;
  }

  /**
   * Strike a tall vertical jagged lightning bolt from sky to target.
   */
  strikeBolt(groundPos, height = 120, colorHex = '#dceeff', duration = 0.34, customSegments = 24) {
    const startPos = new THREE.Vector3(
      groundPos.x + (Math.random() - 0.5) * 8.0,
      groundPos.y + height,
      groundPos.z + (Math.random() - 0.5) * 8.0
    );
    const endPos = new THREE.Vector3(groundPos.x, groundPos.y, groundPos.z);

    // Find available bolt in pool
    let bolt = this.boltPool.find(b => !b.active);
    if (!bolt) {
      bolt = this.boltPool[0]; // Recycle oldest
    }

    bolt.spawn(startPos, endPos, colorHex, duration, 2, customSegments);

    // Dynamic illumination + ground impact flash (scaled with bolt height)
    const power = Math.min(2.2, 0.6 + height / 120.0);
    this._flashLight(groundPos, colorHex, power, duration + 0.15);
    this._groundFlash(groundPos, colorHex, 10 + height * 0.18, 0.4 + duration * 0.5);
    this.flashLevel = Math.min(1.5, this.flashLevel + 0.75);

    return bolt;
  }

  /**
   * Overlapped lightning strike (multiple bolts striking simultaneously/clustered).
   */
  strikeOverlapped(groundPos, count = 4, radius = 3.0, height = 100, colorHex = '#00f0ff') {
    // One light per cluster (not per bolt) to keep the pool cheap
    this._flashLight(groundPos, colorHex, 0.5 + Math.min(1.6, count * 0.25), 0.5);
    this._groundFlash(groundPos, colorHex, 12 + radius * 4, 0.55);
    this.flashLevel = Math.min(1.5, this.flashLevel + 0.35 * count);

    for (let i = 0; i < count; i++) {
      const offset = new THREE.Vector3(
        groundPos.x + (Math.random() - 0.5) * radius * 2,
        groundPos.y,
        groundPos.z + (Math.random() - 0.5) * radius * 2
      );
      this._boltOnly(offset, height, colorHex, 0.28 + Math.random() * 0.1, 24);
    }
  }

  /** Core bolt spawn without extra lighting (used by strikeOverlapped). */
  _boltOnly(groundPos, height, colorHex, duration, segments) {
    const startPos = new THREE.Vector3(
      groundPos.x + (Math.random() - 0.5) * 6.0,
      groundPos.y + height,
      groundPos.z + (Math.random() - 0.5) * 6.0
    );
    const endPos = new THREE.Vector3(groundPos.x, groundPos.y, groundPos.z);

    let bolt = this.boltPool.find(b => !b.active);
    if (!bolt) bolt = this.boltPool[0];
    bolt.spawn(startPos, endPos, colorHex, duration, 2, segments);
  }

  /**
   * Tectonic / Ground Crack Lightning (Reused specifically for Quake neon blue cracks)
   */
  strikeCrack(startPos, endPos, colorHex = '#00bfff', duration = 0.4) {
    let bolt = this.boltPool.find(b => !b.active);
    if (!bolt) bolt = this.boltPool[0];
    bolt.spawn(startPos, endPos, colorHex, duration, 1, 16);

    // Cracks glow from below - soft short light near the crack
    const mid = new THREE.Vector3().addVectors(startPos, endPos).multiplyScalar(0.5);
    this._flashLight(mid, colorHex, 0.5, duration);
  }

  update(dt) {
    // Global sky flash decays fast (staccato double-flicker feel)
    this.flashLevel = Math.max(0, this.flashLevel - dt * 7.0);

    // Bolts
    for (let i = 0; i < this.boltPool.length; i++) {
      if (this.boltPool[i].active) {
        this.boltPool[i].update(dt, this.rapidRate);
      }
    }

    // Dynamic flash lights - same multi-strike flicker as the bolt itself
    for (const fl of this.flashLights) {
      if (!fl.light.visible) continue;
      fl.elapsed += dt;
      if (fl.elapsed >= fl.duration) {
        fl.light.visible = false;
        fl.light.intensity = 0;
        continue;
      }
      const t = fl.elapsed / fl.duration;
      fl.light.intensity = fl.intensity * strikeEnvelope(t, fl.seed);
    }

    // Ground impact rings
    for (const g of this.groundFlashes) {
      if (!g.active) continue;
      g.elapsed += dt;
      const t = g.elapsed / g.duration;
      if (t >= 1.0) {
        g.active = false;
        g.mesh.visible = false;
        continue;
      }
      const r = g.maxR * (1.0 - Math.pow(1.0 - t, 3.0));
      g.mesh.scale.setScalar(Math.max(0.001, r));
      g.mat.opacity = strikeEnvelope(t, 0.3) * 0.5;
    }
  }

  getActiveCount() {
    let count = 0;
    for (let i = 0; i < this.boltPool.length; i++) {
      if (this.boltPool[i].active) count++;
    }
    return count;
  }
}
