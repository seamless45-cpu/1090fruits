import * as THREE from 'three';

/**
 * 3D 1090 Fruits - Player Operative Controller
 * Manages character model, weapon attachments, movement physics,
 * elemental fruit aura, combat stats, buffs, and melee combos.
 */

export class Player {
  constructor(scene, soundSystem) {
    this.scene = scene;
    this.sound = soundSystem;

    // Stats
    this.maxHp = 1000;
    this.hp = 1000;
    this.maxEnergy = 100;
    this.energy = 100;

    // Special gauges
    this.gravityBladeCharge = 0; // 0 - 100%
    this.lightningDashCharges = 3;
    this.dashChargeTimer = 0;

    // Active Buffs
    this.buffs = {
      alarmBuffer: { active: false, timer: 0 },
      iceBombard: { active: false, timer: 0 },
      hellFury: { active: false, timer: 0 },
      invincible: { active: false, timer: 0 },
      blinded: { active: false, timer: 0 },
    };

    // Movement & Physics
    this.position = new THREE.Vector3(0, 0, 0);
    this.velocity = new THREE.Vector3(0, 0, 0);
    this.moveSpeed = 16.0; // m/s
    this.isGrounded = true;
    this.dashCooldown = 0;
    this.dashTimer = 0;
    this.dashVelocity = new THREE.Vector3(0, 0, 0);

    // M1 Melee Combo State
    this.comboStep = 0;
    this.lastSlashTime = 0;
    this.m1Cooldown = 0;
    this.isAttacking = false;
    this.attackAnimTimer = 0;

    // Aim target in world coordinates (updated by raycaster)
    this.aimTarget = new THREE.Vector3(0, 0, 0);

    // Build 3D Operative Mesh
    this.createModel();

    // Input state
    this.keys = {};
    this.initInput();
  }

  createModel() {
    this.group = new THREE.Group();
    this.group.position.set(0, 0, 0);

    // Body (Torso & Armor)
    const torsoGeo = new THREE.BoxGeometry(0.8, 1.1, 0.5);
    const armorMat = new THREE.MeshStandardMaterial({
      color: 0x141f32,
      roughness: 0.3,
      metalness: 0.8,
    });
    this.torso = new THREE.Mesh(torsoGeo, armorMat);
    this.torso.position.y = 1.35;
    this.torso.castShadow = true;
    this.group.add(this.torso);

    // Head & Sci-Fi Visor
    const headGeo = new THREE.BoxGeometry(0.45, 0.45, 0.45);
    const headMat = new THREE.MeshStandardMaterial({ color: 0x0a101d, roughness: 0.4, metalness: 0.7 });
    this.head = new THREE.Mesh(headGeo, headMat);
    this.head.position.y = 2.15;
    this.group.add(this.head);

    // Glowing Visor
    const visorGeo = new THREE.BoxGeometry(0.46, 0.12, 0.2);
    this.visorMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
    this.visor = new THREE.Mesh(visorGeo, this.visorMat);
    this.visor.position.set(0, 2.15, 0.18);
    this.group.add(this.visor);

    // Arms
    const armGeo = new THREE.BoxGeometry(0.24, 0.8, 0.24);
    this.leftArm = new THREE.Mesh(armGeo, armorMat);
    this.leftArm.position.set(-0.55, 1.35, 0);
    this.group.add(this.leftArm);

    this.rightArm = new THREE.Mesh(armGeo, armorMat);
    this.rightArm.position.set(0.55, 1.35, 0);
    this.group.add(this.rightArm);

    // Weapon Hold Point
    this.weaponMount = new THREE.Group();
    this.weaponMount.position.set(0.1, -0.35, 0.4);
    this.rightArm.add(this.weaponMount);

    // Legs
    const legGeo = new THREE.BoxGeometry(0.28, 0.9, 0.3);
    this.leftLeg = new THREE.Mesh(legGeo, armorMat);
    this.leftLeg.position.set(-0.25, 0.45, 0);
    this.group.add(this.leftLeg);

    this.rightLeg = new THREE.Mesh(legGeo, armorMat);
    this.rightLeg.position.set(0.25, 0.45, 0);
    this.group.add(this.rightLeg);

    // Elemental Aura Rings (orbiting around operative)
    const auraGeo = new THREE.TorusGeometry(1.2, 0.04, 8, 32);
    this.auraMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending
    });
    this.auraRing1 = new THREE.Mesh(auraGeo, this.auraMat);
    this.auraRing1.position.y = 1.3;
    this.auraRing1.rotation.x = Math.PI / 2.3;
    this.group.add(this.auraRing1);

    this.auraRing2 = new THREE.Mesh(auraGeo, this.auraMat);
    this.auraRing2.position.y = 1.3;
    this.auraRing2.rotation.y = Math.PI / 3;
    this.group.add(this.auraRing2);

    this.scene.add(this.group);

    // Current weapon mesh container
    this.currentWeaponMesh = null;
    this.equippedSwordType = 'gravity_blade';
    this.updateWeaponVisuals('gravity_blade');
  }

  /**
   * Update 3D Sword Mesh to match equipped weapon
   */
  updateWeaponVisuals(swordType) {
    this.equippedSwordType = swordType;
    if (this.currentWeaponMesh) {
      this.weaponMount.remove(this.currentWeaponMesh);
    }

    const swordGroup = new THREE.Group();

    if (swordType === 'gravity_blade') {
      // Purple / Obsidian heavy blade
      const bladeGeo = new THREE.BoxGeometry(0.12, 1.8, 0.28);
      const bladeMat = new THREE.MeshStandardMaterial({
        color: 0x240938,
        emissive: 0x7700cc,
        roughness: 0.2,
        metalness: 0.9
      });
      const blade = new THREE.Mesh(bladeGeo, bladeMat);
      blade.position.y = 0.9;
      swordGroup.add(blade);
    } else if (swordType === 'pole') {
      // Long golden lightning staff
      const poleGeo = new THREE.CylinderGeometry(0.06, 0.06, 2.4, 12);
      const poleMat = new THREE.MeshStandardMaterial({
        color: 0xffcc00,
        emissive: 0xaa8800,
        metalness: 0.9
      });
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.y = 1.0;
      swordGroup.add(pole);
    } else if (swordType === 'bisento') {
      // Massive crescent halberd / bisento
      const shaftGeo = new THREE.CylinderGeometry(0.08, 0.08, 2.6, 12);
      const shaftMat = new THREE.MeshStandardMaterial({ color: 0x442211, metalness: 0.5 });
      const shaft = new THREE.Mesh(shaftGeo, shaftMat);
      shaft.position.y = 1.0;
      swordGroup.add(shaft);

      const crescentGeo = new THREE.BoxGeometry(0.1, 1.2, 0.6);
      const crescentMat = new THREE.MeshStandardMaterial({
        color: 0xccddee,
        emissive: 0x0088cc,
        metalness: 0.9
      });
      const crescent = new THREE.Mesh(crescentGeo, crescentMat);
      crescent.position.set(0, 2.1, 0.1);
      swordGroup.add(crescent);
    } else if (swordType === 'alarm_sword') {
      // Crimson high-tech energy blade
      const alarmBladeGeo = new THREE.BoxGeometry(0.1, 1.7, 0.25);
      const alarmBladeMat = new THREE.MeshStandardMaterial({
        color: 0x330011,
        emissive: 0xff0044,
        metalness: 0.8
      });
      const blade = new THREE.Mesh(alarmBladeGeo, alarmBladeMat);
      blade.position.y = 0.85;
      swordGroup.add(blade);
    }

    this.currentWeaponMesh = swordGroup;
    this.weaponMount.add(this.currentWeaponMesh);
  }

  /**
   * Update elemental aura color according to active fruit
   */
  updateFruitAura(fruitType) {
    const colorMap = {
      gravity: 0xb026ff,
      lightning: 0x00f0ff,
      quake: 0x00bfff,
      alarm: 0xff0044,
      rimefracture: 0x88eeff,
      wildfire: 0xff5500,
      cloud: 0xffffff,
      none: 0x557799
    };
    const c = colorMap[fruitType] || 0x00f0ff;
    this.auraMat.color.setHex(c);
    this.visorMat.color.setHex(c);
  }

  initInput() {
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        this.triggerDash();
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });
  }

  triggerDash(customDist = 12.0, customSpeed = 60.0) {
    if (this.dashCooldown > 0) return;
    this.dashCooldown = 0.5;

    // Dash in forward direction or movement vector
    const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.group.rotation.y);
    this.dashVelocity.copy(forward).multiplyScalar(customSpeed);
    this.dashTimer = 0.16;

    this.sound.playDash();
  }

  takeDamage(amount) {
    if (this.buffs.invincible.active) return;
    this.hp = Math.max(0, this.hp - amount);
  }

  heal(amount) {
    this.hp = Math.min(this.maxHp, this.hp + amount);
  }

  setAimTarget(worldPos) {
    this.aimTarget.copy(worldPos);
  }

  /**
   * M1 Attack execution
   */
  performM1() {
    if (this.m1Cooldown > 0) return false;
    this.m1Cooldown = 0.2;
    this.isAttacking = true;
    this.attackAnimTimer = 0.22;
    this.comboStep = (this.comboStep + 1) % 4;

    this.sound.playSlash(1.0 + this.comboStep * 0.2);
    return true;
  }

  update(dt, camera) {
    // 1. Dash charge regeneration (for Lightning destello electrico)
    if (this.lightningDashCharges < 3) {
      this.dashChargeTimer += dt;
      if (this.dashChargeTimer >= 3.0) {
        this.lightningDashCharges++;
        this.dashChargeTimer = 0;
      }
    }

    if (this.dashCooldown > 0) this.dashCooldown -= dt;
    if (this.m1Cooldown > 0) this.m1Cooldown -= dt;

    // 2. Buff Timers
    for (const key in this.buffs) {
      const b = this.buffs[key];
      if (b.active) {
        b.timer -= dt;
        if (b.timer <= 0) {
          b.active = false;
        }
      }
    }

    // 3. Movement input relative to camera yaw
    let moveX = 0;
    let moveZ = 0;
    if (this.keys['KeyW']) moveZ -= 1;
    if (this.keys['KeyS']) moveZ += 1;
    if (this.keys['KeyA']) moveX -= 1;
    if (this.keys['KeyD']) moveX += 1;

    // Camera-relative forward and right vectors
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    camDir.y = 0;
    camDir.normalize();

    const camRight = new THREE.Vector3().crossVectors(camDir, new THREE.Vector3(0, 1, 0)).normalize().negate();

    const moveDir = new THREE.Vector3();
    if (moveX !== 0 || moveZ !== 0) {
      moveDir.addScaledVector(camRight, moveX);
      moveDir.addScaledVector(camDir, -moveZ);
      moveDir.normalize();

      // Face direction of movement
      const targetAngle = Math.atan2(moveDir.x, moveDir.z);
      this.group.rotation.y = targetAngle;
    }

    // 4. Position update (Movement + Dash)
    if (this.dashTimer > 0) {
      this.dashTimer -= dt;
      this.position.addScaledVector(this.dashVelocity, dt);
    } else {
      const currentSpeed = this.moveSpeed * (this.buffs.alarmBuffer.active ? 1.25 : 1.0);
      this.position.addScaledVector(moveDir, currentSpeed * dt);
    }

    // Jump / Levitation
    if (this.keys['Space']) {
      if (this.isGrounded) {
        this.velocity.y = 12.0;
        this.isGrounded = false;
      }
    }

    if (!this.isGrounded) {
      this.velocity.y -= 28.0 * dt; // Gravity
      this.position.y += this.velocity.y * dt;
      if (this.position.y <= 0) {
        this.position.y = 0;
        this.velocity.y = 0;
        this.isGrounded = true;
      }
    }

    this.group.position.copy(this.position);

    // 5. Weapon slash animation
    if (this.isAttacking) {
      this.attackAnimTimer -= dt;
      if (this.attackAnimTimer <= 0) {
        this.isAttacking = false;
        this.rightArm.rotation.x = 0;
      } else {
        // Swing arm down
        this.rightArm.rotation.x = Math.sin((0.22 - this.attackAnimTimer) / 0.22 * Math.PI) * 1.6;
      }
    }

    // 6. Rotate elemental auras
    this.auraRing1.rotation.z += dt * 2.0;
    this.auraRing2.rotation.x += dt * 2.5;

    // Passive HP regen
    if (this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + 15 * dt);
    }
  }
}
