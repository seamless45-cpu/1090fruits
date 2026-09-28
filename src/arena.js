import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * 3D 1090 Fruits - Combat Arena & Environment (REWORK v4)
 *
 * A cinematic 1000m sci-fi battleground:
 *  - Procedural gradient sky dome with hash star-field + a distant moon
 *  - Neon metric floor grid (canvas-generated, emissive) with distance rings
 *  - 12 perimeter energy pylons - merged into 3 draw calls (was ~84 meshes)
 *  - Distant megastructures - merged into 1 mesh + 1 point cloud (was ~60)
 *  - Central holographic energy core
 *  - GPU-animated atmosphere dust (zero CPU per frame)
 *  - Calibrated metric range rings (10m - 300m), merged into 1 draw call
 *
 * REWORK PERFORMANCE NOTES:
 *  - static world geometry is merged (BufferGeometryUtils) so the whole
 *    environment costs ~10 draw calls instead of ~150
 *  - pylon beacon pulses + dust drift run in vertex shaders (uTime only)
 *  - nothing allocates in update()
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
  uniform float uFlash; // lightning illumination of the whole sky
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

    // Faint storm-band aurora near the horizon (two incommensurate waves)
    float band = smoothstep(0.02, 0.10, h) * (1.0 - smoothstep(0.10, 0.30, h));
    float wave = sin(d.x * 9.0 + uTime * 0.06) * 0.5 + sin(d.z * 7.0 - uTime * 0.045) * 0.5;
    sky += vec3(0.010, 0.05, 0.075) * band * (0.45 + 0.35 * wave);
    // Rework: a second, slower aurora sheet higher up for depth
    float band2 = smoothstep(0.12, 0.24, h) * (1.0 - smoothstep(0.24, 0.48, h));
    float wave2 = sin(d.x * 4.0 - uTime * 0.03) * sin(d.z * 5.0 + uTime * 0.02);
    sky += vec3(0.012, 0.028, 0.05) * band2 * (0.5 + 0.5 * wave2);

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

    // Lightning flash: cool white-blue wash across the whole sky
    sky += vec3(0.55, 0.75, 1.0) * uFlash * (0.35 + 0.65 * smoothstep(0.0, 0.5, h));

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
  constructor(scene, renderer = null) {
    this.scene = scene;
    this.renderer = renderer;
    this.clockT = 0;
    this.skyFlash = 0;

    this.createSky();
    this.createFloor();
    this.createRings();
    this.createPylons();
    this.createCenterCore();
    this.createDistantTowers();
    this.createDust();
    this.createGroundFog();
    this.createLights();

    // Real reflections: PMREM environment map for all metallic surfaces
    if (renderer) {
      this.createEnvironment();
    }
  }

  createSky() {
    const geo = new THREE.SphereGeometry(1050, 32, 24);
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uFlash: { value: 0 },
      },
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(geo, this.skyMat);
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);
  }

  /**
   * Build a PMREM environment map so every metallic / glossy material
   * (player armor, enemy mechs, pylons, floor) reflects the storm sky
   * and neon accents. One-time cost, huge realism payoff.
   */
  createEnvironment() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);

    const envScene = new THREE.Scene();

    // Gradient dome matching the game sky (slightly brighter for reflections)
    const domeGeo = new THREE.SphereGeometry(50, 24, 16);
    const domeMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        varying vec3 vP;
        void main() {
          float h = normalize(vP).y * 0.5 + 0.5;
          vec3 bot = vec3(0.05, 0.09, 0.14);
          vec3 mid = vec3(0.10, 0.20, 0.34);
          vec3 top = vec3(0.02, 0.05, 0.12);
          vec3 c = mix(bot, mid, smoothstep(0.0, 0.5, h));
          c = mix(c, top, smoothstep(0.5, 1.0, h));
          gl_FragColor = vec4(c * 2.0, 1.0);
        }`,
    });
    envScene.add(new THREE.Mesh(domeGeo, domeMat));

    // Neon accent panels - make reflections interesting (cyan / purple / warm)
    const panel = (color, intensity, pos, rotY, scale) => {
      const g = new THREE.PlaneGeometry(1, 1);
      const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide });
      const p = new THREE.Mesh(g, m);
      p.position.copy(pos);
      p.rotation.y = rotY;
      p.scale.setScalar(scale);
      envScene.add(p);
    };
    panel(0x00d8ff, 6.0, new THREE.Vector3(-18, 6, -20), 0.8, 10);
    panel(0xb026ff, 5.0, new THREE.Vector3(20, 8, 16), -2.4, 8);
    panel(0xff6633, 3.0, new THREE.Vector3(10, -4, -24), 1.2, 7);
    panel(0xffffff, 8.0, new THREE.Vector3(0, 26, 0), 0, 5); // "moon" highlight

    this.envRT = pmrem.fromScene(envScene, 0.06);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 0.55;
    pmrem.dispose();
    envScene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }

  /**
   * Set the global lightning sky flash (0..1+). Called each frame from
   * the game engine with the lightning manager's current flash level.
   */
  setSkyFlash(level) {
    this.skyFlash = level;
    this.skyMat.uniforms.uFlash.value = Math.min(1.5, level);
  }

  /**
   * Live storm lighting. level 0..1 (driven by the weather manager): a
   * heavy sky over the arena dims the key/hemisphere lights and thickens
   * the fog, so storms visibly weigh down the whole world.
   */
  setStormLevel(level) {
    // Weather manager ticks at 2Hz - ease toward it per frame so the sky
    // darkens/rises smoothly instead of stepping.
    const target = level < 0 ? 0 : level > 1 ? 1 : level;
    this._stormLvl = this._stormLvl == null ? target : this._stormLvl + (target - this._stormLvl) * 0.04;
    const l = this._stormLvl;
    this.hemi.intensity = 0.85 * (1 - 0.52 * l);
    this.dirLight.intensity = 2.2 * (1 - 0.58 * l);
    const fog = this.scene.fog;
    if (fog && fog.densityBase !== undefined) {
      fog.color.setHex(0x0a1420).lerp(fog.colorStorm, l);
      fog.density = fog.densityBase * (1 + 0.7 * l);
    }
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
    // 3D glowing metric range rings: all SIX merged into ONE vertex-colored
    // mesh (was 6 draw calls with per-ring material clones).
    const ringRanges = [10, 25, 50, 100, 200, 300];
    const ringColors = [0x00f0ff, 0x00ff88, 0xffaa00, 0xb026ff, 0x00d0ff, 0xff2a55];

    const parts = [];
    const color = new THREE.Color();
    for (let idx = 0; idx < ringRanges.length; idx++) {
      const g = new THREE.TorusGeometry(ringRanges[idx], 0.18, 8, 96);
      g.rotateX(Math.PI / 2);
      // Bake the ring color into a per-vertex color attribute
      color.setHex(ringColors[idx % ringColors.length]);
      const count = g.attributes.position.count;
      const cols = new Float32Array(count * 3);
      for (let v = 0; v < count; v++) {
        cols[v * 3] = color.r;
        cols[v * 3 + 1] = color.g;
        cols[v * 3 + 2] = color.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      parts.push(g);
    }

    const merged = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();

    this.ringMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.ringMesh = new THREE.Mesh(merged, this.ringMat);
    this.ringMesh.position.y = 0.25;
    this.scene.add(this.ringMesh);
  }

  createPylons() {
    // 12 perimeter pylons, MERGED: the old build created 12 Groups with
    // ~7 meshes each (~84 draw calls). The rework bakes every pylon into:
    //   1 dark structure mesh + 1 emissive strip mesh (static, merged)
    //   1 point cloud for the pulsing beacons (shader-animated)
    //   1 merged volumetric beam cylinder mesh
    // => 4 draw calls total for the entire pylon ring.
    const pylonCount = 12;
    const pylonRadius = 380;

    const bodyGeo = new THREE.CylinderGeometry(5, 9, 78, 6);
    const capGeo = new THREE.CylinderGeometry(7.5, 5, 4, 6);
    const stripGeo = new THREE.BoxGeometry(0.7, 60, 0.7);
    const beamGeo = new THREE.CylinderGeometry(2.2, 3.4, 220, 12, 1, true);

    const structParts = [];
    const stripParts = [];
    const beamParts = [];
    const beaconPos = new Float32Array(pylonCount * 3);
    const beaconPhase = new Float32Array(pylonCount);

    const ONE = new THREE.Vector3(1, 1, 1);
    const groupMat = new THREE.Matrix4();
    const groupQ = new THREE.Quaternion();
    const bake = (geo, localY, out) => {
      const g = geo.clone();
      g.translate(0, localY, 0);
      g.applyMatrix4(groupMat);
      out.push(g);
    };

    for (let i = 0; i < pylonCount; i++) {
      const angle = (i / pylonCount) * Math.PI * 2;
      const px = Math.cos(angle) * pylonRadius;
      const pz = Math.sin(angle) * pylonRadius;
      // Orient the pylon toward the arena center (as the old lookAt did)
      const q = groupQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -angle + Math.PI / 2);
      groupMat.compose(new THREE.Vector3(px, 0, pz), q, ONE);

      bake(bodyGeo, 39, structParts);
      bake(capGeo, 79, structParts);

      // Three glowing vertical strips around the hexagon
      for (let s = 0; s < 3; s++) {
        const sa = (s / 3) * Math.PI * 2 + Math.PI / 6;
        const g = stripGeo.clone();
        g.translate(Math.cos(sa) * 5.6, 38, Math.sin(sa) * 5.6);
        g.applyMatrix4(groupMat);
        stripParts.push(g);
      }

      bake(beamGeo, 78 + 110, beamParts);

      beaconPos[i * 3] = px;
      beaconPos[i * 3 + 1] = 84;
      beaconPos[i * 3 + 2] = pz;
      beaconPhase[i] = i * 0.7;
    }

    // 1. Dark structure (bodies + caps)
    const structMerged = mergeGeometries(structParts, false);
    structParts.forEach(g => g.dispose());
    bodyGeo.dispose(); capGeo.dispose();
    const structMat = new THREE.MeshStandardMaterial({ color: 0x0d1727, roughness: 0.35, metalness: 0.85 });
    this.pylonStruct = new THREE.Mesh(structMerged, structMat);
    this.pylonStruct.castShadow = true;
    this.scene.add(this.pylonStruct);

    // 2. Emissive strips (basic material, baked cyan)
    const stripMerged = mergeGeometries(stripParts, false);
    stripParts.forEach(g => g.dispose());
    stripGeo.dispose();
    const stripMat = new THREE.MeshBasicMaterial({ color: 0x18c8ff, fog: false });
    this.pylonStrips = new THREE.Mesh(stripMerged, stripMat);
    this.scene.add(this.pylonStrips);

    // 3. Beacon point cloud with in-shader pulse (zero CPU per frame)
    const beaconGeo = new THREE.BufferGeometry();
    beaconGeo.setAttribute('position', new THREE.BufferAttribute(beaconPos, 3));
    beaconGeo.setAttribute('aPhase', new THREE.BufferAttribute(beaconPhase, 1));
    this.beaconMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */`
        attribute float aPhase;
        uniform float uTime;
        varying float vPulse;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float pulse = 0.85 + 0.35 * sin(uTime * 2.4 + aPhase);
          vPulse = pulse;
          gl_PointSize = 10.0 * pulse * (300.0 / max(1.0, -mv.z));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying float vPulse;
        void main() {
          vec2 q = gl_PointCoord - 0.5;
          float d = length(q) * 2.0;
          float a = smoothstep(1.0, 0.1, d);
          gl_FragColor = vec4(vec3(0.62, 0.96, 1.0) * vPulse, a * 0.9);
        }`,
    });
    this.pylonBeacons = new THREE.Points(beaconGeo, this.beaconMat);
    this.pylonBeacons.frustumCulled = false;
    this.scene.add(this.pylonBeacons);

    // 4. Merged volumetric light beams (single synchronized breathing pulse)
    const beamMerged = mergeGeometries(beamParts, false);
    beamParts.forEach(g => g.dispose());
    beamGeo.dispose();
    this.beamMat = new THREE.MeshBasicMaterial({
      color: 0x00d8ff, transparent: true, opacity: 0.07, side: THREE.DoubleSide,
      depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
    this.pylonBeams = new THREE.Mesh(beamMerged, this.beamMat);
    this.scene.add(this.pylonBeams);
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
    // Megastructure silhouettes for parallax depth.
    // MERGED: 46 boxes + ~15 antenna lights collapse into
    // 1 mesh + 1 point cloud (was ~60 draw calls).
    const towers = [];
    const lightPos = [];
    let seed = 12345;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

    for (let i = 0; i < 46; i++) {
      const angle = (i / 46) * Math.PI * 2 + rnd() * 0.4;
      const dist = 470 + rnd() * 220;
      const w = 14 + rnd() * 40;
      const h = 30 + rnd() * 150;
      const d = 14 + rnd() * 40;

      const g = new THREE.BoxGeometry(w, h, d);
      const m = new THREE.Matrix4()
        .makeRotationY(rnd() * Math.PI)
        .setPosition(Math.cos(angle) * dist, h / 2 - 1.5, Math.sin(angle) * dist);
      g.applyMatrix4(m);
      towers.push(g);

      // Faint antenna light on top of taller towers
      if (h > 110 && rnd() > 0.35) {
        lightPos.push(Math.cos(angle) * dist, h, Math.sin(angle) * dist);
      }
    }

    const merged = mergeGeometries(towers, false);
    towers.forEach(g => g.dispose());
    const matDark = new THREE.MeshStandardMaterial({ color: 0x0a121e, roughness: 0.9, metalness: 0.3 });
    this.towerMesh = new THREE.Mesh(merged, matDark);
    this.scene.add(this.towerMesh);

    const lightGeo = new THREE.BufferGeometry();
    lightGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lightPos), 3));
    this.towerLightsMat = new THREE.PointsMaterial({
      color: 0xff3355, size: 3.0, sizeAttenuation: true,
      transparent: true, opacity: 0.8, depthWrite: false, fog: false,
    });
    this.towerLights = new THREE.Points(lightGeo, this.towerLightsMat);
    this.scene.add(this.towerLights);
  }

  createDust() {
    // GPU atmosphere dust: positions are STATIC; all drift/twinkle happens in
    // the vertex shader from uTime. Zero CPU work per frame (the old version
    // rewrote 700 positions on the CPU every frame).
    const count = 700;
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 20 + Math.random() * 320;
      positions[i * 3 + 0] = Math.cos(a) * r;
      positions[i * 3 + 1] = Math.random() * 42;
      positions[i * 3 + 2] = Math.sin(a) * r;
      seeds[i] = Math.random() * Math.PI * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 21, 0), 400);

    this.dustMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */`
        attribute float aSeed;
        uniform float uTime;
        varying float vA;
        void main() {
          vec3 p = position;
          float s = aSeed;
          // Rise + wrap (matches the old CPU drift)
          p.y = mod(p.y + uTime * (0.35 + 0.25 * sin(s)), 42.0);
          p.x += sin(uTime * 0.2 + s) * 3.0;
          p.z += cos(uTime * 0.17 + s) * 3.0;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = 6.0 * (300.0 / max(1.0, -mv.z));
          vA = 0.28 + 0.14 * sin(uTime * 1.3 + s * 3.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying float vA;
        void main() {
          vec2 q = gl_PointCoord - 0.5;
          float d = length(q) * 2.0;
          float a = smoothstep(1.0, 0.15, d) * vA;
          gl_FragColor = vec4(vec3(0.40, 0.85, 1.0), a);
        }`,
    });
    this.dust = new THREE.Points(geo, this.dustMat);
    this.dust.frustumCulled = false;
    this.scene.add(this.dust);
  }

  createGroundFog() {
    // Low, slow-drifting mist sheets for atmospheric depth
    const cv = document.createElement('canvas');
    cv.width = 128;
    cv.height = 128;
    const ctx = cv.getContext('2d');
    const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.2)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(cv);

    this.fogSprites = [];
    for (let i = 0; i < 10; i++) {
      const mat = new THREE.SpriteMaterial({
        map: tex, color: 0x6f93b8, transparent: true,
        opacity: 0.05 + Math.random() * 0.05, depthWrite: false,
      });
      const sp = new THREE.Sprite(mat);
      const r = 80 + Math.random() * 240;
      const a = Math.random() * Math.PI * 2;
      sp.position.set(Math.cos(a) * r, 1.5 + Math.random() * 3.5, Math.sin(a) * r);
      const s = 70 + Math.random() * 100;
      sp.scale.set(s, s * 0.32, 1);
      this.scene.add(sp);
      this.fogSprites.push({
        sp, mat, r, a,
        speed: (0.004 + Math.random() * 0.012) * (Math.random() < 0.5 ? -1 : 1),
        baseOpacity: mat.opacity,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  createLights() {
    // Cold moonlight key light with soft shadows
    this.hemi = new THREE.HemisphereLight(0x35507a, 0x0a0e14, 0.85);
    this.scene.add(this.hemi);

    this.dirLight = new THREE.DirectionalLight(0xbfd8ff, 2.2);
    this.dirLight.position.set(140, 260, -180);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.width = 1024;
    this.dirLight.shadow.mapSize.height = 1024;
    this.userShadowSize = 1024;
    this.dirLight.shadow.camera.near = 20;
    this.dirLight.shadow.camera.far = 900;
    // Tighter ortho frustum around the combat zone => sharper shadows at the
    // same 1024 map size (texel density up ~45% vs the old ±180m box).
    this.dirLight.shadow.camera.left = -150;
    this.dirLight.shadow.camera.right = 150;
    this.dirLight.shadow.camera.top = 150;
    this.dirLight.shadow.camera.bottom = -150;
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
      this.userShadowSize = 0;
    } else {
      this.dirLight.castShadow = true;
      const size = quality === 'ultra' ? 4096 : (quality === 'high' ? 2048 : 1024);
      this.userShadowSize = size;
      this.dirLight.shadow.mapSize.width = size;
      this.dirLight.shadow.mapSize.height = size;
      if (this.dirLight.shadow.map) {
        this.dirLight.shadow.map.dispose();
        this.dirLight.shadow.map = null;
      }
    }
  }

  /**
   * Per-frame environment animation. The reworked arena only touches
   * uniforms and a handful of opacity values - zero buffer uploads.
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

    // Pylon beacons: pulse lives in the shader now (uniform-only update)
    this.beaconMat.uniforms.uTime.value = t;
    // Volumetric beams: gentle synchronized breathing
    this.beamMat.opacity = 0.05 + 0.03 * (0.5 + 0.5 * Math.sin(t * 1.7));

    // Metric ring breathing (single mesh, single opacity)
    this.ringMat.opacity = 0.4 * (0.75 + 0.25 * Math.sin(t * 1.3));

    // Drifting ground fog (10 sprites - trivial)
    for (const f of this.fogSprites) {
      f.a += f.speed * dt;
      f.sp.position.x = Math.cos(f.a) * f.r;
      f.sp.position.z = Math.sin(f.a) * f.r;
      f.mat.opacity = f.baseOpacity * (0.8 + 0.2 * Math.sin(t * 0.3 + f.phase));
    }

    // Sky flash decay (driven externally each frame, smoothed here)
    this.skyFlash = Math.max(0, this.skyFlash - dt * 6.0);
    this.skyMat.uniforms.uFlash.value = Math.min(1.5, this.skyFlash);

    // Atmosphere dust: GPU-animated (uniform-only)
    this.dustMat.uniforms.uTime.value = t;
  }
}
