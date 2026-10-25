import type { V3 } from './projectile';

// Humanoid hit zones in the character's local frame: feet at the origin, +y up.
// Shared by target dummies, bots and the player. Pure.

export type Zone = 'head' | 'torso' | 'legs';

interface Box {
  min: V3;
  max: V3;
}

export const HEAD = { c: { x: 0, y: 1.62, z: 0 }, r: 0.15 };
export const TORSO: Box = { min: { x: -0.25, y: 0.95, z: -0.15 }, max: { x: 0.25, y: 1.48, z: 0.15 } };
export const LEGS: Box = { min: { x: -0.2, y: 0, z: -0.13 }, max: { x: 0.2, y: 0.95, z: 0.13 } };
export const HEIGHT = 1.8;

/** Fraction along a→b where it enters the sphere, or null. */
export function sphereEntry(a: V3, b: V3, c: V3, r: number): number | null {
  const d = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const f = { x: a.x - c.x, y: a.y - c.y, z: a.z - c.z };
  const A = d.x * d.x + d.y * d.y + d.z * d.z;
  const B = 2 * (f.x * d.x + f.y * d.y + f.z * d.z);
  const C = f.x * f.x + f.y * f.y + f.z * f.z - r * r;
  const disc = B * B - 4 * A * C;
  if (disc < 0 || A === 0) return null;
  const t = (-B - Math.sqrt(disc)) / (2 * A);
  if (t >= 0 && t <= 1) return t;
  return C <= 0 ? 0 : null; // started inside
}

/** Fraction along a→b where it enters the box (slab method), or null. */
function boxEntry(a: V3, b: V3, box: Box): number | null {
  let t0 = 0;
  let t1 = 1;
  for (const k of ['x', 'y', 'z'] as const) {
    const d = b[k] - a[k];
    if (Math.abs(d) < 1e-12) {
      if (a[k] < box.min[k] || a[k] > box.max[k]) return null;
      continue;
    }
    let ta = (box.min[k] - a[k]) / d;
    let tb = (box.max[k] - a[k]) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  return t0;
}

/** First zone the local-space segment touches, with the fraction along it. */
export function hitZone(a: V3, b: V3): { zone: Zone; t: number } | null {
  let best: { zone: Zone; t: number } | null = null;
  const consider = (zone: Zone, t: number | null) => {
    if (t !== null && (!best || t < best.t)) best = { zone, t };
  };
  consider('head', sphereEntry(a, b, HEAD.c, HEAD.r));
  consider('torso', boxEntry(a, b, TORSO));
  consider('legs', boxEntry(a, b, LEGS));
  return best;
}

/** Axis-aligned box intersection for world obstacles (same slab method). */
export function segmentBox(a: V3, b: V3, min: V3, max: V3): number | null {
  return boxEntry(a, b, { min, max });
}
