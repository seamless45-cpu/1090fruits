import * as THREE from 'three';

/**
 * 3D 1090 Fruits - Combat Arena & Environment
 * Provides an expansive 1000m x 1000m sci-fi battleground
 * with calibrated metric distance rings (10m, 25m, 50m, 100m, 200m, 300m).
 */

export class Arena {
  constructor(scene) {
    this.scene = scene;
    this.createEnvironment();
  }

  createEnvironment() {
    // 1. Arena Main Floor (1200m x 1200m)
    const floorGeo = new THREE.PlaneGeometry(1200, 1200, 32, 32);
    floorGeo.rotateX(-Math.PI / 2);

    // High-tech dark obsidian floor material with metallic reflections
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x090e17,
      roughness: 0.65,
      metalness: 0.45,
    });
    this.floor = new THREE.Mesh(floorGeo, floorMat);
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);

    // 2. Sci-Fi Metric Floor Grid & Distance Rings
    const gridHelper = new THREE.GridHelper(1000, 100, 0x00f0ff, 0x11283d);
    gridHelper.position.y = 0.05;
    this.scene.add(gridHelper);

    // Add glowing metric range circles (1 Three.js unit = 1 meter)
    const ringRanges = [10, 25, 50, 100, 200, 300];
    const ringColors = [0x00f0ff, 0x00ff88, 0xffaa00, 0xb026ff, 0x00d0ff, 0xff2a55];

    ringRanges.forEach((radius, idx) => {
      const ringGeo = new THREE.RingGeometry(radius - 0.25, radius + 0.25, 96);
      ringGeo.rotateX(-Math.PI / 2);
      const ringMat = new THREE.MeshBasicMaterial({
        color: ringColors[idx % ringColors.length],
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.45,
        depthWrite: false
      });
      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      ringMesh.position.y = 0.08;
      this.scene.add(ringMesh);
    });

    // 3. Perimeter Energy Pylons at 350m radius
    const pylonCount = 12;
    const pylonRadius = 380;
    const pylonGeo = new THREE.CylinderGeometry(4, 8, 70, 8);
    const pylonMat = new THREE.MeshStandardMaterial({
      color: 0x0f1c2e,
      roughness: 0.3,
      metalness: 0.8,
      emissive: 0x003366
    });

    for (let i = 0; i < pylonCount; i++) {
      const angle = (i / pylonCount) * Math.PI * 2;
      const x = Math.cos(angle) * pylonRadius;
      const z = Math.sin(angle) * pylonRadius;

      const pylon = new THREE.Mesh(pylonGeo, pylonMat);
      pylon.position.set(x, 35, z);
      pylon.castShadow = true;
      pylon.receiveShadow = true;
      this.scene.add(pylon);

      // Energy Beacon on top of pylon
      const beaconGeo = new THREE.SphereGeometry(3.5, 12, 12);
      const beaconMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
      const beacon = new THREE.Mesh(beaconGeo, beaconMat);
      beacon.position.set(x, 70, z);
      this.scene.add(beacon);
    }

    // 4. Center Platform Dais
    const centerPlatformGeo = new THREE.CylinderGeometry(18, 20, 0.6, 32);
    const centerPlatformMat = new THREE.MeshStandardMaterial({
      color: 0x132238,
      roughness: 0.4,
      metalness: 0.7,
      emissive: 0x051020
    });
    const dais = new THREE.Mesh(centerPlatformGeo, centerPlatformMat);
    dais.position.set(0, 0.3, 0);
    dais.receiveShadow = true;
    this.scene.add(dais);

    // 5. Lighting Setup
    this.ambientLight = new THREE.AmbientLight(0x406080, 0.85);
    this.scene.add(this.ambientLight);

    this.dirLight = new THREE.DirectionalLight(0xddeeff, 2.0);
    this.dirLight.position.set(120, 220, 90);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.width = 2048;
    this.dirLight.shadow.mapSize.height = 2048;
    this.dirLight.shadow.camera.near = 10;
    this.dirLight.shadow.camera.far = 600;
    this.dirLight.shadow.camera.left = -160;
    this.dirLight.shadow.camera.right = 160;
    this.dirLight.shadow.camera.top = 160;
    this.dirLight.shadow.camera.bottom = -160;
    this.dirLight.shadow.bias = -0.0005;
    this.scene.add(this.dirLight);

    // Subtle atmospheric blue point glow in center
    const centerLight = new THREE.PointLight(0x00f0ff, 1.2, 80);
    centerLight.position.set(0, 6, 0);
    this.scene.add(centerLight);
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
}
