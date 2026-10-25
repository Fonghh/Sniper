import * as THREE from 'three';
import { HEAD, LEGS, TORSO } from './hitbox';

// Chunky low-poly humanoid built from the same boxes and sphere as the hit zones.

export interface CharacterLook {
  body: number;
  legs: number;
  head: number;
  accent?: number; // chest marking (e.g. a bullseye on dummies)
  gun?: boolean;
}

export interface CharacterModel {
  root: THREE.Group;
  /** Pivot at the hips, for falling over. */
  body: THREE.Group;
  arms: THREE.Group;
}

const box = (min: { x: number; y: number; z: number }, max: { x: number; y: number; z: number }, color: number) => {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(max.x - min.x, max.y - min.y, max.z - min.z),
    new THREE.MeshLambertMaterial({ color, flatShading: true }),
  );
  m.position.set((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
  m.castShadow = true;
  return m;
};

export function createCharacter(look: CharacterLook): CharacterModel {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  body.add(box(LEGS.min, LEGS.max, look.legs));
  body.add(box(TORSO.min, TORSO.max, look.body));
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(HEAD.r, 1), new THREE.MeshLambertMaterial({ color: look.head, flatShading: true }));
  head.position.set(HEAD.c.x, HEAD.c.y, HEAD.c.z);
  head.castShadow = true;
  body.add(head);
  // Eyes give a facing direction (+z).
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.02), new THREE.MeshBasicMaterial({ color: 0x1b1b1b }));
    eye.position.set(s * 0.055, HEAD.c.y + 0.02, HEAD.c.z + HEAD.r - 0.005);
    body.add(eye);
  }
  if (look.accent !== undefined) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.06, 0.13, 20), new THREE.MeshBasicMaterial({ color: look.accent }));
    ring.position.set(0, 1.22, TORSO.max.z + 0.005);
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.035, 12), new THREE.MeshBasicMaterial({ color: look.accent }));
    dot.position.set(0, 1.22, TORSO.max.z + 0.006);
    body.add(ring, dot);
  }
  const arms = new THREE.Group();
  arms.position.set(0, 1.38, 0);
  for (const s of [-1, 1]) {
    const arm = box({ x: -0.06, y: -0.45, z: -0.06 }, { x: 0.06, y: 0, z: 0.06 }, look.body);
    arm.position.x = s * 0.31;
    arm.rotation.x = -1.2;
    arms.add(arm);
  }
  if (look.gun) {
    const gun = box({ x: -0.04, y: -0.05, z: 0 }, { x: 0.04, y: 0.05, z: 0.7 }, 0x2b2b2b);
    gun.position.set(0.12, -0.2, 0.25);
    arms.add(gun);
  }
  body.add(arms);
  return { root, body, arms };
}
