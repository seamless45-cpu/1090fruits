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

// Pre-allocated shared unit vectors (pre-method: avoid per-frame allocs)
const _V3_UP = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------------------
// PHYSICS CONSTANTS (single source of truth - "accurate calculations")
// ---------------------------------------------------------------------------
const GRAVITY = 24.0;          // m/s² game gravity (heavy, readable arcs)
const JUMP_VELOCITY = 11.0;    // m/s  => apex = v²/2g = 2.52 m, airtime 0.92 s
const DASH_DURATION = 0.16;    // s    default dash window
const REGEN_HP_PER_S = 15.0;   // passive regen

// Pre-allocated scratch for combat/anim hot paths (no per-call allocations)
const _slashFwd = new THREE.Vector3();
const _slashPos = new THREE.Vector3();
const _slashLook = new THREE.Vector3();
const _dashFwd = new THREE.Vector3();

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
    this.baseMaxHp = 1000;
    this.maxHp = 1000;
    this.hp = 1000;
    this.maxEnergy = 100;
    this.energy = 100;

    // ==========================================================
    // LEVEL / XP / STAT POINTS (max level 100,000,000)
    // Every kill gains XP; higher enemy levels give +50% XP each.
    // Each stat point adds +50 to its stat value.
    // ==========================================================
    this.MAX_LEVEL = 100000000;
    this.level = 1;
    this.xp = 0;
    this.statPoints = 0;
    // Stat levels (points allocated)
    this.stats = { health: 0, fruit: 0, gun: 0, sword: 0 };
    // Derived damage bonuses (flat +50 per point)
    this.fruitDamageBonus = 0;
    this.gunDamageBonus = 0;
    this.swordDamageBonus = 0;

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
    // Pre-allocated movement scratch (pre-method: zero per-frame allocations)
    this._camDir = new THREE.Vector3();
    this._camRight = new THREE.Vector3();
    this._moveDir = new THREE.Vector3();
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
    this.createSlashTrails();

    // Input state
    this.keys = {};
    this.initInput();
  }

  /**
   * Pooled energy arcs that sweep across the hit zone on every M1 swing.
   */
  createSlashTrails() {
    this.slashTrails = [];
    const arcGeo = new THREE.TorusGeometry(1, 0.08, 8, 32, Math.PI * 1.2);
    for (let i = 0; i < 5; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0,
        side: THREE.DoubleSide, depthWrite: false,
        blending: THREE.AdditiveBlending, fog: false,
      });
      const mesh = new THREE.Mesh(arcGeo, mat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.slashTrails.push({ mesh, mat, active: false, life: 0, maxLife: 0.22 });
    }
  }

  spawnSlashTrail(worldPos) {
    const t = this.slashTrails.find(x => !x.active) || this.slashTrails[0];
    t.active = true;
    t.life = 0;
    t.mesh.visible = true;

    t.mesh.position.copy(worldPos);
    // Arc plane contains (forward, up): point local +Z along the right vector
    _slashLook.set(
      worldPos.x + Math.cos(this.group.rotation.y),
      worldPos.y,
      worldPos.z - Math.sin(this.group.rotation.y)
    );
    t.mesh.lookAt(_slashLook);
    t.mesh.rotateZ(Math.random() * 1.2 - 0.6 + (Math.random() < 0.5 ? Math.PI : 0));

    t.mat.color.copy(this.auraMat.color);
    t.mat.opacity = 0.95;
    t.mesh.scale.setScalar(1.9);
  }

  createModel() {
    this.group = new THREE.Group();
    this.group.position.set(0, 0, 0);
    this.bodyGroup = new THREE.Group();
    this.group.add(this.bodyGroup);

    // ============================================================
    // REMODELLED OPERATIVE: angular bounty-hunter armor with a
    // flowing energy cape, faceted helmet, layered chest plates,
    // asymmetric pauldrons and a hexagonal fruit reactor.
    // ============================================================
    const armorMat = new THREE.MeshStandardMaterial({ color: 0x22344e, roughness: 0.3, metalness: 0.88 });
    const armorDark = new THREE.MeshStandardMaterial({ color: 0x101a29, roughness: 0.42, metalness: 0.8 });
    const armorAccent = new THREE.MeshStandardMaterial({ color: 0x3d5a80, roughness: 0.25, metalness: 0.92 });
    const jointMat = new THREE.MeshStandardMaterial({ color: 0x2c4262, roughness: 0.3, metalness: 0.9 });

    // ---------- Torso: layered chest plates ----------
    const torsoGeo = new THREE.CapsuleGeometry(0.33, 0.6, 6, 12);
    this.torso = new THREE.Mesh(torsoGeo, armorDark);
    this.torso.position.y = 1.32;
    this.torso.castShadow = true;
    this.bodyGroup.add(this.torso);

    // Main chest plate (angled chevron)
    const chestGeo = new THREE.BoxGeometry(0.56, 0.44, 0.3);
    const chest = new THREE.Mesh(chestGeo, armorMat);
    chest.position.set(0, 1.44, 0.18);
    chest.rotation.x = -0.12;
    chest.castShadow = true;
    this.bodyGroup.add(chest);

    // Upper breast plate (chevron step)
    const upperGeo = new THREE.BoxGeometry(0.42, 0.2, 0.26);
    const upper = new THREE.Mesh(upperGeo, armorAccent);
    upper.position.set(0, 1.66, 0.16);
    upper.rotation.x = -0.25;
    upper.castShadow = true;
    this.bodyGroup.add(upper);

    // Abdomen guard
    const abdGeo = new THREE.BoxGeometry(0.4, 0.22, 0.24);
    const abd = new THREE.Mesh(abdGeo, armorMat);
    abd.position.set(0, 1.14, 0.15);
    abd.rotation.x = 0.12;
    abd.castShadow = true;
    this.bodyGroup.add(abd);

    // Hexagonal chest reactor (fruit colored)
    this.reactorMat = new THREE.MeshBasicMaterial({ color: 0xb026ff, fog: false });
    this.reactor = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.07, 6), this.reactorMat);
    this.reactor.rotation.x = Math.PI / 2;
    this.reactor.position.set(0, 1.46, 0.36);
    this.bodyGroup.add(this.reactor);
    // Reactor bezel
    const bezel = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.04, 6), jointMat);
    bezel.rotation.x = Math.PI / 2;
    bezel.position.set(0, 1.46, 0.34);
    this.bodyGroup.add(bezel);

    // Pelvis + belt
    const pelvisGeo = new THREE.CapsuleGeometry(0.26, 0.2, 4, 10);
    this.pelvis = new THREE.Mesh(pelvisGeo, armorDark);
    this.pelvis.position.y = 0.92;
    this.pelvis.castShadow = true;
    this.bodyGroup.add(this.pelvis);

    const beltMat = new THREE.MeshStandardMaterial({ color: 0x1a2637, roughness: 0.5, metalness: 0.7 });
    const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.31, 0.1, 14), beltMat);
    belt.position.y = 0.86;
    this.bodyGroup.add(belt);
    // Glowing belt buckle
    this.buckleMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff, fog: false });
    const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.05), this.buckleMat);
    buckle.position.set(0, 0.86, 0.3);
    this.bodyGroup.add(buckle);

    // ---------- Head: faceted helmet + visor ----------
    const headGeo = new THREE.IcosahedronGeometry(0.24, 0);
    this.head = new THREE.Mesh(headGeo, armorMat);
    this.head.position.y = 2.02;
    this.head.scale.set(0.92, 1.05, 1.0);
    this.head.castShadow = true;
    this.bodyGroup.add(this.head);

    // Jaw guard
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.2), armorDark);
    jaw.position.set(0, 1.9, 0.12);
    this.bodyGroup.add(jaw);

    // Full-face visor glow slit
    this.visorMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff, fog: false });
    const visorGeo = new THREE.BoxGeometry(0.3, 0.07, 0.08);
    this.visor = new THREE.Mesh(visorGeo, this.visorMat);
    this.visor.position.set(0, 2.05, 0.2);
    this.bodyGroup.add(this.visor);

    // Helmet crest (twin fins)
    const crestMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.9, fog: false });
    for (const x of [-0.07, 0.07]) {
      const crest = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.14, 0.26), crestMat);
      crest.position.set(x, 2.26, -0.02);
      crest.rotation.x = 0.15;
      this.bodyGroup.add(crest);
    }
    this.crestMat = crestMat;

    // ---------- Arms: asymmetric pauldrons + bracers ----------
    const upperArmGeo = new THREE.CapsuleGeometry(0.105, 0.32, 4, 8);
    const foreArmGeo = new THREE.CapsuleGeometry(0.095, 0.28, 4, 8);

    this.leftArm = new THREE.Group();
    this.leftArm.position.set(-0.5, 1.6, 0);
    const lShoulder = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), armorMat);
    lShoulder.castShadow = true;
    this.leftArm.add(lShoulder);
    // Small angular pauldron (left)
    const pauldronL = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.34), armorAccent);
    pauldronL.position.set(-0.04, 0.12, 0);
    pauldronL.rotation.z = 0.3;
    pauldronL.castShadow = true;
    this.leftArm.add(pauldronL);
    this.leftUpper = new THREE.Mesh(upperArmGeo, jointMat);
    this.leftUpper.position.y = -0.24;
    this.leftUpper.castShadow = true;
    this.leftArm.add(this.leftUpper);
    this.leftFore = new THREE.Mesh(foreArmGeo, armorDark);
    this.leftFore.position.y = -0.54;
    this.leftFore.castShadow = true;
    this.leftArm.add(this.leftFore);
    // Forearm bracer + glow strip
    const bracerL = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.13, 0.22, 8), armorMat);
    bracerL.position.y = -0.56;
    this.leftArm.add(bracerL);
    const stripL = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.2, 0.03), crestMat);
    stripL.position.set(-0.115, -0.56, 0);
    this.leftArm.add(stripL);
    this.bodyGroup.add(this.leftArm);

    this.rightArm = new THREE.Group();
    this.rightArm.position.set(0.5, 1.6, 0);
    const rShoulder = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), armorMat);
    rShoulder.castShadow = true;
    this.rightArm.add(rShoulder);
    // BIG layered angular pauldron (right, weapon side)
    const pauldronR1 = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.44), armorMat);
    pauldronR1.position.set(0.06, 0.14, 0);
    pauldronR1.rotation.z = -0.25;
    pauldronR1.castShadow = true;
    this.rightArm.add(pauldronR1);
    const pauldronR2 = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.1, 0.38), armorAccent);
    pauldronR2.position.set(0.08, 0.06, 0.02);
    pauldronR2.rotation.z = -0.4;
    pauldronR2.castShadow = true;
    this.rightArm.add(pauldronR2);
    // Pauldron edge light
    const edgeR = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.025, 0.06), crestMat);
    edgeR.position.set(0.06, 0.2, 0.18);
    edgeR.rotation.z = -0.25;
    this.rightArm.add(edgeR);
    this.rightUpper = new THREE.Mesh(upperArmGeo, jointMat);
    this.rightUpper.position.y = -0.24;
    this.rightUpper.castShadow = true;
    this.rightArm.add(this.rightUpper);
    this.rightFore = new THREE.Mesh(foreArmGeo, armorDark);
    this.rightFore.position.y = -0.54;
    this.rightFore.castShadow = true;
    this.rightArm.add(this.rightFore);
    const bracerR = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.13, 0.22, 8), armorMat);
    bracerR.position.y = -0.56;
    this.rightArm.add(bracerR);
    const stripR = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.2, 0.03), crestMat);
    stripR.position.set(0.115, -0.56, 0);
    this.rightArm.add(stripR);
    this.bodyGroup.add(this.rightArm);

    // Weapon hold point (right forearm)
    this.weaponMount = new THREE.Group();
    this.weaponMount.position.set(0, -0.6, 0.18);
    this.rightArm.add(this.weaponMount);

    // ---------- Legs: armored thigh + shin + glow-soled boots ----------
    const thighGeo = new THREE.CapsuleGeometry(0.135, 0.32, 4, 8);
    const shinGeo = new THREE.CapsuleGeometry(0.11, 0.28, 4, 8);

    const makeLeg = (x) => {
      const leg = new THREE.Group();
      leg.position.set(x, 0.86, 0);
      const thigh = new THREE.Mesh(thighGeo, armorMat);
      thigh.position.y = -0.22;
      thigh.castShadow = true;
      leg.add(thigh);
      // Thigh plate
      const thighPlate = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.1), armorAccent);
      thighPlate.position.set(0, -0.2, 0.12);
      thighPlate.castShadow = true;
      leg.add(thighPlate);
      const shin = new THREE.Mesh(shinGeo, armorDark);
      shin.position.y = -0.54;
      shin.castShadow = true;
      leg.add(shin);
      // Knee cap + glow
      const knee = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), armorAccent);
      knee.position.set(0, -0.4, 0.1);
      leg.add(knee);
      const kneeGlow = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.03), crestMat);
      kneeGlow.position.set(0, -0.4, 0.18);
      leg.add(kneeGlow);
      // Chunky boot + glow sole
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.13, 0.3), new THREE.MeshStandardMaterial({ color: 0x0a1119, roughness: 0.4, metalness: 0.8 }));
      boot.position.set(0, -0.76, 0.04);
      boot.castShadow = true;
      leg.add(boot);
      const soleGlow = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.02, 0.28), crestMat);
      soleGlow.position.set(0, -0.82, 0.04);
      leg.add(soleGlow);
      return leg;
    };
    this.leftLeg = makeLeg(-0.21);
    this.rightLeg = makeLeg(0.21);
    this.bodyGroup.add(this.leftLeg);
    this.bodyGroup.add(this.rightLeg);

    // ---------- Backpack + twin thrusters ----------
    const packGeo = new THREE.BoxGeometry(0.4, 0.46, 0.15);
    const pack = new THREE.Mesh(packGeo, armorDark);
    pack.position.set(0, 1.4, -0.28);
    pack.castShadow = true;
    this.bodyGroup.add(pack);
    const packCell = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.14, 0.06), crestMat);
    packCell.position.set(0, 1.5, -0.36);
    this.bodyGroup.add(packCell);

    this.thrusterMat = new THREE.MeshBasicMaterial({ color: 0x223344, fog: false });
    const nozzleGeo = new THREE.CylinderGeometry(0.055, 0.085, 0.15, 10);
    for (const x of [-0.12, 0.12]) {
      const n = new THREE.Mesh(nozzleGeo, this.thrusterMat);
      n.position.set(x, 1.16, -0.32);
      this.bodyGroup.add(n);
    }

    // ---------- Flowing energy cape ----------
    // Vertically segmented plane draped from the shoulders; vertices are
    // animated every frame (cheap CPU wave, more cloth-like than a shader).
    const capeGeo = new THREE.PlaneGeometry(0.95, 1.25, 6, 10);
    const capeMat = new THREE.MeshStandardMaterial({
      color: 0x141d2e, roughness: 0.85, metalness: 0.2, side: THREE.DoubleSide,
    });
    this.cape = new THREE.Mesh(capeGeo, capeMat);
    this.cape.position.set(0, 1.78, -0.3);
    this.cape.rotation.x = 0.12;
    this.capeBasePositions = capeGeo.attributes.position.array.slice();
    this.bodyGroup.add(this.cape);
    // Glowing trim along the cape hem
    const trimGeo = new THREE.BoxGeometry(0.95, 0.035, 0.012);
    this.capeTrimMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.75, fog: false });
    this.capeTrim = new THREE.Mesh(trimGeo, this.capeTrimMat);
    this.capeTrim.position.set(0, -0.62, 0.02);
    this.cape.add(this.capeTrim);

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

    // ---------- Fresnel rim-light shell ----------
    // A single additive shell hugging the torso silhouettes the hero with a
    // fruit-colored edge glow (reads at any distance, costs 1 draw call).
    this.rimMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      uniforms: {
        uColor: { value: new THREE.Color(0x00f0ff) },
        uPower: { value: 2.6 },
        uStrength: { value: 0.85 },
      },
      vertexShader: /* glsl */`
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vNormal = normalize(normalMatrix * normal);
          vView = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor;
        uniform float uPower;
        uniform float uStrength;
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          float fres = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), uPower);
          gl_FragColor = vec4(uColor, fres * uStrength);
        }`,
    });
    this.rimShell = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.46, 1.05, 6, 20),
      this.rimMat
    );
    this.rimShell.position.y = 1.35;
    this.bodyGroup.add(this.rimShell);

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
    this.equippedSwordType = 'none';
    this.updateWeaponVisuals('none');
  }

  /**
   * Animate the cape cloth: layered sine waves traveling down the fabric,
   * amplitude scales with movement speed and dashes.
   */
  animateCape(dt) {
    if (!this.cape) return;
    const posAttr = this.cape.geometry.attributes.position;
    const arr = posAttr.array;
    const base = this.capeBasePositions;
    const t = this.animTime * 6.0;

    const speed = (this.isMoving ? this.moveSpeed : 0) * 0.06;
    const dash = this.dashTimer > 0 ? 1.8 : 0;
    const amp = 0.03 + speed * 0.5 + dash * 0.25;

    for (let i = 0; i < posAttr.count; i++) {
      const bx = base[i * 3];
      const by = base[i * 3 + 1];
      // Row factor: 0 at the shoulder, 1 at the hem
      const row = 0.5 - by / 1.25;
      const wave =
        Math.sin(t + bx * 4.0 + row * 2.8) * row * row * amp * 0.8 +
        Math.sin(t * 1.7 + bx * 7.0 + row * 5.0) * row * amp * 0.35;
      arr[i * 3] = bx + Math.sin(t * 0.9 + row * 2.0) * row * amp * 0.5;
      arr[i * 3 + 1] = by;
      arr[i * 3 + 2] = -row * 0.22 + wave;
    }
    posAttr.needsUpdate = true;
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

    // Shared hilt (skipped for bare fists)
    if (swordType !== 'none') {
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
    }

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
    } else {
      // BARE FISTS: energy gauntlets (no sword equipped)
      const fistGeo = new THREE.SphereGeometry(0.13, 10, 8);
      const fistMat = new THREE.MeshStandardMaterial({ color: 0x2a3a52, roughness: 0.4, metalness: 0.8 });
      const fist = new THREE.Mesh(fistGeo, fistMat);
      fist.position.y = 0.08;
      fist.scale.set(1.1, 0.9, 1.2);
      swordGroup.add(fist);

      const knuckleMat = new THREE.MeshBasicMaterial({
        color: 0x88ccff, transparent: true, opacity: 0.85,
        blending: THREE.AdditiveBlending, fog: false,
      });
      const knuckles = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.02, 6, 12, Math.PI), knuckleMat);
      knuckles.position.set(0, 0.12, 0.05);
      knuckles.rotation.x = -Math.PI / 2;
      swordGroup.add(knuckles);
      this.weaponGlowMats.push(knuckleMat);
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
    if (this.rimMat) this.rimMat.uniforms.uColor.value.setHex(c);
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

  /**
   * Dash. ACCURACY FIX: the dash now covers EXACTLY `distance` meters.
   * The old version accepted (distance, speed) but moved at speed*0.16s
   * regardless of distance (a 60 m/s dash covered 9.6 m, not the stated
   * 12 m; a 240 m/s skill dash overshot to 38 m). The travel window adapts
   * so that distance = speed x duration always holds.
   * @param {number} distance - exact ground distance to cover (meters)
   * @param {number|null} speed - optional launch speed (m/s); duration adapts
   */
  triggerDash(distance = 12.0, speed = null) {
    if (this.dashCooldown > 0) return;
    this.dashCooldown = 0.5;

    // Dash along the body's forward direction (local -Z rotated by yaw)
    _dashFwd.set(-Math.sin(this.group.rotation.y), 0, -Math.cos(this.group.rotation.y));

    let duration = DASH_DURATION;
    if (speed && speed > 0) {
      duration = Math.max(0.06, Math.min(0.3, distance / speed));
    }
    const velocity = distance / duration; // exact distance guarantee

    this.dashVelocity.copy(_dashFwd).multiplyScalar(velocity);
    this.dashTimer = duration;
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

  /**
   * XP required to advance from the current level to the next.
   * Gentle curve at low levels, keeps climbing to level 100,000,000.
   */
  xpNeeded() {
    return Math.floor(100 * Math.pow(this.level, 1.55));
  }

  /**
   * Grant XP. Returns the number of levels gained (may be >1, or 0).
   * Each level grants +3 stat points.
   */
  gainXp(amount) {
    amount = Math.max(0, Math.floor(amount));
    if (amount === 0 || this.level >= this.MAX_LEVEL) return 0;

    this.xp += amount;
    let levelsGained = 0;
    let need = this.xpNeeded();
    while (this.xp >= need && this.level < this.MAX_LEVEL) {
      this.xp -= need;
      this.level++;
      levelsGained++;
      need = this.xpNeeded();
    }
    if (this.level >= this.MAX_LEVEL) this.xp = 0;

    if (levelsGained > 0) {
      this.statPoints += levelsGained * 3;
    }
    return levelsGained;
  }

  /**
   * Apply stat allocation to derived values.
   * Each point: +50 max health / +50 fruit dmg / +50 gun dmg / +50 sword dmg.
   */
  applyStats() {
    const newMax = this.baseMaxHp + this.stats.health * 50;
    if (newMax > this.maxHp) {
      // Top up current HP for the newly gained pool
      this.hp += (newMax - this.maxHp);
    }
    this.maxHp = newMax;
    this.hp = Math.min(this.hp, this.maxHp);

    this.fruitDamageBonus = this.stats.fruit * 50;
    this.gunDamageBonus = this.stats.gun * 50;
    this.swordDamageBonus = this.stats.sword * 50;
  }

  /**
   * Spend stat points on a stat. Returns false if not enough points.
   */
  spendStatPoints(statKey, count) {
    if (!this.stats.hasOwnProperty(statKey)) return false;
    count = Math.floor(count);
    if (count <= 0 || count > this.statPoints) return false;
    this.stats[statKey] += count;
    this.statPoints -= count;
    this.applyStats();
    return true;
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

    // Energy arc sweeping the hit zone in front of the operative
    _slashFwd.set(-Math.sin(this.group.rotation.y), 0, -Math.cos(this.group.rotation.y));
    _slashPos.copy(this.position).addScaledVector(_slashFwd, 3.2);
    _slashPos.y = 1.4;
    this.spawnSlashTrail(_slashPos);

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

    // Camera-relative forward and right vectors (pre-allocated scratch)
    const camDir = this._camDir;
    camera.getWorldDirection(camDir);
    camDir.y = 0;
    camDir.normalize();

    const camRight = this._camRight.crossVectors(camDir, _V3_UP).normalize().negate();

    const moveDir = this._moveDir;
    moveDir.set(0, 0, 0);
    this.isMoving = (moveX !== 0 || moveZ !== 0) && this.dashTimer <= 0;
    if (moveX !== 0 || moveZ !== 0) {
      moveDir.addScaledVector(camRight, moveX);
      moveDir.addScaledVector(camDir, -moveZ);
      moveDir.normalize();

      // Face direction of movement
      const targetAngle = Math.atan2(moveDir.x, moveDir.z);
      this.group.rotation.y = targetAngle;
    }

    // 4. Position update (Movement + Dash) - exact distances:
    //    the final dash step is clamped to the remaining window so
    //    distance = velocity x duration holds at ANY framerate.
    if (this.dashTimer > 0) {
      const step = Math.min(this.dashTimer, dt);
      this.position.addScaledVector(this.dashVelocity, step);
      this.dashTimer -= dt;
    } else {
      const currentSpeed = this.moveSpeed * (this.buffs.alarmBuffer.active ? 1.25 : 1.0);
      this.position.addScaledVector(moveDir, currentSpeed * dt);
    }

    // Jump / Levitation (semi-implicit Euler: v += g*dt BEFORE x += v*dt)
    if (this.keys['Space']) {
      if (this.isGrounded) {
        this.velocity.y = JUMP_VELOCITY;
        this.isGrounded = false;
      }
    }

    if (!this.isGrounded) {
      this.velocity.y -= GRAVITY * dt;
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
    this.animateCape(dt);

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
    // Fresnel rim breathes with the aura (single uniform write)
    if (this.rimMat) this.rimMat.uniforms.uStrength.value = 0.7 + 0.25 * Math.sin(this.animTime * 3.0);

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
      // Frame-rate independent fade (exp decay, not 1-min(1,dt*k))
      this.dashSpriteMat.opacity *= Math.exp(-dt * 8.0);
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

    // Energy slash arcs
    for (const t of this.slashTrails) {
      if (!t.active) continue;
      t.life += dt;
      if (t.life >= t.maxLife) {
        t.active = false;
        t.mesh.visible = false;
        continue;
      }
      const p = t.life / t.maxLife;
      t.mat.opacity = (1.0 - p) * 0.95;
      t.mesh.scale.setScalar(1.9 + p * 1.3);
      t.mesh.rotateZ(dt * 22.0);
    }

    // Passive HP regen
    if (this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + REGEN_HP_PER_S * dt);
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
    // Frame-rate independent lean easing
    this.bodyGroup.rotation.x += (targetLean - this.bodyGroup.rotation.x) * (1 - Math.exp(-dt * 8));

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
