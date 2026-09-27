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
 */

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
    this.shockwaveGeo = new THREE.RingGeometry(0.8, 1.0, 32);
    this.shockwaveGeo.rotateX(-Math.PI / 2); // Lay flat on ground

    this.sphereGeo = new THREE.SphereGeometry(1, 16, 16);

    // Debris geometries (distinct for each type)
    this.boxDebrisGeo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
    this.tetraDebrisGeo = new THREE.TetrahedronGeometry(0.7, 0);
    this.slabDebrisGeo = new THREE.BoxGeometry(1.6, 0.4, 1.2); // Tectonic slabs for quake
    this.shardDebrisGeo = new THREE.ConeGeometry(0.3, 1.2, 4); // Crystalline shards for ice

    // Pooled materials
    this.materials = {
      asteroid: new THREE.MeshStandardMaterial({ color: 0xff4400, roughness: 0.9, emissive: 0xaa2200 }),
      lightning: new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true }),
      quake: new THREE.MeshStandardMaterial({ color: 0x334455, roughness: 0.8 }),
      alarm: new THREE.MeshBasicMaterial({ color: 0xff0044 }),
      ice: new THREE.MeshStandardMaterial({ color: 0x99eeff, roughness: 0.2, metalness: 0.8 }),
      fire: new THREE.MeshStandardMaterial({ color: 0xff6600, emissive: 0xee2200 }),
    };
  }

  setDebrisCount(count) {
    this.debrisCountPerExplosion = Math.max(10, Math.min(80, count));
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
      blending: THREE.AdditiveBlending
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

    // 4. Expanding Blast Sphere / Plasma Core Flash
    const flashMat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false
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
      material: flashMat
    });

    // 5. Physics Debris System (Chunks launched with 3D momentum)
    const count = this.debrisCountPerExplosion;
    for (let i = 0; i < count; i++) {
      const chunk = new THREE.Mesh(debrisGeo, debrisMat);
      chunk.position.copy(pos);
      chunk.position.y += 0.5;

      // Random scale variation
      const sc = 0.4 + Math.random() * 0.8;
      chunk.scale.set(sc, sc, sc);

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
      f.mesh.scale.set(sc, sc, sc);
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
  }

  getActiveDebrisCount() {
    return this.activeDebris.length;
  }
}
