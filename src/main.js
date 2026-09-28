import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CameraController } from './camera.js';
import { sound } from './audio.js';
import { LightningManager } from './effects/lightning.js';
import { ExplosionManager } from './effects/explosions.js';
import { CloudWeatherManager, precomputeWeatherTextures } from './effects/clouds_weather.js';
import { Arena } from './arena.js';
import { Player } from './player.js';
import { EnemyManager } from './enemies.js';
import { SkillBarUI } from './ui/skill_bar.js';
import { InventoryUI } from './ui/inventory_ui.js';
import { SettingsModal } from './ui/settings_modal.js';
import { SupercellPickerModal } from './ui/supercell_picker.js';
import { StatsModal } from './ui/stats_modal.js';
import { formatNumber } from './utils.js';

// Pre-allocated scratch for the passive-gun hot path (fires up to 20x/s in
// buff states): all consumers copy/inspect the vectors immediately.
const _gunTarget = new THREE.Vector3();
const _gunWeapon = new THREE.Vector3();

/**
 * 3D 1090 Fruits - Core Game Engine
 *
 * RENDER PIPELINE:
 *  - ACES filmic tone mapping + sRGB output for a cinematic HDR look
 *  - EffectComposer with UnrealBloom for neon glow (toggleable in Graphics)
 *  - Cinematic arena environment (sky, stars, moon, dust, pylons)
 */
export class GameEngine {
  constructor() {
    this.container = document.getElementById('canvas-container');

    // 1. Three.js Scene, Camera, Renderer
    this.scene = new THREE.Scene();
    // Round 8: wide open atmosphere - lower base fog so the far storm is
    // readable; storms thicken it via arena.setStormLevel.
    this.scene.fog = new THREE.FogExp2(0x0a1420, 0.0011);
    this.scene.fog.densityBase = 0.0011;
    this.scene.fog.colorStorm = new THREE.Color(0x151b28);

    const aspect = window.innerWidth / window.innerHeight;
    // Round 8: cinematic wide FOV + long far plane for the big sky
    this.camera = new THREE.PerspectiveCamera(70, aspect, 0.2, 1800);
    window.__activeCamera = this.camera;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2.0));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Cinematic tone mapping (applied by OutputPass at the end of the composer)
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.container.appendChild(this.renderer.domElement);

    // 1b. Post-processing: neon bloom.
    // PERF: bloom runs at HALF resolution - it is a wide gaussian blur by
    // design, so halving the render targets cuts ~75% of the bloom chain's
    // GPU work with no visible quality loss.
    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(Math.floor(window.innerWidth / 2), Math.floor(window.innerHeight / 2)),
      1.15,   // strength
      0.55,   // radius
      0.72    // threshold
    );
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());
    this.bloomPass.enabled = true;

    // 2. Audio & Camera Controllers
    this.sound = sound;
    this.cameraController = new CameraController(this.camera, this.renderer.domElement);

    // 3. Effects Managers
    this.lightning = new LightningManager(this.scene);
    this.explosions = new ExplosionManager(this.scene, this.cameraController, this.sound);
    // Round 7: sound system feeds distance-delayed thunder + storm ambience
    this.weather = new CloudWeatherManager(this.scene, this.lightning, this.explosions, this.sound);

    // 4. Arena & World (renderer passed in for PMREM environment reflections)
    this.arena = new Arena(this.scene, this.renderer);

    // 5. Player & Combat Entities (engine passed for kill->XP flow)
    this.player = new Player(this.scene, this.sound);
    this.enemies = new EnemyManager(this.scene, this.explosions, this);

    // Visible tracer bolts for passive guns (pooled)
    this.tracerPool = [];
    const tracerGeo = new THREE.BoxGeometry(0.07, 0.07, 1);
    for (let i = 0; i < 8; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0,
        depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      });
      const mesh = new THREE.Mesh(tracerGeo, mat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.tracerPool.push({ mesh, mat, active: false, life: 0, duration: 0.13 });
    }

    // Active Equipment State (Strictly separated fruit & sword)
    // DEFAULT: everything starts UNEQUIPPED - the player chooses their loadout
    this.equippedFruit = 'none';
    this.equippedSword = 'none';

    // Active Floor Hazard Pits (Firepits, lava pits)
    this.activeHazards = [];

    // Gun Passive Cooldown timers
    this.gunFireCooldown = 0;

    // Raycaster for accurate meter distance & aiming
    this.raycaster = new THREE.Raycaster();
    this.mouseNDC = new THREE.Vector2(0, 0);
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._intersectPoint = new THREE.Vector3(); // per-frame raycast scratch

    // Telemetry & FPS
    this.clock = new THREE.Clock();
    this.frameCount = 0;
    this.fpsTimer = 0;
    this.currentFps = 60;

    // 6. UI Systems
    this.skillBar = new SkillBarUI(this);
    this.inventoryUI = new InventoryUI(this);
    this.settingsModal = new SettingsModal(this);
    this.supercellPicker = new SupercellPickerModal(this);
    this.statsModal = new StatsModal(this);

    this.initHudRefs();
    this.initLoadingScreen();
    this.initGlobalEvents();
    this.initUiSounds();
    this.skillBar.refresh();

    // Start Main Loop
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  initGlobalEvents() {
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.composer.setSize(window.innerWidth, window.innerHeight);
    });

    // Track mouse position for floor raycast
    window.addEventListener('mousemove', (e) => {
      this.mouseNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouseNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
    });

    // Left Click in 3D world executes M1 attack
    window.addEventListener('click', (e) => {
      if (e.target.closest('#hud button') ||
          e.target.closest('.sci-modal-card') ||
          e.target.closest('.skill-item-bar') ||
          e.target.closest('.inventory-slot') ||
          e.target.closest('.zoom-controls-overlay') ||
          e.target.closest('.spawner-panel-box')) {
        return;
      }
      this.handleM1Attack();
    });

    // Audio Mute Toggle Button
    const audioBtn = document.getElementById('btn-audio');
    if (audioBtn) {
      audioBtn.addEventListener('click', () => {
        const isUnmuted = this.sound.toggleMute();
        const icon = document.getElementById('audio-icon');
        const text = document.getElementById('audio-text');
        if (icon) icon.textContent = isUnmuted ? '🔊' : '🔇';
        if (text) text.textContent = isUnmuted ? 'SFX ON' : 'SFX MUTED';
      });
    }

    // Help Modal
    const helpBtn = document.getElementById('btn-help');
    const helpModal = document.getElementById('modal-help');
    const closeHelp = document.getElementById('btn-close-help');
    if (helpBtn && helpModal) {
      helpBtn.addEventListener('click', () => {
        helpModal.style.display = 'flex';
        this.sound.playUiOpen();
      });
    }
    if (closeHelp && helpModal) {
      closeHelp.addEventListener('click', () => {
        helpModal.style.display = 'none';
        this.sound.playUiClose();
      });
    }

    // Spawner Floating Panel Toggle
    const spawnerBtn = document.getElementById('btn-spawner');
    const spawnerPanel = document.getElementById('spawner-panel');
    const closeSpawner = document.getElementById('close-spawner');

    if (spawnerBtn && spawnerPanel) {
      spawnerBtn.addEventListener('click', () => {
        spawnerPanel.style.display = spawnerPanel.style.display === 'none' ? 'flex' : 'none';
      });
    }

    if (closeSpawner && spawnerPanel) {
      closeSpawner.addEventListener('click', () => {
        spawnerPanel.style.display = 'none';
      });
    }

    // Spawner Actions
    document.getElementById('spawn-dummy')?.addEventListener('click', () => {
      this.enemies.spawnDummy(this.player.position.clone().add(new THREE.Vector3(0, 0, 15)));
      this.sound.playUiBeep(900);
    });

    document.getElementById('spawn-drones')?.addEventListener('click', () => {
      this.enemies.spawnDronePack(5, 35);
      this.sound.playUiBeep(900);
    });

    document.getElementById('spawn-elites')?.addEventListener('click', () => {
      this.enemies.spawnElite(this.player.position.clone().add(new THREE.Vector3(-25, 0, 25)));
      this.enemies.spawnElite(this.player.position.clone().add(new THREE.Vector3(25, 0, 25)));
      this.sound.playUiBeep(900);
    });

    document.getElementById('spawn-boss')?.addEventListener('click', () => {
      this.enemies.spawnBoss(this.player.position.clone().add(new THREE.Vector3(0, 0, 60)));
      this.sound.playExplosion(1.0);
    });

    document.getElementById('clear-enemies')?.addEventListener('click', () => {
      this.enemies.clearAll();
      this.sound.playUiBeep(500);
    });

    const autoRespawnCheck = document.getElementById('auto-respawn-toggle');
    if (autoRespawnCheck) {
      autoRespawnCheck.addEventListener('change', (e) => {
        this.enemies.autoRespawn = e.target.checked;
      });
    }

    // Mobile Action buttons
    document.getElementById('btn-mobile-m1')?.addEventListener('click', () => {
      this.handleM1Attack();
    });

    document.getElementById('btn-mobile-gun')?.addEventListener('click', () => {
      this.firePassiveGunManual();
    });

    document.getElementById('btn-mobile-dash')?.addEventListener('click', () => {
      this.player.triggerDash();
    });
  }

  setResolutionScale(scale) {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio * scale, 2.5));
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio * scale, 2.5));
  }

  equipFruit(fruitId) {
    this.equippedFruit = fruitId;
    this.player.updateFruitAura(fruitId);
    this.skillBar.refresh();
    this.inventoryUI.updateHUD();

    // Mobile gun button toggle
    const mobGunBtn = document.getElementById('btn-mobile-gun');
    if (mobGunBtn) {
      mobGunBtn.style.display = (fruitId === 'rimefracture' || fruitId === 'wildfire') ? 'flex' : 'none';
    }
  }

  equipSword(swordId) {
    this.equippedSword = swordId;
    this.player.updateWeaponVisuals(swordId);
    this.skillBar.refresh();
    this.inventoryUI.updateHUD();
  }

  openSupercellPicker() {
    this.supercellPicker.open();
  }

  // ---------------------------------------------------------------
  // HUD REF CACHE: per-frame DOM lookups cost a full-document scan
  // each time; cache every element touched inside the frame loop once.
  // ---------------------------------------------------------------
  initHudRefs() {
    const id = (k) => document.getElementById(k);
    this.hud = {
      targetDist: id('target-distance'),
      reticleRange: id('reticle-range'),
      hpBar: id('player-hp-bar'),
      hpGhost: id('player-hp-ghost'),
      hpText: id('player-hp-text'),
      xpBar: id('player-xp-bar'),
      xpText: id('player-xp-text'),
      hudLevel: id('hud-level'),
      hudWorld: id('hud-world-level'),
      hudPoints: id('hud-stat-points'),
      statsBadge: id('stats-badge-hint'),
      specialRow: id('special-bar-row'),
      specialLabel: id('special-bar-label'),
      specialBar: id('player-special-bar'),
      specialText: id('player-special-text'),
      buffs: id('buffs-container'),
    };
  }

  // ---------------------------------------------------------------
  // LOADING SCREEN: cinematic entry with PLAY + SETTINGS
  // ---------------------------------------------------------------
  initLoadingScreen() {
    this.inGame = false;
    this._bootDone = false;
    this._bootFastForward = false;
    this._bootAutoDeploy = false;
    const loading = document.getElementById('loading-screen');
    const playBtn = document.getElementById('btn-loading-play');
    const settingsBtn = document.getElementById('btn-loading-settings');

    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => {
        this.sound.playUiClick();
        this.settingsModal.open();
      });
    }

    const deploy = () => {
      if (this.inGame) return;
      this.inGame = true;
      this.sound.init(); // ensure audio unlocked on this gesture
      this.sound.playGameStart();

      // Reveal the world: fade out the loader, animate the HUD in
      document.body.classList.remove('pre-game');
      document.body.classList.add('in-game');
      if (loading) {
        loading.classList.add('loading-exit');
        setTimeout(() => { loading.style.display = 'none'; }, 900);
      }
      // Big cinematic deploy banner
      this.showSkillBanner('DEPLOYED', '#00f0ff');
    };

    if (playBtn) {
      playBtn.addEventListener('click', () => {
        if (this.inGame) return;
        if (!this._bootDone) {
          // First press fast-forwards the boot sequence and auto-deploys
          this._bootFastForward = true;
          this._bootAutoDeploy = true;
          this.sound.playUiClick();
          return;
        }
        deploy();
      });
    }

    this.runBootSequence(deploy);
  }

  // ---------------------------------------------------------------
  // BOOT SEQUENCE: typed console lines interleaved with real
  // pre-work ("pre-methods": textures pre-computed, shaders
  // pre-compiled) so the first gameplay frames are allocation-free.
  // ---------------------------------------------------------------
  async runBootSequence(deploy) {
    const linesEl = document.getElementById('loading-console-lines');
    const fillEl = document.getElementById('loading-progress-fill');
    const pctEl = document.getElementById('loading-progress-pct');
    const playBtn = document.getElementById('btn-loading-play');
    if (!playBtn) return;

    const steps = [
      { label: 'SYSTEM BOOT // 1090-FRUITS OPERATIVE PROTOCOL v3.0' },
      { label: 'GPU LINK // WEBGL2 CONTEXT + PMREM ENV', work: () => this.renderer && this.renderer.render(this.scene, this.camera) },
      {
        label: 'PRE-COMPUTING CLOUD FIELD TEXTURES (FBM x4)',
        work: () => {
          const t0 = performance.now();
          precomputeWeatherTextures();
          return ` ${Math.max(1, Math.round(performance.now() - t0))}ms`;
        },
      },
      {
        label: 'PRE-COMPILING SHADER PROGRAMS (async)',
        work: () => {
          if (this.renderer && typeof this.renderer.compileAsync === 'function') {
            Promise.resolve(this.renderer.compileAsync(this.scene, this.camera)).catch(() => {});
          }
        },
      },
      {
        label: 'VFX ARMORY PRE-WARM // ALL FRUIT EFFECTS',
        work: () => {
          // Synchronously warm every pooled VFX program (debris instancing,
          // rings, domes, arc webs, crack webs, fire columns, siren domes,
          // cloud puffs, vortices, beams) so the first cast never hitches.
          if (this.explosions && this.explosions.preflight) {
            const n = this.explosions.preflight(this.renderer, this.camera);
            return ` ${n} EFFECTS`;
          }
        },
      },
      {
        label: 'VOLUMETRIC CLOUD ENGINE // GPU COMPILE',
        work: () => {
          // Pre-compile the GPU soft-particle cloud shader so the first
          // storm cell never hitches on a shader compile.
          if (this.weather && this.weather.preflight) {
            const n = this.weather.preflight(this.renderer, this.camera);
            return ` CLOUD PROGRAMS`;
          }
        },
      },
      { label: 'WEATHER CORE // TORNADO · MICROBURST · TSUNAMI' },
      { label: 'LIGHTNING FIELD // BRANCHED STRIKE ENGINE' },
      { label: 'WEAPON BAY // 48 SKILLS + INVENTORY' },
      { label: 'AUDIO SYNTH // UI + FX VOICES ARMED' },
      { label: 'ALL SYSTEMS NOMINAL' },
    ];

    const wait = (ms) => new Promise((res) => setTimeout(res, this._bootFastForward ? 0 : ms));
    let stepCount = 0;
    const setProgress = (n) => {
      const pct = Math.round((n / steps.length) * 100);
      if (fillEl) fillEl.style.width = pct + '%';
      if (pctEl) pctEl.textContent = pct + '%';
    };

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const line = document.createElement('div');
      line.className = 'boot-line';
      if (linesEl) linesEl.appendChild(line);
      // Keep only the last 7 lines visible
      if (linesEl && linesEl.children.length > 7) linesEl.removeChild(linesEl.children[0]);

      for (const ch of step.label) {
        if (line) line.textContent += ch;
        await wait(this._bootFastForward ? 0 : 7);
      }
      let tag = 'OK';
      if (step.work) {
        try { tag = (step.work() || 'OK').trim() || 'OK'; } catch (err) { tag = 'WARN'; console.warn('[boot]', err); }
      }
      if (line) {
        line.textContent = step.label;
        const span = document.createElement('span');
        span.className = 'boot-tag';
        span.textContent = '  [' + tag + ']';
        line.appendChild(span);
        line.classList.add('boot-line-ok');
      }
      stepCount++;
      setProgress(stepCount);
      await wait(this._bootFastForward ? 0 : 140);
    }

    this._bootDone = true;
    playBtn.disabled = false;
    playBtn.textContent = '▶ PLAY';
    playBtn.classList.add('boot-ready');
    if (this.sound.playUiBeep) {
      this.sound.playUiBeep(660);
      setTimeout(() => this.sound.playUiBeep(990), 130);
    }

    if (this._bootAutoDeploy) {
      await wait(120);
      deploy();
    }
  }

  // ---------------------------------------------------------------
  // UI SOUNDS: global click / hover delegation for every button
  // ---------------------------------------------------------------
  initUiSounds() {
    let lastHover = 0;
    document.addEventListener('pointerover', (e) => {
      const btn = e.target.closest && e.target.closest('button');
      if (!btn) return;
      const now = performance.now();
      if (now - lastHover < 70) return; // throttle rapid hovers
      lastHover = now;
      this.sound.playUiHover();
    }, true);

    document.addEventListener('click', (e) => {
      const btn = e.target.closest && e.target.closest('button');
      if (btn) this.sound.playUiClick();
    }, true);
  }

  // ---------------------------------------------------------------
  // LEVEL-UP: banner + sound + flash when the operative levels up
  // ---------------------------------------------------------------
  onPlayerLevelUp(levelsGained, newLevel) {
    this.sound.playLevelUp();
    this.triggerScreenFlash('#ffd75e', 0.5);
    const banner = document.getElementById('level-up-banner');
    if (banner) {
      const sub = document.getElementById('level-up-sub');
      if (sub) sub.textContent = `+${levelsGained * 3} STAT POINTS`;
      banner.classList.remove('show');
      // force reflow so the animation restarts
      void banner.offsetWidth;
      banner.classList.add('show');
    }
    this.updateLevelHUD();
  }

  /**
   * Show a big cinematic anime-style skill name banner.
   */
  showSkillBanner(text, colorHex = '#00f0ff') {
    const banner = document.getElementById('skill-banner');
    if (!banner) return;
    banner.textContent = text;
    banner.style.setProperty('--banner-color', colorHex);
    banner.classList.remove('show');
    void banner.offsetWidth;
    banner.classList.add('show');
  }

  /**
   * Update Level / XP / Stat-Points HUD card.
   */
  updateLevelHUD() {
    const p = this.player;
    const h = this.hud;

    if (h.hudLevel) {
      const label = `LVL ${formatNumber(p.level)}`;
      if (h.hudLevel.textContent !== label) {
        h.hudLevel.textContent = label;
        // 3D flip when the level actually changes
        h.hudLevel.classList.remove('badge-flip');
        void h.hudLevel.offsetWidth;
        h.hudLevel.classList.add('badge-flip');
      }
    }
    if (h.xpBar && h.xpText) {
      const need = p.xpNeeded();
      const pct = need > 0 ? Math.min(100, (p.xp / need) * 100) : 100;
      h.xpBar.style.width = `${pct}%`;
      const xpLabel = `${formatNumber(p.xp)} / ${formatNumber(need)} XP`;
      if (h.xpText.textContent !== xpLabel) h.xpText.textContent = xpLabel;
    }
    if (h.hudPoints) {
      const ptsLabel = `${p.statPoints} PTS`;
      if (h.hudPoints.textContent !== ptsLabel) h.hudPoints.textContent = ptsLabel;
      h.hudPoints.classList.toggle('stat-points-ready', p.statPoints > 0);
    }
    // STATS button corner badge
    if (h.statsBadge) {
      h.statsBadge.textContent = p.statPoints;
      h.statsBadge.style.display = p.statPoints > 0 ? 'flex' : 'none';
    }
    if (h.hudWorld) {
      const wLabel = `WORLD ${this.enemies.worldLevel}`;
      if (h.hudWorld.textContent !== wLabel) h.hudWorld.textContent = wLabel;
    }

    // Low-HP screen pulse
    document.body.classList.toggle('low-hp', p.hp > 0 && (p.hp / p.maxHp) < 0.25);
  }

  triggerScreenFlash(colorHex = '#ff0033', durationSec = 0.5) {
    const flash = document.getElementById('screen-flash');
    if (!flash) return;
    flash.style.backgroundColor = colorHex;
    flash.style.opacity = '0.7';

    setTimeout(() => {
      flash.style.opacity = '0';
    }, durationSec * 1000);
  }

  spawnFirepit(centerPos, radius = 25.0, duration = 10.0, tickPct = 0.03) {
    // Layered firepit: hot core + flickering outer glow + rising ember column
    const coreGeo = new THREE.CircleGeometry(radius * 0.75, 32);
    coreGeo.rotateX(-Math.PI / 2);
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xff7722, transparent: true, opacity: 0.7,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
    const core = new THREE.Mesh(coreGeo, coreMat);
    core.position.copy(centerPos);
    core.position.y = 0.12;
    this.scene.add(core);

    const geo = new THREE.RingGeometry(radius * 0.78, radius, 40);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff3300, transparent: true, opacity: 0.5,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
    const disc = new THREE.Mesh(geo, mat);
    disc.position.copy(centerPos);
    disc.position.y = 0.14;
    this.scene.add(disc);

    // Dynamic light for the pit
    const light = new THREE.PointLight(0xff5511, 1.8, radius * 2.2, 1.9);
    light.position.copy(centerPos);
    light.position.y = 3;
    this.scene.add(light);

    this.activeHazards.push({
      mesh: disc,
      coreMesh: core,
      coreMat,
      light,
      center: centerPos.clone(),
      radius,
      duration,
      elapsed: 0,
      tickPct,
      tickTimer: 0,
      mat
    });
  }

  /**
   * Fire a visible tracer bolt from the weapon to a target point.
   */
  fireTracer(from, to, colorHex) {
    const t = this.tracerPool.find(x => !x.active) || this.tracerPool[0];
    t.active = true;
    t.life = 0;
    t.mesh.visible = true;

    t.mesh.position.copy(from).add(to).multiplyScalar(0.5);
    t.mesh.lookAt(to);
    const len = from.distanceTo(to);
    t.mesh.scale.set(1, 1, Math.max(0.5, len));

    t.mat.color.setHex(colorHex);
    t.mat.opacity = 0.85;
  }

  /**
   * M1 Melee Attack logic for equipped weapons
   */
  handleM1Attack() {
    if (!this.inGame) return; // ignore clicks behind the loading screen
    const didSwing = this.player.performM1();
    if (!didSwing) return;

    const sword = this.equippedSword;
    const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.player.group.rotation.y);
    const hitCenter = this.player.position.clone().addScaledVector(forward, 3.5);

    // Charge gravity blade upon attack
    if (sword === 'gravity_blade') {
      this.player.gravityBladeCharge = Math.min(100, this.player.gravityBladeCharge + 10);

      // SPECIFICATION: Every 4 slashes can spawn 6-24 lightning bolts in area near sword
      if (this.player.comboStep === 0) {
        const boltCount = 6 + Math.floor(Math.random() * 19); // 6 - 24 bolts
        for (let b = 0; b < boltCount; b++) {
          const bPos = hitCenter.clone().add(new THREE.Vector3((Math.random() - 0.5) * 12, 0, (Math.random() - 0.5) * 12));
          this.lightning.strikeBolt(bPos, 40, '#cc44ff', 0.2, 16);
        }
        this.explosions.createExplosion(hitCenter, 10.0, 'lightning', 1.8);
      }
    } else if (sword === 'pole') {
      // SPECIFICATION: Combo 4 strikes small lightning bolt
      if (this.player.comboStep === 0) {
        this.lightning.strikeBolt(hitCenter, 45, '#ffea00', 0.25, 16);
        this.explosions.createExplosion(hitCenter, 5.0, 'lightning', 1.2);
      }
    } else if (sword === 'alarm_sword') {
      // SPECIFICATION: Every 3 hits from M1 fires 6 red beams to imprison 4 random enemies for 3s
      if (this.player.comboStep === 2) {
        const enemies = this.enemies.enemies.slice(0, 4);
        for (const e of enemies) {
          e.applyStatus('imprison', 3.0);
          this.lightning.strikeBolt(e.mesh.position, 50, '#ff0044', 0.2, 16);
        }
      }
    }

    // Hit enemies in front (bare-fist strikes when no sword equipped)
    const bareFist = (sword === 'none');
    const hitEnemies = this.enemies.getEnemiesInRadius(hitCenter, 5.0);
    for (const e of hitEnemies) {
      const dmg = (bareFist ? 250 : 350) + this.player.comboStep * 80;
      e.takeDamage(dmg, this.player.comboStep === 3, 'sword');
      e.applyKnockback(forward, 12.0);
    }
  }

  /**
   * Manual Gun Fire for Rimefracture / Wildfire passives
   */
  firePassiveGunManual() {
    if (!this.inGame) return; // ignore keypresses behind the loading screen
    if (this.gunFireCooldown > 0) return;

    const fruit = this.equippedFruit;
    if (fruit !== 'rimefracture' && fruit !== 'wildfire') {
      this.sound.playUiBeep(300);
      return;
    }

    // Auto-aim target: closest enemy within 150m or mouse cursor
    const closest = this.enemies.findClosestEnemy(this.player.position, 150);
    const targetPos = _gunTarget.copy(closest.enemy ? closest.enemy.mesh.position : this.player.aimTarget);
    targetPos.y += 1.2;

    // Visible muzzle flash + tracer bolt (the gun "feels" like it fires)
    const beamColor = fruit === 'rimefracture' ? 0x9ff4ff : 0xffaa44;
    const weaponPos = _gunWeapon.copy(this.player.position);
    weaponPos.y = 1.55;
    // Front of the operative (local -Z rotated by body yaw)
    weaponPos.x -= Math.sin(this.player.group.rotation.y) * 0.5;
    weaponPos.z -= Math.cos(this.player.group.rotation.y) * 0.5;
    this.fireTracer(weaponPos, targetPos, beamColor);
    this.explosions.flashAt(weaponPos, beamColor, 1.0, 0.1);
    this.lightning.flash(weaponPos, fruit === 'rimefracture' ? '#9ff4ff' : '#ffaa44', 0.35, 0.12);

    if (fruit === 'rimefracture') {
      // SPECIFICATION:
      // - Manual fire, CD 0.05s (reduced by 77% in Ice Bombard).
      // - 45% chance to fire icicle bullet dealing 7500% damage (+7,800,000% in Ice Bombard).
      // - Strikes giant ice ball exploding at 40m radius into flying fragments (120 m/s).
      const inState = this.player.buffs.iceBombard.active;
      this.gunFireCooldown = inState ? (0.05 * 0.23) : 0.05;

      this.sound.playLaser(1.6);

      const isIcicleCrit = Math.random() < 0.45;
      let dmg = 200;

      if (isIcicleCrit) {
        dmg = inState ? (200 * 78000) : (200 * 75);
        this.explosions.createExplosion(targetPos, 40.0, 'ice', 2.5);

        // Explode into flying fragments
        const enemies = this.enemies.getEnemiesInRadius(targetPos, 40.0);
        for (const e of enemies) {
          e.takeDamage(dmg, true, 'gun');
          if (inState) e.applyStatus('freeze', 3.0);
        }
      } else {
        if (closest.enemy) closest.enemy.takeDamage(dmg, false, 'gun');
      }
    } else if (fruit === 'wildfire') {
      // SPECIFICATION:
      // - Manual fire, CD 0.1s (reduced by 78% in Hell Fury).
      // - 35% chance to fire fireball bullet dealing 15000% damage (+1,250,000% in Hell Fury).
      // - Giant fiery ball exploding at 45m radius into 30-60 flying fragments (150 m/s) with orange lightning.
      // - Enemies < 50% HP take 1000% more damage and fireball AoE 300% bigger.
      const inState = this.player.buffs.hellFury.active;
      this.gunFireCooldown = inState ? (0.1 * 0.22) : 0.1;

      this.sound.playExplosion(0.6);

      const isFireCrit = Math.random() < 0.35;
      let dmg = 300;

      if (isFireCrit) {
        dmg = inState ? (300 * 12500) : (300 * 150);
        const radius = 45.0;

        this.explosions.createExplosion(targetPos, radius, 'fire', 2.8);
        this.lightning.strikeBolt(targetPos, 80, '#ff5500', 0.25, 20);

        const enemies = this.enemies.getEnemiesInRadius(targetPos, radius);
        for (const e of enemies) {
          const under50 = e.hp < (e.maxHp * 0.5);
          const finalDmg = under50 ? (dmg * 10.0) : dmg;
          e.takeDamage(finalDmg, true, 'gun');
          e.applyStatus('burn', 3.0);
        }
      } else {
        if (closest.enemy) closest.enemy.takeDamage(dmg, false, 'gun');
      }
    }
  }

  getSkillContext() {
    return {
      scene: this.scene,
      camera: this.camera,
      cameraController: this.cameraController,
      player: this.player,
      enemies: this.enemies,
      lightning: this.lightning,
      explosions: this.explosions,
      weather: this.weather,
      sound: this.sound,
      triggerScreenFlash: this.triggerScreenFlash.bind(this),
      spawnFirepit: this.spawnFirepit.bind(this),
      openSupercellPicker: this.openSupercellPicker.bind(this)
    };
  }

  updateHUDValues(dt = 1 / 60) {
    // Level / XP / Stat Points / World Level
    this.updateLevelHUD();

    // Player HP Bar + damage-lag ghost bar (eases down behind real HP)
    const h = this.hud;
    if (h.hpBar && h.hpText) {
      const pct = (this.player.hp / this.player.maxHp) * 100;
      h.hpBar.style.width = `${pct}%`;
      const hpLabel = `${Math.round(this.player.hp)} / ${this.player.maxHp}`;
      if (h.hpText.textContent !== hpLabel) h.hpText.textContent = hpLabel;
    }
    if (h.hpGhost) {
      if (this._hpGhostPct === undefined) this._hpGhostPct = 100;
      const target = (this.player.hp / this.player.maxHp) * 100;
      if (target >= this._hpGhostPct) {
        this._hpGhostPct = target; // heals snap up instantly
      } else {
        const now = performance.now();
        if (this._hpGhostTimer === undefined) this._hpGhostTimer = now;
        if (now - this._hpGhostTimer > 280) {
          // drain the lag at ~13%/s after a short grace period
          this._hpGhostPct = Math.max(target, this._hpGhostPct - 13 * dt);
          if (this._hpGhostPct - target < 0.4) this._hpGhostTimer = now;
        }
      }
      h.hpGhost.style.width = `${this._hpGhostPct}%`;
    }

    // Special Boost / Charge Bar (cached refs, label written only on change)
    if (h.specialRow) {
      if (this.equippedSword === 'gravity_blade') {
        if (h.specialRow.style.display !== 'flex') h.specialRow.style.display = 'flex';
        if (h.specialLabel) this._setLabel(h.specialLabel, 'BLADE');
        if (h.specialBar) h.specialBar.style.width = `${this.player.gravityBladeCharge}%`;
        if (h.specialText) h.specialText.textContent = `${this.player.gravityBladeCharge}%`;
      } else if (this.player.buffs.iceBombard.active) {
        if (h.specialRow.style.display !== 'flex') h.specialRow.style.display = 'flex';
        if (h.specialLabel) this._setLabel(h.specialLabel, 'ICE BOMB');
        if (h.specialBar) h.specialBar.style.width = `${(this.player.buffs.iceBombard.timer / 15.0) * 100}%`;
        if (h.specialText) h.specialText.textContent = `${this.player.buffs.iceBombard.timer.toFixed(1)}s`;
      } else if (this.player.buffs.hellFury.active) {
        if (h.specialRow.style.display !== 'flex') h.specialRow.style.display = 'flex';
        if (h.specialLabel) this._setLabel(h.specialLabel, 'HELL FURY');
        if (h.specialBar) h.specialBar.style.width = `${(this.player.buffs.hellFury.timer / 10.0) * 100}%`;
        if (h.specialText) h.specialText.textContent = `${this.player.buffs.hellFury.timer.toFixed(1)}s`;
      } else if (h.specialRow.style.display !== 'none') {
        h.specialRow.style.display = 'none';
      }
    }

    // Buffs list chips: chips are REUSED (keyed by buff name) and only
    // rewritten when their visible text actually changes (10Hz throttle).
    if (h.buffs) {
      this._buffTimer = (this._buffTimer || 0) - dt;
      if (this._buffTimer <= 0) {
        this._buffTimer = 0.1;
        if (!this._buffChips) this._buffChips = new Map();
        const seen = new Set();
        for (const k in this.player.buffs) {
          const b = this.player.buffs[k];
          if (!b.active) {
            const old = this._buffChips.get(k);
            if (old) {
              old.parentElement && old.parentElement.removeChild(old);
              this._buffChips.delete(k);
            }
            continue;
          }
          seen.add(k);
          let chip = this._buffChips.get(k);
          if (!chip) {
            chip = document.createElement('span');
            chip.className = 'buff-chip';
            h.buffs.appendChild(chip);
            this._buffChips.set(k, chip);
          }
          const label = `${k.toUpperCase()} [${b.timer.toFixed(1)}s]`;
          if (chip.textContent !== label) chip.textContent = label;
        }
      }
    }
  }

  _setLabel(el, label) {
    if (el.textContent !== label) el.textContent = label;
  }

  // =================================================================
  // ADAPTIVE QUALITY GOVERNOR (Round 7)
  // "Performance issues still persist" => a runtime governor that steps
  // render cost up and down to hold frame time. It watches the render
  // stage of each frame (EMA-smoothed) and, on a slow 1.2s cadence,
  // moves through quality tiers:
  //     T0  full      : max pixel ratio, 1024 shadow, bloom on
  //     T1  high      : pixel ratio * 0.8
  //     T2  medium    : pixel ratio * 0.62, 512 shadow
  //     T3  low       : pixel ratio * 0.5,  512 shadow, bloom off
  // It eases back up when headroom returns, so a good GPU stays at T0.
  // =================================================================
  _qgApply(tier) {
    if (tier === this._qgTier) return;
    this._qgTier = tier;
    const basePR = Math.min(window.devicePixelRatio, 2.0);
    const prFactor = [1.0, 0.8, 0.62, 0.5][tier];
    const pr = Math.max(0.75, basePR * prFactor);
    this.renderer.setPixelRatio(pr);
    this.composer.setPixelRatio(pr);
    // Match the window-resize handler exactly
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setSize(window.innerWidth, window.innerHeight);

    // Shadows: never touch them at the top two tiers (the user's explicit
    // settings-modal choice stands); under load, clamp to 512. Respect OFF.
    const userShadow = this.arena.userShadowSize || 1024;
    const shadowSize = this.arena.dirLight.castShadow
      ? Math.min(userShadow, tier >= 2 ? 512 : userShadow)
      : 0;
    const dl = this.arena.dirLight;
    if (dl && dl.shadow && shadowSize > 0) {
      if (dl.shadow.mapSize.x !== shadowSize) {
        dl.shadow.mapSize.set(shadowSize, shadowSize);
        if (dl.shadow.map) { dl.shadow.map.dispose(); dl.shadow.map = null; }
      }
    }
    // Bloom is the priciest pass; kill it only on the lowest tier - and
    // only the governor may switch it back on (the user's toggle stands).
    if (tier >= 3 && this.bloomPass.enabled) {
      this._qgBloomWasOn = true;
      this.bloomPass.enabled = false;
    } else if (tier < 3 && this._qgBloomWasOn) {
      this._qgBloomWasOn = false;
      this.bloomPass.enabled = true;
    }
    this._qgLog = `T${tier} · ${pr.toFixed(2)}x · shadow ${shadowSize} · bloom ${this.bloomPass.enabled ? 'on' : 'off'}`;
  }

  _qgUpdate(renderMs, dt) {
    if (!this._qgTier) this._qgTier = 0;
    // Exponential moving average of render time
    this._qgEma = this._qgEma != null ? this._qgEma * 0.9 + renderMs * 0.1 : renderMs;
    this._qgTimer = (this._qgTimer || 0) + dt;
    if (this._qgTimer < 1.2) return;
    this._qgTimer = 0;
    if (this._qgEma > 22 && this._qgTier < 3) this._qgApply(this._qgTier + 1);
    else if (this._qgEma < 12 && this._qgTier > 0) this._qgApply(this._qgTier - 1);
  }

  animate() {
    requestAnimationFrame(this.animate);

    const dt = Math.min(0.1, this.clock.getDelta());
    const startTime = performance.now();

    // 1. Calculate Mouse Raycast onto Ground Floor & Aim Target
    // (pre-allocated intersection scratch - setAimTarget copies it)
    this.raycaster.setFromCamera(this.mouseNDC, this.camera);
    if (this.raycaster.ray.intersectPlane(this.groundPlane, this._intersectPoint)) {
      const intersectPoint = this._intersectPoint;
      this.player.setAimTarget(intersectPoint);

      // Distance to target in meters (cached refs, throttled to 10Hz
      // so text writes don't churn every frame)
      const distMeters = this.player.position.distanceTo(intersectPoint);
      if (!this._hudDistTimer || this._hudDistTimer <= 0) {
        this._hudDistTimer = 0.1;
        const d = distMeters.toFixed(1);
        if (this.hud.targetDist) this.hud.targetDist.textContent = `${d} M`;
        if (this.hud.reticleRange) this.hud.reticleRange.textContent = `RANGE: ${d} M`;
      } else {
        this._hudDistTimer -= dt;
      }
    }

    // 2. Gun cooldown tick
    if (this.gunFireCooldown > 0) {
      this.gunFireCooldown -= dt;
    }

    // 3. Update Player & Camera
    this.player.update(dt, this.camera);
    this.cameraController.update(dt, this.player.position);

    // 4. Update Enemies
    this.enemies.update(dt, this.player);

    // 5. Update Effects
    this.lightning.update(dt);
    this.explosions.update(dt);
    this.weather.update(dt, this.enemies.enemies, this.player.position);

    // 5a. Round 7: storms visibly dim the sky + thicken fog (smoothed in weather)
    this.arena.setStormLevel(this.weather.getStormLevel());

    // 5b. Animated environment (sky, core, pylons, dust, rings)
    this.arena.update(dt, this.camera);

    // 5c. Whole-sky lightning illumination (driven by active strikes)
    this.arena.setSkyFlash(this.lightning.flashLevel);

    // 5d. Visible tracer bolts
    for (const t of this.tracerPool) {
      if (!t.active) continue;
      t.life += dt;
      if (t.life >= t.duration) {
        t.active = false;
        t.mesh.visible = false;
        continue;
      }
      t.mat.opacity = (1.0 - t.life / t.duration) * 0.85;
    }

    // 6. Update Active Floor Hazards (Firepits / Lava pits)
    for (let i = this.activeHazards.length - 1; i >= 0; i--) {
      const h = this.activeHazards[i];
      h.elapsed += dt;
      h.tickTimer += dt;

      if (h.elapsed >= h.duration) {
        this.scene.remove(h.mesh);
        this.scene.remove(h.coreMesh);
        this.scene.remove(h.light);
        h.mat.dispose();
        h.coreMat.dispose();
        this.activeHazards.splice(i, 1);
        continue;
      }

      // Flicker the firepit glow
      const flicker = 0.75 + 0.25 * Math.sin(h.elapsed * 11 + h.center.x);
      h.mat.opacity = 0.5 * flicker * Math.min(1, (h.duration - h.elapsed) * 2);
      h.coreMat.opacity = 0.7 * flicker * Math.min(1, (h.duration - h.elapsed) * 2);
      h.light.intensity = 1.8 * flicker * Math.min(1, (h.duration - h.elapsed));

      // Continuous rising embers from the pit
      h.emberTimer = (h.emberTimer || 0) + dt;
      if (h.emberTimer > 0.55) {
        h.emberTimer = 0;
        const ep = h.center.clone();
        ep.x += (Math.random() - 0.5) * h.radius * 0.6;
        ep.z += (Math.random() - 0.5) * h.radius * 0.6;
        ep.y = 0.3;
        this.explosions.sparkBurst(ep, 0xff7733, 3.5);
      }

      // Tick damage to enemies inside hazard
      if (h.tickTimer >= 0.5) {
        h.tickTimer = 0;
        const enemies = this.enemies.getEnemiesInRadius(h.center, h.radius);
        for (const e of enemies) {
          e.takeDamage(e.maxHp * h.tickPct, false);
          e.applyStatus('burn', 3.0);
        }
      }
    }

    // 7. Update UI
    this.skillBar.update(dt);
    this.updateHUDValues(dt);

    // 8. Render Scene (through the bloom composer)
    this.composer.render();

    const renderMs = performance.now() - startTime;

    // Round 7: adaptive quality governor keeps frame time in budget
    this._qgUpdate(renderMs, dt);

    // Telemetry & FPS Stats
    this.frameCount++;
    this.fpsTimer += dt;
    if (this.fpsTimer >= 0.5) {
      this.currentFps = (this.frameCount / this.fpsTimer);
      this.frameCount = 0;
      this.fpsTimer = 0;

      const debrisCount = this.explosions.getActiveDebrisCount();
      const lightningCount = this.lightning.getActiveCount();
      this.settingsModal.updateStats(this.currentFps, renderMs, debrisCount, debrisCount * 2, lightningCount,
        this._qgTier > 0 ? ` · Q-${this._qgTier}` : '');
    }
  }
}

// Start Game on DOMContentLoaded
window.addEventListener('DOMContentLoaded', () => {
  new GameEngine();
});
