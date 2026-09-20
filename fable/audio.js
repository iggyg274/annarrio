// audio.js — procedural chiptune music + sound effects using only the Web Audio API.
// No audio files, no MIDI, no libraries. Everything is synthesized at runtime.
(function () {
  'use strict';

  // Small seeded PRNG (mulberry32) so the music can vary per playthrough but stay coherent.
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

  class AudioSys {
    constructor() {
      this.ctx = null;
      this.muted = false;
      this.music = null;
    }

    init() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.6;
      this.master.connect(this.ctx.destination);
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 0.7;
      this.sfxGain.connect(this.master);
      this.musGain = this.ctx.createGain();
      this.musGain.gain.value = 0.45;
      this.musGain.connect(this.master);
      // 1 second of white noise, reused for drums / splashes.
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.music = new Music(this);
    }

    resume() {
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    }

    toggleMute() {
      this.muted = !this.muted;
      if (this.master) this.master.gain.value = this.muted ? 0 : 0.6;
      return this.muted;
    }

    // ---- primitive voices -------------------------------------------------
    // Play one oscillator note with a simple attack/decay envelope.
    tone(o) {
      if (!this.ctx) return;
      const c = this.ctx;
      const t0 = o.t !== undefined ? o.t : c.currentTime;
      const dur = o.dur || 0.1;
      const osc = c.createOscillator();
      osc.type = o.type || 'square';
      osc.frequency.setValueAtTime(o.freq, t0);
      if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(o.freqEnd, t0 + dur);
      if (o.slideTo && o.slideAt) osc.frequency.exponentialRampToValueAtTime(o.slideTo, t0 + o.slideAt);
      const g = c.createGain();
      const vol = o.vol || 0.2;
      const a = o.attack || 0.005;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(vol, t0 + a);
      if (o.sustain) {
        g.gain.setValueAtTime(vol, t0 + dur - 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      } else {
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      }
      let node = osc;
      if (o.lp) {
        const f = c.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = o.lp;
        osc.connect(f);
        node = f;
      }
      node.connect(g);
      g.connect(o.dest || this.sfxGain);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    }

    // Filtered noise burst (hi-hat, snare, splash, stomp crunch).
    noise(o) {
      if (!this.ctx) return;
      const c = this.ctx;
      const t0 = o.t !== undefined ? o.t : c.currentTime;
      const dur = o.dur || 0.08;
      const src = c.createBufferSource();
      src.buffer = this.noiseBuf;
      const f = c.createBiquadFilter();
      f.type = o.ftype || 'highpass';
      f.frequency.setValueAtTime(o.freq || 4000, t0);
      if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(o.freqEnd, t0 + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(o.vol || 0.15, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(f); f.connect(g); g.connect(o.dest || this.sfxGain);
      src.start(t0);
      src.stop(t0 + dur + 0.02);
    }

    // ---- sound effects ----------------------------------------------------
    jump() { this.tone({ type: 'square', freq: 260, freqEnd: 620, dur: 0.14, vol: 0.18 }); }
    coin() {
      const t = this.ctx.currentTime;
      this.tone({ type: 'square', freq: 987.77, dur: 0.07, vol: 0.16, t });
      this.tone({ type: 'square', freq: 1318.5, dur: 0.28, vol: 0.16, t: t + 0.07 });
    }
    gem() {
      const t = this.ctx.currentTime;
      [1046.5, 1318.5, 1568, 2093].forEach((f, i) =>
        this.tone({ type: 'triangle', freq: f, dur: 0.18, vol: 0.2, t: t + i * 0.06 }));
    }
    stomp() {
      this.tone({ type: 'square', freq: 220, freqEnd: 50, dur: 0.16, vol: 0.22 });
      this.noise({ freq: 1200, ftype: 'lowpass', dur: 0.1, vol: 0.2 });
    }
    hurt() {
      this.tone({ type: 'sawtooth', freq: 420, freqEnd: 90, dur: 0.35, vol: 0.2, lp: 1800 });
      this.noise({ freq: 800, ftype: 'lowpass', dur: 0.15, vol: 0.12 });
    }
    bump() { this.tone({ type: 'triangle', freq: 130, freqEnd: 70, dur: 0.09, vol: 0.25 }); }
    qblock() {
      const t = this.ctx.currentTime;
      this.tone({ type: 'square', freq: 660, freqEnd: 990, dur: 0.1, vol: 0.14, t });
      this.tone({ type: 'square', freq: 1318.5, dur: 0.25, vol: 0.14, t: t + 0.1 });
    }
    checkpoint() {
      const t = this.ctx.currentTime;
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
        this.tone({ type: 'triangle', freq: f, dur: 0.22, vol: 0.2, t: t + i * 0.09 }));
    }
    splash() {
      this.noise({ freq: 300, freqEnd: 3000, ftype: 'bandpass', dur: 0.45, vol: 0.3 });
      this.tone({ type: 'sine', freq: 300, freqEnd: 80, dur: 0.3, vol: 0.15 });
    }
    sad() {
      // "you stepped on the M" — a droopy descending wah.
      const t = this.ctx.currentTime;
      [330, 311, 294, 262].forEach((f, i) =>
        this.tone({ type: 'sawtooth', freq: f, freqEnd: f * 0.9, dur: 0.32, vol: 0.14, lp: 1200, t: t + i * 0.26 }));
    }
    die() {
      const t = this.ctx.currentTime;
      [440, 392, 349, 330, 262].forEach((f, i) =>
        this.tone({ type: 'square', freq: f, dur: 0.16, vol: 0.16, t: t + i * 0.13 }));
    }
    win() {
      const t = this.ctx.currentTime;
      const seq = [[392, .12], [392, .12], [392, .12], [523, .35], [0, .1], [659, .12], [587, .12], [523, .12], [659, .12], [784, .6]];
      let at = t;
      seq.forEach(([f, d]) => {
        if (f) {
          this.tone({ type: 'square', freq: f, dur: d, vol: 0.16, t: at, sustain: true });
          this.tone({ type: 'triangle', freq: f / 2, dur: d, vol: 0.14, t: at, sustain: true });
        }
        at += d;
      });
    }
    select() { this.tone({ type: 'square', freq: 880, dur: 0.05, vol: 0.1 }); }
  }

  // ---- generative music ---------------------------------------------------
  // A step sequencer (16th notes) running a seeded, chord-based melody generator.
  // Phrases are 4 bars long; the melody is regenerated periodically so it evolves,
  // and each level section supplies a "mood" (chord progression + lead timbre + tempo).
  const MAJOR = [0, 2, 4, 5, 7, 9, 11];
  const RHYTHMS = [
    [2, 2, 4, 2, 2, 4], [4, 4, 4, 4], [2, 2, 2, 2, 4, 4], [3, 3, 2, 3, 3, 2],
    [2, 2, 2, 2, 2, 2, 2, 2], [6, 2, 4, 4], [4, 2, 2, 4, 4], [2, 4, 2, 2, 4, 2],
    [8, 4, 4], [1, 1, 2, 4, 4, 4],
  ];
  const MOODS = [
    { name: 'town',    prog: [0, 4, 5, 3], lead: 'square',   bpm: 132, bass: 'triangle' },
    { name: 'diag',    prog: [0, 3, 0, 4], lead: 'triangle', bpm: 126, bass: 'triangle' },
    { name: 'tower',   prog: [5, 3, 0, 4], lead: 'square',   bpm: 138, bass: 'sawtooth' },
    { name: 'river',   prog: [3, 4, 5, 2], lead: 'triangle', bpm: 120, bass: 'sine' },
    { name: 'arb',     prog: [0, 2, 3, 4], lead: 'square',   bpm: 130, bass: 'triangle' },
    { name: 'stadium', prog: [0, 3, 4, 4], lead: 'square',   bpm: 148, bass: 'sawtooth' },
  ];

  class Music {
    constructor(a) {
      this.a = a;
      this.playing = false;
      this.seed = (Math.random() * 1e9) | 0;
      this.rng = mulberry32(this.seed);
      this.root = 57 + Math.floor(this.rng() * 8);   // A3..E4
      this.mood = MOODS[0];
      this.pendingMood = null;
      this.step = 0;
      this.phrases = [];
      this.cycle = 0;
      this.timer = null;
    }

    stepDur() { return 60 / this.mood.bpm / 4; }

    chordTones(deg) {
      // diatonic triad on scale degree `deg`, as semitone offsets from root
      return [MAJOR[deg % 7], MAJOR[(deg + 2) % 7] + (deg + 2 >= 7 ? 12 : 0), MAJOR[(deg + 4) % 7] + (deg + 4 >= 7 ? 12 : 0)];
    }

    // Generate one 4-bar phrase of melody as [{step, len, semi}] using the current mood.
    genPhrase(prog) {
      const r = this.rng;
      const bars = [];
      let lastIdx = 7 + Math.floor(r() * 4);   // index into a 2-octave scale list
      const makeBar = (deg, template) => {
        const notes = [];
        const rhythm = template || RHYTHMS[Math.floor(r() * RHYTHMS.length)];
        const ct = this.chordTones(deg);
        let s = 0;
        rhythm.forEach((len, i) => {
          const strong = (s % 4) === 0;
          // random walk over the scale, snapping to chord tones on strong beats
          let idx = lastIdx + (Math.floor(r() * 5) - 2);
          idx = Math.max(4, Math.min(13, idx));
          let semi = MAJOR[idx % 7] + 12 * Math.floor(idx / 7);
          if (strong || r() < 0.35) {
            // nearest chord tone (in any octave)
            let best = semi, bd = 99;
            for (let o = 0; o <= 24; o += 12) for (const c of ct) {
              const d = Math.abs(c + o - semi);
              if (d < bd) { bd = d; best = c + o; }
            }
            semi = best;
          }
          const rest = r() < 0.12 && !strong;
          if (!rest) notes.push({ step: s, len, semi });
          lastIdx = idx;
          s += len;
        });
        return { notes, rhythm };
      };
      const b0 = makeBar(prog[0]);
      const b1 = makeBar(prog[1]);
      const b2 = makeBar(prog[2], b0.rhythm);     // motif echo with same rhythm
      const b3 = makeBar(prog[3]);
      bars.push(b0, b1, b2, b3);
      return bars;
    }

    setMood(i) {
      const m = MOODS[Math.max(0, Math.min(MOODS.length - 1, i))];
      if (m !== this.mood) this.pendingMood = m;
    }

    start() {
      if (this.playing || !this.a.ctx) return;
      this.playing = true;
      this.step = 0;
      this.phrases = [this.genPhrase(this.mood.prog), this.genPhrase(this.mood.prog)];
      this.next = this.a.ctx.currentTime + 0.1;
      this.timer = setInterval(() => this.schedule(), 30);
    }

    stop() {
      this.playing = false;
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
    }

    schedule() {
      const c = this.a.ctx;
      while (this.next < c.currentTime + 0.18) {
        this.playStep(this.step, this.next);
        this.next += this.stepDur();
        this.step++;
      }
    }

    playStep(step, t) {
      const a = this.a, dest = a.musGain;
      const sInBar = step % 16;
      const bar = Math.floor(step / 16);
      const barInPhrase = bar % 4;
      const phraseIdx = Math.floor(bar / 4);
      // Phrase structure: A A B A, regenerate B every cycle and A every other cycle.
      if (sInBar === 0 && barInPhrase === 0) {
        if (this.pendingMood) {
          this.mood = this.pendingMood;
          this.pendingMood = null;
          this.phrases = [this.genPhrase(this.mood.prog), this.genPhrase(this.mood.prog)];
        } else if (phraseIdx % 4 === 2) {
          this.phrases[1] = this.genPhrase(this.mood.prog);
        } else if (phraseIdx % 8 === 0 && phraseIdx > 0) {
          this.phrases[0] = this.genPhrase(this.mood.prog);
        }
      }
      const which = (phraseIdx % 4 === 2) ? 1 : 0;
      const phrase = this.phrases[which];
      const barData = phrase[barInPhrase];
      const deg = this.mood.prog[barInPhrase];
      const ct = this.chordTones(deg);
      const sd = this.stepDur();
      const root = this.root;

      // Lead melody
      for (const n of barData.notes) {
        if (n.step === sInBar) {
          const f = midiToFreq(root + 12 + n.semi);
          a.tone({ type: this.mood.lead, freq: f, dur: n.len * sd * 0.9, vol: 0.13, t, dest, lp: 3200, sustain: n.len >= 4 });
        }
      }
      // Bass: root on 1 and the "and" of 2, fifth on 3, octave/root on 4
      const bassPat = [0, null, null, 0, null, null, 7, null, 0, null, 7, null, 12, null, 7, null];
      const b = bassPat[sInBar];
      if (b !== null) {
        a.tone({ type: this.mood.bass, freq: midiToFreq(root - 12 + ct[0] + b), dur: sd * 1.6, vol: 0.16, t, dest, lp: 900 });
      }
      // Arpeggio shimmer on off-beats
      if (sInBar % 2 === 1) {
        const tone = ct[(Math.floor(sInBar / 2)) % 3] + (sInBar > 8 ? 12 : 0);
        a.tone({ type: 'triangle', freq: midiToFreq(root + 24 + tone), dur: sd * 0.8, vol: 0.045, t, dest });
      }
      // Drums
      if (sInBar === 0 || sInBar === 8 || (sInBar === 10 && bar % 2 === 1)) {
        a.tone({ type: 'sine', freq: 150, freqEnd: 40, dur: 0.12, vol: 0.35, t, dest });
      }
      if (sInBar === 4 || sInBar === 12) {
        a.noise({ freq: 1500, ftype: 'bandpass', dur: 0.12, vol: 0.16, t, dest });
        a.tone({ type: 'triangle', freq: 200, freqEnd: 120, dur: 0.08, vol: 0.12, t, dest });
      }
      if (sInBar % 2 === 0 || (barInPhrase === 3 && sInBar >= 12)) {
        a.noise({ freq: 7000, dur: sInBar % 4 === 2 ? 0.06 : 0.03, vol: 0.06, t, dest });
      }
    }
  }

  window.AudioSys = AudioSys;
})();
