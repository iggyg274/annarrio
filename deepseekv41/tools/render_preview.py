#!/usr/bin/env python3
"""Offline rendering check: runs the built game headlessly, records the canvas
2D calls, replays them in PIL and writes PNGs to build/preview/.

This is how the visual result gets verified without a browser: the same
drawImage(src, sx, sy, sw, sh, dx, dy, dw, dh) calls the game makes at runtime
are executed against the real tileset pixels here.

Run:  python3 tools/render_preview.py
"""
import json, os, re, subprocess, sys, zlib, struct
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'build', 'preview')
REC = os.path.join(ROOT, 'build', 'render_calls.json')

SHOTS = [
    ('01_title', 'title', 40, 'AA.Game.state = "title";'),
    ('02_diag', 'play', 40, 'AA.Game.resetRun(); AA.Game.state = "play"; AA.Game.camX = 0; AA.Game.player.x = 200; AA.Game.player.feetY = 352;'),
    ('03_state_street', 'play', 40, 'AA.Game.resetRun(); AA.Game.state="play"; AA.Game.camX = 29*32 - 300; AA.Game.player.x = AA.Game.camX + 340; AA.Game.player.feetY = 352;'),
    ('04_construct', 'play', 40, 'AA.Game.resetRun(); AA.Game.state="play"; AA.Game.camX = 50*32 - 200; AA.Game.player.x = AA.Game.camX + 260; AA.Game.player.feetY = 352;'),
    ('05_huron', 'play', 40, 'AA.Game.resetRun(); AA.Game.state="play"; AA.Game.camX = 72*32 - 120; AA.Game.player.x = AA.Game.camX + 150; AA.Game.player.feetY = 352;'),
    ('06_burton', 'play', 40, 'AA.Game.resetRun(); AA.Game.state="play"; AA.Game.camX = 78*32; AA.Game.player.x = AA.Game.camX + 220; AA.Game.player.feetY = 352;'),
    ('07_stadium', 'play', 40, 'AA.Game.resetRun(); AA.Game.state="play"; AA.Game.camX = 92*32; AA.Game.player.x = AA.Game.camX + 300; AA.Game.player.feetY = 352;'),
    ('08_grandstand', 'play', 40, 'AA.Game.resetRun(); AA.Game.state="play"; AA.Game.camX = AA.LEVEL.cols*32 - 960; AA.Game.player.x = AA.Game.camX + 700; AA.Game.player.feetY = 352;'),
    ('09_win', 'win', 40, 'AA.Game.resetRun(); AA.Game.state = "win"; AA.Game.score = 4820; AA.Game.timer = 84.5; AA.Game.gems = AA.Game.coins.length; AA.Game.stomps = 7; AA.Game.deaths = 0;'),
    ('10_gameover', 'over', 40, 'AA.Game.resetRun(); AA.Game.state = "over"; AA.Game.score = 1250; AA.Game.timer = 52.2; AA.Game.gems = 9;'),
]


def decode_png(path):
    buf = open(path, 'rb').read()
    assert buf[:4] == b'\x89PNG'
    off, idat = 8, []
    w = h = ct = bd = interlace = 0
    while off < len(buf):
        ln = struct.unpack('>I', buf[off:off + 4])[0]
        typ = buf[off + 4:off + 8]
        data = buf[off + 8:off + 8 + ln]
        if typ == b'IHDR':
            w, h, bd, ct, _, _, interlace = struct.unpack('>IIBBBBB', data)
        elif typ == b'IDAT':
            idat.append(data)
        elif typ == b'IEND':
            break
        off += 12 + ln
    raw = zlib.decompress(b''.join(idat))
    bpp = {2: 3, 6: 4}[ct]
    stride = w * bpp
    out = bytearray(h * stride)
    pos = 0
    for y in range(h):
        f = raw[pos]; pos += 1
        line = raw[pos:pos + stride]; pos += stride
        base = y * stride
        pbase = base - stride
        for i in range(stride):
            a = out[base + i - bpp] if i >= bpp else 0
            b = out[pbase + i] if y > 0 else 0
            c = out[pbase + i - bpp] if (y > 0 and i >= bpp) else 0
            v = line[i]
            if f == 1: v = (v + a) & 255
            elif f == 2: v = (v + b) & 255
            elif f == 3: v = (v + ((a + b) >> 1)) & 255
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                v = (v + (a if (pa <= pb and pa <= pc) else (b if pb <= pc else c))) & 255
            out[base + i] = v
    mode = 'RGBA' if bpp == 4 else 'RGB'
    return Image.frombytes(mode, (w, h), bytes(out)).convert('RGBA')


def parse_color(c):
    if isinstance(c, (list, tuple)):
        r, g, b = c[:3]
        a = c[3] * 255 if len(c) > 3 else 255
        return (int(r), int(g), int(b), int(a))
    c = str(c).strip()
    if c.startswith('#'):
        h = c[1:]
        if len(h) == 3:
            h = ''.join(ch * 2 for ch in h)
        return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 255)
    m = re.match(r'rgba?\(([^)]+)\)', c)
    if m:
        parts = [p.strip() for p in m.group(1).split(',')]
        r, g, b = [float(x) for x in parts[:3]]
        a = float(parts[3]) * 255 if len(parts) > 3 else 255
        return (int(r), int(g), int(b), int(a))
    return (255, 0, 255, 255)


def get_font(size):
    for p in ('/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf',
              '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
              '/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf'):
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, max(6, int(size)))
            except Exception:
                pass
    return ImageFont.load_default()


class Replayer:
    """Executes the recorded 2D calls. Unsupported API use is an error, which
    doubles as a check that the renderer only touches portable canvas features."""

    def __init__(self, w, h, images):
        self.w, self.h = w, h
        self.images = images
        self.buf = Image.new('RGBA', (w, h), (0, 0, 0, 255))
        self.stack = []
        self.st = self.default_state()
        self.path = []
        self.unsupported = {}

    def default_state(self):
        return {'alpha': 1.0, 'fill': (0, 0, 0, 255), 'stroke': (0, 0, 0, 255),
                'lw': 1, 'font': (14, None), 'tx': 0, 'ty': 0, 'sx': 1, 'sy': 1,
                'clip': None, 'fontstr': ''}

    def color(self, c, alpha=None):
        r, g, b, a = parse_color(c)
        m = self.st['alpha'] if alpha is None else alpha
        return (r, g, b, int(a * m))

    def map(self, x, y):
        return (x + self.st['tx'], y + self.st['ty'])

    FULLSCREEN = {'fillRect', 'clearRect'}

    def run(self, calls, raw=False):
        # raw mode drops full-canvas gradient overlays (sky/haze/vignette), which
        # a bounding-box replay cannot approximate - it shows the terrain,
        # sprites, signage and HUD clearly instead of a flat wash.
        for c in calls:
            if raw and c[0] in self.FULLSCREEN:
                a = c[1:]
                if len(a) >= 4 and a[2] >= self.w - 2 and a[3] >= self.h - 2:
                    continue
            m = c[0]
            fn = getattr(self, 'c_' + m, None)
            if fn is None:
                self.unsupported[m] = self.unsupported.get(m, 0) + 1
                continue
            fn(*c[1:])
        return self.buf

    # -- state
    def c_save(self):
        self.stack.append(dict(self.st))

    def c_restore(self):
        if self.stack:
            self.st = self.stack.pop()

    def c_translate(self, x, y):
        self.st['tx'] += x; self.st['ty'] += y

    def c_scale(self, x, y):
        self.st['sx'] *= x; self.st['sy'] *= y

    def c_rotate(self, *_a):
        pass

    def c_setTransform(self, *_a):
        pass

    def c_resetTransform(self):
        self.st['tx'] = self.st['ty'] = 0

    def c_set(self):
        pass

    # -- properties
    def c_globalAlpha(self, v):
        self.st['alpha'] = v

    def c_fillStyle(self, v):
        if isinstance(v, dict) and v.get('__grad__'):
            self.st['fill'] = self.color('#' + str(v.get('__colors', '888888')).lstrip('#'), None)
        else:
            self.st['fill'] = self.color(v)

    def c_strokeStyle(self, v):
        if isinstance(v, dict) and v.get('__grad__'):
            self.st['stroke'] = self.color('#' + str(v.get('__colors', '888888')).lstrip('#'), None)
        else:
            self.st['stroke'] = self.color(v)

    def c_lineWidth(self, v):
        self.st['lw'] = max(1, int(round(v)))

    def c_font(self, v):
        self.st['fontstr'] = v
        m = re.search(r'(\d+(?:\.\d+)?)px', v or '')
        size = float(m.group(1)) if m else 14
        self.st['font'] = (size, get_font(size))

    def c_textBaseline(self, v):
        self.st['baseline'] = v

    def c_textAlign(self, v):
        self.st['align'] = v

    def c_globalCompositeOperation(self, v):
        self.st['comp'] = v

    def c_imageSmoothingEnabled(self, v):
        pass

    # -- shapes
    def c_fillRect(self, x, y, w, h):
        if w <= 0 or h <= 0:
            return
        x, y = self.map(x, y)
        x, y, w, h = int(x), int(y), int(round(w)), int(round(h))
        if w <= 0 or h <= 0:
            return
        col = self.st['fill']
        if col[3] >= 255:
            self.buf.paste(col, (x, y, x + w, y + h))
        else:
            ov = Image.new('RGBA', (w, h), col)
            self.buf.alpha_composite(ov, (x, y))

    def c_strokeRect(self, x, y, w, h):
        self.c_rect(x, y, w, h)
        self.c_stroke()

    def c_clearRect(self, x, y, w, h):
        x, y = self.map(x, y)
        self.buf.paste((0, 0, 0, 0), (int(x), int(y), int(x + w), int(y + h)))

    def c_beginPath(self):
        self.path = []

    def c_closePath(self):
        if self.path:
            self.path.append(('close',))

    def c_moveTo(self, x, y):
        self.path.append(('m', self.map(x, y)))

    def c_lineTo(self, x, y):
        self.path.append(('l', self.map(x, y)))

    def c_rect(self, x, y, w, h):
        self.path = [('rect', (int(x + self.st['tx']), int(y + self.st['ty']), int(round(w)), int(round(h))))]

    def c_arc(self, x, y, r, a0, a1, ccw=False):
        self.path.append(('circle', (self.map(x, y), r)))

    def c_arcTo(self, x1, y1, x2, y2, r):
        self.path.append(('at', (self.map(x1, y1), r)))

    def c_ellipse(self, x, y, rx, ry, rot=0, a0=0, a1=0, ccw=False):
        self.path.append(('ellipse', (self.map(x, y), rx, ry)))

    def c_bezierCurveTo(self, *a):
        self.path.append(('bez', self.map(a[-2], a[-1])))

    def c_quadraticCurveTo(self, *a):
        self.path.append(('bez', self.map(a[-2], a[-1])))

    def _bbox(self):
        xs, ys = [], []
        for item in self.path:
            k = item[0]
            if k == 'm' or k == 'l' or k == 'bez':
                xs.append(item[1][0]); ys.append(item[1][1])
            elif k == 'rect':
                x, y, w, h = item[1]
                xs += [x, x + w]; ys += [y, y + h]
            elif k == 'circle' or k == 'ellipse':
                (cx, cy), r = item[1][0], item[1][1]
                rx = r if k == 'circle' else item[1][1]
                ry = r if k == 'circle' else item[1][2]
                xs += [cx - rx, cx + rx]; ys += [cy - ry, cy + ry]
            elif k == 'at':
                xs.append(item[1][0][0]); ys.append(item[1][0][1])
        if not xs:
            return None
        return (min(xs), min(ys), max(xs), max(ys))

    def c_fill(self):
        # All game fills are axis-ish blobs; a bounding-box fill is close enough
        # for a visual smoke preview and keeps this replayer dependency-free.
        bb = self._bbox()
        if not bb:
            return
        x0, y0, x1, y1 = bb
        self.c_fillRect(x0, y0, x1 - x0, y1 - y0)

    def c_stroke(self):
        bb = self._bbox()
        if not bb:
            return
        x0, y0, x1, y1 = bb
        d = ImageDraw.Draw(self.buf)
        for k in range(self.st['lw']):
            d.rectangle([x0 - k, y0 - k, x1 + k, y1 + k], outline=self.st['stroke'])

    def c_clip(self):
        bb = self._bbox()
        self.st['clip'] = bb

    # -- text
    def c_measureText(self, t):
        return 0

    def c_fillText(self, t, x, y):
        x, y = self.map(x, y)
        size, font = self.st['font']
        d = ImageDraw.Draw(self.buf)
        align = self.st.get('align', 'left')
        baseline = self.st.get('baseline', 'alphabetic')
        text = str(t)
        try:
            tw = d.textlength(text, font=font)
            th = size
        except Exception:
            tw, th = len(text) * size * 0.6, size
        ox = x if align == 'left' else (x - tw / 2 if align == 'center' else x - tw)
        oy = y - th * 0.7 if baseline == 'middle' else (y if baseline == 'top' else y - th)
        d.text((ox, oy), text, font=font, fill=self.st['fill'])

    def c_strokeText(self, t, x, y):
        pass

    # -- images
    def c_drawImage(self, key, *a):
        img = self.images.get(key)
        if img is None:
            raise RuntimeError('unknown image key: %r' % (key,))
        if len(a) == 2:
            dx, dy = a
            sw, sh = img.size
            src = img
            dw, dh = sw, sh
        elif len(a) == 4:
            dx, dy, dw, dh = a
            src = img
            sw, sh = img.size
        elif len(a) == 8:
            sx, sy, sw, sh, dx, dy, dw, dh = a
            src = img.crop((int(sx), int(sy), int(sx + sw), int(sy + sh)))
        else:
            raise RuntimeError('drawImage arity %d' % len(a))
        dw, dh = max(1, int(round(dw))), max(1, int(round(dh)))
        if src.size != (dw, dh):
            src = src.resize((dw, dh), Image.NEAREST)
        if self.st['alpha'] < 1:
            al = src.getchannel('A').point(lambda v: int(v * self.st['alpha']))
            src = src.copy()
            src.putalpha(al)
        dx, dy = self.map(dx, dy)
        self.buf.alpha_composite(src, (int(round(dx)), int(round(dy))))


def main():
    os.makedirs(OUT, exist_ok=True)
    node = os.path.join(HERE, 'render_shots.js')
    print('recording canvas calls ...')
    out = subprocess.run(['node', node, REC], capture_output=True, text=True)
    sys.stdout.write(out.stdout)
    if out.returncode != 0:
        sys.stderr.write(out.stderr)
        sys.exit('render_shots.js failed')

    data = json.load(open(REC))
    images = {}
    for rel in (data['tilesetKey'], data.get('kenneyKey')):
        if not rel:
            continue
        path = os.path.join(ROOT, rel)
        if os.path.exists(path):
            images[rel] = decode_png(path)
            print('  loaded %s %s' % (rel, images[rel].size))

    raw = '--raw' in sys.argv
    print('replaying %d shot(s)%s ...' % (len(data['shots']), ' (raw)' if raw else ''))
    total_unsupported = {}
    for name, calls in data['shots']:
        r = Replayer(data['width'], data['height'], images)
        r.run(calls, raw=raw)
        path = os.path.join(OUT, name + ('_raw' if raw else '') + '.png')
        r.buf.convert('RGB').save(path)
        for k, v in r.unsupported.items():
            total_unsupported[k] = total_unsupported.get(k, 0) + v
        print('  wrote %s' % os.path.relpath(path, ROOT))
    if total_unsupported:
        print('  (canvas calls not replayed: %s)' % total_unsupported)
    print('preview sheets are in %s' % os.path.relpath(OUT, ROOT))


if __name__ == '__main__':
    main()
