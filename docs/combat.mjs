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
