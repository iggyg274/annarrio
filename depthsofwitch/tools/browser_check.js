#!/usr/bin/env node
// Drive headless Firefox over WebDriver BiDi: load the game, collect console errors, run
// optional JS steps, and save screenshots. Dev tool only.
// Usage: node tools/browser_check.js <outdir> '<json steps>'
//   steps: [{"url": "..."}, {"wait": 1500}, {"eval": "js"}, {"keys": "jjjl"}, {"shot": "name"}]
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const FIREFOX = process.env.FIREFOX || '/snap/firefox/current/usr/lib/firefox/firefox';
const outDir = path.resolve(process.argv[2] || '.scratch/shots');
const steps = JSON.parse(process.argv[3] || '[]');
const W = +(process.env.W || 1400), H = +(process.env.H || 900);
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(path.resolve('.scratch'), { recursive: true });
const prof = fs.mkdtempSync(path.join(path.resolve('.scratch'), 'ffprof-'));
fs.writeFileSync(path.join(prof, 'user.js'), 'user_pref("remote.active-protocols", 1);\n');

const port = 9300 + Math.floor(Math.random() * 500);
const ff = spawn(FIREFOX, ['--headless', '--profile', prof, '--remote-debugging-port', String(port),
  '--width', String(W), '--height', String(H), 'about:blank'],
  { env: { ...process.env, HOME: prof, XDG_RUNTIME_DIR: prof, MOZ_HEADLESS_WIDTH: String(W), MOZ_HEADLESS_HEIGHT: String(H) }, stdio: ['ignore', 'ignore', 'pipe'] });
let ready = false;
ff.stderr.on('data', d => { if (/WebDriver BiDi listening/.test(String(d))) ready = true; });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, nextId = 1;
const pending = new Map();
const consoleLines = [];

function send(method, params) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject, method }));
}

(async () => {
  for (let i = 0; i < 150 && !ready; i++) await sleep(100);
  if (!ready) throw new Error('firefox did not start BiDi');
  ws = new WebSocket(`ws://127.0.0.1:${port}/session`);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id);
      if (msg.type === 'error') p.reject(new Error(p.method + ': ' + msg.error + ' ' + msg.message)); else p.resolve(msg.result);
    } else if (msg.method === 'log.entryAdded') {
      const e = msg.params;
      consoleLines.push(`[${e.level}] ${e.text}${e.stackTrace && e.stackTrace.callFrames && e.stackTrace.callFrames[0] ? ' @' + e.stackTrace.callFrames[0].url.split('/').pop() + ':' + e.stackTrace.callFrames[0].lineNumber : ''}`);
    }
  };
  await send('session.new', { capabilities: {} });
  await send('session.subscribe', { events: ['log.entryAdded'] });
  const tree = await send('browsingContext.getTree', {});
  const ctx = tree.contexts[0].context;
  await send('browsingContext.setViewport', { context: ctx, viewport: { width: W, height: H } });
  const evaluate = async (expr) => {
    const r = await send('script.evaluate', { expression: expr, target: { context: ctx }, awaitPromise: true });
    if (r.type === 'exception') return 'EXCEPTION: ' + JSON.stringify(r.exceptionDetails.text);
    return r.result && ('value' in r.result) ? r.result.value : r.result && r.result.type;
  };
  for (const st of steps) {
    if (st.url) await send('browsingContext.navigate', { context: ctx, url: st.url, wait: 'complete' });
    if (st.wait) await sleep(st.wait);
    if (st.eval) console.log('eval:', JSON.stringify(await evaluate(st.eval)).slice(0, 2000));
    if (st.keys) {
      // plain characters; "{Name}" sends a named key, e.g. {ArrowLeft} {Escape} {Enter}
      const list = st.keys.match(/\{[A-Za-z0-9]+\}|./g);
      for (const k of list) {
        const key = k.length > 1 ? k.slice(1, -1) : k;
        const shift = key.length === 1 && key !== key.toLowerCase();
        await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', {key: ${JSON.stringify(key)}, shiftKey: ${shift}, bubbles: true})); 1`);
        await sleep(st.delay || 120);
      }
    }
    if (st.shot) {
      const r = await send('browsingContext.captureScreenshot', { context: ctx });
      const file = path.join(outDir, st.shot + '.png');
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
      console.log('saved', file);
    }
  }
  console.log('--- console ---\n' + (consoleLines.join('\n') || '(none)'));
  ff.kill('SIGTERM');
  setTimeout(() => { fs.rmSync(prof, { recursive: true, force: true }); process.exit(0); }, 800);
})().catch(e => { console.error('ERROR', e.message); console.log(consoleLines.join('\n')); ff.kill('SIGKILL'); process.exit(1); });
