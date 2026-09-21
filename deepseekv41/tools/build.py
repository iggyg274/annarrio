#!/usr/bin/env python3
"""Build index.html from index.template.html + src/*.js + src/90_style.css.

The result is a single self-contained file: no network requests, no module
loader, no CORS problems, so double-clicking index.html works and so does
hosting it anywhere.

Run:  python3 tools/build.py
"""
import os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, 'src')

# Explicit order: numeric prefixes already sort correctly, but keeping this
# explicit means a rename can never silently reorder the load sequence. Any
# other .js in src/ (e.g. the generated atlas_data.js) is appended after these,
# sorted by name, so a new generated file is never silently left out of the
# bundle - that is exactly the bug this guards against.
ORDER = [
    '00_util.js',
    '10_sprites.js',
    '15_scales.js',
    'atlas_data.js',
    'kenney_atlas_data.js',
    '20_atlas.js',
    '30_level_data.js',
    '40_audio.js',
    '50_engine.js',
    '55_kenney.js',
    '60_render.js',
    '70_selftest.js',
]
CSS = '90_style.css'


def source_files():
    have = sorted(f for f in os.listdir(SRC) if f.endswith('.js'))
    missing = [f for f in ORDER if f not in have]
    if missing:
        sys.exit('missing source file(s): %s (run the generators in tools/ first)' % ', '.join(missing))
    extra = [f for f in have if f not in ORDER]
    return ORDER + extra


def main():
    tpl_path = os.path.join(ROOT, 'index.template.html')
    tpl = open(tpl_path).read()

    parts = []
    files = source_files()
    for name in files:
        path = os.path.join(SRC, name)
        parts.append('/* ==== %s ==== */\n%s' % (name, open(path).read().rstrip()))

    css = open(os.path.join(SRC, CSS)).read().rstrip()
    js = '\n\n'.join(parts)

    if '/*__CSS__*/' not in tpl or '//__GAME_JS__' not in tpl:
        sys.exit('template is missing its /*__CSS__*/ or //__GAME_JS__ marker')

    out = tpl.replace('/*__CSS__*/', css).replace('//__GAME_JS__', js)
    out_path = os.path.join(ROOT, 'index.html')
    with open(out_path, 'w') as f:
        f.write(out)

    print('built %s' % out_path)
    print('  %d source files, %.1f KB CSS + %.1f KB JS -> %.1f KB total'
          % (len(files), len(css) / 1024, len(js) / 1024, len(out) / 1024))
    print("  sources: " + ", ".join(files))
    # Any leftover template marker would mean a silently broken build.
    for marker in ('__CSS__', '__GAME_JS__'):
        if marker in out:
            sys.exit('marker %s survived the build' % marker)


if __name__ == '__main__':
    main()
