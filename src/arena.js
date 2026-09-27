import * as THREE from 'three';

/**
 * 3D 1090 Fruits - Combat Arena & Environment
 *
 * A cinematic 1000m sci-fi battleground:
 *  - Procedural gradient sky dome with hash star-field + a distant moon
 *  - Neon metric floor grid (canvas-generated, emissive) with distance rings
 *  - 12 perimeter energy pylons with volumetric light beams & pulsing beacons
 *  - Central holographic energy core
 *  - Distant megastructure silhouettes for depth
 *  - Drifting atmosphere dust
 *  - Calibrated metric distance rings (10m, 25m, 50m, 100m, 200m, 300m)
 */

// ---------------------------------------------------------------------------
// Procedural sky shader (gradient + procedural stars + moon glow)
// ---------------------------------------------------------------------------
const SKY_VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const SKY_FRAG = /* glsl */`
  uniform float uTime;
  varying vec3 vDir;

  // Cheap deterministic hash
  float hash13(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = clamp(d.y, -0.08, 1.0);

    // Vertical gradient: deep space zenith -> cold storm horizon
    vec3 zenith  = vec3(0.004, 0.008, 0.020);
    vec3 mid     = vec3(0.020, 0.045, 0.085);
    vec3 horizon = vec3(0.055, 0.105, 0.160);
    vec3 sky = mix(horizon, mid, smoothstep(0.0, 0.22, h));
    sky = mix(sky, zenith, smoothstep(0.18, 0.75, h));

    // Faint storm-band aurora near the horizon
    float band = smoothstep(0.02, 0.10, h) * (1.0 - smoothstep(0.10, 0.30, h));
    float wave = sin(d.x * 9.0 + uTime * 0.06) * 0.5 + sin(d.z * 7.0 - uTime * 0.045) * 0.5;
    sky += vec3(0.010, 0.05, 0.075) * band * (0.45 + 0.35 * wave);

    // Procedural star field (only above horizon)
    if (h > 0.03) {
      vec3 cell = floor(d * 220.0);
      float s = hash13(cell);
      float star = smoothstep(0.9965, 1.0, s);
      // Twinkle
      float tw = 0.6 + 0.4 * sin(uTime * (1.5 + s * 3.0) + s * 40.0);
      sky += vec3(0.9, 0.95, 1.0) * star * tw * smoothstep(0.03, 0.18, h) * 0.85;
    }

    // Moon: fixed bright disc + halo
    vec3 moonDir = normalize(vec3(0.42, 0.30, -0.85));
    float md = dot(d, moonDir);
    float disc = smoothstep(0.99935, 0.99975, md);
    float halo = pow(clamp(md, 0.0, 1.0), 180.0) * 0.35;
    vec3 moonCol = vec3(0.85, 0.92, 1.05);
    sky += moonCol * (disc * 1.6 + halo);

    gl_FragColor = vec4(sky, 1.0);
  }
`;

// ---------------------------------------------------------------------------
// Canvas-generated neon floor texture (map + emissiveMap)
// ---------------------------------------------------------------------------
function makeFloorTexture(size = 2048) {
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext('2d');
  const half = size / 2;

  // Base dark obsidian with subtle noise
  ctx.fillStyle = '#05080f';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 9000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const a = Math.random() * 0.05;
    ctx.fillStyle = `rgba(90, 140, 190, ${a})`;
    ctx.fillRect(x, y, 1.5, 1.5);
  }

  // World: texture spans 1240m across the canvas => meters per pixel
  const worldSize = 1240;
  const mpp = worldSize / size;

  const px = (m) => m / mpp;

  // Fine grid every 10m
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0, 170, 220, 0.10)';
  const step = px(10);
  for (let g = half % step; g < size; g += step) {
    ctx.beginPath(); ctx.moveTo(g, 0); ctx.lineTo(g, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, g); ctx.lineTo(size, g); ctx.stroke();
  }

  // Major grid every 50m
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(0, 210, 255, 0.22)';
  const stepM = px(50);
  for (let g = half % stepM; g < size; g += stepM) {
    ctx.beginPath(); ctx.moveTo(g, 0); ctx.lineTo(g, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, g); ctx.lineTo(size, g); ctx.stroke();
  }

  // Radial spokes every 15 degrees
  ctx.strokeStyle = 'rgba(0, 190, 240, 0.13)';
  ctx.lineWidth = 1;
  for (let a = 0; a < 24; a++) {
    const ang = (a / 24) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(half, half);
    ctx.lineTo(half + Math.cos(ang) * half * 1.42, half + Math.sin(ang) * half * 1.42);
    ctx.stroke();
  }

  // Concentric metric rings (brighter than the square grid)
  const ringSpecs = [
    [10, 'rgba(0, 240, 255, 0.50)', 2],
    [25, 'rgba(0, 255, 136, 0.42)', 2],
    [50, 'rgba(255, 170, 0, 0.40)', 2.5],
    [100, 'rgba(176, 38, 255, 0.45)', 3],
    [200, 'rgba(0, 208, 255, 0.40)', 3],
    [300, 'rgba(255, 42, 85, 0.42)', 3.5],
    [450, 'rgba(0, 120, 180, 0.25)', 2],
    [610, 'rgba(0, 90, 140, 0.20)', 2],
  ];
  for (const [r, color, w] of ringSpecs) {
    ctx.beginPath();
    ctx.arc(half, half, px(r), 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.stroke();
  }

  // Central emblem: double ring + tick marks
  ctx.strokeStyle = 'rgba(0, 240, 255, 0.65)';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(half, half, px(6), 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(half, half, px(4), 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = 'rgba(0, 240, 255, 0.5)';
  for (let t = 0; t < 60; t++) {
    const ang = (t / 60) * Math.PI * 2;
    const r1 = px(4.4), r2 = t % 5 === 0 ? px(5.6) : px(5.0);
    ctx.beginPath();
    ctx.moveTo(half + Math.cos(ang) * r1, half + Math.sin(ang) * r1);
    ctx.lineTo(half + Math.cos(ang) * r2, half + Math.sin(ang) * r2);
    ctx.stroke();
  }

  // Fade the outer region into void so the arena edge dissolves into fog
  const fade = ctx.createRadialGradient(half, half, px(430), half, half, half * 1.45);
  fade.addColorStop(0, 'rgba(3, 5, 10, 0)');
  fade.addColorStop(1, 'rgba(3, 5, 10, 1)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export class Arena {
  constructor(scene) {
    this.scene = scene;
    this.clockT = 0;

    this.createSky();
    this.createFloor();
    this.createRings();
    this.createPylons();
    this.createCenterCore();
    this.createDistantTowers();
    this.createDust();
    this.createLights();
  }

  createSky() {
    const geo = new THREE.SphereGeometry(1050, 32, 24);
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: { uTime: { value: 0 } },
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(geo, this.skyMat);
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);
  }

  createFloor() {
    // Polished obsidian platform with glowing neon grid
    const tex = makeFloorTexture(2048);

    const geo = new THREE.CircleGeometry(640, 96);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      emissiveMap: tex,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0.5,
      color: 0x0a0f18,
      roughness: 0.42,
      metalness: 0.55,
    });
    this.floor = new THREE.Mesh(geo, mat);
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);

    // Deep void ground far below the edges (so long view distances never see a cliff)
    const voidGeo = new THREE.CircleGeometry(1050, 48);
    voidGeo.rotateX(-Math.PI / 2);
    const voidMat = new THREE.MeshStandardMaterial({ color: 0x04070d, roughness: 1.0, metalness: 0.0 });
    this.voidGround = new THREE.Mesh(voidGeo, voidMat);
    this.voidGround.position.y = -1.5;
    this.voidGround.receiveShadow = true;
    this.scene.add(this.voidGround);
  }

  createRings() {
    // 3D glowing metric range rings floating just above the floor
    const ringRanges = [10, 25, 50, 100, 200, 300];
    const ringColors = [0x00f0ff, 0x00ff88, 0xffaa00, 0xb026ff, 0x00d0ff, 0xff2a55];
    this.rings = [];

    ringRanges.forEach((radius, idx) => {
      const ringGeo = new THREE.TorusGeometry(radius, 0.18, 8, 160);
      ringGeo.rotateX(Math.PI / 2);
      const ringMat = new THREE.MeshBasicMaterial({
        color: ringColors[idx % ringColors.length],
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      ringMesh.position.y = 0.25;
      this.scene.add(ringMesh);
      this.rings.push({ mesh: ringMesh, mat: ringMat, baseOpacity: 0.4, phase: idx * 1.1 });
    });
  }

  createPylons() {
    this.pylonBeacons = [];
    this.pylonBeams = [];

    const pylonCount = 12;
    const pylonRadius = 380;

    const bodyGeo = new THREE.CylinderGeometry(5, 9, 78, 6);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x0d1727, roughness: 0.35, metalness: 0.85 });
    const capGeo = new THREE.CylinderGeometry(7.5, 5, 4, 6);
    const stripGeo = new THREE.BoxGeometry(0.7, 60, 0.7);
    const stripMat = new THREE.MeshStandardMaterial({
      color: 0x062030, emissive: 0x00c8ff, emissiveIntensity: 1.6, roughness: 0.4, metalness: 0.6
    });
    const beaconGeo = new THREE.SphereGeometry(3.2, 16, 16);
    const beamGeo = new THREE.CylinderGeometry(2.2, 3.4, 220, 12, 1, true);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0x00d8ff, transparent: true, opacity: 0.07, side: THREE.DoubleSide,
      depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });

    for (let i = 0; i < pylonCount; i++) {
      const angle = (i / pylonCount) * Math.PI * 2;
      const x = Math.cos(angle) * pylonRadius;
      const z = Math.sin(angle) * pylonRadius;

      const group = new THREE.Group();
      group.position.set(x, 0, z);
      group.lookAt(0, 0, 0);

      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.position.y = 39;
      body.castShadow = true;
      body.receiveShadow = true;
      group.add(body);

      const cap = new THREE.Mesh(capGeo, bodyMat);
      cap.position.y = 79;
      group.add(cap);

      // Three glowing vertical strips around the hexagon
      for (let s = 0; s < 3; s++) {
        const sa = (s / 3) * Math.PI * 2 + Math.PI / 6;
        const strip = new THREE.Mesh(stripGeo, stripMat);
        strip.position.set(Math.cos(sa) * 5.6, 38, Math.sin(sa) * 5.6);
        group.add(strip);
      }

      const beaconMat = new THREE.MeshBasicMaterial({ color: 0x9ff4ff });
      const beacon = new THREE.Mesh(beaconGeo, beaconMat);
      beacon.position.y = 84;
      group.add(beacon);
      this.pylonBeacons.push({ mesh: beacon, mat: beaconMat, phase: i * 0.7 });

      const beam = new THREE.Mesh(beamGeo, beamMat.clone());
      beam.position.y = 78 + 110;
      group.add(beam);
      this.pylonBeams.push({ mesh: beam, mat: beam.material, phase: i * 1.3 });

      this.scene.add(group);
    }
  }

  createCenterCore() {
    this.coreGroup = new THREE.Group();
    this.coreGroup.position.set(0, 10, 0);

    // Inner glowing heart
    const heartMat = new THREE.MeshBasicMaterial({ color: 0x9ff4ff, fog: false });
    this.coreHeart = new THREE.Mesh(new THREE.IcosahedronGeometry(2.2, 1), heartMat);
    this.coreGroup.add(this.coreHeart);

    // Wireframe cage
    const cageMat = new THREE.MeshBasicMaterial({
      color: 0x00d8ff, wireframe: true, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    this.coreCage = new THREE.Mesh(new THREE.IcosahedronGeometry(4.2, 1), cageMat);
    this.coreGroup.add(this.coreCage);

    // Orbiting rings
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
    });
    this.coreRing1 = new THREE.Mesh(new THREE.TorusGeometry(6.5, 0.12, 8, 64), ringMat);
    this.coreRing1.rotation.x = Math.PI / 2.2;
    this.coreGroup.add(this.coreRing1);

    const ringMat2 = ringMat.clone();
    ringMat2.color.setHex(0xb026ff);
    this.coreRing2 = new THREE.Mesh(new THREE.TorusGeometry(8.0, 0.1, 8, 64), ringMat2);
    this.coreRing2.rotation.x = Math.PI / 3;
    this.coreRing2.rotation.y = Math.PI / 4;
    this.coreGroup.add(this.coreRing2);

    this.scene.add(this.coreGroup);
  }

  createDistantTowers() {
    // Megastructure silhouettes for parallax depth
    const matDark = new THREE.MeshStandardMaterial({ color: 0x0a121e, roughness: 0.9, metalness: 0.3 });
    const matEdge = new THREE.MeshBasicMaterial({ color: 0x1c4a66, transparent: true, opacity: 0.35, fog: false });

    const towers = new THREE.Group();
    let seed = 12345;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

    for (let i = 0; i < 46; i++) {
      const angle = (i / 46) * Math.PI * 2 + rnd() * 0.4;
      const dist = 470 + rnd() * 220;
      const w = 14 + rnd() * 40;
      const h = 30 + rnd() * 150;
      const d = 14 + rnd() * 40;

      const geo = new THREE.BoxGeometry(w, h, d);
      const t = new THREE.Mesh(geo, matDark);
      t.position.set(Math.cos(angle) * dist, h / 2 - 1.5, Math.sin(angle) * dist);
      t.rotation.y = rnd() * Math.PI;
      towers.add(t);

      // Faint antenna light on top of taller towers
      if (h > 110 && rnd() > 0.35) {
        const light = new THREE.Mesh(new THREE.SphereGeometry(1.1, 6, 6), matEdge.clone());
        light.material.color.setHex(0xff3355);
        light.position.set(t.position.x, h - 1.5 + 1.5, t.position.z);
        towers.add(light);
      }
    }
    this.scene.add(towers);
  }

  createDust() {
    const count = 700;
    const positions = new Float32Array(count * 3);
    this.dustSeeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 20 + Math.random() * 320;
      positions[i * 3 + 0] = Math.cos(a) * r;
      positions[i * 3 + 1] = Math.random() * 40;
      positions[i * 3 + 2] = Math.sin(a) * r;
      this.dustSeeds[i] = Math.random() * Math.PI * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.PointsMaterial({
      color: 0x67d8ff, size: 0.5, transparent: true, opacity: 0.35,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    });
    this.dust = new THREE.Points(geo, mat);
    this.scene.add(this.dust);
  }

  createLights() {
    // Cold moonlight key light with soft shadows
    this.hemi = new THREE.HemisphereLight(0x35507a, 0x0a0e14, 0.85);
    this.scene.add(this.hemi);

    this.dirLight = new THREE.DirectionalLight(0xbfd8ff, 2.2);
    this.dirLight.position.set(140, 260, -180);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.width = 2048;
    this.dirLight.shadow.mapSize.height = 2048;
    this.dirLight.shadow.camera.near = 20;
    this.dirLight.shadow.camera.far = 900;
    this.dirLight.shadow.camera.left = -180;
    this.dirLight.shadow.camera.right = 180;
    this.dirLight.shadow.camera.top = 180;
    this.dirLight.shadow.camera.bottom = -180;
    this.dirLight.shadow.bias = -0.0004;
    this.scene.add(this.dirLight);

    // Central cyan glow
    this.centerLight = new THREE.PointLight(0x00e0ff, 1.6, 120, 1.6);
    this.centerLight.position.set(0, 10, 0);
    this.scene.add(this.centerLight);

    // Warm counter-accent across the arena
    const accent = new THREE.PointLight(0xff7744, 0.5, 220, 1.8);
    accent.position.set(180, 40, 120);
    this.scene.add(accent);
  }

  setShadowQuality(quality) {
    if (quality === 'off') {
      this.dirLight.castShadow = false;
    } else {
      this.dirLight.castShadow = true;
      const size = quality === 'ultra' ? 4096 : (quality === 'high' ? 2048 : 1024);
      this.dirLight.shadow.mapSize.width = size;
      this.dirLight.shadow.mapSize.height = size;
      if (this.dirLight.shadow.map) {
        this.dirLight.shadow.map.dispose();
        this.dirLight.shadow.map = null;
      }
    }
  }

  /**
   * Per-frame environment animation.
   */
  update(dt, camera = null) {
    this.clockT += dt;
    const t = this.clockT;

    // Sky: follow the camera and clamp its radius inside the far plane so the
    // star field / moon are never clipped at any view-distance setting.
    if (camera) {
      this.sky.position.copy(camera.position);
      const s = Math.min(1.0, (camera.far * 0.9) / 1050);
      this.sky.scale.setScalar(Math.max(0.15, s));
    }

    // Sky
    this.skyMat.uniforms.uTime.value = t;

    // Central core: rotate, pulse, orbit
    this.coreGroup.rotation.y = t * 0.35;
    this.coreCage.rotation.y = -t * 0.6;
    this.coreCage.rotation.x = t * 0.25;
    this.coreHeart.rotation.x = t * 0.9;
    this.coreHeart.rotation.z = t * 0.7;
    const pulse = 1.0 + Math.sin(t * 2.2) * 0.08;
    this.coreHeart.scale.setScalar(pulse);
    this.coreGroup.position.y = 10 + Math.sin(t * 0.8) * 0.8;
    this.coreRing1.rotation.z = t * 0.8;
    this.coreRing2.rotation.z = -t * 0.6;
    this.centerLight.intensity = 1.5 + Math.sin(t * 2.2) * 0.5;

    // Pylon beacons & beams
    for (const b of this.pylonBeacons) {
      const p = 0.85 + Math.sin(t * 2.4 + b.phase) * 0.35;
      b.mesh.scale.setScalar(p);
    }
    for (const bm of this.pylonBeams) {
      bm.mat.opacity = 0.05 + 0.03 * (0.5 + 0.5 * Math.sin(t * 1.7 + bm.phase));
    }

    // Metric ring breathing
    for (const r of this.rings) {
      r.mat.opacity = r.baseOpacity * (0.75 + 0.25 * Math.sin(t * 1.3 + r.phase));
    }

    // Drifting dust
    const arr = this.dust.geometry.attributes.position.array;
    for (let i = 0; i < this.dustSeeds.length; i++) {
      const s = this.dustSeeds[i];
      arr[i * 3 + 1] += dt * (0.35 + 0.25 * Math.sin(s));
      arr[i * 3 + 0] += Math.sin(t * 0.2 + s) * dt * 0.6;
      arr[i * 3 + 2] += Math.cos(t * 0.17 + s) * dt * 0.6;
      if (arr[i * 3 + 1] > 42) arr[i * 3 + 1] = 0.5;
    }
    this.dust.geometry.attributes.position.needsUpdate = true;
  }
}
