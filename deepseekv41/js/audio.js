/* audio.js — procedural chiptune music + sound effects, Web Audio API only.
 *
 * Per GAME.txt: no MIDI files, no external audio files, no libraries. Every
 * sound here is synthesized live from OscillatorNode + GainNode envelopes (plus
 * a tiny white-noise buffer for percussion). The background music is a small
 * algorithmic step-sequencer: a seeded random arpeggio over a chord progression,
 * a square-wave bass line and noise percussion, so each playthrough differs
 * slightly but the loop stays coherent.
 */
(function (global) {
  'use strict';

  var AAB = global.AAB = global.AAB || {};
  var Audio_ = AAB.audio = { ready: false, muted: false, musicOn: false, error: '' };

  var ctx = null;          // AudioContext
  var master, musicGain, sfxGain, comp;
  var NOISE = null;        // white-noise AudioBuffer

  // ------------------------------------------------------------- music theory

  // A-minor-ish, friendly to a "campus walk" loop.
  var PROG = [
    { bass: 'A1', chord: ['A2', 'C3', 'E3'],  lead: ['A3', 'C4', 'E4', 'A4'] },
    { bass: 'F1', chord: ['F2', 'A2', 'C3'],  lead: ['F3', 'A3', 'C4', 'F4'] },
    { bass: 'C2', chord: ['C3', 'E3', 'G3'],  lead: ['C4', 'E4', 'G4', 'C5'] },
    { bass: 'G1', chord: ['G2', 'B2', 'D3'],  lead: ['G3', 'B3', 'D4', 'G4'] }
  ];
  var NOTE_OFFSET = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  var TEMPO = 138;                       // beats per minute
  var STEP = 60 / TEMPO / 4;             // seconds per 16th step
  var LOOKAHEAD = 0.12;                  // schedule window in seconds

  var stepIndex = 0;
  var nextNoteTime = 0;
  var timerId = null;
  var seed = (Date.now() % 100000) | 0;

  function rng() {                       // tiny seeded PRNG (xorshift-ish)
    seed ^= seed << 13; seed |= 0;
    seed ^= seed >>> 17;
    seed ^= seed << 5; seed |= 0;
    return ((seed >>> 0) % 10000) / 10000;
  }

  function freq(name) {
    var m = /^([A-G])(#?)(-?\d)$/.exec(name);
    if (!m) return 440;
    var semi = NOTE_OFFSET[m[1]] + (m[2] ? 1 : 0);
    var oct = parseInt(m[3], 10);
    // MIDI-ish: C4 = 261.63 Hz  (octave 4)
    var midi = (oct + 1) * 12 + semi;
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  // --------------------------------------------------------------- graph setup

  function ensure() {
    if (ctx) return true;
    var Ctor = global.AudioContext || global.webkitAudioContext;
    if (!Ctor) { Audio_.error = 'Web Audio API unavailable in this browser'; return false; }
    try {
      ctx = new Ctor();
      comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.knee.value = 24;
      comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.22;

      master = ctx.createGain(); master.gain.value = 0.9;
      musicGain = ctx.createGain(); musicGain.gain.value = 0.0001;
      sfxGain = ctx.createGain(); sfxGain.gain.value = 0.9;

      musicGain.connect(master); sfxGain.connect(master);
      master.connect(comp); comp.connect(ctx.destination);

      NOISE = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      var d = NOISE.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

      Audio_.ready = true;
      return true;
    } catch (err) {
      Audio_.error = 'audio init failed: ' + (err && err.message);
      ctx = null;
      return false;
    }
  }

  /** Must be called from a user gesture (browsers block audio otherwise). */
  function unlock() {
    if (!ensure()) return false;
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  }

  // --------------------------------------------------------------- voice synth

  function env(gain, t, dur, peak, attack, release) {
    var g = gain.gain;
    attack = attack || 0.008;
    release = release || 0.05;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0.0001, t);
    g.linearRampToValueAtTime(peak, t + attack);
    g.exponentialRampToValueAtTime(0.0001, t + Math.max(dur, attack + release));
  }

  /** One oscillator note. `mul` scales pitch (coin-combo ladders, stomp chains). */
  function tone(dest, t, dur, note, type, peak, filterHz, mul) {
    mul = mul || 1;
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(note * mul, t);
    env(g, t, dur, peak);
    var node = osc;
    if (filterHz) {
      var f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(Math.min(18000, filterHz * mul), t);
      osc.connect(f); node = f;
    }
    node.connect(g); g.connect(dest);
    osc.start(t);
    osc.stop(t + dur + 0.08);
  }

  function noiseHit(dest, t, dur, peak, filterType, hz, q, mul) {
    mul = mul || 1;
    var src = ctx.createBufferSource();
    src.buffer = NOISE;
    var f = ctx.createBiquadFilter();
    f.type = filterType || 'highpass';
    f.frequency.setValueAtTime(hz * mul, t);
    if (q) f.Q.value = q;
    var g = ctx.createGain();
    env(g, t, dur, peak, 0.001, 0.03);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t, 0, dur + 0.05);
  }

  // --------------------------------------------------------------- step logic

  function scheduleStep(i, t) {
    var bar = PROG[Math.floor(i / 16) % PROG.length];   // 16 steps per chord
    var inBar = i % 16;

    // bass: root on the beat, octave-up pickup on the "and" of 3
    if (inBar % 4 === 0) tone(musicGain, t, STEP * 3.4, freq(bar.bass), 'square', 0.16, 900);
    if (inBar === 14) tone(musicGain, t, STEP * 1.2, freq(bar.bass) * 2, 'square', 0.09, 1400);

    // chord pad: soft triangle stabs on beats 1 and 3
    if (inBar === 0 || inBar === 8) {
      for (var c = 0; c < bar.chord.length; c++) {
        tone(musicGain, t, STEP * 2.6, freq(bar.chord[c]) * (inBar ? 0.5 : 1),
          'triangle', 0.045, 2600);
      }
    }

    // lead: seeded-random arpeggio pick, rests sprinkled in so it breathes
    if (rng() > 0.24) {
      var pick = bar.lead[Math.floor(rng() * bar.lead.length)];
      var oct = rng() > 0.72 ? 2 : 1;                   // occasional octave jump
      var dur = rng() > 0.7 ? STEP * 2.2 : STEP * 0.92;
      tone(musicGain, t, dur, freq(pick) * oct, rng() > 0.5 ? 'square' : 'triangle', 0.075, 4200);
    }

    // percussion: kick on 1/3, snare on 2/4, hats on every offbeat
    if (inBar % 8 === 0 || inBar % 8 === 4) {
      tone(musicGain, t, 0.09, 150, 'sine', 0.28, 260);          // kick
    }
    if (inBar % 8 === 2 || inBar % 8 === 6) {
      noiseHit(musicGain, t, 0.07, 0.16, 'bandpass', 1900, 0.7); // snare
    }
    if (inBar % 2 === 1) {
      noiseHit(musicGain, t, 0.03, 0.05, 'highpass', 6200);      // hat
    }
  }

  function tick() {
    while (nextNoteTime < ctx.currentTime + LOOKAHEAD) {
      scheduleStep(stepIndex, nextNoteTime);
      stepIndex++;
      nextNoteTime += STEP;
    }
  }

  // ------------------------------------------------------------------ controls

  function startMusic() {
    if (!unlock()) return false;
    if (Audio_.musicOn) return true;
    Audio_.musicOn = true;
    stepIndex = 0;
    nextNoteTime = ctx.currentTime + 0.08;
    musicGain.gain.cancelScheduledValues(ctx.currentTime);
    musicGain.gain.setValueAtTime(0.0001, ctx.currentTime);
    musicGain.gain.linearRampToValueAtTime(Audio_.muted ? 0.0001 : 0.34, ctx.currentTime + 0.9);
    timerId = global.setInterval(tick, 25);
    tick();
    return true;
  }

  function stopMusic() {
    Audio_.musicOn = false;
    if (timerId) { global.clearInterval(timerId); timerId = null; }
    if (ctx && musicGain) {
      musicGain.gain.cancelScheduledValues(ctx.currentTime);
      musicGain.gain.setValueAtTime(musicGain.gain.value, ctx.currentTime);
      musicGain.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    }
  }

  function setMuted(m) {
    Audio_.muted = !!m;
    if (ctx && musicGain) {
      musicGain.gain.cancelScheduledValues(ctx.currentTime);
      musicGain.gain.setValueAtTime(Math.max(0.0001, musicGain.gain.value), ctx.currentTime);
      musicGain.gain.linearRampToValueAtTime(Audio_.muted ? 0.0001 : 0.34, ctx.currentTime + 0.25);
    }
    return Audio_.muted;
  }

  function toggleMute() { return setMuted(!Audio_.muted); }

  // ------------------------------------------------------------------- effects

  var SFX = {
    jump: function (t, m) {
      tone(sfxGain, t, 0.18, 300, 'square', 0.22, 3000, m);
      var osc = ctx.createOscillator(); var g = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(320 * m, t);
      osc.frequency.exponentialRampToValueAtTime(760 * m, t + 0.16);
      env(g, t, 0.18, 0.2, 0.005, 0.06);
      osc.connect(g); g.connect(sfxGain); osc.start(t); osc.stop(t + 0.26);
    },
    coin: function (t, m) {
      tone(sfxGain, t, 0.07, freq('E5'), 'square', 0.2, 5000, m);
      tone(sfxGain, t + 0.06, 0.16, freq('B5'), 'square', 0.18, 6000, m);
    },
    gem: function (t, m) {
      tone(sfxGain, t, 0.06, freq('A5'), 'triangle', 0.2, 6000, m);
      tone(sfxGain, t + 0.05, 0.07, freq('C6'), 'triangle', 0.18, 6000, m);
      tone(sfxGain, t + 0.11, 0.2, freq('E6'), 'triangle', 0.16, 6000, m);
    },
    stomp: function (t, m) {
      tone(sfxGain, t, 0.1, 220, 'sawtooth', 0.22, 1200, m);
      noiseHit(sfxGain, t, 0.09, 0.18, 'lowpass', 1400, 1, m);
    },
    bump: function (t, m) {
      tone(sfxGain, t, 0.07, 160, 'square', 0.2, 900, m);
      noiseHit(sfxGain, t, 0.05, 0.12, 'lowpass', 900, 1, m);
    },
    hurt: function (t, m) {
      var osc = ctx.createOscillator(); var g = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(560 * m, t);
      osc.frequency.exponentialRampToValueAtTime(120 * m, t + 0.42);
      env(g, t, 0.42, 0.2, 0.004, 0.1);
      osc.connect(g); g.connect(sfxGain); osc.start(t); osc.stop(t + 0.5);
    },
    splash: function (t, m) {
      noiseHit(sfxGain, t, 0.3, 0.2, 'lowpass', 1100, 1, m);
      var osc = ctx.createOscillator(); var g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(420 * m, t);
      osc.frequency.exponentialRampToValueAtTime(90 * m, t + 0.3);
      env(g, t, 0.3, 0.18, 0.003, 0.1);
      osc.connect(g); g.connect(sfxGain); osc.start(t); osc.stop(t + 0.4);
    },
    die: function (t) {
      var notes = ['C5', 'B4', 'A4', 'G4', 'F4', 'E4', 'D4', 'C4'];
      for (var i = 0; i < notes.length; i++) {
        tone(sfxGain, t + i * 0.09, 0.1, freq(notes[i]), 'square', 0.16, 4000);
      }
    },
    powerup: function (t) {
      var up = ['C4', 'E4', 'G4', 'C5', 'E5', 'G5'];
      for (var i = 0; i < up.length; i++) {
        tone(sfxGain, t + i * 0.05, 0.1, freq(up[i]), 'triangle', 0.2, 6000);
      }
    },
    flag: function (t) {
      var up = ['C4', 'E4', 'G4', 'C5'];
      for (var i = 0; i < up.length; i++) tone(sfxGain, t + i * 0.12, 0.14, freq(up[i]), 'square', 0.2, 5000);
      for (var j = 0; j < 6; j++) tone(sfxGain, t + 0.5 + j * 0.1, 0.1, freq(['C5', 'E5', 'G5', 'C6', 'G5', 'E5'][j]), 'square', 0.16, 6000);
    },
    win: function (t) {
      var mel = [['C4', 0], ['C4', 0.12], ['C4', 0.24], ['G3', 0.38], ['F4', 0.52], ['C4', 0.78], ['F4', 0.9], ['G4', 1.02], ['C5', 1.14], ['G4', 1.3], ['C5', 1.42]];
      for (var i = 0; i < mel.length; i++) {
        tone(sfxGain, t + mel[i][1], 0.22, freq(mel[i][0]), 'square', 0.2, 5000);
        tone(sfxGain, t + mel[i][1], 0.22, freq(mel[i][0]) * 0.5, 'triangle', 0.1, 3000);
      }
    },
    checkpoint: function (t) {
      tone(sfxGain, t, 0.1, freq('G4'), 'triangle', 0.18, 5000);
      tone(sfxGain, t + 0.08, 0.18, freq('D5'), 'triangle', 0.16, 5000);
    },
    pause: function (t) {
      tone(sfxGain, t, 0.08, freq('D5'), 'square', 0.14, 4000);
      tone(sfxGain, t + 0.07, 0.1, freq('A4'), 'square', 0.14, 4000);
    },
    select: function (t) {
      tone(sfxGain, t, 0.09, freq('A4'), 'square', 0.18, 5000);
      tone(sfxGain, t + 0.07, 0.12, freq('E5'), 'square', 0.16, 5000);
    }
  };

  /**
   * Play a named sound effect.
   * @param {string} name  one of the SFX keys
   * @param {number} [pitchMul] optional pitch multiplier (coin-combo ladders etc.)
   */
  function sfx(name, pitchMul) {
    if (!Audio_.ready || Audio_.muted) return false;
    var fn = SFX[name];
    if (!fn || !ctx) return false;
    try { fn(ctx.currentTime + 0.001, pitchMul || 1); } catch (err) { /* audio must never kill the loop */ }
    return true;
  }

  // -------------------------------------------------------------------- public

  Audio_.unlock = unlock;
  Audio_.startMusic = startMusic;
  Audio_.stopMusic = stopMusic;
  Audio_.setMuted = setMuted;
  Audio_.toggleMute = toggleMute;
  Audio_.sfx = sfx;
  Audio_.hasSfx = function (name) { return !!SFX[name]; };
})(window);
