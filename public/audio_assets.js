// Procedural Sound Effects Synthesizer using Web Audio API
const AudioAssets = {
  ctx: null,
  heartbeatTimer: null,
  heartbeatBpm: 60,
  isHeartbeatRunning: false,
  masterGain: null,

  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      
      // Master gain node for overall volume control
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(0.8, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);
      
      console.log("[Audio] Procedural Audio Engine initialized successfully.");
    } catch (e) {
      console.error("[Audio] Web Audio API not supported:", e);
    }
  },

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  },

  // Helper: Create a buffer of white noise
  createNoiseBuffer() {
    const bufferSize = this.ctx.sampleRate * 2; // 2 seconds
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  },

  // Flashlight click sound
  playClick() {
    try {
      this.resume();
      if (!this.ctx) return;

      const time = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gainNode = this.ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1200, time);
      osc.frequency.exponentialRampToValueAtTime(100, time + 0.05);
      
      gainNode.gain.setValueAtTime(0.08, time);
      gainNode.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
      
      osc.connect(gainNode);
      gainNode.connect(this.masterGain);
      
      osc.start(time);
      osc.stop(time + 0.06);
    } catch (e) {
      console.warn("[Audio] playClick failed:", e);
    }
  },

  // Footstep sound (procedural friction/thud)
  playFootstep(isCrouching = false) {
    try {
      this.resume();
      if (!this.ctx) return;

      const time = this.ctx.currentTime;
      const volume = isCrouching ? 0.02 : 0.15;
      
      // Thud component (low frequency)
      const osc = this.ctx.createOscillator();
      const oscGain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(80, time);
      osc.frequency.exponentialRampToValueAtTime(30, time + 0.12);
      
      oscGain.gain.setValueAtTime(volume, time);
      oscGain.gain.exponentialRampToValueAtTime(0.001, time + 0.12);
      
      osc.connect(oscGain);
      oscGain.connect(this.masterGain);
      
      // Friction component (low-pass filtered noise)
      const noiseSource = this.ctx.createBufferSource();
      noiseSource.buffer = this.createNoiseBuffer();
      
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(250, time);
      
      const noiseGain = this.ctx.createGain();
      noiseGain.gain.setValueAtTime(volume * 0.4, time);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
      
      noiseSource.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(this.masterGain);
      
      osc.start(time);
      osc.stop(time + 0.15);
      
      noiseSource.start(time);
      noiseSource.stop(time + 0.15);
    } catch (e) {
      console.warn("[Audio] playFootstep failed:", e);
    }
  },

  // Creaking door sound (slow squeak)
  playDoorCreak() {
    try {
      this.resume();
      if (!this.ctx) return;

      const time = this.ctx.currentTime;
      const duration = 0.8 + Math.random() * 0.4;
      
      // Squeak component (high pitched detuned saw)
      const osc = this.ctx.createOscillator();
      const oscGain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();
      
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(150, time);
      // Modulate pitch slightly to create "creaking wood" texture
      for (let i = 0; i < duration * 10; i++) {
        const t = time + (i / 10);
        const randomFreq = 140 + Math.sin(i * 1.5) * 20 + Math.random() * 10;
        osc.frequency.linearRampToValueAtTime(randomFreq, t);
      }
      
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(600, time);
      filter.Q.setValueAtTime(4, time);
      
      oscGain.gain.setValueAtTime(0.001, time);
      oscGain.gain.linearRampToValueAtTime(0.04, time + 0.1);
      oscGain.gain.exponentialRampToValueAtTime(0.001, time + duration);
      
      osc.connect(filter);
      filter.connect(oscGain);
      oscGain.connect(this.masterGain);
      
      osc.start(time);
      osc.stop(time + duration + 0.1);
    } catch (e) {
      console.warn("[Audio] playDoorCreak failed:", e);
    }
  },

  // Terrifying jumpscare stinger
  playJumpscare() {
    try {
      this.resume();
      if (!this.ctx) return;

      const time = this.ctx.currentTime;
      const duration = 2.0;

      // Scream tone (distorted detuned sawtooth oscillators)
      const oscs = [];
      const frequencies = [220, 225, 290, 310, 440, 680];
      
      const screamGain = this.ctx.createGain();
      screamGain.gain.setValueAtTime(0.6, time);
      screamGain.gain.exponentialRampToValueAtTime(0.001, time + duration);
      screamGain.gain.connect(this.masterGain);

      frequencies.forEach(f => {
        const osc = this.ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(f, time);
        // add dynamic pitch instability (shaking)
        osc.frequency.linearRampToValueAtTime(f * 1.2, time + 0.1);
        osc.frequency.linearRampToValueAtTime(f * 0.8, time + 0.3);
        osc.frequency.exponentialRampToValueAtTime(f * 0.1, time + duration);
        
        osc.connect(screamGain);
        osc.start(time);
        osc.stop(time + duration);
        oscs.push(osc);
      });

      // Harsh noise blast (high-pass filtered)
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.createNoiseBuffer();
      
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.setValueAtTime(1000, time);
      
      const noiseGain = this.ctx.createGain();
      noiseGain.gain.setValueAtTime(0.5, time);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, time + duration);
      
      noise.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(this.masterGain);
      
      noise.start(time);
      noise.stop(time + duration);
    } catch (e) {
      console.warn("[Audio] playJumpscare failed:", e);
    }
  },

  // Heartbeat low-frequency double pulse
  playSingleHeartbeat(bpm) {
    try {
      if (!this.ctx) return;
      const time = this.ctx.currentTime;
      const duration = 60 / bpm;
      const volume = Math.min(0.8, 0.2 + (bpm - 60) / 100); // gets louder as bpm increases
      
      // First thump (LUB)
      const osc1 = this.ctx.createOscillator();
      const gain1 = this.ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(55, time);
      osc1.frequency.exponentialRampToValueAtTime(20, time + 0.12);
      
      gain1.gain.setValueAtTime(volume, time);
      gain1.gain.exponentialRampToValueAtTime(0.001, time + 0.12);
      
      osc1.connect(gain1);
      gain1.connect(this.masterGain);
      osc1.start(time);
      osc1.stop(time + 0.15);

      // Second thump (DUB) after a short delay
      const delay = 0.15;
      const osc2 = this.ctx.createOscillator();
      const gain2 = this.ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(50, time + delay);
      osc2.frequency.exponentialRampToValueAtTime(15, time + delay + 0.1);
      
      gain2.gain.setValueAtTime(volume * 0.6, time + delay);
      gain2.gain.exponentialRampToValueAtTime(0.001, time + delay + 0.1);
      
      osc2.connect(gain2);
      gain2.connect(this.masterGain);
      osc2.start(time + delay);
      osc2.stop(time + delay + 0.15);
    } catch (e) {
      console.warn("[Audio] playSingleHeartbeat failed:", e);
    }
  },

  startHeartbeat() {
    try {
      this.resume();
      if (this.isHeartbeatRunning) return;
      this.isHeartbeatRunning = true;
      
      const triggerNext = () => {
        try {
          if (!this.isHeartbeatRunning) return;
          this.playSingleHeartbeat(this.heartbeatBpm);
          
          const nextIntervalMs = (60000 / this.heartbeatBpm);
          this.heartbeatTimer = setTimeout(triggerNext, nextIntervalMs);
        } catch (innerErr) {
          console.warn("[Audio] heartbeat inner error:", innerErr);
        }
      };

      triggerNext();
    } catch (e) {
      console.warn("[Audio] startHeartbeat failed:", e);
    }
  },

  setHeartbeatBpm(bpm) {
    this.heartbeatBpm = Math.max(40, Math.min(160, bpm));
  },

  stopHeartbeat() {
    this.isHeartbeatRunning = false;
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  },

  // Synth lock unlock click sound
  playUnlock() {
    try {
      this.resume();
      if (!this.ctx) return;
      const time = this.ctx.currentTime;
      
      // Low frequency clunk
      const osc1 = this.ctx.createOscillator();
      const gain1 = this.ctx.createGain();
      osc1.frequency.setValueAtTime(150, time);
      osc1.frequency.linearRampToValueAtTime(40, time + 0.1);
      gain1.gain.setValueAtTime(0.3, time);
      gain1.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
      osc1.connect(gain1);
      gain1.connect(this.masterGain);
      osc1.start(time);
      osc1.stop(time + 0.15);

      // High metal click
      const osc2 = this.ctx.createOscillator();
      const gain2 = this.ctx.createGain();
      osc2.frequency.setValueAtTime(3000, time);
      osc2.frequency.linearRampToValueAtTime(1500, time + 0.02);
      gain2.gain.setValueAtTime(0.15, time);
      gain2.gain.exponentialRampToValueAtTime(0.001, time + 0.02);
      osc2.connect(gain2);
      gain2.connect(this.masterGain);
      osc2.start(time);
      osc2.stop(time + 0.05);
    } catch (e) {
      console.warn("[Audio] playUnlock failed:", e);
    }
  }
};
