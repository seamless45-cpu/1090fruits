/**
 * 3D 1090 Fruits - Advanced Graphics Settings Manager
 * Provides fine-grained control over rendering resolution, dynamic shadows,
 * particle density, 0.01s lightning segment refresh, physics debris, and post-processing.
 */

export class SettingsModal {
  constructor(game) {
    this.game = game;

    this.modal = document.getElementById('modal-settings');
    this.openBtn = document.getElementById('btn-settings');
    this.closeBtn = document.getElementById('btn-close-settings');
    this.applyBtn = document.getElementById('btn-apply-settings');

    // Form inputs
    this.resScaleInput = document.getElementById('opt-res-scale');
    this.valResScale = document.getElementById('val-res-scale');

    this.shadowSelect = document.getElementById('opt-shadow-quality');
    this.particleSelect = document.getElementById('opt-particle-density');
    this.lightningFastCheckbox = document.getElementById('opt-lightning-fast');

    this.debrisSlider = document.getElementById('opt-debris-count');
    this.valDebrisCount = document.getElementById('val-debris-count');

    this.fluidSelect = document.getElementById('opt-fluid-quality');

    this.shakeSlider = document.getElementById('opt-shake-scale');
    this.valShakeScale = document.getElementById('val-shake-scale');

    this.bloomCheckbox = document.getElementById('opt-bloom-toggle');
    this.bloomSlider = document.getElementById('opt-bloom-intensity');
    this.valBloom = document.getElementById('val-bloom');

    this.viewDistSlider = document.getElementById('opt-view-dist');
    this.valViewDist = document.getElementById('val-view-dist');

    this.cameraFollowCheckbox = document.getElementById('opt-camera-follow');

    // Preset buttons
    this.presetBtns = document.querySelectorAll('.preset-btn');

    this.initEvents();
  }

  open() {
    if (this.modal) {
      this.modal.style.display = 'flex';
      this.game.sound.playUiOpen();
    }
    // Reflect live camera state in the form
    if (this.cameraFollowCheckbox && this.game.cameraController) {
      this.cameraFollowCheckbox.checked = this.game.cameraController.autoFollow !== false;
    }
  }

  close() {
    if (this.modal) {
      this.modal.style.display = 'none';
      this.game.sound.playUiClose();
    }
  }

  initEvents() {
    if (this.openBtn) {
      this.openBtn.addEventListener('click', () => this.open());
    }

    if (this.closeBtn) {
      this.closeBtn.addEventListener('click', () => this.close());
    }

    if (this.applyBtn) {
      this.applyBtn.addEventListener('click', () => {
        this.applySettings();
        this.close();
        this.game.sound.playUiBeep(1000);
      });
    }

    // Modal backdrop click
    if (this.modal) {
      this.modal.addEventListener('click', (e) => {
        if (e.target === this.modal) this.close();
      });
    }

    // Sliders live text
    if (this.resScaleInput) {
      this.resScaleInput.addEventListener('input', (e) => {
        this.valResScale.textContent = `${Math.round(e.target.value * 100)}%`;
      });
    }

    if (this.debrisSlider) {
      this.debrisSlider.addEventListener('input', (e) => {
        this.valDebrisCount.textContent = `${e.target.value} PIECES / EXPLOSION`;
      });
    }

    if (this.shakeSlider) {
      this.shakeSlider.addEventListener('input', (e) => {
        this.valShakeScale.textContent = `${Math.round(e.target.value * 100)}%`;
      });
    }

    if (this.viewDistSlider) {
      this.viewDistSlider.addEventListener('input', (e) => {
        this.valViewDist.textContent = `${e.target.value} METERS`;
      });
    }

    if (this.bloomSlider) {
      this.bloomSlider.addEventListener('input', (e) => {
        const v = parseFloat(e.target.value);
        this.valBloom.textContent = `ON (INTENSITY: ${v.toFixed(1)})`;
        // Live preview
        if (this.game.bloomPass) {
          this.game.bloomPass.strength = v;
        }
      });
    }

    // Preset handlers
    this.presetBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this.presetBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.applyPreset(btn.dataset.preset);
      });
    });
  }

  applyPreset(preset) {
    if (preset === 'low') {
      this.resScaleInput.value = 0.75;
      this.valResScale.textContent = '75%';
      this.shadowSelect.value = 'off';
      this.particleSelect.value = 'low';
      this.debrisSlider.value = 15;
      this.valDebrisCount.textContent = '15 PIECES / EXPLOSION';
      this.fluidSelect.value = 'low';
      this.viewDistSlider.value = 400;
      this.valViewDist.textContent = '400 METERS';
      this.bloomCheckbox.checked = false;
      if (this.bloomSlider) { this.bloomSlider.value = 0.6; this.valBloom.textContent = 'OFF (INTENSITY: 0.0)'; }
    } else if (preset === 'medium') {
      this.resScaleInput.value = 1.0;
      this.valResScale.textContent = '100%';
      this.shadowSelect.value = 'low';
      this.particleSelect.value = 'medium';
      this.debrisSlider.value = 25;
      this.valDebrisCount.textContent = '25 PIECES / EXPLOSION';
      this.fluidSelect.value = 'high';
      this.viewDistSlider.value = 600;
      this.valViewDist.textContent = '600 METERS';
      this.bloomCheckbox.checked = true;
      if (this.bloomSlider) { this.bloomSlider.value = 0.9; this.valBloom.textContent = 'ON (INTENSITY: 0.9)'; }
    } else if (preset === 'high') {
      this.resScaleInput.value = 1.0;
      this.valResScale.textContent = '100%';
      this.shadowSelect.value = 'high';
      this.particleSelect.value = 'high';
      this.debrisSlider.value = 35;
      this.valDebrisCount.textContent = '35 PIECES / EXPLOSION';
      this.fluidSelect.value = 'high';
      this.viewDistSlider.value = 800;
      this.valViewDist.textContent = '800 METERS';
      this.bloomCheckbox.checked = true;
      if (this.bloomSlider) { this.bloomSlider.value = 1.15; this.valBloom.textContent = 'ON (INTENSITY: 1.15)'; }
    } else if (preset === 'ultra') {
      this.resScaleInput.value = 1.25;
      this.valResScale.textContent = '125%';
      this.shadowSelect.value = 'ultra';
      this.particleSelect.value = 'ultra';
      this.debrisSlider.value = 55;
      this.valDebrisCount.textContent = '55 PIECES / EXPLOSION';
      this.fluidSelect.value = 'ultra';
      this.viewDistSlider.value = 1200;
      this.valViewDist.textContent = '1200 METERS';
      this.bloomCheckbox.checked = true;
      if (this.bloomSlider) { this.bloomSlider.value = 1.4; this.valBloom.textContent = 'ON (INTENSITY: 1.4)'; }
    }
  }

  applySettings() {
    // 1. Resolution scale
    const scale = parseFloat(this.resScaleInput.value);
    this.game.setResolutionScale(scale);

    // 2. Shadows
    this.game.arena.setShadowQuality(this.shadowSelect.value);

    // 3. Lightning rapid rate (0.01s spec)
    const isRapid = this.lightningFastCheckbox.checked;
    this.game.lightning.setRapidRate(isRapid ? 0.01 : 0.03);

    // 4. Debris count
    const debrisCount = parseInt(this.debrisSlider.value, 10);
    this.game.explosions.setDebrisCount(debrisCount);

    // 5. Shake scale
    const shakeScale = parseFloat(this.shakeSlider.value);
    this.game.cameraController.shakeScale = shakeScale;

    // 6. Camera far plane
    const viewDist = parseFloat(this.viewDistSlider.value);
    this.game.camera.far = viewDist;
    this.game.camera.updateProjectionMatrix();

    // 6b. Camera auto-follow (behind-top rig behavior)
    if (this.cameraFollowCheckbox && this.game.cameraController) {
      this.game.cameraController.autoFollow = this.cameraFollowCheckbox.checked;
    }

    // 7. Bloom post-processing (neon glow)
    if (this.game.bloomPass) {
      const bloomOn = this.bloomCheckbox.checked;
      this.game.bloomPass.enabled = bloomOn;
      if (this.bloomSlider) {
        this.game.bloomPass.strength = parseFloat(this.bloomSlider.value);
      }
    }
  }

  updateStats(fps, renderMs, debrisCount, particlesCount, lightningCount, qgSuffix = '') {
    const fpsEl = document.getElementById('fps-stat');
    const msEl = document.getElementById('ms-stat');
    const debEl = document.getElementById('debris-stat');
    const partEl = document.getElementById('particles-stat');
    const lgtEl = document.getElementById('lightning-stat');

    if (fpsEl) fpsEl.textContent = Math.round(fps);
    if (msEl) msEl.textContent = `${renderMs.toFixed(1)} ms${qgSuffix}`;
    if (debEl) debEl.textContent = debrisCount;
    if (partEl) partEl.textContent = particlesCount;
    if (lgtEl) lgtEl.textContent = lightningCount;
  }
}
