/* audio.js — procedural chiptune + SFX via plain Web Audio API.
 * No external files, no libraries: oscillators + gain envelopes + a generated
 * noise buffer for percussion. The lead line is a seeded random walk over a
 * pentatonic scale, so the melody varies slightly on every playthrough while the
 * chord progression and groove stay fixed.
 */
(function (global) {
  'use strict';

  function midiHz(n) { return 440 * Math.pow(2, (n - 69) / 12); }

  var A = {
    ctx: null, master: null, musicGain: null, sfxGain: null, noiseBuf: null,
    running: false, muted: false, timer: null,
    step: 0, nextTime: 0, seed: 1, leadIdx: 0, lastLead: 60, density: 0.55
  };

  /* Chords: bass root (midi), arp tones (midi), scale pool for the lead */
  var PROG = [
    { root: 36 + 9, chord: [57, 60, 64], hi: [48, 52, 55] }, /* Am */
    { root: 36 + 5, chord: [53, 57, 60], hi: [52, 55, 59] }, /* F     */
    { root: 36 + 0, chord: [48, 52, 55], hi: [55, 59, 62] }, /* C     */
    { root: 36 + 7, chord: [50, 55, 59], hi: [54, 57, 62] }  /* G     */
  ];
  var SCALE = [0, 2, 4, 7, 9];              /* pentatonic degrees */

  function rnd() {
    A.seed = (A.seed * 1664525 + 1013904223) >>> 0;
    return A.seed / 4294967296;
  }

  function makeNoise(ctx) {
    var len = Math.floor(ctx.sampleRate * 0.5);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function ensure() {
    if (A.ctx) {
      if (A.ctx.state === 'suspended') A.ctx.resume().catch(function () {});
      return true;
    }
    var Ctor = global.AudioContext || global.webkitAudioContext;
    if (!Ctor) return false;
    try { A.ctx = new Ctor(); } catch (e) { return false; }
    A.master = A.ctx.createGain();
    A.master.gain.value = 0.9;
    A.master.connect(A.ctx.destination);

    A.musicGain = A.ctx.createGain();
    A.musicGain.gain.value = 0.42;
    A.musicGain.connect(A.master);

    A.sfxGain = A.ctx.createGain();
    A.sfxGain.gain.value = 0.65;
    A.sfxGain.connect(A.master);

    A.noiseBuf = makeNoise(A.ctx);
    return true;
  }

  /* one oscillator note with a fast attack / shaped decay */
  function tone(freq, t, dur, type, vol, dest, slideTo) {
    if (!A.ctx) return;
    var o = A.ctx.createOscillator();
    var g = A.ctx.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(Math.max(20, freq), t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || A.musicGain);
    o.start(t); o.stop(t + dur + 0.02);
  }

  function hit(t, opts, dest) {
    if (!A.ctx || !A.noiseBuf) return;
    var src = A.ctx.createBufferSource();
    src.buffer = A.noiseBuf;
    var g = A.ctx.createGain();
    var bq = A.ctx.createBiquadFilter();
    bq.type = opts.hp ? 'highpass' : 'lowpass';
    bq.frequency.value = opts.f;
    g.gain.setValueAtTime(opts.v, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.d);
    src.connect(bq); bq.connect(g); g.connect(dest || A.musicGain);
    src.start(t); src.stop(t + opts.d + 0.02);
  }

  var BPM = 138;
  function stepDur() { return 60 / BPM / 4; } /* one 16th note */

  function scheduleStep(step, t) {
    var bar = Math.floor(step / 16) % 4;
    var s = step % 16;
    var ch = PROG[bar];

    /* drums: kick + snare + hats */
    if (s === 0 || s === 8 || s === 12) hit(t, { f: 900, d: 0.09, v: s === 0 ? 0.5 : 0.34 });
    if (s === 4 || s === 12) hit(t, { f: 2400, hp: true, d: 0.13, v: 0.28 });
    if (s % 2 === 1) hit(t, { f: 7000, hp: true, d: 0.035, v: 0.10 });

    /* bass: root pulse with a little walk */
    var bassNotes = [0, 0, 7, 0, 0, 3, 0, 7];
    var bi = Math.floor(s / 2) % 8;
    if (s === 0 || s === 3 || s === 6 || s === 8 || s === 11 || s === 14) {
      var bn = ch.root + bassNotes[bi];
      tone(midiHz(bn), t, stepDur() * 1.7, 'triangle', 0.5);
    }

    /* arp: chord tones cycling on 8ths */
    if (s % 2 === 0) {
      var n = ch.chord[(step / 2) % 3 | 0] + ((Math.floor(s / 8) % 2) ? 12 : 0);
      tone(midiHz(n), t, stepDur() * 0.9, 'square', 0.10);
    }

    /* lead: seeded random walk over pentatonic, biased onto chord tones */
    if (s % 2 === 0) {
      var strong = s === 0 || s === 8;
      var p = strong ? 0.95 : A.density * 0.7;
      if (rnd() < p) {
        var deg = Math.floor(rnd() * SCALE.length);
        var oct = rnd() < 0.35 ? 12 : 0;
        var rootMidi = ch.root + 24;
        var midi = rootMidi + SCALE[deg] + oct;
        if (strong) { /* snap strong beats near a chord tone */
          var ct = ch.hi[Math.floor(rnd() * 3)];
          midi = rnd() < 0.5 ? ct : midi;
        }
        var dur = strong ? stepDur() * 3.4 : stepDur() * (rnd() < 0.3 ? 2.6 : 1.2);
        tone(midiHz(midi), t, dur, 'square', 0.16);
        if (rnd() < 0.22) tone(midiHz(midi - 12), t, dur * 0.7, 'triangle', 0.12);
      }
    }
    /* sparkle fill at the end of every 4th bar */
    if (bar === 3 && s >= 12) {
      var nn = ch.hi[(s - 12) % 3] + 12;
      tone(midiHz(nn), t, stepDur() * 0.8, 'triangle', 0.14);
    }
  }

  function scheduler() {
    if (!A.ctx || !A.running) return;
    var ahead = A.ctx.currentTime + 0.16;
    if (A.nextTime < A.ctx.currentTime - 0.5) A.nextTime = A.ctx.currentTime + 0.05;
    while (A.nextTime < ahead) {
      if (!A.muted) scheduleStep(A.step, A.nextTime);
      A.nextTime += stepDur();
      A.step = (A.step + 1) % 64;
    }
  }

  var MUSIC = {
    start: function () {
      if (!ensure()) return false;
      A.running = true;
      A.seed = (Date.now() ^ Math.floor(Math.random() * 0x9fffffff)) >>> 0;
      A.nextTime = A.ctx.currentTime + 0.08;
      if (!A.timer) A.timer = setInterval(scheduler, 25);
      return true;
    },
    stop: function () {
      A.running = false;
      if (A.timer) { clearInterval(A.timer); A.timer = null; }
    },
    setMuted: function (m) {
      A.muted = !!m;
      if (A.master) A.master.gain.value = m ? 0 : 0.9;
    },
    intensity: function (v) { /* 0..1 — more lead notes when running fast */
      A.density = 0.35 + Math.max(0, Math.min(1, v)) * 0.45;
    }
  };

  var SFX = {
    play: function (name) {
      if (!ensure() || A.muted) return;
      var t = A.ctx.currentTime + 0.001;
      switch (name) {
        case 'jump':
          tone(300, t, 0.16, 'square', 0.30, A.sfxGain, 720); break;
        case 'jump2':
          tone(520, t, 0.18, 'square', 0.26, A.sfxGain, 1080); break;
        case 'land':
          hit(t, { f: 400, d: 0.07, v: 0.3 }); break;
        case 'coin':
          tone(midiHz(76), t, 0.07, 'square', 0.28, A.sfxGain);
          tone(midiHz(88), t + 0.06, 0.16, 'square', 0.24, A.sfxGain); break;
        case 'cherry':
          tone(midiHz(72), t, 0.06, 'triangle', 0.3, A.sfxGain);
          tone(midiHz(79), t + 0.05, 0.06, 'triangle', 0.3, A.sfxGain);
          tone(midiHz(84), t + 0.10, 0.2, 'triangle', 0.28, A.sfxGain); break;
        case 'stomp':
          hit(t, { f: 500, d: 0.1, v: 0.4 });
          tone(420, t, 0.14, 'square', 0.22, A.sfxGain, 90); break;
        case 'bump':
          hit(t, { f: 300, d: 0.05, v: 0.25 }); break;
        case 'brick':
          hit(t, { f: 1200, d: 0.22, v: 0.45 });
          tone(200, t, 0.18, 'sawtooth', 0.16, A.sfxGain, 70); break;
        case 'power':
          [60, 64, 67, 72].forEach(function (n, i) {
            tone(midiHz(n), t + i * 0.055, 0.14, 'square', 0.26, A.sfxGain);
          }); break;
        case 'heart':
          tone(midiHz(81), t, 0.07, 'triangle', 0.3, A.sfxGain);
          tone(midiHz(90), t + 0.06, 0.16, 'triangle', 0.26, A.sfxGain); break;
        case 'hurt':
          tone(480, t, 0.22, 'sawtooth', 0.3, A.sfxGain, 120); break;
        case 'die':
          [72, 68, 65, 60].forEach(function (n, i) {
            tone(midiHz(n), t + i * 0.11, 0.2, 'square', 0.28, A.sfxGain);
          }); break;
        case 'flag':
          [67, 72, 76].forEach(function (n, i) {
            tone(midiHz(n), t + i * 0.06, 0.14, 'triangle', 0.3, A.sfxGain);
          }); break;
        case 'win':
          [60, 64, 67, 72, 76, 79, 84].forEach(function (n, i) {
            tone(midiHz(n), t + i * 0.085, 0.3, 'square', 0.24, A.sfxGain);
            tone(midiHz(n - 12), t + i * 0.085, 0.24, 'triangle', 0.16, A.sfxGain);
          }); break;
        case 'select':
          tone(880, t, 0.05, 'square', 0.2, A.sfxGain); break;
      }
    }
  };

  global.SOUND = { music: MUSIC, sfx: SFX, ensure: ensure };
})(typeof window !== 'undefined' ? window : globalThis);
