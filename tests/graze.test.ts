import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Deer } from '../src/animals/deer';
import { categorize } from '../src/animals/physiology';
import { AMMO } from '../src/ballistics/ammo';
import { mulberry32 } from '../src/world/random';

const ammo = AMMO['308-sp-165'];

/** A deer at the origin facing +z with its head up, shot broadside from its left (+x). */
function deer(buck: boolean) {
  const d = new Deer(0, 0, 0, 0, 0, buck, mulberry32(1));
  d.pose.neckPitch = 0;
  d.model.neck.rotation.x = 0;
  d.object.updateMatrixWorld(true);
  return d;
}
function shoot(d: Deer, y: number, z: number, x = 0) {
  const a = new THREE.Vector3(2, y, z);
  const b = new THREE.Vector3(-2, y, z);
  if (x) a.x = b.x = x;
  return d.testHit(a, b, ammo, 600, 0, new THREE.Vector3(300, 50, 0));
}

describe('aiming at small parts', () => {
  it('an eye shot carries on into the head and is lethal', () => {
    const d = deer(false);
    const res = shoot(d, 1.477, 0.89);
    expect(res && 'hit' in res).toBe(true);
    expect(categorize((res as { hit: { wound: Parameters<typeof categorize>[0] } }).hit.wound)).toBe('cns');
  });

  it('an ear graze is a minor wound that still leaves a trail', () => {
    const d = deer(false);
    // Ears stick out sideways, so shoot down through the near ear from above.
    const res = d.testHit(new THREE.Vector3(0.126, 2.5, 0.8), new THREE.Vector3(0.126, 1.4, 0.8), ammo, 600, 0, new THREE.Vector3(0, 300, 0));
    expect(res && 'hit' in res).toBe(true);
    const hit = (res as { hit: { wound: { organs: unknown[] } } }).hit;
    expect(hit.wound.organs).toEqual([]);
    expect(d.condition).toBe('wounded');
    expect(d.brain.behavior).toBe('flee');
  });

  it("a buck's antler deflects the bullet without hurting him; a doe has no antlers", () => {
    const buck = deer(true);
    const res = shoot(buck, 1.7, 0.8);
    expect(res && 'antler' in res).toBe(true);
    expect(buck.condition).toBe('healthy');
    expect(buck.brain.behavior).toBe('flee');
    expect(shoot(deer(false), 1.7, 0.8)).toBeNull();
  });
});
