/* Audio smoke test: runs js/audio.js against a fake AudioContext that validates
   Web Audio invariants (no zero-frequency ramps, no exponential ramp to 0, nodes connect). */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let fails = 0, created = { osc: 0, noise: 0 };
function bad(msg) { fails++; console.error('FAIL:', msg); }

function param(name, v = 0) {
  return {
    value: v,
    setValueAtTime(x, t) { if (!(x > 0) && name === 'frequency') bad(name + ': setValueAtTime <= 0'); this.value = x; },
    exponentialRampToValueAtTime(x, t) {
      if (!(x > 0)) bad(name + ': exponentialRamp to ' + x);
      if (!(t >= 0) || !isFinite(t)) bad(name + ': ramp time invalid ' + t);
    },
    linearRampToValueAtTime() {}, setTargetAtTime() {}
  };
}

class FakeCtx {
  constructor() { this.t0 = Date.now(); this.sampleRate = 44100; this.state = 'running'; this.destination = { connect() {} }; }
  get currentTime() { return (Date.now() - this.t0) / 1000; } // advance in real time so the lookahead scheduler runs
  resume() {}
  createGain() { return { gain: param('gain', 1), connect(d) { return d; } }; }
  createOscillator() {
    created.osc++;
    const o = { type: 'sine', frequency: param('frequency', 440), detune: param('detune'), connect(d) { return d; }, start(t) { if (!(t >= 0)) bad('osc.start time'); }, stop(t) {} };
    return o;
  }
  createBufferSource() { created.noise++; return { buffer: null, connect(d) { return d; }, start() {}, stop() {} }; }
  createBiquadFilter() { return { type: '', frequency: param('filter', 1000), connect(d) { return d; } }; }
  createBuffer(ch, len, rate) { return { getChannelData: () => new Float32Array(len) }; }
}

global.window = { AudioContext: FakeCtx };
global.document = undefined;
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'audio.js'), 'utf8'), { filename: 'audio.js' });

// with `window` defined, audio.js binds AA = window, so its namespace lands on window directly
const A = (globalThis.AA && globalThis.AA.Sound) || global.window.Sound;
if (!A.ensure()) bad('ensure() failed with fake AudioContext');
A.startMusic();
// let the lookahead scheduler tick a few times in real time
setTimeout(() => {
  ['jump', 'coin', 'gem', 'stomp', 'bump', 'hurt', 'powerup', 'keyget', 'chest', 'checkpt', 'win', 'gameover'].forEach(n => A.sfx(n));
  A.burtonChime();
  A.toggleMute(); A.sfx('coin'); A.toggleMute();
  A.startMusic(); // double-start should be a no-op
  A.stopMusic();
  if (created.osc < 20) bad('scheduler produced too few oscillators: ' + created.osc);
  console.log(`audio: ${created.osc} oscillators, ${created.noise} noise voices scheduled — ${fails ? fails + ' FAILURES' : 'OK'}`);
  process.exit(fails ? 1 : 0);
}, 350);
