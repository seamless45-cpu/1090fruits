// Round 7 draw-call census: count renderable objects (proxy for GPU draw
// calls) in the max-storm scene. Run: node bench-drawcalls.mjs
import * as THREE from 'three';
await import('./test/dom-stub.mjs');

const { CameraController } = await import('./src/camera.js');
const { LightningManager } = await import('./src/effects/lightning.js');
const { ExplosionManager } = await import('./src/effects/explosions.js');
const { CloudWeatherManager } = await import('./src/effects/clouds_weather.js');
const { sound } = await import('./src/audio.js');

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x0a1420, 0.0016);
const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.2, 1200);
const cam = new CameraController(camera, null);
const lightning = new LightningManager(scene);
const explosions = new ExplosionManager(scene, cam, sound);
const weather = new CloudWeatherManager(scene, lightning, explosions, sound);

const P = (x, z) => new THREE.Vector3(x, 0, z);
// Count only VISIBLE renderables - a true draw-call proxy (three.js skips
// invisible objects, and each visible renderable ~= 1 draw call).
const census = (label) => {
  let meshes = 0, points = 0, lines = 0, sprites = 0;
  const isVis = (o) => {
    // an object is drawn if it and all ancestors are visible
    let n = o, v = true;
    while (n) { if (!n.visible) { v = false; break; } n = n.parent; }
    return v;
  };
  scene.traverse((o) => {
    if (!isVis(o)) return;
    if (o.isMesh) meshes++;
    else if (o.isPoints) points++;
    else if (o.isLineSegments || o.isLine) lines++;
    else if (o.isSprite) sprites++;
  });
  console.log(`${label}: meshes=${meshes} points=${points} lines=${lines} sprites=${sprites} (total ${meshes + points + lines + sprites})`);
};

census('empty scene');

// --- MAX STORM (same as bench-storm) ---
for (let i = 0; i < 4; i++) weather.spawnGrowingCloud(P(i * 30 - 45, i * 25), i === 3, 150);
weather.spawnSquallLine(P(-150, -150), new THREE.Vector3(1, 0, 0), 4, 20, 100);
weather.spawnHurricane(P(200, 200), 80, 30);
weather.spawnWallCloud(P(0, 150), 55, 12, 0.55);
weather.spawnGrowingCloud(P(100, -100), false, 140, {
  altitude: 62, flat: 0.40, startStage: 'congestus', maxStage: 'congestus',
  lifeDuration: 30, rainOnSpawn: true,
});
for (let i = 0; i < 14; i++) weather.createRainshaft(P(Math.cos(i) * 80, Math.sin(i) * 80), 90, 150, 450);
weather.createTornado(P(30, 30), 8, 160, 200, 20);
weather.createTornado(P(-60, -20), 6, 140, 180, 20);
weather.createMicroburst(P(0, 60), 150, 20);
weather.createMicroburst(P(80, -40), 120, 20);
weather.createMicroburst(P(-80, 40), 120, 20);
for (let i = 0; i < 4; i++) weather.spawnHailstorm(P(i * 40 - 60, i * 30 - 45), 80, 30);
weather.startNimbostratusFlood(30);
weather.spawnTsunami(P(-150, 0), new THREE.Vector3(1, 0, 0), 40, 12, 35, true);
for (let i = 0; i < 40; i++) {
  explosions.createExplosion(P((Math.random() - 0.5) * 200, (Math.random() - 0.5) * 200), 20 + Math.random() * 30, 'asteroid', 1.5);
}
for (let i = 0; i < 120; i++) {
  weather.update(1 / 60, [], new THREE.Vector3(0, 0, 0));
  explosions.update(1 / 60);
  lightning.update(1 / 60);
}
census('MAX STORM');
