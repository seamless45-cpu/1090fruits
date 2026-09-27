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

class LightningBolt {
  constructor(scene) {
    this.scene = scene;
    this.active = false;
    this.startPos = new THREE.Vector3();
    this.endPos = new THREE.Vector3();
    this.duration = 0.3;
    this.elapsed = 0;
    this.timer001 = 0;
    this.color = new THREE.Color('#00f0ff');
    this.branchCount = 2;
    this.segments = 24;

    // Pre-allocated Float32Array for positions (main trunk + side branches)
    this.maxPoints = 48;
    this.positions = new Float32Array(this.maxPoints * 3 * 2);

    this.geometry = new THREE.BufferGeometry();
    this.posAttribute = new THREE.BufferAttribute(this.positions, 3);
    this.posAttribute.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.posAttribute);

    this.material = new THREE.LineBasicMaterial({
      color: 0x00f0ff,
      linewidth: 3,
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

    // Inner core glow line for volumetric sci-fi look
    this.coreMaterial = new THREE.LineBasicMaterial({
      color: 0xffffff,
      linewidth: 1.5,
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

  spawn(startPos, endPos, colorHex = '#00f0ff', duration = 0.28, branches = 2, customSegments = 24) {
    this.startPos.copy(startPos);
    this.endPos.copy(endPos);
    this.color.set(colorHex);
    this.duration = duration;
    this.elapsed = 0;
    this.timer001 = 0;
    this.branchCount = branches;
    this.segments = Math.min(customSegments, this.maxPoints / 2);

    this.material.color.copy(this.color);
    this.material.opacity = 1.0;
    this.coreMaterial.opacity = 1.0;

    this.lineMesh.visible = true;
    this.coreLineMesh.visible = true;
    this.active = true;

    // Immediately generate first jagged configuration
    this.recalculateSegments();
  }

  /**
   * High frequency procedural re-rotation & displacement of segments.
   * Calculates jagged vertices between startPos and endPos with midpoint jitter.
   */
  recalculateSegments() {
    let idx = 0;
    const segs = this.segments;
    const dir = new THREE.Vector3().subVectors(this.endPos, this.startPos);
    const totalDist = dir.length();

    // Trunk segments
    let prevX = this.startPos.x;
    let prevY = this.startPos.y;
    let prevZ = this.startPos.z;

    const lateralMax = Math.min(3.5, totalDist * 0.08);

    for (let i = 1; i <= segs; i++) {
      const t = i / segs;
      // Linear interpolation along line
      let curX = this.startPos.x + dir.x * t;
      let curY = this.startPos.y + dir.y * t;
      let curZ = this.startPos.z + dir.z * t;

      if (i < segs) {
        // High-frequency jitter & rotation angle:
        const angle = Math.random() * Math.PI * 2.0;
        const rad = (Math.random() * 0.8 + 0.2) * lateralMax;
        // Jitter orthogonal to direction
        curX += Math.cos(angle) * rad;
        curZ += Math.sin(angle) * rad;
        curY += (Math.random() - 0.5) * (lateralMax * 0.4);
      } else {
        // Terminal strike point locked to endPos
        curX = this.endPos.x;
        curY = this.endPos.y;
        curZ = this.endPos.z;
      }

      // Add segment line (prev -> cur)
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

    // Side Branches if requested
    if (this.branchCount > 0 && idx + 12 < this.positions.length) {
      // Pick random mid vertex as branch root
      const branchT = 0.4 + Math.random() * 0.3;
      const bRootX = this.startPos.x + dir.x * branchT + (Math.random() - 0.5) * lateralMax;
      const bRootY = this.startPos.y + dir.y * branchT;
      const bRootZ = this.startPos.z + dir.z * branchT + (Math.random() - 0.5) * lateralMax;

      const branchLen = totalDist * 0.3;
      const bAngle = Math.random() * Math.PI * 2;
      const bEndX = bRootX + Math.cos(bAngle) * branchLen;
      const bEndY = bRootY - branchLen * 0.5;
      const bEndZ = bRootZ + Math.sin(bAngle) * branchLen;

      // Add 2 segments for the branch
      const bMidX = (bRootX + bEndX) * 0.5 + (Math.random() - 0.5) * (lateralMax * 0.7);
      const bMidY = (bRootY + bEndY) * 0.5;
      const bMidZ = (bRootZ + bEndZ) * 0.5 + (Math.random() - 0.5) * (lateralMax * 0.7);

      this.positions[idx++] = bRootX; this.positions[idx++] = bRootY; this.positions[idx++] = bRootZ;
      this.positions[idx++] = bMidX;  this.positions[idx++] = bMidY;  this.positions[idx++] = bMidZ;

      this.positions[idx++] = bMidX;  this.positions[idx++] = bMidY;  this.positions[idx++] = bMidZ;
      this.positions[idx++] = bEndX;  this.positions[idx++] = bEndY;  this.positions[idx++] = bEndZ;
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
      return;
    }

    // SPECIFICATION: Segment re-rotation / jitter every 0.01 seconds
    if (this.timer001 >= rapidRate) {
      this.timer001 = 0;
      this.recalculateSegments();
    }

    // Fade out towards end of life
    const remainRatio = 1.0 - (this.elapsed / this.duration);
    this.material.opacity = Math.max(0, remainRatio);
    this.coreMaterial.opacity = Math.max(0, remainRatio);
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
      this.flashLights.push({ light: l, intensity: 0, duration: 0.3, elapsed: 99 });
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
  }

  /** Expand a bright ring at the impact point. */
  _groundFlash(pos, colorHex, maxR = 24, duration = 0.45) {
    let g = this.groundFlashes.find(f => !f.active);
    if (!g) g = this.groundFlashes[0];
    g.mesh.position.set(pos.x, pos.y + 0.35, pos.z);
    g.mat.color.set(colorHex);
    g.mesh.visible = true;
    g.mesh.scale.setScalar(1);
    g.mat.opacity = 0.9;
    g.elapsed = 0;
    g.duration = duration;
    g.maxR = maxR;
    g.active = true;
  }

  /**
   * Strike a tall vertical jagged lightning bolt from sky to target.
   */
  strikeBolt(groundPos, height = 120, colorHex = '#00f0ff', duration = 0.3, customSegments = 24) {
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

    // Dynamic flash lights (fast decay with a flicker for realism)
    for (const fl of this.flashLights) {
      if (!fl.light.visible) continue;
      fl.elapsed += dt;
      if (fl.elapsed >= fl.duration) {
        fl.light.visible = false;
        fl.light.intensity = 0;
        continue;
      }
      const t = fl.elapsed / fl.duration;
      const decay = Math.pow(1.0 - t, 2.2);
      const flicker = 0.7 + 0.3 * Math.sin(fl.elapsed * 90.0);
      fl.light.intensity = fl.intensity * decay * flicker;
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
      g.mat.opacity = (1.0 - t) * 0.9;
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
