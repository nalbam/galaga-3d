import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as combat from '../docs/combat.mjs';

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
function loadGame() {
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
  math.random = () => .99; // No random dives/fire during deterministic game-loop tests.
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
  const runtime = vm.runInContext('({ game, player, enemies, shots, enemyShots, scene, camera, startGame, createWave, firePlayer, fireEnemy, update, collisions, resize })', context);
  runtime.game.muted = true;
  return { ...runtime, elements, windowEvents };
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
