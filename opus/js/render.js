'use strict';
// ---------------------------------------------------------------------------
// Drawing helpers shared by the level decorations and the game renderer.
// World units: 1 unit = 1 Kenney pixel (tiles are 18 units). The canvas is
// drawn at 2x, so urban-tileset sprites drawn at scale 0.5 land on the screen
// at their native pixel size.
// ---------------------------------------------------------------------------

const VIEW_W = 480;
const VIEW_H = 270;
const GROUND_Y = 12 * TILE;

const R = {
  ctx: null,

  tile(id, x, y, flip = false) {
    const img = Assets.tiles[id];
    if (!img) return;
    const c = this.ctx;
    if (flip) {
      c.save();
      c.translate(Math.round(x) + TILE, Math.round(y));
      c.scale(-1, 1);
      c.drawImage(img, 0, 0);
      c.restore();
    } else {
      c.drawImage(img, Math.round(x), Math.round(y));
    }
  },

  char(id, x, y, flip = false, sy = 1, rot = 0) {
    const img = Assets.chars[id];
    if (!img) return;
    const c = this.ctx;
    c.save();
    c.translate(Math.round(x) + 12, Math.round(y) + 24);
    if (rot) {
      c.translate(0, -12);
      c.rotate(rot);
      c.translate(0, 12);
    }
    c.scale(flip ? -1 : 1, sy);
    c.drawImage(img, -12, -24);
    c.restore();
  },

  // Draws an urban-tileset sprite with its bottom-left corner at (x, yBottom).
  urban(id, x, yBottom, s = 0.5, flip = false) {
    const r = URBAN[id];
    if (!r || !Assets.urban) return { w: 0, h: 0 };
    const w = r[2] * s;
    const h = r[3] * s;
    const c = this.ctx;
    if (flip) {
      c.save();
      c.translate(x + w, yBottom - h);
      c.scale(-1, 1);
      c.drawImage(Assets.urban, r[0], r[1], r[2], r[3], 0, 0, w, h);
      c.restore();
    } else {
      c.drawImage(Assets.urban, r[0], r[1], r[2], r[3], x, yBottom - h, w, h);
    }
    return { w, h };
  },

  // Tiles an urban sprite to fill a rect (clipped).
  urbanFill(id, x, y, w, h, s = 0.5) {
    const r = URBAN[id];
    if (!r || !Assets.urban) return;
    const c = this.ctx;
    const tw = r[2] * s;
    const th = r[3] * s;
    c.save();
    c.beginPath();
    c.rect(x, y, w, h);
    c.clip();
    for (let yy = y; yy < y + h; yy += th) {
      for (let xx = x; xx < x + w; xx += tw) {
        c.drawImage(Assets.urban, r[0], r[1], r[2], r[3], xx, yy, tw + 0.2, th + 0.2);
      }
    }
    c.restore();
  },

  text(str, x, y, o = {}) {
    const c = this.ctx;
    const size = o.size || 8;
    c.font = `${o.weight || 'bold'} ${size}px ${o.font || '"Trebuchet MS", Verdana, Arial, sans-serif'}`;
    c.textAlign = o.align || 'center';
    c.textBaseline = o.baseline || 'middle';
    if (o.outline) {
      c.lineJoin = 'round';
      c.lineWidth = o.outlineW || 2.5;
      c.strokeStyle = o.outline;
      c.strokeText(str, x, y);
    }
    if (o.shadow) {
      c.fillStyle = o.shadow;
      c.fillText(str, x + (o.shadowOff ?? 1), y + (o.shadowOff ?? 1));
    }
    c.fillStyle = o.color || '#fff';
    c.fillText(str, x, y);
    return c.measureText(str).width;
  },

  measure(str, size, font) {
    const c = this.ctx;
    c.font = `bold ${size}px ${font || '"Trebuchet MS", Verdana, Arial, sans-serif'}`;
    return c.measureText(str).width;
  },

  // A signboard centered at cx with its top at y. Returns {x, y, w, h}.
  board(lines, cx, y, o = {}) {
    const c = this.ctx;
    if (typeof lines === 'string') lines = [lines];
    const size = o.size || 7;
    const sub = o.subSize || Math.max(4, size - 2.5);
    const pad = o.pad ?? 4;
    let w = 0;
    lines.forEach((ln, i) => { w = Math.max(w, this.measure(ln, i === 0 ? size : sub)); });
    w = Math.ceil(w + pad * 2);
    if (o.minW) w = Math.max(w, o.minW);
    const lh = [size + 2, ...lines.slice(1).map(() => sub + 2)];
    const h = Math.ceil(lh.reduce((a, b) => a + b, 0) + pad * 1.2);
    const x = Math.round(cx - w / 2);
    if (o.posts) {
      c.fillStyle = o.postColor || '#5b4636';
      const ph = o.posts;
      c.fillRect(x + 4, y + h, 3, ph);
      c.fillRect(x + w - 7, y + h, 3, ph);
    }
    if (o.pole) {
      c.fillStyle = '#6b7280';
      c.fillRect(Math.round(cx) - 1.5, y + h, 3, o.pole);
    }
    c.fillStyle = o.border || '#1d2340';
    c.fillRect(x - 1, y - 1, w + 2, h + 2);
    c.fillStyle = o.bg || '#243a73';
    c.fillRect(x, y, w, h);
    if (o.inner) {
      c.strokeStyle = o.inner;
      c.lineWidth = 1;
      c.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
    }
    if (o.bulbs) {
      const on = Math.floor(o.t * 6) % 2;
      for (let bx = x + 2; bx < x + w - 1; bx += 5) {
        for (const by of [y + 1.5, y + h - 1.5]) {
          c.fillStyle = (Math.round(bx / 5) % 2) === on ? '#fff6b0' : '#b8872e';
          c.fillRect(bx, by - 1, 2, 2);
        }
      }
    }
    let ty = y + pad * 0.6;
    lines.forEach((ln, i) => {
      const s = i === 0 ? size : sub;
      ty += lh[i] / 2;
      this.text(ln, cx, ty + 0.5, { size: s, color: i === 0 ? (o.fg || '#ffcb05') : (o.subFg || o.fg || '#e8ecf5'), shadow: o.textShadow });
      ty += lh[i] / 2;
    });
    return { x, y, w, h };
  },

  // HUD digits from the Kenney number glyph tiles (160..169 = 0..9).
  digits(str, x, y) {
    for (let i = 0; i < str.length; i++) {
      const d = str.charCodeAt(i) - 48;
      if (d >= 0 && d <= 9) this.tile(160 + d, x + i * 9 - 4, y - 2);
    }
    return str.length * 9;
  },
};

// ---------------------------------------------------------------------------
// Composite decorations built out of generic sprites + text signage.
// ---------------------------------------------------------------------------
const Deco = {
  // A downtown building: tiled wall texture, window rows, storefront, sign.
  building(o) {
    const c = R.ctx;
    const storeH = o.store === 65 ? 50 : 34;
    const floorH = o.floorH || 38;
    const top = GROUND_Y - storeH - (o.floors || 1) * floorH - 4;
    const x = o.x;
    const w = o.w;
    R.urbanFill(o.wall || 49, x, top, w, GROUND_Y - top, o.wallScale || 0.5);
    if (o.tint) {
      c.save();
      c.globalCompositeOperation = 'multiply';
      c.fillStyle = o.tint;
      c.fillRect(x, top, w, GROUND_Y - top);
      c.restore();
    }
    // side shading for depth
    c.fillStyle = 'rgba(0,0,20,0.18)';
    c.fillRect(x + w - 4, top, 4, GROUND_Y - top);
    // windows
    const win = o.win || 26;
    const wr = URBAN[win];
    const ws = o.winScale || 0.4;
    const ww = wr[2] * ws;
    const wh = wr[3] * ws;
    const n = Math.max(1, Math.floor((w - 6) / (ww + 6)));
    const gap = (w - n * ww) / (n + 1);
    for (let f = 0; f < (o.floors || 1); f++) {
      const fy = GROUND_Y - storeH - f * floorH - (floorH - wh) / 2;
      for (let i = 0; i < n; i++) {
        const wx = x + gap + i * (ww + gap);
        R.urban(win, wx, fy, ws);
        if (o.lit && ((i * 7 + f * 3 + o.x) % 5 === 0)) {
          c.fillStyle = 'rgba(255,214,90,0.35)';
          c.fillRect(wx + 1, fy - wh + 1, ww - 2, wh - 2);
        }
      }
    }
    // cornice
    R.urbanFill(o.cornice || 61, x - 3, top - 6, w + 6, 8, 0.25);
    // ground floor
    if (o.store === 65) {
      const s = Math.min(0.5, w / 260);
      R.urban(65, x + (w - 260 * s) / 2, GROUND_Y, s);
    } else if (o.store === 10) {
      R.urbanFill(56, x, GROUND_Y - storeH, w, storeH, 0.5);
      R.urban(10, x + (w - 66) / 2, GROUND_Y, 0.5);
    }
    // roof props
    for (const p of o.roof || []) R.urban(p.id, x + p.dx, top - 5, p.s || 0.5, p.flip);
    // sign
    if (o.sign) {
      const sy = o.signY ?? (GROUND_Y - storeH - 18);
      R.board(o.sign, x + w / 2, sy, { size: o.signSize || 8, bg: o.signBg, fg: o.signFg, border: o.signBorder, inner: o.signInner, bulbs: o.bulbs, t: o.t });
    }
    return top;
  },

  streetSign(text, x, t, sub) {
    R.board(sub ? [text, sub] : text, x, GROUND_Y - 62, { size: 6, bg: '#1f7a4a', fg: '#ffffff', border: '#f4f4f4', pole: 62 - 12, pad: 3 });
  },

  lamp(x) {
    R.urban(62, x, GROUND_Y, 0.3);
  },
};
