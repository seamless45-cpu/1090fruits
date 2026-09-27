import { formatFull } from '../utils.js';

/**
 * 3D 1090 Fruits - STAT POINTS ALLOCATION MODAL
 *
 * Four stat pools, each point worth +50:
 *   - VITALITY  -> +50 max health
 *   - FRUIT PWR -> +50 fruit skill damage
 *   - GUN PWR   -> +50 gun damage
 *   - BLADE PWR -> +50 sword / melee damage
 *
 * Bulk allocation: type ANY number of points into each row's input and hit
 * APPLY (or click MAX to dump everything into one stat). No one-by-one
 * clicking required.
 */

const STAT_DEFS = [
  { key: 'health', name: 'VITALITY', icon: '❤️', desc: '+50 max health per point', color: '#ff5566' },
  { key: 'fruit', name: 'FRUIT POWER', icon: '🌀', desc: '+50 fruit skill damage per point', color: '#b026ff' },
  { key: 'gun', name: 'GUN POWER', icon: '🔫', desc: '+50 gun damage per point', color: '#ffaa00' },
  { key: 'sword', name: 'BLADE POWER', icon: '⚔️', desc: '+50 sword / melee damage per point', color: '#00f0ff' },
];

export class StatsModal {
  constructor(game) {
    this.game = game;
    this.modal = document.getElementById('modal-stats');
    if (!this.modal) return;

    this.closeBtn = document.getElementById('btn-close-stats');
    this.pointsEl = document.getElementById('stats-available-points');

    this.rowEls = {};
    this.modal.querySelectorAll('.stat-row').forEach((row) => {
      const key = row.dataset.stat;
      this.rowEls[key] = {
        row,
        points: row.querySelector('.stat-points'),
        bonus: row.querySelector('.stat-bonus'),
        input: row.querySelector('.stat-input'),
        applyBtn: row.querySelector('.stat-apply-btn'),
        maxBtn: row.querySelector('.stat-max-btn'),
      };
    });

    // Bulk apply
    for (const key in this.rowEls) {
      const r = this.rowEls[key];
      r.applyBtn.addEventListener('click', () => this.applyStat(key, parseInt(r.input.value, 10) || 0));
      r.maxBtn.addEventListener('click', () => this.applyStat(key, this.game.player.statPoints));
      r.input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.applyStat(key, parseInt(r.input.value, 10) || 0);
      });
      // Only allow non-negative integers
      r.input.addEventListener('input', () => {
        const v = r.input.value.replace(/[^0-9]/g, '');
        if (v !== r.input.value) r.input.value = v;
      });
    }

    if (this.closeBtn) this.closeBtn.addEventListener('click', () => this.close());

    // Global toggle button
    document.getElementById('btn-stats')?.addEventListener('click', () => this.toggle());
  }

  toggle() {
    if (this.modal.style.display === 'flex') this.close();
    else this.open();
  }

  open() {
    if (!this.modal) return;
    this.refresh();
    this.modal.style.display = 'flex';
    this.game.sound.playUiOpen();
  }

  close() {
    if (!this.modal) return;
    this.modal.style.display = 'none';
    this.game.sound.playUiClose();
  }

  /** Commit a bulk allocation (any value the user typed). */
  applyStat(statKey, count) {
    const player = this.game.player;
    if (count <= 0) {
      this.game.sound.playUiDeny();
      return;
    }
    if (count > player.statPoints) {
      // Not enough points - shake the counter and deny
      this.game.sound.playUiDeny();
      if (this.pointsEl) {
        this.pointsEl.classList.remove('deny-flash');
        void this.pointsEl.offsetWidth;
        this.pointsEl.classList.add('deny-flash');
      }
      return;
    }
    if (player.spendStatPoints(statKey, count)) {
      this.game.sound.playEquip();
      this.refresh();
      this.game.updateLevelHUD();
    } else {
      this.game.sound.playUiDeny();
    }
  }

  /** Re-render all rows + available points. */
  refresh() {
    if (!this.modal) return;
    const player = this.game.player;
    if (this.pointsEl) {
      this.pointsEl.textContent = player.statPoints;
    }
    for (const def of STAT_DEFS) {
      const r = this.rowEls[def.key];
      if (!r) continue;
      const pts = player.stats[def.key] || 0;
      r.points.textContent = pts;
      r.bonus.textContent = `+${formatFull(pts * 50)}`;
      // Keep stale input from blocking: cap suggestion = available
      const cur = parseInt(r.input.value, 10);
      if (!isNaN(cur) && cur > player.statPoints) {
        r.input.value = player.statPoints;
      }
    }
  }
}
