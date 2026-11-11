import { describe, expect, it } from 'vitest';
import { AMMO } from '../src/ballistics/ammo';
import { DEFAULT_ENV, zeroElevation } from '../src/ballistics/ballistics';
import {
  angleInfo,
  boreDirection,
  launchState,
  muzzleOrigin,
  simulateToImpact,
  sightUp,
} from '../src/ballistics/shot';
import { Vec3, dot, length, normalize, vec3 } from '../src/core/vec3';

const ammo = AMMO['308-sp-165'];
const SIGHT_HEIGHT = 0.04;

/** Fires at `target` from `eye` with the given zero and returns the vertical miss in metres. */
function verticalMiss(eye: Vec3, target: Vec3, zero: number): number {
  const dir = normalize(vec3(target.x - eye.x, target.y - eye.y, target.z - eye.z));
  const bore = boreDirection(dir, zeroElevation(ammo, zero, { sightHeight: SIGHT_HEIGHT }));
  const start = launchState(ammo, muzzleOrigin(eye, dir, SIGHT_HEIGHT), bore);
  // Impact plane: horizontal distance equal to the target's.
  const res = simulateToImpact(ammo, DEFAULT_ENV, start, (a, b) =>
    a.z < target.z && b.z >= target.z ? (target.z - a.z) / (b.z - a.z) : null,
  );
  return res!.point.y - target.y;
}

describe('shot geometry', () => {
  it('sight up is perpendicular to the sight line', () => {
    const d = normalize(vec3(0.3, -0.5, 1));
    expect(dot(sightUp(d), d)).toBeCloseTo(0, 9);
    expect(length(sightUp(d))).toBeCloseTo(1, 9);
    expect(sightUp(d).y).toBeGreaterThan(0);
  });

  it('angle compensation follows the rifleman\'s rule', () => {
    const info = angleInfo(vec3(0, 200, 0), vec3(0, 50, 259.81));
    expect(info.slant).toBeCloseTo(300, 0);
    expect((info.angle * 180) / Math.PI).toBeCloseTo(-30, 0);
    expect(info.compensated).toBeCloseTo(259.8, 0);
  });

  it('a level shot zeroed for its distance hits the aim point', () => {
    expect(Math.abs(verticalMiss(vec3(0, 100, 0), vec3(0, 100, 300), 300))).toBeLessThan(0.01);
  });

  it('a steep downhill shot hits high when zeroed for slant range, close when zeroed for compensated range', () => {
    const eye = vec3(0, 200, 0);
    const target = vec3(0, 50, 259.81); // 300 m slant, 30° down
    const { compensated } = angleInfo(eye, target);
    const slantMiss = verticalMiss(eye, target, 300);
    const compMiss = verticalMiss(eye, target, compensated);
    expect(slantMiss).toBeGreaterThan(0.1);
    expect(Math.abs(compMiss)).toBeLessThan(0.06);
  });

  it('uphill works the same way', () => {
    const eye = vec3(0, 0, 0);
    const target = vec3(0, 125, 216.5); // 250 m slant, 30° up
    const { compensated } = angleInfo(eye, target);
    expect(verticalMiss(eye, target, 250)).toBeGreaterThan(0.05);
    expect(Math.abs(verticalMiss(eye, target, compensated))).toBeLessThan(0.06);
  });
});
