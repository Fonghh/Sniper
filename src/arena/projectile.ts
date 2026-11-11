// Projectile physics for the arena: gravity plus quadratic air drag, integrated in small
// fixed steps. Speeds are deliberately low (rifle ~220 m/s, arrows ~60 m/s, grenades ~18 m/s)
// so that drop is visible and matters at 10–80 m. Pure and testable.

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export interface ProjectileSpec {
  /** Quadratic drag coefficient k (1/m): a = -k·|v|·v. */
  drag: number;
  /** Downward acceleration, m/s². */
  gravity: number;
}

export interface ProjectileState {
  pos: V3;
  vel: V3;
  time: number;
}

export const STEP = 1 / 240; // s

/** Advances one step with semi-implicit Euler (stable and cheap at this step size). */
export function stepProjectile(s: ProjectileState, spec: ProjectileSpec, dt = STEP): ProjectileState {
  const speed = Math.hypot(s.vel.x, s.vel.y, s.vel.z);
  const k = spec.drag * speed;
  const vel = {
    x: s.vel.x - k * s.vel.x * dt,
    y: s.vel.y - (spec.gravity + k * s.vel.y) * dt,
    z: s.vel.z - k * s.vel.z * dt,
  };
  const pos = { x: s.pos.x + vel.x * dt, y: s.pos.y + vel.y * dt, z: s.pos.z + vel.z * dt };
  return { pos, vel, time: s.time + dt };
}

/**
 * Traces a flight until `stop` reports contact (or maxTime), returning sampled points.
 * Used for the grenade's landing preview; the real projectile uses the same steps, so the
 * preview is exact in the absence of moving obstacles.
 */
export function traceArc(
  start: ProjectileState,
  spec: ProjectileSpec,
  stop: (a: V3, b: V3) => boolean,
  maxTime = 4,
  sampleEvery = 6,
): V3[] {
  const points: V3[] = [start.pos];
  let s = start;
  let n = 0;
  while (s.time < maxTime) {
    const next = stepProjectile(s, spec);
    if (stop(s.pos, next.pos)) {
      points.push(next.pos);
      break;
    }
    if (++n % sampleEvery === 0) points.push(next.pos);
    s = next;
  }
  return points;
}

/** Height of the projectile when it has travelled `range` metres horizontally (fired level). */
export function dropAt(speed: number, spec: ProjectileSpec, range: number): number {
  let s: ProjectileState = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: speed }, time: 0 };
  while (s.pos.z < range && s.time < 10) s = stepProjectile(s, spec);
  return s.pos.y;
}
