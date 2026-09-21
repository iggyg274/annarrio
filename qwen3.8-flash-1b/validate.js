/* node-side validation of level data (loads urban_sprites.js + level.js) */
const fs=require('fs');
eval(fs.readFileSync('urban_sprites.js','utf8')+'\n'+fs.readFileSync('level.js','utf8'));
const L = LEVEL.make();
const {TILE,COLS,ROWS,grid,codes}=L;
const solid=new Set([codes.T_CONC_TOP,codes.T_CONC_FILL,codes.T_BRICK_TOP,codes.T_BRICK_FILL,codes.T_GRASS_TOP,codes.T_DIRT,codes.T_HEDGE,codes.T_WOOD,codes.T_BRICKBLOCK,codes.T_MBLOCK,codes.T_USED,codes.T_STONE]);
function t(x,y){ if(x<0||x>=COLS||y<0||y>=ROWS) return 0; return grid[y*COLS+x]; }
let problems=[];
// player box 20x26
const PW=20,PH=26;
// spawn check
{
  const sx=L.spawn.x, sy=L.spawn.y;
  console.log('spawn', sx,sy, 'tile', t(sx>>5, (sy+PH-1)>>5));
}
// pickups must not be inside solid tiles
for(const p of L.pickups){
  const cx=p.tx*TILE+16, cy=p.ty*TILE+16;
  const tx=Math.floor(cx/TILE), ty=Math.floor(cy/TILE);
  if(solid.has(t(tx,ty))) problems.push(`pickup ${p.type} at (${tx},${ty}) inside solid tile ${t(tx,ty)}`);
}
// ground enemies: need solid directly below their feet box
for(const e of L.enemies){
  if(e.bob) continue; // flying
  const fy=e.y+ (e.kind==='drone'?0:6); // approx bottom
  let ok=false;
  for(let x=e.x0;x<=e.x1;x+=TILE){ const tx=Math.floor(x/TILE); const ty=Math.floor((fy+8)/TILE); if(solid.has(t(tx,ty))) ok=true; }
  if(!ok) problems.push(`ground enemy ${e.kind} patrol ${e.x0/32}-${e.x1/32} at row ${Math.floor(fy/TILE)} has no floor`);
}
// blocks must have air below (bumpable) 
for(const k in L.blocks){
  const idx=+k, tx=idx%COLS, ty=(idx-tx)/COLS;
  if(!solid.has(t(tx,ty))) problems.push(`block ${k} not solid`);
  if(solid.has(t(tx,ty+1))) problems.push(`block at (${tx},${ty}) is buried (no air below)`);
}
// gap widths: find columns fully empty through all rows
let gaps=[],run=null;
for(let x=0;x<COLS;x++){
  let empty=true;
  for(let y=0;y<ROWS;y++) if(solid.has(t(x,y))){empty=false;break;}
  if(empty){ if(!run) run={x0:x,x1:x}; else run.x1=x; }
  else { if(run) {gaps.push(run); run=null;} }
}
if(run) gaps.push(run);
gaps.forEach(g=>{ const w=g.x1-g.x0+1; if(w>5) problems.push(`gap ${g.x0}-${g.x1} width ${w} too wide to jump`); else console.log('gap',g.x0,g.x1,'w',w); });
// decor sanity: ids exist, no flagged ids used
for(const d of L.decor){ if(!URB[d.id]) problems.push(`missing urban sprite ${d.id}`); if([70,11,47,73,74,76].includes(d.id)) problems.push(`flagged urban sprite ${d.id} used in level`);}
// pickups/enemies within world
for(const p of L.pickups){ if(p.tx<0||p.tx>=COLS) problems.push('pickup out of bounds'); }
console.log('pickups',L.pickups.length,'enemies',L.enemies.length,'decor',L.decor.length,'signs',L.signs.length);
const coins=L.pickups.filter(p=>p.type==='coin').length;
console.log('coins:',coins, 'cherries:', L.pickups.filter(p=>p.type==='cherry').length, 'hearts:',L.pickups.filter(p=>p.type==='heart').length,'coffees:',L.pickups.filter(p=>p.type==='coffee').length);
if(problems.length){ console.log('\nPROBLEMS:'); problems.forEach(p=>console.log(' -',p)); process.exit(1);} else console.log('\nOK');
