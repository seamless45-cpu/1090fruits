import * as THREE from 'three';

// Pre-allocated scratch: Enemy.update() runs for every enemy every frame,
// so the "direction to player" vector is reused instead of re-allocated.
const _toPlayer = new THREE.Vector3();

/**
 * 3D 1090 Fruits - Enemy Combat System (REMODELED ROSTER)
 *
 *  - Seeker Drones: angular quad-rotor hunters with spinning rotors,
 *    blinking nav lights, gyro eye core, hover bob & player-facing tilt
 *  - Siege Mechs (elite): heavy bipedal walkers with articulated legs,
 *    twin shoulder cannons, glowing core spine, back fins
 *  - Titan Warden (boss): colossal layered-armor titan with arm blades,
 *    pulsing reactor cage, rotating halo ring and eye slits
 *  - Training Dummies: target posts that char/darken as they take damage
 *
 * LEVELING:
 *  - Enemies inherit the arena's WORLD LEVEL (rises as you kill)
 *  - Each enemy level above 1 adds +50% XP reward
 *  - Kills flow: Enemy.die() -> manager.onKill() -> player.gainXp()
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
  constructor(scene, type = 'drone', position = new THREE.Vector3(0, 0, 0), explosionManager = null, level = 1) {
    this.scene = scene;
    this.type = type; // 'dummy' | 'drone' | 'elite' | 'boss'
    this.dead = false;
    this.explosions = explosionManager;
    this.level = level;
    this.manager = null; // set by EnemyManager
    this.animTime = Math.random() * 10;

    // HP Configuration (scales with world level for late-game)
    const levelScale = 1 + (level - 1) * 0.15;
    if (type === 'dummy') {
      this.maxHp = 2500;
    } else if (type === 'drone') {
      this.maxHp = 800 * levelScale;
    } else if (type === 'elite') {
      this.maxHp = 6500 * levelScale;
    } else if (type === 'boss') {
      this.maxHp = 35000 * levelScale;
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
      hacked: false,
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

    // Per-type animation handles
    this.rotors = [];
    this.navLights = [];
    this.eliteLegs = [];
    this.bossRing = null;
    this.dummyBodyMat = null;

    // Create 3D Model
    this.createModel(position);
  }

  createModel(pos) {
    this.mesh = new THREE.Group();
    this.mesh.position.copy(pos);

    const glowTex = softGlowTexture();

    if (this.type === 'dummy') {
      // ===================== TRAINING DUMMY =====================
      const bodyMat = new THREE.MeshStandardMaterial({ color: 0x664411, metalness: 0.35, roughness: 0.6 });
      this.dummyBodyMat = bodyMat;
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 2.2, 16), bodyMat);
      body.position.y = 1.1;
      body.castShadow = true;
      this.mesh.add(body);

      const ringMat = new THREE.MeshBasicMaterial({ color: 0xffcc33, fog: false });
      this.dummyRings = [];
      for (let i = 0; i < 3; i++) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.03, 6, 24), ringMat);
        ring.position.y = 0.5 + i * 0.6;
        ring.rotation.x = Math.PI / 2;
        this.mesh.add(ring);
        this.dummyRings.push(ring);
        this.coreMats.push(ringMat);
      }

      const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, 0.15, 20),
        new THREE.MeshStandardMaterial({ color: 0x223344, metalness: 0.8, roughness: 0.3 }));
      pad.position.y = 0.08;
      this.mesh.add(pad);

    } else if (this.type === 'drone') {
      // ===================== SEEKER DRONE =====================
      this.bodyGroup = new THREE.Group();
      this.mesh.add(this.bodyGroup);

      // Faceted core (octahedron)
      const coreMat = new THREE.MeshStandardMaterial({ color: 0x24354e, metalness: 0.9, roughness: 0.25 });
      const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.62, 0), coreMat);
      core.position.y = 1.6;
      core.scale.set(1, 1.15, 1);
      core.castShadow = true;
      this.bodyGroup.add(core);

      // Glowing eye slit
      this.eyeMat = new THREE.MeshBasicMaterial({ color: 0xff2a55, fog: false });
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.09, 0.1), this.eyeMat);
      eye.position.set(0, 1.66, 0.52);
      this.bodyGroup.add(eye);
      this.coreMats.push(this.eyeMat);

      // 4 diagonal rotor arms
      const armMat = new THREE.MeshStandardMaterial({ color: 0x141e2c, metalness: 0.85, roughness: 0.35 });
      const hubGeo = new THREE.BoxGeometry(0.1, 0.1, 1.0);
      const rotorGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.03, 16);
      const rotorMat = new THREE.MeshStandardMaterial({
        color: 0x0d141f, metalness: 0.7, roughness: 0.5,
      });
      const bladeMat = new THREE.MeshBasicMaterial({
        color: 0x88aacc, transparent: true, opacity: 0.28,
        side: THREE.DoubleSide, depthWrite: false, fog: false,
      });
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const arm = new THREE.Mesh(hubGeo, armMat);
        arm.position.set(Math.cos(a) * 0.85, 1.6, Math.sin(a) * 0.85);
        arm.rotation.y = -a + Math.PI / 2;
        arm.castShadow = true;
        this.bodyGroup.add(arm);

        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.16, 10), armMat);
        hub.position.set(Math.cos(a) * 1.3, 1.68, Math.sin(a) * 1.3);
        this.bodyGroup.add(hub);

        const rotor = new THREE.Mesh(rotorGeo, rotorMat);
        rotor.position.set(Math.cos(a) * 1.3, 1.74, Math.sin(a) * 1.3);
        this.bodyGroup.add(rotor);
        this.rotors.push(rotor);

        // Spinning blade disc (translucent)
        const disc = new THREE.Mesh(new THREE.CircleGeometry(0.44, 20), bladeMat);
        disc.rotation.x = -Math.PI / 2;
        disc.position.set(Math.cos(a) * 1.3, 1.765, Math.sin(a) * 1.3);
        this.bodyGroup.add(disc);
        this.rotors.push(disc);

        // Nav light on every other arm (red blinkers)
        if (i % 2 === 0) {
          const navMat = new THREE.MeshBasicMaterial({ color: 0xff3344, fog: false });
          const nav = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), navMat);
          nav.position.set(Math.cos(a) * 1.3, 1.79, Math.sin(a) * 1.3);
          this.bodyGroup.add(nav);
          this.navLights.push(navMat);
        }
      }

      // Under-glow thruster
      this.droneGlowMat = new THREE.SpriteMaterial({
        map: glowTex, color: 0x00aaff, transparent: true, opacity: 0.5,
        depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      });
      this.droneGlow = new THREE.Sprite(this.droneGlowMat);
      this.droneGlow.scale.set(2.0, 2.0, 1);
      this.droneGlow.position.y = 0.8;
      this.bodyGroup.add(this.droneGlow);

    } else if (this.type === 'elite') {
      // ===================== SIEGE MECH (ELITE) =====================
      this.bodyGroup = new THREE.Group();
      this.mesh.add(this.bodyGroup);

      // Wide heavy hip section
      const hipMat = new THREE.MeshStandardMaterial({ color: 0x2a1522, metalness: 0.85, roughness: 0.35 });
      const hip = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.7, 1.5), hipMat);
      hip.position.y = 1.7;
      hip.castShadow = true;
      this.bodyGroup.add(hip);

      // Torso with sloped chest
      const chassisMat = new THREE.MeshStandardMaterial({ color: 0x3d2030, metalness: 0.9, roughness: 0.3 });
      const torso = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.2, 1.5), chassisMat);
      torso.position.y = 2.7;
      torso.castShadow = true;
      this.bodyGroup.add(torso);
      const chest = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 1.2), hipMat);
      chest.position.set(0, 3.5, 0.1);
      chest.rotation.x = -0.2;
      chest.castShadow = true;
      this.bodyGroup.add(chest);

      // Glowing core spine (vertical stripe)
      this.eliteCoreMat = new THREE.MeshBasicMaterial({ color: 0xff3355, fog: false });
      const spine = new THREE.Mesh(new THREE.BoxGeometry(0.22, 2.6, 0.12), this.eliteCoreMat);
      spine.position.set(0, 2.5, 0.78);
      this.bodyGroup.add(spine);
      this.coreMats.push(this.eliteCoreMat);

      // Head sensor block
      this.eliteEyeMat = new THREE.MeshBasicMaterial({ color: 0xffaa00, fog: false });
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.4, 0.55), chassisMat);
      head.position.set(0, 4.05, 0.25);
      this.bodyGroup.add(head);
      const slit = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.08), this.eliteEyeMat);
      slit.position.set(0, 4.05, 0.55);
      this.bodyGroup.add(slit);
      this.coreMats.push(this.eliteEyeMat);

      // Twin shoulder cannons (long barrels + glow muzzles)
      const gunMat = new THREE.MeshStandardMaterial({ color: 0x0d0d12, metalness: 0.9, roughness: 0.4 });
      const muzzleMat = new THREE.MeshBasicMaterial({ color: 0xff6600, fog: false });
      for (const sx of [-1, 1]) {
        const shoulder = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.7, 0.9), hipMat);
        shoulder.position.set(sx * 1.5, 3.3, 0);
        shoulder.castShadow = true;
        this.bodyGroup.add(shoulder);

        const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 2.2, 10), gunMat);
        gun.rotation.x = Math.PI / 2;
        gun.position.set(sx * 1.45, 3.15, 0.9);
        gun.castShadow = true;
        this.bodyGroup.add(gun);

        const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.16, 10), muzzleMat);
        muzzle.rotation.x = Math.PI / 2;
        muzzle.position.set(sx * 1.45, 3.15, 2.05);
        this.bodyGroup.add(muzzle);
        this.coreMats.push(muzzleMat);
      }

      // Back fins (swept triangles)
      const finMat = new THREE.MeshStandardMaterial({ color: 0x1c2532, metalness: 0.85, roughness: 0.4 });
      for (const sx of [-1, 1]) {
        const fin = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.4, 0.9), finMat);
        fin.position.set(sx * 0.9, 3.4, -0.85);
        fin.rotation.x = 0.35;
        fin.rotation.z = sx * -0.3;
        fin.castShadow = true;
        this.bodyGroup.add(fin);
      }

      // Articulated legs: thigh + knee + shin + foot (2-segment walk)
      const legMat = new THREE.MeshStandardMaterial({ color: 0x1c2532, metalness: 0.85, roughness: 0.4 });
      for (const sx of [-1, 1]) {
        const leg = new THREE.Group();
        leg.position.set(sx * 0.8, 1.7, 0);

        const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.7, 4, 10), legMat);
        thigh.position.y = -0.45;
        thigh.castShadow = true;
        leg.add(thigh);

        const knee = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), hipMat);
        knee.position.set(0, -0.95, 0.1);
        leg.add(knee);

        const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.6, 4, 10), legMat);
        shin.position.set(0, -1.5, 0);
        shin.castShadow = true;
        leg.add(shin);

        const foot = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.22, 0.9), legMat);
        foot.position.set(0, -1.95, 0.12);
        foot.castShadow = true;
        leg.add(foot);
        // Glowing foot strip
        const footGlow = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.2), this.eliteCoreMat);
        footGlow.position.set(0, -1.9, 0.45);
        leg.add(footGlow);

        this.bodyGroup.add(leg);
        this.eliteLegs.push(leg);
      }

    } else if (this.type === 'boss') {
      // ===================== TITAN WARDEN (BOSS) =====================
      this.bodyGroup = new THREE.Group();
      this.mesh.add(this.bodyGroup);

      // Layered colossal hull (3 stacked armor plates)
      const bossMat = new THREE.MeshStandardMaterial({
        color: 0x140d20, emissive: 0x220044, emissiveIntensity: 0.5,
        metalness: 0.85, roughness: 0.3
      });
      const plateMat = new THREE.MeshStandardMaterial({ color: 0x1d1230, metalness: 0.9, roughness: 0.3 });

      const base = new THREE.Mesh(new THREE.BoxGeometry(6.4, 3.0, 4.8), bossMat);
      base.position.y = 3.4;
      base.castShadow = true;
      this.bodyGroup.add(base);

      const mid = new THREE.Mesh(new THREE.BoxGeometry(5.6, 2.6, 4.2), plateMat);
      mid.position.y = 5.9;
      mid.castShadow = true;
      this.bodyGroup.add(mid);

      const top = new THREE.Mesh(new THREE.BoxGeometry(4.4, 2.2, 3.6), bossMat);
      top.position.y = 8.0;
      top.castShadow = true;
      this.bodyGroup.add(top);

      // Angular shoulder wedges
      for (const sx of [-1, 1]) {
        const sh = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.8, 3.6), plateMat);
        sh.position.set(sx * 4.6, 7.6, 0);
        sh.rotation.z = sx * -0.28;
        sh.castShadow = true;
        this.bodyGroup.add(sh);

        // Shoulder edge light
        const shLight = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.12, 0.2), this.bossEdgeMat || (this.bossEdgeMat = new THREE.MeshBasicMaterial({ color: 0xff4488, fog: false })));
        shLight.position.set(sx * 4.6, 9.0, 1.2);
        shLight.rotation.z = sx * -0.28;
        this.bodyGroup.add(shLight);
      }

      // Glowing reactor core + icosahedron cage
      this.bossReactorMat = new THREE.MeshBasicMaterial({ color: 0xff0055, fog: false });
      this.bossReactor = new THREE.Mesh(new THREE.SphereGeometry(1.5, 20, 16), this.bossReactorMat);
      this.bossReactor.position.set(0, 6.2, 2.15);
      this.bodyGroup.add(this.bossReactor);
      this.coreMats.push(this.bossReactorMat);

      const cageMat = new THREE.MeshBasicMaterial({ color: 0xff4488, wireframe: true, transparent: true, opacity: 0.5, fog: false });
      this.bossCage = new THREE.Mesh(new THREE.IcosahedronGeometry(2.1, 0), cageMat);
      this.bossCage.position.copy(this.bossReactor.position);
      this.bodyGroup.add(this.bossCage);

      // Triple eye slits
      this.bossEyeMat = new THREE.MeshBasicMaterial({ color: 0xff0033, fog: false });
      for (const sx of [-1, 0, 1]) {
        const eye = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.3, 0.25), this.bossEyeMat);
        eye.position.set(sx * 1.3, 9.3, 1.85);
        eye.rotation.z = sx * -0.15;
        this.bodyGroup.add(eye);
        this.coreMats.push(this.bossEyeMat);
      }

      // Massive arm blades
      const bladeMat = new THREE.MeshStandardMaterial({ color: 0x1a1030, emissive: 0x330055, emissiveIntensity: 0.6, metalness: 0.95, roughness: 0.2 });
      for (const sx of [-1, 1]) {
        const arm = new THREE.Group();
        arm.position.set(sx * 4.2, 5.5, 0.5);
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.7, 5.0, 1.4), bladeMat);
        blade.position.y = -2.5;
        blade.rotation.z = sx * 0.12;
        blade.castShadow = true;
        arm.add(blade);
        const bladeEdge = new THREE.Mesh(new THREE.BoxGeometry(0.1, 5.0, 1.5), this.bossEdgeMat);
        bladeEdge.position.set(sx * -0.35, -2.5, 0);
        arm.add(bladeEdge);
        this.bodyGroup.add(arm);
      }

      // Rotating halo ring around the titan
      this.bossRingMat = new THREE.MeshBasicMaterial({
        color: 0x9933ff, transparent: true, opacity: 0.55,
        side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      });
      this.bossRing = new THREE.Mesh(new THREE.TorusGeometry(6.5, 0.12, 8, 80), this.bossRingMat);
      this.bossRing.position.y = 5.6;
      this.bossRing.rotation.x = Math.PI / 2.4;
      this.bodyGroup.add(this.bossRing);

      // Hover under-glow
      this.bossGlowMat = new THREE.SpriteMaterial({
        map: glowTex, color: 0xaa00ff, transparent: true, opacity: 0.5,
        depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      });
      this.bossGlow = new THREE.Sprite(this.bossGlowMat);
      this.bossGlow.scale.set(12, 12, 1);
      this.bossGlow.position.y = 0.8;
      this.bodyGroup.add(this.bossGlow);

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
      } else if (this.type === 'drone') {
        m.color.setHex(0xff2a55);
      } else if (this.type === 'elite') {
        m.color.setHex(0xff3355);
      } else {
        m.color.setHex(0xffcc33);
      }
    }
  }

  /** Dummies char and darken as they lose HP. */
  _updateDummyWear() {
    if (!this.dummyBodyMat) return;
    const pct = this.hp / this.maxHp;
    // Blend from fresh wood to burnt dark as HP drops
    this.dummyBodyMat.color.setHex(0x664411).lerp(new THREE.Color(0x1a1008), 1.0 - pct);
  }

  takeDamage(amount, isCrit = false, source = 'other') {
    if (this.dead) return;

    // Stat-based damage bonus by attack source (fruit / sword / gun)
    if (this.manager && source !== 'status' && source !== 'other') {
      amount += this.manager.getDamageBonus(source);
    }

    this.hp -= amount;

    // Spawn floating damage text on UI
    this.spawnFloatingText(Math.round(amount), isCrit ? 'crit' : 'normal');

    if (this.type === 'dummy') this._updateDummyWear();

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
          color: 0xff0044, wireframe: true, transparent: true, opacity: 0.8, fog: false,
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

    // HUD TIDY: cap live floating numbers so big AoEs / swarms don't paint the screen
    const MAX_FLOATING = 90;
    const live = layer.querySelectorAll ? layer.querySelectorAll('.floating-dmg').length : 0;
    if (live >= MAX_FLOATING) return;

    const screenPos = this.mesh.position.clone();
    screenPos.y += (this.type === 'boss' ? 8 : (this.type === 'elite' ? 3.5 : 2.0));
    screenPos.project(window.__activeCamera);

    const x = (screenPos.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-(screenPos.y * 0.5) + 0.5) * window.innerHeight;

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

  /** XP reward: base per type, +50% of base per enemy level above 1. */
  getXpReward() {
    let base = 0;
    if (this.type === 'dummy') base = 40;
    else if (this.type === 'drone') base = 60;
    else if (this.type === 'elite') base = 500;
    else if (this.type === 'boss') base = 6000;
    return Math.floor(base * (1 + 0.5 * (this.level - 1)));
  }

  die() {
    if (this.dead) return;
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

    // Kill reward: XP (scales with enemy level) + floating text
    const xp = this.getXpReward();
    if (this.manager && xp > 0) {
      this.manager.onKill(this);
      this.spawnFloatingText(`+${xp} XP`, 'xp');
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
      if (this.status.imprisoned <= 0) this.showLaserCage(false);
    }
    if (this.status.blinded > 0) this.status.blinded -= dt;

    // Burning DoT
    if (this.status.burned > 0) {
      this.status.burned -= dt;
      this.status.burnTickTimer += dt;
      if (this.status.burnTickTimer >= 0.5) {
        this.status.burnTickTimer = 0;
        this.takeDamage(this.maxHp * 0.035, false, 'status');
        if (this.dead) return;
      }
    }

    // Apply Knockback decay
    if (this.knockback.lengthSq() > 0.01) {
      this.mesh.position.addScaledVector(this.knockback, dt);
      this.knockback.multiplyScalar(Math.max(0, 1.0 - 4.5 * dt));
    }

    // ---- Per-type animation ----
    if (this.type === 'drone' && this.bodyGroup) {
      const frozen = this.status.frozen > 0;
      const bobSpeed = frozen ? 0.4 : 2.4;
      this.bodyGroup.position.y = Math.sin(this.animTime * bobSpeed) * 0.25;

      // Face the player + bank into the turn
      if (!frozen) {
        const toPlayer = _toPlayer.subVectors(player.position, this.mesh.position);
        const targetYaw = Math.atan2(toPlayer.x, toPlayer.z);
        let dy = targetYaw - this.mesh.rotation.y;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        this.mesh.rotation.y += dy * Math.min(1, dt * 4);
        this.bodyGroup.rotation.z = -dy * 0.6; // banking tilt
        this.bodyGroup.rotation.x = dy * 0.3;
      }

      // Rotors spin fast (frozen = crawl)
      const spinSpeed = frozen ? 2 : 40;
      for (let i = 0; i < this.rotors.length; i += 2) {
        this.rotors[i].rotation.y += dt * spinSpeed;
        if (this.rotors[i + 1]) this.rotors[i + 1].rotation.z += dt * spinSpeed * 1.4;
      }

      // Blinking nav lights
      const blink = Math.sin(this.animTime * 6) > 0.4;
      for (const m of this.navLights) {
        m.color.setHex(blink ? 0xff3344 : 0x551111);
      }

      if (this.droneGlowMat) {
        this.droneGlowMat.opacity = frozen ? 0.15 : 0.35 + 0.2 * Math.sin(this.animTime * 6);
      }
    } else if (this.type === 'elite' && this.eliteLegs) {
      // Two-segment walk cycle
      for (let i = 0; i < this.eliteLegs.length; i++) {
        const phase = this.animTime * 3.2 + i * Math.PI;
        this.eliteLegs[i].rotation.x = Math.sin(phase) * 0.32;
      }
      // Idle sway
      this.bodyGroup.position.y = Math.abs(Math.sin(this.animTime * 3.2)) * 0.12;
    } else if (this.type === 'boss' && this.bodyGroup) {
      const pulse = 1 + Math.sin(this.animTime * 2.2) * 0.12;
      if (this.bossReactor) this.bossReactor.scale.setScalar(pulse);
      if (this.bossCage) {
        this.bossCage.rotation.y += dt * 0.8;
        this.bossCage.rotation.x += dt * 0.3;
      }
      if (this.bossRing) {
        this.bossRing.rotation.z += dt * 0.5;
        this.bossRing.rotation.x = Math.PI / 2.4 + Math.sin(this.animTime * 0.6) * 0.15;
      }
      if (this.bossGlowMat) {
        this.bossGlowMat.opacity = 0.4 + 0.15 * Math.sin(this.animTime * 2.2);
      }
      this.bodyGroup.position.y = Math.sin(this.animTime * 0.9) * 0.5 + 0.4;
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
      const dir = _toPlayer.subVectors(player.position, this.mesh.position);
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
          // Hacked targets heal the player instead of damaging!
          player.heal(50);
        } else {
          player.takeDamage(this.type === 'boss' ? 120 : (this.type === 'elite' ? 50 : 20));
        }
      }
    }
  }
}

export class EnemyManager {
  constructor(scene, explosionManager = null, engine = null) {
    this.scene = scene;
    this.enemies = [];
    this.autoRespawn = true;
    this.explosionManager = explosionManager;
    this.engine = engine;

    // World level: rises as you rack up kills -> enemies get tougher
    // and their XP rewards grow (+50% of base per level above 1)
    this.worldLevel = 1;
    this.totalKills = 0;

    // Kill hook -> XP flow
    this.onKill = (enemy) => {
      this.totalKills++;
      if (this.totalKills % 15 === 0) {
        this.worldLevel++;
      }
      if (this.engine && this.engine.player) {
        const gained = this.engine.player.gainXp(enemy.getXpReward());
        if (gained > 0 && this.engine.onPlayerLevelUp) {
          this.engine.onPlayerLevelUp(gained, this.engine.player.level);
        }
      }
    };

    // Spawn initial setup
    this.spawnInitialWave();
  }

  _spawn(type, pos) {
    const e = new Enemy(this.scene, type, pos, this.explosionManager, this.worldLevel);
    e.manager = this;
    this.enemies.push(e);
    return e;
  }

  spawnInitialWave() {
    this.spawnDummy(new THREE.Vector3(0, 0, 18));
    this.spawnDronePack(5, 40);
    this.spawnElite(new THREE.Vector3(-30, 0, -35));
    this.spawnElite(new THREE.Vector3(30, 0, -35));
  }

  spawnDummy(pos = new THREE.Vector3(0, 0, 15)) {
    this._spawn('dummy', pos);
  }

  spawnDronePack(count = 5, spread = 45) {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random();
      const dist = 25 + Math.random() * spread;
      this._spawn('drone', new THREE.Vector3(Math.cos(angle) * dist, 0, Math.sin(angle) * dist));
    }
  }

  spawnElite(pos = new THREE.Vector3(-25, 0, 30)) {
    this._spawn('elite', pos);
  }

  spawnBoss(pos = new THREE.Vector3(0, 0, 75)) {
    this._spawn('boss', pos);
  }

  /** Flat damage bonus for the given attack source (from player stats). */
  getDamageBonus(source) {
    if (!this.engine || !this.engine.player) return 0;
    const p = this.engine.player;
    if (source === 'fruit') return p.fruitDamageBonus || 0;
    if (source === 'sword') return p.swordDamageBonus || 0;
    if (source === 'gun') return p.gunDamageBonus || 0;
    return 0;
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
   * Find enemy with highest current HP (for Alarm Fruit skill 2)
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
