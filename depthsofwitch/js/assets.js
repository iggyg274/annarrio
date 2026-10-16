// Asset access + semantics derived from the elthenassets catalog (window.ASSET_DATA).
// Everything the dungeon is built from is looked up here by catalog meaning (stamp names,
// tile roles/tags/names, terrains, regions, animation names), not by magic numbers.
(function (root) {
  'use strict';
  const DG = root.DG = root.DG || {};
  const TILE = 32;

  const A = {
    TILE,
    data: null,
    images: {},

    init(data) {
      this.data = data;
      this.sheets = data.sheets;
      for (const id in this.sheets) {
        const s = this.sheets[id];
        s.columns = Math.floor(s.width / s.frameWidth);
        s.tileById = {};
        if (s.tiles) for (const t of s.tiles) s.tileById[t.id] = t;
      }
      this.themes = {
        dungeon: buildTheme(this, 'elthen.dungeon', {
          frameStamp: 'wall_frame', runStamps: ['wall_run', 'wall_run_2', 'wall_run_3'],
          floors: ['stone', 'dirt'],
        }),
        arena: buildTheme(this, 'elthen.arena', {
          frameStamp: 'enclosure', runStamps: ['wall_run', 'wall_run_2'],
          floors: ['sand'],
        }),
      };
      return this;
    },

    // Browser only: load every sheet image. Resolves when all are ready.
    loadImages() {
      const jobs = [];
      for (const id in this.sheets) {
        const s = this.sheets[id];
        jobs.push(new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('cannot load ' + s.image));
          img.src = s.image;
          this.images[id] = img;
        }));
      }
      return Promise.all(jobs);
    },

    sheet(id) {
      const s = this.sheets[id];
      if (!s) throw new Error('unknown sheet ' + id);
      return s;
    },
    tileRect(sheetId, tileId) {
      const s = this.sheet(sheetId);
      const c = tileId % s.columns, r = Math.floor(tileId / s.columns);
      return { x: c * s.frameWidth, y: r * s.frameHeight, w: s.frameWidth, h: s.frameHeight };
    },
    tileAt(sheetId, col, row) { return row * this.sheet(sheetId).columns + col; },
    region(sheetId, name) {
      const r = this.sheet(sheetId).regions && this.sheet(sheetId).regions[name];
      if (!r) throw new Error('unknown region ' + sheetId + ':' + name);
      return r;
    },
    stamp(sheetId, name) {
      const st = this.sheet(sheetId).stamps && this.sheet(sheetId).stamps[name];
      if (!st) throw new Error('unknown stamp ' + sheetId + ':' + name);
      return st;
    },
    stampRect(sheetId, name) {
      const st = this.stamp(sheetId, name), s = this.sheet(sheetId);
      return { x: st.col * s.frameWidth, y: st.row * s.frameHeight,
               w: st.cols * s.frameWidth, h: st.rows * s.frameHeight };
    },
    tileByName(sheetId, name) {
      const t = this.sheet(sheetId).tiles.find(t => t.name === name);
      if (!t) throw new Error('unknown tile name ' + sheetId + ':' + name);
      return t.id;
    },
    tilesWhere(sheetId, pred) { return this.sheet(sheetId).tiles.filter(pred).map(t => t.id); },
    anim(sheetId, name) {
      const s = this.sheet(sheetId);
      return s.animations && s.animations[name] || null;
    },
    // first animation name that exists on the sheet
    pickAnim(sheetId, names) {
      for (const n of names) if (this.anim(sheetId, n)) return n;
      return null;
    },
  };

  function hasTag(t, tag) { return t.tags && t.tags.indexOf(tag) >= 0; }

  function buildTheme(A, sheetId, opt) {
    const s = A.sheet(sheetId);
    const th = { id: sheetId, sheet: sheetId };

    // Floors: plain fill tiles per terrain (pre-filtered by the importer).
    th.floors = {};
    for (const f of opt.floors) th.floors[f] = s.fillTiles[f].filter(id => {
      const t = s.tileById[id];
      return !(t && t.name === 'floor_cracked'); // reserved: revealed trap doors
    });

    // Walls (3/4 view). The frame stamp is a complete ring around one floor cell:
    //   row 0 caps (wall tops), row 1 brick faces, row 2 side strips + the "band" (a floor
    //   overlay carrying the bottom ledge), row 3 bottom ledges.
    // wall_corner_nw/ne give face/cap pieces that end against floor (inner corners), and
    // wall_step_left/right give a ledge that turns down into a side strip.
    const fr = A.stamp(sheetId, opt.frameStamp);
    const at = (st, dc, dr) => A.tileAt(sheetId, st.col + dc, st.row + dr);
    const cnw = A.stamp(sheetId, 'wall_corner_nw'), cne = A.stamp(sheetId, 'wall_corner_ne');
    const sl = A.stamp(sheetId, 'wall_step_left'), sr = A.stamp(sheetId, 'wall_step_right');
    th.wall = {
      capNW: at(fr, 0, 0), capN: at(fr, 1, 0), capNE: at(fr, 2, 0),
      faceNW: at(fr, 0, 1), faceN: at(fr, 1, 1), faceNE: at(fr, 2, 1),
      sideWb: at(fr, 0, 2), band: at(fr, 1, 2), sideEb: at(fr, 2, 2), // side strips ending in the bottom ledge
      botSW: at(fr, 0, 3), botS: at(fr, 1, 3), botSE: at(fr, 2, 3),
      capCornerE: at(cnw, 1, 0), faceEndE: at(cnw, 1, 1),
      capCornerW: at(cne, 0, 0), faceEndW: at(cne, 0, 1),
      bandStepE: at(sl, 1, 0), innerNE: at(sl, 1, 1),
      bandStepW: at(sr, 0, 0), innerNW: at(sr, 0, 1),
    };
    // Plain side strips: no tile in the sheet is a clean vertical strip (each one carries a
    // bit of a ledge at its top or bottom), so compose one from the clean upper 28 rows of
    // the frame's side tile plus its first 4 rows again.
    const strip = id => [{ id, sy: 0, h: 28, dy: 0 }, { id, sy: 0, h: 4, dy: 28 }];
    th.wall.sideW = strip(th.wall.sideWb);
    th.wall.sideE = strip(th.wall.sideEb);
    // free-standing pillar (3x4 tiles)
    th.tower = A.stampRect(sheetId, 'tower_block');
    th.towerSize = { w: A.stamp(sheetId, 'tower_block').cols, h: A.stamp(sheetId, 'tower_block').rows };
    th.voidColor = s.voidColor || '#2f2f2e';
    // Wall-run stamps give variety for straight caps (top row) and faces (bottom row).
    th.wall.caps = [th.wall.capN];
    th.wall.faces = [th.wall.faceN];
    for (const name of opt.runStamps) {
      const st = A.stamp(sheetId, name);
      // skip the run's last column: it is the run's right end piece, not a repeatable middle
      for (let c = st.col; c < st.col + st.cols - 1; c++) {
        const cap = A.tileAt(sheetId, c, st.row), face = A.tileAt(sheetId, c, st.row + 1);
        const ct = s.tileById[cap], ft = s.tileById[face];
        if (ct && ct.role === 'wall_top') th.wall.caps.push(cap);
        if (ft && ft.role === 'wall' && hasTag(ft, 'brick')) th.wall.faces.push(face);
      }
    }
    // Rare special faces (named in the catalog): cracked, alcove, arrow slit, window.
    th.wall.rareFaces = s.tiles.filter(t => t.role === 'wall' && t.name &&
      /crack|alcove|slot|window/.test(t.name)).map(t => t.id);

    // Water pool ninepatch (arena): 3x3 stamp, middle row/col repeat.
    if (s.stamps.pool) {
      const p = A.stamp(sheetId, 'pool');
      th.pool = (dc, dr) => A.tileAt(sheetId, p.col + dc, p.row + dr);
    }

    // Corner (Wang) tiles: "TL,TR,BR,BL" -> [ids]
    th.corners = {};
    for (const t of s.tiles) {
      if (!t.corners || t.weight === 0) continue;
      const k = t.corners.join(',');
      (th.corners[k] = th.corners[k] || []).push(t.id);
    }
    return th;
  }

  // Dungeon-wide extras (always from elthen.dungeon / shared sheets).
  A.buildExtras = function () {
    const D = 'elthen.dungeon';
    const s = this.sheet(D);
    const ex = {
      stairsDown: this.tileByName(D, 'trapdoor_ladder_down'),
      stairsUp: this.tileByName(D, 'ladder'),
      crackedFloor: this.tileByName(D, 'floor_cracked'),
      // pit tiles with a stone lip on top (northern edge) vs. plain darkness (importer-split)
      pitTop: s.pitTiles.top,
      pitInner: s.pitTiles.inner,
      spikes: this.tilesWhere(D, t => hasTag(t, 'studs')),
      rubble: this.tilesWhere(D, t => hasTag(t, 'rubble') && hasTag(t, 'overlay')),
      pebbles: this.tilesWhere(D, t => hasTag(t, 'pebbles')),
      chainsFloor: this.tilesWhere(D, t => hasTag(t, 'bones') && hasTag(t, 'chains')),
      gravestones: ['gravestone', 'gravestone_cracked', 'gravestone_broken'].map(n => this.stampRect(D, n)),
      vines: ['vines_1', 'vines_2'].map(n => this.stampRect(D, n)),
      bench: this.stampRect(D, 'bench'),
      chest: this.region(D, 'chest'),
      padlock: this.region(D, 'padlock'),
      candle: this.region(D, 'candle'),
      bones: this.region(D, 'bones'),
      skull: this.region(D, 'skull_bones'),
      chains: this.region(D, 'chains'),
      shadowWall: this.region('elthen.shadows', 'wall_long'),
      shadowDoor: this.region('elthen.shadows', 'doorway'),
      arenaGrass: this.tilesWhere('elthen.arena', t => hasTag(t, 'grass')),
      arenaRubble: this.tilesWhere('elthen.arena', t => hasTag(t, 'rubble')),
      arenaBones: this.tilesWhere('elthen.arena', t => hasTag(t, 'bones')),
    };
    this.extras = ex;
    return ex;
  };

  DG.Assets = A;
})(typeof window !== 'undefined' ? window : globalThis);
