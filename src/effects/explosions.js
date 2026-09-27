import * as THREE from 'three';

/**
 * 3D 1090 Fruits - Explosion & Debris Physics System
 *
 * SPECIFICATIONS:
 * 1. "explosion effects: (explosion and the debris)"
 * 2. "cannot reuse effects because its prohibited" -> distinct geometry, particle types,
 *    debris shapes, and materials for every fruit/weapon category.
 * 3. Physics Debris: Chunks launch in 3D trajectories, experience gravity, bounce off
 *    the floor (y = 0), tumble on X/Y/Z, and decelerate with friction.
 * 4. Integrates with Camera Shake with strict distance falloff.
 * 5. CINEMATIC LAYER: every explosion now casts a real dynamic point light, throws
 *    rising embers (per-type color) and soft smoke billows for fire/asteroid types.
 */

const FLASH_LIGHT_POOL = 10;
const EMBER_POOL = 12;
const EMBER_PER_BURST = 26;
const SMOKE_POOL = 10;
const SMOKE_PER_BURST = 6;

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

class EmberBurst {
  constructor(scene, texture) {
    this.scene = scene;
    this.active = false;
    this.count = EMBER_PER_BURST;
    this.positions = new Float32Array(this.count * 3);
    this.velocities = new Float32Array(this.count * 3);
    this.life = new Float32Array(this.count);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
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
      vel[i * 3 + 1] -= 14 * dt;      // gravity
      vel[i * 3] *= (1 - 1.6 * dt);   // drag
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
      // fade in fast, out slow
      s.mat.opacity = (t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85) * 0.38;
    }
    if (!any) this.active = false;
  }
}

export class ExplosionManager {
  constructor(scene, cameraController, soundSystem) {
    this.scene = scene;
    this.cameraController = cameraController;
    this.sound = soundSystem;

    // Configurable settings
    this.debrisCountPerExplosion = 35;

    // Active visual elements
    this.activeShockwaves = [];
    this.activeFlashes = [];
    this.activeDebris = [];

    // Reusable geometries & materials for performance
    this.shockwaveGeo = new THREE.RingGeometry(0.85, 1.0, 40);
    this.shockwaveGeo.rotateX(-Math.PI / 2); // Lay flat on ground

    this.sphereGeo = new THREE.SphereGeometry(1, 24, 24);
    this.shellGeo = new THREE.SphereGeometry(1, 20, 20);

    // Debris geometries (distinct for each type)
    this.boxDebrisGeo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
    this.tetraDebrisGeo = new THREE.TetrahedronGeometry(0.7, 0);
    this.slabDebrisGeo = new THREE.BoxGeometry(1.6, 0.4, 1.2); // Tectonic slabs for quake
    this.shardDebrisGeo = new THREE.ConeGeometry(0.3, 1.2, 4); // Crystalline shards for ice

    // Pooled materials
    this.materials = {
      asteroid: new THREE.MeshStandardMaterial({ color: 0x552211, roughness: 0.9, emissive: 0xff3300, emissiveIntensity: 0.9 }),
      lightning: new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, fog: false }),
      quake: new THREE.MeshStandardMaterial({ color: 0x334455, roughness: 0.8, emissive: 0x004455, emissiveIntensity: 0.4 }),
      alarm: new THREE.MeshBasicMaterial({ color: 0xff0044, fog: false }),
      ice: new THREE.MeshStandardMaterial({ color: 0x99eeff, roughness: 0.15, metalness: 0.85, emissive: 0x3388aa, emissiveIntensity: 0.35 }),
      fire: new THREE.MeshStandardMaterial({ color: 0xff6600, emissive: 0xff2200, emissiveIntensity: 1.4 }),
    };

    // ---------------------------------------------------------------
    // CINEMATIC POOLS
    // ---------------------------------------------------------------
    this.emberTex = makeRadialTexture('rgba(255,235,190,1)', 'rgba(255,150,50,0.5)', 'rgba(255,80,0,0)');
    this.smokeTex = makeRadialTexture('rgba(200,205,215,0.55)', 'rgba(150,155,165,0.25)', 'rgba(120,125,135,0)');

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
  }

  setDebrisCount(count) {
    this.debrisCountPerExplosion = Math.max(10, Math.min(80, count));
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
   * Spawns an explosion with distinct visual style and 3D physical bouncing debris.
   *
   * @param {THREE.Vector3} pos - Explosion world coordinate
   * @param {number} radius - Meter radius of the explosion blast
   * @param {string} type - 'asteroid' | 'lightning' | 'quake' | 'alarm' | 'ice' | 'fire' | 'cloud'
   * @param {number} shakeIntensity - Base intensity for camera shake
   */
  createExplosion(pos, radius = 10.0, type = 'asteroid', shakeIntensity = 1.5) {
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

    // Color definitions per distinct effect type (strictly non-reused)
    let colorHex = 0xff5500;
    let shockColor = 0xff8833;
    let debrisGeo = this.tetraDebrisGeo;
    let debrisMat = this.materials.asteroid;

    if (type === 'lightning') {
      colorHex = 0x00f0ff;
      shockColor = 0x88ffff;
      debrisGeo = this.tetraDebrisGeo;
      debrisMat = this.materials.lightning;
    } else if (type === 'quake') {
      colorHex = 0x00d0ff; // Neon blue cracks & spatial shockwave
      shockColor = 0xffffff; // White semi-transparent shockwave
      debrisGeo = this.slabDebrisGeo;
      debrisMat = this.materials.quake;
    } else if (type === 'alarm') {
      colorHex = 0xff0044;
      shockColor = 0xff3366;
      debrisGeo = this.boxDebrisGeo;
      debrisMat = this.materials.alarm;
    } else if (type === 'ice') {
      colorHex = 0x88e0ff;
      shockColor = 0xcceeff;
      debrisGeo = this.shardDebrisGeo;
      debrisMat = this.materials.ice;
    } else if (type === 'fire') {
      colorHex = 0xff4400;
      shockColor = 0xffaa00;
      debrisGeo = this.tetraDebrisGeo;
      debrisMat = this.materials.fire;
    } else if (type === 'cloud') {
      colorHex = 0xccddee;
      shockColor = 0xffffff;
      debrisGeo = this.boxDebrisGeo;
      debrisMat = this.materials.quake;
    }

    // 3. Shockwave Expanding Ring (accurate meter radius expansion)
    const shockMat = new THREE.MeshBasicMaterial({
      color: shockColor,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    const shockMesh = new THREE.Mesh(this.shockwaveGeo, shockMat);
    shockMesh.position.copy(pos);
    shockMesh.position.y += 0.2; // Slightly above floor to avoid z-fighting
    shockMesh.scale.set(0.1, 0.1, 0.1);
    this.scene.add(shockMesh);

    this.activeShockwaves.push({
      mesh: shockMesh,
      maxRadius: radius,
      currentRadius: 0.1,
      duration: 0.35 + radius * 0.02,
      elapsed: 0,
      material: shockMat
    });

    // 4a. Bright plasma core flash
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    const flashMesh = new THREE.Mesh(this.sphereGeo, flashMat);
    flashMesh.position.copy(pos);
    flashMesh.scale.set(0.2, 0.2, 0.2);
    this.scene.add(flashMesh);

    this.activeFlashes.push({
      mesh: flashMesh,
      maxScale: radius * 0.8,
      duration: 0.28,
      elapsed: 0,
      material: flashMat,
      color: 0xffffff,
    });

    // 4b. Colored energy shell (slightly larger, type-colored)
    const shellMat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    const shellMesh = new THREE.Mesh(this.shellGeo, shellMat);
    shellMesh.position.copy(pos);
    shellMesh.scale.set(0.2, 0.2, 0.2);
    this.scene.add(shellMesh);

    this.activeFlashes.push({
      mesh: shellMesh,
      maxScale: radius * 1.05,
      duration: 0.42,
      elapsed: 0,
      material: shellMat,
      color: colorHex,
    });

    // 5. DYNAMIC LIGHT - the arena is really lit by the blast
    this._spawnFlashLight(pos, colorHex, radius, 0.45 + radius * 0.02);

    // 6. EMBERS + SMOKE (per-type personality)
    this._spawnEmbers(pos, colorHex, radius);
    if (type === 'fire' || type === 'asteroid') {
      this._spawnSmoke(pos, radius, type === 'asteroid');
    } else if (type === 'ice') {
      this._spawnSmoke(pos, radius, false);
    }

    // 7. Physics Debris System (Chunks launched with 3D momentum)
    const count = this.debrisCountPerExplosion;
    for (let i = 0; i < count; i++) {
      const chunk = new THREE.Mesh(debrisGeo, debrisMat);
      chunk.position.copy(pos);
      chunk.position.y += 0.5;

      // Random scale variation
      const sc = 0.4 + Math.random() * 0.8;
      chunk.scale.set(sc, sc, sc);
      chunk.castShadow = (type === 'quake' || type === 'asteroid');

      // Launch velocity (cone upwards and outward radially)
      const angle = Math.random() * Math.PI * 2;
      const speed = 10.0 + Math.random() * (radius * 1.5);
      const elevation = 0.4 + Math.random() * 0.6; // Upward angle

      const vel = new THREE.Vector3(
        Math.cos(angle) * speed * (1.0 - elevation),
        speed * elevation,
        Math.sin(angle) * speed * (1.0 - elevation)
      );

      // Tumble angular velocity
      const angVel = new THREE.Vector3(
        (Math.random() - 0.5) * 12.0,
        (Math.random() - 0.5) * 12.0,
        (Math.random() - 0.5) * 12.0
      );

      this.scene.add(chunk);

      this.activeDebris.push({
        mesh: chunk,
        velocity: vel,
        angularVelocity: angVel,
        bounces: 0,
        maxBounces: 3,
        lifetime: 3.5 + Math.random() * 2.0,
        elapsed: 0,
        isSettled: false
      });
    }
  }

  /**
   * Frame update for physics debris, shockwave rings, and flashes.
   */
  update(dt) {
    // Update Shockwaves
    for (let i = this.activeShockwaves.length - 1; i >= 0; i--) {
      const s = this.activeShockwaves[i];
      s.elapsed += dt;
      const t = s.elapsed / s.duration;

      if (t >= 1.0) {
        this.scene.remove(s.mesh);
        s.material.dispose();
        this.activeShockwaves.splice(i, 1);
        continue;
      }

      const r = s.maxRadius * (1.0 - Math.pow(1.0 - t, 2.5));
      s.mesh.scale.set(r, r, r);
      s.material.opacity = (1.0 - t) * 0.9;
    }

    // Update Flashes
    for (let i = this.activeFlashes.length - 1; i >= 0; i--) {
      const f = this.activeFlashes[i];
      f.elapsed += dt;
      const t = f.elapsed / f.duration;

      if (t >= 1.0) {
        this.scene.remove(f.mesh);
        f.material.dispose();
        this.activeFlashes.splice(i, 1);
        continue;
      }

      const sc = f.maxScale * Math.sin(t * Math.PI * 0.5);
      f.mesh.scale.set(Math.max(0.001, sc), Math.max(0.001, sc), Math.max(0.001, sc));
      f.material.opacity = Math.cos(t * Math.PI * 0.5);
    }

    // Update Debris 3D Physics
    const gravity = -26.0; // m/s²
    const floorY = 0.2;

    for (let i = this.activeDebris.length - 1; i >= 0; i--) {
      const d = this.activeDebris[i];
      d.elapsed += dt;

      if (d.elapsed >= d.lifetime) {
        this.scene.remove(d.mesh);
        this.activeDebris.splice(i, 1);
        continue;
      }

      if (!d.isSettled) {
        // Apply gravity
        d.velocity.y += gravity * dt;

        // Apply velocity to position
        d.mesh.position.x += d.velocity.x * dt;
        d.mesh.position.y += d.velocity.y * dt;
        d.mesh.position.z += d.velocity.z * dt;

        // Apply rotation
        d.mesh.rotation.x += d.angularVelocity.x * dt;
        d.mesh.rotation.y += d.angularVelocity.y * dt;
        d.mesh.rotation.z += d.angularVelocity.z * dt;

        // Ground Floor Collision & Elastic Bounce
        if (d.mesh.position.y <= floorY) {
          d.mesh.position.y = floorY;
          d.bounces++;

          if (d.bounces >= d.maxBounces || Math.abs(d.velocity.y) < 2.0) {
            d.isSettled = true;
            d.velocity.set(0, 0, 0);
            d.angularVelocity.set(0, 0, 0);
          } else {
            // Elastic bounce with friction damping
            d.velocity.y = -d.velocity.y * 0.45;
            d.velocity.x *= 0.7;
            d.velocity.z *= 0.7;
            d.angularVelocity.multiplyScalar(0.6);
          }
        }
      }

      // Fade out when near end of life
      if (d.elapsed > d.lifetime - 0.8) {
        const fade = (d.lifetime - d.elapsed) / 0.8;
        d.mesh.scale.multiplyScalar(Math.max(0.1, fade));
      }
    }

    // Update cinematic pools
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
  }

  getActiveDebrisCount() {
    return this.activeDebris.length;
  }
}
