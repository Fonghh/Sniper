import { Vec3, add, length, scale, sub, vec3 } from '../core/vec3';
import type { Ammo } from './ammo';
import { g7Cd } from './dragG7';

export const GRAVITY = 9.80665;
/** Converts a ballistic coefficient from lb/in² to kg/m². */
const BC_LBIN2_TO_KGM2 = 703.0696;

export interface Atmosphere {
  density: number; // kg/m³
  speedOfSound: number; // m/s
}

export const STANDARD_ATMOSPHERE: Atmosphere = { density: 1.225, speedOfSound: 340.3 };

export interface BulletState {
  pos: Vec3;
  vel: Vec3;
  time: number;
}

/** Wind as a function of position, so terrain/altitude layers can be added later. */
export type WindField = (pos: Vec3) => Vec3;
export const NO_WIND: WindField = () => vec3();

export interface FlightEnv {
  atmosphere: Atmosphere;
  wind: WindField;
}

export const DEFAULT_ENV: FlightEnv = { atmosphere: STANDARD_ATMOSPHERE, wind: NO_WIND };

/** Acceleration from gravity plus G7 drag on the air-relative velocity. */
function acceleration(ammo: Ammo, env: FlightEnv, pos: Vec3, vel: Vec3): Vec3 {
  const rel = sub(vel, env.wind(pos));
  const speed = length(rel);
  const gravity = vec3(0, -GRAVITY, 0);
  if (speed === 0) return gravity;
  const cd = g7Cd(speed / env.atmosphere.speedOfSound);
  const bc = ammo.bcG7 * BC_LBIN2_TO_KGM2;
  // a = ρ·v²·Cd_ref·π / (8·BC), directed against the relative velocity.
  const dragMag = (env.atmosphere.density * speed * speed * cd * Math.PI) / (8 * bc);
  return add(gravity, scale(rel, -dragMag / speed));
}

/** Advances a bullet by dt seconds with one RK4 step. Pure: returns a new state. */
export function stepBullet(ammo: Ammo, env: FlightEnv, s: BulletState, dt: number): BulletState {
  const a1 = acceleration(ammo, env, s.pos, s.vel);
  const v1 = s.vel;

  const p2 = add(s.pos, scale(v1, dt / 2));
  const v2 = add(s.vel, scale(a1, dt / 2));
  const a2 = acceleration(ammo, env, p2, v2);

  const p3 = add(s.pos, scale(v2, dt / 2));
  const v3 = add(s.vel, scale(a2, dt / 2));
  const a3 = acceleration(ammo, env, p3, v3);

  const p4 = add(s.pos, scale(v3, dt));
  const v4 = add(s.vel, scale(a3, dt));
  const a4 = acceleration(ammo, env, p4, v4);

  const pos = add(s.pos, scale(add(add(v1, scale(v2, 2)), add(scale(v3, 2), v4)), dt / 6));
  const vel = add(s.vel, scale(add(add(a1, scale(a2, 2)), add(scale(a3, 2), a4)), dt / 6));
  return { pos, vel, time: s.time + dt };
}

export function kineticEnergy(ammo: Ammo, s: BulletState): number {
  const v = length(s.vel);
  return 0.5 * ammo.massKg * v * v;
}

export const DEFAULT_STEP = 0.002;

export interface RangeSample {
  range: number; // m, downrange distance along +z
  drop: number; // m, height relative to the line of sight (negative = below)
  drift: number; // m, lateral offset (+x)
  velocity: number;
  time: number;
  energy: number;
}

/**
 * Fires from the muzzle at `elevation` radians above the line of sight and records the
 * trajectory at each requested range. The line of sight starts `sightHeight` above the bore.
 */
export function trajectory(
  ammo: Ammo,
  elevation: number,
  ranges: number[],
  opts: { sightHeight?: number; env?: FlightEnv; dt?: number } = {},
): RangeSample[] {
  const sightHeight = opts.sightHeight ?? 0.04;
  const env = opts.env ?? DEFAULT_ENV;
  const dt = opts.dt ?? DEFAULT_STEP;
  const sorted = [...ranges].sort((a, b) => a - b);
  const out: RangeSample[] = [];

  let s: BulletState = {
    pos: vec3(0, -sightHeight, 0),
    vel: vec3(0, ammo.muzzleVelocity * Math.sin(elevation), ammo.muzzleVelocity * Math.cos(elevation)),
    time: 0,
  };
  for (const target of sorted) {
    while (s.pos.z < target) {
      const next = stepBullet(ammo, env, s, dt);
      if (next.pos.z >= target) {
        // Interpolate to the exact range for stable sampling.
        const f = (target - s.pos.z) / (next.pos.z - s.pos.z);
        const lerp = (a: number, b: number) => a + (b - a) * f;
        const interp: BulletState = {
          pos: vec3(lerp(s.pos.x, next.pos.x), lerp(s.pos.y, next.pos.y), target),
          vel: vec3(lerp(s.vel.x, next.vel.x), lerp(s.vel.y, next.vel.y), lerp(s.vel.z, next.vel.z)),
          time: lerp(s.time, next.time),
        };
        out.push({
          range: target,
          drop: interp.pos.y,
          drift: interp.pos.x,
          velocity: length(interp.vel),
          time: interp.time,
          energy: kineticEnergy(ammo, interp),
        });
        s = next;
        break;
      }
      s = next;
    }
  }
  return out;
}

/** Finds the bore elevation (radians) at which the bullet crosses the line of sight at `zeroRange`. */
export function zeroElevation(
  ammo: Ammo,
  zeroRange: number,
  opts: { sightHeight?: number; env?: FlightEnv } = {},
): number {
  // Zeroing is done in calm conditions, as on a range.
  const calm = { ...(opts.env ?? DEFAULT_ENV), wind: NO_WIND };
  let lo = 0;
  let hi = 0.05;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    const [sample] = trajectory(ammo, mid, [zeroRange], { ...opts, env: calm });
    if (sample.drop < 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
