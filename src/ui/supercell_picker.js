import * as THREE from 'three';

/**
 * 3D 1090 Fruits - Supercell Spawner Modal UI (Cloud Skill 9)
 *
 * Allows player to choose a type of supercell:
 * 1. LP (Low Precipitation) Supercell (lowest precip, lowest damage, 2.5x faster cooldown, 300m size)
 * 2. Normal Supercell (500m size)
 * 3. HP (High Precipitation) Supercell (highest precip, highest damage, 2.5x slower cooldown, 700m size)
 */

export class SupercellPickerModal {
  constructor(game) {
    this.game = game;
    this.modal = document.getElementById('modal-supercell');
    this.closeBtn = document.getElementById('btn-close-supercell');

    this.lpCard = document.getElementById('select-supercell-lp');
    this.normCard = document.getElementById('select-supercell-normal');
    this.hpCard = document.getElementById('select-supercell-hp');

    this.initEvents();
  }

  initEvents() {
    if (this.closeBtn) {
      this.closeBtn.addEventListener('click', () => {
        this.close();
      });
    }

    if (this.modal) {
      this.modal.addEventListener('click', (e) => {
        if (e.target === this.modal) this.close();
      });
    }

    if (this.lpCard) {
      this.lpCard.addEventListener('click', () => {
        this.spawnSupercell('lp', 300, 2.0);
      });
    }

    if (this.normCard) {
      this.normCard.addEventListener('click', () => {
        this.spawnSupercell('normal', 500, 5.0);
      });
    }

    if (this.hpCard) {
      this.hpCard.addEventListener('click', () => {
        this.spawnSupercell('hp', 700, 12.5);
      });
    }
  }

  open() {
    this.modal.style.display = 'flex';
  }

  close() {
    this.modal.style.display = 'none';
  }

  spawnSupercell(type, size, customCd) {
    this.close();
    this.game.sound.playLightning(1.2, 0.8);

    const pos = this.game.player.aimTarget.clone();
    pos.y = 0;

    // Spawn supercell cloud - instantly mature (full size + supercell shader params)
    const cloud = this.game.weather.spawnGrowingCloud(pos, true, size);
    cloud.growthDone = true;
    cloud.groupScale = 2.6;
    cloud._applyScale();
    cloud.setStage('supercell');

    // Rainshaft volume
    this.game.weather.createRainshaft(pos, size * 0.7, 180, type === 'hp' ? 900 : (type === 'lp' ? 250 : 500));

    // Tornado for Normal and HP
    if (type !== 'lp') {
      this.game.weather.createTornado(pos.clone().add(new THREE.Vector3(20, 0, 20)), 10, 180, 220, 12.0);
    }

    this.game.cameraController.addShake(pos, type === 'hp' ? 5.0 : (type === 'lp' ? 1.5 : 3.0), 3.0);
  }
}
