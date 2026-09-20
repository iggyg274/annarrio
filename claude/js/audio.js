// Procedural chiptune music + sound effects using the Web Audio API only.
// No external audio files, no MIDI -- everything is synthesized at runtime.

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.musicOn = false;
    this.masterGain = null;
    this.musicGain = null;
    this.sfxGain = null;

    // Step sequencer state
    this.tempo = 128; // BPM
    this.stepsPerBeat = 2; // eighth notes
    this.secondsPerStep = 60 / this.tempo / this.stepsPerBeat;
    this.nextStepTime = 0;
    this.stepIndex = 0;
    this.lookahead = 0.12; // seconds to schedule ahead
    this.timerId = null;

    // I-V-vi-IV progression, one chord per 8 steps (Ann Arbor "maize & blue" fight-song vibe,
    // but an original melody -- not a quote of any real fight song).
    this.progression = [
      { root: 261.63, chord: [261.63, 329.63, 392.00] }, // C
      { root: 392.00, chord: [392.00, 493.88, 587.33] }, // G
      { root: 220.00, chord: [220.00, 261.63, 329.63] }, // Am
      { root: 349.23, chord: [349.23, 440.00, 523.25] }, // F
    ];
    this.chordIdx = 0;
    this.stepsPerChord = 8;
    this.stepInChord = 0;
    this.melodySeed = 0;
    this.noiseBuffer = null;
  }

  ensureContext() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.6;
    this.masterGain.connect(this.ctx.destination);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.35;
    this.musicGain.connect(this.masterGain);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.7;
    this.sfxGain.connect(this.masterGain);

    this.noiseBuffer = this._makeNoiseBuffer();
  }

  _makeNoiseBuffer() {
    const len = this.ctx.sampleRate * 0.3;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  setMuted(m) {
    this.muted = m;
    if (this.masterGain) this.masterGain.gain.value = m ? 0 : 0.6;
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  // ---------- Music ----------

  startMusic() {
    this.ensureContext();
    if (this.musicOn) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.musicOn = true;
    this.stepIndex = 0;
    this.chordIdx = 0;
    this.stepInChord = 0;
    this.nextStepTime = this.ctx.currentTime + 0.05;
    this._scheduler();
  }

  stopMusic() {
    this.musicOn = false;
    if (this.timerId) clearTimeout(this.timerId);
  }

  _scheduler() {
    if (!this.musicOn) return;
    while (this.nextStepTime < this.ctx.currentTime + this.lookahead) {
      this._scheduleStep(this.stepIndex, this.nextStepTime);
      this.nextStepTime += this.secondsPerStep;
      this.stepIndex++;
      this.stepInChord++;
      if (this.stepInChord >= this.stepsPerChord) {
        this.stepInChord = 0;
        this.chordIdx = (this.chordIdx + 1) % this.progression.length;
        if (this.chordIdx === 0) this.melodySeed = (this.melodySeed + 1) % 1000;
      }
    }
    this.timerId = setTimeout(() => this._scheduler(), 25);
  }

  _scheduleStep(step, t) {
    const chord = this.progression[this.chordIdx];

    // Bass: root on beat 0 and 4 of the 8-step chord, fifth on beat 2 and 6.
    const s = this.stepInChord;
    if (s === 0 || s === 4) {
      this._playTone(chord.root / 2, t, this.secondsPerStep * 1.7, 'triangle', 0.5);
    } else if (s === 2 || s === 6) {
      this._playTone(chord.chord[2] / 2, t, this.secondsPerStep * 1.4, 'triangle', 0.35);
    }

    // Percussion: kick on 0/4, hat on every off-beat.
    if (s === 0 || s === 4) this._playKick(t);
    if (step % 2 === 1) this._playHat(t, s % 4 === 3 ? 0.22 : 0.12);

    // Melody: semi-randomized arpeggio over the current chord, seeded so it
    // varies a bit between loops but stays musical.
    const rnd = this._pseudoRandom(step + this.melodySeed * 37);
    if (rnd > 0.35) {
      const notes = chord.chord;
      const octaveUp = rnd > 0.8 ? 2 : 1;
      const note = notes[Math.floor(rnd * notes.length) % notes.length] * octaveUp;
      this._playTone(note, t, this.secondsPerStep * 0.9, 'square', 0.18);
    }
  }

  _pseudoRandom(n) {
    const x = Math.sin(n * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  }

  _playTone(freq, t, dur, type, peak) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(peak, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain);
    gain.connect(this.musicGain);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  _playKick(t) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.15);
    gain.gain.setValueAtTime(0.6, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    osc.connect(gain);
    gain.connect(this.musicGain);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  _playHat(t, peak) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 6000;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(peak, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicGain);
    src.start(t);
    src.stop(t + 0.06);
  }

  // ---------- SFX ----------

  _sfxTone(freq, dur, type, peak, opts = {}) {
    this.ensureContext();
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(opts.slideTo, t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(peak, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  jump() { this._sfxTone(330, 0.18, 'square', 0.3, { slideTo: 660 }); }

  coin() {
    this.ensureContext();
    const t = this.ctx.currentTime;
    [880, 1318.5].forEach((f, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(f, t + i * 0.06);
      gain.gain.setValueAtTime(0.0001, t + i * 0.06);
      gain.gain.linearRampToValueAtTime(0.25, t + i * 0.06 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.06 + 0.15);
      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(t + i * 0.06);
      osc.stop(t + i * 0.06 + 0.16);
    });
  }

  gem() {
    this.ensureContext();
    const t = this.ctx.currentTime;
    [660, 990, 1320].forEach((f, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, t + i * 0.05);
      gain.gain.setValueAtTime(0.0001, t + i * 0.05);
      gain.gain.linearRampToValueAtTime(0.3, t + i * 0.05 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.05 + 0.2);
      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(t + i * 0.05);
      osc.stop(t + i * 0.05 + 0.22);
    });
  }

  stomp() { this._sfxTone(220, 0.12, 'square', 0.35, { slideTo: 80 }); }

  hit() { this._sfxTone(140, 0.3, 'sawtooth', 0.3, { slideTo: 60 }); }

  heart() { this._sfxTone(523, 0.25, 'triangle', 0.3, { slideTo: 1046 }); }

  bonus() {
    this.ensureContext();
    const t = this.ctx.currentTime;
    [523, 659, 784, 1046].forEach((f, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(f, t + i * 0.07);
      gain.gain.setValueAtTime(0.0001, t + i * 0.07);
      gain.gain.linearRampToValueAtTime(0.28, t + i * 0.07 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.07 + 0.18);
      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(t + i * 0.07);
      osc.stop(t + i * 0.07 + 0.2);
    });
  }

  win() {
    this.ensureContext();
    const t = this.ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    notes.forEach((f, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(f, t + i * 0.14);
      gain.gain.setValueAtTime(0.0001, t + i * 0.14);
      gain.gain.linearRampToValueAtTime(0.3, t + i * 0.14 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.14 + 0.3);
      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(t + i * 0.14);
      osc.stop(t + i * 0.14 + 0.32);
    });
  }

  gameOver() {
    this.ensureContext();
    const t = this.ctx.currentTime;
    const notes = [392, 349.23, 293.66, 220];
    notes.forEach((f, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f, t + i * 0.18);
      gain.gain.setValueAtTime(0.0001, t + i * 0.18);
      gain.gain.linearRampToValueAtTime(0.25, t + i * 0.18 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.18 + 0.35);
      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(t + i * 0.18);
      osc.stop(t + i * 0.18 + 0.38);
    });
  }
}

const AUDIO = new AudioEngine();
