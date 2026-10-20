import { describe, expect, it } from 'vitest';
import { AMMO } from '../src/ballistics/ammo';
import { NECK_PIVOT, OrganId, findEntry, inHull, traceWound } from '../src/animals/anatomy';
import { Physiology, categorize } from '../src/animals/physiology';
import { Vec3, add, normalize, scale, vec3 } from '../src/core/vec3';

const sp = AMMO['308-sp-165'];
const fmj = AMMO['308-fmj-147'];
const V300 = 603; // .308 SP velocity at ~300 m (see ballistics tests)

/** Shoots along `dir` at a local aim point; starts 2 m away and finds the hull entry. */
function shoot(aim: Vec3, dir: Vec3, ammo = sp, v = V300) {
  const d = normalize(dir);
  const a = add(aim, scale(d, -2));
  const b = add(aim, scale(d, 2));
  const f = findEntry(a, b);
  expect(f).not.toBeNull();
  const entry = add(a, scale(sub3(b, a), f!));
  return traceWound(ammo, entry, d, v);
}
const sub3 = (a: Vec3, b: Vec3) => vec3(a.x - b.x, a.y - b.y, a.z - b.z);
const ids = (w: ReturnType<typeof shoot>) => w.organs.map((o) => o.organ.id) as OrganId[];
const BROADSIDE = vec3(-1, 0, 0); // shooter on the deer's left

describe('anatomy and wound tracing', () => {
  it('broadside heart shot hits the heart and goes down within seconds', () => {
    const w = shoot(vec3(0, 0.71, 0.33), BROADSIDE);
    expect(ids(w)).toContain('heart');
    expect(categorize(w)).toBe('heart');
    expect(ids(w).some((id) => id.startsWith('leg'))).toBe(false);
    expect(Physiology.timeToCollapse([w])).toBeLessThan(12);
  });

  it('broadside double-lung shot takes tens of seconds', () => {
    const w = shoot(vec3(0, 0.88, 0.3), BROADSIDE);
    expect(ids(w)).toEqual(expect.arrayContaining(['lungL', 'lungR']));
    expect(ids(w)).not.toContain('heart');
    const t = Physiology.timeToCollapse([w]);
    expect(t).toBeGreaterThan(12);
    expect(t).toBeLessThan(60);
  });

  it('liver shot takes minutes', () => {
    const w = shoot(vec3(0, 0.76, 0.06), BROADSIDE);
    expect(categorize(w)).toBe('liver');
    const t = Physiology.timeToCollapse([w]);
    expect(t).toBeGreaterThan(60);
    expect(t).toBeLessThan(400);
  });

  it('gut shot does not bring the deer down within a hunt', () => {
    const w = shoot(vec3(0, 0.75, -0.3), BROADSIDE);
    expect(categorize(w)).toBe('gut');
    expect(Physiology.timeToCollapse([w], 900)).toBe(Infinity);
  });

  it('brain shot is instant', () => {
    const w = shoot(vec3(0, 1.48, 0.84), BROADSIDE);
    expect(categorize(w)).toBe('cns');
    expect(Physiology.timeToCollapse([w])).toBe(0);
  });

  it('broadside soft point at 300 m passes through the chest', () => {
    const w = shoot(vec3(0, 0.85, 0.3), BROADSIDE);
    expect(w.exit).not.toBeNull();
  });

  it('frontal chest shot: soft point stops inside, FMJ goes the length of the body', () => {
    const front = vec3(0, 0, -1);
    const s = shoot(vec3(0, 0.8, 0.3), front, sp);
    const f = shoot(vec3(0, 0.8, 0.3), front, fmj, 622);
    expect(s.exit).toBeNull();
    expect(f.penetration).toBeGreaterThan(s.penetration);
    expect(f.channel).toBeLessThan(s.channel);
  });

  it('entry angle matters: same entry point, different organs', () => {
    // Enter low behind the left shoulder; quartering forward vs quartering away.
    const entryAim = vec3(0.2, 0.78, 0.2);
    const forward = shoot(entryAim, vec3(-1, 0, 0.7));
    const back = shoot(entryAim, vec3(-1, 0, -1));
    expect(ids(forward)).not.toEqual(ids(back));
    expect(ids(back)).toContain('liver');
  });

  it('a slow soft point expands less', () => {
    const fast = shoot(vec3(0, 0.88, 0.3), BROADSIDE, sp, 700);
    const slow = shoot(vec3(0, 0.88, 0.3), BROADSIDE, sp, 420);
    expect(slow.channel).toBeLessThan(fast.channel);
  });
});

describe('body shape', () => {
  it('the heart sits well inside the chest, not at its lower edge', () => {
    // 8 cm below the heart centre is still inside the body.
    expect(inHull(vec3(0, 0.63, 0.33))).toBe(true);
  });
});

describe('pose', () => {
  it('a grazing deer\'s brain moves with its lowered head', () => {
    const pitch = 1.6;
    const rest = vec3(0, 1.48, 0.84);
    // Rotate the rest-pose brain position by the neck pitch about the pivot.
    const y = rest.y - NECK_PIVOT.y;
    const z = rest.z - NECK_PIVOT.z;
    const posed = vec3(0, NECK_PIVOT.y + y * Math.cos(pitch) - z * Math.sin(pitch), NECK_PIVOT.z + y * Math.sin(pitch) + z * Math.cos(pitch));
    expect(posed.y).toBeLessThan(0.8);
    const d = normalize(BROADSIDE);
    const a = add(posed, scale(d, -2));
    const b = add(posed, scale(d, 2));
    const f = findEntry(a, b, { neckPitch: pitch, legs: [0, 0, 0, 0] })!;
    const w = traceWound(sp, add(a, scale(sub3(b, a), f)), d, V300, { neckPitch: pitch, legs: [0, 0, 0, 0] });
    expect(categorize(w)).toBe('cns');
    // The rest-pose head position is now empty air.
    const a2 = add(rest, scale(d, -2));
    expect(findEntry(a2, add(rest, scale(d, 2)), { neckPitch: pitch, legs: [0, 0, 0, 0] })).toBeNull();
  });
});
