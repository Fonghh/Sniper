import { Vec3, add, dot, scale, sub, vec3 } from '../core/vec3';
import type { Ammo } from '../ballistics/ammo';

// Simplified white-tailed deer anatomy in the animal's local frame:
// origin on the ground under the body centre, +y up, +z toward the head, +x to the deer's left.
// Dimensions follow a mid-sized adult (≈1 m at the shoulder, ≈65 kg). The heart sits low and
// just behind the elbow, so a broadside shot "behind the shoulder" reaches it without hitting the leg.

export type OrganId =
  | 'brain' | 'neckSpine' | 'spine' | 'heart' | 'lungL' | 'lungR' | 'aorta'
  | 'liver' | 'gut' | 'legFL' | 'legFR' | 'legHL' | 'legHR';

/** Rigid parts that can be posed; each rotates about local x at its pivot. */
export type PartId = 'neck' | 'legFL' | 'legFR' | 'legHL' | 'legHR';

/**
 * A volume in the body frame, in the rest pose (head up, legs straight). `part` makes it follow
 * that part's rotation; `skin` picks the visual material when the model is built from it.
 * Capsules taper linearly from `r` at `a` to `rb` at `b`.
 */
export type Shape = (
  | { kind: 'ellipsoid'; c: Vec3; r: Vec3 }
  | { kind: 'capsule'; a: Vec3; b: Vec3; r: number; rb: number }
  | { kind: 'body' }
) & { part?: PartId; skin?: 'coat' | 'hoof' };

/** Pivot at the base of the neck; the visual model rotates its neck group about local x here. */
export const NECK_PIVOT = vec3(0, 0.98, 0.5);
const FRONT_HIP = (x: number) => vec3(x, 0.72, 0.45);
const HIND_HIP = (x: number) => vec3(x, 0.76, -0.48);
export const PIVOTS: Record<PartId, Vec3> = {
  neck: NECK_PIVOT,
  legFL: FRONT_HIP(0.11),
  legFR: FRONT_HIP(-0.11),
  legHL: HIND_HIP(0.11),
  legHR: HIND_HIP(-0.11),
};
export const LEG_PARTS: PartId[] = ['legFL', 'legFR', 'legHL', 'legHR'];

export interface Pose {
  /** Rotation of the neck group about local x, radians (Three.js convention, positive = head down). */
  neckPitch: number;
  /** Leg swing about local x at each hip, in LEG_PARTS order (positive = foot swings back). */
  legs: [number, number, number, number];
}
export const REST_POSE: Pose = { neckPitch: 0, legs: [0, 0, 0, 0] };

function partAngle(part: PartId, pose: Pose): number {
  return part === 'neck' ? pose.neckPitch : pose.legs[LEG_PARTS.indexOf(part)];
}

// ---- Body silhouette, shared by hit testing and the visual mesh ----

export const BODY_HALF_LENGTH = 0.66;
type Keys = ReadonlyArray<readonly [number, number]>;
/** Straight back, deep brisket, tucked waist, rounded rump (y values along local z). */
export const BODY_BACK: Keys = [[-0.66, 0.96], [-0.5, 1.07], [-0.2, 1.06], [0.1, 1.05], [0.35, 1.07], [0.55, 1.05], [0.66, 0.98]];
export const BODY_BELLY: Keys = [[-0.66, 0.82], [-0.5, 0.68], [-0.2, 0.67], [0.1, 0.64], [0.35, 0.59], [0.55, 0.64], [0.66, 0.82]];
const BODY_HALF_WIDTH: Keys = [[-0.66, 0.09], [-0.5, 0.17], [-0.2, 0.19], [0.1, 0.2], [0.35, 0.18], [0.55, 0.14], [0.66, 0.08]];

export function profile(keys: Keys, z: number): number {
  if (z <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (z <= keys[i][0]) {
      const [z0, a] = keys[i - 1];
      const [z1, b] = keys[i];
      return a + ((b - a) * (z - z0)) / (z1 - z0);
    }
  }
  return keys[keys.length - 1][1];
}

/** Elliptical cross-section of the torso at local z, or null beyond its ends. */
export function bodySection(z: number): { mid: number; halfHeight: number; halfWidth: number } | null {
  const u = z / BODY_HALF_LENGTH;
  if (Math.abs(u) > 1 + 1e-6) return null; // tolerate float32 mesh vertices at the tips
  const round = Math.pow(Math.sqrt(Math.max(1 - u * u, 0)), 0.7); // slightly fuller ends than an ellipsoid
  const top = profile(BODY_BACK, z);
  const bottom = profile(BODY_BELLY, z);
  return { mid: (top + bottom) / 2, halfHeight: ((top - bottom) / 2) * round, halfWidth: profile(BODY_HALF_WIDTH, z) * round };
}

export interface Organ {
  id: OrganId;
  name: string; // display name (zh-Hant)
  shapes: Shape[];
  bone: boolean; // costs a fixed amount of energy to pass through
}

const E = (c: Vec3, r: Vec3, part?: PartId): Shape => ({ kind: 'ellipsoid', c, r, part });
const C = (a: Vec3, b: Vec3, r: number, rb = r, part?: PartId, skin?: 'hoof'): Shape => ({ kind: 'capsule', a, b, r, rb, part, skin });

function frontLegHull(part: PartId, x: number): Shape[] {
  const h = FRONT_HIP(x);
  const at = (dy: number, dz: number) => vec3(x, h.y + dy, h.z + dz);
  return [
    E(at(-0.12, 0), vec3(0.06, 0.15, 0.075), part), // shoulder and forearm muscle
    C(at(-0.1, 0.01), at(-0.34, 0.02), 0.045, 0.03, part),
    C(at(-0.34, 0.02), at(-0.62, 0.03), 0.024, 0.02, part),
    C(at(-0.62, 0.03), at(-0.68, 0.04), 0.022, 0.026, part, 'hoof'),
  ];
}

function hindLegHull(part: PartId, x: number): Shape[] {
  const h = HIND_HIP(x);
  const at = (dy: number, dz: number) => vec3(x, h.y + dy, h.z + dz);
  return [
    E(at(-0.06, -0.01), vec3(0.075, 0.17, 0.13), part), // haunch
    C(at(-0.2, 0.04), at(-0.4, -0.1), 0.05, 0.028, part),
    C(at(-0.4, -0.1), at(-0.66, -0.07), 0.024, 0.02, part),
    C(at(-0.66, -0.07), at(-0.72, -0.05), 0.022, 0.026, part, 'hoof'),
  ];
}

/** Outer body volume (skin and muscle). The visual model is built from these same shapes. */
export const HULL: Shape[] = [
  { kind: 'body' },
  C(vec3(0, 0.92, 0.45), vec3(0, 1.38, 0.76), 0.15, 0.075, 'neck'),
  E(vec3(0, 1.4, 0.79), vec3(0.068, 0.075, 0.075), 'neck'), // throat latch: joins neck to head
  E(vec3(0, 1.46, 0.85), vec3(0.085, 0.09, 0.105), 'neck'), // skull
  C(vec3(0, 1.44, 0.9), vec3(0, 1.39, 1.02), 0.065, 0.038, 'neck'), // muzzle
  ...frontLegHull('legFL', 0.11),
  ...frontLegHull('legFR', -0.11),
  ...hindLegHull('legHL', 0.11),
  ...hindLegHull('legHR', -0.11),
];

function frontLegBone(part: PartId, x: number): Shape[] {
  const h = FRONT_HIP(x);
  const at = (dy: number, dz: number) => vec3(x, h.y + dy, h.z + dz);
  return [C(at(-0.04, 0), at(-0.34, 0.02), 0.022, 0.02, part), C(at(-0.34, 0.02), at(-0.66, 0.035), 0.016, 0.014, part)];
}

function hindLegBone(part: PartId, x: number): Shape[] {
  const h = HIND_HIP(x);
  const at = (dy: number, dz: number) => vec3(x, h.y + dy, h.z + dz);
  return [C(at(-0.02, 0), at(-0.4, -0.1), 0.026, 0.02, part), C(at(-0.4, -0.1), at(-0.7, -0.06), 0.016, 0.014, part)];
}

export const ORGANS: Organ[] = [
  { id: 'brain', name: '腦', shapes: [E(vec3(0, 1.48, 0.84), vec3(0.045, 0.045, 0.055), 'neck')], bone: false },
  { id: 'neckSpine', name: '頸椎', shapes: [C(vec3(0, 1.0, 0.45), vec3(0, 1.42, 0.78), 0.03, 0.025, 'neck')], bone: true },
  { id: 'spine', name: '脊椎', shapes: [C(vec3(0, 1.0, 0.42), vec3(0, 0.98, -0.55), 0.032)], bone: true },
  { id: 'heart', name: '心臟', shapes: [E(vec3(0, 0.71, 0.33), vec3(0.06, 0.075, 0.065))], bone: false },
  { id: 'lungL', name: '左肺', shapes: [E(vec3(0.085, 0.85, 0.3), vec3(0.085, 0.13, 0.17))], bone: false },
  { id: 'lungR', name: '右肺', shapes: [E(vec3(-0.085, 0.85, 0.3), vec3(0.085, 0.13, 0.17))], bone: false },
  { id: 'aorta', name: '主動脈', shapes: [C(vec3(0, 0.78, 0.32), vec3(0, 0.96, 0.05), 0.022)], bone: false },
  { id: 'liver', name: '肝臟', shapes: [E(vec3(-0.02, 0.78, 0.06), vec3(0.13, 0.12, 0.09))], bone: false },
  { id: 'gut', name: '胃腸', shapes: [E(vec3(0, 0.8, -0.27), vec3(0.16, 0.17, 0.28))], bone: false },
  { id: 'legFL', name: '左前腿骨', shapes: frontLegBone('legFL', 0.11), bone: true },
  { id: 'legFR', name: '右前腿骨', shapes: frontLegBone('legFR', -0.11), bone: true },
  { id: 'legHL', name: '左後腿骨', shapes: hindLegBone('legHL', 0.11), bone: true },
  { id: 'legHR', name: '右後腿骨', shapes: hindLegBone('legHR', -0.11), bone: true },
];

/** Bounding sphere of the whole animal for cheap rejection. */
export const BOUNDS = { c: vec3(0, 0.8, 0.1), r: 1.25 };

/** Maps a body-frame point into a part's rest frame for the given pose. */
function unpose(p: Vec3, part: PartId, pose: Pose): Vec3 {
  const angle = partAngle(part, pose);
  if (angle === 0) return p;
  const pivot = PIVOTS[part];
  const c = Math.cos(-angle);
  const s = Math.sin(-angle);
  const y = p.y - pivot.y;
  const z = p.z - pivot.z;
  return vec3(p.x, pivot.y + y * c - z * s, pivot.z + y * s + z * c);
}

/** Point-in-shape test; `inflate` (m) grows the shape, used to tolerate mesh faceting in tests. */
export function contains(s: Shape, point: Vec3, pose: Pose = REST_POSE, inflate = 0): boolean {
  const p = s.part ? unpose(point, s.part, pose) : point;
  if (s.kind === 'body') {
    const sec = bodySection(p.z);
    if (!sec) return false;
    const x = p.x / (sec.halfWidth + inflate);
    const y = (p.y - sec.mid) / (sec.halfHeight + inflate);
    return x * x + y * y <= 1;
  }
  if (s.kind === 'ellipsoid') {
    const x = (p.x - s.c.x) / (s.r.x + inflate);
    const y = (p.y - s.c.y) / (s.r.y + inflate);
    const z = (p.z - s.c.z) / (s.r.z + inflate);
    return x * x + y * y + z * z <= 1;
  }
  const ab = sub(s.b, s.a);
  const t = Math.max(0, Math.min(1, dot(sub(p, s.a), ab) / dot(ab, ab)));
  const q = add(s.a, scale(ab, t));
  const d = sub(p, q);
  const r = s.r + (s.rb - s.r) * t + inflate;
  return dot(d, d) <= r * r;
}

export const inHull = (p: Vec3, pose: Pose = REST_POSE, inflate = 0) => HULL.some((s) => contains(s, p, pose, inflate));
const inOrgan = (o: Organ, p: Vec3, pose: Pose) => o.shapes.some((s) => contains(s, p, pose));

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
  /** Direction of travel through the body (unit, local frame). */
  dir: Vec3;
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
      if (!inOrgan(o, p, pose)) {
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
      return { entry, dir, exit: null, exitVelocity: 0, penetration: travelled, channel, organs: toHits(lengths) };
    }
  }
  const exitVelocity = Math.sqrt((2 * energy) / ammo.massKg);
  return { entry, dir, exit: lastInside, exitVelocity, penetration: travelled, channel, organs: toHits(lengths) };
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
