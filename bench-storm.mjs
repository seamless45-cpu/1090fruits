// Round 7 performance benchmark: MAX STORM scenario.
// Every cloud-fruit weather system active simultaneously:
//   12 GPU clouds (incl. squall lines + hurricane ring + wall cloud)
//   14 rain shafts, 2 tornadoes, 3 microbursts, 4 hail fields, flood, tsunami
// Measures per-frame weather + explosions + lightning update cost.
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

// ---------------- MAX STORM SETUP ----------------
const P = (x, z) => new THREE.Vector3(x, 0, z);
// 12 clouds: growing + mature + squall + hurricane + wall + nimbostratus
for (let i = 0; i < 4; i++) {
  weather.spawnGrowingCloud(P(i * 30 - 45, i * 25), i === 3, 150);
}
weather.spawnSquallLine(P(-150, -150), new THREE.Vector3(1, 0, 0), 4, 20, 100);
weather.spawnHurricane(P(200, 200), 80, 30);
weather.spawnWallCloud(P(0, 150), 55, 12, 0.55);
weather.spawnGrowingCloud(P(100, -100), false, 140, {
  altitude: 62, flat: 0.40, startStage: 'congestus', maxStage: 'congestus',
  lifeDuration: 30, rainOnSpawn: true,
});
// 14 rain shafts
for (let i = 0; i < 14; i++) weather.createRainshaft(P(Math.cos(i) * 80, Math.sin(i) * 80), 90, 150, 450);
// 2 tornadoes, 3 microbursts
weather.createTornado(P(30, 30), 8, 160, 200, 20);
weather.createTornado(P(-60, -20), 6, 140, 180, 20);
weather.createMicroburst(P(0, 60), 150, 20);
weather.createMicroburst(P(80, -40), 120, 20);
weather.createMicroburst(P(-80, 40), 120, 20);
// 4 hail fields
for (let i = 0; i < 4; i++) weather.spawnHailstorm(P(i * 40 - 60, i * 30 - 45), 80, 30);
// flood + tsunami
weather.startNimbostratusFlood(30);
weather.spawnTsunami(P(-150, 0), new THREE.Vector3(1, 0, 0), 40, 12, 35, true);
// debris pressure: 40 live explosions
for (let i = 0; i < 40; i++) {
  explosions.createExplosion(P((Math.random() - 0.5) * 200, (Math.random() - 0.5) * 200), 20 + Math.random() * 30, 'asteroid', 1.5);
}

const playerPos = new THREE.Vector3(0, 0, 0);

console.log(`setup: ${weather.activeClouds.length} clouds, ${weather.activeRainshafts.length} rain shafts, ` +
  `${weather.activeTornadoes.length} tornadoes, ${weather.activeMicrobursts.length} microbursts, ` +
  `${weather.activeHail.length} hail fields, scene children: ${scene.children.length}`);

// ---------------- WARMUP + MEASURE ----------------
for (let i = 0; i < 120; i++) {
  weather.update(1 / 60, [], playerPos);
  explosions.update(1 / 60);
  lightning.update(1 / 60);
}

const FRAMES = 600;
let t0 = performance.now();
for (let i = 0; i < FRAMES; i++) {
  weather.update(1 / 60, [], playerPos);
  explosions.update(1 / 60);
  lightning.update(1 / 60);
}
const total = performance.now() - t0;
console.log(`MAX STORM: ${FRAMES} frames in ${total.toFixed(0)}ms -> ${(total / FRAMES).toFixed(2)} ms/frame (weather + explosions + lightning)`);
console.log(`debris live: ${explosions.getActiveDebrisCount()}`);
if (total / FRAMES > 8) { console.error('PERF BUDGET EXCEEDED (>8ms/frame)'); process.exit(1); }
console.log('PERF BUDGET OK');
