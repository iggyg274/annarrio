/* audio.js — procedural chiptune music + SFX via plain Web Audio API.
   No files, no libraries. Music is a seeded generative loop (varies per playthrough). */
(function () {
  var AA = (typeof window !== 'undefined' ? window : globalThis);

  var ctx = null, master = null, musicBus = null, sfxBus = null;
  var noiseBuf = null;
  var timer = null;
  var step = 0, nextTime = 0;
  var playing = false;
  var muted = false;
  try { muted = (typeof localStorage !== 'undefined') && localStorage.getItem('a2_mute') === '1'; } catch (e) {}

  var BPM = 140;
  var STEP = 60 / BPM / 4; // sixteenth note, seconds

  // --- note helpers -------------------------------------------------------
  function midi(n) { return 440 * Math.pow(2, (n - 69) / 12); }

  // Chord progression: C G Am F | C G F C  (bright & bouncy)
  var PROG = [
    { r: 60, notes: [60, 64, 67] },   // C
    { r: 55, notes: [55, 59, 62] },   // G
    { r: 57, notes: [57, 60, 64] },   // Am
    { r: 53, notes: [53, 57, 60] },   // F
    { r: 60, notes: [60, 64, 67] },   // C
    { r: 55, notes: [55, 59, 62] },   // G
    { r: 53, notes: [53, 57, 60] },   // F
    { r: 60, notes: [60, 64, 67] }    // C
  ];
  var PENTA = [60, 62, 64, 67, 69, 72, 76]; // C major pentatonic pool

  // --- generative melody ---------------------------------------------------
  // Build 4 motifs of 8 steps each from chord tones + pentatonic; the loop
  // arranges them bar-by-bar so it repeats like a real tune but reseeds per run.
  var melodyBars = [];
  function reseedMelody() {
    melodyBars = [];
    for (var b = 0; b < PROG.length; b++) {
      var chord = PROG[b].notes;
      var bar = new Array(16).fill(null);
      // rhythm: pick a step pattern with space to breathe
      var rhythms = [
        [0, 3, 6, 8, 11], [0, 2, 6, 10, 12], [0, 4, 7, 10], [0, 3, 6, 9, 12, 14],
        [0, 2, 4, 8, 12], [0, 5, 8, 13]
      ];
      var pat = rhythms[(Math.random() * rhythms.length) | 0];
      for (var i = 0; i < pat.length; i++) {
        var useChordTone = Math.random() < 0.55;
        var n;
        if (useChordTone) n = chord[(Math.random() * chord.length) | 0] + (Math.random() < 0.4 ? 12 : 0);
        else n = PENTA[(Math.random() * PENTA.length) | 0];
        bar[pat[i]] = { n: n, d: (i < pat.length - 1 ? Math.min(3, pat[i + 1] - pat[i]) : 3) };
      }
      melodyBars.push(bar);
    }
  }

  // --- low-level voices ----------------------------------------------------
  function env(g, t0, peak, a, hold, rel) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + a);
    g.gain.setValueAtTime(Math.max(peak, 0.0002), t0 + a + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + hold + rel);
  }

  function osc(type, freq, t0, peak, a, hold, rel, bus, detune) {
    if (!ctx) return;
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (detune) o.detune.setValueAtTime(detune, t0);
    env(g, t0, peak, a, hold, rel);
    o.connect(g).connect(bus || sfxBus);
    o.start(t0); o.stop(t0 + a + hold + rel + 0.02);
  }

  function noise(t0, peak, dur, bus, lp) {
    if (!ctx || !noiseBuf) return;
    var s = ctx.createBufferSource(); s.buffer = noiseBuf;
    var g = ctx.createGain();
    env(g, t0, peak, 0.002, 0, dur);
    if (lp) { var f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; s.connect(f); }
    s.connect(g).connect(bus || sfxBus);
    s.start(t0); s.stop(t0 + dur + 0.05);
  }

  function slide(type, f0, f1, t0, peak, dur, bus) {
    if (!ctx) return;
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(f1, 20), t0 + dur * 0.9);
    env(g, t0, peak, 0.005, dur * 0.3, dur * 0.6);
    o.connect(g).connect(bus || sfxBus);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  // --- the sequencer -------------------------------------------------------
  function scheduleStep(s, t) {
    var bar = (s >> 4) % PROG.length;
    var local = s & 15;
    var ch = PROG[bar];

    // bass: root on beats, fifth in between
    if (local === 0 || local === 8) osc('triangle', midi(ch.r - 12), t, 0.34, 0.005, STEP * 1.6, STEP * 1.2, musicBus);
    if (local === 4 || local === 12) osc('triangle', midi(ch.r - 12 + 7), t, 0.30, 0.005, STEP * 1.2, STEP, musicBus);
    if (local === 6) osc('triangle', midi(ch.r), t, 0.16, 0.005, STEP * 0.5, STEP * 0.8, musicBus);

    // melody (generated per playthrough)
    var m = melodyBars[bar] && melodyBars[bar][local];
    if (m) {
      osc('square', midi(m.n), t, 0.10, 0.004, STEP * (m.d - 0.4), STEP * 0.6, musicBus);
      osc('triangle', midi(m.n + 12), t, 0.035, 0.004, STEP * (m.d - 0.4), STEP * 0.6, musicBus); // sparkle octave
    }

    // drums: kick on 1 & 3, snare on 2 & 4, hats offbeat
    if (local === 0 || local === 8) slide('sine', 150, 45, t, 0.5, 0.09, musicBus);
    if (local === 4 || local === 12) noise(t, 0.16, 0.07, musicBus, 2400);
    if (local % 4 === 2) noise(t, 0.05, 0.03, musicBus, 7000);

    // quiet arpeggio shimmer every other bar
    if (bar % 2 === 1 && local % 2 === 0) {
      osc('triangle', midi(ch.notes[(local / 2) % 3] + 24), t, 0.028, 0.003, STEP * 0.3, STEP * 0.5, musicBus);
    }
  }

  function tick() {
    if (!ctx || !playing) return;
    while (nextTime < ctx.currentTime + 0.12) {
      scheduleStep(step, nextTime);
      step++;
      nextTime += STEP;
    }
  }

  function ensure() {
    try {
      if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
      var AC = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = muted ? 0 : 0.9;
      master.connect(ctx.destination);
      musicBus = ctx.createGain(); musicBus.gain.value = 0.55; musicBus.connect(master);
      sfxBus = ctx.createGain(); sfxBus.gain.value = 0.8; sfxBus.connect(master);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate);
      var data = noiseBuf.getChannelData(0);
      for (var i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      return true;
    } catch (e) { ctx = null; return false; } // audio is optional — never break the game
  }

  function startMusic() {
    if (!ensure() || playing) return;
    reseedMelody();
    playing = true;
    step = 0; nextTime = ctx.currentTime + 0.06;
    timer = setInterval(tick, 25);
  }
  function stopMusic() {
    playing = false;
    if (timer) { clearInterval(timer); timer = null; }
  }

  // --- SFX -----------------------------------------------------------------
  var SFX = {
    jump:     function () { var t = ctx.currentTime; slide('square', 320, 700, t, 0.25, 0.14); },
    coin:     function () { var t = ctx.currentTime; osc('square', midi(88), t, 0.22, 0.004, 0.04, 0.06); osc('square', midi(95), t + 0.07, 0.22, 0.004, 0.05, 0.14); },
    gem:      function () { var t = ctx.currentTime; [84, 88, 91, 96].forEach(function (n, i) { osc('square', midi(n), t + i * 0.05, 0.18, 0.004, 0.03, 0.1); }); },
    stomp:    function () { var t = ctx.currentTime; slide('square', 500, 90, t, 0.3, 0.09); noise(t, 0.2, 0.06, null, 3000); },
    bump:     function () { var t = ctx.currentTime; osc('square', 140, t, 0.2, 0.004, 0.03, 0.05); },
    hurt:     function () { var t = ctx.currentTime; slide('sawtooth', 360, 70, t, 0.3, 0.32); },
    powerup:  function () { var t = ctx.currentTime; [72, 76, 79, 84].forEach(function (n, i) { osc('square', midi(n), t + i * 0.06, 0.18, 0.004, 0.04, 0.12); }); },
    keyget:   function () { var t = ctx.currentTime; osc('triangle', midi(93), t, 0.25, 0.004, 0.06, 0.1); osc('triangle', midi(98), t + 0.09, 0.25, 0.004, 0.1, 0.25); },
    chest:    function () { var t = ctx.currentTime; noise(t, 0.15, 0.08, null, 1500); [67, 72, 76, 79, 84].forEach(function (n, i) { osc('square', midi(n), t + 0.05 + i * 0.06, 0.18, 0.004, 0.04, 0.14); }); },
    checkpt:  function () { var t = ctx.currentTime; [79, 84, 88].forEach(function (n, i) { osc('triangle', midi(n), t + i * 0.08, 0.25, 0.004, 0.06, 0.2); }); },
    win:      function () { var t = ctx.currentTime; [72, 76, 79, 84, 79, 84, 88].forEach(function (n, i) { osc('square', midi(n), t + i * 0.13, 0.2, 0.004, 0.09, 0.16); osc('triangle', midi(n - 12), t + i * 0.13, 0.15, 0.004, 0.09, 0.16); }); [72, 76, 79, 84].forEach(function (n) { osc('triangle', midi(n), t + 0.95, 0.14, 0.01, 0.3, 0.7); }); },
    gameover: function () { var t = ctx.currentTime; [72, 67, 64, 60].forEach(function (n, i) { osc('triangle', midi(n), t + i * 0.18, 0.22, 0.005, 0.1, 0.25); }); }
  };

  function sfx(name) {
    if (!ensure() || muted) return;
    var f = SFX[name];
    if (f) try { f(); } catch (e) {}
  }

  // Burton Memorial Tower carillon motif (Westminster-style quarters)
  function burtonChime() {
    if (!ensure() || muted) return;
    var t = ctx.currentTime + 0.05;
    [64, 61, 62, 59].forEach(function (n, i) {
      osc('triangle', midi(n), t + i * 0.5, 0.3, 0.01, 0.25, 1.1);
      osc('sine', midi(n + 12), t + i * 0.5, 0.08, 0.01, 0.2, 0.9);
    });
  }

  function toggleMute() {
    muted = !muted;
    try { if (typeof localStorage !== 'undefined') localStorage.setItem('a2_mute', muted ? '1' : '0'); } catch (e) {}
    if (ctx) master.gain.setTargetAtTime(muted ? 0 : 0.9, ctx.currentTime, 0.03);
    return muted;
  }

  AA.Sound = {
    ensure: ensure,
    startMusic: startMusic,
    stopMusic: stopMusic,
    sfx: sfx,
    burtonChime: burtonChime,
    toggleMute: toggleMute,
    isMuted: function () { return muted; },
    debugState: function () { return { hasCtx: !!ctx, state: ctx ? ctx.state : null, playing: playing }; } // for tests
  };
})();
