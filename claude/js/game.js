// Ann Arbor Adventure -- main game engine (rendering, physics, input, state machine).
// Plain classic scripts (no ES modules / no fetch) so index.html works when opened
// directly from disk via file://.

(function () {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const CANVAS_W = canvas.width;
  const CANVAS_H = canvas.height;

  // ---------------- Physics constants ----------------
  const GRAVITY = 1500;
  const MOVE_SPEED = 210;
  const JUMP_VELOCITY = -540;
  const MAX_FALL = 900;
  const PLAYER_W = 30, PLAYER_H = 32;
  const ENEMY_W = 30, ENEMY_H = 30;

  // ---------------- Asset loading ----------------
  const WORLD_TILE_IDS = [0, 1, 2, 3, 40, 41, 42, 43, 6, 49, 50, 33, 34, 35, 16, 10, 30,
    151, 67, 44, 45, 46, 47, 111, 112, 51, 153, 154, 155];
  const CHAR_IDS = [6, 7, 13, 14, 15, 21];
  const BG_IDS = [14];

  const worldTileImg = {};
  const charImg = {};
  const bgImg = {};
  let urbanImg = null;

  function loadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(img); // fail soft -- draw calls just no-op on broken images
      img.src = src;
    });
  }

  async function loadAssets() {
    const jobs = [];
    WORLD_TILE_IDS.forEach((id) => jobs.push(loadImage(tileFile(id)).then((img) => (worldTileImg[id] = img))));
    CHAR_IDS.forEach((id) => jobs.push(loadImage(`sprites/Tiles/Characters/tile_${String(id).padStart(4, '0')}.png`).then((img) => (charImg[id] = img))));
    BG_IDS.forEach((id) => jobs.push(loadImage(`sprites/Tiles/Backgrounds/tile_${String(id).padStart(4, '0')}.png`).then((img) => (bgImg[id] = img))));
    jobs.push(loadImage('urbantileset/urbantileset32x32.png').then((img) => (urbanImg = img)));
    await Promise.all(jobs);
  }

  // ---------------- Level / world state ----------------
  let level = null;
  let grid = null;
  let player = null;
  let enemies = [];
  let items = [];
  let checkpoint = { x: 32, y: 0 };
  let camX = 0;
  let elapsed = 0;
  let gameState = 'loading'; // loading | start | playing | win | dead

  function freshPlayer() {
    return {
      x: level.spawn.col * TILE,
      y: level.spawn.row * TILE - PLAYER_H,
      w: PLAYER_W, h: PLAYER_H,
      vx: 0, vy: 0,
      grounded: false,
      coyoteTimer: 0,
      facing: 1,
      health: 3,
      score: 0,
      coins: 0,
      invuln: 0,
      animT: 0,
      dead: false,
    };
  }

  function resetGame() {
    level = buildLevel();
    grid = level.grid;
    player = freshPlayer();
    checkpoint = { x: player.x, y: player.y };
    enemies = level.enemies.map((e) => ({
      ...e,
      x: e.startCol * TILE,
      y: e.row * TILE - (e.type === 'flying' ? ENEMY_H : ENEMY_H),
      baseY: e.row * TILE - ENEMY_H,
      w: e.tough ? ENEMY_W * 1.2 : ENEMY_W,
      h: e.tough ? ENEMY_H * 1.2 : ENEMY_H,
      dir: 1,
      alive: true,
      animT: Math.random() * 10,
    }));
    items = level.items.map((it) => ({ ...it, collected: false }));
    camX = 0;
    elapsed = 0;
    jumpBufferTimer = 0;
    updateHud();
  }

  // ---------------- Input ----------------
  const keys = {};
  // Jump is buffered (a tap just before landing still jumps once you land) and
  // paired with "coyote time" (a tap just after walking off a ledge still jumps)
  // so a jump never silently gets dropped on tight timing.
  const JUMP_BUFFER_TIME = 0.15;
  const COYOTE_TIME = 0.1;
  let jumpBufferTimer = 0;

  window.addEventListener('keydown', (e) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
    const k = e.key.toLowerCase();
    keys[k] = true;
    if (e.key === ' ') keys['space'] = true;
    if (k === 'arrowup' || k === 'w' || k === ' ') jumpBufferTimer = JUMP_BUFFER_TIME;
    if (k === 'm') doToggleMute();
  });
  window.addEventListener('keyup', (e) => {
    keys[e.key.toLowerCase()] = false;
    if (e.key === ' ') keys['space'] = false;
  });
  // A focus loss (alt-tab, clicking a browser panel) can drop a keyup event,
  // leaving a key stuck "held" forever -- clear everything defensively.
  window.addEventListener('blur', () => {
    for (const k in keys) keys[k] = false;
  });

  function isDown(...names) { return names.some((n) => keys[n]); }

  // ---------------- Collision helpers ----------------
  function getDef(ch) { return TILE_DEFS[ch]; }

  function resolveAxis(e, axis) {
    const colMin = Math.max(0, Math.floor(e.x / TILE));
    const colMax = Math.min(COLS - 1, Math.floor((e.x + e.w - 1) / TILE));
    const rowMin = Math.max(0, Math.floor(e.y / TILE));
    const rowMax = Math.min(ROWS - 1, Math.floor((e.y + e.h - 1) / TILE));
    for (let row = rowMin; row <= rowMax; row++) {
      for (let col = colMin; col <= colMax; col++) {
        const ch = grid[row][col];
        const def = getDef(ch);
        if (!def || !def.solid) continue;
        const tx = col * TILE, ty = row * TILE;
        if (axis === 'x') {
          if (e.vx > 0) e.x = tx - e.w;
          else if (e.vx < 0) e.x = tx + TILE;
          e.vx = 0;
        } else {
          if (e.vy > 0) { e.y = ty - e.h; e.vy = 0; e.grounded = true; }
          else if (e.vy < 0) {
            e.y = ty + TILE;
            e.vy = 0;
            if (ch === 'M') onMysteryHit(row, col);
          }
        }
      }
    }
  }

  function moveEntity(e, dt) {
    e.x += e.vx * dt;
    resolveAxis(e, 'x');
    e.y += e.vy * dt;
    e.grounded = false;
    resolveAxis(e, 'y');
  }

  function tilesUnder(e) {
    const colMin = Math.max(0, Math.floor(e.x / TILE));
    const colMax = Math.min(COLS - 1, Math.floor((e.x + e.w - 1) / TILE));
    const rowMin = Math.max(0, Math.floor(e.y / TILE));
    const rowMax = Math.min(ROWS - 1, Math.floor((e.y + e.h - 1) / TILE));
    const out = [];
    for (let row = rowMin; row <= rowMax; row++)
      for (let col = colMin; col <= colMax; col++) out.push(grid[row][col]);
    return out;
  }

  function onMysteryHit(row, col) {
    if (grid[row][col] !== 'M') return;
    grid[row][col] = 'M_USED';
    player.score += 20;
    player.coins += 1;
    AUDIO.bonus();
    updateHud();
  }

  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  // ---------------- Update ----------------
  function updatePlayer(dt) {
    if (player.invuln > 0) player.invuln -= dt;

    const left = isDown('arrowleft', 'a');
    const right = isDown('arrowright', 'd');
    const jumpPressed = isDown('arrowup', 'w', 'space');

    player.vx = 0;
    if (left) { player.vx = -MOVE_SPEED; player.facing = -1; }
    if (right) { player.vx = MOVE_SPEED; player.facing = 1; }

    // Coyote time: still jumpable for a moment after walking off a ledge.
    if (player.grounded) player.coyoteTimer = COYOTE_TIME;
    else player.coyoteTimer -= dt;
    jumpBufferTimer -= dt;

    if (jumpBufferTimer > 0 && player.coyoteTimer > 0) {
      player.vy = JUMP_VELOCITY;
      player.grounded = false;
      player.coyoteTimer = 0;
      jumpBufferTimer = 0;
      AUDIO.jump();
    }
    if (!jumpPressed && player.vy < JUMP_VELOCITY * 0.4) player.vy = JUMP_VELOCITY * 0.4;

    player.vy += GRAVITY * dt;
    if (player.vy > MAX_FALL) player.vy = MAX_FALL;

    moveEntity(player, dt);
    if (player.x < 0) player.x = 0;

    if (player.vx !== 0) player.animT += dt; else player.animT = 0;

    // Checkpoint: standing safely on grass.
    if (player.grounded) {
      const footRow = Math.floor((player.y + player.h + 1) / TILE);
      const footCol = Math.floor((player.x + player.w / 2) / TILE);
      if (grid[footRow] && grid[footRow][footCol] === 'G') {
        checkpoint = { x: player.x, y: player.y };
      }
    }

    // Hazards: water contact or falling out of the world.
    const under = tilesUnder(player);
    const inWater = under.some((ch) => getDef(ch) && getDef(ch).hazard);
    if (inWater || player.y > level.worldHeight + 40) {
      damagePlayer(true);
    }

    // Enemies.
    for (const en of enemies) {
      if (!en.alive) continue;
      if (!rectsOverlap(player, en)) continue;
      const stomping = player.vy >= 0 && (player.y + player.h - en.y) < en.h * 0.6;
      if (stomping) {
        en.alive = false;
        player.vy = JUMP_VELOCITY * 0.55;
        player.score += 100;
        AUDIO.stomp();
      } else {
        damagePlayer(false, en);
      }
    }

    // Items.
    for (const it of items) {
      if (it.collected) continue;
      const box = { x: it.col * TILE, y: it.row * TILE, w: TILE, h: TILE };
      if (!rectsOverlap(player, box)) continue;
      it.collected = true;
      collectItem(it);
    }

    // Goal.
    const goalX = level.goal.col * TILE;
    if (player.x + player.w > goalX && player.x < goalX + TILE) {
      triggerWin();
    }
  }

  function collectItem(it) {
    switch (it.type) {
      case 'coin': player.score += 10; player.coins += 1; AUDIO.coin(); break;
      case 'gem': player.score += 50; AUDIO.gem(); break;
      case 'envelope': player.score += 100; AUDIO.bonus(); break;
      case 'heart':
        if (player.health < 3) { player.health += 1; AUDIO.heart(); }
        else { player.score += 20; AUDIO.coin(); }
        break;
    }
    updateHud();
  }

  function damagePlayer(fromHazard, enemy) {
    if (player.invuln > 0 || gameState !== 'playing') return;
    player.health -= 1;
    player.invuln = 1.4;
    AUDIO.hit();
    if (enemy) {
      player.vx = (player.x < enemy.x ? -1 : 1) * 220;
      player.vy = -220;
    }
    updateHud();
    if (player.health <= 0) {
      triggerGameOver();
    } else if (fromHazard) {
      player.x = checkpoint.x;
      player.y = checkpoint.y;
      player.vx = 0; player.vy = 0;
    }
  }

  function updateEnemies(dt) {
    for (const en of enemies) {
      if (!en.alive) continue;
      en.animT += dt;
      const minX = en.minCol * TILE;
      const maxX = en.maxCol * TILE - en.w;
      const speed = en.tough ? 55 : 70;
      en.x += en.dir * speed * dt;
      if (en.x < minX) { en.x = minX; en.dir = 1; }
      if (en.x > maxX) { en.x = maxX; en.dir = -1; }
      if (en.type === 'flying') {
        en.y = en.baseY + Math.sin(en.animT * 2) * 14;
      }
    }
  }

  function triggerWin() {
    if (gameState !== 'playing') return;
    gameState = 'win';
    AUDIO.win();
    document.getElementById('win-stats').textContent =
      `Score: ${player.score}  |  Coins: ${player.coins}  |  Time: ${elapsed.toFixed(1)}s`;
    show('overlay-win');
    setHudVisible(false);
  }

  function triggerGameOver() {
    gameState = 'dead';
    AUDIO.gameOver();
    document.getElementById('dead-stats').textContent =
      `Score: ${player.score}  |  Coins: ${player.coins}`;
    show('overlay-dead');
    setHudVisible(false);
  }

  // ---------------- Rendering ----------------
  function pickVariant(ch, row, col) {
    const def = getDef(ch);
    return def.variants[(row + col) % def.variants.length];
  }

  function drawSky() {
    const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    grad.addColorStop(0, '#9fd6ff');
    grad.addColorStop(0.7, '#cdeaff');
    grad.addColorStop(1, '#e9f7ff');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Clouds, slow parallax.
    const cloudIds = [153, 154, 155];
    for (let i = 0; i < 8; i++) {
      const img = worldTileImg[cloudIds[i % cloudIds.length]];
      const wx = i * 420 + 60;
      const x = wx - camX * 0.2;
      if (x < -80 || x > CANVAS_W + 80) continue;
      if (img) ctx.drawImage(img, x, 40 + (i % 3) * 22, 70, 70);
    }

    // Distant tree-line silhouette (nods to Ann Arbor's tree canopy).
    const tl = bgImg[14];
    if (tl) {
      const tileW = 96;
      const start = Math.floor((camX * 0.4) / tileW) - 1;
      const end = Math.floor((camX * 0.4 + CANVAS_W) / tileW) + 1;
      for (let i = start; i <= end; i++) {
        const x = i * tileW - camX * 0.4;
        ctx.drawImage(tl, x, CANVAS_H - 220, tileW, 96);
      }
    }
  }

  function drawDecorations(layer) {
    const factor = layer === 'far' ? 0.55 : 1.0;
    for (const d of level.decorations) {
      if (d.layer !== layer) continue;
      const rect = URBAN_RECTS[d.sprite];
      if (!rect || !urbanImg) continue;
      const x = d.x - camX * factor;
      if (x < -400 || x > CANVAS_W + 400) continue;
      const w = rect.w * d.scale, h = rect.h * d.scale;
      ctx.drawImage(urbanImg, rect.x, rect.y, rect.w, rect.h, x, d.y, w, h);
    }
  }

  function drawSign(sign) {
    const x = sign.x - camX;
    if (x < -300 || x > CANVAS_W + 300) return;
    ctx.save();
    ctx.font = sign.tower ? 'bold 20px "Courier New", monospace' : 'bold 15px "Courier New", monospace';
    ctx.textAlign = 'center';
    const lineH = sign.tower ? 24 : 18;
    let maxW = 0;
    sign.lines.forEach((l) => { maxW = Math.max(maxW, ctx.measureText(l).width); });
    const boxW = maxW + 24, boxH = sign.lines.length * lineH + 14;
    const boxX = x - boxW / 2, boxY = sign.y - boxH;

    if (!sign.tower) {
      ctx.fillStyle = '#7a5230';
      ctx.fillRect(x - 4, sign.y, 8, 480 - sign.y > 0 ? 480 - sign.y : 0);
    }
    ctx.fillStyle = 'rgba(0,10,30,0.72)';
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.strokeStyle = '#ffcb05';
    ctx.lineWidth = 2;
    ctx.strokeRect(boxX, boxY, boxW, boxH);

    ctx.fillStyle = sign.color || '#fff';
    sign.lines.forEach((l, i) => {
      ctx.fillText(l, x, boxY + 22 + i * lineH);
    });
    ctx.restore();
  }

  function drawGoal() {
    const gx = level.goal.col * TILE - camX;
    const baseY = level.goal.row * TILE;
    const post = worldTileImg[51];
    for (let y = baseY - TILE; y > baseY - TILE * 6; y -= TILE) {
      if (post) ctx.drawImage(post, gx + 6, y, TILE - 12, TILE);
    }
    const flagId = Math.floor(elapsed * 3) % 2 === 0 ? 111 : 112;
    const flag = worldTileImg[flagId];
    if (flag) ctx.drawImage(flag, gx - 8, baseY - TILE * 6 - 6, TILE + 16, TILE + 16);
  }

  function drawTiles() {
    const colStart = Math.max(0, Math.floor(camX / TILE) - 1);
    const colEnd = Math.min(COLS - 1, Math.floor((camX + CANVAS_W) / TILE) + 1);
    for (let row = 0; row < ROWS; row++) {
      for (let col = colStart; col <= colEnd; col++) {
        const ch = grid[row][col];
        if (ch === '.') continue;
        const id = pickVariant(ch, row, col);
        const img = worldTileImg[id];
        if (!img) continue;
        ctx.drawImage(img, col * TILE - camX, row * TILE, TILE, TILE);
      }
    }
  }

  function drawItems() {
    const iconId = { coin: 151, gem: 67, heart: 44, envelope: 47 };
    for (const it of items) {
      if (it.collected) continue;
      const img = worldTileImg[iconId[it.type]];
      if (!img) continue;
      const bob = Math.sin(elapsed * 4 + it.col) * 3;
      const x = it.col * TILE - camX;
      const y = it.row * TILE + bob;
      if (x < -TILE || x > CANVAS_W + TILE) continue;
      ctx.drawImage(img, x + 3, y + 3, TILE - 6, TILE - 6);
    }
  }

  function drawEntitySprite(img, e) {
    const x = e.x - camX;
    ctx.save();
    if (e.facing === -1 || e.dir === -1) {
      ctx.translate(x + e.w, e.y);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0, e.w, e.h);
    } else {
      ctx.drawImage(img, x, e.y, e.w, e.h);
    }
    ctx.restore();
  }

  function drawEnemies() {
    for (const en of enemies) {
      if (!en.alive) continue;
      const x = en.x - camX;
      if (x < -TILE * 2 || x > CANVAS_W + TILE * 2) continue;
      let img;
      if (en.tough) img = charImg[21];
      else if (en.type === 'flying') img = charImg[15];
      else img = Math.floor(en.animT * 6) % 2 === 0 ? charImg[13] : charImg[14];
      if (img) drawEntitySprite(img, en);
    }
  }

  function drawPlayer() {
    if (player.invuln > 0 && Math.floor(player.invuln * 12) % 2 === 0) return;
    const walking = Math.abs(player.vx) > 0 && player.grounded;
    const frameId = walking && Math.floor(player.animT * 8) % 2 === 0 ? 7 : 6;
    const img = charImg[frameId];
    if (img) drawEntitySprite(img, player);
  }

  function render() {
    drawSky();
    drawDecorations('far');
    drawTiles();
    drawDecorations('near');
    for (const s of level.signs) drawSign(s);
    drawGoal();
    drawItems();
    drawEnemies();
    drawPlayer();
  }

  // ---------------- HUD ----------------
  function updateHud() {
    const heartsEl = document.getElementById('hud-hearts');
    heartsEl.innerHTML = '';
    for (let i = 0; i < 3; i++) {
      const img = document.createElement('img');
      img.src = i < player.health ? tileFile(44) : tileFile(46);
      heartsEl.appendChild(img);
    }
    document.getElementById('score-val').textContent = player.score;
    document.getElementById('coin-val').textContent = player.coins;
  }

  function setHudVisible(v) {
    document.getElementById('hud').classList.toggle('hidden', !v);
  }

  function show(id) { document.getElementById(id).classList.remove('hidden'); }
  function hide(id) { document.getElementById(id).classList.add('hidden'); }

  // ---------------- Main loop ----------------
  let lastT = 0;
  function loop(t) {
    const dt = Math.min(0.033, (t - lastT) / 1000 || 0);
    lastT = t;

    if (gameState === 'playing') {
      elapsed += dt;
      updatePlayer(dt);
      updateEnemies(dt);
      camX = Math.max(0, Math.min(level.worldWidth - CANVAS_W, player.x + player.w / 2 - CANVAS_W / 2));
    }

    if (gameState === 'playing' || gameState === 'win' || gameState === 'dead') {
      render();
    }

    requestAnimationFrame(loop);
  }

  // ---------------- Buttons / state transitions ----------------
  function doToggleMute() {
    const muted = AUDIO.toggleMute();
    document.getElementById('btn-mute').textContent = muted ? '🔇' : '🔊';
  }

  function startGame() {
    resetGame();
    AUDIO.startMusic();
    gameState = 'playing';
    hide('overlay-start');
    hide('overlay-credits');
    hide('overlay-win');
    hide('overlay-dead');
    setHudVisible(true);
  }

  document.getElementById('btn-start').addEventListener('click', startGame);
  document.getElementById('btn-restart-win').addEventListener('click', startGame);
  document.getElementById('btn-restart-dead').addEventListener('click', startGame);
  document.getElementById('btn-credits').addEventListener('click', () => { hide('overlay-start'); show('overlay-credits'); });
  document.getElementById('btn-credits-back').addEventListener('click', () => { hide('overlay-credits'); show('overlay-start'); });
  document.getElementById('btn-mute').addEventListener('click', doToggleMute);

  // ---------------- Boot ----------------
  (async function boot() {
    gameState = 'loading';
    await loadAssets();
    level = buildLevel();
    grid = level.grid;
    gameState = 'start';
    requestAnimationFrame(loop);
  })();
})();
