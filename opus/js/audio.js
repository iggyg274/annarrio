'use strict';
// ---------------------------------------------------------------------------
// Procedural chiptune music + sound effects, pure Web Audio API.
//
// Music is a generative step sequencer: each area ("mood") has a key, tempo,
// chord progression, bass pattern and drum groove. On top of that an arpeggio
// picks a new shape every two bars and a lead melody is re-composed every 16
// bars from a random walk over the scale that snaps to chord tones on strong
// beats (AABA phrasing), so every playthrough sounds a little different.
// ---------------------------------------------------------------------------

const Sound = (() => {
  let ac = null;
  let master, musicBus, sfxBus, noiseBuf, pulse25, pulse12;
  let muted = false;

  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  function makePulse(duty) {
    const n = 48;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    for (let k = 1; k < n; k++) real[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
    return ac.createPeriodicWave(real, imag);
  }

  function init() {
    if (ac) {
      if (ac.state === 'suspended') ac.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master = ac.createGain();
    master.gain.value = muted ? 0 : 0.85;
    master.connect(comp);
    comp.connect(ac.destination);
    musicBus = ac.createGain();
    musicBus.gain.value = 0.34;
    musicBus.connect(master);
    sfxBus = ac.createGain();
    sfxBus.gain.value = 0.6;
    sfxBus.connect(master);
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    pulse25 = makePulse(0.25);
    pulse12 = makePulse(0.125);
    setInterval(schedule, 25);
  }

  // --- primitive voices ----------------------------------------------------
  function tone(o) {
    if (!ac) return;
    const t = o.t ?? ac.currentTime;
    const d = o.d;
    const osc = ac.createOscillator();
    if (o.wave === 'p25') osc.setPeriodicWave(pulse25);
    else if (o.wave === 'p12') osc.setPeriodicWave(pulse12);
    else osc.type = o.wave || 'square';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(o.slide, t + (o.slideT ?? d));
    const g = ac.createGain();
    const peak = o.g ?? 0.3;
    const a = Math.min(o.a ?? 0.004, d * 0.3);
    const hold = Math.max(a + 0.001, d * (o.sus ?? 0.35));
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.setValueAtTime(peak, t + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    let node = osc;
    if (o.lp) {
      const f = ac.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = o.lp;
      osc.connect(f);
      node = f;
    }
    node.connect(g);
    g.connect(o.bus || sfxBus);
    if (o.vib) {
      const lfo = ac.createOscillator();
      const lg = ac.createGain();
      lfo.frequency.value = o.vib;
      lg.gain.value = o.vibAmt ?? o.f * 0.02;
      lfo.connect(lg);
      lg.connect(osc.frequency);
      lfo.start(t);
      lfo.stop(t + d + 0.05);
    }
    osc.start(t);
    osc.stop(t + d + 0.05);
  }

  function noise(o) {
    if (!ac) return;
    const t = o.t ?? ac.currentTime;
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    const f = ac.createBiquadFilter();
    f.type = o.ft || 'highpass';
    f.frequency.setValueAtTime(o.ff || 1000, t);
    if (o.ffTo) f.frequency.exponentialRampToValueAtTime(o.ffTo, t + o.d);
    if (o.q) f.Q.value = o.q;
    const g = ac.createGain();
    g.gain.setValueAtTime(o.g ?? 0.3, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.d);
    src.connect(f);
    f.connect(g);
    g.connect(o.bus || sfxBus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + o.d + 0.05);
  }

  // --- sound effects -------------------------------------------------------
  const sfx = {
    jump() { tone({ f: 250, slide: 620, slideT: 0.14, d: 0.16, wave: 'p25', g: 0.22 }); },
    coin() {
      const t = ac.currentTime;
      tone({ t, f: mtof(83), d: 0.06, wave: 'square', g: 0.16 });
      tone({ t: t + 0.06, f: mtof(88), d: 0.28, wave: 'square', g: 0.16, sus: 0.1 });
    },
    gem() {
      const t = ac.currentTime;
      [84, 88, 91, 96].forEach((m, i) => tone({ t: t + i * 0.05, f: mtof(m), d: 0.12, wave: 'p25', g: 0.15 }));
    },
    stomp() {
      tone({ f: 520, slide: 90, d: 0.16, wave: 'triangle', g: 0.45 });
      noise({ d: 0.08, ff: 1800, ft: 'bandpass', g: 0.25 });
    },
    bump() { tone({ f: 140, slide: 90, d: 0.1, wave: 'triangle', g: 0.5 }); },
    brick() {
      noise({ d: 0.25, ft: 'lowpass', ff: 3000, ffTo: 300, g: 0.5 });
      tone({ f: 300, slide: 60, d: 0.2, wave: 'square', g: 0.12 });
    },
    sprout() {
      const t = ac.currentTime;
      for (let i = 0; i < 8; i++) tone({ t: t + i * 0.045, f: mtof(60 + i * 3), d: 0.05, wave: 'p12', g: 0.15 });
    },
    powerup() {
      const t = ac.currentTime;
      [60, 64, 67, 72, 76, 79, 84].forEach((m, i) => tone({ t: t + i * 0.06, f: mtof(m), d: 0.1, wave: 'square', g: 0.14 }));
    },
    heart() {
      const t = ac.currentTime;
      [72, 76, 79, 84].forEach((m, i) => tone({ t: t + i * 0.08, f: mtof(m), d: 0.16, wave: 'triangle', g: 0.35 }));
    },
    oneup() {
      const t = ac.currentTime;
      [76, 79, 88, 84, 86, 91].forEach((m, i) => tone({ t: t + i * 0.09, f: mtof(m), d: 0.1, wave: 'square', g: 0.15 }));
    },
    hurt() {
      tone({ f: 480, slide: 120, d: 0.35, wave: 'sawtooth', g: 0.2, lp: 2200, vib: 30, vibAmt: 40 });
    },
    die() {
      const t = ac.currentTime;
      [71, 77, 77, 77, 76, 74, 72, 64, 64, 60].forEach((m, i) =>
        tone({ t: t + 0.25 + i * 0.13, f: mtof(m), d: 0.14, wave: 'p25', g: 0.18 }));
    },
    splash() { noise({ d: 0.5, ft: 'lowpass', ff: 2500, ffTo: 200, g: 0.5 }); },
    checkpoint() {
      const t = ac.currentTime;
      [79, 84, 88].forEach((m, i) => tone({ t: t + i * 0.1, f: mtof(m), d: 0.6, wave: 'triangle', g: 0.3, sus: 0.05 }));
    },
    whoosh() { noise({ d: 0.6, ft: 'bandpass', ff: 400, ffTo: 3000, q: 3, g: 0.4 }); },
    trombone() {
      // wah wah wah waaaah — you stepped on the M.
      const t = ac.currentTime;
      const notes = [[63, 0.35], [62, 0.35], [61, 0.35], [60, 1.1]];
      let at = t;
      notes.forEach(([m, d], i) => {
        tone({ t: at, f: mtof(m - 12), d, wave: 'sawtooth', g: 0.3, lp: 900, sus: 0.8, a: 0.04, vib: i === 3 ? 6 : 0, vibAmt: 6 });
        at += d;
      });
    },
    flagpole() {
      const t = ac.currentTime;
      for (let i = 0; i < 14; i++) tone({ t: t + i * 0.05, f: mtof(84 - i), d: 0.06, wave: 'p25', g: 0.12 });
    },
    tick() { tone({ f: mtof(96), d: 0.03, wave: 'square', g: 0.06 }); },
    firework() {
      tone({ f: 900, slide: 200, d: 0.25, wave: 'triangle', g: 0.08 });
      noise({ t: ac.currentTime + 0.22, d: 0.45, ft: 'lowpass', ff: 1400, ffTo: 150, g: 0.45 });
    },
    pause() {
      const t = ac.currentTime;
      [76, 72, 76, 72].forEach((m, i) => tone({ t: t + i * 0.07, f: mtof(m), d: 0.07, wave: 'square', g: 0.12 }));
    },
    select() { tone({ f: mtof(84), d: 0.08, wave: 'p25', g: 0.15 }); tone({ t: ac.currentTime + 0.08, f: mtof(91), d: 0.12, wave: 'p25', g: 0.15 }); },
    clear() {
      // A little maize-and-blue fanfare in Bb.
      const t = ac.currentTime + 0.05;
      const q = 0.14;
      const mel = [[70, 1], [74, 1], [77, 1], [82, 3], [77, 1], [82, 4], [0, 1], [80, 1], [79, 1], [77, 1], [79, 2], [81, 2], [82, 6]];
      let at = t;
      for (const [m, len] of mel) {
        if (m) {
          tone({ t: at, f: mtof(m), d: len * q * 0.95, wave: 'square', g: 0.14, sus: 0.7 });
          tone({ t: at, f: mtof(m - 12), d: len * q * 0.95, wave: 'p25', g: 0.06, sus: 0.7 });
        }
        at += len * q;
      }
      [[46, 0], [51, 6], [53, 10], [46, 14]].forEach(([m, s]) =>
        tone({ t: t + s * q, f: mtof(m), d: 4 * q, wave: 'triangle', g: 0.35, sus: 0.8 }));
      for (let i = 0; i < 22; i += 2) noise({ t: t + i * q, d: 0.05, ff: 6000, g: 0.08 });
    },
  };

  function play(name) {
    if (!ac || muted) return;
    const fn = sfx[name];
    if (fn) fn();
  }

  // --- music ---------------------------------------------------------------
  const QUAL = {
    maj: [0, 4, 7], min: [0, 3, 7], maj7: [0, 4, 7, 11], min7: [0, 3, 7, 10],
    dom7: [0, 4, 7, 10], sus4: [0, 5, 7],
  };
  const SCALE = {
    major: [0, 2, 4, 5, 7, 9, 11], mixo: [0, 2, 4, 5, 7, 9, 10],
    hminor: [0, 2, 3, 5, 7, 8, 11], dorian: [0, 2, 3, 5, 7, 9, 10],
  };
  const DRUMS = {
    //       kick                 snare                hat
    pop:    ['x.....x.x.......', '....x.......x...', 'x.x.x.x.x.x.x.x.'],
    light:  ['x.......x.......', '............x...', '..x...x...x...x.'],
    rock:   ['x.x...x.x.x...x.', '....x.......x..x', 'xxxxxxxxxxxxxxxx'],
    shuffle:['x.....x...x.....', '....x.......x...', 'x..x..x.x..x..x.'],
    march:  ['x.......x.......', '..x.x.xx..x.x.xx', 'x...x...x...x...'],
    none:   ['................', '................', '................'],
  };
  const BASS = {
    pop:    [[0, 0, 3], [6, 0, 1], [8, 7, 3], [12, 12, 1], [14, 7, 2]],
    walk:   [[0, 0, 4], [4, 7, 4], [8, 12, 4], [12, 7, 4]],
    drive:  [[0, 0, 1], [2, 0, 1], [4, 12, 1], [6, 0, 1], [8, 0, 1], [10, 0, 1], [12, 12, 1], [14, 7, 1]],
    march:  [[0, 0, 2], [4, 7, 2], [8, 0, 2], [12, 7, 2], [14, 5, 2]],
    ripple: [[0, 0, 6], [6, 7, 2], [8, 0, 6], [14, 12, 2]],
    pad:    [[0, 0, 16]],
  };
  const MOODS = {
    title:        { bpm: 104, root: 60, scale: 'major', prog: [[0, 'maj7'], [4, 'min7'], [5, 'maj7'], [7, 'dom7']], drums: 'light', bass: 'walk', arpRate: 2, lead: 'p25' },
    downtown:     { bpm: 132, root: 60, scale: 'major', prog: [[0, 'maj'], [9, 'min'], [5, 'maj'], [7, 'dom7']], drums: 'pop', bass: 'pop', arpRate: 2, lead: 'p25' },
    campus:       { bpm: 126, root: 62, scale: 'mixo', prog: [[0, 'maj'], [10, 'maj'], [5, 'maj'], [0, 'maj']], drums: 'shuffle', bass: 'pop', arpRate: 1, lead: 'square' },
    diag:         { bpm: 112, root: 65, scale: 'major', prog: [[0, 'maj7'], [9, 'min7'], [5, 'maj7'], [7, 'sus4']], drums: 'light', bass: 'walk', arpRate: 1, lead: 'p25' },
    construction: { bpm: 144, root: 57, scale: 'hminor', prog: [[0, 'min'], [8, 'maj'], [10, 'maj'], [7, 'maj']], drums: 'rock', bass: 'drive', arpRate: 1, lead: 'p12' },
    river:        { bpm: 116, root: 62, scale: 'major', prog: [[0, 'maj7'], [9, 'min7'], [5, 'maj7'], [7, 'dom7']], drums: 'shuffle', bass: 'ripple', arpRate: 1, lead: 'triangle' },
    stadium:      { bpm: 150, root: 58, scale: 'major', prog: [[0, 'maj'], [5, 'maj'], [7, 'maj'], [0, 'maj'], [9, 'min'], [5, 'maj'], [7, 'dom7'], [7, 'dom7']], drums: 'march', bass: 'march', arpRate: 2, lead: 'square' },
  };
  const RHYTHMS = [
    [[0, 4], [4, 2], [6, 2], [8, 6], [14, 2]],
    [[0, 2], [2, 2], [4, 4], [8, 2], [10, 2], [12, 4]],
    [[0, 6], [6, 2], [8, 8]],
    [[0, 3], [3, 3], [6, 2], [8, 3], [11, 3], [14, 2]],
    [[2, 2], [4, 2], [6, 2], [8, 4], [12, 4]],
    [[0, 2], [4, 2], [6, 2], [8, 2], [10, 6]],
    [[0, 1], [1, 1], [2, 2], [4, 4], [8, 1], [9, 1], [10, 2], [12, 4]],
  ];
  const ARPS = ['up', 'down', 'updown', 'random', 'pedal'];

  let playing = false;
  let moodName = 'title';
  let pendingMood = null;
  let hype = false;
  let nextTime = 0;
  let step = 0;
  let bar = 0;
  let arpShape = 'up';
  let phrase = null; // { A: [bars], B: [bars] }

  function rnd(n) { return Math.floor(Math.random() * n); }

  function scaleNotes(m) {
    const out = [];
    for (let o = -1; o <= 3; o++) for (const s of SCALE[m.scale]) out.push(m.root + o * 12 + s);
    return out;
  }

  function composeBars(m, count) {
    // Random walk over the scale, snapping to chord tones on strong beats.
    const notes = scaleNotes(m);
    const lo = m.root + 10;
    const hi = m.root + 27;
    let idx = notes.findIndex((n) => n >= m.root + 12);
    const bars = [];
    for (let b = 0; b < count; b++) {
      const [croot, q] = m.prog[b % m.prog.length];
      const chordPcs = QUAL[q].map((i) => (m.root + croot + i) % 12);
      const rhythm = RHYTHMS[rnd(RHYTHMS.length)];
      const evs = [];
      for (const [s, len] of rhythm) {
        if (Math.random() < 0.15 && s !== 0) continue; // breathe
        idx += [-2, -1, -1, 0, 1, 1, 2, 3][rnd(8)];
        while (notes[idx] < lo) idx += 2;
        while (notes[idx] > hi) idx -= 2;
        let n = notes[idx];
        if (s % 8 === 0 || len >= 4) {
          // snap to the nearest chord tone
          let best = n;
          for (let d = 0; d <= 6; d++) {
            if (chordPcs.includes((n + d) % 12)) { best = n + d; break; }
            if (chordPcs.includes((n - d + 120) % 12)) { best = n - d; break; }
          }
          n = best;
        }
        evs.push([s, len, n]);
      }
      bars.push(evs);
    }
    return bars;
  }

  function newPhrase() {
    const m = MOODS[moodName];
    const len = m.prog.length;
    phrase = { A: composeBars(m, len), B: composeBars(m, len) };
    arpShape = ARPS[rnd(ARPS.length)];
  }

  function scheduleStep(t) {
    const m = MOODS[moodName];
    const bpm = m.bpm * (hype ? 1.22 : 1);
    const stepDur = 60 / bpm / 4;
    const plen = m.prog.length;
    const [croot, q] = m.prog[bar % plen];
    const chord = QUAL[q].map((i) => m.root + croot + i);
    const bus = musicBus;

    // drums
    const dr = DRUMS[m.drums];
    let snareRow = dr[1];
    if (bar % 4 === 3 && m.drums !== 'light') snareRow = snareRow.slice(0, 12) + 'x.xx';
    if (dr[0][step] === 'x') {
      tone({ t, f: 160, slide: 40, slideT: 0.12, d: 0.14, wave: 'sine', g: 0.9, bus });
    }
    if (snareRow[step] === 'x') {
      noise({ t, d: 0.12, ft: 'bandpass', ff: 1800, q: 0.7, g: 0.55, bus });
      tone({ t, f: 220, slide: 120, d: 0.06, wave: 'triangle', g: 0.25, bus });
    }
    if (dr[2][step] === 'x' || (hype && step % 2 === 1)) {
      noise({ t, d: step % 4 === 2 ? 0.07 : 0.03, ft: 'highpass', ff: 7000, g: 0.22, bus });
    }

    // bass
    for (const [s, off, len] of BASS[m.bass]) {
      if (s === step) {
        tone({ t, f: mtof(m.root + croot - 24 + off), d: len * stepDur * 0.92, wave: 'triangle', g: 0.55, sus: 0.7, bus });
      }
    }

    // arpeggio
    if (step % m.arpRate === 0) {
      const k = step / m.arpRate;
      const tones = [...chord, chord[0] + 12, chord[1] + 12];
      let n;
      switch (arpShape) {
        case 'up': n = tones[k % tones.length]; break;
        case 'down': n = tones[tones.length - 1 - (k % tones.length)]; break;
        case 'updown': {
          const p = tones.length * 2 - 2;
          const i = k % p;
          n = tones[i < tones.length ? i : p - i];
          break;
        }
        case 'pedal': n = k % 2 === 0 ? chord[0] : tones[1 + ((k >> 1) % (tones.length - 1))]; break;
        default: n = tones[rnd(tones.length)];
      }
      tone({ t, f: mtof(n), d: stepDur * m.arpRate * 0.6, wave: 'p12', g: 0.07, bus });
    }

    // lead melody: A A B A
    const section = Math.floor(bar / plen) % 4;
    const bars = section === 2 ? phrase.B : phrase.A;
    const evs = bars[bar % plen];
    for (const [s, len, n] of evs) {
      if (s === step) {
        const d = len * stepDur * 0.9;
        tone({ t, f: mtof(n + (hype ? 12 : 0)), d, wave: m.lead, g: m.lead === 'triangle' ? 0.3 : 0.1, sus: 0.6, bus, vib: len >= 4 ? 5.5 : 0, vibAmt: mtof(n) * 0.012 });
      }
    }
    return stepDur;
  }

  function schedule() {
    if (!ac || !playing) return;
    while (nextTime < ac.currentTime + 0.12) {
      const dur = scheduleStep(nextTime);
      nextTime += dur;
      step++;
      if (step >= 16) {
        step = 0;
        bar++;
        if (pendingMood) {
          moodName = pendingMood;
          pendingMood = null;
          bar = 0;
          newPhrase();
        } else if (bar % (MOODS[moodName].prog.length * 4) === 0) {
          newPhrase();
        } else if (bar % 2 === 0) {
          arpShape = ARPS[rnd(ARPS.length)];
        }
      }
    }
  }

  function startMusic(mood) {
    init();
    if (!ac) return;
    moodName = mood;
    pendingMood = null;
    step = 0;
    bar = 0;
    newPhrase();
    nextTime = ac.currentTime + 0.08;
    playing = true;
  }

  function stopMusic() { playing = false; }

  function setMood(mood) {
    if (!playing) return;
    if (mood !== moodName) pendingMood = mood;
    else pendingMood = null;
  }

  function setHype(on) { hype = on; }

  function toggleMute() {
    muted = !muted;
    if (master) master.gain.setTargetAtTime(muted ? 0 : 0.85, ac.currentTime, 0.02);
    return muted;
  }

  function suspend() { if (ac && ac.state === 'running') ac.suspend(); }
  function resume() { if (ac && ac.state === 'suspended') ac.resume(); }

  return {
    init, play, startMusic, stopMusic, setMood, setHype, toggleMute, suspend, resume,
    get muted() { return muted; },
    get isPlaying() { return playing; },
  };
})();
