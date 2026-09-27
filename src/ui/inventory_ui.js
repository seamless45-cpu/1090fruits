import { SKILL_DATABASE } from '../skills/skill_definitions.js';

/**
 * 3D 1090 Fruits - Inventory & Equipment UI
 * 
 * SPECIFICATIONS:
 * "*NOTE: THE SWORD AND FRUIT MUST BE SEPARATED RATHER THAN INTEGRATED. 
 *  MUST HAVE AN INVENTORY SLOT FOR EQUIPPING OR UNEQUIPPING FRUIT OR SWORD. 
 *  STYLE IS A SQUARE HORIZONTAL SLOT BOTTOM DOWN.*"
 */

export class InventoryUI {
  constructor(game) {
    this.game = game;

    // Fruit modal elements
    this.fruitModal = document.getElementById('modal-fruits');
    this.fruitGrid = document.getElementById('fruit-equip-grid');
    this.closeFruitModalBtn = document.getElementById('btn-close-fruits');

    // Sword modal elements
    this.swordModal = document.getElementById('modal-swords');
    this.swordGrid = document.getElementById('sword-equip-grid');
    this.closeSwordModalBtn = document.getElementById('btn-close-swords');

    // Bottom horizontal slots
    this.slotFruit = document.getElementById('slot-fruit');
    this.slotSword = document.getElementById('slot-sword');
    this.slotGun = document.getElementById('slot-gun');
    this.slotSwitchActive = document.getElementById('slot-switch-active');

    // HUD tags
    this.invFruitName = document.getElementById('inv-fruit-name');
    this.invFruitType = document.getElementById('inv-fruit-type');
    this.invSwordName = document.getElementById('inv-sword-name');
    this.invSwordType = document.getElementById('inv-sword-type');
    this.fruitGlyph = document.getElementById('fruit-glyph');
    this.swordGlyph = document.getElementById('sword-glyph');
    this.hudFruitName = document.getElementById('hud-fruit-name');

    this.initEvents();
    this.populateModals();
    this.updateHUD();
  }

  initEvents() {
    // Open Fruit Modal
    if (this.slotFruit) {
      this.slotFruit.addEventListener('click', () => {
        this.openFruitModal();
      });
    }

    if (this.closeFruitModalBtn) {
      this.closeFruitModalBtn.addEventListener('click', () => this.closeFruitModal());
    }

    // Open Sword Modal
    if (this.slotSword) {
      this.slotSword.addEventListener('click', () => {
        this.openSwordModal();
      });
    }

    if (this.closeSwordModalBtn) {
      this.closeSwordModalBtn.addEventListener('click', () => this.closeSwordModal());
    }

    // Active Switch Slot (Fruit / Sword active cast focus)
    if (this.slotSwitchActive) {
      this.slotSwitchActive.addEventListener('click', () => {
        this.game.skillBar.toggleActiveSource();
      });
    }

    // Manual Gun Fire Button (Slot 3 & Key R)
    const btnFireGun = document.getElementById('btn-fire-gun-manual');
    if (btnFireGun) {
      btnFireGun.addEventListener('click', (e) => {
        e.stopPropagation();
        this.game.firePassiveGunManual();
      });
    }

    // Key R fires gun manually
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      if (e.code === 'KeyR') {
        this.game.firePassiveGunManual();
      }
      // Keys 1, 2, 3 quick select
      if (e.code === 'Digit1') {
        this.openFruitModal();
      } else if (e.code === 'Digit2') {
        this.openSwordModal();
      } else if (e.code === 'Digit3') {
        this.game.firePassiveGunManual();
      }
    });

    // Close on backdrop click
    [this.fruitModal, this.swordModal].forEach(modal => {
      if (!modal) return;
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.style.display = 'none';
          this.game.sound.playUiClose();
        }
      });
    });
  }

  openFruitModal() {
    this.fruitModal.style.display = 'flex';
    this.game.sound.playUiOpen();
  }

  closeFruitModal() {
    this.fruitModal.style.display = 'none';
    this.game.sound.playUiClose();
  }

  openSwordModal() {
    this.swordModal.style.display = 'flex';
    this.game.sound.playUiOpen();
  }

  closeSwordModal() {
    this.swordModal.style.display = 'none';
    this.game.sound.playUiClose();
  }

  populateModals() {
    // 1. Populate Fruit Grid
    const fruits = [
      { id: 'gravity', name: 'GRAVITY FRUIT', glyph: '🌌', desc: 'Control gravitational forces, asteroids, pressure singularities and heavy purple lightning.' },
      { id: 'lightning', name: 'LIGHTNING FRUIT', glyph: '⚡', desc: 'Unleash lightning beasts, continuous storms, and the catastrophic thunder ball.' },
      { id: 'quake', name: 'QUAKE FRUIT', glyph: '🌋', desc: 'Tectonic fractures, spatial shockwaves, neon blue ground cracks and colossal tsunamis.' },
      { id: 'alarm', name: 'ALARM FRUIT', glyph: '🚨', desc: 'Laser alert cages, blaring sirens, stat amplification and amber alert hackers.' },
      { id: 'rimefracture', name: 'RIMEFRACTURE FRUIT', glyph: '❄️', desc: 'Precision ice auto-aim cannon, falling icicles, and supersonic 5000m blizzard stomp.' },
      { id: 'wildfire', name: 'WILDFIRE FRUIT', glyph: '🔥', desc: 'Precision fireball cannon, 150 fireball spray, lava pits, and orange lightning.' },
      { id: 'cloud', name: 'CLOUD FRUIT', glyph: '☁️', desc: 'Dynamic growing clouds, supercells, tornadoes, squall lines, microbursts, and 25km hurricanes.' },
      { id: 'none', name: 'UNEQUIP FRUIT', glyph: '🚫', desc: 'Unequip fruit to wield pure melee or martial weapons.' }
    ];

    this.fruitGrid.innerHTML = '';
    fruits.forEach(f => {
      const card = document.createElement('div');
      card.className = `equip-card ${this.game.equippedFruit === f.id ? 'active-equipped' : ''}`;
      card.innerHTML = `
        <div class="equip-card-glyph">${f.glyph}</div>
        <div class="equip-card-title">${f.name}</div>
        <div class="equip-card-desc">${f.desc}</div>
        <button class="sci-btn btn-sm btn-primary" style="margin-top: 6px;">EQUIP</button>
      `;

      card.addEventListener('click', () => {
        this.game.sound.playEquip();
        this.game.equipFruit(f.id);
        this.closeFruitModal();
        this.populateModals();
        this.updateHUD();
      });

      this.fruitGrid.appendChild(card);
    });

    // 2. Populate Sword Grid
    const swords = [
      { id: 'gravity_blade', name: 'GRAVITY BLADE', glyph: '🗡️', desc: 'Charge-powered lightning blade, rainy meteors, 26 rising rocks, and 23 auto-aim slashes.' },
      { id: 'pole', name: 'POLE (STAFF)', glyph: '🥢', desc: 'Gold electrified staff with combo lightning, cloud bursts, and continuous enemy suction.' },
      { id: 'bisento', name: 'BISENTO', glyph: '⚔️', desc: 'Heavy halberd, ground quake slam, 5 diagonal quake orbs, and 23 mini tsunamis.' },
      { id: 'alarm_sword', name: 'ALARM SWORD', glyph: '🗡️', desc: 'High-tech red beam imprisonment combos and massive 50m red stomp shockwaves.' },
      { id: 'none', name: 'FISTS (UNEQUIP)', glyph: '👊', desc: 'Unequip sword for bare fist combat.' }
    ];

    this.swordGrid.innerHTML = '';
    swords.forEach(s => {
      const card = document.createElement('div');
      card.className = `equip-card ${this.game.equippedSword === s.id ? 'active-equipped' : ''}`;
      card.innerHTML = `
        <div class="equip-card-glyph">${s.glyph}</div>
        <div class="equip-card-title">${s.name}</div>
        <div class="equip-card-desc">${s.desc}</div>
        <button class="sci-btn btn-sm btn-primary" style="margin-top: 6px;">EQUIP</button>
      `;

      card.addEventListener('click', () => {
        this.game.sound.playEquip();
        this.game.equipSword(s.id);
        this.closeSwordModal();
        this.populateModals();
        this.updateHUD();
      });

      this.swordGrid.appendChild(card);
    });
  }

  updateHUD() {
    const fId = this.game.equippedFruit;
    const fData = SKILL_DATABASE[fId];

    if (fData) {
      if (this.invFruitName) this.invFruitName.textContent = fData.name.replace(' FRUIT', '');
      if (this.invFruitType) this.invFruitType.textContent = `${fData.skills.length} SKILLS`;
      if (this.fruitGlyph) this.fruitGlyph.textContent = fData.glyph;
      if (this.hudFruitName) this.hudFruitName.textContent = fData.name.replace(' FRUIT', '');
    } else {
      if (this.invFruitName) this.invFruitName.textContent = 'NONE';
      if (this.invFruitType) this.invFruitType.textContent = 'EMPTY';
      if (this.fruitGlyph) this.fruitGlyph.textContent = '🚫';
      if (this.hudFruitName) this.hudFruitName.textContent = 'NO FRUIT';
    }

    const sId = this.game.equippedSword;
    const sData = SKILL_DATABASE[sId];

    if (sData) {
      if (this.invSwordName) this.invSwordName.textContent = sData.name;
      if (this.invSwordType) this.invSwordType.textContent = `${sData.skills.length} SKILLS + M1`;
      if (this.swordGlyph) this.swordGlyph.textContent = sData.glyph;
    } else {
      if (this.invSwordName) this.invSwordName.textContent = 'FISTS';
      if (this.invSwordType) this.invSwordType.textContent = 'BARE HANDS';
      if (this.swordGlyph) this.swordGlyph.textContent = '👊';
    }

    // Gun slot visibility / highlight
    const hasGunPassive = (fId === 'rimefracture' || fId === 'wildfire');
    if (this.slotGun) {
      this.slotGun.style.opacity = hasGunPassive ? '1.0' : '0.4';
      const gunName = document.getElementById('inv-gun-name');
      const gunSub = document.getElementById('inv-gun-status');
      if (gunName && gunSub) {
        if (fId === 'rimefracture') {
          gunName.textContent = 'ICE CANNON';
          gunSub.textContent = '45% 75x CRIT + BALL';
        } else if (fId === 'wildfire') {
          gunName.textContent = 'HELLFIRE BLASTER';
          gunSub.textContent = '35% 150x CRIT + LAVA';
        } else {
          gunName.textContent = 'GUN HOLSTERED';
          gunSub.textContent = 'REQUIRES RIME/WILD';
        }
      }
    }
  }
}
