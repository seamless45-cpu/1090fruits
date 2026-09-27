import * as THREE from 'three';

/**
 * 3D 1090 Fruits - Player Operative Controller
 *
 * Cinematic hero model built from primitives:
 *  - Segmented armor (capsule torso/limbs, pauldrons, helmet + visor)
 *  - Glowing chest reactor + fruit-colored aura rings
 *  - Procedural walk / idle / dash / slash animation
 *  - Dash afterimage trail + thruster flare
 *  - Melee slash trail arc
 *  - Ground aim reticle projected at the crosshair point
 *  - Weapon attachments with emissive energy edges
 */

const FRUIT_COLORS = {
  gravity: 0xb026ff,
  lightning: 0x00f0ff,
  quake: 0x00bfff,
  alarm: 0xff0044,
  rimefracture: 0x88eeff,
  wildfire: 0xff5500,
  cloud: 0xffffff,
  none: 0x557799
};

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

    // Animation state
    this.animTime = 0;
    this.walkPhase = 0;
    this.isMoving = false;

    // Build 3D Operative Mesh
    this.createModel();
    this.createAimReticle();
    this.createAfterimages();

    // Input state
    this.keys = {};
    this.initInput();
  }

  createModel() {
    this.group = new THREE.Group();
    this.group.position.set(0, 0, 0);
    this.bodyGroup = new THREE.Group();
    this.group.add(this.bodyGroup);

    const armorMat = new THREE.MeshStandardMaterial({ color: 0x1b2a40, roughness: 0.32, metalness: 0.85 });
    const armorDark = new THREE.MeshStandardMaterial({ color: 0x0e1622, roughness: 0.45, metalness: 0.75 });
    const jointMat = new THREE.MeshStandardMaterial({ color: 0x2a3d58, roughness: 0.3, metalness: 0.9 });

    // ---------- Torso ----------
    const torsoGeo = new THREE.CapsuleGeometry(0.34, 0.62, 6, 12);
    this.torso = new THREE.Mesh(torsoGeo, armorMat);
    this.torso.position.y = 1.32;
    this.torso.castShadow = true;
    this.bodyGroup.add(this.torso);

    // Chest plate
    const chestGeo = new THREE.BoxGeometry(0.58, 0.5, 0.3);
    const chest = new THREE.Mesh(chestGeo, armorDark);
    chest.position.set(0, 1.46, 0.2);
    chest.castShadow = true;
    this.bodyGroup.add(chest);

    // Chest reactor (fruit colored glow)
    this.reactorMat = new THREE.MeshBasicMaterial({ color: 0xb026ff, fog: false });
    this.reactor = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.06, 16), this.reactorMat);
    this.reactor.rotation.x = Math.PI / 2;
    this.reactor.position.set(0, 1.48, 0.38);
    this.bodyGroup.add(this.reactor);

    // Pelvis
    const pelvisGeo = new THREE.CapsuleGeometry(0.26, 0.22, 4, 10);
    this.pelvis = new THREE.Mesh(pelvisGeo, armorDark);
    this.pelvis.position.y = 0.92;
    this.pelvis.castShadow = true;
    this.bodyGroup.add(this.pelvis);

    // ---------- Head / Helmet ----------
    const headGeo = new THREE.SphereGeometry(0.24, 16, 14);
    this.head = new THREE.Mesh(headGeo, armorMat);
    this.head.position.y = 2.02;
    this.head.castShadow = true;
    this.bodyGroup.add(this.head);

    // Visor (full face glow slit)
    this.visorMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff, fog: false });
    const visorGeo = new THREE.BoxGeometry(0.34, 0.1, 0.12);
    this.visor = new THREE.Mesh(visorGeo, this.visorMat);
    this.visor.position.set(0, 2.04, 0.2);
    this.bodyGroup.add(this.visor);

    // Head crest light
    const crestMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.9, fog: false });
    const crest = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.3), crestMat);
    crest.position.set(0, 2.28, 0);
    this.bodyGroup.add(crest);
    this.crestMat = crestMat;

    // ---------- Arms ----------
    const shoulderGeo = new THREE.SphereGeometry(0.17, 12, 10);
    const upperArmGeo = new THREE.CapsuleGeometry(0.11, 0.34, 4, 8);
    const foreArmGeo = new THREE.CapsuleGeometry(0.1, 0.3, 4, 8);

    this.leftArm = new THREE.Group();
    this.leftArm.position.set(-0.52, 1.62, 0);
    const lShoulder = new THREE.Mesh(shoulderGeo, armorMat);
    lShoulder.castShadow = true;
    this.leftArm.add(lShoulder);
    // Pauldron
    const pauldronGeo = new THREE.SphereGeometry(0.2, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const pauldronMat = new THREE.MeshStandardMaterial({ color: 0x24405f, roughness: 0.3, metalness: 0.9 });
    const pauldron = new THREE.Mesh(pauldronGeo, pauldronMat);
    pauldron.scale.set(1.15, 0.9, 1.15);
    pauldron.castShadow = true;
    this.leftArm.add(pauldron);
    this.leftUpper = new THREE.Mesh(upperArmGeo, jointMat);
    this.leftUpper.position.y = -0.24;
    this.leftUpper.castShadow = true;
    this.leftArm.add(this.leftUpper);
    this.leftFore = new THREE.Mesh(foreArmGeo, armorDark);
    this.leftFore.position.y = -0.56;
    this.leftFore.castShadow = true;
    this.leftArm.add(this.leftFore);
    this.bodyGroup.add(this.leftArm);

    this.rightArm = new THREE.Group();
    this.rightArm.position.set(0.52, 1.62, 0);
    const rShoulder = new THREE.Mesh(shoulderGeo, armorMat);
    rShoulder.castShadow = true;
    this.rightArm.add(rShoulder);
    const pauldronR = new THREE.Mesh(pauldronGeo, pauldronMat);
    pauldronR.scale.set(1.15, 0.9, 1.15);
    pauldronR.castShadow = true;
    this.rightArm.add(pauldronR);
    this.rightUpper = new THREE.Mesh(upperArmGeo, jointMat);
    this.rightUpper.position.y = -0.24;
    this.rightUpper.castShadow = true;
    this.rightArm.add(this.rightUpper);
    this.rightFore = new THREE.Mesh(foreArmGeo, armorDark);
    this.rightFore.position.y = -0.56;
    this.rightFore.castShadow = true;
    this.rightArm.add(this.rightFore);
    this.bodyGroup.add(this.rightArm);

    // Weapon hold point (relative to right arm, at the forearm)
    this.weaponMount = new THREE.Group();
    this.weaponMount.position.set(0, -0.62, 0.18);
    this.rightArm.add(this.weaponMount);

    // ---------- Legs ----------
    const thighGeo = new THREE.CapsuleGeometry(0.14, 0.34, 4, 8);
    const shinGeo = new THREE.CapsuleGeometry(0.12, 0.3, 4, 8);
    const bootGeo = new THREE.BoxGeometry(0.2, 0.14, 0.3);
    const bootMat = new THREE.MeshStandardMaterial({ color: 0x0a1119, roughness: 0.4, metalness: 0.8 });

    this.leftLeg = new THREE.Group();
    this.leftLeg.position.set(-0.22, 0.86, 0);
    const lThigh = new THREE.Mesh(thighGeo, armorMat);
    lThigh.position.y = -0.22;
    lThigh.castShadow = true;
    this.leftLeg.add(lThigh);
    this.leftShin = new THREE.Mesh(shinGeo, armorDark);
    this.leftShin.position.y = -0.55;
    this.leftShin.castShadow = true;
    this.leftLeg.add(this.leftShin);
    const lBoot = new THREE.Mesh(bootGeo, bootMat);
    lBoot.position.set(0, -0.78, 0.04);
    lBoot.castShadow = true;
    this.leftLeg.add(lBoot);
    this.bodyGroup.add(this.leftLeg);

    this.rightLeg = new THREE.Group();
    this.rightLeg.position.set(0.22, 0.86, 0);
    const rThigh = new THREE.Mesh(thighGeo, armorMat);
    rThigh.position.y = -0.22;
    rThigh.castShadow = true;
    this.rightLeg.add(rThigh);
    this.rightShin = new THREE.Mesh(shinGeo, armorDark);
    this.rightShin.position.y = -0.55;
    this.rightShin.castShadow = true;
    this.rightLeg.add(this.rightShin);
    const rBoot = new THREE.Mesh(bootGeo, bootMat);
    rBoot.position.set(0, -0.78, 0.04);
    rBoot.castShadow = true;
    this.rightLeg.add(rBoot);
    this.bodyGroup.add(this.rightLeg);

    // ---------- Backpack + Thrusters ----------
    const packGeo = new THREE.BoxGeometry(0.42, 0.5, 0.16);
    const pack = new THREE.Mesh(packGeo, armorDark);
    pack.position.set(0, 1.42, -0.3);
    pack.castShadow = true;
    this.bodyGroup.add(pack);

    this.thrusterMat = new THREE.MeshBasicMaterial({ color: 0x223344, fog: false });
    const nozzleGeo = new THREE.CylinderGeometry(0.06, 0.09, 0.14, 10);
    for (const x of [-0.13, 0.13]) {
      const n = new THREE.Mesh(nozzleGeo, this.thrusterMat);
      n.position.set(x, 1.18, -0.34);
      this.bodyGroup.add(n);
    }

    // Dash glow sprite (behind, shown during dash)
    this.dashSpriteMat = new THREE.SpriteMaterial({
      color: 0x00f0ff, transparent: true, opacity: 0.0,
      depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
    this.dashSprite = new THREE.Sprite(this.dashSpriteMat);
    this.dashSprite.scale.set(1.6, 1.6, 1);
    this.dashSprite.position.set(0, 1.3, -0.5);
    this.bodyGroup.add(this.dashSprite);

    // ---------- Elemental Aura Rings ----------
    const auraGeo = new THREE.TorusGeometry(1.2, 0.035, 8, 48);
    this.auraMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff, transparent: true, opacity: 0.6,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    this.auraRing1 = new THREE.Mesh(auraGeo, this.auraMat);
    this.auraRing1.position.y = 1.3;
    this.auraRing1.rotation.x = Math.PI / 2.3;
    this.bodyGroup.add(this.auraRing1);

    this.auraRing2 = new THREE.Mesh(auraGeo, this.auraMat);
    this.auraRing2.position.y = 1.3;
    this.auraRing2.rotation.y = Math.PI / 3;
    this.bodyGroup.add(this.auraRing2);

    // Soft halo under the feet (fruit colored)
    const haloCv = document.createElement('canvas');
    haloCv.width = 64;
    haloCv.height = 64;
    const hctx = haloCv.getContext('2d');
    const grad = hctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255,255,255,0.5)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    hctx.fillStyle = grad;
    hctx.fillRect(0, 0, 64, 64);
    const haloTex = new THREE.CanvasTexture(haloCv);
    this.haloMat = new THREE.SpriteMaterial({
      map: haloTex, color: 0x00f0ff, transparent: true, opacity: 0.4,
      depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
    this.halo = new THREE.Sprite(this.haloMat);
    this.halo.scale.set(3.2, 3.2, 1);
    this.halo.position.y = 0.08;
    this.group.add(this.halo);

    this.scene.add(this.group);

    // Current weapon mesh container
    this.currentWeaponMesh = null;
    this.equippedSwordType = 'gravity_blade';
    this.updateWeaponVisuals('gravity_blade');
  }

  createAimReticle() {
    // Ground reticle that tracks the crosshair intersection
    this.aimGroup = new THREE.Group();
    this.aimGroup.position.y = 0.1;

    const ringGeo = new THREE.RingGeometry(0.9, 1.15, 40);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff, transparent: true, opacity: 0.85,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
    this.aimRingMat = ringMat;
    this.aimRing = new THREE.Mesh(ringGeo, ringMat);
    this.aimGroup.add(this.aimRing);

    const innerGeo = new THREE.CircleGeometry(0.18, 16);
    innerGeo.rotateX(-Math.PI / 2);
    const innerMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.9,
      depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
    this.aimGroup.add(new THREE.Mesh(innerGeo, innerMat));

    // Cross ticks
    const tickGeo = new THREE.PlaneGeometry(0.1, 0.6);
    tickGeo.rotateX(-Math.PI / 2);
    const tickMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff, transparent: true, opacity: 0.8,
      depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
    for (let i = 0; i < 4; i++) {
      const tick = new THREE.Mesh(tickGeo, tickMat);
      const a = (i / 4) * Math.PI * 2;
      tick.position.set(Math.cos(a) * 1.6, 0, Math.sin(a) * 1.6);
      tick.rotation.y = -a + Math.PI / 2;
      this.aimGroup.add(tick);
    }

    this.scene.add(this.aimGroup);
  }

  createAfterimages() {
    // Pooled ghost copies for the dash trail
    this.afterimages = [];
    const ghostGeo = new THREE.CapsuleGeometry(0.36, 0.9, 4, 8);
    for (let i = 0; i < 8; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x00f0ff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      });
      const ghost = new THREE.Mesh(ghostGeo, mat);
      ghost.visible = false;
      this.scene.add(ghost);
      this.afterimages.push({ mesh: ghost, mat, life: 0, active: false });
    }
    this.afterimageTimer = 0;
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
    this.weaponGlowMats = [];

    // Shared hilt
    const hiltGeo = new THREE.CylinderGeometry(0.035, 0.045, 0.5, 8);
    const hiltMat = new THREE.MeshStandardMaterial({ color: 0x222b38, metalness: 0.9, roughness: 0.3 });
    const hilt = new THREE.Mesh(hiltGeo, hiltMat);
    hilt.position.y = 0.25;
    swordGroup.add(hilt);

    const guardGeo = new THREE.BoxGeometry(0.3, 0.05, 0.1);
    const guardMat = new THREE.MeshStandardMaterial({ color: 0x33405a, metalness: 0.9, roughness: 0.25 });
    const guard = new THREE.Mesh(guardGeo, guardMat);
    guard.position.y = 0.52;
    swordGroup.add(guard);

    if (swordType === 'gravity_blade') {
      // Purple / Obsidian heavy blade with hot energy edge
      const bladeGeo = new THREE.BoxGeometry(0.1, 1.9, 0.24);
      const bladeMat = new THREE.MeshStandardMaterial({
        color: 0x1c0830, emissive: 0x7700cc, emissiveIntensity: 0.7, roughness: 0.2, metalness: 0.9
      });
      const blade = new THREE.Mesh(bladeGeo, bladeMat);
      blade.position.y = 1.48;
      blade.castShadow = true;
      swordGroup.add(blade);

      const edgeMat = new THREE.MeshBasicMaterial({
        color: 0xcc55ff, transparent: true, opacity: 0.95,
        blending: THREE.AdditiveBlending, fog: false,
      });
      const edge = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.92, 0.26), edgeMat);
      edge.position.set(0.05, 1.48, 0);
      swordGroup.add(edge);
      const edge2 = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.92, 0.26), edgeMat);
      edge2.position.set(-0.05, 1.48, 0);
      swordGroup.add(edge2);
      this.weaponGlowMats.push(edgeMat);
    } else if (swordType === 'pole') {
      // Long golden lightning staff with a charged orb
      const poleGeo = new THREE.CylinderGeometry(0.045, 0.055, 2.5, 12);
      const poleMat = new THREE.MeshStandardMaterial({
        color: 0x886a10, emissive: 0xaa8800, emissiveIntensity: 0.5, metalness: 0.95, roughness: 0.25
      });
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.y = 1.35;
      pole.castShadow = true;
      swordGroup.add(pole);

      const orbMat = new THREE.MeshBasicMaterial({ color: 0xffdd44, fog: false });
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 14), orbMat);
      orb.position.y = 2.65;
      swordGroup.add(orb);
      this.weaponGlowMats.push(orbMat);
    } else if (swordType === 'bisento') {
      // Massive crescent halberd / bisento
      const shaftGeo = new THREE.CylinderGeometry(0.05, 0.06, 2.7, 10);
      const shaftMat = new THREE.MeshStandardMaterial({ color: 0x3a2416, metalness: 0.6, roughness: 0.5 });
      const shaft = new THREE.Mesh(shaftGeo, shaftMat);
      shaft.position.y = 1.35;
      shaft.castShadow = true;
      swordGroup.add(shaft);

      const crescentGeo = new THREE.TorusGeometry(0.55, 0.09, 10, 24, Math.PI * 1.35);
      const crescentMat = new THREE.MeshStandardMaterial({
        color: 0xcddcee, emissive: 0x0088cc, emissiveIntensity: 0.8, metalness: 0.95, roughness: 0.15
      });
      const crescent = new THREE.Mesh(crescentGeo, crescentMat);
      crescent.position.set(0, 2.3, 0);
      crescent.rotation.z = Math.PI * 0.82;
      crescent.castShadow = true;
      swordGroup.add(crescent);

      const edgeMat = new THREE.MeshBasicMaterial({
        color: 0x66ddff, transparent: true, opacity: 0.8,
        blending: THREE.AdditiveBlending, fog: false,
      });
      const edge = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.03, 8, 24, Math.PI * 1.35), edgeMat);
      edge.position.copy(crescent.position);
      edge.rotation.z = crescent.rotation.z;
      swordGroup.add(edge);
      this.weaponGlowMats.push(edgeMat);
    } else if (swordType === 'alarm_sword') {
      // Crimson high-tech energy blade
      const alarmBladeGeo = new THREE.BoxGeometry(0.09, 1.8, 0.22);
      const alarmBladeMat = new THREE.MeshStandardMaterial({
        color: 0x2a000d, emissive: 0xff0044, emissiveIntensity: 1.0, metalness: 0.8, roughness: 0.3
      });
      const blade = new THREE.Mesh(alarmBladeGeo, alarmBladeMat);
      blade.position.y = 1.42;
      blade.castShadow = true;
      swordGroup.add(blade);

      const edgeMat = new THREE.MeshBasicMaterial({
        color: 0xff4477, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, fog: false,
      });
      const core = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.82, 0.24), edgeMat);
      core.position.y = 1.42;
      swordGroup.add(core);
      this.weaponGlowMats.push(edgeMat);
    }

    this.currentWeaponMesh = swordGroup;
    this.weaponMount.add(this.currentWeaponMesh);
  }

  /**
   * Update elemental aura color according to active fruit
   */
  updateFruitAura(fruitType) {
    const c = FRUIT_COLORS[fruitType] || 0x00f0ff;
    this.auraMat.color.setHex(c);
    this.visorMat.color.setHex(c);
    this.reactorMat.color.setHex(c);
    this.haloMat.color.setHex(c);
    this.crestMat.color.setHex(c);
    this.dashSpriteMat.color.setHex(c);
    for (const a of this.afterimages) a.mat.color.setHex(c);
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
    this.thrusterMat.color.setHex(0x88eeff);

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
    this.isMoving = (moveX !== 0 || moveZ !== 0) && this.dashTimer <= 0;
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

    // 5. Procedural animation
    this.animTime += dt;
    this.animateBody(dt);

    // 6. Weapon slash animation
    if (this.isAttacking) {
      this.attackAnimTimer -= dt;
      if (this.attackAnimTimer <= 0) {
        this.isAttacking = false;
        this.rightArm.rotation.x = 0;
        this.rightArm.rotation.z = 0;
      } else {
        // Big overhead swing
        const p = (0.22 - this.attackAnimTimer) / 0.22;
        this.rightArm.rotation.x = Math.sin(p * Math.PI) * 2.1 - 0.4;
        this.rightArm.rotation.z = -Math.sin(p * Math.PI) * 0.7;
        // Slight body follow-through
        this.bodyGroup.rotation.x = Math.sin(p * Math.PI) * 0.15;
      }
    } else {
      this.bodyGroup.rotation.x *= (1 - Math.min(1, dt * 10));
    }

    // 7. Rotate elemental auras + pulse
    this.auraRing1.rotation.z += dt * 2.0;
    this.auraRing2.rotation.x += dt * 2.5;
    const auraPulse = 0.5 + 0.2 * Math.sin(this.animTime * 3.0);
    this.auraMat.opacity = auraPulse;
    this.haloMat.opacity = 0.3 + 0.15 * Math.sin(this.animTime * 3.0);

    // Weapon glow pulse
    if (this.weaponGlowMats) {
      for (const m of this.weaponGlowMats) {
        if (m.opacity !== undefined) m.opacity = 0.75 + 0.25 * Math.sin(this.animTime * 5.0);
      }
    }

    // Reactor pulse (circle plane is local XZ for the rotated cylinder)
    const rp = 1 + Math.sin(this.animTime * 4.0) * 0.12;
    this.reactor.scale.set(rp, 1, rp);

    // 8. Aim reticle follows crosshair ground point
    this.aimGroup.position.set(this.aimTarget.x, 0.1, this.aimTarget.z);
    const rr = 1 + 0.08 * Math.sin(this.animTime * 6.0);
    this.aimRing.scale.set(rr, 1, rr);

    // 9. Dash afterimages + thruster flare
    if (this.dashTimer > 0) {
      this.afterimageTimer -= dt;
      if (this.afterimageTimer <= 0) {
        this.afterimageTimer = 0.02;
        const ghost = this.afterimages.find(a => !a.active) || this.afterimages[0];
        ghost.active = true;
        ghost.life = 0.3;
        ghost.mesh.visible = true;
        ghost.mesh.position.copy(this.position).add(new THREE.Vector3(0, 1.35, 0));
        ghost.mesh.rotation.y = this.group.rotation.y;
        ghost.mat.opacity = 0.5;
      }
      this.dashSpriteMat.opacity = 0.9;
    } else {
      this.dashSpriteMat.opacity *= (1 - Math.min(1, dt * 8));
      if (this.thrusterMat.color.getHex() === 0x88eeff) {
        this.thrusterMat.color.setHex(0x223344);
      }
    }

    for (const a of this.afterimages) {
      if (!a.active) continue;
      a.life -= dt;
      if (a.life <= 0) {
        a.active = false;
        a.mesh.visible = false;
        continue;
      }
      a.mat.opacity = (a.life / 0.3) * 0.5;
      a.mesh.scale.setScalar(1 + (1 - a.life / 0.3) * 0.35);
    }

    // Passive HP regen
    if (this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + 15 * dt);
    }
  }

  /**
   * Procedural body animation (walk cycle, idle breathing, jump tuck).
   */
  animateBody(dt) {
    const speed = this.isMoving ? this.moveSpeed : 0;
    if (this.isMoving) {
      this.walkPhase += dt * (speed * 1.35);
    }

    const swing = Math.sin(this.walkPhase);
    const swing2 = Math.sin(this.walkPhase + Math.PI);
    const air = !this.isGrounded;

    // Legs
    this.leftLeg.rotation.x = air ? -0.5 : swing * 0.7;
    this.rightLeg.rotation.x = air ? 0.4 : swing2 * 0.7;

    // Arms (opposite of legs; right arm reserved for weapon swing)
    this.leftArm.rotation.x = air ? -0.9 : swing2 * 0.55;
    if (!this.isAttacking) {
      this.rightArm.rotation.x = air ? -1.1 : swing * 0.55;
    }
    this.leftArm.rotation.z = 0.08 + (air ? 0.25 : 0);

    // Body bob & lean
    const bob = this.isMoving && this.isGrounded ? Math.abs(Math.sin(this.walkPhase)) * 0.07 : 0;
    this.bodyGroup.position.y = bob + (air ? 0.05 : 0);
    const targetLean = this.isMoving ? 0.09 : 0.0;
    this.bodyGroup.rotation.x += (targetLean - this.bodyGroup.rotation.x * 0.5) * Math.min(1, dt * 8);

    // Idle breathing
    if (!this.isMoving && this.isGrounded) {
      this.bodyGroup.scale.y = 1 + Math.sin(this.animTime * 1.8) * 0.008;
    } else {
      this.bodyGroup.scale.y += (1 - this.bodyGroup.scale.y) * Math.min(1, dt * 8);
    }

    // Dash lean forward
    if (this.dashTimer > 0) {
      this.bodyGroup.rotation.x = Math.max(this.bodyGroup.rotation.x, 0.45);
    }
  }
}
