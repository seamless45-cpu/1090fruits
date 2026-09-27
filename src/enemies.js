import * as THREE from 'three';

/**
 * 3D 1090 Fruits - Enemy Combat System
 *
 * Supports Normal Enemies (can be instant-killed / blinded),
 * Elite Mechs (immune to instant-kill; takes 50% max HP instead),
 * Titan Bosses, and Target Dummies.
 *
 * VISUALS:
 *  - Drones: hovering sphere core, gyro ring, thruster glow, bob & tilt
 *  - Elite: walking mech chassis, glowing core stripe, cannon muzzles
 *  - Boss: colossal titan with pulsing reactor core + eye slits + hovers
 *  - Status visuals: freeze tint, burn flicker, stun spin, eye HP flash
 *  - Death: real explosion burst with debris + light
 */

function softGlowTexture() {
  const cv = document.createElement('canvas');
  cv.width = 64;
  cv.height = 64;
  const ctx = cv.getContext('2d');
  const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,255,0.8)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.25)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}

export class Enemy {
  constructor(scene, type = 'drone', position = new THREE.Vector3(0, 0, 0), explosionManager = null) {
    this.scene = scene;
    this.type = type; // 'dummy' | 'drone' | 'elite' | 'boss'
    this.dead = false;
    this.explosions = explosionManager;
    this.animTime = Math.random() * 10;

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

    // Emissive materials we retint for status effects
    this.coreMats = [];
    this.baseCoreColor = new THREE.Color();

    // Create 3D Model
    this.createModel(position);
  }

  createModel(pos) {
    this.mesh = new THREE.Group();
    this.mesh.position.copy(pos);

    const glowTex = softGlowTexture();

    if (this.type === 'dummy') {
      // Cylindrical training dummy with glowing target rings
      const geo = new THREE.CylinderGeometry(0.7, 0.7, 2.2, 16);
      const mat = new THREE.MeshStandardMaterial({ color: 0x664411, metalness: 0.35, roughness: 0.6 });
      const body = new THREE.Mesh(geo, mat);
      body.position.y = 1.1;
      body.castShadow = true;
      this.mesh.add(body);

      const ringMat = new THREE.MeshBasicMaterial({ color: 0xffcc33, fog: false });
      for (let i = 0; i < 3; i++) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.03, 6, 24), ringMat);
        ring.position.y = 0.5 + i * 0.6;
        ring.rotation.x = Math.PI / 2;
        this.mesh.add(ring);
        this.coreMats.push(ringMat);
      }

      // Base pad
      const padMat = new THREE.MeshStandardMaterial({ color: 0x223344, metalness: 0.8, roughness: 0.3 });
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, 0.15, 20), padMat);
      pad.position.y = 0.08;
      this.mesh.add(pad);

    } else if (this.type === 'drone') {
      this.bodyGroup = new THREE.Group();
      this.mesh.add(this.bodyGroup);

      // Core sphere
      const coreGeo = new THREE.SphereGeometry(0.7, 20, 16);
      const coreMat = new THREE.MeshStandardMaterial({ color: 0x24354e, metalness: 0.9, roughness: 0.25 });
      const core = new THREE.Mesh(coreGeo, coreMat);
      core.position.y = 1.6;
      core.castShadow = true;
      this.bodyGroup.add(core);

      // Eye
      const eyeGeo = new THREE.SphereGeometry(0.24, 12, 10);
      this.eyeMat = new THREE.MeshBasicMaterial({ color: 0xff2a55, fog: false });
      const eye = new THREE.Mesh(eyeGeo, this.eyeMat);
      eye.position.set(0, 1.65, 0.55);
      this.bodyGroup.add(eye);
      this.coreMats.push(this.eyeMat);

      // Gyro ring
      const ringMat = new THREE.MeshBasicMaterial({ color: 0x00c8ff, transparent: true, opacity: 0.7, fog: false });
      this.droneRing = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.05, 8, 32), ringMat);
      this.droneRing.position.y = 1.6;
      this.droneRing.rotation.x = Math.PI / 2;
      this.bodyGroup.add(this.droneRing);
      this.coreMats.push(ringMat);

      // 4 thruster pods
      const podMat = new THREE.MeshStandardMaterial({ color: 0x141e2c, metalness: 0.85, roughness: 0.35 });
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const pod = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.25, 4, 8), podMat);
        pod.position.set(Math.cos(a) * 0.95, 1.2, Math.sin(a) * 0.95);
        pod.rotation.z = Math.PI / 2;
        pod.rotation.y = -a;
        pod.castShadow = true;
        this.bodyGroup.add(pod);
      }

      // Under-glow thruster beam
      this.droneGlowMat = new THREE.SpriteMaterial({
        map: glowTex, color: 0x00aaff, transparent: true, opacity: 0.55,
        depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      });
      this.droneGlow = new THREE.Sprite(this.droneGlowMat);
      this.droneGlow.scale.set(2.2, 2.2, 1);
      this.droneGlow.position.y = 0.7;
      this.bodyGroup.add(this.droneGlow);

    } else if (this.type === 'elite') {
      this.bodyGroup = new THREE.Group();
      this.mesh.add(this.bodyGroup);

      // Chassis
      const chassisMat = new THREE.MeshStandardMaterial({ color: 0x3d2030, metalness: 0.9, roughness: 0.3 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 1.6), chassisMat);
      body.position.y = 2.35;
      body.castShadow = true;
      this.bodyGroup.add(body);

      // Sloped upper armor
      const upperMat = new THREE.MeshStandardMaterial({ color: 0x2a1522, metalness: 0.85, roughness: 0.35 });
      const upper = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.7, 1.3), upperMat);
      upper.position.y = 3.35;
      upper.castShadow = true;
      this.bodyGroup.add(upper);

      // Glowing core stripe
      this.eliteCoreMat = new THREE.MeshBasicMaterial({ color: 0xff3355, fog: false });
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.2, 1.62), this.eliteCoreMat);
      stripe.position.y = 2.35;
      this.bodyGroup.add(stripe);
      this.coreMats.push(this.eliteCoreMat);

      // Head sensor
      this.eliteEyeMat = new THREE.MeshBasicMaterial({ color: 0xffaa00, fog: false });
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.3, 0.5), upperMat);
      head.position.set(0, 3.9, 0.3);
      this.bodyGroup.add(head);
      const slit = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.08, 0.1), this.eliteEyeMat);
      slit.position.set(0, 3.9, 0.56);
      this.bodyGroup.add(slit);
      this.coreMats.push(this.eliteEyeMat);

      // Dual cannons
      const gunGeo = new THREE.CylinderGeometry(0.18, 0.22, 1.8, 10);
      const gunMat = new THREE.MeshStandardMaterial({ color: 0x0d0d12, metalness: 0.9, roughness: 0.4 });
      const muzzleMat = new THREE.MeshBasicMaterial({ color: 0xff6600, fog: false });
      for (const sx of [-1, 1]) {
        const gun = new THREE.Mesh(gunGeo, gunMat);
        gun.rotation.x = Math.PI / 2;
        gun.position.set(sx * 1.3, 2.5, 0.7);
        gun.castShadow = true;
        this.bodyGroup.add(gun);
        const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.1, 10), muzzleMat);
        muzzle.rotation.x = Math.PI / 2;
        muzzle.position.set(sx * 1.3, 2.5, 1.65);
        this.bodyGroup.add(muzzle);
        this.coreMats.push(muzzleMat);
      }

      // Walking legs
      const legMat = new THREE.MeshStandardMaterial({ color: 0x1c2532, metalness: 0.85, roughness: 0.4 });
      this.eliteLegs = [];
      for (const sx of [-1, 1]) {
        const leg = new THREE.Group();
        leg.position.set(sx * 0.7, 1.6, 0);
        const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.6, 4, 10), legMat);
        thigh.position.y = -0.4;
        thigh.castShadow = true;
        leg.add(thigh);
        const foot = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.8), legMat);
        foot.position.set(0, -0.95, 0.1);
        foot.castShadow = true;
        leg.add(foot);
        this.bodyGroup.add(leg);
        this.eliteLegs.push(leg);
      }

    } else if (this.type === 'boss') {
      this.bodyGroup = new THREE.Group();
      this.mesh.add(this.bodyGroup);

      // Colossal hull
      const bossMat = new THREE.MeshStandardMaterial({
        color: 0x140d20, emissive: 0x220044, emissiveIntensity: 0.5,
        metalness: 0.85, roughness: 0.3
      });
      const body = new THREE.Mesh(new THREE.BoxGeometry(6.0, 8.0, 4.6), bossMat);
      body.position.y = 5.6;
      body.castShadow = true;
      this.bodyGroup.add(body);

      // Angular shoulder armor
      const shoulderMat = new THREE.MeshStandardMaterial({ color: 0x1d1230, metalness: 0.9, roughness: 0.3 });
      for (const sx of [-1, 1]) {
        const sh = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.4, 3.4), shoulderMat);
        sh.position.set(sx * 4.2, 7.4, 0);
        sh.rotation.z = sx * -0.25;
        sh.castShadow = true;
        this.bodyGroup.add(sh);
      }

      // Glowing reactor core (pulses)
      this.bossReactorMat = new THREE.MeshBasicMaterial({ color: 0xff0055, fog: false });
      this.bossReactor = new THREE.Mesh(new THREE.SphereGeometry(1.6, 20, 16), this.bossReactorMat);
      this.bossReactor.position.set(0, 6.2, 2.35);
      this.bodyGroup.add(this.bossReactor);
      this.coreMats.push(this.bossReactorMat);

      // Reactor cage
      const cageMat = new THREE.MeshBasicMaterial({ color: 0xff4488, wireframe: true, transparent: true, opacity: 0.5, fog: false });
      this.bossCage = new THREE.Mesh(new THREE.IcosahedronGeometry(2.2, 0), cageMat);
      this.bossCage.position.copy(this.bossReactor.position);
      this.bodyGroup.add(this.bossCage);

      // Eye slit
      this.bossEyeMat = new THREE.MeshBasicMaterial({ color: 0xff0033, fog: false });
      const eye = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.35, 0.3), this.bossEyeMat);
      eye.position.set(0, 8.9, 2.35);
      this.bodyGroup.add(eye);
      this.coreMats.push(this.bossEyeMat);

      // Hover under-glow
      this.bossGlowMat = new THREE.SpriteMaterial({
        map: glowTex, color: 0xaa00ff, transparent: true, opacity: 0.5,
        depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      });
      this.bossGlow = new THREE.Sprite(this.bossGlowMat);
      this.bossGlow.scale.set(11, 11, 1);
      this.bossGlow.position.y = 0.8;
      this.bodyGroup.add(this.bossGlow);

      // Record base core color for status retinting
      this.baseCoreColor.setHex(0xff0055);
    }

    this.scene.add(this.mesh);
  }

  /** Apply status-based tinting to emissive materials. */
  _refreshStatusVisuals() {
    for (const m of this.coreMats) {
      if (this.status.frozen > 0) {
        m.color.setHex(0x88ddff);
      } else if (this.status.burned > 0) {
        m.color.setHex(Math.random() > 0.5 ? 0xff6622 : 0xffaa00);
      } else if (this.status.stunned > 0) {
        m.color.setHex(0xffee44);
      } else if (this.type === 'boss') {
        m.color.copy(this.baseCoreColor);
      } else {
        m.color.setHex(this.type === 'drone' ? 0xff2a55 : (this.type === 'elite' ? 0xff3355 : 0xffcc33));
      }
    }
  }

  takeDamage(amount, isCrit = false, sourceDesc = '') {
    if (this.dead) return;

    this.hp -= amount;

    // Spawn floating damage text on UI
    this.spawnFloatingText(Math.round(amount), isCrit ? 'crit' : 'normal');

    if (this.hp <= 0) {
      this.hp = 0;
      this.die();
    } else if (this.coreMats.length) {
      // Hit flash (brief white pop)
      const lowHp = this.hp < this.maxHp * 0.25;
      for (const m of this.coreMats) {
        m.color.setHex(lowHp ? 0xffffff : 0xddffff);
      }
      clearTimeout(this._hitFlashT);
      this._hitFlashT = setTimeout(() => this._refreshStatusVisuals(), 70);
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
    this._refreshStatusVisuals();
  }

  showLaserCage(visible) {
    if (visible) {
      if (!this.cageMesh) {
        const cageGeo = new THREE.CylinderGeometry(2.0, 2.0, 4.0, 16, 1, true);
        const cageMat = new THREE.MeshBasicMaterial({
          color: 0xff0044,
          wireframe: true,
          transparent: true,
          opacity: 0.8,
          fog: false
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

    // Cinematic death burst (distinct size per enemy class)
    if (this.explosions) {
      const p = this.mesh.position.clone();
      p.y = this.type === 'boss' ? 5 : 1.2;
      if (this.type === 'boss') {
        this.explosions.createExplosion(p, 22.0, 'asteroid', 3.0);
        this.explosions.createExplosion(p, 12.0, 'fire', 1.6);
      } else if (this.type === 'elite') {
        this.explosions.createExplosion(p, 12.0, 'fire', 1.8);
      } else if (this.type === 'drone') {
        this.explosions.createExplosion(p, 7.0, 'lightning', 1.0);
      } else {
        this.explosions.createExplosion(p, 6.0, 'quake', 0.8);
      }
    }

    this.scene.remove(this.mesh);
  }

  update(dt, player) {
    if (this.dead) return;

    this.animTime += dt;

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
        if (this.dead) return;
      }
    }

    // Apply Knockback decay
    if (this.knockback.lengthSq() > 0.01) {
      this.mesh.position.addScaledVector(this.knockback, dt);
      this.knockback.multiplyScalar(Math.max(0, 1.0 - 4.5 * dt));
    }

    // ---- Per-type idle / locomotion animation ----
    if (this.type === 'drone' && this.bodyGroup) {
      const frozen = this.status.frozen > 0;
      const bobSpeed = frozen ? 0.4 : 2.4;
      this.bodyGroup.position.y = Math.sin(this.animTime * bobSpeed) * 0.25;
      if (this.droneRing) {
        const spin = this.status.stunned > 0 ? 14 : 1.6;
        this.droneRing.rotation.z += dt * spin;
      }
      if (this.droneGlowMat) {
        this.droneGlowMat.opacity = frozen ? 0.2 : 0.4 + 0.2 * Math.sin(this.animTime * 6);
      }
    } else if (this.type === 'elite' && this.eliteLegs) {
      for (let i = 0; i < this.eliteLegs.length; i++) {
        this.eliteLegs[i].rotation.x = Math.sin(this.animTime * 3.2 + i * Math.PI) * 0.28;
      }
      if (this.eliteCoreMat) {
        this.eliteCoreMat.color.multiplyScalar(1.0); // keep
      }
    } else if (this.type === 'boss' && this.bodyGroup) {
      const pulse = 1 + Math.sin(this.animTime * 2.2) * 0.12;
      if (this.bossReactor) this.bossReactor.scale.setScalar(pulse);
      if (this.bossCage) {
        this.bossCage.rotation.y += dt * 0.8;
        this.bossCage.rotation.x += dt * 0.3;
      }
      if (this.bossGlowMat) {
        this.bossGlowMat.opacity = 0.4 + 0.15 * Math.sin(this.animTime * 2.2);
      }
      this.bodyGroup.position.y = Math.sin(this.animTime * 0.9) * 0.4;
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

      // Smooth turn toward the player
      const targetYaw = Math.atan2(dir.x, dir.z);
      let dy = targetYaw - this.mesh.rotation.y;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      this.mesh.rotation.y += dy * Math.min(1, dt * 6);
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
  constructor(scene, explosionManager = null) {
    this.scene = scene;
    this.enemies = [];
    this.autoRespawn = true;
    this.explosionManager = explosionManager;

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
    this.enemies.push(new Enemy(this.scene, 'dummy', pos, this.explosionManager));
  }

  spawnDronePack(count = 5, spread = 45) {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random();
      const dist = 25 + Math.random() * spread;
      const pos = new THREE.Vector3(Math.cos(angle) * dist, 0, Math.sin(angle) * dist);
      this.enemies.push(new Enemy(this.scene, 'drone', pos, this.explosionManager));
    }
  }

  spawnElite(pos = new THREE.Vector3(-25, 0, 30)) {
    this.enemies.push(new Enemy(this.scene, 'elite', pos, this.explosionManager));
  }

  spawnBoss(pos = new THREE.Vector3(0, 0, 75)) {
    this.enemies.push(new Enemy(this.scene, 'boss', pos, this.explosionManager));
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
