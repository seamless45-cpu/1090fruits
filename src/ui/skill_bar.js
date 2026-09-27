import { SKILL_DATABASE } from '../skills/skill_definitions.js';

/**
 * 3D 1090 Fruits - Compact Skill Bar Manager
 * 
 * SPECIFICATIONS:
 * 1. "compact skill bar with use button at left side"
 * 2. "cooldown effect is just 100 to 0 animation effect from entire bar"
 * 3. "the panel is at middle right"
 * 4. "CD timer must be the actual CD by seconds not 100 to 0 number" (e.g. 3.4s)
 * 5. "use button is on mobile and tablets while on PC, uses keyboard keys (Z X C V B F G N M L K J) instead of the button"
 * 6. "can be closable and the panel must be compact"
 * 7. "cannot add your own skills to empty keys. because its to match the numbers of skills rather than adding random skills on empty keys"
 */

const KEY_SEQUENCE = ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyF', 'KeyG', 'KeyN', 'KeyM', 'KeyL', 'KeyK', 'KeyJ'];
const KEY_LABELS = ['Z', 'X', 'C', 'V', 'B', 'F', 'G', 'N', 'M', 'L', 'K', 'J'];

export class SkillBarUI {
  constructor(game) {
    this.game = game;
    this.container = document.getElementById('skill-panel');
    this.listEl = document.getElementById('skill-list-container');
    this.sourceTagEl = document.getElementById('skill-source-tag');
    this.tabFruit = document.getElementById('tab-fruit-skills');
    this.tabSword = document.getElementById('tab-sword-skills');
    this.toggleBtn = document.getElementById('toggle-skill-panel');

    this.activeSource = 'fruit'; // 'fruit' or 'sword'
    this.cooldowns = new Map(); // skillId -> { current: 0, total: 0 }
    this.activeSkills = [];

    this.initEvents();
  }

  initEvents() {
    // Collapse / Expand toggle
    if (this.toggleBtn) {
      this.toggleBtn.addEventListener('click', () => {
        this.container.classList.toggle('collapsed');
      });
    }

    // Tabs
    if (this.tabFruit) {
      this.tabFruit.addEventListener('click', () => {
        this.setActiveSource('fruit');
      });
    }

    if (this.tabSword) {
      this.tabSword.addEventListener('click', () => {
        this.setActiveSource('sword');
      });
    }

    // Keyboard Keydown Listener for (Z X C V B F G N M L K J)
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

      const keyIdx = KEY_SEQUENCE.indexOf(e.code);
      if (keyIdx !== -1 && keyIdx < this.activeSkills.length) {
        this.tryCastSkill(this.activeSkills[keyIdx]);
      }

      // Tab key switches Fruit / Sword skill bar
      if (e.code === 'Tab') {
        e.preventDefault();
        this.toggleActiveSource();
      }
    });
  }

  toggleActiveSource() {
    this.setActiveSource(this.activeSource === 'fruit' ? 'sword' : 'fruit');
  }

  setActiveSource(source) {
    this.activeSource = source;
    if (this.tabFruit) this.tabFruit.classList.toggle('active', source === 'fruit');
    if (this.tabSword) this.tabSword.classList.toggle('active', source === 'sword');

    // Update bottom HUD active slot indicator
    const activeModeName = document.getElementById('active-mode-name');
    if (activeModeName) {
      activeModeName.textContent = `CAST: ${source.toUpperCase()}`;
    }

    this.refresh();
  }

  refresh() {
    this.listEl.innerHTML = '';

    const fruitId = this.game.equippedFruit;
    const swordId = this.game.equippedSword;

    let dataSource = null;
    let label = '';

    if (this.activeSource === 'fruit') {
      dataSource = SKILL_DATABASE[fruitId];
      label = dataSource ? dataSource.name : 'NO FRUIT EQUIPPED';
    } else {
      dataSource = SKILL_DATABASE[swordId];
      label = dataSource ? dataSource.name : 'NO SWORD EQUIPPED';
    }

    if (this.sourceTagEl) {
      this.sourceTagEl.textContent = label;
    }

    if (!dataSource || !dataSource.skills) {
      this.activeSkills = [];
      const emptyNotice = document.createElement('div');
      emptyNotice.style.padding = '12px';
      emptyNotice.style.color = '#7998b0';
      emptyNotice.style.fontSize = '11px';
      emptyNotice.style.textAlign = 'center';
      emptyNotice.textContent = 'NO WEAPON / FRUIT SKILLS EQUIPPED';
      this.listEl.appendChild(emptyNotice);
      return;
    }

    this.activeSkills = dataSource.skills;

    // Detect touch / mobile
    const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

    // Build skill items matching exact count
    this.activeSkills.forEach((skill, idx) => {
      const keyLabel = KEY_LABELS[idx] || '?';

      const row = document.createElement('div');
      row.className = 'skill-item-bar';
      row.id = `skill-bar-${skill.id}`;
      row.title = skill.desc;

      // 1. Cooldown Wipe Overlay Fill (100 to 0 animation effect from entire bar)
      const fill = document.createElement('div');
      fill.className = 'skill-cooldown-fill';
      fill.id = `cd-fill-${skill.id}`;
      row.appendChild(fill);

      // 2. Content Row
      const content = document.createElement('div');
      content.className = 'skill-content-row';

      // Left CTA: Key badge on PC, [USE] button on mobile/touch
      const leftCta = document.createElement('div');
      leftCta.className = 'skill-left-cta';

      if (isTouchDevice) {
        const useBtn = document.createElement('button');
        useBtn.className = 'skill-use-btn';
        useBtn.textContent = 'USE';
        useBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          this.tryCastSkill(skill);
        });
        leftCta.appendChild(useBtn);
      } else {
        const keyBadge = document.createElement('div');
        keyBadge.className = 'skill-key-badge';
        keyBadge.textContent = keyLabel;
        leftCta.appendChild(keyBadge);
      }
      content.appendChild(leftCta);

      // Info
      const info = document.createElement('div');
      info.className = 'skill-info';

      const title = document.createElement('span');
      title.className = 'skill-title-text';
      title.textContent = skill.name;

      const rangeTag = document.createElement('span');
      rangeTag.className = 'skill-range-tag';
      rangeTag.textContent = skill.range;

      info.appendChild(title);
      info.appendChild(rangeTag);
      content.appendChild(info);

      // Right: CD timer in seconds (e.g. 3.4s)
      const cdReadout = document.createElement('span');
      cdReadout.className = 'skill-cd-readout';
      cdReadout.id = `cd-readout-${skill.id}`;
      cdReadout.textContent = 'READY';
      content.appendChild(cdReadout);

      row.appendChild(content);

      // Clicking anywhere on row also casts skill
      row.addEventListener('click', () => {
        this.tryCastSkill(skill);
      });

      this.listEl.appendChild(row);
    });
  }

  tryCastSkill(skill) {
    const cd = this.cooldowns.get(skill.id);
    if (cd && cd.current > 0) {
      this.game.sound.playUiBeep(350);
      return; // On Cooldown
    }

    // Cooldown duration with Alarm Buffer buff reduction (-25%)
    let baseTime = skill.baseCd;
    if (this.game.player.buffs.alarmBuffer.active) {
      baseTime *= 0.75;
    }

    this.cooldowns.set(skill.id, { current: baseTime, total: baseTime });

    // Execute cast logic
    try {
      skill.cast(this.game.getSkillContext());
    } catch (err) {
      console.error(`Error casting skill ${skill.id}:`, err);
    }
  }

  update(dt) {
    this.cooldowns.forEach((cd, skillId) => {
      if (cd.current > 0) {
        cd.current = Math.max(0, cd.current - dt);

        // Update Cooldown 100% to 0% fill overlay
        const fillEl = document.getElementById(`cd-fill-${skillId}`);
        const cdReadout = document.getElementById(`cd-readout-${skillId}`);

        if (fillEl && cdReadout) {
          const pct = (cd.current / cd.total) * 100;
          fillEl.style.width = `${pct}%`;

          if (cd.current > 0) {
            cdReadout.textContent = `${cd.current.toFixed(1)}s`;
            cdReadout.classList.add('on-cd');
          } else {
            cdReadout.textContent = 'READY';
            cdReadout.classList.remove('on-cd');
            fillEl.style.width = '0%';
          }
        }
      }
    });
  }
}
