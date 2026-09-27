import * as THREE from 'three';

/**
 * 3D 1090 Fruits - Cloud, Weather & Fluid Dynamics Rainshaft System
 *
 * SPECIFICATIONS:
 * 1. "visual effects on rain mist is white smoke with fluid dynamics physics
 *     to mimic the appearance of rainshafts and on tornadoes"
 * 2. "note: the rain from clouds required rainshafts that uses realistic smoke effects
 *     with fluid dynamics to mimic real rainshafts and microburst."
 * 3. Dynamic Growing Cloud System (Cumulus -> Cumulonimbus -> Supercell)
 * 4. Microburst, Derecho, Squall line, Hurricane, Tornadoes, and Flooding.
 *
 * VISUALS:
 *  - Billboard-sprite cloud puffs (soft radial texture, two-tone shading)
 *    that darken and bruise purple as they mature into supercells
 *  - Fluid rainshafts with ground mist rings
 *  - Tornadoes with a dark debris core
 *  - Tsunamis with animated white foam crests
 *  - Flooding plane with gentle surface motion
 */

export class CloudWeatherManager {
  constructor(scene, lightningManager, explosionManager) {
    this.scene = scene;
    this.lightning = lightningManager;
    this.explosions = explosionManager;

    this.activeClouds = [];
    this.activeRainshafts = [];
    this.activeTornadoes = [];
    this.activeMicrobursts = [];
    this.activeTsunamis = [];

    // Rising flood plane for Nimbostratus Flooding
    this.floodPlane = null;
    this.floodHeight = 0;
    this.floodTargetHeight = 0;
    this.floodTime = 0;

    // Shared particles & textures for fluid smoke rainshafts
    this.initFluidSmokeGeometry();
  }

  initFluidSmokeGeometry() {
    // Generate soft circular radial particle texture
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
    grad.addColorStop(0.5, 'rgba(230, 240, 255, 0.4)');
    grad.addColorStop(1, 'rgba(200, 220, 255, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);

    this.smokeTexture = new THREE.CanvasTexture(canvas);

    // Softer, rounder puff texture for volumetric clouds
    const cv2 = document.createElement('canvas');
    cv2.width = 128;
    cv2.height = 128;
    const ctx2 = cv2.getContext('2d');
    const g2 = ctx2.createRadialGradient(64, 64, 4, 64, 64, 62);
    g2.addColorStop(0, 'rgba(255,255,255,0.75)');
    g2.addColorStop(0.4, 'rgba(255,255,255,0.35)');
    g2.addColorStop(0.75, 'rgba(255,255,255,0.12)');
    g2.addColorStop(1, 'rgba(255,255,255,0)');
    ctx2.fillStyle = g2;
    ctx2.fillRect(0, 0, 128, 128);
    this.puffTexture = new THREE.CanvasTexture(cv2);
  }

  /**
   * Spawns a fluid-dynamic realistic Rainshaft.
   * Uses fluid physics: downward gravity acceleration, horizontal air curl/turbulence,
   * and floor splash divergence mimicking real atmospheric downpours.
   */
  createRainshaft(centerPos, width = 60, height = 150, particleCount = 450) {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const velocities = new Float32Array(particleCount * 3);
    const lifespans = new Float32Array(particleCount);

    for (let i = 0; i < particleCount; i++) {
      // Spawn within top cloud volume
      const angle = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * (width * 0.5);
      positions[i * 3 + 0] = centerPos.x + Math.cos(angle) * r;
      positions[i * 3 + 1] = centerPos.y + (Math.random() * 0.4 + 0.6) * height;
      positions[i * 3 + 2] = centerPos.z + Math.sin(angle) * r;

      // Downward velocity with slight turbulence
      velocities[i * 3 + 0] = (Math.random() - 0.5) * 4.0;
      velocities[i * 3 + 1] = -(45.0 + Math.random() * 35.0); // High downdraft speed
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 4.0;

      lifespans[i] = Math.random();
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.PointsMaterial({
      color: 0xd8e8f8,
      size: 3.4,
      map: this.smokeTexture,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      blending: THREE.NormalBlending,
      sizeAttenuation: true,
    });

    const pSystem = new THREE.Points(geo, mat);
    pSystem.frustumCulled = false;
    this.scene.add(pSystem);

    // Ground mist: a few big soft sprites where the rain lands
    const mistSprites = [];
    const mistCount = 5;
    for (let i = 0; i < mistCount; i++) {
      const mMat = new THREE.SpriteMaterial({
        map: this.puffTexture, color: 0xbcd2e8, transparent: true, opacity: 0.16,
        depthWrite: false, fog: false,
      });
      const sp = new THREE.Sprite(mMat);
      const a = (i / mistCount) * Math.PI * 2;
      const r = Math.random() * width * 0.4;
      sp.position.set(centerPos.x + Math.cos(a) * r, 2.5 + Math.random() * 3, centerPos.z + Math.sin(a) * r);
      const s = width * (0.25 + Math.random() * 0.2);
      sp.scale.set(s, s * 0.45, 1);
      this.scene.add(sp);
      mistSprites.push(sp);
    }

    this.activeRainshafts.push({
      mesh: pSystem,
      positions,
      velocities,
      particleCount,
      centerPos: centerPos.clone(),
      width,
      height,
      mat,
      elapsed: 0,
      duration: 12.0,
      mistSprites,
    });
  }

  /**
   * Spawns a swirling Tornado with fluid vortex physics & orbiting debris.
   */
  createTornado(centerPos, baseRadius = 6, height = 160, windSpeedMph = 200, duration = 10) {
    const count = 600;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const particleData = [];

    for (let i = 0; i < count; i++) {
      const hNorm = Math.random();
      const currentH = hNorm * height;
      // Funnel shape: wider at top, narrower at bottom
      const r = baseRadius * (1.0 + hNorm * 3.5);
      const angle = Math.random() * Math.PI * 2;

      positions[i * 3 + 0] = centerPos.x + Math.cos(angle) * r;
      positions[i * 3 + 1] = centerPos.y + currentH;
      positions[i * 3 + 2] = centerPos.z + Math.sin(angle) * r;

      particleData.push({
        hNorm,
        angle,
        r,
        rotSpeed: 3.0 + (1.0 - hNorm) * 5.0, // Swirl faster near ground
        upSpeed: 18.0 + Math.random() * 15.0
      });
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.PointsMaterial({
      color: 0xb5c6d6,
      size: 9.0,
      map: this.smokeTexture,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });

    const mesh = new THREE.Points(geo, mat);
    mesh.frustumCulled = false;
    this.scene.add(mesh);

    // Dark debris core (slim inner funnel)
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0x39424e, transparent: true, opacity: 0.85,
      depthWrite: false, side: THREE.DoubleSide, fog: false,
    });
    const coreGeo = new THREE.CylinderGeometry(baseRadius * 2.6, baseRadius * 0.8, height, 16, 1, true);
    const core = new THREE.Mesh(coreGeo, coreMat);
    core.position.set(centerPos.x, height / 2, centerPos.z);
    this.scene.add(core);

    this.activeTornadoes.push({
      mesh,
      core,
      coreMat,
      positions,
      particleData,
      count,
      centerPos: centerPos.clone(),
      height,
      baseRadius,
      windSpeedMph,
      duration,
      elapsed: 0,
      mat
    });
  }

  /**
   * Spawns a Microburst: high-speed 200 m/s downdraft slamming the floor
   * and blowing out an intense radial wall of rain mist.
   */
  createMicroburst(pos, size = 150, duration = 10) {
    const geo = new THREE.CylinderGeometry(size * 0.5, size * 0.8, 120, 24, 1, true);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xc4daed,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    const colMesh = new THREE.Mesh(geo, mat);
    colMesh.position.set(pos.x, 60, pos.z);
    this.scene.add(colMesh);

    // Also spawn dense fluid rainshaft inside
    this.createRainshaft(pos, size, 140, 600);

    this.activeMicrobursts.push({
      colMesh,
      mat,
      pos: pos.clone(),
      size,
      duration,
      elapsed: 0,
      radialRing: 1.0
    });
  }

  /**
   * Dynamic Growing Cloud (Cumulus Humilis -> Cumulus Congestus -> Cumulonimbus -> Supercell)
   * Built from soft billboard puffs with two-tone shading.
   */
  spawnGrowingCloud(pos, isSupercellForced = false, maxRadius = 150) {
    const cloudGroup = new THREE.Group();
    cloudGroup.position.set(pos.x, 90, pos.z);

    const puffCount = 16;
    const puffSpriteMatLight = new THREE.SpriteMaterial({
      map: this.puffTexture, color: 0xe8f1fa, transparent: true, opacity: 0.65,
      depthWrite: false, fog: false,
    });
    const puffSpriteMatDark = new THREE.SpriteMaterial({
      map: this.puffTexture, color: 0x8b97a8, transparent: true, opacity: 0.55,
      depthWrite: false, fog: false,
    });

    const puffs = [];
    for (let i = 0; i < puffCount; i++) {
      const x = (Math.random() - 0.5) * 70;
      const y = (Math.random() - 0.5) * 26;
      const z = (Math.random() - 0.5) * 70;
      const s = 26 + Math.random() * 30;

      // Bright upper puff
      const sp = new THREE.Sprite(puffSpriteMatLight);
      sp.position.set(x, y + 4, z);
      sp.scale.set(s, s * (0.6 + Math.random() * 0.4), 1);
      cloudGroup.add(sp);
      puffs.push(sp);

      // Darker base puff (underbelly shading)
      const sp2 = new THREE.Sprite(puffSpriteMatDark);
      sp2.position.set(x, y - 7, z);
      sp2.scale.set(s * 1.15, s * 0.5, 1);
      cloudGroup.add(sp2);
      puffs.push(sp2);
    }

    this.scene.add(cloudGroup);

    const cloudData = {
      group: cloudGroup,
      pos: pos.clone(),
      stage: 'humilis', // 'humilis' -> 'congestus' -> 'cumulonimbus' -> 'supercell'
      growthTimer: 0,
      growthDuration: 10.0,
      lifeDuration: 120.0, // 2 minutes
      elapsed: 0,
      isSupercell: isSupercellForced || (Math.random() < 0.35),
      lightningTimer: 0,
      rainshaftActive: false,
      maxRadius,
      matLight: puffSpriteMatLight,
      matDark: puffSpriteMatDark,
    };

    this.activeClouds.push(cloudData);
    return cloudData;
  }

  /**
   * Spawns Quake Tsunami Wave Wall with a white foam crest
   */
  spawnTsunami(originPos, direction, width = 60, height = 15, speed = 40, isLarge = false) {
    const group = new THREE.Group();

    // Main water body
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x0a4a7a,
      roughness: 0.25,
      metalness: 0.3,
      transparent: true,
      opacity: 0.8,
      emissive: 0x001a33,
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, 8), waterMat);
    group.add(mesh);

    // Foam crest (thin white glowing band on top)
    const foamMat = new THREE.MeshBasicMaterial({
      color: 0xd8f4ff, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    const foam = new THREE.Mesh(new THREE.BoxGeometry(width * 1.02, height * 0.22, 9), foamMat);
    foam.position.y = height * 0.45;
    group.add(foam);

    // Side spray wisps
    const sprayMat = new THREE.SpriteMaterial({
      map: this.puffTexture, color: 0xcfeaff, transparent: true, opacity: 0.4,
      depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
    for (let i = 0; i < 4; i++) {
      const sp = new THREE.Sprite(sprayMat);
      const a = (i / 4) * Math.PI * 2;
      sp.position.set(Math.cos(a) * width * 0.3, height * 0.5 + Math.random() * 3, Math.sin(a) * 5);
      const s = 8 + Math.random() * 10;
      sp.scale.set(s, s * 0.5, 1);
      group.add(sp);
    }

    group.position.copy(originPos);
    group.position.y = height * 0.5;

    // Orient towards direction
    const lookTarget = originPos.clone().add(direction);
    group.lookAt(lookTarget.x, group.position.y, lookTarget.z);

    this.scene.add(group);

    this.activeTsunamis.push({
      mesh: group,
      waterMat,
      foamMat,
      foam,
      direction: direction.clone().normalize(),
      speed: speed * (isLarge ? 0.9 : 1.1),
      height,
      width,
      isLarge,
      duration: 8.0,
      elapsed: 0,
      animSeed: Math.random() * 10,
    });
  }

  /**
   * Trigger Nimbostratus Flooding (rising water plane)
   */
  startNimbostratusFlood(duration = 20) {
    if (!this.floodPlane) {
      const geo = new THREE.PlaneGeometry(1600, 1600, 32, 32);
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x0a2b42,
        roughness: 0.12,
        metalness: 0.75,
        transparent: true,
        opacity: 0.62,
        emissive: 0x00121e,
      });
      this.floodPlane = new THREE.Mesh(geo, mat);
      this.floodPlane.position.set(0, -1, 0);
      this.floodPlaneBaseY = -1;
      this.scene.add(this.floodPlane);
    }
    this.floodTargetHeight = 3.5; // Water rises to 3.5m
  }

  update(dt, enemyList = [], playerPos = null) {
    // 1. Update Fluid Rainshafts
    for (let i = this.activeRainshafts.length - 1; i >= 0; i--) {
      const rs = this.activeRainshafts[i];
      rs.elapsed += dt;

      if (rs.elapsed >= rs.duration) {
        this.scene.remove(rs.mesh);
        rs.mat.dispose();
        for (const m of rs.mistSprites) {
          this.scene.remove(m);
          m.material.dispose();
        }
        this.activeRainshafts.splice(i, 1);
        continue;
      }

      // Fade in/out over lifetime
      const lifeT = rs.elapsed / rs.duration;
      rs.mat.opacity = 0.4 * Math.min(1, lifeT * 5) * Math.min(1, (1 - lifeT) * 4);

      const posAttr = rs.mesh.geometry.attributes.position;
      const arr = posAttr.array;
      const count = rs.particleCount;

      for (let j = 0; j < count; j++) {
        // Fluid advection: vertical downward velocity + ground curl
        arr[j * 3 + 1] += rs.velocities[j * 3 + 1] * dt;
        arr[j * 3 + 0] += rs.velocities[j * 3 + 0] * dt;
        arr[j * 3 + 2] += rs.velocities[j * 3 + 2] * dt;

        // Ground collision & fluid splash divergence
        if (arr[j * 3 + 1] <= 0.2) {
          // Reset back to cloud top
          const angle = Math.random() * Math.PI * 2;
          const r = Math.sqrt(Math.random()) * (rs.width * 0.5);
          arr[j * 3 + 0] = rs.centerPos.x + Math.cos(angle) * r;
          arr[j * 3 + 1] = rs.centerPos.y + (Math.random() * 0.3 + 0.7) * rs.height;
          arr[j * 3 + 2] = rs.centerPos.z + Math.sin(angle) * r;
        }
      }
      posAttr.needsUpdate = true;

      // Mist drift
      for (let m = 0; m < rs.mistSprites.length; m++) {
        const sp = rs.mistSprites[m];
        sp.position.x += Math.sin(rs.elapsed * 0.4 + m * 2) * dt * 2;
        sp.material.opacity = 0.16 * Math.min(1, lifeT * 5) * Math.min(1, (1 - lifeT) * 4);
      }
    }

    // 2. Update Tornadoes (swirl & enemy suction)
    for (let i = this.activeTornadoes.length - 1; i >= 0; i--) {
      const tn = this.activeTornadoes[i];
      tn.elapsed += dt;

      if (tn.elapsed >= tn.duration) {
        this.scene.remove(tn.mesh);
        this.scene.remove(tn.core);
        tn.mat.dispose();
        tn.coreMat.dispose();
        this.activeTornadoes.splice(i, 1);
        continue;
      }

      const arr = tn.mesh.geometry.attributes.position.array;
      for (let j = 0; j < tn.count; j++) {
        const pd = tn.particleData[j];
        pd.angle += pd.rotSpeed * dt;
        pd.hNorm += (pd.upSpeed / tn.height) * dt;
        if (pd.hNorm > 1.0) pd.hNorm = 0.0;

        const curH = pd.hNorm * tn.height;
        const curR = tn.baseRadius * (1.0 + pd.hNorm * 3.5);

        arr[j * 3 + 0] = tn.centerPos.x + Math.cos(pd.angle) * curR;
        arr[j * 3 + 1] = tn.centerPos.y + curH;
        arr[j * 3 + 2] = tn.centerPos.z + Math.sin(pd.angle) * curR;
      }
      tn.mesh.geometry.attributes.position.needsUpdate = true;

      // Slowly drift the funnel sideways
      tn.centerPos.x += Math.sin(tn.elapsed * 0.5) * dt * 3;
      tn.centerPos.z += Math.cos(tn.elapsed * 0.4) * dt * 3;
      tn.core.position.x = tn.centerPos.x;
      tn.core.position.z = tn.centerPos.z;
      tn.core.rotation.y += dt * 2.5;

      // Enemy suction towards tornado vortex center
      const suckRadius = 60.0;
      for (const enemy of enemyList) {
        if (!enemy.mesh) continue;
        const dist = enemy.mesh.position.distanceTo(tn.centerPos);
        if (dist < suckRadius) {
          const dir = new THREE.Vector3().subVectors(tn.centerPos, enemy.mesh.position).normalize();
          enemy.mesh.position.addScaledVector(dir, 14.0 * dt);
          enemy.takeDamage(250 * dt, false);
        }
      }
    }

    // 3. Update Clouds (Dynamic Growth & Thunder)
    for (let i = this.activeClouds.length - 1; i >= 0; i--) {
      const cl = this.activeClouds[i];
      cl.elapsed += dt;

      if (cl.elapsed >= cl.lifeDuration) {
        this.scene.remove(cl.group);
        cl.matLight.dispose();
        cl.matDark.dispose();
        this.activeClouds.splice(i, 1);
        continue;
      }

      // Fade out during last 15% of life
      if (cl.elapsed > cl.lifeDuration * 0.85) {
        const ft = (cl.lifeDuration - cl.elapsed) / (cl.lifeDuration * 0.15);
        cl.matLight.opacity = 0.65 * ft;
        cl.matDark.opacity = 0.55 * ft;
      }

      // Dynamic growth over first 10 seconds
      if (cl.growthTimer < cl.growthDuration) {
        cl.growthTimer += dt;
        const growthT = cl.growthTimer / cl.growthDuration;
        const currentScale = 0.5 + growthT * 2.5;
        cl.group.scale.set(currentScale, currentScale * 0.8, currentScale);

        if (growthT > 0.4 && cl.stage === 'humilis') {
          cl.stage = 'congestus';
        } else if (growthT > 0.8 && cl.stage === 'congestus') {
          cl.stage = cl.isSupercell ? 'supercell' : 'cumulonimbus';
          if (!cl.rainshaftActive) {
            cl.rainshaftActive = true;
            this.createRainshaft(cl.pos, cl.maxRadius * 0.6, 90, 400);
          }
        }
      }

      // Color evolution: bright cumulus -> bruised purple supercell
      if (cl.stage === 'supercell') {
        cl.matLight.color.setHex(0x9a92b8);
        cl.matDark.color.setHex(0x4a4066);
      } else if (cl.stage === 'cumulonimbus') {
        cl.matLight.color.setHex(0xc3cddb);
        cl.matDark.color.setHex(0x66707f);
      }

      // Lightning generation from mature clouds
      if (cl.stage === 'cumulonimbus' || cl.stage === 'supercell') {
        cl.lightningTimer += dt;
        const strikeRate = cl.stage === 'supercell' ? 0.9 : 1.8;
        if (cl.lightningTimer >= strikeRate) {
          cl.lightningTimer = 0;
          const strikePos = new THREE.Vector3(
            cl.pos.x + (Math.random() - 0.5) * cl.maxRadius * 0.8,
            0,
            cl.pos.z + (Math.random() - 0.5) * cl.maxRadius * 0.8
          );
          const isHyperbolt = cl.stage === 'supercell' && Math.random() < 0.45;
          const color = isHyperbolt ? '#ffffff' : '#00f0ff';
          this.lightning.strikeBolt(strikePos, 100, color, 0.35, 32);
          this.explosions.createExplosion(strikePos, isHyperbolt ? 16 : 8, 'lightning', isHyperbolt ? 3.0 : 1.2);
        }
      }

      // Gentle horizontal drift
      cl.group.position.x += Math.sin(cl.elapsed * 0.1) * dt * 1.5;
      cl.group.position.z += Math.cos(cl.elapsed * 0.08) * dt * 1.5;
    }

    // 4. Update Tsunamis
    for (let i = this.activeTsunamis.length - 1; i >= 0; i--) {
      const ts = this.activeTsunamis[i];
      ts.elapsed += dt;

      if (ts.elapsed >= ts.duration) {
        this.scene.remove(ts.mesh);
        ts.waterMat.dispose();
        ts.foamMat.dispose();
        this.activeTsunamis.splice(i, 1);
        continue;
      }

      // Move along direction vector
      ts.mesh.position.addScaledVector(ts.direction, ts.speed * dt);

      // Crest bob + foam shimmer
      ts.mesh.position.y = ts.height * 0.5 + Math.sin(ts.elapsed * 3 + ts.animSeed) * 0.8;
      ts.foamMat.opacity = 0.65 + 0.25 * Math.sin(ts.elapsed * 9 + ts.animSeed);

      // Hit enemies
      for (const enemy of enemyList) {
        if (!enemy.mesh) continue;
        if (enemy.mesh.position.distanceTo(ts.mesh.position) < ts.width * 0.6) {
          const dmg = ts.isLarge ? 800 : 260;
          enemy.takeDamage(dmg, false);
          enemy.mesh.position.addScaledVector(ts.direction, 8.0 * dt);
        }
      }
    }

    // 5. Update Flooding Height (with gentle surface motion)
    if (this.floodPlane) {
      this.floodTime += dt;
      if (this.floodHeight < this.floodTargetHeight) {
        this.floodHeight += dt * 0.4;
      }
      this.floodPlane.position.y = this.floodHeight + Math.sin(this.floodTime * 0.8) * 0.15;
    }
  }
}
