/**
 * Headless runtime smoke test for 3D 1090 Fruits.
 * - Stubs the minimal DOM/window API
 * - Imports the real game modules
 * - Runs the full object graph for simulated frames
 * - Casts every skill in the database
 * - PROVES camera shake is strictly translational (quaternion invariant)
 */
import * as THREE from 'three';

let failures = 0;
const fail = (msg) => { failures++; console.error(`  ✗ FAIL: ${msg}`); };
const ok = (msg) => console.log(`  ✓ ${msg}`);

process.on('uncaughtException', (e) => {
  console.error('UNCAUGHT EXCEPTION:', e);
  failures++;
});
process.on('unhandledRejection', (e) => {
  console.error('UNHANDLED REJECTION:', e);
  failures++;
});

// ---------------------------------------------------------------------------
// DOM / window stubs
// ---------------------------------------------------------------------------
const ctx2dStub = new Proxy({}, {
  get: (t, k) => {
    if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop: () => {} });
    if (k === 'createImageData') return (w, h) => ({ data: new Uint8ClampedArray((w || 256) * (h || 256) * 4), width: w || 256, height: h || 256 });
    if (k === 'putImageData' || k === 'drawImage') return () => {};
    if (k === 'measureText') return () => ({ width: 10 });
    if (k === 'canvas') return { width: 256, height: 256 };
    if (k in t) return t[k];
    return () => {};
  },
  set: (t, k, v) => { t[k] = v; return true; },
});

function makeEl(tag = 'div', id = '') {
  const el = {
    tagName: tag.toUpperCase(),
    id,
    style: {},
    className: '',
    innerHTML: '',
    textContent: '',
    value: '1.0',
    checked: true,
    disabled: false,
    parentNode: null,
    children: [],
    dataset: {},
    classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
    addEventListener: () => {},
    removeEventListener: () => {},
    appendChild: (c) => { c.parentNode = el; el.children.push(c); return c; },
    removeChild: (c) => { const i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); c.parentNode = null; },
    closest: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    getContext: () => ctx2dStub,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
  };
  if (tag === 'canvas') { el.width = 256; el.height = 256; }
  return el;
}

const elementRegistry = new Map();
const getElementById = (id) => {
  if (!elementRegistry.has(id)) elementRegistry.set(id, makeEl('div', id));
  return elementRegistry.get(id);
};

global.window = {
  addEventListener: () => {},
  removeEventListener: () => {},
  innerWidth: 1280,
  innerHeight: 720,
  devicePixelRatio: 1,
  performance,
  setTimeout,
  setInterval,
  clearTimeout,
  clearInterval,
};
global.self = global.window;
try {
  Object.defineProperty(globalThis, 'navigator', {
    value: { getGamepads: () => null, maxTouchPoints: 0 },
    configurable: true,
    writable: true,
  });
} catch (e) {
  // navigator already defined and immutable - leave as is
}
global.document = {
  getElementById,
  createElement: (tag) => makeEl(tag),
  createTextNode: (t) => ({ textContent: t }),
  querySelectorAll: () => [],
  querySelector: () => null,
  addEventListener: () => {},
  body: makeEl('body'),
};
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

// ---------------------------------------------------------------------------
// Import real game code
// ---------------------------------------------------------------------------
const { CameraController } = await import('./src/camera.js');
const { Arena } = await import('./src/arena.js');
const { Player } = await import('./src/player.js');
const { EnemyManager } = await import('./src/enemies.js');
const { LightningManager } = await import('./src/effects/lightning.js');
const { ExplosionManager } = await import('./src/effects/explosions.js');
const { CloudWeatherManager } = await import('./src/effects/clouds_weather.js');
const { SKILL_DATABASE } = await import('./src/skills/skill_definitions.js');
const { GameEngine } = await import('./src/main.js');
const { sound } = await import('./src/audio.js');

console.log('All modules imported OK');

// ---------------------------------------------------------------------------
// Build the full scene graph
// ---------------------------------------------------------------------------
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x0a1420, 0.0016);
const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.2, 1200);
window.__activeCamera = camera;

const cam = new CameraController(camera, null);
const lightning = new LightningManager(scene);
const explosions = new ExplosionManager(scene, cam, sound);
const weather = new CloudWeatherManager(scene, lightning, explosions);
const arena = new Arena(scene);
const player = new Player(scene, sound);
const enemies = new EnemyManager(scene, explosions);

ok('Full object graph constructed (Arena, Player, Enemies, all effect managers)');

// Prime weather systems
weather.spawnGrowingCloud(new THREE.Vector3(40, 0, 40), true, 150);
weather.createRainshaft(new THREE.Vector3(20, 0, -30), 80, 140, 500);
weather.createTornado(new THREE.Vector3(-40, 0, 20), 8, 160, 200, 10);
weather.spawnTsunami(new THREE.Vector3(-80, 0, 0), new THREE.Vector3(1, 0, 0), 40, 12, 35, true);
weather.createMicroburst(new THREE.Vector3(30, 0, -50), 100, 8);
weather.startNimbostratusFlood(10);

// All explosion types
for (const t of ['asteroid', 'lightning', 'quake', 'alarm', 'ice', 'fire', 'cloud']) {
  explosions.createExplosion(new THREE.Vector3((Math.random() - 0.5) * 40, 0, (Math.random() - 0.5) * 40), 18, t, 1.5);
}
ok('Spawned all 7 explosion types + full weather suite');

// Instanced debris: instances must be live immediately after the blasts
{
  const n = explosions.getActiveDebrisCount();
  if (!(n > 0)) throw new Error(`expected live instanced debris after 7 explosions, got ${n}`);
  ok(`Instanced debris live right after blasts (active instances: ${n})`);
}

// VFX pre-warm: renderer.compile must accept every pooled effect
{
  let compiled = false;
  const fakeRenderer = { compile: () => { compiled = true; } };
  const count = explosions.preflight(fakeRenderer, camera);
  if (!compiled) throw new Error('preflight did not call renderer.compile');
  if (!(count > 100)) throw new Error(`preflight warmed only ${count} objects`);
  ok(`VFX armory pre-warmed ${count} pooled effects for shader compilation`);
}

// VFX stress: 300-explosion barrage (ring-buffer overflow safety + timing)
{
  const types = ['asteroid', 'lightning', 'quake', 'alarm', 'ice', 'fire', 'cloud'];
  const t0 = performance.now();
  for (let i = 0; i < 300; i++) {
    explosions.createExplosion(
      new THREE.Vector3((Math.random() - 0.5) * 160, 0, (Math.random() - 0.5) * 160),
      8 + Math.random() * 40,
      types[i % 7],
      1.5
    );
  }
  const spawnMs = performance.now() - t0;
  const peakDebris = explosions.getActiveDebrisCount();
  const t1 = performance.now();
  for (let i = 0; i < 400; i++) explosions.update(1 / 60);
  const simMs = performance.now() - t1;
  // All pools must be bounded: debris slots ring-buffer (<= 4*256 live)
  if (peakDebris > 4 * 256) throw new Error(`debris unbounded: ${peakDebris}`);
  if (peakDebris === 0) throw new Error('stress barrage produced no debris');
  // Let everything expire
  for (let i = 0; i < 600; i++) explosions.update(1 / 60);
  if (explosions.getActiveDebrisCount() !== 0) throw new Error('debris never expired after barrage');
  ok(`VFX stress: 300-explosion barrage spawned in ${spawnMs.toFixed(1)}ms, peak ${peakDebris} debris instances, ${400} update frames in ${simMs.toFixed(1)}ms (${(simMs / 400).toFixed(2)}ms/frame), fully expired`);
}

// Lightning variants
lightning.strikeBolt(new THREE.Vector3(5, 0, 5), 100, '#00f0ff', 0.3, 24);
lightning.strikeOverlapped(new THREE.Vector3(-10, 0, 10), 4, 3, 90, '#b026ff');
lightning.strikeCrack(new THREE.Vector3(0, 0, 0), new THREE.Vector3(20, 0, 8), '#00bfff', 0.4);

// Round-3 cinematic skill visuals (cast-presentation path)
explosions.auraBurst(new THREE.Vector3(3, 1.3, 3), 0xb026ff, 9);
explosions.vortex(new THREE.Vector3(-6, 0, 6), 0x99ccff, 14, 2);
explosions.megaShockwave(new THREE.Vector3(0, 0, -8), 50, 0x00bfff);
explosions.beam(new THREE.Vector3(2, 1.6, 0), new THREE.Vector3(20, 2, -14), 2, 0xff0044);
{
  // Pump a few frames so the new pools animate + expire cleanly
  for (let i = 0; i < 120; i++) explosions.update(1 / 60);
}
ok('cinematic cast visuals (auraBurst / vortex / megaShockwave / beam) animated 120 frames');

// ---------------------------------------------------------------------------
// CORE SPEC TEST: camera shake must be strictly translational (no rotation)
// ---------------------------------------------------------------------------
console.log('\n[Camera shake spec test]');
{
  // Two IDENTICAL controllers fed the exact same input stream.
  // One receives shakes, the other does not. If shake is purely axial,
  // their orientations must match BIT-FOR-BIT on every single frame,
  // while their positions diverge by exactly the shake offset.
  const camClean = new CameraController(camera, null);
  const camShaken = new CameraController(new THREE.PerspectiveCamera(58, 16 / 9, 0.2, 1200), null);
  const camShaken2 = camShaken.camera;

  const p0 = new THREE.Vector3(0, 0, 0);
  const p1 = new THREE.Vector3(2, 0, -3);
  const p2 = new THREE.Vector3(5, 0, 4);

  let maxQDiff = 0;
  let maxPDiff = 0;
  let minPDiffWhileShaking = Infinity;

  const frames = 600; // 10s
  for (let i = 0; i < frames; i++) {
    // Identical input stream for both controllers
    const targetPos = i < 200 ? p0 : (i < 400 ? p1 : p2);
    camClean.update(1 / 60, targetPos);
    camShaken.update(1 / 60, targetPos);

    // Fire continuous + burst shakes at the shaken camera only
    if (i % 90 === 0) {
      camShaken.addShake(new THREE.Vector3((Math.random() - 0.5) * 30, 0, (Math.random() - 0.5) * 30), 3.0 + Math.random() * 3.0, 1.2, 60);
    }
    if (i % 25 === 0) {
      camShaken.addShake(null, 0.8, 0.4, 45); // global shake (no origin)
    }

    const a = camera.quaternion;      // clean
    const b = camShaken2.quaternion;  // shaken
    const qDiff = Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z) + Math.abs(a.w - b.w);
    const pDiff = camera.position.distanceTo(camShaken2.position);

    maxQDiff = Math.max(maxQDiff, qDiff);
    maxPDiff = Math.max(maxPDiff, pDiff);
    if (camShaken.shakeList.length > 0) minPDiffWhileShaking = Math.min(minPDiffWhileShaking, pDiff);
  }

  console.log(`  max |quaternion| diff over 600 frames: ${maxQDiff.toExponential(3)}`);
  console.log(`  max position displacement during shake: ${maxPDiff.toFixed(3)} m`);

  if (maxQDiff > 0) {
    fail(`camera orientation differed from un-shaken twin (delta ${maxQDiff}) - ROTATIONAL shake present!`);
  } else {
    ok('orientation BIT-IDENTICAL to un-shaken twin across 600 frames (strictly 0 rotation)');
  }
  if (maxPDiff < 0.05) {
    fail(`shake never displaced the camera (max ${maxPDiff}) - shake broken!`);
  } else {
    ok(`camera displaced on X/Y/Z axes only (up to ${maxPDiff.toFixed(2)} m)`);
  }
}

// ---------------------------------------------------------------------------
// Firepit + hazard lifecycle (real GameEngine.spawnFirepit)
// ---------------------------------------------------------------------------
const fakeHazards = [];
{
  const fakeThis = { scene, activeHazards: fakeHazards };
  GameEngine.prototype.spawnFirepit.call(fakeThis, new THREE.Vector3(10, 0, 10), 20, 2.0, 0.03);
  if (fakeThis.activeHazards.length !== 1) fail('spawnFirepit did not register a hazard');
  else ok('spawnFirepit created layered hazard (core + ring + dynamic light)');
}

// ---------------------------------------------------------------------------
// M1 attack + passive gun (real GameEngine methods)
// ---------------------------------------------------------------------------
{
  const fakeGame = {
    player, enemies, lightning, explosions, sound,
    inGame: true,
    equippedSword: 'gravity_blade',
    equippedFruit: 'rimefracture',
    gunFireCooldown: 0,
    tracerPool: [],
    fireTracer: () => { /* visual-only, no-op in headless */ },
  };
  for (let i = 0; i < 4; i++) GameEngine.prototype.handleM1Attack.call(fakeGame);
  ok('M1 combo x4 (gravity blade charge + 6-24 bolt burst)');

  fakeGame.equippedFruit = 'wildfire';
  fakeGame.gunFireCooldown = 0;
  GameEngine.prototype.firePassiveGunManual.call(fakeGame);
  GameEngine.prototype.firePassiveGunManual.call(fakeGame);
  ok('Passive gun fire (rimefracture + wildfire)');
}

// ---------------------------------------------------------------------------
// Cast EVERY skill in the database
// ---------------------------------------------------------------------------
console.log('\n[Skill cast test]');
{
  const fakeThis = { scene, activeHazards: fakeHazards };
  const ctx = {
    scene, camera, cameraController: cam, player, enemies,
    lightning, explosions, weather, sound,
    triggerScreenFlash: GameEngine.prototype.triggerScreenFlash,
    spawnFirepit: (p, r, d, t) => GameEngine.prototype.spawnFirepit.call(fakeThis, p, r, d, t),
    openSupercellPicker: () => {},
  };
  ctx.triggerScreenFlash = ctx.triggerScreenFlash.bind({});

  let count = 0;
  for (const key of Object.keys(SKILL_DATABASE)) {
    const entry = SKILL_DATABASE[key];
    for (const skill of entry.skills) {
      try {
        skill.cast(ctx);
        count++;
      } catch (e) {
        fail(`skill cast threw: ${key}/${skill.id}: ${e.message}`);
      }
    }
  }
  ok(`cast ${count} skills across ${Object.keys(SKILL_DATABASE).length} sources without throwing`);
}

// ---------------------------------------------------------------------------
// XP / LEVEL / STAT POINTS test (round 3)
// ---------------------------------------------------------------------------
console.log('\n[XP / Level / Stats test]');
{
  const fakeEngine = { player, onPlayerLevelUp: () => {} };
  const em = new EnemyManager(scene, explosions, fakeEngine);

  // Kill grants XP (world level 1 drone = base 60)
  const e = em._spawn('drone', new THREE.Vector3(5, 0, 5));
  e.takeDamage(999999, false, 'fruit');
  if (player.xp !== 60) fail(`kill should grant 60 XP (got ${player.xp})`);
  else ok('kill granted base XP (60) to player');

  // Enemy level scaling: +50% of base per level above 1 (level 3 = x2)
  const e2 = em._spawn('drone', new THREE.Vector3(8, 0, 8));
  e2.level = 3;
  if (e2.getXpReward() !== 120) fail(`enemy XP scaling wrong (got ${e2.getXpReward()}, want 120)`);
  else ok('enemy XP scales +50%/level above 1 (level 3 -> 120 XP)');

  // Bulk stat allocation (user can enter any value at once)
  player.statPoints = 10;
  if (!player.spendStatPoints('health', 5)) fail('spendStatPoints(health, 5) rejected');
  if (player.maxHp !== 1000 + 5 * 50) fail(`maxHp after stats wrong (got ${player.maxHp})`);
  if (player.spendStatPoints('gun', player.statPoints + 10)) fail('over-allocation should be rejected!');
  ok(`bulk stat allocation works (maxHp ${player.maxHp}, +50/point, over-alloc rejected)`);

  // Level cap at exactly 100,000,000 with no overflow
  player.level = 99999999;
  player.xp = 0;
  player.gainXp(player.xpNeeded());
  if (player.level !== 100000000) fail(`level cap broken (got ${player.level})`);
  else ok(`level caps at exactly ${player.level.toLocaleString('en-US')} with no overflow`);

  // World level rises every 15 kills
  em.worldLevel = 1;
  em.totalKills = 14;
  const e3 = em._spawn('drone', new THREE.Vector3(11, 0, 11));
  e3.takeDamage(999999, false, 'fruit');
  if (em.worldLevel !== 2) fail(`world level should rise at 15 kills (got ${em.worldLevel})`);
  else ok('world level rises every 15 kills (15th kill -> world level 2)');
}

// ---------------------------------------------------------------------------
// Simulated frame loop (1200 frames @ 60fps = 20s of game time)
// ---------------------------------------------------------------------------
console.log('\n[Frame simulation: 20s @ 60fps]');
{
  const dt = 1 / 60;
  let err = null;
  try {
    for (let i = 0; i < 1200; i++) {
      // player keys: walk forward a bit, jump once, dash twice
      player.keys['KeyW'] = i % 300 < 150;
      player.keys['Space'] = i === 60;
      player.keys['ShiftLeft'] = (i === 200 || i === 700);

      player.update(dt, camera);
      cam.update(dt, player.position);
      enemies.update(dt, player);
      lightning.update(dt);
      explosions.update(dt);
      weather.update(dt, enemies.enemies, player.position);
      arena.update(dt);

      // hazard lifecycle (same logic as GameEngine.animate)
      for (let j = fakeHazards.length - 1; j >= 0; j--) {
        const h = fakeHazards[j];
        h.elapsed += dt;
        if (h.elapsed >= h.duration) {
          scene.remove(h.mesh);
          scene.remove(h.coreMesh);
          scene.remove(h.light);
          h.mat.dispose();
          h.coreMat.dispose();
          fakeHazards.splice(j, 1);
        }
      }
    }
  } catch (e) {
    err = e;
  }
  if (err) fail(`frame loop threw: ${err.stack}`);
  else ok(`1200 frames simulated without errors (enemies: ${enemies.enemies.length}, scene children: ${scene.children.length})`);
}

setTimeout(() => {
  console.log('\n' + '='.repeat(50));
  if (failures === 0) {
    console.log('SMOKE TEST PASSED ✔');
    process.exit(0);
  } else {
    console.log(`SMOKE TEST FAILED ✘ (${failures} failures)`);
    process.exit(1);
  }
}, 14000);
