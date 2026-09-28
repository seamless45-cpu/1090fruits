import * as THREE from 'three';

/**
 * 3D 1090 Fruits - Cinematic Third-Person Camera (REWORK v4)
 *
 * DESIGN: the rig parks BEHIND and ABOVE the operative ("behind-top"):
 *   - default elevation 0.62 rad (~35.5°) looking down at the arena
 *   - default range 14 m, so the hero reads in the lower third of frame
 *   - focus point leads the player's motion (velocity look-ahead)
 *   - gentle auto-follow keeps the camera behind the movement direction
 *
 * ACCURACY:
 *   - ALL smoothing is frame-rate independent: exponential decay
 *     `1 - exp(-k*dt)` (identical convergence at 30, 60, 144 fps),
 *     never the framerate-dependent `min(1, dt*k)` lerp.
 *
 * SPECIFICATIONS (unchanged):
 * 1. Camera Zooming: accurate 3.0m - 300.0m range (matches the UI slider).
 * 2. Zoom compatibility: PC (wheel, keys), Mobile (pinch, slider),
 *    Console (gamepad), Laptop (trackpad), TV (UI buttons).
 * 3. Camera Shake Effect:
 *    - STRICTLY AXIAL: high-frequency random positional offsets ONLY on the
 *      X, Y and Z axes. The camera's orientation (pitch / yaw / roll) is
 *      FROZEN for the duration of each shaken frame - it is computed once
 *      from the un-shaken base pose and is never modified by the shake.
 *    - Implementation guarantee: camera.position = basePos + axialOffset
 *      camera.quaternion  = baseQuaternion (unchanged by shake)
 *      -> zero rotational shake, zero aiming drift, by construction.
 *    - Closer explosion -> stronger positional displacement; farther -> weaker.
 */

// Absolute ceiling for a single shake source (meters). Keeps cataclysmic skills
// (intensity 60+) playable while still feeling violent.
const SHAKE_HARD_CAP = 9.0;

// Frame-rate independent smoothing rates (1/s). Higher = snappier.
const FOLLOW_RATE = 9.5;    // focus point chase
const ZOOM_RATE = 7.5;      // distance dolly
const ROT_RATE = 13.0;      // pitch / yaw orbit
const LOOKAHEAD_MAX = 2.6;  // meters of lead in the movement direction
const LOOKAHEAD_RATE = 3.2; // look-ahead ease speed

export class CameraController {
  constructor(camera, domElement) {
    this.camera = camera;
    this.domElement = domElement;

    // ----- Zoom (accurate metric range, matches the HUD slider 3-300) -----
    this.minZoom = 3.0;
    this.maxZoom = 300.0;
    // BEHIND-TOP default: 14 m back, ~35° elevation => camera sits above and
    // behind the operative's shoulders looking down into the arena.
    this.targetZoom = 14.0;
    this.currentZoom = 14.0;

    // ----- Orbit angles -----
    this.targetPitch = 0.62;  // behind-top elevation (radians)
    this.currentPitch = 0.62;
    this.minPitch = -0.25;
    this.maxPitch = 1.45;     // ~83° (near top-down)

    this.targetYaw = 0.0;     // 0 => camera due behind the player (player faces -Z)
    this.currentYaw = 0.0;

    // ----- Auto-follow: ease yaw so the rig stays behind the motion -----
    this.autoFollow = true;
    this._manualOrbitTimer = 0;     // grace after manual orbiting
    this._followYawRate = 1.15;     // rad/s cap (~66°/s, cinematic drift)

    // ----- Tracking target (player position) -----
    this.targetPosition = new THREE.Vector3(0, 1.5, 0);
    this.smoothedTarget = new THREE.Vector3(0, 1.5, 0);
    this._lastTargetPos = new THREE.Vector3(0, 1.5, 0);

    // Velocity look-ahead state (derived purely from target motion)
    this._lookAhead = new THREE.Vector3();
    this._smoothedVel = new THREE.Vector3();

    // Mouse / Touch interaction state
    this.isRightMouseDown = false;
    this.isLeftMouseDown = false;
    this.lastPointerX = 0;
    this.lastPointerY = 0;
    this.touchPinchStartDist = 0;
    this.isPinching = false;

    // Camera Shake System (STRICTLY AXIAL: translation on X / Y / Z only)
    this.shakeList = [];
    this.shakeScale = 1.0; // Configurable from graphics settings

    // Stored base pose for rigid axial shake application
    this.baseCameraPos = new THREE.Vector3();
    this.baseQuaternion = new THREE.Quaternion();

    // Reusable temp vectors (zero per-frame allocation)
    this._localOffset = new THREE.Vector3();
    this._worldOffset = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._focus = new THREE.Vector3();
    this._moveDelta = new THREE.Vector3();

    // Bind event listeners
    this.initEventListeners();
  }

  initEventListeners() {
    // 1. PC / Laptop Mouse & Trackpad
    window.addEventListener('mousedown', (e) => {
      if (e.target.closest('#hud button') || e.target.closest('.sci-modal-backdrop') || e.target.closest('.skill-item-bar')) {
        return;
      }
      if (e.button === 2) {
        this.isRightMouseDown = true;
      } else if (e.button === 0) {
        this.isLeftMouseDown = true;
      }
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 2) this.isRightMouseDown = false;
      if (e.button === 0) this.isLeftMouseDown = false;
    });

    window.addEventListener('contextmenu', (e) => {
      // Prevent browser right click context menu during gameplay
      if (!e.target.closest('.sci-modal-card')) {
        e.preventDefault();
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (this.isRightMouseDown || (this.isLeftMouseDown && !e.target.closest('.bottom-inventory-bar') && !e.target.closest('.skill-panel-container'))) {
        const deltaX = e.clientX - this.lastPointerX;
        const deltaY = e.clientY - this.lastPointerY;
        if (deltaX !== 0 || deltaY !== 0) {
          this._manualOrbitTimer = 1.6; // disengage auto-follow while the user orbits
        }

        // Sensitivity (scaled by |dt| of the event is unnecessary; px are px)
        const rotSpeed = 0.005;
        this.targetYaw -= deltaX * rotSpeed;
        this.targetPitch = Math.max(this.minPitch, Math.min(this.maxPitch, this.targetPitch + deltaY * rotSpeed));
      }
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
    });

    // Zoom: PC Mouse Wheel & Laptop Trackpad Pinch (exponential steps = constant
    // perceived speed at any zoom level)
    window.addEventListener('wheel', (e) => {
      if (e.target.closest('.modal-body-scroll') || e.target.closest('.skill-list')) {
        return; // Allow modal/list scrolling
      }
      e.preventDefault();
      const zoomFactor = 1.0 + Math.abs(e.deltaY) * 0.0015;
      if (e.deltaY > 0) {
        this.setZoom(this.targetZoom * zoomFactor);
      } else {
        this.setZoom(this.targetZoom / zoomFactor);
      }
    }, { passive: false });

    // PC / TV Keyboard Zoom & Controls
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

      if (e.key === '=' || e.key === '+' || e.key === 'PageUp') {
        this.setZoom(this.targetZoom * 0.85);
      } else if (e.key === '-' || e.key === '_' || e.key === 'PageDown') {
        this.setZoom(this.targetZoom * 1.18);
      }
    });

    // 2. Mobile / Tablet Multi-touch Gestures (Pinch to zoom, drag to rotate)
    window.addEventListener('touchstart', (e) => {
      if (e.target.closest('#hud button') || e.target.closest('.skill-item-bar') || e.target.closest('.inventory-slot')) {
        return;
      }
      if (e.touches.length === 1) {
        this.isPinching = false;
        this.lastPointerX = e.touches[0].clientX;
        this.lastPointerY = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        // Pinch start
        this.isPinching = true;
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        this.touchPinchStartDist = Math.sqrt(dx * dx + dy * dy);
      }
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
      if (this.isPinching && e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (this.touchPinchStartDist > 0) {
          const ratio = this.touchPinchStartDist / dist;
          this.setZoom(this.targetZoom * ratio);
          this.touchPinchStartDist = dist;
        }
      } else if (e.touches.length === 1 && !e.target.closest('.skill-panel-container')) {
        const deltaX = e.touches[0].clientX - this.lastPointerX;
        const deltaY = e.touches[0].clientY - this.lastPointerY;
        if (deltaX !== 0 || deltaY !== 0) this._manualOrbitTimer = 1.6;
        const rotSpeed = 0.007;
        this.targetYaw -= deltaX * rotSpeed;
        this.targetPitch = Math.max(this.minPitch, Math.min(this.maxPitch, this.targetPitch + deltaY * rotSpeed));
        this.lastPointerX = e.touches[0].clientX;
        this.lastPointerY = e.touches[0].clientY;
      }
    }, { passive: true });

    window.addEventListener('touchend', (e) => {
      if (e.touches.length < 2) {
        this.isPinching = false;
      }
    });

    // UI Zoom Slider & Buttons Binding
    const zoomSlider = document.getElementById('zoom-slider');
    const zoomInBtn = document.getElementById('btn-zoom-in');
    const zoomOutBtn = document.getElementById('btn-zoom-out');

    if (zoomSlider) {
      zoomSlider.addEventListener('input', (e) => {
        this.setZoom(parseFloat(e.target.value));
      });
    }

    if (zoomInBtn) {
      zoomInBtn.addEventListener('click', () => {
        this.setZoom(this.targetZoom * 0.75);
      });
    }

    if (zoomOutBtn) {
      zoomOutBtn.addEventListener('click', () => {
        this.setZoom(this.targetZoom * 1.35);
      });
    }
  }

  setZoom(val) {
    this.targetZoom = Math.max(this.minZoom, Math.min(this.maxZoom, val));
    const slider = document.getElementById('zoom-slider');
    const meterText = document.getElementById('zoom-meter-text');
    if (slider) slider.value = this.targetZoom;
    if (meterText) meterText.textContent = `${this.targetZoom.toFixed(1)} M`;
  }

  /**
   * Add an AXIAL camera shake event (translation on X/Y/Z only).
   *
   * STRICT REQUIREMENTS:
   * - High-frequency random positional offsets only on the X, Y, Z axes.
   * - ZERO rotational shake: the camera quaternion is locked to the un-shaken
   *   base pose; the shake may only displace camera.position.
   * - Closer explosion -> stronger displacement, farther -> weaker.
   *
   * @param {THREE.Vector3|null} explosionOrigin - 3D world position of the explosion. If null, applies global shake.
   * @param {number} baseIntensity - Base shake magnitude in meters (e.g. 0.5 - 3.5).
   * @param {number} duration - Shake duration in seconds.
   * @param {number} frequency - Hz of the high-frequency displacement (default 60Hz).
   */
  addShake(explosionOrigin = null, baseIntensity = 1.0, duration = 0.5, frequency = 60) {
    let effectiveIntensity = baseIntensity * this.shakeScale;

    if (explosionOrigin) {
      // Distance falloff in accurate meters - closer blast = violent throw,
      // distant blast = faint tremor (1 / (1 + (d/22)^1.4)).
      const dist = this.targetPosition.distanceTo(explosionOrigin);
      const falloff = 1.0 / (1.0 + Math.pow(dist / 22.0, 1.4));
      effectiveIntensity *= falloff;
    }

    // Hard cap so catastrophic skills remain playable
    effectiveIntensity = Math.min(effectiveIntensity, SHAKE_HARD_CAP);
    if (effectiveIntensity < 0.005) return; // Discard imperceptible vibrations

    // Physical push direction in the camera's LOCAL axis frame:
    // the camera is "knocked" away from the blast. Translation only.
    let push = new THREE.Vector3(0, 0, 0);
    if (explosionOrigin) {
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
      const dir = new THREE.Vector3().subVectors(this.camera.position, explosionOrigin);
      if (dir.lengthSq() > 0.01) {
        dir.normalize();
        push = new THREE.Vector3(dir.dot(right), dir.dot(up), dir.dot(fwd));
      }
    }

    this.shakeList.push({
      initialIntensity: effectiveIntensity,
      duration: duration,
      elapsed: 0,
      frequency: frequency,
      cycleTimer: 0,
      // Smoothed axial offset in the camera's LOCAL X/Y/Z frame
      cur: new THREE.Vector3(0, 0, 0),
      // Target the smoothed value chases (re-rolled every cycle)
      goal: new THREE.Vector3(0, 0, 0),
      // One-shot directional impulse away from the blast
      push,
    });
  }

  /**
   * Poll Gamepad input for Console / Smart TV gamepad support
   */
  pollGamepad() {
    if (!navigator.getGamepads) return;
    const gamepads = navigator.getGamepads();
    if (!gamepads) return;

    for (let i = 0; i < gamepads.length; i++) {
      const gp = gamepads[i];
      if (!gp) continue;

      // Right Stick (X: Axis 2, Y: Axis 3) for Camera Orbit
      const deadzone = 0.15;
      if (Math.abs(gp.axes[2]) > deadzone) {
        this.targetYaw -= gp.axes[2] * 0.04;
        this._manualOrbitTimer = 1.6;
      }
      if (Math.abs(gp.axes[3]) > deadzone) {
        this.targetPitch = Math.max(this.minPitch, Math.min(this.maxPitch, this.targetPitch + gp.axes[3] * 0.03));
      }

      // Triggers or D-pad for Zoom
      // L2 / LT (button 6) zoom in, R2 / RT (button 7) zoom out
      if (gp.buttons[6] && gp.buttons[6].pressed) {
        this.setZoom(this.targetZoom * 0.96);
      }
      if (gp.buttons[7] && gp.buttons[7].pressed) {
        this.setZoom(this.targetZoom * 1.04);
      }
      // D-Pad Up / Down (buttons 12 / 13)
      if (gp.buttons[12] && gp.buttons[12].pressed) {
        this.setZoom(this.targetZoom * 0.97);
      }
      if (gp.buttons[13] && gp.buttons[13].pressed) {
        this.setZoom(this.targetZoom * 1.03);
      }
    }
  }

  /**
   * Frame update.
   *
   * PIPELINE:
   *   1. focus point  = player + 1.5m + velocity look-ahead (exp-damped)
   *   2. auto-follow  = ease yaw to stay behind the motion direction
   *   3. orbit angles = exp-damped toward targets (framerate independent)
   *   4. base pose    = spherical offset from focus (BEHIND-TOP framing)
   *   5. axial shake  = translation only, quaternion frozen
   */
  update(deltaTime, playerPosition) {
    const dt = Math.min(0.1, Math.max(0.0001, deltaTime));

    // ------------------------------------------------------------------
    // 1. FOCUS POINT: chase the player with frame-rate independent damping,
    //    then lead the focus into the movement direction (look-ahead) so
    //    fast dashes keep the hero framed instead of sliding off-screen.
    // ------------------------------------------------------------------
    if (playerPosition) {
      this.targetPosition.copy(playerPosition);
      this.targetPosition.y += 1.5; // chest/eye focus
    }

    // Estimate target velocity from focus motion (deterministic from inputs).
    // Convert the per-frame delta to per-second velocity BEFORE smoothing so
    // thresholds (m/s) and look-ahead (m) are frame-rate independent.
    this._moveDelta.subVectors(this.targetPosition, this._lastTargetPos);
    this._lastTargetPos.copy(this.targetPosition);
    this._moveDelta.divideScalar(dt);
    this._smoothedVel.lerp(this._moveDelta, 1.0 - Math.exp(-dt * 8.0));

    // Look-ahead eases toward clamped velocity direction
    const speed = Math.sqrt(
      this._smoothedVel.x * this._smoothedVel.x +
      this._smoothedVel.z * this._smoothedVel.z
    );
    const lead = Math.min(1.0, speed / 16.0) * LOOKAHEAD_MAX;
    if (speed > 0.0001) {
      const k = lead / speed;
      this._tmp.set(this._smoothedVel.x * k, 0, this._smoothedVel.z * k);
    } else {
      this._tmp.set(0, 0, 0);
    }
    this._lookAhead.lerp(this._tmp, 1.0 - Math.exp(-dt * LOOKAHEAD_RATE));

    this._focus.copy(this.targetPosition).add(this._lookAhead);

    // ------------------------------------------------------------------
    // 2. AUTO-FOLLOW: when enabled and the user has not orbited recently,
    //    ease the yaw so the rig settles back BEHIND the movement arc.
    //    Rate-limited + shortest-path: even a 180° correction is a smooth
    //    ~2s drift, never a whip cut.
    // ------------------------------------------------------------------
    this._manualOrbitTimer -= dt;
    if (this.autoFollow && this._manualOrbitTimer <= 0 && speed > 2.5) {
      const inv = 1 / speed;
      const dirX = this._smoothedVel.x * inv;
      const dirZ = this._smoothedVel.z * inv;
      // Camera offset dir is (-moveDir): yaw such that rig sits opposite motion
      const desiredYaw = Math.atan2(-dirX, -dirZ);
      let dy = desiredYaw - this.targetYaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      const step = Math.max(-this._followYawRate * dt, Math.min(this._followYawRate * dt, dy));
      this.targetYaw += step;
    }

    // Poll Gamepad for Console / TV
    this.pollGamepad();

    // ------------------------------------------------------------------
    // 3. EXP-DAMPED SMOOTHING (identical behavior at any framerate)
    // ------------------------------------------------------------------
    const fFollow = 1.0 - Math.exp(-dt * FOLLOW_RATE);
    const fZoom = 1.0 - Math.exp(-dt * ZOOM_RATE);
    const fRot = 1.0 - Math.exp(-dt * ROT_RATE);
    this.smoothedTarget.lerp(this._focus, fFollow);
    this.currentZoom += (this.targetZoom - this.currentZoom) * fZoom;
    this.currentPitch += (this.targetPitch - this.currentPitch) * fRot;
    this.currentYaw += (this.targetYaw - this.currentYaw) * fRot;

    // ------------------------------------------------------------------
    // 4. BASE POSE: spherical offset behind & above the focus point.
    // ------------------------------------------------------------------
    const cosPitch = Math.cos(this.currentPitch);
    const sinPitch = Math.sin(this.currentPitch);
    const cosYaw = Math.cos(this.currentYaw);
    const sinYaw = Math.sin(this.currentYaw);

    const offsetX = this.currentZoom * cosPitch * sinYaw;
    const offsetY = this.currentZoom * sinPitch;
    const offsetZ = this.currentZoom * cosPitch * cosYaw;

    this.baseCameraPos.set(
      this.smoothedTarget.x + offsetX,
      this.smoothedTarget.y + offsetY,
      this.smoothedTarget.z + offsetZ
    );

    // Prevent camera dipping beneath the arena ground floor (y = 0.5 min)
    if (this.baseCameraPos.y < 0.6) {
      this.baseCameraPos.y = 0.6;
    }

    // -------------------------------------------------------------
    // STEP 1 - BASE POSE (un-shaken). Position AND orientation are
    // derived here, exactly once, from the clean base state.
    // -------------------------------------------------------------
    this.camera.position.copy(this.baseCameraPos);
    this.camera.lookAt(this.smoothedTarget);
    this.baseQuaternion.copy(this.camera.quaternion);

    // -------------------------------------------------------------
    // STEP 2 - AXIAL SHAKE (X / Y / Z translation ONLY).
    // Every offset is produced in the camera's local axis frame and
    // added to position. The quaternion captured in STEP 1 is
    // NEVER touched -> rotation is provably zero from the shake.
    // -------------------------------------------------------------
    this._localOffset.set(0, 0, 0);

    for (let i = this.shakeList.length - 1; i >= 0; i--) {
      const s = this.shakeList[i];
      s.elapsed += deltaTime;

      if (s.elapsed >= s.duration) {
        this.shakeList.splice(i, 1);
        continue;
      }

      // Combined envelope: fast initial "thump" + long exponential tail
      const progress = s.elapsed / s.duration;
      const thump = Math.exp(-s.elapsed * 3.2);
      const tail = Math.pow(1.0 - progress, 1.6);
      const curIntensity = s.initialIntensity * (0.45 * thump + 0.55 * tail);

      // High-frequency re-roll of the axial target (random walk on axes)
      s.cycleTimer += deltaTime;
      const cycleTime = 1.0 / s.frequency;
      if (s.cycleTimer >= cycleTime) {
        s.cycleTimer = 0;
        // Uniform random displacement strictly along local X, Y, Z
        s.goal.set(
          (Math.random() * 2 - 1) * curIntensity,
          (Math.random() * 2 - 1) * curIntensity * 0.85,
          (Math.random() * 2 - 1) * curIntensity
        );
      }

      // Critically-damped follow: keeps the jitter high-frequency but organic
      const follow = 1.0 - Math.exp(-deltaTime * 45.0);
      s.cur.lerp(s.goal, follow);

      this._localOffset.add(s.cur);

      // Directional impulse: a one-shot "knock" away from the blast,
      // decaying faster than the jitter. Pure X/Y/Z translation.
      if (s.push.lengthSq() > 0) {
        const pushScale = 0.4 * curIntensity * Math.exp(-s.elapsed * 2.6);
        this._localOffset.x += s.push.x * pushScale;
        this._localOffset.y += s.push.y * pushScale;
        this._localOffset.z += s.push.z * pushScale;
      }
    }

    // -------------------------------------------------------------
    // STEP 3 - COMMIT: translate position only. Orientation stays
    // locked to the frozen base quaternion (no pitch/yaw/roll).
    // -------------------------------------------------------------
    if (this._localOffset.lengthSq() > 0) {
      this._worldOffset.copy(this._localOffset).applyQuaternion(this.baseQuaternion);
      this.camera.position.add(this._worldOffset);
    }

    // Safety: keep the shaken camera above the ground plane.
    // This is still a pure translation correction (X/Y/Z only).
    if (this.camera.position.y < 0.15) {
      const push = 0.15 - this.camera.position.y;
      this.camera.position.y += push;
    }
  }
}
