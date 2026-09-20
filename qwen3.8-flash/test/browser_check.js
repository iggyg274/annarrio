/* Browser check: loads index.html in headless Chromium over http://localhost,
   plays a bit, teleports to landmarks, saves screenshots, reports JS errors and
   any magenta "asset failed to draw" pixels found on the canvas.
   Needs: PLAYWRIGHT_BROWSERS_PATH=/tmp/pw-browsers node test/browser_check.js [port] */
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const PORT = process.argv[2] || 8765;
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
  const errors = [], failedReqs = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('requestfailed', (r) => failedReqs.push(r.url() + ' :: ' + ((r.failure() || {}).errorText)));

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900); // assets load + title screen up

  const canvasStats = () => page.evaluate(() => {
    const c = document.getElementById('game'), g = c.getContext('2d');
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let magenta = 0; const seen = new Set();
    for (let i = 0; i < d.length; i += 4) {
      seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
      if (Math.abs(d[i] - 230) < 35 && d[i + 1] < 95 && Math.abs(d[i + 2] - 214) < 35) magenta++;
    }
    return { magentaPixels: magenta, distinctColors: seen.size };
  });

  const title = await canvasStats();
  await page.screenshot({ path: path.join(SHOTS, '1_title.png') });

  // start the game (trusted gesture -> audio unlocks) and run right with jumps
  await page.keyboard.press('Space');
  await page.waitForTimeout(350);
  const started = await page.evaluate(() => AA.Game._state().mode);
  const audio1 = await page.evaluate(() => AA.Sound.debugState());
  await page.keyboard.down('Shift'); await page.keyboard.down('ArrowRight');
  for (let i = 0; i < 9; i++) { await page.keyboard.press('Space', { delay: 120 }); await page.waitForTimeout(480); }
  await page.screenshot({ path: path.join(SHOTS, '2_run.png') });
  await page.keyboard.up('ArrowRight'); await page.keyboard.up('Shift');
  const run = await page.evaluate(() => {
    const s = AA.Game._state();
    return { x: Math.round(s.player.x), mode: s.mode, coins: s.coinCount, score: s.score, hearts: s.player.hearts };
  });

  // teleport checkpoints for scenery shots (y in tiles, drops to ground)
  const sceneStats = {};
  const hop = async (xTiles, yTiles, file, waitMs) => {
    await page.evaluate(([xt, yt]) => { const s = AA.Game._state(); s.player.x = xt * 18; s.player.y = yt * 18; }, [xTiles, yTiles]);
    await page.waitForTimeout(waitMs || 700);
    sceneStats[file] = await canvasStats();
    await page.screenshot({ path: path.join(SHOTS, file) });
  };
  await hop(9, 15, '3_diag.png');       // start area with sign + bench
  await hop(78, 15, '4_statest.png');   // deli storefront label
  await hop(117, 12, '5_burton.png');   // burton tower zone (chime)
  await hop(146.5, 14, '6_river.png');  // stepping stone over the Huron
  await hop(196, 15, '7_stadium.png');  // big house facade

  // win: nudge into the goal flag
  await page.evaluate(() => { const s = AA.Game._state(); s.player.x = s.level.goal.x - 6; s.player.y = 16 * 18; });
  await page.waitForTimeout(900);
  const endMode = await page.evaluate(() => AA.Game._state().mode);
  await page.screenshot({ path: path.join(SHOTS, '8_win.png') });

  const summary = { errors, failedReqs, title, started, audio: audio1, run, endMode, sceneStats };
  console.log(JSON.stringify(summary, null, 1));

  // hard failures: JS errors, missing assets (magenta boxes), blank canvas, no win, music not running
  const bad = [];
  if (errors.length) bad.push('page errors');
  if (failedReqs.length) bad.push('failed requests');
  if (title.distinctColors < 100) bad.push('blank title canvas');
  Object.entries(sceneStats).forEach(([f, s]) => {
    if (s.magentaPixels > 0) bad.push(f + ': ' + s.magentaPixels + ' fallback-box pixels');
    if (s.distinctColors < 100) bad.push(f + ': blank canvas');
  });
  if (endMode !== 'win') bad.push('did not reach win state');
  if (audio1.hasCtx && !audio1.playing) bad.push('music not playing after start');
  if (bad.length) { console.error('BROWSER-CHECK FAILURES: ' + bad.join('; ')); await browser.close(); process.exit(1); }
  console.log('BROWSER-CHECK OK');
  await browser.close();
})().catch((e) => { console.error('BROWSER-CHECK-FAIL', e); process.exit(1); });
