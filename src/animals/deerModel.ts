import * as THREE from 'three';
import { NECK_PIVOT } from './anatomy';

// Procedural low-poly white-tailed deer whose proportions match the anatomy in anatomy.ts.

const COAT = new THREE.MeshLambertMaterial({ color: 0x8b5a34, flatShading: true });
const BELLY = new THREE.MeshLambertMaterial({ color: 0xe6dccb, flatShading: true });
const COAT_TWO_TONE = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

/** Unit sphere coloured coat on top and pale on the underside (no overlapping belly mesh). */
function twoToneSphere(): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(1, 10, 7).toNonIndexed();
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const coat = new THREE.Color(0x8b5a34);
  const belly = new THREE.Color(0xe6dccb);
  // Colour per face so the boundary stays crisp with flat shading.
  for (let i = 0; i < pos.count; i += 3) {
    const y = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
    const c = y < -0.45 ? belly : coat;
    for (let k = 0; k < 3; k++) c.toArray(colors, (i + k) * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}
const DARK = new THREE.MeshLambertMaterial({ color: 0x2b1d14, flatShading: true });
const ANTLER = new THREE.MeshLambertMaterial({ color: 0xcbb592, flatShading: true });

function limb(top: THREE.Vector3, bottom: THREE.Vector3, rTop: number, rBottom: number, mat: THREE.Material) {
  const len = top.distanceTo(bottom);
  const geo = new THREE.CylinderGeometry(rTop, rBottom, len, 6);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(top).add(bottom).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(bottom).normalize());
  return mesh;
}

export interface DeerModel {
  root: THREE.Group;
  /** Rotates about local x at the neck base; positive = head down. */
  neck: THREE.Group;
  legs: THREE.Group[];
}

export function createDeerModel(buck: boolean): DeerModel {
  const root = new THREE.Group();

  const torso = new THREE.Mesh(twoToneSphere(), COAT_TWO_TONE);
  torso.scale.set(0.2, 0.24, 0.62);
  torso.position.set(0, 0.85, 0);
  const chest = new THREE.Mesh(twoToneSphere(), COAT_TWO_TONE);
  chest.scale.set(0.19, 0.23, 0.3);
  chest.position.set(0, 0.82, 0.3);
  root.add(chest);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 5), BELLY);
  tail.position.set(0, 0.98, -0.64);
  tail.rotation.x = -2.4;
  root.add(torso, tail);

  const legs: THREE.Group[] = [];
  const legSpots: Array<[number, number, number]> = [
    [0.11, 0.7, 0.45], [-0.11, 0.7, 0.45], [0.11, 0.72, -0.5], [-0.11, 0.72, -0.5],
  ];
  for (const [x, y, z] of legSpots) {
    const hip = new THREE.Group();
    hip.position.set(x, y, z);
    const hind = z < 0;
    hip.add(limb(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.36, hind ? -0.03 : 0.02), hind ? 0.07 : 0.055, 0.035, COAT));
    hip.add(limb(new THREE.Vector3(0, -0.36, hind ? -0.03 : 0.02), new THREE.Vector3(0, -y + 0.04, hind ? -0.04 : 0.03), 0.03, 0.022, COAT));
    const hoof = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.07), DARK);
    hoof.position.set(0, -y + 0.025, hind ? -0.03 : 0.04);
    hip.add(hoof);
    root.add(hip);
    legs.push(hip);
  }

  // Neck group: built in rest pose relative to the pivot.
  const neck = new THREE.Group();
  neck.position.set(NECK_PIVOT.x, NECK_PIVOT.y, NECK_PIVOT.z);
  const p = (x: number, y: number, z: number) => new THREE.Vector3(x - NECK_PIVOT.x, y - NECK_PIVOT.y, z - NECK_PIVOT.z);
  neck.add(limb(p(0, 0.98, 0.5), p(0, 1.36, 0.76), 0.12, 0.08, COAT));
  const head = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), COAT);
  head.scale.set(0.08, 0.085, 0.17);
  head.position.copy(p(0, 1.42, 0.88));
  head.rotation.x = 0.35;
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 4), DARK);
  nose.position.copy(p(0, 1.36, 1.03));
  neck.add(head, nose);
  for (const sx of [1, -1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.14, 4), COAT);
    ear.position.copy(p(sx * 0.07, 1.54, 0.8));
    ear.rotation.z = -sx * 0.9;
    neck.add(ear);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.014, 5, 4), DARK);
    eye.position.copy(p(sx * 0.065, 1.46, 0.92));
    neck.add(eye);
    if (buck) {
      const base = p(sx * 0.04, 1.52, 0.82);
      const tip = p(sx * 0.2, 1.78, 0.9);
      neck.add(limb(base, tip, 0.018, 0.01, ANTLER));
      neck.add(limb(tip, p(sx * 0.16, 1.82, 1.05), 0.01, 0.006, ANTLER));
      neck.add(limb(p(sx * 0.11, 1.64, 0.85), p(sx * 0.1, 1.76, 0.82), 0.01, 0.005, ANTLER));
    }
  }
  root.add(neck);

  root.traverse((o) => {
    o.castShadow = false;
  });
  return { root, neck, legs };
}
