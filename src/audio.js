/**
 * 3D 1090 Fruits - Web Audio Synthesizer
 * Provides rich sci-fi sound effects without external audio files.
 */

class SoundSystem {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.isMuted = false;
    this.hasUnlocked = false;

    // Unlock audio on first user gesture
    const unlock = () => {
      if (!this.hasUnlocked) {
        this.init();
        this.hasUnlocked = true;
      }
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  init() {
    if (this.ctx) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    this.ctx = new AudioCtx();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.setValueAtTime(0.5, this.ctx.currentTime);
    this.masterGain.connect(this.ctx.destination);
    this.startAmbientWind();
    // Pre-method: pre-synthesize the shared noise buffers used by the
    // storm audio engine (no per-thunder buffer allocation).
    this._getNoiseBuffer(1);
    this._getNoiseBuffer(2);
    this._getNoiseBuffer(4);
    if (this._stormLevelPending != null) this.setStormAmbience(this._stormLevelPending);
  }

  /**
   * Procedural ambient wind / storm room-tone.
   * Looped filtered noise with a very slow swell LFO - quiet by design,
   * sells the "outdoors in a storm arena" feel under all the SFX.
   */
  startAmbientWind() {
    if (!this.ctx || this.ambientStarted) return;
    this.ambientStarted = true;

    const ctx = this.ctx;
    const bufferLen = ctx.sampleRate * 4;
    const buffer = ctx.createBuffer(1, bufferLen, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < bufferLen; i++) {
      // Pinkish noise (cheap first-order filter of white noise)
      const white = Math.random() * 2 - 1;
      last = last * 0.97 + white * 0.03;
      data[i] = last * 3.0;
    }

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;

    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 420;
    lowpass.Q.value = 0.6;

    const gain = ctx.createGain();
    gain.gain.value = 0.055;

    // Slow swell LFO so the wind breathes
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.028;
    lfo.connect(lfoGain);
    lfoGain.connect(gain.gain);

    // Gentle high-frequency shimmer for gusts
    const shimmer = ctx.createOscillator();
    shimmer.frequency.value = 0.19;
    const shimmerGain = ctx.createGain();
    shimmerGain.gain.value = 120;
    shimmer.connect(shimmerGain);
    shimmerGain.connect(lowpass.frequency);

    src.connect(lowpass);
    lowpass.connect(gain);
    gain.connect(this.masterGain);

    src.start();
    lfo.start();
    shimmer.start();
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : 0.5, this.ctx.currentTime);
    }
    return !this.isMuted;
  }

  // --- Sound Effects Generators ---

  // 1. High-frequency Lightning Crack & Thunder
  /** Close-range strike (lightning-beast skill). Real close thunder: a violent
   *  broadband crack, then 2-3 overlapping booming rumble hits, then sub-bass. */
  playLightning(volume = 1.0, pitch = 1.0) {
    this.playThunder(0.08 / (pitch * pitch), 0, volume);
  }

  // =================================================================
  // STORM AUDIO ENGINE (round 7)
  // Realistic procedural thunder + persistent storm ambience beds.
  // All noise buffers are pre-generated once (pre-method: zero per-call
  // buffer synthesis). Thunder is scheduled with the physical sound-
  // travel delay so light and thunder never arrive simultaneously.
  // =================================================================
  _getNoiseBuffer(seconds) {
    if (!this._noiseBufs) this._noiseBufs = {};
    const key = seconds;
    if (this._noiseBufs[key]) return this._noiseBufs[key];
    const ctx = this.ctx;
    const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._noiseBufs[key] = buf;
    return buf;
  }

  /**
   * Realistic thunder.
   * distance01: 0 = strike on top of the player, 1 = far off-strike.
   *   - light is instant, sound travels at ~343 m/s => the whole event is
   *     scheduled `d * ~2.5s` later (the "count the seconds" effect)
   *   - close strikes open with a sharp broadband CRACK, then booms
   *   - distant strikes are muffled, no crack, just rolling rumble
   *   - the rumble itself is a chain of 2-4 staggered lowpassed noise
   *     hits with random gaps -> the classic "chug-chug-chug" roll
   *   - a 50->28Hz sine sub adds the physical chest pressure
   * pan: -1..1 relative to the player (left/right of the strike).
   */
  playThunder(distance01 = 0.5, pan = 0, volumeBoost = 1.0) {
    if (!this.ctx || this.isMuted) return;
    const ctx = this.ctx;
    const d = distance01 < 0 ? 0 : distance01 > 1 ? 1 : distance01;
    const delay = d * 2.5;
    const t0 = ctx.currentTime + delay;
    const volume = 0.85 * (1 - d * 0.72) * volumeBoost;
    if (volume <= 0.01) return;

    const out = ctx.createGain();
    if (ctx.createStereoPanner) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-0.85, Math.min(0.85, pan));
      out.connect(panner);
      panner.connect(this.masterGain);
    } else {
      out.connect(this.masterGain);
    }

    // 1) Crack - close strikes only. Bandpass-swept noise burst, 1.6k->300Hz.
    if (d < 0.3) {
      const crack = ctx.createBufferSource();
      crack.buffer = this._getNoiseBuffer(1);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 0.9;
      bp.frequency.setValueAtTime(1700, t0);
      bp.frequency.exponentialRampToValueAtTime(280, t0 + 0.12);
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(0.0001, t0);
      cg.gain.exponentialRampToValueAtTime(0.9 * (1 - d / 0.3) * volumeBoost, t0 + 0.012);
      cg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.24);
      crack.connect(bp); bp.connect(cg); cg.connect(out);
      crack.start(t0); crack.stop(t0 + 0.3);
    }

    // 2) Rolling rumble - 2-4 staggered lowpassed noise hits, random offsets.
    const hits = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < hits; i++) {
      const start = t0 + 0.05 + i * (0.35 + Math.random() * 0.95);
      const dur = 1.8 + Math.random() * (3.2 - d);
      const src = ctx.createBufferSource();
      src.buffer = this._getNoiseBuffer(4);
      src.playbackRate.value = 0.75 + Math.random() * 0.5;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 0.55;
      const f0 = 420 * (1 - d) + 90 * d;  // far = more muffled
      lp.frequency.setValueAtTime(f0 * 1.7, start);
      lp.frequency.exponentialRampToValueAtTime(Math.max(45, f0 * 0.55), start + dur);
      const g = ctx.createGain();
      const hitVol = volume * (i === 0 ? 1 : 0.5 + Math.random() * 0.35);
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(hitVol, start + 0.05 + Math.random() * 0.25);
      g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      src.connect(lp); lp.connect(g); g.connect(out);
      src.start(start, Math.random() * 1.5, dur + 0.5);
    }

    // 3) Sub-bass pressure pulse, 52->28Hz sine.
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(52 * (1 - d * 0.5), t0 + 0.08);
    sub.frequency.exponentialRampToValueAtTime(27, t0 + 2.3);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.0001, t0 + 0.08);
    sg.gain.exponentialRampToValueAtTime(volume * 0.5, t0 + 0.32);
    sg.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.7);
    sub.connect(sg); sg.connect(out);
    sub.start(t0 + 0.08); sub.stop(t0 + 2.9);
  }

  /** Gust-front whoosh (squall line / derecho passing over the player). */
  playGust(intensity = 1.0) {
    if (!this.ctx || this.isMuted) return;
    const ctx = this.ctx, now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this._getNoiseBuffer(2);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.1;
    bp.frequency.setValueAtTime(170, now);
    bp.frequency.exponentialRampToValueAtTime(950, now + 0.45);
    bp.frequency.exponentialRampToValueAtTime(120, now + 1.8);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.42 * Math.max(0.2, intensity), now + 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 1.9);
    src.connect(bp); bp.connect(g); g.connect(this.masterGain);
    src.start(now); src.stop(now + 2.0);
  }

  /** Hail hitting ground / armor - short bright chatter. */
  playHail(intensity = 1.0) {
    if (!this.ctx || this.isMuted) return;
    const ctx = this.ctx, now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this._getNoiseBuffer(1);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 2600;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.14 * Math.max(0.2, Math.min(1.4, intensity)), now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    src.connect(hp); hp.connect(g); g.connect(this.masterGain);
    src.start(now); src.stop(now + 0.18);
  }

  /**
   * Persistent storm ambience (created ONCE, intensity smoothed live).
   * level 0..1: wind howl (bandpass noise + slow LFO), rain hiss
   * (highpass noise, ~level^2 so it only reads when heavy), and a
   * modulated distant-rumble bed. Driven by the weather manager at ~2Hz.
   */
  setStormAmbience(level) {
    const lv = level < 0 ? 0 : level > 1 ? 1 : level;
    if (!this.ctx) { this._stormLevelPending = lv; return; }
    this._buildStormBeds();
    const t = this.ctx.currentTime;
    this._windGain.gain.setTargetAtTime(0.05 + lv * 0.30, t, 0.9);
    this._rainGain.gain.setTargetAtTime(lv * lv * 0.30, t, 0.7);
    this._rumbleBedGain.gain.setTargetAtTime(0.02 + lv * 0.17, t, 1.4);
    this._rumbleLfoDepth.gain.setTargetAtTime(0.015 + lv * 0.05, t, 1.0);
  }

  _buildStormBeds() {
    if (this._bedsBuilt) return;
    this._bedsBuilt = true;
    const ctx = this.ctx;
    const white = this._getNoiseBuffer(4);

    // Wind howl: bandpass noise, slow LFO sweeps the center frequency
    const windSrc = ctx.createBufferSource();
    windSrc.buffer = white; windSrc.loop = true;
    const windBp = ctx.createBiquadFilter();
    windBp.type = 'bandpass'; windBp.frequency.value = 430; windBp.Q.value = 0.6;
    const windLfo = ctx.createOscillator(); windLfo.frequency.value = 0.07;
    const windLfoDepth = ctx.createGain(); windLfoDepth.gain.value = 230;
    windLfo.connect(windLfoDepth); windLfoDepth.connect(windBp.frequency);
    this._windGain = ctx.createGain(); this._windGain.gain.value = 0;
    windSrc.connect(windBp); windBp.connect(this._windGain);
    this._windGain.connect(this.masterGain);
    windSrc.start(); windLfo.start();

    // Rain: highpassed noise hiss
    const rainSrc = ctx.createBufferSource();
    rainSrc.buffer = white; rainSrc.loop = true; rainSrc.playbackRate.value = 1.35;
    const rainHp = ctx.createBiquadFilter();
    rainHp.type = 'highpass'; rainHp.frequency.value = 3100;
    const rainLp = ctx.createBiquadFilter();
    rainLp.type = 'lowpass'; rainLp.frequency.value = 12500;
    this._rainGain = ctx.createGain(); this._rainGain.gain.value = 0;
    rainSrc.connect(rainHp); rainHp.connect(rainLp);
    rainLp.connect(this._rainGain); this._rainGain.connect(this.masterGain);
    rainSrc.start();

    // Distant rumble bed: lowpassed noise + slow LFO on the gain
    const rumbleSrc = ctx.createBufferSource();
    rumbleSrc.buffer = white; rumbleSrc.loop = true; rumbleSrc.playbackRate.value = 0.5;
    const rumbleLp = ctx.createBiquadFilter();
    rumbleLp.type = 'lowpass'; rumbleLp.frequency.value = 105;
    this._rumbleBedGain = ctx.createGain(); this._rumbleBedGain.gain.value = 0;
    const rumbleLfo = ctx.createOscillator(); rumbleLfo.frequency.value = 0.13;
    this._rumbleLfoDepth = ctx.createGain(); this._rumbleLfoDepth.gain.value = 0;
    rumbleLfo.connect(this._rumbleLfoDepth);
    this._rumbleLfoDepth.connect(this._rumbleBedGain.gain);
    rumbleSrc.connect(rumbleLp); rumbleLp.connect(this._rumbleBedGain);
    this._rumbleBedGain.connect(this.masterGain);
    rumbleSrc.start(); rumbleLfo.start();
  }

  // 2. Heavy Sci-Fi Explosion (Asteroids, Bombs)
  playExplosion(volume = 1.0, duration = 0.8) {
    if (!this.ctx || this.isMuted) return;
    const now = this.ctx.currentTime;

    // Noise burst
    const bufferSize = this.ctx.sampleRate * duration;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(450, now);
    filter.frequency.exponentialRampToValueAtTime(40, now + duration);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.9 * volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    noise.start(now);

    // Sub rumble
    const sub = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(70, now);
    sub.frequency.exponentialRampToValueAtTime(15, now + duration);

    subGain.gain.setValueAtTime(0.8 * volume, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    sub.connect(subGain);
    subGain.connect(this.masterGain);
    sub.start(now);
    sub.stop(now + duration);
  }

  // 3. Siren Alarm / Amber Alert
  playSiren(freq = 660, duration = 0.4) {
    if (!this.ctx || this.isMuted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.linearRampToValueAtTime(freq * 1.5, now + duration * 0.5);
    osc.frequency.linearRampToValueAtTime(freq, now + duration);

    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + duration);
  }

  // 4. Laser Shoot / Beam
  playLaser(pitch = 1.0) {
    if (!this.ctx || this.isMuted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(1200 * pitch, now);
    osc.frequency.exponentialRampToValueAtTime(120, now + 0.18);

    gain.gain.setValueAtTime(0.35, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.22);
  }

  // 5. Freeze / Ice Shatter
  playFreezeShatter() {
    if (!this.ctx || this.isMuted) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(3200, now);
    osc.frequency.exponentialRampToValueAtTime(800, now + 0.25);

    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.32);
  }

  // 6. Quake / Tectonic Crack
  playQuakeBoom() {
    if (!this.ctx || this.isMuted) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(45, now);
    osc.frequency.linearRampToValueAtTime(20, now + 0.9);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(180, now);

    gain.gain.setValueAtTime(0.8, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.9);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.95);
  }

  // 7. Sword Slash / Whoosh
  playSlash(speed = 1.0) {
    if (!this.ctx || this.isMuted) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(420 * speed, now);
    osc.frequency.exponentialRampToValueAtTime(80, now + 0.12);

    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.14);
  }

  // 8. Dash / Sonic Teleport
  playDash() {
    if (!this.ctx || this.isMuted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(300, now);
    osc.frequency.exponentialRampToValueAtTime(1400, now + 0.15);

    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.18);
  }

  // 9. UI Beep
  playUiBeep(freq = 880) {
    if (!this.ctx || this.isMuted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);

    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.09);
  }

  // =============================================================
  // REALISTIC GAME UI SOUNDS (synthesized, zero audio files)
  // =============================================================

  // 10. Button CLICK - short mechanical tick with a tiny body
  playUiClick() {
    if (!this.ctx || this.isMuted) return;
    const now = this.ctx.currentTime;

    // High tick
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1900, now);
    osc.frequency.exponentialRampToValueAtTime(700, now + 0.03);
    g.gain.setValueAtTime(0.06, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.045);
    osc.connect(g); g.connect(this.masterGain);
    osc.start(now); osc.stop(now + 0.05);

    // Low body thock
    const thock = this.ctx.createOscillator();
    const tg = this.ctx.createGain();
    thock.type = 'sine';
    thock.frequency.setValueAtTime(240, now);
    thock.frequency.exponentialRampToValueAtTime(90, now + 0.05);
    tg.gain.setValueAtTime(0.10, now);
    tg.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    thock.connect(tg); tg.connect(this.masterGain);
    thock.start(now); thock.stop(now + 0.07);
  }

  // 11. Button HOVER - whisper-quiet soft tick (throttled by caller)
  playUiHover() {
    if (!this.ctx || this.isMuted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(2600, now);
    g.gain.setValueAtTime(0.016, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
    osc.connect(g); g.connect(this.masterGain);
    osc.start(now); osc.stop(now + 0.035);
  }

  // 12. Modal OPEN - rising filtered-noise whoosh + confirmation chime
  playUiOpen() {
    if (!this.ctx || this.isMuted) return;
    const now = this.ctx.currentTime;

    const len = this.ctx.sampleRate * 0.22;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(400, now);
    bp.frequency.exponentialRampToValueAtTime(2400, now + 0.2);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.exponentialRampToValueAtTime(0.07, now + 0.08);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    src.connect(bp); bp.connect(g); g.connect(this.masterGain);
    src.start(now);

    const chime = this.ctx.createOscillator();
    const cg = this.ctx.createGain();
    chime.type = 'triangle';
    chime.frequency.setValueAtTime(880, now + 0.06);
    chime.frequency.setValueAtTime(1318, now + 0.12);
    cg.gain.setValueAtTime(0.0001, now);
    cg.gain.exponentialRampToValueAtTime(0.05, now + 0.13);
    cg.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    chime.connect(cg); cg.connect(this.masterGain);
    chime.start(now); chime.stop(now + 0.32);
  }

  // 13. Modal CLOSE - falling filtered-noise whoosh
  playUiClose() {
    if (!this.ctx || this.isMuted) return;
    const now = this.ctx.currentTime;

    const len = this.ctx.sampleRate * 0.18;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(2200, now);
    bp.frequency.exponentialRampToValueAtTime(350, now + 0.16);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.06, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    src.connect(bp); bp.connect(g); g.connect(this.masterGain);
    src.start(now);
  }

  // 14. DENIED - low square buzz (not enough points, on cooldown)
  playUiDeny() {
    if (!this.ctx || this.isMuted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.setValueAtTime(110, now + 0.08);
    g.gain.setValueAtTime(0.07, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    osc.connect(g); g.connect(this.masterGain);
    osc.start(now); osc.stop(now + 0.17);
  }

  // 15. LEVEL UP - rising three-note chime with shimmer
  playLevelUp() {
    if (!this.ctx || this.isMuted) return;
    const now = this.ctx.currentTime;
    const notes = [523.25, 784.0, 1046.5, 1568.0];
    notes.forEach((f, i) => {
      const t = now + i * 0.09;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.09, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      osc.connect(g); g.connect(this.masterGain);
      osc.start(t); osc.stop(t + 0.55);
      // Harmonic shimmer an octave up
      const h = this.ctx.createOscillator();
      const hg = this.ctx.createGain();
      h.type = 'triangle';
      h.frequency.setValueAtTime(f * 2, t);
      hg.gain.setValueAtTime(0.0001, t);
      hg.gain.exponentialRampToValueAtTime(0.025, t + 0.02);
      hg.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      h.connect(hg); hg.connect(this.masterGain);
      h.start(t); h.stop(t + 0.4);
    });
  }

  // 16. SKILL CAST - powerful anime whoosh (rising saw + noise burst)
  playSkillCast(pitch = 1.0) {
    if (!this.ctx || this.isMuted) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(120 * pitch, now);
    osc.frequency.exponentialRampToValueAtTime(720 * pitch, now + 0.18);
    g.gain.setValueAtTime(0.001, now);
    g.gain.exponentialRampToValueAtTime(0.14, now + 0.06);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc.connect(g); g.connect(this.masterGain);
    osc.start(now); osc.stop(now + 0.32);

    const len = this.ctx.sampleRate * 0.25;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(300 * pitch, now);
    bp.frequency.exponentialRampToValueAtTime(1800 * pitch, now + 0.22);
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.10, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
    src.connect(bp); bp.connect(ng); ng.connect(this.masterGain);
    src.start(now);
  }

  // 17. EQUIP - mechanical clack + metallic ping
  playEquip() {
    if (!this.ctx || this.isMuted) return;
    const now = this.ctx.currentTime;

    const len = this.ctx.sampleRate * 0.06;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.14, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    src.connect(hp); hp.connect(g); g.connect(this.masterGain);
    src.start(now);

    const ping = this.ctx.createOscillator();
    const pg = this.ctx.createGain();
    ping.type = 'triangle';
    ping.frequency.setValueAtTime(2350, now + 0.03);
    ping.frequency.exponentialRampToValueAtTime(1600, now + 0.14);
    pg.gain.setValueAtTime(0.0001, now + 0.03);
    pg.gain.exponentialRampToValueAtTime(0.06, now + 0.05);
    pg.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    ping.connect(pg); pg.connect(this.masterGain);
    ping.start(now + 0.03); ping.stop(now + 0.22);
  }

  // 18. GAME START - power-up riser on the PLAY button
  playGameStart() {
    if (!this.ctx || this.isMuted) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(60, now);
    osc.frequency.exponentialRampToValueAtTime(520, now + 0.45);
    g.gain.setValueAtTime(0.001, now);
    g.gain.exponentialRampToValueAtTime(0.12, now + 0.2);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    osc.connect(g); g.connect(this.masterGain);
    osc.start(now); osc.stop(now + 0.62);

    const chime = this.ctx.createOscillator();
    const cg = this.ctx.createGain();
    chime.type = 'sine';
    chime.frequency.setValueAtTime(1046.5, now + 0.42);
    cg.gain.setValueAtTime(0.0001, now + 0.42);
    cg.gain.exponentialRampToValueAtTime(0.1, now + 0.46);
    cg.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
    chime.connect(cg); cg.connect(this.masterGain);
    chime.start(now + 0.42); chime.stop(now + 0.92);
  }
}

export const sound = new SoundSystem();
