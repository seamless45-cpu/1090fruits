import * as THREE from 'three';

/**
 * 3D 1090 Fruits - Enemy Combat System
 * 
 * Supports Normal Enemies (can be instant-killed / blinded), 
 * Elite Mechs (immune to instant-kill; takes 50% max HP instead),
 * Titan Bosses, and Target Dummies.
 */

export class Enemy {
  constructor(scene, type = 'drone', position = new THREE.Vector3(0, 0, 0)) {
    this.scene = scene;
    this.type = type; // 'dummy' | 'drone' | 'elite' | 'boss'
    this.dead = false;

    // HP Configuration
    if (type === 'dummy') {
      this.maxHp = 2500;
    } else if (type === 'drone') {
      this.maxHp = 800;
    } else if (type === 'elite') {
      this.maxHp = 6500;
    } else if (type === 'boss') {
      this.maxHp = 35000;
    } else {
      this.maxHp = 1000;
    }
    this.hp = this.maxHp;

    // Status effects
    this.status = {
      stunned: 0,
      frozen: 0,
      blinded: 0,
      burned: 0,
      burnTickTimer: 0,
      imprisoned: 0,
      hacked: false, // If hacked, attacks heal player!
      bleedTicks: 0,
      bleedTimer: 0
    };

    // Movement & Knockback
    this.velocity = new THREE.Vector3(0, 0, 0);
    this.knockback = new THREE.Vector3(0, 0, 0);
    this.moveSpeed = type === 'drone' ? 8.0 : (type === 'elite' ? 5.0 : (type === 'boss' ? 3.5 : 0));
    this.attackCooldown = 0;

    // Imprison laser cage mesh
    this.cageMesh = null;

    // Create 3D Model
    this.createModel(position);
  }

  createModel(pos) {
    this.mesh = new THREE.Group();
    this.mesh.position.copy(pos);

    if (this.type === 'dummy') {
      // Cylindrical training dummy with target rings
      const geo = new THREE.CylinderGeometry(0.7, 0.7, 2.2, 16);
      const mat = new THREE.MeshStandardMaterial({ color: 0xffaa00, metalness: 0.2, roughness: 0.8 });
      const body = new THREE.Mesh(geo, mat);
      body.position.y = 1.1;
      this.mesh.add(body);
    } else if (this.type === 'drone') {
      // Floating Cyber Drone
      const coreGeo = new THREE.SphereGeometry(0.75, 12, 12);
      const coreMat = new THREE.MeshStandardMaterial({ color: 0x334466, metalness: 0.8, roughness: 0.3 });
      const core = new THREE.Mesh(coreGeo, coreMat);
      core.position.y = 1.6;
      this.mesh.add(core);

      // Eye
      const eyeGeo = new THREE.SphereGeometry(0.25, 8, 8);
      this.eyeMat = new THREE.MeshBasicMaterial({ color: 0xff2a55 });
      const eye = new THREE.Mesh(eyeGeo, this.eyeMat);
      eye.position.set(0, 1.6, 0.6);
      this.mesh.add(eye);
    } else if (this.type === 'elite') {
      // Heavy Walker Mech
      const baseGeo = new THREE.BoxGeometry(2.2, 2.6, 1.8);
      const baseMat = new THREE.MeshStandardMaterial({ color: 0x552233, metalness: 0.9, roughness: 0.2 });
      const body = new THREE.Mesh(baseGeo, baseMat);
      body.position.y = 2.0;
      this.mesh.add(body);

      // Dual cannons
      const gunGeo = new THREE.CylinderGeometry(0.2, 0.2, 1.8, 8);
      const gunMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
      const gunL = new THREE.Mesh(gunGeo, gunMat);
      gunL.rotation.x = Math.PI / 2;
      gunL.position.set(-1.3, 2.2, 0.6);
      this.mesh.add(gunL);

      const gunR = new THREE.Mesh(gunGeo, gunMat);
      gunR.rotation.x = Math.PI / 2;
      gunR.position.set(1.3, 2.2, 0.6);
      this.mesh.add(gunR);
    } else if (this.type === 'boss') {
      // Colossal Titan Boss
      const bossGeo = new THREE.BoxGeometry(6.0, 9.0, 5.0);
      const bossMat = new THREE.MeshStandardMaterial({
        color: 0x1a0f28,
        emissive: 0x330066,
        metalness: 0.85,
        roughness: 0.25
      });
      const body = new THREE.Mesh(bossGeo, bossMat);
      body.position.y = 5.5;
      this.mesh.add(body);

      // Glowing core reactor
      const reactorGeo = new THREE.SphereGeometry(1.8, 16, 16);
      const reactorMat = new THREE.MeshBasicMaterial({ color: 0xff0055 });
      const reactor = new THREE.Mesh(reactorGeo, reactorMat);
      reactor.position.set(0, 6.0, 2.6);
      this.mesh.add(reactor);
    }

    this.scene.add(this.mesh);
  }

  takeDamage(amount, isCrit = false, sourceDesc = '') {
    if (this.dead) return;

    this.hp -= amount;

    // Spawn floating damage text on UI
    this.spawnFloatingText(Math.round(amount), isCrit ? 'crit' : 'normal');

    if (this.hp <= 0) {
      this.hp = 0;
      this.die();
    }
  }

  applyStatus(type, duration) {
    if (type === 'stun') {
      this.status.stunned = Math.max(this.status.stunned, duration);
    } else if (type === 'freeze') {
      this.status.frozen = Math.max(this.status.frozen, duration);
      this.spawnFloatingText('FREEZE!', 'freeze');
    } else if (type === 'burn') {
      this.status.burned = Math.max(this.status.burned, duration);
      this.spawnFloatingText('BURN!', 'burn');
    } else if (type === 'blind') {
      this.status.blinded = Math.max(this.status.blinded, duration);
      this.spawnFloatingText('BLINDED!', 'normal');
    } else if (type === 'imprison') {
      this.status.imprisoned = Math.max(this.status.imprisoned, duration);
      this.showLaserCage(true);
    } else if (type === 'hack') {
      this.status.hacked = true;
      this.spawnFloatingText('HACKED!', 'normal');
    }
  }

  showLaserCage(visible) {
    if (visible) {
      if (!this.cageMesh) {
        const cageGeo = new THREE.CylinderGeometry(2.0, 2.0, 4.0, 16, 1, true);
        const cageMat = new THREE.MeshBasicMaterial({
          color: 0xff0044,
          wireframe: true,
          transparent: true,
          opacity: 0.8
        });
        this.cageMesh = new THREE.Mesh(cageGeo, cageMat);
        this.cageMesh.position.y = 2.0;
        this.mesh.add(this.cageMesh);
      }
      this.cageMesh.visible = true;
    } else {
      if (this.cageMesh) this.cageMesh.visible = false;
    }
  }

  applyKnockback(dir, force) {
    this.knockback.addScaledVector(dir.clone().normalize(), force);
  }

  spawnFloatingText(text, style = 'normal') {
    const layer = document.getElementById('damage-numbers-layer');
    if (!layer || !window.__activeCamera) return;

    // Project 3D position to 2D screen coordinates
    const screenPos = this.mesh.position.clone();
    screenPos.y += (this.type === 'boss' ? 8 : (this.type === 'elite' ? 3.5 : 2.0));
    screenPos.project(window.__activeCamera);

    const x = (screenPos.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-(screenPos.y * 0.5) + 0.5) * window.innerHeight;

    // Only show if in front of camera
    if (screenPos.z < 1.0) {
      const el = document.createElement('div');
      el.className = `floating-dmg ${style}`;
      el.textContent = text;
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      layer.appendChild(el);

      setTimeout(() => {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 950);
    }
  }

  die() {
    this.dead = true;
    this.scene.remove(this.mesh);
  }

  update(dt, player) {
    if (this.dead) return;

    // Handle status timers
    if (this.status.stunned > 0) this.status.stunned -= dt;
    if (this.status.frozen > 0) this.status.frozen -= dt;
    if (this.status.imprisoned > 0) {
      this.status.imprisoned -= dt;
      if (this.status.imprisoned <= 0) {
        this.showLaserCage(false);
      }
    }
    if (this.status.blinded > 0) this.status.blinded -= dt;

    // Burning DoT
    if (this.status.burned > 0) {
      this.status.burned -= dt;
      this.status.burnTickTimer += dt;
      if (this.status.burnTickTimer >= 0.5) {
        this.status.burnTickTimer = 0;
        this.takeDamage(this.maxHp * 0.035, false, 'burn');
      }
    }

    // Apply Knockback decay
    if (this.knockback.lengthSq() > 0.01) {
      this.mesh.position.addScaledVector(this.knockback, dt);
      this.knockback.multiplyScalar(Math.max(0, 1.0 - 4.5 * dt));
    }

    // Is enemy unable to move/act?
    const isImmobile = (this.status.stunned > 0 || this.status.frozen > 0 || this.status.imprisoned > 0 || this.type === 'dummy');
    if (isImmobile) return;

    // Enemy movement logic
    if (this.status.blinded > 0) {
      // Blinded: wanders randomly and cannot attack player!
      const randomAngle = (Date.now() * 0.002) + (this.mesh.id * 10);
      this.mesh.position.x += Math.cos(randomAngle) * this.moveSpeed * 0.5 * dt;
      this.mesh.position.z += Math.sin(randomAngle) * this.moveSpeed * 0.5 * dt;
      return;
    }

    // Normal approach player
    const distToPlayer = this.mesh.position.distanceTo(player.position);
    const stopDist = this.type === 'boss' ? 12 : 3.5;

    if (distToPlayer > stopDist) {
      const dir = new THREE.Vector3().subVectors(player.position, this.mesh.position);
      dir.y = 0;
      dir.normalize();
      this.mesh.position.addScaledVector(dir, this.moveSpeed * dt);
      this.mesh.lookAt(player.position.x, this.mesh.position.y, player.position.z);
    } else {
      // Attack player
      this.attackCooldown += dt;
      if (this.attackCooldown >= 1.5) {
        this.attackCooldown = 0;
        if (this.status.hacked) {
          // SPECIFICATION: Hacked target attacks heal the player instead of damaging!
          player.heal(50);
        } else {
          player.takeDamage(this.type === 'boss' ? 120 : (this.type === 'elite' ? 50 : 20));
        }
      }
    }
  }
}

export class EnemyManager {
  constructor(scene) {
    this.scene = scene;
    this.enemies = [];
    this.autoRespawn = true;

    // Spawn initial setup
    this.spawnInitialWave();
  }

  spawnInitialWave() {
    this.spawnDummy(new THREE.Vector3(0, 0, 18));
    this.spawnDronePack(5, 40);
    this.spawnElite(new THREE.Vector3(-30, 0, -35));
    this.spawnElite(new THREE.Vector3(30, 0, -35));
  }

  spawnDummy(pos = new THREE.Vector3(0, 0, 15)) {
    this.enemies.push(new Enemy(this.scene, 'dummy', pos));
  }

  spawnDronePack(count = 5, spread = 45) {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random();
      const dist = 25 + Math.random() * spread;
      const pos = new THREE.Vector3(Math.cos(angle) * dist, 0, Math.sin(angle) * dist);
      this.enemies.push(new Enemy(this.scene, 'drone', pos));
    }
  }

  spawnElite(pos = new THREE.Vector3(-25, 0, 30)) {
    this.enemies.push(new Enemy(this.scene, 'elite', pos));
  }

  spawnBoss(pos = new THREE.Vector3(0, 0, 75)) {
    this.enemies.push(new Enemy(this.scene, 'boss', pos));
  }

  clearAll() {
    for (const e of this.enemies) {
      this.scene.remove(e.mesh);
    }
    this.enemies = [];
  }

  update(dt, player) {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.dead) {
        this.enemies.splice(i, 1);
        continue;
      }
      e.update(dt, player);
    }

    // Auto respawn if arena is empty and autoRespawn is enabled
    if (this.autoRespawn && this.enemies.length === 0) {
      this.spawnInitialWave();
    }
  }

  /**
   * Find closest enemy to a world position within a radius in meters
   */
  findClosestEnemy(pos, maxRadius = 100) {
    let closest = null;
    let minDist = maxRadius;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const d = pos.distanceTo(e.mesh.position);
      if (d < minDist) {
        minDist = d;
        closest = e;
      }
    }
    return { enemy: closest, distance: minDist };
  }

  /**
   * Find enemy with highest current HP (for Alarm Fruit skill 2: automatic transmission alarming)
   */
  findHighestHpEnemy(pos, maxRadius = 300) {
    let highest = null;
    let maxHp = -1;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const d = pos.distanceTo(e.mesh.position);
      if (d <= maxRadius && e.hp > maxHp) {
        maxHp = e.hp;
        highest = e;
      }
    }
    return highest;
  }

  /**
   * Get all enemies within a radius in meters
   */
  getEnemiesInRadius(centerPos, radius) {
    const list = [];
    for (const e of this.enemies) {
      if (e.dead) continue;
      if (centerPos.distanceTo(e.mesh.position) <= radius) {
        list.push(e);
      }
    }
    return list;
  }
}
