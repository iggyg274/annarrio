// Game definitions: player classes, monsters, items. Every entry points at catalog assets.
// Monster abilities were chosen from what each sprite sheet shows/tags (see README).
(function (root) {
  'use strict';
  const DG = root.DG = root.DG || {};

  // Player classes ----------------------------------------------------------------------
  DG.CLASSES = {
    adventurer: {
      name: 'Adventurer', sheet: 'elthen.adventurer',
      blurb: 'Sword and bow. Press F to shoot the nearest foe with your bow (unlimited arrows).',
      hp: 18, hpPerLevel: '1d6+3', toHit: 4, defense: 3, damage: '1d8', dmgBonus: 0,
      special: { key: 'f', name: 'Shoot', cooldown: 0, damage: '1d6', range: 9 },
      anims: { idle: 'idle', move: 'run', attack: ['attack_slash', 'attack_slash_2', 'attack_thrust'],
               hurt: 'hurt', die: 'die', shoot: 'attack_bow', cast: 'cast', cheer: 'celebrate',
               climb: 'climb', teleport: 'teleport' },
    },
    dwarf: {
      name: 'Dwarf', sheet: 'elthen.dwarf',
      blurb: 'Tough and slow to anger. Press F for a whirlwind axe spin hitting every adjacent foe (10 turn cooldown).',
      hp: 24, hpPerLevel: '1d8+3', toHit: 3, defense: 4, damage: '1d10', dmgBonus: 0,
      special: { key: 'f', name: 'Whirlwind', cooldown: 10, damage: '1d10+2' },
      anims: { idle: 'idle', move: 'run', attack: ['attack_overhead', 'attack_swing'],
               hurt: 'hurt', die: 'die', spin: 'attack_spin', cast: 'jump', cheer: 'jump',
               climb: 'jump', teleport: 'jump' },
    },
  };

  // Monsters ---------------------------------------------------------------------------
  // depth: [min,max] generation range; freq: relative weight; speed: 12 = player speed.
  // anims map game actions to catalog animation names.
  DG.MONSTERS = {
    bat: {
      name: 'cave bat', sheet: 'elthen.bat', glyph: 'B',
      hp: '1d4+1', toHit: 0, defense: 2, damage: '1d3', speed: 18, xp: 3,
      depth: [1, 5], freq: 8, flying: true, erratic: 0.5, group: [1, 3],
      lift: 10,
      anims: { idle: 'fly', awake: 'fly_aggro', move: 'fly_aggro', attack: 'fly_aggro', die: 'die' },
    },
    frog: {
      name: 'giant frog', sheet: 'elthen.frog', glyph: 'F',
      hp: '2d4+1', toHit: 1, defense: 1, damage: '1d4', speed: 12, xp: 4,
      depth: [1, 4], freq: 8, erratic: 0.35,
      anims: { idle: 'croak', move: 'hop', attack: 'jump' },
    },
    pig: {
      name: 'wild pig', sheet: 'elthen.pig', glyph: 'p',
      hp: '3d4', toHit: 2, defense: 1, damage: '1d6', speed: 12, xp: 6,
      depth: [1, 6], freq: 5, peaceful: true, drops: [['meat', 1.0]],
      anims: { idle: 'idle', move: 'run', attack: 'attack', die: 'die' },
    },
    ratfolk: {
      name: 'ratfolk axeman', sheet: 'elthen.ratfolk_axe', glyph: 'r',
      hp: '3d6', toHit: 2, defense: 3, damage: '1d6+1', speed: 11, xp: 12,
      depth: [2, 7], freq: 10, group: [1, 2], drops: [['gold', 0.5]],
      anims: { idle: 'idle', move: 'run', attack: 'attack', hurt: 'hurt', die: 'die' },
    },
    akaname: {
      name: 'akaname', sheet: 'elthen.akaname', glyph: 'a',
      hp: '3d6+2', toHit: 3, defense: 3, damage: '1d6', speed: 12, xp: 18,
      depth: [3, 8], freq: 7, reach: 2, // long tongue (attack animation)
      anims: { idle: 'idle', move: 'run', attack: 'attack', die: 'die' },
    },
    octopus: {
      name: 'gloomtopus', sheet: 'elthen.octopus', glyph: 'o',
      hp: '3d6+2', toHit: 4, defense: 4, damage: '1d6', speed: 10, xp: 16,
      depth: [3, 8], freq: 6, flying: true, swims: true, inks: 0.3,
      lift: 6,
      anims: { idle: 'idle', move: 'move', attack: 'attack', die: 'die', swim: 'swim' },
    },
    imp: {
      name: 'fire imp', sheet: 'elthen.imp', glyph: 'i',
      hp: '3d5', toHit: 4, defense: 4, damage: '1d4', speed: 12, xp: 20,
      depth: [4, 8], freq: 7,
      ranged: { damage: '2d4', range: 6, chance: 0.6, keepAway: 2, projectile: 'fireball', verb: 'hurls a fireball' },
      anims: { idle: 'idle', move: 'run', attack: 'attack', hurt: 'hurt', die: 'die' },
    },
    rival: { // uses whichever hero sheet the player did NOT pick
      name: 'renegade', sheet: null, glyph: '@',
      hp: '5d6', toHit: 5, defense: 4, damage: '1d10', speed: 12, xp: 32,
      depth: [5, 8], freq: 4, drops: [['gold', 1.0], ['potion', 0.4]],
      anims: null,
    },
    witch: {
      name: 'Witch of the Pit', sheet: 'elthen.witch', glyph: 'W',
      hp: '60', toHit: 6, defense: 5, damage: '1d6', speed: 12, xp: 250,
      depth: [99, 99], freq: 0, flying: true, boss: true, unique: true,
      ranged: { damage: '2d6', range: 8, chance: 0.55, keepAway: 3, projectile: 'hex', verb: 'casts a hex at' },
      summons: { monster: 'bat', every: 7, count: [1, 2] },
      blink: true, drops: [['chalice', 1.0]],
      anims: { idle: 'idle', move: 'move', attack: 'cast', hurt: 'hurt', die: 'die', fly: 'fly_broom' },
    },
  };

  // Items ------------------------------------------------------------------------------
  // icon: {sheet, region} or {sheet, anim}. Unidentified potions/scrolls get a random
  // effect per game (classic roguelike identification).
  const C = 'elthen.dungeon_collectables';
  DG.ITEMS = {
    gold:    { name: 'gold', cls: 'gold', icon: { sheet: C, region: 'coins_2' }, stack: true },
    meat:    { name: 'hunk of meat', cls: 'food', icon: { sheet: C, region: 'meat' }, nutrition: 700, heal: 3, freq: 6 },
    potion_red:        { name: 'red potion', cls: 'potion', icon: { sheet: C, region: 'potion_red' }, freq: 5 },
    potion_blue:       { name: 'blue potion', cls: 'potion', icon: { sheet: C, region: 'potion_blue' }, freq: 4 },
    potion_red_small:  { name: 'small red vial', cls: 'potion', icon: { sheet: C, region: 'potion_red_small' }, freq: 4 },
    potion_blue_small: { name: 'small blue vial', cls: 'potion', icon: { sheet: C, region: 'potion_blue_small' }, freq: 3 },
    scroll_sealed:     { name: 'sealed scroll', cls: 'scroll', icon: { sheet: C, region: 'scroll_sealed' }, freq: 4 },
    scroll_open:       { name: 'tattered scroll', cls: 'scroll', icon: { sheet: C, region: 'scroll_open' }, freq: 3 },
    bomb:    { name: 'bomb', cls: 'bomb', icon: { sheet: C, anim: 'bomb_idle' }, freq: 3, damage: '3d6' },
    key:     { name: 'golden key', cls: 'key', icon: { sheet: C, anim: 'key_gold_spin' }, freq: 2 },
    chalice: { name: 'Golden Chalice', cls: 'chalice', icon: { sheet: C, region: 'chalice' }, freq: 0 },
  };

  DG.POTION_EFFECTS = {
    healing:   { name: 'healing' },
    poison:    { name: 'sickness' },
    haste:     { name: 'speed' },
    insight:   { name: 'clairvoyance' },
  };
  DG.SCROLL_EFFECTS = {
    teleport: { name: 'teleportation' },
    hexblast: { name: 'hex blast' },
  };

  DG.XP_LEVELS = [0, 20, 50, 100, 170, 270, 400, 580, 800, 1100, 1500];
  DG.MAX_DEPTH = 8; // depth 8 = the Witch's arena
})(typeof window !== 'undefined' ? window : globalThis);
