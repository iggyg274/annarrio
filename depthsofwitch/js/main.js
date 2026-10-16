// Browser UI: title screen, input, HUD, inventory, minimap, game over.
(function () {
  'use strict';
  const DG = window.DG;
  const A = DG.Assets, U = DG.levelUtil, { T } = DG;
  const $ = (id) => document.getElementById(id);

  let game = null, renderer = null, last = 0, mode = 'title', selectedClass = 'adventurer';
  let travel = null; // queued auto-moves (running / click travel)
  const KEYDIR = {
    ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
    k: [0, -1], j: [0, 1], h: [-1, 0], l: [1, 0], y: [-1, -1], u: [1, -1], b: [-1, 1], n: [1, 1],
    K: [0, -1], J: [0, 1], H: [-1, 0], L: [1, 0], Y: [-1, -1], U: [1, -1], B: [-1, 1], N: [1, 1],
    Home: [-1, -1], PageUp: [1, -1], End: [-1, 1], PageDown: [1, 1],
    Numpad8: [0, -1], Numpad2: [0, 1], Numpad4: [-1, 0], Numpad6: [1, 0],
    Numpad7: [-1, -1], Numpad9: [1, -1], Numpad1: [-1, 1], Numpad3: [1, 1],
  };

  // ------------------------------------------------------------------ boot
  async function boot() {
    A.init(window.ASSET_DATA);
    try { await A.loadImages(); }
    catch (e) { $('loading').textContent = 'Failed to load sprites: ' + e.message + ' (run tools/import_assets.py)'; return; }
    A.buildExtras();
    $('loading').style.display = 'none';
    setupTitle();
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    $('view').addEventListener('click', onClick);
    $('view').addEventListener('mousemove', onHover);
    $('view').addEventListener('mouseleave', () => { $('tooltip').style.display = 'none'; });
    requestAnimationFrame(frame);
    const qs = new URLSearchParams(location.search);
    if (qs.get('autostart')) {
      startGame(qs.get('class') || 'adventurer', qs.get('seed') ? +qs.get('seed') : undefined);
      // debug helpers: ?depth=N jumps down, ?reveal=1 maps the level, ?zoom=1 changes scale
      for (let d = 1; d < +(qs.get('depth') || 1); d++) { game.changeLevel(d + 1, 'down'); }
      if (qs.get('reveal')) window.revealLevel();
      if (qs.get('zoom')) { renderer.fixedScale = +qs.get('zoom'); onResize(); }
      renderer.handleEvents(game.takeEvents());
      updateHUD();
    }
  }
  window.revealLevel = function () {
    const lv = game.level;
    lv.seen.fill(1);
    lv.revealAll = true;
    game.computeFOV();
  }

  function setupTitle() {
    mode = 'title';
    $('title').style.display = 'flex';
    $('gameover').style.display = 'none';
    for (const el of document.querySelectorAll('.class-card')) {
      const cls = el.dataset.cls;
      el.querySelector('.blurb').textContent = DG.CLASSES[cls].blurb;
      el.onclick = () => { selectedClass = cls; startGame(cls); };
      el.onmouseenter = () => { selectedClass = cls; highlightClass(); };
    }
    highlightClass();
    drawBestiary();
  }
  function highlightClass() {
    for (const el of document.querySelectorAll('.class-card')) el.classList.toggle('selected', el.dataset.cls === selectedClass);
  }

  // animated previews on the title screen use the same catalog animations as the game
  const previews = [];
  function addPreview(canvas, sheet, anims, scale) {
    previews.push({ canvas, sheet, anims, scale, t: Math.random() * 3 });
  }
  function drawPreviews(dt) {
    for (const p of previews) {
      if (!p.canvas.isConnected || p.canvas.offsetParent === null) continue;
      p.t += dt;
      const ctx = p.canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, p.canvas.width, p.canvas.height);
      // cycle through the listed animations
      let total = 0;
      const lens = p.anims.map(n => { const a = A.anim(p.sheet, n); const d = a ? a.frames.length * a.frameDuration * (a.playMode === 'LOOP' ? 2 : 1) : 0; total += d; return d; });
      let t = p.t % total, k = 0;
      while (k < lens.length - 1 && t >= lens[k]) { t -= lens[k]; k++; }
      const a = A.anim(p.sheet, p.anims[k]);
      if (!a) continue;
      const fi = Math.floor(t / a.frameDuration) % a.frames.length;
      const f = a.frames[fi], sh = A.sheet(p.sheet);
      const an = sh.anchor || { x: f[2] / 2, y: f[3] };
      const s = p.scale;
      ctx.drawImage(A.images[p.sheet], f[0], f[1], f[2], f[3],
        Math.round(p.canvas.width / 2 - an.x * s), Math.round(p.canvas.height - 6 - an.y * s), f[2] * s, f[3] * s);
    }
  }
  function drawBestiary() {
    const cls = { adventurer: ['idle', 'run', 'attack_slash', 'attack_bow', 'celebrate'], dwarf: ['idle', 'run', 'attack_overhead', 'attack_spin', 'attack_swing'] };
    for (const el of document.querySelectorAll('.class-card')) {
      const c = el.querySelector('canvas');
      if (!previews.find(p => p.canvas === c)) addPreview(c, DG.CLASSES[el.dataset.cls].sheet, cls[el.dataset.cls], 3);
    }
    const box = $('bestiary');
    if (box.childElementCount) return;
    for (const key of Object.keys(DG.MONSTERS)) {
      const d = DG.MONSTERS[key];
      if (!d.sheet) continue;
      const div = document.createElement('div');
      div.className = 'beast';
      const c = document.createElement('canvas'); c.width = 72; c.height = 64;
      div.appendChild(c);
      const name = document.createElement('div');
      name.textContent = d.name;
      div.appendChild(name);
      box.appendChild(div);
      const an = [d.anims.idle, d.anims.move, d.anims.attack].filter((v, i, arr) => v && arr.indexOf(v) === i);
      addPreview(c, d.sheet, an, 2);
    }
  }

  function startGame(cls, seed) {
    game = new DG.Game({ cls, seed });
    window.game = game; // handy for debugging
    if (!renderer) renderer = new DG.Renderer($('view'), game);
    else renderer.setGame(game);
    window.renderer = renderer;
    onResize();
    renderer.handleEvents(game.takeEvents());
    $('title').style.display = 'none';
    $('gameover').style.display = 'none';
    mode = 'play';
    travel = null;
    updateHUD();
  }

  function onResize() {
    if (!renderer) return;
    const r = $('viewwrap').getBoundingClientRect();
    renderer.resize(Math.floor(r.width), Math.floor(r.height));
  }

  // ------------------------------------------------------------------ input
  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (mode === 'title') {
      if (e.key === '1' || e.key === 'a') startGame('adventurer');
      else if (e.key === '2' || e.key === 'd') startGame('dwarf');
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { selectedClass = selectedClass === 'dwarf' ? 'adventurer' : 'dwarf'; highlightClass(); }
      else if (e.key === 'Enter' || e.key === ' ') startGame(selectedClass);
      e.preventDefault();
      return;
    }
    if (mode === 'over') {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') setupTitle();
      e.preventDefault();
      return;
    }
    if (mode === 'help') { closeOverlay(); e.preventDefault(); return; }
    if (mode === 'inventory') { inventoryKey(e); e.preventDefault(); return; }
    if (game.over) return;

    travel = null;
    const key = e.key;
    let dir = KEYDIR[e.code && e.code.startsWith('Numpad') ? e.code : key];
    if (dir) {
      e.preventDefault();
      const run = e.shiftKey || /^[HJKLYUBN]$/.test(key);
      if (run) startRun(dir[0], dir[1]);
      else doAction({ type: 'move', dx: dir[0], dy: dir[1] });
      return;
    }
    switch (key) {
      case '.': case '5': case 'Numpad5': doAction({ type: 'wait' }); break;
      case 's': doAction({ type: 'search' }); break;
      case 'g': case ',': doAction({ type: 'pickup' }); break;
      case '>': doAction({ type: 'stairs', dir: 'down' }); break;
      case '<': doAction({ type: 'stairs', dir: 'up' }); break;
      case 'f': doAction({ type: 'special' }); break;
      case 'i': openInventory('use'); break;
      case 'q': openInventory('use', 'potion'); break;
      case 'r': openInventory('use', 'scroll'); break;
      case 'e': openInventory('use', 'food'); break;
      case 't': openInventory('use', 'bomb'); break;
      case 'd': openInventory('drop'); break;
      case 'x': travelTo(game.level.stairsDown, true); break;
      case '?': openHelp(); break;
      default: return;
    }
    e.preventDefault();
  }

  function doAction(a) {
    const took = game.act(a);
    renderer.handleEvents(game.takeEvents());
    updateHUD();
    if (game.over) setTimeout(showGameOver, 1300);
    return took;
  }

  function startRun(dx, dy) { travel = { kind: 'run', dx, dy, steps: 0 }; }

  function travelTo(target, announce) {
    if (!target) { game.msg('You have not found a way down yet.', 'info'); updateHUD(); return; }
    const lv = game.level;
    if (!lv.seen[U.idx(lv, target.x, target.y)]) { if (announce) { game.msg('You have not found a way down yet.', 'info'); updateHUD(); } return; }
    const path = findPath(game.player.x, game.player.y, target.x, target.y);
    if (path && path.length) travel = { kind: 'path', path };
    else if (announce) { game.msg('You cannot find a way there.', 'info'); updateHUD(); }
  }

  function findPath(sx, sy, tx, ty) {
    const lv = game.level;
    const pass = (l, x, y) => U.cellAt(l, x, y) === T.FLOOR && l.seen[U.idx(l, x, y)] && !game.propAt(l, x, y) &&
      !l.traps.some(t => !t.hidden && t.x === x && t.y === y && !(x === tx && y === ty));
    const dist = DG.bfs(lv, tx, ty, pass);
    if (dist[U.idx(lv, sx, sy)] < 0) return null;
    const path = [];
    let x = sx, y = sy, guard = 0;
    while (!(x === tx && y === ty) && guard++ < 500) {
      let best = null, bd = dist[U.idx(lv, x, y)];
      for (const [dx, dy] of DG.DIRS8) {
        const nx = x + dx, ny = y + dy;
        if (!U.inb(lv, nx, ny)) continue;
        const d = dist[U.idx(lv, nx, ny)];
        if (d >= 0 && d < bd && (dx === 0 || dy === 0 || pass(lv, x + dx, y) || pass(lv, x, y + dy))) { bd = d; best = [dx, dy]; }
      }
      if (!best) return null;
      path.push(best);
      x += best[0]; y += best[1];
    }
    return path;
  }

  function stepTravel() {
    if (!travel || game.over || mode !== 'play') { travel = null; return; }
    const before = monstersInView();
    let took = false;
    if (travel.kind === 'run') {
      const p = game.player;
      const nx = p.x + travel.dx, ny = p.y + travel.dy;
      if (U.cellAt(game.level, nx, ny) !== T.FLOOR || game.monsterAt(nx, ny) || game.propAt(game.level, nx, ny) ||
          game.level.traps.some(t => !t.hidden && t.x === nx && t.y === ny)) { travel = null; return; }
      const roomBefore = game.level.roomId[U.idx(game.level, p.x, p.y)];
      took = doAction({ type: 'move', dx: travel.dx, dy: travel.dy });
      travel && travel.steps++;
      const roomAfter = game.level.roomId[U.idx(game.level, game.player.x, game.player.y)];
      if (travel && (roomBefore !== roomAfter || branches())) travel = null;
    } else {
      const step = travel.path.shift();
      if (!step) { travel = null; return; }
      const p = game.player;
      if (game.monsterAt(p.x + step[0], p.y + step[1])) { travel = null; return; }
      took = doAction({ type: 'move', dx: step[0], dy: step[1] });
      if (travel && !travel.path.length) travel = null;
    }
    if (!took || game.over || monstersInView() > before || (travel && game.interestingAround() && travel.kind === 'run')) travel = null;
    if (game.player.hp < game.player.maxHp / 3 && monstersInView()) travel = null;
  }
  function monstersInView() { return game.level.monsters.filter(m => m.hp > 0 && !m.peaceful && game.canSee(m.x, m.y)).length; }
  function branches() {
    // stop running in corridors at junctions
    const p = game.player, lv = game.level;
    if (lv.roomId[U.idx(lv, p.x, p.y)] >= 0) return false;
    let n = 0;
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) if (U.cellAt(lv, p.x + dx, p.y + dy) === T.FLOOR) n++;
    return n > 2;
  }

  function screenToCell(ev) {
    const r = $('view').getBoundingClientRect();
    const sx = ev.clientX - r.left, sy = ev.clientY - r.top;
    const wx = sx / renderer.scale + renderer.cam.x, wy = sy / renderer.scale + renderer.cam.y;
    return { x: Math.floor(wx / 32), y: Math.floor(wy / 32) };
  }
  function onClick(ev) {
    if (mode !== 'play' || game.over) return;
    const c = screenToCell(ev), p = game.player, lv = game.level;
    if (!U.inb(lv, c.x, c.y)) return;
    const d = Math.max(Math.abs(c.x - p.x), Math.abs(c.y - p.y));
    if (d === 0) { doAction(game.itemsAt(lv, p.x, p.y).length ? { type: 'pickup' } : { type: 'search' }); return; }
    if (d === 1) { doAction({ type: 'move', dx: c.x - p.x, dy: c.y - p.y }); return; }
    const m = game.monsterAt(c.x, c.y);
    if (m && game.canSee(m.x, m.y) && p.cls === 'adventurer') { doAction({ type: 'special' }); return; }
    travelTo(c, false);
  }
  function onHover(ev) {
    if (mode !== 'play') return;
    const c = screenToCell(ev), lv = game.level, tip = $('tooltip');
    if (!U.inb(lv, c.x, c.y) || !lv.seen[U.idx(lv, c.x, c.y)]) { tip.style.display = 'none'; return; }
    const parts = [];
    const vis = lv.visible[U.idx(lv, c.x, c.y)];
    const m = vis && game.monsterAt(c.x, c.y);
    if (game.player.x === c.x && game.player.y === c.y) parts.push('you');
    if (m) parts.push(`${m.name}${m.peaceful ? ' (peaceful)' : ''}${m.awake ? '' : ' (asleep)'} - ${Math.max(0, Math.ceil(100 * m.hp / m.maxHp))}%`);
    for (const it of game.itemsAt(lv, c.x, c.y)) parts.push(game.itemName(it.kind, it.qty));
    const pr = game.propAt(lv, c.x, c.y);
    if (pr) parts.push(pr.type === 'chest' ? (pr.locked ? 'locked chest' : 'chest') : pr.type === 'grave' ? 'gravestone' : 'bench');
    const t = game.trapAt(lv, c.x, c.y);
    if (t && !t.hidden) parts.push(t.type === 'spikes' ? 'spike trap' : t.type === 'trapdoor' ? 'trap door' : 'purple portal (teleport)');
    if (lv.stairsDown && lv.stairsDown.x === c.x && lv.stairsDown.y === c.y) parts.push('ladder down');
    if (lv.stairsUp && lv.stairsUp.x === c.x && lv.stairsUp.y === c.y) parts.push('ladder up');
    if (lv.portal && lv.portal.x === c.x && lv.portal.y === c.y) parts.push('green portal (exit)');
    const cell = U.cellAt(lv, c.x, c.y);
    if (!parts.length) parts.push(cell === T.PIT ? 'chasm' : cell === T.WATER ? 'pool' : cell === T.ROCK ? 'wall' : 'floor');
    tip.textContent = parts.join(', ');
    tip.style.display = 'block';
    const r = $('viewwrap').getBoundingClientRect();
    tip.style.left = (ev.clientX - r.left + 14) + 'px';
    tip.style.top = (ev.clientY - r.top + 12) + 'px';
  }

  // ------------------------------------------------------------------ inventory / help
  let invMode = 'use', invFilter = null;
  function openInventory(m, filter) {
    invMode = m; invFilter = filter || null;
    const p = game.player;
    const list = p.inventory.map((e, i) => ({ e, i })).filter(o => !invFilter || DG.ITEMS[o.e.kind].cls === invFilter);
    if (!list.length) { game.msg(invFilter ? `You have no ${invFilter === 'food' ? 'food' : invFilter + 's'}.` : 'Your pack is empty.', 'info'); updateHUD(); return; }
    mode = 'inventory';
    const box = $('inventory');
    box.innerHTML = '';
    const h = document.createElement('h2');
    h.textContent = invMode === 'drop' ? 'Drop which item?' : 'Use which item?';
    box.appendChild(h);
    list.forEach((o, n) => {
      const row = document.createElement('div');
      row.className = 'inv-row';
      const letter = String.fromCharCode(97 + o.i);
      const c = document.createElement('canvas'); c.width = 32; c.height = 32;
      drawIcon(c, o.e.kind);
      const label = document.createElement('span');
      label.innerHTML = `<b>${letter})</b> ${game.itemName(o.e.kind, o.e.qty)}`;
      row.appendChild(c); row.appendChild(label);
      row.onclick = () => chooseItem(o.i);
      box.appendChild(row);
      void n;
    });
    const f = document.createElement('div');
    f.className = 'hint';
    f.textContent = 'Press a letter, click an item, or Esc to cancel.';
    box.appendChild(f);
    box.style.display = 'block';
  }
  function drawIcon(c, kind) {
    const ctx = c.getContext('2d'), ic = DG.ITEMS[kind].icon;
    ctx.imageSmoothingEnabled = false;
    let r;
    if (ic.region) r = A.region(ic.sheet, ic.region);
    else { const f = A.anim(ic.sheet, ic.anim).frames[0]; r = { x: f[0], y: f[1], w: f[2], h: f[3] }; }
    const s = r.w > 16 ? 1 : 2;
    ctx.drawImage(A.images[ic.sheet], r.x, r.y, r.w, r.h, (32 - r.w * s) / 2, (32 - r.h * s) / 2, r.w * s, r.h * s);
  }
  function inventoryKey(e) {
    if (e.key === 'Escape' || e.key === 'i') { closeOverlay(); return; }
    if (/^[a-t]$/.test(e.key)) {
      const i = e.key.charCodeAt(0) - 97;
      const it = game.player.inventory[i];
      if (it && (!invFilter || DG.ITEMS[it.kind].cls === invFilter)) chooseItem(i);
    }
  }
  function chooseItem(i) {
    closeOverlay();
    doAction(invMode === 'drop' ? { type: 'drop', index: i } : { type: 'use', index: i });
  }
  function openHelp() { mode = 'help'; $('help').style.display = 'block'; }
  function closeOverlay() {
    $('inventory').style.display = 'none';
    $('help').style.display = 'none';
    mode = game && game.over ? 'over' : 'play';
  }

  // ------------------------------------------------------------------ HUD
  function updateHUD() {
    const p = game.player;
    $('hp-text').textContent = `${Math.max(0, p.hp)} / ${p.maxHp}`;
    $('hp-fill').style.width = Math.max(0, 100 * p.hp / p.maxHp) + '%';
    $('hp-fill').style.background = p.hp / p.maxHp > 0.5 ? '#4caf50' : p.hp / p.maxHp > 0.25 ? '#e0b030' : '#d84040';
    const nextXp = DG.XP_LEVELS[p.level] || p.xp;
    const prevXp = DG.XP_LEVELS[p.level - 1] || 0;
    $('xp-fill').style.width = Math.min(100, 100 * (p.xp - prevXp) / Math.max(1, nextXp - prevXp)) + '%';
    $('stat-class').textContent = p.clsDef.name;
    $('stat-level').textContent = p.level;
    $('stat-depth').textContent = game.depth + (game.depth === DG.MAX_DEPTH ? ' (arena)' : '');
    $('stat-gold').textContent = p.gold;
    $('stat-turn').textContent = game.turn;
    const st = [];
    if (p.nutrition < 50) st.push('<span class="bad">Weak</span>');
    else if (p.nutrition < 150) st.push('<span class="warn">Hungry</span>');
    if (p.status.poison) st.push('<span class="bad">Sick</span>');
    if (p.status.haste) st.push('<span class="good">Fast</span>');
    if (p.status.blind) st.push('<span class="bad">Blind</span>');
    const sp = p.clsDef.special;
    st.push(p.specialCd > 0 ? `<span class="dim">${sp.name} ${p.specialCd}</span>` : `<span class="good">${sp.name} ready (f)</span>`);
    $('stat-status').innerHTML = st.join(' ');
    // messages
    const log = $('log');
    const msgs = game.messages.slice(-7);
    log.innerHTML = msgs.map(m => `<div class="msg ${m.cls} ${m.turn < game.turn - 1 ? 'old' : ''}">${escapeHtml(m.text)}</div>`).join('');
    // inventory summary
    const inv = $('inv-list');
    inv.innerHTML = '';
    p.inventory.forEach((e, i) => {
      const row = document.createElement('div');
      row.className = 'inv-mini';
      const c = document.createElement('canvas'); c.width = 32; c.height = 32;
      drawIcon(c, e.kind);
      const s = document.createElement('span');
      s.textContent = `${String.fromCharCode(97 + i)}) ${game.itemName(e.kind, e.qty)}`;
      row.title = 'Click to use';
      row.onclick = () => { if (mode === 'play' && !game.over) doAction({ type: 'use', index: i }); };
      row.appendChild(c); row.appendChild(s);
      inv.appendChild(row);
    });
    drawMinimap();
  }
  function escapeHtml(s) { return s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

  function drawMinimap() {
    const lv = game.level, c = $('minimap'), ctx = c.getContext('2d');
    const s = 3;
    c.width = lv.w * s; c.height = lv.h * s;
    ctx.fillStyle = '#111'; ctx.fillRect(0, 0, c.width, c.height);
    for (let y = 0; y < lv.h; y++) for (let x = 0; x < lv.w; x++) {
      const i = U.idx(lv, x, y);
      if (!lv.seen[i]) continue;
      const cell = lv.cells[i];
      if (cell === T.ROCK) { if (U.isOpen(lv, x, y + 1) || U.isOpen(lv, x, y - 1) || U.isOpen(lv, x - 1, y) || U.isOpen(lv, x + 1, y)) { ctx.fillStyle = '#555'; ctx.fillRect(x * s, y * s, s, s); } continue; }
      ctx.fillStyle = cell === T.PIT ? '#222' : cell === T.WATER ? '#4a6fa5' : (lv.visible[i] ? '#9a9a90' : '#5d5d58');
      ctx.fillRect(x * s, y * s, s, s);
    }
    const dot = (x, y, col) => { ctx.fillStyle = col; ctx.fillRect(x * s - 1, y * s - 1, s + 2, s + 2); };
    if (lv.stairsDown && lv.seen[U.idx(lv, lv.stairsDown.x, lv.stairsDown.y)]) dot(lv.stairsDown.x, lv.stairsDown.y, '#e0a040');
    if (lv.stairsUp && lv.seen[U.idx(lv, lv.stairsUp.x, lv.stairsUp.y)]) dot(lv.stairsUp.x, lv.stairsUp.y, '#a07040');
    if (lv.portal) dot(lv.portal.x, lv.portal.y, '#40e040');
    for (const it of lv.items) if (lv.seen[U.idx(lv, it.x, it.y)]) { ctx.fillStyle = '#ffd700'; ctx.fillRect(it.x * s, it.y * s, s, s); }
    for (const m of lv.monsters) if (m.hp > 0 && game.canSee(m.x, m.y)) dot(m.x, m.y, m.peaceful ? '#8f8' : '#f44');
    dot(game.player.x, game.player.y, '#fff');
  }

  function showGameOver() {
    if (!game.over || mode === 'over') return;
    mode = 'over';
    const g = game, p = g.player;
    $('go-title').textContent = g.over.won ? 'Victory!' : 'You have died';
    $('go-title').className = g.over.won ? 'good' : 'bad';
    $('go-reason').textContent = g.over.reason;
    $('go-stats').innerHTML =
      `<div>${p.clsDef.name}, experience level ${p.level}</div>` +
      `<div>Deepest level: ${g.stats.maxDepth} &middot; Monsters slain: ${g.stats.kills} &middot; Gold: ${p.gold} &middot; Turns: ${g.turn}</div>` +
      `<div class="score">Score: ${g.score()}</div>` + `<div class="dim">Seed ${g.seed}</div>`;
    const key = 'dg_highscores';
    let hs = [];
    try { hs = JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { hs = []; }
    hs.push({ score: g.score(), cls: p.clsDef.name, depth: g.stats.maxDepth, won: g.over.won, date: new Date().toISOString().slice(0, 10) });
    hs.sort((a, b) => b.score - a.score);
    hs = hs.slice(0, 8);
    try { localStorage.setItem(key, JSON.stringify(hs)); } catch (e) { /* file:// may forbid */ }
    $('go-scores').innerHTML = '<h3>Best runs</h3>' + hs.map(h => `<div>${h.score} &middot; ${h.cls} &middot; depth ${h.depth}${h.won ? ' &middot; <span class="good">won</span>' : ''} <span class="dim">${h.date}</span></div>`).join('');
    $('gameover').style.display = 'flex';
  }

  // ------------------------------------------------------------------ loop
  let travelTimer = 0;
  function frame(ts) {
    const dt = Math.min(0.05, (ts - last) / 1000 || 0);
    last = ts;
    drawPreviews(dt);
    if (game && mode !== 'title') {
      if (travel && !renderer.busy()) {
        travelTimer += dt;
        if (travelTimer > 0.06) { travelTimer = 0; stepTravel(); }
      }
      renderer.draw(dt);
    }
    requestAnimationFrame(frame);
  }

  window.addEventListener('load', boot);
})();
