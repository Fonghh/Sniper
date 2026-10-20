import * as THREE from 'three';
import { NECK_PIVOT } from './anatomy';

// Procedural stylised low-poly white-tailed deer. Proportions stay true to anatomy.ts so hit
// zones remain honest; the charm comes from silhouette, colouring and small idle motions.

const COAT = 0x9a6136;
const COAT_DARK = 0x6e4426;
const PALE = 0xf6eadb;
const COAT_MAT = new THREE.MeshLambertMaterial({ color: COAT, flatShading: true });
const PALE_MAT = new THREE.MeshLambertMaterial({ color: PALE, flatShading: true });
const DARK_MAT = new THREE.MeshLambertMaterial({ color: 0x1e1510, flatShading: true });
const EYE_MAT = new THREE.MeshBasicMaterial({ color: 0x120c08 });
const GLINT_MAT = new THREE.MeshBasicMaterial({ color: 0xffffff });
const EAR_INNER_MAT = new THREE.MeshLambertMaterial({ color: 0xd9b8a0, flatShading: true });
const ANTLER_MAT = new THREE.MeshLambertMaterial({ color: 0xd6c3a0, flatShading: true });
const VERTEX_MAT = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Linear interpolation through (z, value) keyframes. */
function profile(keys: ReadonlyArray<readonly [number, number]>, z: number): number {
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

// Body silhouette along local z: straight back, deep brisket, tucked waist, rounded rump.
const BACK: ReadonlyArray<readonly [number, number]> = [
  [-0.66, 0.96], [-0.5, 1.07], [-0.2, 1.06], [0.1, 1.05], [0.35, 1.07], [0.55, 1.05], [0.66, 0.98],
];
const BELLY: ReadonlyArray<readonly [number, number]> = [
  [-0.66, 0.82], [-0.5, 0.68], [-0.2, 0.67], [0.1, 0.64], [0.35, 0.59], [0.55, 0.64], [0.66, 0.82],
];
const HALF_WIDTH: ReadonlyArray<readonly [number, number]> = [
  [-0.66, 0.09], [-0.5, 0.17], [-0.2, 0.19], [0.1, 0.2], [0.35, 0.18], [0.55, 0.14], [0.66, 0.08],
];

/** One deformed sphere for the whole torso, coloured per face: dark back, coat, pale belly and rump. */
function bodyGeometry(): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(1, 18, 12);
  geo.rotateX(Math.PI / 2); // poles along z
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const sx = pos.getX(i);
    const sy = pos.getY(i);
    const sz = pos.getZ(i);
    const r = Math.sqrt(Math.max(1 - sz * sz, 0));
    const round = Math.pow(r, 0.7); // slightly fuller ends than a plain ellipsoid
    const nx = r > 1e-6 ? sx / r : 0;
    const ny = r > 1e-6 ? sy / r : 0;
    const z = sz * 0.66;
    const top = profile(BACK, z);
    const bottom = profile(BELLY, z);
    const mid = (top + bottom) / 2;
    pos.setXYZ(i, nx * profile(HALF_WIDTH, z) * round, mid + ny * ((top - bottom) / 2) * round, z);
  }
  const flat = geo.toNonIndexed();
  flat.computeVertexNormals();
  const p = flat.getAttribute('position');
  const colors = new Float32Array(p.count * 3);
  const coat = new THREE.Color(COAT);
  const dark = new THREE.Color(COAT_DARK);
  const pale = new THREE.Color(PALE);
  for (let i = 0; i < p.count; i += 3) {
    const cy = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
    const cz = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
    const top = profile(BACK, cz);
    const bottom = profile(BELLY, cz);
    const t = (cy - bottom) / (top - bottom); // 0 belly .. 1 back
    let c = coat;
    if (t < 0.16 || (cz < -0.6 && t < 0.55)) c = pale;
    else if (t > 0.86) c = dark;
    for (let k = 0; k < 3; k++) c.toArray(colors, (i + k) * 3);
  }
  flat.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return flat;
}

/** Tapered segment between two points. */
function segment(a: THREE.Vector3, b: THREE.Vector3, ra: number, rb: number, mat: THREE.Material, sides = 7) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rb, ra, a.distanceTo(b), sides), mat);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(v(0, 1, 0), b.clone().sub(a).normalize());
  return mesh;
}

function blob(at: THREE.Vector3, scale: THREE.Vector3, mat: THREE.Material, w = 8, h = 6) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, w, h), mat);
  mesh.position.copy(at);
  mesh.scale.copy(scale);
  return mesh;
}

export interface DeerModel {
  root: THREE.Group;
  /** Rotates about local x at the neck base; positive = head down. */
  neck: THREE.Group;
  legs: THREE.Group[];
  ears: THREE.Group[];
  tail: THREE.Group;
}

function frontLeg(x: number): THREE.Group {
  const hip = new THREE.Group();
  hip.position.set(x, 0.72, 0.45);
  const knee = v(0, -0.34, 0.02);
  const fetlock = v(0, -0.62, 0.03);
  hip.add(blob(v(0, -0.12, 0), v(0.06, 0.15, 0.075), COAT_MAT, 7, 5)); // shoulder/forearm muscle
  hip.add(segment(v(0, -0.1, 0.01), knee, 0.045, 0.03, COAT_MAT));
  hip.add(segment(knee, fetlock, 0.024, 0.02, COAT_MAT));
  hip.add(segment(fetlock, v(0, -0.68, 0.04), 0.022, 0.026, DARK_MAT, 5));
  return hip;
}

function hindLeg(x: number): THREE.Group {
  const hip = new THREE.Group();
  hip.position.set(x, 0.76, -0.48);
  const stifle = v(0, -0.2, 0.04);
  const hock = v(0, -0.4, -0.1);
  const fetlock = v(0, -0.66, -0.07);
  hip.add(blob(v(0, -0.06, -0.01), v(0.075, 0.17, 0.13), COAT_MAT, 8, 6)); // haunch
  hip.add(segment(stifle, hock, 0.05, 0.028, COAT_MAT));
  hip.add(segment(hock, fetlock, 0.024, 0.02, COAT_MAT));
  hip.add(segment(fetlock, v(0, -0.72, -0.05), 0.022, 0.026, DARK_MAT, 5));
  return hip;
}

function ear(side: number, at: THREE.Vector3): THREE.Group {
  const g = new THREE.Group();
  g.position.copy(at);
  g.rotation.z = -side * 0.75;
  g.rotation.y = side * 0.25;
  const outer = blob(v(0, 0.09, 0), v(0.018, 0.1, 0.055), COAT_MAT, 6, 5);
  const inner = blob(v(side * 0.007, 0.09, 0.008), v(0.011, 0.082, 0.042), EAR_INNER_MAT, 6, 5);
  g.add(outer, inner);
  return g;
}

function antlers(neck: THREE.Group, p: (x: number, y: number, z: number) => THREE.Vector3) {
  for (const s of [1, -1]) {
    // Main beam sweeps out, back, then forward; tines rise from it.
    const pts = [p(s * 0.04, 1.53, 0.8), p(s * 0.13, 1.62, 0.76), p(s * 0.2, 1.7, 0.8), p(s * 0.19, 1.74, 0.92), p(s * 0.13, 1.74, 1.0)];
    for (let i = 0; i < pts.length - 1; i++) neck.add(segment(pts[i], pts[i + 1], 0.017 - i * 0.003, 0.014 - i * 0.003, ANTLER_MAT, 5));
    neck.add(segment(pts[1], p(s * 0.12, 1.75, 0.79), 0.01, 0.005, ANTLER_MAT, 5));
    neck.add(segment(pts[2], p(s * 0.19, 1.84, 0.84), 0.01, 0.005, ANTLER_MAT, 5));
    neck.add(segment(pts[3], p(s * 0.17, 1.84, 0.95), 0.009, 0.004, ANTLER_MAT, 5));
  }
}

export function createDeerModel(buck: boolean): DeerModel {
  const root = new THREE.Group();
  root.add(new THREE.Mesh(bodyGeometry(), VERTEX_MAT));

  // Tail: brown on top, white underside that flags when alarmed.
  const tail = new THREE.Group();
  tail.position.set(0, 1.0, -0.64);
  tail.rotation.x = -0.5;
  tail.add(blob(v(0, -0.07, -0.015), v(0.045, 0.09, 0.022), COAT_MAT, 6, 5));
  tail.add(blob(v(0, -0.07, -0.002), v(0.042, 0.085, 0.022), PALE_MAT, 6, 5));
  root.add(tail);

  const legs = [frontLeg(0.11), frontLeg(-0.11), hindLeg(0.11), hindLeg(-0.11)];
  root.add(...legs);

  // Neck group, built in the head-up rest pose relative to the pivot.
  const neck = new THREE.Group();
  neck.position.set(NECK_PIVOT.x, NECK_PIVOT.y, NECK_PIVOT.z);
  const p = (x: number, y: number, z: number) => v(x - NECK_PIVOT.x, y - NECK_PIVOT.y, z - NECK_PIVOT.z);
  neck.add(segment(p(0, 0.92, 0.45), p(0, 1.38, 0.76), 0.15, 0.075, COAT_MAT, 9));
  neck.add(blob(p(0, 1.28, 0.77), v(0.06, 0.065, 0.035), PALE_MAT, 7, 5)); // throat patch

  // Head: rounded skull, tapering muzzle, black nose, pale chin.
  neck.add(blob(p(0, 1.46, 0.85), v(0.085, 0.09, 0.105), COAT_MAT, 9, 7));
  neck.add(segment(p(0, 1.44, 0.9), p(0, 1.39, 1.02), 0.065, 0.038, COAT_MAT, 8));
  neck.add(blob(p(0, 1.393, 1.025), v(0.034, 0.027, 0.024), DARK_MAT, 6, 5));
  neck.add(blob(p(0, 1.36, 0.98), v(0.034, 0.02, 0.04), PALE_MAT, 6, 4));

  const ears: THREE.Group[] = [];
  for (const s of [1, -1]) {
    // Big glossy eyes with a pale ring and a glint read as friendly at a distance.
    neck.add(blob(p(s * 0.066, 1.475, 0.89), v(0.014, 0.037, 0.04), PALE_MAT, 7, 5));
    neck.add(blob(p(s * 0.073, 1.477, 0.893), v(0.012, 0.029, 0.031), EYE_MAT, 7, 5));
    neck.add(blob(p(s * 0.083, 1.488, 0.9), v(0.005, 0.008, 0.008), GLINT_MAT, 4, 3));
    const e = ear(s, p(s * 0.065, 1.53, 0.8));
    neck.add(e);
    ears.push(e);
  }
  if (buck) antlers(neck, p);
  root.add(neck);
  return { root, neck, legs, ears, tail };
}
