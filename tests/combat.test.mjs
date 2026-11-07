import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as combat from '../docs/combat.mjs';
import { difficultyForStage } from '../docs/combat.mjs';

const { COMBAT_Z, PLAYER_Y, DIVE_DURATION, RETURN_DURATION, formationPosition,
  beginDive, enemyPosition, createProjectile, advanceProjectile, projectileHits } = combat;

test('formation slots share the combat plane, including boss and later rows', () => {
  for (const y of [11, 7, 4.8, 2.6, .4, -1.8]) {
    const enemy = { baseX: 6.4, y, phase: .8 };
    for (const time of [0, 1, 15]) {
      const position = formationPosition(enemy, time);
      assert.equal(position.z, COMBAT_Z);
      assert.ok(Math.abs(position.x - enemy.baseX) <= 2.3);
      assert.ok(Math.abs(position.y - y) <= .16);
    }
  }
});

test('repeated dives return continuously to the original moving slot without drift', () => {
  const enemy = { baseX: -6.4, y: 4.8, phase: .4, diving: false };
  for (const start of [1, 8, 20]) {
    const origin = formationPosition(enemy, start);
    beginDive(enemy, start, 9, origin);
    assert.deepEqual(enemyPosition(enemy, start), origin);
    const bottom = enemyPosition(enemy, start + DIVE_DURATION);
    assert.ok(Math.abs(bottom.x - 9) < 1e-12);
    assert.ok(Math.abs(bottom.y - (PLAYER_Y + 1)) < 1e-12);
    assert.equal(bottom.z, COMBAT_Z);
    const end = start + DIVE_DURATION + RETURN_DURATION;
    const nearEnd = enemyPosition(enemy, end - 1e-6);
    const returned = enemyPosition(enemy, end + 1e-12);
    assert.ok(Math.hypot(nearEnd.x - returned.x, nearEnd.y - returned.y) < .0001);
    assert.deepEqual(returned, formationPosition(enemy, end + 1e-12));
    assert.equal(enemy.diving, false);
    assert.equal(enemy.baseX, -6.4);
    assert.equal(enemy.y, 4.8);
    assert.deepEqual(enemyPosition(enemy, end + .5), formationPosition(enemy, end + .5));
  }
});

test('projectiles move up/down in Y and hit along the entire frame segment', () => {
  for (const velocity of [30, -7.35]) {
    const position = { x: 2, y: PLAYER_Y, z: COMBAT_Z };
    const shot = createProjectile(position, velocity);
    const initialY = position.y;
    advanceProjectile(shot, .5);
    assert.equal(position.x, 2);
    assert.equal(position.z, COMBAT_Z);
    assert.equal(position.y, initialY + velocity * .5);
    const target = { x: 2, y: initialY + velocity * .25, z: COMBAT_Z };
    assert.equal(projectileHits(shot, target, .1), true);
    assert.equal(projectileHits(shot, { ...target, x: 4 }, .1), false);
    assert.equal(projectileHits(shot, { ...target, z: 4 }, .1), false);
    shot.dead = true;
    assert.equal(projectileHits(shot, target, .1), false);
  }
});

test('stationary shots and subsequent frames do not reuse an old collision segment', () => {
  const shot = createProjectile({ x: 0, y: 0, z: COMBAT_Z }, 30);
  assert.equal(projectileHits(shot, shot.position, .1), true);
  advanceProjectile(shot, .1);
  advanceProjectile(shot, .1);
  assert.equal(projectileHits(shot, { x: 0, y: 1, z: COMBAT_Z }, .1), false);
});

// Execute the real game functions with a small rendering/DOM substitute. This
// checks their wiring, not WebGL rendering; no remote Three.js import is needed.
function loadGame(random = .99) {
  class Vector3 {
    constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
    set(x, y, z) { Object.assign(this, { x, y, z }); return this; }
    copy(p) { return this.set(p.x, p.y, p.z); }
    distanceTo(p) { return Math.hypot(this.x - p.x, this.y - p.y, this.z - p.z); }
    addScaledVector(p, scale) { this.x += p.x * scale; this.y += p.y * scale; this.z += p.z * scale; return this; }
    multiplyScalar(scale) { this.x *= scale; this.y *= scale; this.z *= scale; return this; }
  }
  class Object3D {
    constructor(geometry, material = {}) {
      this.position = new Vector3(); this.rotation = new Vector3();
      this.children = []; this.userData = {}; this.material = material;
    }
    add(child) { this.children.push(child); }
    remove(child) { this.children = this.children.filter(item => item !== child); }
    lookAt() {}
    setFromPoints() { return this; }
    setAttribute() {}
    updateProjectionMatrix() {}
  }
  const THREE = { Vector3, MathUtils: { clamp: (n, min, max) => Math.max(min, Math.min(max, n)) } };
  for (const name of ['Scene', 'Group', 'Mesh', 'Points', 'GridHelper', 'BufferGeometry',
    'ConeGeometry', 'SphereGeometry', 'OctahedronGeometry', 'TorusGeometry', 'CylinderGeometry',
    'BoxGeometry', 'Float32BufferAttribute']) THREE[name] = Object3D;
  for (const name of ['MeshPhongMaterial', 'LineBasicMaterial', 'PointsMaterial']) {
    THREE[name] = class { constructor(options) { Object.assign(this, options); } };
  }
  THREE.Fog = class { constructor(color, near, far) { Object.assign(this, { color, near, far }); } };
  THREE.PerspectiveCamera = class extends Object3D {
    constructor(fov, aspect, near, far) { super(); Object.assign(this, { fov, aspect, near, far }); }
  };
  THREE.WebGLRenderer = class {
    setPixelRatio() {} setClearColor() {} setSize() {} render() {}
  };
  const elements = new Map();
  const getElement = selector => {
    if (!elements.has(selector)) elements.set(selector, {
      hidden: false, textContent: '', listeners: {},
      classList: { toggle() {}, add() {}, remove() {} },
      addEventListener(type, handler) { this.listeners[type] = handler; },
      setAttribute() {}, setPointerCapture() {},
      getBoundingClientRect() { return { width: 390, height: 744, left: 0 }; },
    });
    return elements.get(selector);
  };
  const math = Object.create(Math);
  // A number disables random dives/fire; a function supplies a deterministic sequence.
  math.random = typeof random === 'function' ? random : () => random;
  const windowEvents = {};
  const context = vm.createContext({
    ...combat, THREE, Math: math, devicePixelRatio: 1,
    document: { querySelector: getElement, addEventListener() {} },
    window: { addEventListener(type, handler) { windowEvents[type] = handler; } },
    localStorage: { getItem: () => null, setItem() {} },
    requestAnimationFrame() {}, setTimeout() {},
  });
  const source = readFileSync(new URL('../docs/game.js', import.meta.url), 'utf8');
  vm.runInContext(source.replace(/^import .*;\n/gm, ''), context);
  const runtime = vm.runInContext('({ game, player, enemies, shots, enemyShots, particles, capsules, scene, camera, startGame, createWave, firePlayer, fireEnemy, explode, update, collisions, resize, destroyEnemy, loseLife, spawnCapsule, render, get effects() { return effects; } })', context);
  runtime.game.muted = true;
  return Object.assign(runtime, { elements, windowEvents }); // keeps the live `effects` getter
}

test('actual waves, player, boss and portrait camera use a visible shared plane', () => {
  const runtime = loadGame();
  const { game, player, enemies, camera } = runtime;
  runtime.startGame();
  assert.equal(enemies.length, 21);
  assert.equal(player.mesh.position.y, PLAYER_Y);
  assert.equal(player.mesh.position.z, COMBAT_Z);
  assert.equal(player.mesh.rotation.x, Math.PI / 2);
  game.stage = 3;
  runtime.createWave();
  assert.ok(enemies.some(enemy => enemy.type === 'boss'));
  assert.ok(enemies.every(enemy => enemy.mesh.position.z === COMBAT_Z));
  const halfHeight = camera.position.z * Math.tan(camera.fov * Math.PI / 360);
  assert.ok(halfHeight * camera.aspect >= 16 - 1e-12);
  assert.ok(halfHeight >= 13);
  assert.ok(runtime.scene.fog.near > camera.position.z);
  player.x = 12;
  player.mesh.position.x = 12;
  runtime.startGame();
  assert.equal(player.mesh.position.x, 0);
});

test('actual firing creates a Y-aligned shot, respects cooldown and scores a hit', () => {
  const runtime = loadGame();
  const { game, player, shots } = runtime;
  runtime.firePlayer();
  assert.equal(shots.length, 0);
  runtime.startGame();
  game.enemyFire = 1000;
  runtime.firePlayer();
  const shot = shots[0];
  assert.equal(shot.position, shot.mesh.position);
  assert.equal(shot.position.x, player.x);
  assert.equal(shot.position.y, PLAYER_Y + .9);
  assert.equal(shot.position.z, COMBAT_Z);
  assert.equal(shot.mesh.rotation.x, 0);
  runtime.firePlayer();
  assert.equal(shots.length, 1);
  runtime.update(.05);
  assert.equal(shot.position.y, PLAYER_Y + .9 + 1.5);
  assert.equal(shot.position.z, COMBAT_Z);
  for (let frame = 0; frame < 8; frame++) runtime.update(.05);
  assert.equal(game.score, 100);
  assert.equal(shots.length, 0);
  game.state = 'paused';
  runtime.firePlayer();
  assert.equal(shots.length, 0);
});

test('actual Space key handlers fire repeatedly while held and stop on release', () => {
  const runtime = loadGame();
  runtime.startGame();
  runtime.game.enemyFire = 1000;
  runtime.player.x = 13.5;
  runtime.windowEvents.keydown({ key: ' ', preventDefault() {} });
  runtime.update(.05);
  assert.equal(runtime.shots.length, 1);
  for (let frame = 0; frame < 4; frame++) runtime.update(.05);
  assert.equal(runtime.shots.length, 1);
  runtime.update(.05);
  assert.equal(runtime.shots.length, 2);
  runtime.windowEvents.keyup({ key: ' ' });
  for (let frame = 0; frame < 6; frame++) runtime.update(.05);
  assert.equal(runtime.shots.length, 2);
});

test('actual touch fire handler spawns a shot and enemy shots can damage the player', () => {
  const runtime = loadGame();
  runtime.startGame();
  runtime.game.enemyFire = 1000;
  runtime.elements.get('#fireButton').listeners.pointerdown({ preventDefault() {} });
  assert.equal(runtime.shots.length, 1);
  runtime.player.invulnerable = 0;
  const enemy = runtime.enemies[0];
  enemy.mesh.position.set(0, PLAYER_Y + 2.4, COMBAT_Z);
  runtime.fireEnemy(enemy);
  const shot = runtime.enemyShots[0];
  assert.ok(shot.velocity < 0);
  for (let frame = 0; frame < 6; frame++) runtime.update(.05);
  assert.equal(runtime.game.lives, 2);
  assert.equal(runtime.enemyShots.length, 0);
  assert.equal(shot.position.z, COMBAT_Z);
});

test('actual collision path consumes a projectile only once, including elite health', () => {
  const runtime = loadGame();
  runtime.startGame();
  runtime.game.stage = 3;
  runtime.createWave();
  runtime.firePlayer();
  const enemy = runtime.enemies[0], shot = runtime.shots[0];
  shot.previous = { x: enemy.mesh.position.x, y: enemy.mesh.position.y - 3, z: COMBAT_Z };
  shot.position.copy(enemy.mesh.position);
  runtime.collisions();
  assert.equal(enemy.health, 1);
  assert.equal(shot.dead, true);
  runtime.collisions();
  assert.equal(enemy.health, 1);
});

test('actual loop returns a diver to its original slot and removes offscreen shots', () => {
  const runtime = loadGame();
  runtime.startGame();
  runtime.game.enemyFire = 1000;
  const enemy = runtime.enemies[0];
  const baseX = enemy.baseX;
  beginDive(enemy, runtime.game.waveTime, 9, enemy.mesh.position);
  for (let frame = 0; frame < 61; frame++) runtime.update(.05);
  assert.equal(enemy.diving, false);
  assert.equal(enemy.baseX, baseX);
  const slot = formationPosition(enemy, runtime.game.waveTime);
  assert.equal(enemy.mesh.position.x, slot.x);
  assert.equal(enemy.mesh.position.y, slot.y);
  assert.equal(enemy.mesh.position.z, COMBAT_Z);
  runtime.player.x = 13.5;
  runtime.firePlayer();
  const shot = runtime.shots[0];
  shot.position.y = 13.9;
  runtime.update(.05);
  assert.equal(runtime.shots.length, 0);
  assert.equal(runtime.scene.children.includes(shot.mesh), false);
  runtime.fireEnemy(enemy);
  runtime.enemyShots[0].position.y = -11.9;
  runtime.update(.05);
  assert.equal(runtime.enemyShots.length, 0);
});

const CONTINUOUS = ['diveChance', 'enemyShotSpeed', 'diveFireChance', 'bossFireChance'];
const stages = Array.from({ length: 60 }, (_, i) => i + 1);

test('difficulty never decreases, stage 1 is easiest and values are capped', () => {
  for (const stage of stages.slice(1)) {
    const prev = difficultyForStage(stage - 1), now = difficultyForStage(stage);
    for (const key of [...CONTINUOUS, 'maxConcurrentDives', 'maxEnemyShots', 'rows']) assert.ok(now[key] >= prev[key], `${key} @${stage}`);
    assert.ok(now.fireInterval <= prev.fireInterval, `fireInterval @${stage}`);
  }
  const first = difficultyForStage(1), late = difficultyForStage(1000);
  assert.ok(late.diveChance < .035 && late.enemyShotSpeed < 10 && late.fireInterval > .75 && late.diveFireChance < .25);
  assert.ok(late.maxConcurrentDives <= 4 && late.maxEnemyShots <= 8 && late.rows <= 5 && late.eliteCount <= 7);
  assert.equal(first.maxConcurrentDives, 1);
  assert.equal(first.eliteCount + first.bossHealth, 0);
  assert.ok(difficultyForStage(3).fireInterval > 1.5 && difficultyForStage(3).enemyShotSpeed < 7);
});

test('consecutive stages change difficulty by small steps', () => {
  for (const stage of stages.slice(1)) {
    const prev = difficultyForStage(stage - 1), now = difficultyForStage(stage);
    for (const key of [...CONTINUOUS, 'fireInterval']) assert.ok(Math.abs(now[key] / prev[key] - 1) <= .35, `${key} @${stage}`);
    for (const key of ['maxConcurrentDives', 'maxEnemyShots', 'rows']) assert.ok(now[key] - prev[key] <= 1, `${key} @${stage}`);
    assert.ok(now.eliteCount - prev.eliteCount <= 2, `eliteCount @${stage}`);
  }
  const bosses = stages.map(s => difficultyForStage(s).bossHealth).filter(Boolean);
  assert.ok(bosses.every((hp, i) => i === 0 || (hp >= bosses[i - 1] && hp - bosses[i - 1] <= 1)) && Math.max(...bosses) <= 10);
});

test('actual loop limits concurrent dives and enemy shots, and restart resets to stage 1', () => {
  const runtime = loadGame();
  runtime.startGame();
  runtime.game.stage = 1;
  runtime.game.enemyFire = 1000;
  for (let i = 0; i < 6; i++) runtime.fireEnemy(runtime.enemies[i]);
  assert.equal(runtime.enemyShots.length, difficultyForStage(1).maxEnemyShots);
  runtime.game.stage = 12;
  runtime.createWave();
  const eliteRow = runtime.enemies.filter(e => e.type === 'elite').length;
  assert.equal(eliteRow, difficultyForStage(12).eliteCount);
  assert.equal(runtime.enemies.find(e => e.type === 'boss').health, difficultyForStage(12).bossHealth);
  runtime.game.state = 'over';
  runtime.startGame();
  assert.equal(runtime.game.stage, 1);
  assert.equal(runtime.enemies.length, difficultyForStage(1).rows * 7);
});

test('actual loop never exceeds the concurrent dive cap even when every roll succeeds', () => {
  const runtime = loadGame(0); // Math.random() === 0: every dive and fire roll succeeds.
  runtime.startGame();
  for (const stage of [1, 4, 7, 12]) {
    runtime.game.stage = stage;
    runtime.createWave();
    runtime.game.enemyFire = 1000;
    const diff = difficultyForStage(stage);
    for (let frame = 0; frame < 40; frame++) {
      runtime.player.invulnerable = 10;
      runtime.update(.05);
      assert.ok(runtime.enemies.filter(e => e.diving).length <= diff.maxConcurrentDives);
      assert.ok(runtime.enemyShots.length <= diff.maxEnemyShots);
    }
    assert.equal(runtime.enemies.filter(e => e.diving).length, diff.maxConcurrentDives);
  }
});

test('pointerToWorldX maps screen X to the combat plane and clamps to the ship limit', () => {
  const { pointerToWorldX, PLAYER_X_LIMIT } = combat;
  const camera = (aspect, fov = 60) => ({ fov, aspect, cameraZ: 30 });
  const halfWidth = c => c.cameraZ * Math.tan(c.fov * Math.PI / 360) * c.aspect;
  const rect = { left: 100, width: 400 };
  const wide = camera(2);
  assert.equal(PLAYER_X_LIMIT, 13.5);
  assert.ok(Math.abs(pointerToWorldX({ clientX: 300, rect, ...wide })) < 1e-12);
  assert.ok(halfWidth(wide) > 13.5);
  assert.equal(pointerToWorldX({ clientX: 100, rect, ...wide }), -13.5);
  assert.equal(pointerToWorldX({ clientX: 500, rect, ...wide }), 13.5);
  assert.equal(pointerToWorldX({ clientX: -900, rect, ...wide }), -13.5);
  assert.equal(pointerToWorldX({ clientX: 9000, rect, ...wide }), 13.5);
  // Narrow view: the visible half-width is below the limit, so the edges are not clamped.
  const narrow = { fov: 60, aspect: .5, cameraZ: 30 };
  const edge = pointerToWorldX({ clientX: 500, rect, ...narrow });
  assert.ok(Math.abs(edge - halfWidth(narrow)) < 1e-12 && edge < 13.5);
  assert.ok(Math.abs(pointerToWorldX({ clientX: 400, rect, ...narrow }) - halfWidth(narrow) / 2) < 1e-12);
  // A different canvas size and plane depth change the result accordingly.
  assert.ok(Math.abs(pointerToWorldX({ clientX: 250, rect: { left: 50, width: 200 }, ...narrow, planeZ: 10 })
    - 20 * Math.tan(Math.PI / 6) * .5) < 1e-12);
});

test('pointerToWorldX rejects unusable rects and cameras', () => {
  const { pointerToWorldX } = combat;
  const base = { clientX: 10, rect: { left: 0, width: 100 }, fov: 60, aspect: 1, cameraZ: 20 };
  assert.equal(pointerToWorldX({ ...base, rect: { left: 0, width: 0 } }), null);
  assert.equal(pointerToWorldX({ ...base, rect: null }), null);
  assert.equal(pointerToWorldX({ ...base, clientX: NaN }), null);
  assert.equal(pointerToWorldX({ ...base, aspect: 0 }), null);
  assert.equal(pointerToWorldX({ ...base, cameraZ: 0 }), null);
});

test('actual mouse handlers steer on X, fire with the left button only, and ignore buttons and non-playing states', () => {
  const runtime = loadGame();
  const stage = runtime.elements.get('#gameStage');
  const mouse = (extra = {}) => ({ pointerType: 'mouse', button: 0, clientX: 195, target: { closest: () => null }, ...extra });
  stage.listeners.pointermove(mouse({ clientX: 390 }));
  assert.equal(runtime.player.x, 0, 'ignored before the game starts');
  stage.listeners.pointerdown(mouse());
  assert.equal(runtime.shots.length, 0);
  runtime.startGame();
  runtime.game.enemyFire = 1000;
  stage.listeners.pointermove(mouse({ clientX: 390 }));
  assert.equal(runtime.player.x, 13.5);
  assert.equal(runtime.player.mesh.position.x, 13.5);
  assert.equal(runtime.player.mesh.position.y, PLAYER_Y);
  runtime.player.cooldown = 0;
  stage.listeners.pointerdown(mouse({ button: 2 }));
  stage.listeners.pointerdown(mouse({ button: 1 }));
  stage.listeners.pointerdown(mouse({ target: { closest: () => ({}) } }));
  assert.equal(runtime.shots.length, 0);
  assert.equal(runtime.game.mouseFire, false);
  stage.listeners.pointerdown(mouse());
  assert.equal(runtime.shots.length, 1);
  assert.equal(runtime.game.mouseFire, true);
  runtime.update(.1);
  assert.equal(runtime.shots.length, 1, 'cooldown .22 still applies');
  runtime.update(.15);
  assert.equal(runtime.shots.length, 2);
  runtime.game.state = 'paused';
  runtime.game.mouseFire = true;
  stage.listeners.pointermove(mouse({ clientX: 0 }));
  assert.equal(runtime.player.x, 0, 'paused ignores movement');
  runtime.windowEvents.blur();
  assert.equal(runtime.game.mouseFire, false);
});

// Deterministic explosion: a seeded sequence while explode() rolls, then .99 so the
// loop never starts dives or random enemy fire that could disturb the run.
function explodedGame() {
  let seed = 12345, rolling = false;
  const rolls = [];
  const runtime = loadGame(() => {
    if (!rolling) return .99;
    seed = (seed * 1103515245 + 12345) % 2147483648;
    rolls.push(seed / 2147483648);
    return rolls.at(-1);
  });
  runtime.startGame();
  runtime.game.enemyFire = 1000;
  runtime.player.invulnerable = 1000;
  rolling = true;
  runtime.explode({ x: 1.5, y: -2, z: COMBAT_Z });
  rolling = false;
  return { runtime, rolls };
}
const snapshot = particles => Array.from(particles, ({ mesh, velocity }) => ({
  position: { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z },
  velocity: { x: velocity.x, y: velocity.y, z: velocity.z },
}));

test('explosion particles move and slow down the same at 30, 60 and 144 Hz and keep the 60 Hz path', () => {
  const runs = {};
  let initial;
  for (const hz of [30, 60, 144]) {
    const { runtime } = explodedGame();
    initial ??= snapshot(runtime.particles);
    assert.deepEqual(snapshot(runtime.particles), initial, 'same starting explosion');
    // Motion-only comparison: real lifetimes are below 1 s, so stretch them here.
    // Spawn lifetime and removal are checked by the next test.
    for (const p of runtime.particles) p.life = 10;
    for (let frame = 0; frame < hz; frame++) runtime.update(1 / hz);
    assert.equal(runtime.particles.length, 12);
    runs[hz] = snapshot(runtime.particles);
  }
  const axes = ['x', 'y', 'z'];
  const close = (actual, expected, label) =>
    assert.ok(Math.abs(actual - expected) <= 1e-6, `${label}: ${actual} vs ${expected}`);
  for (const hz of [30, 144]) runs[hz].forEach((p, i) => axes.forEach(axis => {
    close(p.position[axis], runs[60][i].position[axis], `${hz} Hz particle ${i} position.${axis}`);
    close(p.velocity[axis], runs[60][i].velocity[axis], `${hz} Hz particle ${i} velocity.${axis}`);
  }));
  // Independent expectation: the original 60 Hz rule, 60 frames of move-by-v/60 then v*=.94.
  initial.forEach((start, i) => axes.forEach(axis => {
    let position = start.position[axis], velocity = start.velocity[axis];
    for (let frame = 0; frame < 60; frame++) { position += velocity / 60; velocity *= .94; }
    close(runs[60][i].velocity[axis], start.velocity[axis] * .94 ** 60, `60 Hz particle ${i} decay.${axis}`);
    close(runs[60][i].velocity[axis], velocity, `60 Hz particle ${i} legacy velocity.${axis}`);
    close(runs[60][i].position[axis], position, `60 Hz particle ${i} legacy position.${axis}`);
  }));
});

test('explosion particles use real lifetimes, fade with life, ignore dt=0 and are removed at life <= 0', () => {
  const { runtime, rolls } = explodedGame();
  const { particles, scene } = runtime;
  assert.equal(particles.length, 12);
  assert.equal(rolls.length, 12 * 4);
  particles.forEach((p, i) => {
    assert.equal(p.life, .35 + rolls[i * 4 + 3] * .5);
    assert.ok(p.life >= .35 && p.life < .85);
    assert.ok(scene.children.includes(p.mesh));
  });
  const before = snapshot(particles), lives = Array.from(particles, p => p.life);
  runtime.update(0);
  assert.deepEqual(snapshot(particles), before, 'update(0) leaves position and velocity unchanged');
  assert.deepEqual(Array.from(particles, p => p.life), lives);
  runtime.update(.1);
  particles.forEach((p, i) => {
    assert.ok(Math.abs(p.life - (lives[i] - .1)) < 1e-12);
    assert.equal(p.mesh.material.opacity, Math.max(0, p.life * 2));
  });
  const meshes = particles.map(p => p.mesh);
  const shortest = particles.reduce((a, b) => (a.life < b.life ? a : b));
  runtime.update(shortest.life); // This update brings its life to exactly 0 (or below).
  assert.equal(particles.includes(shortest), false);
  assert.equal(scene.children.includes(shortest.mesh), false);
  assert.equal(shortest.mesh.material.opacity, 0);
  assert.ok(particles.every(p => p.life > 0 && scene.children.includes(p.mesh)));
  for (let frame = 0; frame < 20 && particles.length; frame++) runtime.update(.05);
  assert.equal(particles.length, 0);
  assert.ok(meshes.every(mesh => !scene.children.includes(mesh)));
});

// ---- Power-up capsules (TWIN, SHIELD) ----
const { POWERUP_DROP_CHANCE, TWIN_DURATION, POWERUP_FALL_SPEED, POWERUP_PICKUP_RADIUS, POWERUP_BOTTOM_Y,
  rollPowerupDrop, createEffects, applyPowerup, advanceEffects, hasTwin, absorbHit, powerupHudText } = combat;

test('drop roll: one call per kill, 15% total, TWIN and SHIELD split it equally at fixed boundaries', () => {
  assert.equal(POWERUP_DROP_CHANCE, .15);
  assert.equal(TWIN_DURATION, 10);
  const roll = value => { let calls = 0; const type = rollPowerupDrop(() => { calls++; return value; }); assert.equal(calls, 1); return type; };
  assert.equal(roll(0), 'twin');
  assert.equal(roll(.0749999), 'twin');
  assert.equal(roll(.075), 'shield');
  assert.equal(roll(.1499999), 'shield');
  assert.equal(roll(.15), null);
  assert.equal(roll(.99), null);
  assert.equal(roll(NaN), null);
  const counts = { twin: 0, shield: 0, none: 0 };
  const n = 100000;
  for (let i = 0; i < n; i++) counts[rollPowerupDrop(() => i / n) ?? 'none']++;
  assert.deepEqual(counts, { twin: 7500, shield: 7500, none: 85000 });
});

test('effects: apply, refresh, hold both, expire TWIN by time and consume SHIELD without mutating input', () => {
  const empty = Object.freeze(createEffects());
  assert.deepEqual(empty, { twin: 0, shield: false });
  assert.deepEqual(powerupHudText(empty), { twin: '', shield: '' });
  const twin = Object.freeze(applyPowerup(empty, 'twin'));
  assert.equal(twin.twin, 10);
  assert.ok(hasTwin(twin) && !hasTwin(empty));
  const later = Object.freeze(advanceEffects(twin, 7.5));
  assert.equal(later.twin, 2.5);
  assert.equal(applyPowerup(later, 'twin').twin, 10, 'pickup refreshes to 10 s, does not add');
  const both = Object.freeze(applyPowerup(later, 'shield'));
  assert.deepEqual(both, { twin: 2.5, shield: true });
  assert.deepEqual(applyPowerup(both, 'shield'), both, 'a second SHIELD still blocks once');
  assert.deepEqual(powerupHudText(both), { twin: 'TWIN 3s', shield: 'SHIELD ×1' });
  assert.equal(advanceEffects(both, 2.4999).twin > 0, true);
  const expired = advanceEffects(both, 2.5);
  assert.deepEqual(expired, { twin: 0, shield: true }, 'SHIELD has no timer');
  assert.equal(hasTwin(expired), false);
  assert.deepEqual(advanceEffects(both, -1), both, 'negative dt is ignored');
  assert.deepEqual(advanceEffects(expired, 5), expired);
  assert.deepEqual(absorbHit(later), { effects: later, absorbed: false });
  assert.deepEqual(absorbHit(both), { effects: { twin: 2.5, shield: false }, absorbed: true }, 'consuming SHIELD keeps TWIN');
  assert.throws(() => applyPowerup(empty, 'laser'));
  assert.deepEqual(twin, { twin: 10, shield: false });
  assert.deepEqual(both, { twin: 2.5, shield: true });
});

// Deterministic game: Math.random returns `rng.value`; .99 never starts dives, enemy fire or drops.
function powerGame() {
  const rng = { value: .99, calls: 0 };
  const runtime = loadGame(() => { rng.calls++; return rng.value; });
  runtime.startGame();
  runtime.game.enemyFire = 1000;
  return { runtime, rng };
}
const collect = (runtime, type) => {
  runtime.update(0); // sync the ship mesh with player.x
  runtime.spawnCapsule(type, runtime.player.mesh.position);
  runtime.update(0);
  assert.equal(runtime.capsules.length, 0);
};
const powerHud = runtime => ({
  box: runtime.elements.get('#powerups').hidden,
  twin: [runtime.elements.get('#twinStatus').hidden, runtime.elements.get('#twinStatus').textContent],
  shield: [runtime.elements.get('#shieldStatus').hidden, runtime.elements.get('#shieldStatus').textContent],
});
const HUD_HIDDEN = { box: true, twin: [true, ''], shield: [true, ''] };

test('actual kills roll for a drop exactly once; non-lethal hits and body collisions never drop', () => {
  const { runtime, rng } = powerGame();
  runtime.game.stage = 3;
  runtime.createWave();
  const elite = runtime.enemies.find(e => e.type === 'elite');
  rng.value = .05; // TWIN when rolled
  rng.calls = 0;
  runtime.destroyEnemy(elite); // 2 -> 1 health
  assert.equal(rng.calls, 12 * 4, 'only the explosion uses random numbers');
  assert.equal(runtime.capsules.length, 0);
  rng.calls = 0;
  elite.mesh.position.set(2, 3, COMBAT_Z);
  runtime.destroyEnemy(elite);
  assert.equal(rng.calls, 12 * 4 + 1, 'explosion plus one drop roll');
  assert.equal(runtime.capsules.length, 1);
  assert.equal(runtime.capsules[0].type, 'twin');
  assert.deepEqual({ ...runtime.capsules[0].mesh.position }, { x: 2, y: 3, z: COMBAT_Z });
  assert.ok(runtime.scene.children.includes(runtime.capsules[0].mesh));
  runtime.destroyEnemy(elite);
  assert.equal(runtime.capsules.length, 1, 'a dead enemy cannot drop again');
  rng.value = .1; // SHIELD when rolled
  const basic = runtime.enemies.find(e => e.type === 'basic' && e.alive);
  runtime.destroyEnemy(basic);
  assert.equal(runtime.capsules.at(-1).type, 'shield');
  rng.value = .99;
  runtime.destroyEnemy(runtime.enemies.find(e => e.type === 'basic' && e.alive));
  assert.equal(runtime.capsules.length, 2, 'roll >= .15 drops nothing');
  // Body collision: the enemy is gone and a life is lost, but nothing drops even with a winning roll.
  rng.value = .05;
  runtime.player.invulnerable = 0;
  const rammer = runtime.enemies.find(e => e.alive);
  rammer.mesh.position.copy(runtime.player.mesh.position);
  runtime.collisions();
  assert.equal(rammer.alive, false);
  assert.equal(runtime.game.lives, 2);
  assert.equal(runtime.capsules.length, 2);
});

test('actual capsules fall, are collected on contact and are removed below the screen', () => {
  const { runtime, rng } = powerGame();
  const { player, capsules, scene } = runtime;
  player.invulnerable = 1000;
  rng.value = .05;
  const enemy = runtime.enemies[0];
  enemy.mesh.position.set(0, 0, COMBAT_Z);
  runtime.destroyEnemy(enemy);
  rng.value = .99;
  const capsule = capsules[0];
  runtime.update(.05);
  assert.ok(Math.abs(capsule.mesh.position.y - (0 - POWERUP_FALL_SPEED * .05)) < 1e-12);
  assert.equal(capsule.mesh.position.x, 0);
  assert.deepEqual(powerHud(runtime), HUD_HIDDEN);
  let frames = 1;
  while (capsules.length && frames < 200) { runtime.update(.05); frames++; }
  assert.equal(capsules.length, 0);
  assert.equal(scene.children.includes(capsule.mesh), false);
  assert.ok(capsule.mesh.position.distanceTo(player.mesh.position) < POWERUP_PICKUP_RADIUS);
  assert.ok(hasTwin(runtime.effects));
  assert.deepEqual(powerHud(runtime), { box: false, twin: [false, 'TWIN 10s'], shield: [true, ''] });
  // Missed capsule: the ship is far away, so it falls past the bottom and is removed without effect.
  player.x = 13.5;
  runtime.spawnCapsule('shield', { x: -10, y: 0 });
  const missed = capsules[0];
  while (capsules.length && frames < 1000) { runtime.update(.05); frames++; }
  assert.ok(missed.mesh.position.y < POWERUP_BOTTOM_Y);
  assert.equal(scene.children.includes(missed.mesh), false);
  assert.equal(runtime.effects.shield, false);
});

test('actual TWIN fires two parallel shots at the .22 s interval and returns to one shot after 10 s of play', () => {
  const { runtime } = powerGame();
  const { player, shots } = runtime;
  player.invulnerable = 1000;
  player.x = 13.5; // far from the formation so shots do not hit anything
  runtime.update(0);
  collect(runtime, 'twin');
  runtime.windowEvents.keydown({ key: ' ', preventDefault() {} });
  runtime.update(.05);
  assert.equal(shots.length, 2);
  assert.deepEqual(Array.from(shots, s => s.position.x), [13.05, 13.95]);
  assert.equal(shots[0].position.y, shots[1].position.y);
  assert.ok(shots.every(s => s.velocity === 30 && s.position.z === COMBAT_Z));
  runtime.update(.1);
  assert.equal(shots.length, 2, 'cooldown still applies');
  runtime.update(.15);
  assert.equal(shots.length, 4);
  runtime.windowEvents.keyup({ key: ' ' });
  // 10 - .05 - .1 - .15 = 9.7 s left. Pause does not run update(), so time and capsules stop.
  runtime.spawnCapsule('shield', { x: -10, y: 5 });
  const capsuleY = runtime.capsules[0].mesh.position.y;
  runtime.game.state = 'paused';
  runtime.render(0); runtime.render(40); runtime.render(5000);
  assert.ok(Math.abs(runtime.effects.twin - 9.7) < 1e-9);
  assert.equal(runtime.capsules[0].mesh.position.y, capsuleY);
  runtime.game.state = 'playing';
  for (let frame = 0; frame < 192; frame++) runtime.update(.05); // 9.6 s
  assert.ok(hasTwin(runtime.effects));
  assert.equal(powerHud(runtime).twin[1], 'TWIN 1s');
  const before = shots.length;
  runtime.windowEvents.keydown({ key: ' ', preventDefault() {} });
  runtime.update(.15); // expires in this frame, before firing
  assert.equal(hasTwin(runtime.effects), false);
  assert.equal(shots.length - before, 1);
  assert.equal(shots.at(-1).position.x, player.x);
  assert.deepEqual(powerHud(runtime), HUD_HIDDEN);
});

test('actual SHIELD blocks the next valid hit from a shot or a body, once, and not while invulnerable', () => {
  // Enemy shot.
  let { runtime } = powerGame();
  collect(runtime, 'twin');
  collect(runtime, 'shield');
  assert.deepEqual(powerHud(runtime), { box: false, twin: [false, 'TWIN 10s'], shield: [false, 'SHIELD ×1'] });
  runtime.player.invulnerable = 0;
  const shooter = runtime.enemies[0];
  shooter.mesh.position.set(0, PLAYER_Y + 2.4, COMBAT_Z);
  runtime.fireEnemy(shooter);
  for (let frame = 0; frame < 6; frame++) runtime.update(.05);
  assert.equal(runtime.enemyShots.length, 0);
  assert.equal(runtime.game.lives, 3);
  assert.equal(runtime.effects.shield, false);
  assert.ok(hasTwin(runtime.effects), 'TWIN survives the block');
  assert.ok(runtime.player.invulnerable > 1.5, 'block grants the normal post-hit invulnerability');
  assert.deepEqual(powerHud(runtime).shield, [true, '']);
  runtime.player.invulnerable = 0;
  shooter.mesh.position.set(0, PLAYER_Y + 2.4, COMBAT_Z);
  runtime.fireEnemy(shooter);
  for (let frame = 0; frame < 6; frame++) runtime.update(.05);
  assert.equal(runtime.game.lives, 2, 'the next hit costs a life');

  // Body collision, including a shot hitting in the same frame.
  ({ runtime } = powerGame());
  collect(runtime, 'shield');
  runtime.player.invulnerable = 0;
  const rammer = runtime.enemies[0];
  rammer.mesh.position.copy(runtime.player.mesh.position);
  runtime.fireEnemy(rammer);
  runtime.enemyShots[0].previous = { x: 0, y: PLAYER_Y + 1, z: COMBAT_Z };
  runtime.collisions();
  assert.equal(rammer.alive, false);
  assert.equal(runtime.game.lives, 3, 'shot and body in one frame: one block, no life lost');
  assert.equal(runtime.effects.shield, false);

  // Existing invulnerability is checked first and does not use the shield.
  ({ runtime } = powerGame());
  collect(runtime, 'shield');
  runtime.player.invulnerable = 1;
  runtime.enemies[0].mesh.position.copy(runtime.player.mesh.position);
  runtime.collisions();
  assert.equal(runtime.game.lives, 3);
  assert.equal(runtime.effects.shield, true);
});

test('actual wave change keeps capsules and effects and advances the stage once', () => {
  const { runtime } = powerGame();
  runtime.player.invulnerable = 1000;
  collect(runtime, 'twin');
  collect(runtime, 'shield');
  runtime.spawnCapsule('twin', { x: -10, y: 10 });
  const capsule = runtime.capsules[0];
  runtime.enemies.forEach(e => { e.alive = false; });
  runtime.update(.05);
  assert.equal(runtime.game.stage, 2);
  for (let frame = 0; frame < 17; frame++) runtime.update(.05); // .85 s: still waiting
  assert.equal(runtime.game.stage, 2, 'no stage increase per empty frame');
  assert.equal(runtime.enemies.length, 0);
  runtime.update(.05);
  assert.equal(runtime.enemies.length, difficultyForStage(2).rows * 7);
  assert.equal(runtime.game.stage, 2);
  assert.equal(runtime.capsules.length, 1);
  assert.equal(runtime.capsules[0], capsule);
  assert.ok(runtime.scene.children.includes(capsule.mesh));
  assert.equal(runtime.effects.shield, true);
  assert.ok(hasTwin(runtime.effects));
  // A pending wave from a previous game does not change a restarted one.
  runtime.enemies.forEach(e => { e.alive = false; });
  runtime.update(.05);
  assert.equal(runtime.game.stage, 3);
  runtime.startGame();
  runtime.game.enemyFire = 1000;
  const wave = [...runtime.enemies];
  runtime.update(1);
  assert.equal(runtime.game.stage, 1);
  assert.equal(runtime.enemies.length, wave.length);
  assert.ok(wave.every((enemy, i) => runtime.enemies[i] === enemy));
});

test('actual new game and game over clear effects, capsules, scene meshes and the HUD', () => {
  let { runtime, rng } = powerGame();
  collect(runtime, 'twin');
  collect(runtime, 'shield');
  runtime.spawnCapsule('shield', { x: -10, y: 5 });
  const capsule = runtime.capsules[0];
  runtime.startGame();
  assert.deepEqual(runtime.effects, createEffects());
  assert.equal(runtime.capsules.length, 0);
  assert.equal(runtime.scene.children.includes(capsule.mesh), false);
  assert.deepEqual(powerHud(runtime), HUD_HIDDEN);

  // Game over in a frame that would also collect a capsule and score a dropping kill.
  ({ runtime, rng } = powerGame());
  collect(runtime, 'twin');
  runtime.game.lives = 1;
  runtime.player.invulnerable = 0;
  runtime.player.x = 0;
  const shooter = runtime.enemies[0];
  shooter.mesh.position.set(0, PLAYER_Y + .5, COMBAT_Z);
  runtime.fireEnemy(shooter);
  runtime.spawnCapsule('shield', { x: 0, y: PLAYER_Y + 1.5 });
  const late = runtime.capsules[0];
  runtime.update(.05);
  assert.equal(runtime.game.state, 'over');
  assert.deepEqual(runtime.effects, createEffects());
  assert.equal(runtime.capsules.length, 0);
  assert.equal(runtime.scene.children.includes(late.mesh), false);
  assert.deepEqual(powerHud(runtime), HUD_HIDDEN);
  rng.value = .05;
  runtime.destroyEnemy(runtime.enemies.find(e => e.alive));
  assert.equal(runtime.capsules.length, 0, 'no drop after game over');
  runtime.elements.get('#restartButton').listeners.click();
  assert.equal(runtime.game.state, 'playing');
  assert.equal(runtime.game.lives, 3);
  assert.deepEqual(powerHud(runtime), HUD_HIDDEN);
});

test('power-up HUD is written only when its text changes', () => {
  const { runtime } = powerGame();
  runtime.player.invulnerable = 1000;
  runtime.player.x = 13.5;
  collect(runtime, 'twin');
  const el = runtime.elements.get('#twinStatus');
  let writes = 0, text = el.textContent;
  Object.defineProperty(el, 'textContent', { get: () => text, set: value => { writes++; text = value; } });
  for (let frame = 0; frame < 50; frame++) runtime.update(.01); // 10 s -> 9.5 s still shows 10s
  assert.equal(writes, 0);
  for (let frame = 0; frame < 60; frame++) runtime.update(.01); // crosses 9 s
  assert.equal(writes, 1);
  assert.equal(text, 'TWIN 9s');
});
