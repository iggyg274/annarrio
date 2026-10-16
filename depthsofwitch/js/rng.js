// Seeded random number generator (mulberry32) + dice helpers.
(function (root) {
  'use strict';
  const DG = root.DG = root.DG || {};

  class RNG {
    constructor(seed) {
      this.seed = (seed >>> 0) || 1;
      this.state = this.seed;
    }
    next() { // float in [0,1)
      let t = (this.state = (this.state + 0x6D2B79F5) >>> 0);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    int(a, b) { return a + Math.floor(this.next() * (b - a + 1)); } // inclusive
    chance(p) { return this.next() < p; }
    oneIn(n) { return this.int(1, n) === 1; }
    pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(this.next() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    }
    weighted(entries, weightOf) { // entries: array; weightOf(entry) -> number
      let total = 0;
      for (const e of entries) total += Math.max(0, weightOf(e));
      if (total <= 0) return null;
      let r = this.next() * total;
      for (const e of entries) {
        r -= Math.max(0, weightOf(e));
        if (r < 0) return e;
      }
      return entries[entries.length - 1];
    }
    // "2d6+1", "1d4", "7"
    roll(spec) {
      if (typeof spec === 'number') return spec;
      const m = /^(\d+)d(\d+)([+-]\d+)?$/.exec(spec.trim());
      if (!m) return parseInt(spec, 10) || 0;
      let s = 0;
      for (let i = 0; i < +m[1]; i++) s += this.int(1, +m[2]);
      return s + (m[3] ? +m[3] : 0);
    }
  }
  DG.RNG = RNG;
  DG.diceAvg = function (spec) {
    const m = /^(\d+)d(\d+)([+-]\d+)?$/.exec(String(spec));
    if (!m) return +spec || 0;
    return (+m[1]) * (+m[2] + 1) / 2 + (m[3] ? +m[3] : 0);
  };
})(typeof window !== 'undefined' ? window : globalThis);
