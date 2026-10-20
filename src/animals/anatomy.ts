import { Vec3, add, dot, scale, sub, vec3 } from '../core/vec3';
import type { Ammo } from '../ballistics/ammo';

// Simplified white-tailed deer anatomy in the animal's local frame:
// origin on the ground under the body centre, +y up, +z toward the head, +x to the deer's left.
// Dimensions follow a mid-sized adult (≈1 m at the shoulder, ≈65 kg). The heart sits low and
// just behind the elbow, so a broadside shot "behind the shoulder" reaches it without hitting the leg.

export type OrganId =
  | 'brain' | 'neckSpine' | 'spine' | 'heart' | 'lungL' | 'lungR' | 'aorta'
  | 'liver' | 'gut' | 'legFL' | 'legFR' | 'legHL' | 'legHR';

/** Shapes in the 'neck' group rotate with the neck (grazing, alert), defined here in the head-up rest pose. */
export type Shape = ({ kind: 'ellipsoid'; c: Vec3; r: Vec3 } | { kind: 'capsule'; a: Vec3; b: Vec3; r: number }) & {
  neck?: boolean;
};

/** Pivot at the base of the neck; the visual model rotates its neck group about local x here. */
export const NECK_PIVOT = vec3(0, 0.98, 0.5);

export interface Pose {
  /** Rotation of the neck group about local x, radians (Three.js convention, positive = head down). */
  neckPitch: number;
}
export const REST_POSE: Pose = { neckPitch: 0 };

export interface Organ {
  id: OrganId;
  name: string; // display name (zh-Hant)
  shape: Shape;
  bone: boolean; // costs a fixed amount of energy to pass through
}

const E = (c: Vec3, r: Vec3, neck = false): Shape => ({ kind: 'ellipsoid', c, r, neck });
const C = (a: Vec3, b: Vec3, r: number, neck = false): Shape => ({ kind: 'capsule', a, b, r, neck });

/** Outer body volume (skin and muscle). */
export const HULL: Shape[] = [
  E(vec3(0, 0.85, 0), vec3(0.2, 0.24, 0.62)), // torso
  E(vec3(0, 0.82, 0.3), vec3(0.19, 0.23, 0.3)), // deep chest (brisket) around heart and lungs
  C(vec3(0, 0.98, 0.5), vec3(0, 1.36, 0.76), 0.1, true), // neck
  E(vec3(0, 1.42, 0.88), vec3(0.08, 0.09, 0.17), true), // head
  C(vec3(0.11, 0.7, 0.45), vec3(0.11, 0.04, 0.48), 0.05), // front left leg
  C(vec3(-0.11, 0.7, 0.45), vec3(-0.11, 0.04, 0.48), 0.05),
  C(vec3(0.11, 0.72, -0.5), vec3(0.11, 0.04, -0.54), 0.06), // hind left leg
  C(vec3(-0.11, 0.72, -0.5), vec3(-0.11, 0.04, -0.54), 0.06),
];

export const ORGANS: Organ[] = [
  { id: 'brain', name: '腦', shape: E(vec3(0, 1.46, 0.83), vec3(0.045, 0.045, 0.055), true), bone: false },
  { id: 'neckSpine', name: '頸椎', shape: C(vec3(0, 1.04, 0.47), vec3(0, 1.4, 0.75), 0.03, true), bone: true },
  { id: 'spine', name: '脊椎', shape: C(vec3(0, 1.03, 0.42), vec3(0, 1.0, -0.55), 0.032), bone: true },
  { id: 'heart', name: '心臟', shape: E(vec3(0, 0.71, 0.33), vec3(0.06, 0.075, 0.065)), bone: false },
  { id: 'lungL', name: '左肺', shape: E(vec3(0.085, 0.85, 0.3), vec3(0.085, 0.13, 0.17)), bone: false },
  { id: 'lungR', name: '右肺', shape: E(vec3(-0.085, 0.85, 0.3), vec3(0.085, 0.13, 0.17)), bone: false },
  { id: 'aorta', name: '主動脈', shape: C(vec3(0, 0.78, 0.32), vec3(0, 0.96, 0.05), 0.022), bone: false },
  { id: 'liver', name: '肝臟', shape: E(vec3(-0.02, 0.78, 0.06), vec3(0.13, 0.12, 0.09)), bone: false },
  { id: 'gut', name: '胃腸', shape: E(vec3(0, 0.78, -0.27), vec3(0.17, 0.18, 0.3)), bone: false },
  { id: 'legFL', name: '左前腿骨', shape: C(vec3(0.11, 0.68, 0.45), vec3(0.11, 0.06, 0.48), 0.022), bone: true },
  { id: 'legFR', name: '右前腿骨', shape: C(vec3(-0.11, 0.68, 0.45), vec3(-0.11, 0.06, 0.48), 0.022), bone: true },
  { id: 'legHL', name: '左後腿骨', shape: C(vec3(0.11, 0.7, -0.5), vec3(0.11, 0.06, -0.54), 0.026), bone: true },
  { id: 'legHR', name: '右後腿骨', shape: C(vec3(-0.11, 0.7, -0.5), vec3(-0.11, 0.06, -0.54), 0.026), bone: true },
];

/** Bounding sphere of the whole animal for cheap rejection. */
export const BOUNDS = { c: vec3(0, 0.8, 0.1), r: 1.25 };

/** Maps a body-frame point into the neck's rest frame for the given pose. */
function unpose(p: Vec3, pose: Pose): Vec3 {
  if (pose.neckPitch === 0) return p;
  const c = Math.cos(-pose.neckPitch);
  const s = Math.sin(-pose.neckPitch);
  const y = p.y - NECK_PIVOT.y;
  const z = p.z - NECK_PIVOT.z;
  return vec3(p.x, NECK_PIVOT.y + y * c - z * s, NECK_PIVOT.z + y * s + z * c);
}

export function contains(s: Shape, point: Vec3, pose: Pose = REST_POSE): boolean {
  const p = s.neck ? unpose(point, pose) : point;
  if (s.kind === 'ellipsoid') {
    const x = (p.x - s.c.x) / s.r.x;
    const y = (p.y - s.c.y) / s.r.y;
    const z = (p.z - s.c.z) / s.r.z;
    return x * x + y * y + z * z <= 1;
  }
  const ab = sub(s.b, s.a);
  const t = Math.max(0, Math.min(1, dot(sub(p, s.a), ab) / dot(ab, ab)));
  const q = add(s.a, scale(ab, t));
  const d = sub(p, q);
  return dot(d, d) <= s.r * s.r;
}

export const inHull = (p: Vec3, pose: Pose = REST_POSE) => HULL.some((s) => contains(s, p, pose));

// ---- Terminal ballistics ----

/** Energy (J) lost per metre of soft tissue, and per bone crossed, by bullet construction. */
const TISSUE_LOSS = { softPoint: 4500, fmj: 1700 };
const BONE_LOSS = { softPoint: 350, fmj: 120 };
/** Soft points need this impact speed to expand fully; below it they behave more like solids. */
const EXPANSION_VELOCITY = 550; // m/s
const STEP = 0.005; // m

export interface OrganHit {
  organ: Organ;
  length: number; // m of wound channel inside the organ
}

export interface WoundResult {
  entry: Vec3;
  /** Where the bullet left the body, or null if it stopped inside. */
  exit: Vec3 | null;
  exitVelocity: number;
  penetration: number; // m of body travelled
  /** Wound channel diameter in metres; scales bleeding. */
  channel: number;
  organs: OrganHit[];
}

/**
 * Traces a bullet through the body along a straight line from `entry` (a point on the hull)
 * in direction `dir` (unit, local frame) at `velocity` m/s. Organs are hit in order; tissue
 * and bone consume energy, so a bullet may stop before reaching deeper organs.
 */
export function traceWound(ammo: Ammo, entry: Vec3, dir: Vec3, velocity: number, pose: Pose = REST_POSE): WoundResult {
  let energy = 0.5 * ammo.massKg * velocity * velocity;
  const expansion =
    ammo.type === 'softPoint' ? Math.min(1, Math.max(0, (velocity - 350) / (EXPANSION_VELOCITY - 350))) : 0;
  // Expanded soft points open to ~2.2× calibre and dump energy faster; FMJ stays narrow.
  const lossPerM =
    ammo.type === 'softPoint' ? TISSUE_LOSS.fmj + (TISSUE_LOSS.softPoint - TISSUE_LOSS.fmj) * expansion : TISSUE_LOSS.fmj;
  const boneLoss = ammo.type === 'softPoint' ? BONE_LOSS.fmj + (BONE_LOSS.softPoint - BONE_LOSS.fmj) * expansion : BONE_LOSS.fmj;
  const channel = ammo.diameterM * (ammo.type === 'softPoint' ? 1.4 + 1.6 * expansion : 1.4);

  const lengths = new Map<OrganId, number>();
  const insideBone = new Set<OrganId>();
  let travelled = 0;
  let lastInside = entry;
  let outsideRun = 0;
  for (let d = 0; d < 2.5; d += STEP) {
    const p = add(entry, scale(dir, d));
    if (!inHull(p, pose)) {
      // Allow short gaps (e.g. between a leg and the chest) before declaring an exit.
      outsideRun += STEP;
      if (outsideRun > 0.25) break;
      continue;
    }
    outsideRun = 0;
    lastInside = p;
    travelled += STEP;
    energy -= lossPerM * STEP;
    for (const o of ORGANS) {
      if (!contains(o.shape, p, pose)) {
        insideBone.delete(o.id);
        continue;
      }
      lengths.set(o.id, (lengths.get(o.id) ?? 0) + STEP);
      if (o.bone && !insideBone.has(o.id)) {
        insideBone.add(o.id);
        energy -= boneLoss;
      }
    }
    if (energy <= 0) {
      return { entry, exit: null, exitVelocity: 0, penetration: travelled, channel, organs: toHits(lengths) };
    }
  }
  const exitVelocity = Math.sqrt((2 * energy) / ammo.massKg);
  return { entry, exit: lastInside, exitVelocity, penetration: travelled, channel, organs: toHits(lengths) };
}

function toHits(lengths: Map<OrganId, number>): OrganHit[] {
  return ORGANS.filter((o) => lengths.has(o.id)).map((o) => ({ organ: o, length: lengths.get(o.id)! }));
}

/**
 * Finds where a segment (local frame) first enters the body, or null.
 * Returns the fraction along the segment.
 */
export function findEntry(a: Vec3, b: Vec3, pose: Pose = REST_POSE): number | null {
  const ab = sub(b, a);
  const len = Math.sqrt(dot(ab, ab));
  // Reject segments that miss the bounding sphere.
  const t = Math.max(0, Math.min(1, dot(sub(BOUNDS.c, a), ab) / (len * len)));
  const closest = sub(add(a, scale(ab, t)), BOUNDS.c);
  if (dot(closest, closest) > BOUNDS.r * BOUNDS.r) return null;
  const steps = Math.ceil(len / 0.01);
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    if (inHull(add(a, scale(ab, f)), pose)) return f;
  }
  return null;
}
