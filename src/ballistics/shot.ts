import { Vec3, add, dot, length, normalize, scale, sub, vec3 } from '../core/vec3';
import type { Ammo } from './ammo';
import { BulletState, DEFAULT_STEP, FlightEnv, stepBullet } from './ballistics';

const WORLD_UP = vec3(0, 1, 0);

/** Unit vector perpendicular to the sight line, in its vertical plane, pointing "up" in the scope. */
export function sightUp(dir: Vec3): Vec3 {
  const d = normalize(dir);
  return normalize(sub(WORLD_UP, scale(d, dot(d, WORLD_UP))));
}

/** Tilts the sight line up by the zeroing elevation to get the bore (launch) direction. */
export function boreDirection(dir: Vec3, elevation: number): Vec3 {
  const d = normalize(dir);
  return add(scale(d, Math.cos(elevation)), scale(sightUp(d), Math.sin(elevation)));
}

/** The muzzle sits `sightHeight` below the scope along the scope's up axis. */
export function muzzleOrigin(eye: Vec3, dir: Vec3, sightHeight: number): Vec3 {
  return sub(eye, scale(sightUp(dir), sightHeight));
}

export interface AngleInfo {
  slant: number; // straight-line distance, m
  angle: number; // radians, + uphill / - downhill
  compensated: number; // horizontal-equivalent distance to dial for (rifleman's rule)
}

/** Rangefinder reading with angle compensation, like an ARC-equipped laser rangefinder. */
export function angleInfo(eye: Vec3, point: Vec3): AngleInfo {
  const d = sub(point, eye);
  const slant = length(d);
  const angle = slant === 0 ? 0 : Math.asin(d.y / slant);
  return { slant, angle, compensated: slant * Math.cos(angle) };
}

export function launchState(ammo: Ammo, origin: Vec3, dir: Vec3): BulletState {
  return { pos: origin, vel: scale(normalize(dir), ammo.muzzleVelocity), time: 0 };
}

/**
 * Steps a bullet until `hit` reports an impact on the segment from the previous to the
 * next position (returning the fraction along it), or until maxTime. Used by tests and tools;
 * the game steps bullets incrementally per frame with the same stepBullet.
 */
export function simulateToImpact(
  ammo: Ammo,
  env: FlightEnv,
  start: BulletState,
  hit: (a: Vec3, b: Vec3) => number | null,
  maxTime = 3,
): { point: Vec3; state: BulletState } | null {
  let s = start;
  while (s.time < maxTime) {
    const next = stepBullet(ammo, env, s, DEFAULT_STEP);
    const f = hit(s.pos, next.pos);
    if (f !== null) {
      return { point: add(s.pos, scale(sub(next.pos, s.pos), f)), state: next };
    }
    s = next;
  }
  return null;
}
