// Gameplay uses the XY plane; depth is reserved for decorative geometry.
export const COMBAT_Z = 0;
export const PLAYER_Y = -8;
export const DIVE_DURATION = 1.7;
export const RETURN_DURATION = 1.2;

export function formationPosition(enemy, time) {
  return {
    x: enemy.baseX + Math.sin(time * .85) * 2.3,
    y: enemy.y + Math.sin(time * 2 + enemy.phase) * .16,
    z: COMBAT_Z,
  };
}

export function beginDive(enemy, time, targetX, position) {
  enemy.diving = true;
  enemy.diveStart = time;
  enemy.diveX = targetX;
  enemy.diveFrom = { x: position.x, y: position.y, z: COMBAT_Z };
}

export function enemyPosition(enemy, time) {
  const slot = formationPosition(enemy, time);
  if (!enemy.diving) return slot;
  const elapsed = Math.max(0, time - enemy.diveStart);
  const target = { x: enemy.diveX, y: PLAYER_Y + 1, z: COMBAT_Z };
  if (elapsed >= DIVE_DURATION + RETURN_DURATION) {
    enemy.diving = false;
    return slot;
  }
  const returning = elapsed >= DIVE_DURATION;
  const t = returning ? (elapsed - DIVE_DURATION) / RETURN_DURATION : elapsed / DIVE_DURATION;
  const from = returning ? target : enemy.diveFrom;
  const to = returning ? slot : target;
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, z: COMBAT_Z };
}

export function createProjectile(position, velocity) {
  return { position, previous: { ...position }, velocity };
}

export function advanceProjectile(shot, dt) {
  shot.previous = { x: shot.position.x, y: shot.position.y, z: shot.position.z };
  shot.position.y += shot.velocity * dt;
}

// Test the whole frame's segment, not just its endpoint (fast shots can skip a target).
export function projectileHits(shot, target, radius) {
  if (shot.dead) return false;
  const from = shot.previous, to = shot.position;
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const lengthSquared = dx * dx + dy * dy + dz * dz;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
    ((target.x - from.x) * dx + (target.y - from.y) * dy + (target.z - from.z) * dz) / lengthSquared));
  return Math.hypot(target.x - from.x - dx * t, target.y - from.y - dy * t, target.z - from.z - dz * t) < radius;
}

// Difficulty is a pure function of the stage. Continuous values approach a cap
// along 1-exp(-(stage-1)/k), so stage 1 is the easiest and steps shrink over time.
// Integer values (dives, rows, elites) change by at most one step per stage.
const ease = (stage, start, cap, k) => start + (cap - start) * (1 - Math.exp(-(Math.max(1, stage) - 1) / k));
export const WAVE_COLUMNS = 7;

export function difficultyForStage(stage) {
  stage = Math.max(1, Math.floor(stage) || 1);
  const diveFireChance = ease(stage, .12, .22, 8);
  const hasBoss = stage >= 3 && stage % 3 === 0;
  return {
    diveChance: ease(stage, .010, .032, 6),            // per grounded enemy per second
    fireInterval: ease(stage, 2.2, .8, 7),             // seconds between random formation shots
    enemyShotSpeed: ease(stage, 5.5, 9.5, 8),          // world units per second
    diveFireChance,                                    // per diving enemy per second
    bossFireChance: diveFireChance * 1.5,
    maxConcurrentDives: Math.min(4, 1 + Math.floor((stage - 1) / 3)),
    maxEnemyShots: Math.min(8, 3 + Math.floor(stage / 3)),
    rows: Math.min(5, 3 + Math.floor((stage - 1) / 3)),
    eliteCount: stage < 3 ? 0 : Math.min(WAVE_COLUMNS, 2 * Math.floor(stage / 3)), // filled from the row ends inward
    bossHealth: hasBoss ? Math.min(10, 4 + Math.floor(stage / 3)) : 0,
  };
}

export const PLAYER_X_LIMIT = 13.5;

// Map a pointer's clientX to a world X on the combat plane for a perspective camera
// looking down -Z. Returns null for an unusable rect or camera so callers skip the move.
export function pointerToWorldX({ clientX, rect, fov, aspect, cameraZ, planeZ = COMBAT_Z, limit = PLAYER_X_LIMIT }) {
  if (!rect || !(rect.width > 0) || !Number.isFinite(clientX)) return null;
  const distance = cameraZ - planeZ;
  if (!(distance > 0) || !(aspect > 0) || !(fov > 0 && fov < 180)) return null;
  const ndc = ((clientX - rect.left) / rect.width) * 2 - 1;
  const halfWidth = distance * Math.tan(fov * Math.PI / 360) * aspect;
  return Math.max(-limit, Math.min(limit, ndc * halfWidth));
}
