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

// (DOM/window stubs extracted to test/dom-stub.mjs)
await import('./test/dom-stub.mjs');

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

// Round 7: GPU volumetric cloud - ONE Points object per cloud (draw-call cut)
{
  const c = weather.activeClouds[0];
  if (!c) throw new Error('no active cloud after spawn');
  if (!(c.points instanceof THREE.Points)) throw new Error('cloud is not a GPU Points object');
  if (c.group !== c.points) throw new Error('cloud group should be the single Points object');
  const posAttr = c.points.geometry.attributes;
  for (const a of ['position', 'aSeed', 'aH', 'aAng', 'aRad', 'aSize']) {
    if (!posAttr[a]) throw new Error(`cloud geometry missing attribute ${a}`);
  }
  // No billboard sprites remain in any cloud
  let spriteTotal = 0;
  for (const cl of weather.activeClouds) {
    (function walk(o) { if (o.isSprite) spriteTotal++; if (o.children) for (const ch of o.children) walk(ch); })(cl.points);
  }
  if (spriteTotal > 0) throw new Error(`clouds still use ${spriteTotal} sprite billboards`);
  ok(`GPU volumetric cloud: ${weather.activeClouds.length} clouds = ${weather.activeClouds.length} draw calls (0 sprite billboards)`);
}

// Rework v4: precipitation is GPU-simulated - drop motion lives in the
// vertex shader (uTime), so the CPU cost per shaft per frame is ~4 uniform
// writes and zero buffer uploads.
{
  const shaft = weather.createRainshaft(new THREE.Vector3(0, 0, 0), 100, 120, 400);
  if (!(shaft.drops instanceof THREE.Points)) throw new Error('rainshaft has no precipitation Points');
  if (!shaft.drops.geometry.attributes.position) throw new Error('precipitation seed buffer missing');
  if (!shaft.drops.geometry.attributes.aSpeed) throw new Error('GPU rain missing aSpeed attribute');
  if (!shaft.drops.geometry.attributes.aSeed) throw new Error('GPU rain missing aSeed attribute');
  if (!shaft.dropMat.uniforms || !shaft.dropMat.uniforms.uMap) throw new Error('precipitation shader has no streak texture');
  if (shaft.dropMat.uniforms.uMap.value.type !== 'Texture' && !(shaft.dropMat.uniforms.uMap.value.isTexture)) {
    throw new Error('uMap is not a texture');
  }
  // Advance simulated time and confirm the shader clock actually runs
  weather.update(1 / 60, enemies.enemies, new THREE.Vector3(0, 0, 0));
  const t0 = shaft.dropMat.uniforms.uTime.value;
  for (let i = 0; i < 30; i++) weather.update(1 / 60, enemies.enemies, new THREE.Vector3(0, 0, 0));
  const t1 = shaft.dropMat.uniforms.uTime.value;
  if (!(t1 > t0 + 0.4)) throw new Error(`GPU rain clock not advancing (${t0.toFixed(2)} -> ${t1.toFixed(2)})`);
  if (!(shaft.dropMat.opacity > 0)) throw new Error('precipitation fully transparent');
  ok(`GPU rain live: 400 shader-driven drops (sim clock ${t0.toFixed(2)} -> ${t1.toFixed(2)}s, streak texture bound, 0 buffer uploads)`);
  // Let the shaft expire to keep the scene tidy
  shaft.duration = 0.01;
  weather.update(1 / 60, enemies.enemies, new THREE.Vector3(0, 0, 0));
}

// ---------------------------------------------------------------------------
// REWORK: camera default pose must be BEHIND-TOP the player
// ---------------------------------------------------------------------------
console.log('\n[Camera rig spec test]');
{
  const cam2 = new THREE.PerspectiveCamera(62, 16 / 9, 0.2, 1200);
  const rig = new CameraController(cam2, null);
  const p = new THREE.Vector3(0, 0, 0); // player faces -Z at yaw 0
  rig.update(1 / 60, p);
  rig.update(1 / 60, p);
  rig.update(1 / 60, p);
  const horizontalBehind = cam2.position.z; // camera should sit at +Z (behind)
  const heightAbove = cam2.position.y;
  if (!(horizontalBehind > 8)) throw new Error(`camera not BEHIND the player (z=${horizontalBehind.toFixed(2)})`);
  if (!(heightAbove > 6)) throw new Error(`camera not ABOVE the player (y=${heightAbove.toFixed(2)})`);
  // Camera must look DOWN at the player (behind-top framing)
  const dir = new THREE.Vector3();
  cam2.getWorldDirection(dir);
  if (!(dir.y < -0.4)) throw new Error(`camera not looking down (dir.y=${dir.y.toFixed(2)})`);
  ok(`behind-top rig: cam at z=+${horizontalBehind.toFixed(1)}m, y=+${heightAbove.toFixed(1)}m, looking down ${(Math.asin(-dir.y) * 180 / Math.PI).toFixed(0)}°`);

  // Frame-rate independence: 30Hz and 60Hz updates must converge to the same
  // resting pose (exponential damping), unlike the old min(1, dt*k) lerps.
  // (auto-follow is disabled for the twins: it is deliberately a per-frame
  //  rate-limited game-feel layer, not part of the damping guarantee)
  const camA = new THREE.PerspectiveCamera(62, 16 / 9, 0.2, 1200);
  const camB = new THREE.PerspectiveCamera(62, 16 / 9, 0.2, 1200);
  const rigA = new CameraController(camA, null);
  const rigB = new CameraController(camB, null);
  rigA.autoFollow = false;
  rigB.autoFollow = false;
  const pFar = new THREE.Vector3(50, 0, -40);
  for (let i = 0; i < 60; i++) rigA.update(1 / 30, pFar); // 2 seconds @ 30fps
  for (let i = 0; i < 120; i++) rigB.update(1 / 60, pFar); // 2 seconds @ 60fps
  const drift = camA.position.distanceTo(camB.position);
  if (drift > 0.5) throw new Error(`30Hz vs 60Hz camera poses diverge by ${drift.toFixed(2)}m (framerate-dependent damping)`);
  ok(`framerate-independent damping: 30Hz vs 60Hz resting poses within ${drift.toFixed(3)}m`);

  // Auto-follow: after a sustained straight run, the rig yaw must settle back
  // BEHIND the motion direction (camera on the opposite side of the velocity).
  const camC = new THREE.PerspectiveCamera(62, 16 / 9, 0.2, 1200);
  const rigC = new CameraController(camC, null);
  const walker = new THREE.Vector3(0, 0, 0);
  for (let i = 0; i < 240; i++) { // 4s of running +Z at 16 m/s
    walker.z += 16 / 60;
    rigC.update(1 / 60, walker);
  }
  const camOffset = new THREE.Vector3().subVectors(camC.position, walker);
  // Moving +Z => camera must end up at -Z of the player (behind)
  if (!(camOffset.z < -6)) throw new Error(`auto-follow failed: cam offset z=${camOffset.z.toFixed(2)} (expected behind at -Z)`);
  ok(`auto-follow settled behind the run direction (offset z=${camOffset.z.toFixed(1)}m)`);
}

// ---------------------------------------------------------------------------
// REWORK: dash must cover EXACTLY the requested distance
// ---------------------------------------------------------------------------
console.log('\n[Dash accuracy test]');
{
  const p2 = new Player(scene, sound);
  p2.position.set(0, 0, 0);
  p2.group.rotation.y = 0; // faces -Z
  p2.triggerDash(12.0);
  for (let i = 0; i < 60; i++) p2.update(1 / 60, camera);
  const moved = -p2.position.z; // forward is -Z
  if (Math.abs(moved - 12.0) > 0.35) throw new Error(`dash covered ${moved.toFixed(2)}m, expected 12.0m`);
  ok(`dash distance exact: requested 12.0m, traveled ${moved.toFixed(2)}m`);

  // Speed-parameterized variant: (10m @ 240 m/s) must cover exactly 10m
  p2.position.set(0, 0, 0);
  p2.dashCooldown = 0;
  p2.triggerDash(10.0, 240.0);
  for (let i = 0; i < 60; i++) p2.update(1 / 60, camera);
  const moved2 = -p2.position.z;
  if (Math.abs(moved2 - 10.0) > 0.35) throw new Error(`skill dash covered ${moved2.toFixed(2)}m, expected 10.0m`);
  ok(`skill dash (10m @ 240 m/s) exact: traveled ${moved2.toFixed(2)}m`);
}

// Round 7: hail physics + shatter damage + expiry
{
  enemies.spawnDummy(new THREE.Vector3(120, 0, 120));
  const dummy = enemies.enemies[enemies.enemies.length - 1];
  const hp0 = dummy.hp;
  weather.spawnHailstorm(new THREE.Vector3(120, 0, 120), 30, 6);
  if (weather.activeHail.length !== 1) throw new Error('hail field not registered');
  for (let i = 0; i < 200; i++) {
    weather.update(1 / 60, enemies.enemies, new THREE.Vector3(120, 0, 120));
    enemies.update(1 / 60, player);
  }
  if (dummy.hp >= hp0) throw new Error(`hail dealt no damage (hp ${hp0} -> ${dummy.hp})`);
  // Hail must expire on its own
  for (let i = 0; i < 400; i++) weather.update(1 / 60, enemies.enemies, new THREE.Vector3(120, 0, 120));
  if (weather.activeHail.length !== 0) throw new Error(`hail never expired (${weather.activeHail.length})`);
  ok(`Hailstorm physics: dummy took ${Math.round(hp0 - dummy.hp)} damage, field expired`);
}

// Round 7: moving cloud cinematics (squall line, hurricane orbit, wall cloud)
{
  const origin = new THREE.Vector3(-200, 0, -200);
  const dir = new THREE.Vector3(1, 0, 0);
  const line = weather.spawnSquallLine(origin, dir, 4, 20, 90);
  const before = line[0].pos.x;
  for (let i = 0; i < 60; i++) weather.update(1 / 60, enemies.enemies, new THREE.Vector3(0, 0, 0));
  if (!(line[0].pos.x > before + 15)) throw new Error(`squall cell did not move (${before} -> ${line[0].pos.x})`);
  if (line[0].points.position.x !== line[0].pos.x) throw new Error('cloud points object did not follow cell pos');

  const hur = weather.spawnHurricane(new THREE.Vector3(300, 0, 300), 80, 20);
  const ang0 = hur.cells[0].orbit.angle;
  for (let i = 0; i < 60; i++) weather.update(1 / 60, enemies.enemies, new THREE.Vector3(0, 0, 0));
  if (Math.abs(hur.cells[0].orbit.angle - ang0) < 0.05) throw new Error('hurricane cells are not orbiting');

  const wall = weather.spawnWallCloud(new THREE.Vector3(0, 0, 250), 50, 8, 0.6);
  if (wall.altitude !== 75 || wall.flat !== 0.62) throw new Error('wall cloud shaping options not applied');
  ok(`Squall line + hurricane orbit + wall cloud all simulate (${line[0].pos.x.toFixed(0)}m drift, orbit Δ${(hur.cells[0].orbit.angle - ang0).toFixed(2)}rad)`);
}

// Round 7: storm level + ambience drive (sound is a no-op stub in Node)
{
  for (let i = 0; i < 300; i++) weather.update(1 / 60, enemies.enemies, new THREE.Vector3(0, 0, 0));
  const lvl = weather.getStormLevel();
  if (!(lvl > 0)) throw new Error('storm level never rose with active storm cells');
  if (typeof sound.setStormAmbience !== 'function') throw new Error('sound.setStormAmbience missing');
  sound.setStormAmbience(lvl); // must not throw with ctx === null
  ok(`Storm intensity driving ambience (level ${lvl.toFixed(2)})`);
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
