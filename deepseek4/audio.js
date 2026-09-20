/* =========================================================================
   audio.js — Procedural music & sound effects for "Ann Arbor Runner".
   Everything is synthesized at runtime with the Web Audio API
   (OscillatorNode + GainNode envelopes). No MIDI, no audio files,
   no external libraries. A fixed chiptune loop that is lightly
   re-seeded each new game so each run sounds a little different.
   ========================================================================= */
(function () {
  "use strict";
  const A4 = 440.0;

  // note name -> frequency (name like "C4", "F#3")
  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  function noteFreq(name) {
    const m = /^([A-G]#?)(-?\d)$/.exec(name);
    if (!m) return 440;
    const semis = NOTE_NAMES.indexOf(m[1]);
    const octave = parseInt(m[2], 10);
    const midi = (octave + 1) * 12 + semis;
    return A4 * Math.pow(2, (midi - 69) / 12);
  }

  class AudioSys {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.musicGain = null;
      this.sfxGain = null;
      this.started = false;
      this.musicOn = true;
      this._musicTimer = null;
      this._nextStepTime = 0;
      this._step = 0;
      // pick a random transposition + melodic seed per game
      this._transpose = 0;
      this._seed = 0;
    }

    init() {
      if (this.ctx) return;
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.ratio.value = 8;
      comp.connect(this.ctx.destination);
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(comp);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.62;
      this.musicGain.connect(this.master);
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 0.9;
      this.sfxGain.connect(this.master);
      this._seed = (Math.random() * 7) | 0;
      this._transpose = [0, 0, 0, 2, 2, 4, 5, 7][this._seed];
    }

    resume() {
      if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
    }

    /* helper: one oscillator with an AD-ish gain envelope */
    _tone(type, freq, when, dur, peak, dest, bendTo, fadePow) {
      if (!this.ctx) return;
      const t0 = when || this.ctx.currentTime;
      const t1 = t0 + dur;
      const osc = this.ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(Math.max(20, freq), t0);
      if (bendTo && bendTo !== freq) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, bendTo), t1);
      }
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), t0 + dur * 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t1);
      const out = dest || this.sfxGain;
      osc.connect(g);
      g.connect(out);
      osc.start(t0);
      osc.stop(t1 + 0.02);
      if (fadePow && g.gain && g.gain.setValueCurveAtTime && typeof g.gain.setValueCurveAtTime === "function") {
        // no-op safety; envelope above already fades
      }
    }

    _noise(when, dur, peak, dest, freqLo) {
      if (!this.ctx) return;
      const t0 = when || this.ctx.currentTime;
      const t1 = t0 + dur;
      const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      let node = src;
      if (freqLo) {
        const f = this.ctx.createBiquadFilter();
        f.type = "lowpass";
        f.frequency.value = freqLo;
        node.connect(f);
        node = f;
      }
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), t0 + dur * 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t1);
      node.connect(g);
      g.connect(dest || this.sfxGain);
      src.start(t0);
      src.stop(t1 + 0.01);
    }

    /* --------------------------- MUSIC ------------------------------- */
    // Chord progression (I vi IV V in a bright major key).
    _chords(transpose) {
      function T(ch, t) {
        return ch.map(function (n) {
          const idx = NOTE_NAMES.indexOf(n.replace(/[0-9]/g, ""));
          const octShift = t / 12;
          const oct = parseInt(n.match(/[0-9]+$/)[0], 10);
          // transpose by changing octave/semis via frequency at schedule time
          return n;
        });
      }
      void T;
      // we transpose by multiplying frequencies instead of note names
      const base = [
        { bass: "C3", arp: ["C4", "E4", "G4", "C5", "G4", "E4", "C4", "G4"] },
        { bass: "A2", arp: ["A3", "C4", "E4", "A4", "E4", "C4", "A3", "E4"] },
        { bass: "F2", arp: ["F3", "A3", "C4", "F4", "C4", "A3", "F3", "C4"] },
        { bass: "G2", arp: ["G3", "B3", "D4", "G4", "D4", "B3", "G3", "D4"] }
      ];
      return base;
    }

    _mul(f, n) { return f * Math.pow(2, n / 12); }

    startMusic() {
      if (!this.ctx || !this.musicOn) return;
      this.stopMusic();
      const bpm = 116 + (this._seed % 3) * 3;
      this._eighth = 60 / bpm / 2; // one eighth note
      this._step = 0;
      this._nextStepTime = this.ctx.currentTime + 0.1;
      const tickFn = () => this._schedule();
      this._musicTimer = setInterval(tickFn, 28);
    }

    stopMusic() {
      if (this._musicTimer) {
        clearInterval(this._musicTimer);
        this._musicTimer = null;
      }
    }

    _schedule() {
      if (!this.ctx) return;
      const horizon = this.ctx.currentTime + 0.3;
      const chords = this._chords(this._transpose);
      const tr = this._transpose;
      while (this._nextStepTime < horizon) {
        const when = this._nextStepTime;
        const bar = Math.floor(this._step / 8) % 4;
        const stepInBar = this._step % 8;
        const ch = chords[bar];
        // --- bass (triangle), on quarter downbeats ---
        if (stepInBar % 2 === 0) {
          const bassFreq = this._mul(noteFreq(ch.bass), tr);
          const bassNote = stepInBar === 6 ? this._mul(bassFreq, 7) : bassFreq;
          this._tone("triangle", bassNote, when, this._eighth * 0.95, 0.5, this.musicGain);
        }
        // --- lead (square) arpeggio every eighth ---
        const arpNote = ch.arp[stepInBar];
        // slight randomization on octave to keep it lively
        const octUp = (Math.sin(this._seed * 13 + bar * 3 + stepInBar) > 0.55) ? 12 : 0;
        const leadFreq = this._mul(noteFreq(arpNote), tr + octUp);
        this._tone("square", leadFreq, when, this._eighth * 0.92, 0.16, this.musicGain);
        // a soft fifth shimmer every few steps
        if (stepInBar === 2 || stepInBar === 6) {
          const fifth = this._mul(leadFreq, 7);
          this._tone("triangle", fifth, when, this._eighth * 0.6, 0.07, this.musicGain);
        }
        // --- drums ---
        if (stepInBar % 2 === 1) { // off-beat hi-hat
          this._noise(when, 0.045, 0.07, this.musicGain, 8000);
        }
        if (stepInBar === 0 || stepInBar === 4) { // kick
          this._tone("sine", 130, when, 0.09, 0.5, this.musicGain, 45);
        }
        this._step++;
        this._nextStepTime += this._eighth;
      }
    }

    toggleMusic() {
      this.musicOn = !this.musicOn;
      if (this.musicOn) this.startMusic();
      else this.stopMusic();
      return this.musicOn;
    }

    /* --------------------------- SFX ---------------------------- */
    jump()    { this._tone("square", 300, 0, 0.16, 0.2, null, 740); }
    coin()    { const t = this.ctx ? this.ctx.currentTime : 0; this._tone("square", 988, t, 0.07, 0.14); this._tone("square", 1319, t + 0.07, 0.16, 0.14); }
    bump()    { this._tone("square", 210, 0, 0.08, 0.16, null, 95); }
    stomp()   { this._tone("triangle", 420, 0, 0.12, 0.22, null, 70); }
    hurt()    { this._tone("sawtooth", 330, 0, 0.28, 0.2, null, 110); }
    splash()  { this._noise(0, 0.25, 0.18, null, 1400); this._tone("sine", 220, 0, 0.3, 0.12, null, 70); }
    checkpoint() {
      const t = this.ctx ? this.ctx.currentTime : 0;
      const seq = [523.25, 659.26, 783.99, 1046.5];
      seq.forEach((f, i) => this._tone("square", f, t + i * 0.07, 0.12, 0.14));
    }
    powerup() {
      const t = this.ctx ? this.ctx.currentTime : 0;
      [392, 523.25, 659.26, 783.99, 1046.5].forEach((f, i) => this._tone("triangle", f, t + i * 0.06, 0.14, 0.14));
    }
    gameover() {
      const t = this.ctx ? this.ctx.currentTime : 0;
      [330, 311, 262, 220, 165].forEach((f, i) => this._tone("sawtooth", f, t + i * 0.18, 0.18, 0.12));
    }
    fanfare() {
      const t = this.ctx ? this.ctx.currentTime : 0;
      // Gooooo Blue! style rising riff
      const seq = [523.25, 659.26, 783.99, 1046.5, 783.99, 1046.5];
      seq.forEach((f, i) => this._tone("square", f, t + i * 0.13, 0.16, 0.15));
      seq.forEach((f, i) => this._tone("triangle", f / 2, t + i * 0.13, 0.22, 0.12));
    }
    flag()    { this._tone("square", 880, 0, 0.2, 0.15, null, 1320); }
  }

  window.AudioSys = AudioSys;
  window.AudioSysInstance = new AudioSys();
})();
