import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ORGANS, Pose, contains, inHull } from '../src/animals/anatomy';
import { createDeerModel } from '../src/animals/deerModel';
import { vec3 } from '../src/core/vec3';

/** Every vertex of the hittable (non-decor) mesh, in the deer's local frame. */
function hittableVertices(pose?: Pose): THREE.Vector3[] {
  const m = createDeerModel(true);
  if (pose) {
    m.neck.rotation.x = pose.neckPitch;
    m.legs.forEach((leg, i) => (leg.rotation.x = pose.legs[i]));
  }
  m.root.updateMatrixWorld(true);
  const out: THREE.Vector3[] = [];
  m.root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || o.userData.decor) return;
    const pos = o.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) out.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld));
  });
  return out;
}

describe('visual model matches hit volumes', () => {
  const TOLERANCE = 0.015; // m, allows for low-poly faceting

  it('every visible body vertex lies on or inside the hit hull (rest pose)', () => {
    const verts = hittableVertices();
    const outside = verts.filter((p) => !inHull(vec3(p.x, p.y, p.z), undefined, TOLERANCE));
    expect(verts.length).toBeGreaterThan(1000);
    expect(outside).toEqual([]);
  });

  it('stays matched when the head is down and the legs swing', () => {
    const pose: Pose = { neckPitch: 1.7, legs: [0.5, -0.4, -0.5, 0.4] };
    const outside = hittableVertices(pose).filter((p) => !inHull(vec3(p.x, p.y, p.z), pose, TOLERANCE));
    expect(outside).toEqual([]);
  });

  it('the neck joins the head with no gap', () => {
    // Walk from the neck top into the skull; every point must be inside the body.
    for (let t = 0; t <= 1; t += 0.05) {
      const p = vec3(0, 1.36 + 0.1 * t, 0.74 + 0.11 * t);
      expect(inHull(p)).toBe(true);
    }
  });

  it('every organ sits inside the body', () => {
    for (const o of ORGANS) {
      for (const s of o.shapes) {
        const c = s.kind === 'ellipsoid' ? s.c : s.kind === 'capsule' ? s.a : null;
        if (c) expect(inHull(c), o.id).toBe(true);
        if (s.kind === 'capsule') expect(inHull(s.b), o.id).toBe(true);
      }
    }
    expect(contains(ORGANS[0].shapes[0], vec3(0, 1.48, 0.84))).toBe(true);
  });
});
