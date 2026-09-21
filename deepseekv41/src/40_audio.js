/* =========================================================================
   Procedural audio: a seeded generative chiptune sequencer + SFX.
   -------------------------------------------------------------------------
   Everything is synthesised live with the Web Audio API - no files, no MIDI,
   no libraries. A 16-step loop per bar, 4 bars per chord, chord progressions
   chosen per level section (so the music moves as you run through town), and a
   seeded RNG so each playthrough gets its own variation.
   ========================================================================= */
(function () {
  function noteFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  // Chord progressions (semitone offsets from C), one per level section.
  var MOODS = {
    campus: { prog: [[0, 4, 7], [-3, 0, 4], [-5, 0, 3], [-7, -2, 2]], density: 0.55, lead: 'square', octave: 12, swing: 0.0, bpm: 138 },
    street: { prog: [[-3, 0, 4], [-5, 0, 3], [0, 4, 7], [-1, 2, 6]], density: 0.85, lead: 'square', octave: 12, swing: 0.12, bpm: 146 },
    river:  { prog: [[0, 4, 7], [2, 5, 9], [-3, 0, 4], [0, 4, 7]], density: 0.5, lead: 'triangle', octave: 12, swing: 0.0, bpm: 126 },
    build:  { prog: [[-1, 2, 6], [-3, 0, 4], [-5, 0, 3], [-3, 0, 4]], density: 0.8, lead: 'square', octave: 12, swing: 0.08, bpm: 150 },
    stadium: { prog: [[0, 4, 7], [7, 11, 14], [-3, 0, 4], [-1, 2, 6]], density: 0.95, lead: 'sawtooth', octave: 12, swing: 0.0, bpm: 158 },
    win:    { prog: [[0, 4, 7], [-5, 0, 3], [-3, 0, 4], [0, 4, 7]], density: 0.9, lead: 'square', octave: 24, swing: 0.1, bpm: 170 },
  };

  AA.Audio = {
    ctx: null,
    ready: false,
    enabled: true,
    seed: 1,
    bus: null,
    moodName: 'campus',
    mood: MOODS.campus,
    progIdx: 0,
    step: 0,
    nextTime: 0,
    timer: null,
    pattern: null,
    rng: Math.random,

    setSeed: function (seed) {
      this.seed = seed | 0;
      this.rng = AA.makeRng(this.seed ^ 0x5bf03635);
    },

    ensure: function () {
      if (this.ready) return true;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      var ctx = new AC();
      this.ctx = ctx;
      var master = ctx.createGain();
      master.gain.value = 0.0;
      master.connect(ctx.destination);

      var music = ctx.createGain();
      music.gain.value = 0.5;
      music.connect(master);

      var sfx = ctx.createGain();
      sfx.gain.value = 0.9;
      sfx.connect(master);

      this.bus = { master: master, music: music, sfx: sfx };
      this.ready = true;
      master.gain.linearRampToValueAtTime(0.55, ctx.currentTime + 1.2);
      this.nextTime = ctx.currentTime + 0.08;
      this.startScheduler();
      return true;
    },

    resume: function () {
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    },

    setMuted: function (m) {
      this.enabled = !m;
      if (this.bus) {
        var t = this.ctx.currentTime;
        this.bus.master.gain.cancelScheduledValues(t);
        this.bus.master.gain.linearRampToValueAtTime(m ? 0 : 0.55, t + 0.25);
      }
    },

    setMood: function (name) {
      if (!MOODS[name] || this.moodName === name) return;
      this.moodName = name;
      this.mood = MOODS[name];
      this.progIdx = 0;
      this.step = 0;
      this.pattern = null;
    },

    // --- pattern generation ------------------------------------------------
    // One bar = 16 steps. A bar is generated lazily from the current chord,
    // so the melody is never literally twice the same unless the RNG says so.
    makePattern: function () {
      var r = this.rng, mood = this.mood;
      var chords = mood.prog;
      var chordIdx = this.progIdx % chords.length;
      var chord = chords[chordIdx];
      var deg = chord[Math.floor(r() * chord.length)];
      var lead = new Array(16);
      var i;
      for (i = 0; i < 16; i++) {
        var hit = (i % 4 === 0) || (i % 2 === 0 ? r() < mood.density : r() < mood.density * 0.55);
        if (!hit) { lead[i] = null; continue; }
        // walk mostly stepwise, occasionally leap to a chord tone
        if (r() < 0.68) {
          deg += (r() < 0.5 ? 1 : -1) * (r() < 0.7 ? 1 : 2);
          if (deg > 4) deg -= 4; if (deg < -4) deg += 4;
        } else {
          deg = chord[Math.floor(r() * chord.length)] + (r() < 0.3 ? 12 : 0);
        }
        lead[i] = { m: 72 + deg + (mood.octave - 12), v: i % 4 === 0 ? 0.16 : 0.1, len: r() < 0.25 ? 2 : 1 };
      }
      // bass: root-fifth pump with an octave hop on the last beat
      var bass = new Array(16);
      for (i = 0; i < 16; i++) {
        if (i % 4 === 2 && r() < 0.45) bass[i] = chord[2] - 24;
        else if (i % 4 === 0 || r() < 0.35) bass[i] = chord[0] - 24;
        else if (r() < 0.2) bass[i] = chord[1] - 24;
        else bass[i] = null;
      }
      var drums = { kick: [], snare: [], hat: [] };
      for (i = 0; i < 16; i++) {
        if (i === 0 || i === 8 || (i === 6 && r() < 0.3) || (i === 14 && r() < 0.25)) drums.kick.push(i);
        if (i === 4 || i === 12 || (i === 15 && r() < 0.3)) drums.snare.push(i);
        if (r() < 0.72 - (i % 2) * 0.25) drums.hat.push(i);
      }
      return { lead: lead, bass: bass, drums: drums, chordIdx: chordIdx };
    },

    // --- voice helpers -----------------------------------------------------
    blip: function (dest, freq, time, dur, type, vol, glide) {
      var ctx = this.ctx;
      var o = ctx.createOscillator();
      var g = ctx.createGain();
      o.type = type || 'square';
      o.frequency.setValueAtTime(freq, time);
      if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(30, glide), time + dur);
      g.gain.setValueAtTime(0.0001, time);
      g.gain.linearRampToValueAtTime(vol, time + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
      o.connect(g); g.connect(dest);
      o.start(time); o.stop(time + dur + 0.02);
    },

    noise: function (dest, time, dur, vol, freq, q) {
      var ctx = this.ctx;
      var len = Math.max(1, Math.floor(ctx.sampleRate * dur));
      var buf = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      var src = ctx.createBufferSource();
      src.buffer = buf;
      var f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = freq || 1800;
      f.Q.value = q || 0.8;
      var g = ctx.createGain();
      g.gain.value = vol;
      src.connect(f); f.connect(g); g.connect(dest);
      src.start(time);
    },

    drumKick: function (time) {
      var ctx = this.ctx;
      var o = ctx.createOscillator();
      var g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(150, time);
      o.frequency.exponentialRampToValueAtTime(44, time + 0.13);
      g.gain.setValueAtTime(0.55, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.16);
      o.connect(g); g.connect(this.bus.music);
      o.start(time); o.stop(time + 0.18);
    },
    drumSnare: function (time) { this.noise(this.bus.music, time, 0.14, 0.3, 1700, 0.7); },
    drumHat: function (time) { this.noise(this.bus.music, time, 0.045, 0.14, 7200, 1.4); },

    // --- scheduler ---------------------------------------------------------
    startScheduler: function () {
      var self = this;
      if (this.timer) return;
      this.timer = setInterval(function () { self.tick(); }, 25);
    },

    tick: function () {
      if (!this.ready || !this.enabled) return;
      var ctx = this.ctx;
      var spb = 60 / this.mood.bpm / 4;   // seconds per 16th step
      var horizon = ctx.currentTime + 0.16;
      var guard = 0;
      while (this.nextTime < horizon && guard++ < 64) {
        var t = this.nextTime;
        if (this.step % 16 === 0) this.pattern = this.makePattern();
        var p = this.pattern;
        var s = this.step % 16;

        var lead = p.lead[s];
        if (lead) {
          var dur = spb * (lead.len === 2 ? 1.85 : 1.1);
          this.blip(this.bus.music, noteFreq(lead.m), t, dur, this.mood.lead, lead.v);
          // a quiet octave sparkle on off-beats keeps it "interesting"
          if (s % 4 === 2 && this.rng() < 0.35) {
            this.blip(this.bus.music, noteFreq(lead.m + 12), t + spb * 0.5, spb * 0.5, 'triangle', 0.05);
          }
        }
        var bass = p.bass[s];
        if (bass != null) this.blip(this.bus.music, noteFreq(bass), t, spb * 1.6, 'triangle', 0.19);

        if (p.drums.kick.indexOf(s) >= 0) this.drumKick(t);
        if (p.drums.snare.indexOf(s) >= 0) this.drumSnare(t);
        if (p.drums.hat.indexOf(s) >= 0) this.drumHat(t);

        if (s === 15) this.progIdx++;
        this.step++;
        var swing = this.mood.swing * (this.step % 2 === 0 ? spb * 0.25 : 0);
        this.nextTime = t + spb + swing;
      }
    },

    // --- sound effects -----------------------------------------------------
    sfx: function (name) {
      if (!this.ready || !this.enabled) return;
      var ctx = this.ctx, t = ctx.currentTime + 0.01, d = this.bus.sfx;
      switch (name) {
        case 'jump':
          this.blip(d, 300, t, 0.16, 'square', 0.22, 700);
          break;
        case 'land':
          this.noise(d, t, 0.06, 0.16, 420, 0.9);
          break;
        case 'coin':
          this.blip(d, noteFreq(88), t, 0.07, 'square', 0.18);
          this.blip(d, noteFreq(95), t + 0.06, 0.13, 'square', 0.16);
          break;
        case 'stomp':
          this.noise(d, t, 0.1, 0.3, 900, 0.6);
          this.blip(d, 620, t, 0.12, 'square', 0.2, 180);
          break;
        case 'hurt':
          this.blip(d, 400, t, 0.32, 'sawtooth', 0.24, 90);
          this.noise(d, t, 0.2, 0.2, 500, 0.5);
          break;
        case 'splash':
          this.noise(d, t, 0.4, 0.28, 700, 0.5);
          this.blip(d, 900, t, 0.3, 'sine', 0.12, 130);
          break;
        case 'checkpoint':
          this.blip(d, noteFreq(76), t, 0.1, 'square', 0.16);
          this.blip(d, noteFreq(81), t + 0.09, 0.1, 'square', 0.16);
          this.blip(d, noteFreq(88), t + 0.18, 0.22, 'triangle', 0.16);
          break;
        case 'win':
          [72, 76, 79, 84, 88, 91, 96].forEach(function (n, i) {
            this.blip(d, noteFreq(n), t + i * 0.11, 0.3, 'square', 0.17);
          }, this);
          break;
        case 'over':
          [64, 60, 57, 52].forEach(function (n, i) {
            this.blip(d, noteFreq(n), t + i * 0.16, 0.34, 'sawtooth', 0.2);
          }, this);
          break;
        case 'select':
          this.blip(d, noteFreq(84), t, 0.08, 'square', 0.15, 96);
          break;
        case 'snow':
          this.noise(d, t, 0.12, 0.1, 5200, 1.2);
          break;
        case 'boss':
          this.blip(d, 120, t, 0.5, 'sawtooth', 0.22, 60);
          break;
      }
    },
  };
})();
