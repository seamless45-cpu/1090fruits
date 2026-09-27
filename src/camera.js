import * as THREE from 'three';

/**
 * 3D 1090 Fruits - Camera & Shake Controller
 * 
 * SPECIFICATIONS:
 * 1. Camera Zooming: Max range 300 meters. (Accurate 3.0m - 300.0m range)
 * 2. Camera zoom compatibility: PC (wheel, keys), Mobile (pinch gestures, slider), 
 *    Console (gamepad right stick/triggers), Laptop (trackpad), TV (UI buttons).
 * 3. Camera Shake Effect:
 *    - Strictly high-frequency random positional offsets ONLY on X, Y, and Z axes.
 *    - DO NOT apply any rotational shake (pitch, yaw, roll = 0).
 *    - Rotational camera movement is intentionally disabled to preserve visual clarity,
 *      prevent disorientation, and keep aiming perfectly steady.
 *    - Closer explosion -> stronger positional displacement; farther explosion -> weaker displacement.
 */

export class CameraController {
  constructor(camera, domElement) {
    this.camera = camera;
    this.domElement = domElement;

    // Zoom limits strictly calibrated to 300 meters max range
    this.minZoom = 3.0; // 3 meters (close over-shoulder)
    this.maxZoom = 300.0; // 300 meters (maximum orbital tactical distance)
    this.targetZoom = 28.0; // Default third person distance
    this.currentZoom = 28.0;

    // Orbit angles
    this.targetPitch = 0.35; // radians (elevation angle)
    this.currentPitch = 0.35;
    this.minPitch = -0.3;
    this.maxPitch = 1.45; // ~83 degrees (high angle)

    this.targetYaw = 0.0;
    this.currentYaw = 0.0;

    // Tracking target (player position)
    this.targetPosition = new THREE.Vector3(0, 1.6, 0);
    this.smoothedTarget = new THREE.Vector3(0, 1.6, 0);

    // Mouse / Touch interaction state
    this.isRightMouseDown = false;
    this.isLeftMouseDown = false;
    this.lastPointerX = 0;
    this.lastPointerY = 0;
    this.touchPinchStartDist = 0;
    this.isPinching = false;

    // Camera Shake System (TRANSLATIONAL ONLY: X, Y, Z)
    this.shakeList = [];
    this.shakeOffset = new THREE.Vector3(0, 0, 0);
    this.shakeScale = 1.0; // Configurable from graphics settings

    // Stored base position & rotation for rigid shake application
    this.baseCameraPos = new THREE.Vector3();

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

        // Sensitivity
        const rotSpeed = 0.005;
        this.targetYaw -= deltaX * rotSpeed;
        this.targetPitch = Math.max(this.minPitch, Math.min(this.maxPitch, this.targetPitch + deltaY * rotSpeed));
      }
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
    });

    // Zoom: PC Mouse Wheel & Laptop Trackpad Pinch
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
   * Add a positional camera shake event.
   * STRICT REQUIREMENTS:
   * - High-frequency random positional offsets only on X, Y, Z axes.
   * - ZERO rotational shake (pitch, yaw, roll = 0).
   * - Closer explosion -> stronger positional displacement.
   * - Farther explosion -> weaker displacement.
   * 
   * @param {THREE.Vector3|null} explosionOrigin - 3D world position of the explosion. If null, applies global shake.
   * @param {number} baseIntensity - Base shake magnitude in meters (e.g. 0.5 - 3.5).
   * @param {number} duration - Shake duration in seconds.
   * @param {number} frequency - Hz of the high-frequency displacement (default 60Hz).
   */
  addShake(explosionOrigin = null, baseIntensity = 1.0, duration = 0.5, frequency = 60) {
    let effectiveIntensity = baseIntensity * this.shakeScale;

    if (explosionOrigin) {
      // Calculate distance between camera/player and explosion origin in accurate meters
      const dist = this.targetPosition.distanceTo(explosionOrigin);
      // Falloff curve: 1 / (1 + (dist / 25)^1.2)
      // Closer explosion -> massive displacement, far explosion -> faint tremor
      const falloff = 1.0 / (1.0 + Math.pow(dist / 22.0, 1.4));
      effectiveIntensity *= falloff;
    }

    if (effectiveIntensity < 0.005) return; // Discard imperceptible vibrations

    this.shakeList.push({
      intensity: effectiveIntensity,
      initialIntensity: effectiveIntensity,
      duration: duration,
      elapsed: 0,
      frequency: frequency,
      lastCycle: 0,
      currentOffset: new THREE.Vector3(0, 0, 0),
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
   * Frame update
   */
  update(deltaTime, playerPosition) {
    if (playerPosition) {
      this.targetPosition.copy(playerPosition);
      this.targetPosition.y += 1.6; // Focus on player chest / eye height
    }

    // Poll Gamepad for Console / TV
    this.pollGamepad();

    // Smooth camera damping
    const lerpSpeed = Math.min(1.0, deltaTime * 12.0);
    this.smoothedTarget.lerp(this.targetPosition, lerpSpeed);
    this.currentZoom += (this.targetZoom - this.currentZoom) * lerpSpeed;
    this.currentPitch += (this.targetPitch - this.currentPitch) * lerpSpeed;
    this.currentYaw += (this.targetYaw - this.currentYaw) * lerpSpeed;

    // Spherical coordinate offset calculation for base camera position
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
    // UPDATE CAMERA SHAKE (Strictly X, Y, Z translation only)
    // -------------------------------------------------------------
    this.shakeOffset.set(0, 0, 0);

    for (let i = this.shakeList.length - 1; i >= 0; i--) {
      const s = this.shakeList[i];
      s.elapsed += deltaTime;

      if (s.elapsed >= s.duration) {
        this.shakeList.splice(i, 1);
        continue;
      }

      // Exponential decay
      const progress = s.elapsed / s.duration;
      const decay = Math.pow(1.0 - progress, 2.0);
      const curIntensity = s.initialIntensity * decay;

      // High-frequency jitter update
      const cycleTime = 1.0 / s.frequency;
      if (s.elapsed - s.lastCycle > cycleTime) {
        s.lastCycle = s.elapsed;
        // Generate uniform random offsets strictly in X, Y, Z translation
        s.currentOffset.set(
          (Math.random() - 0.5) * 2.0 * curIntensity,
          (Math.random() - 0.5) * 2.0 * curIntensity,
          (Math.random() - 0.5) * 2.0 * curIntensity
        );
      }

      this.shakeOffset.add(s.currentOffset);
    }

    // 1. Position camera at base position + pure XYZ translational offset
    this.camera.position.copy(this.baseCameraPos).add(this.shakeOffset);

    // 2. Point camera at smoothed target.
    // Notice: we DO NOT add any roll, pitch, or yaw angular jitter!
    // The rotation is determined SOLELY by lookAt(smoothedTarget).
    this.camera.lookAt(this.smoothedTarget);
  }
}
