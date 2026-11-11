import * as THREE from 'three';
import {
  BODY_BACK, BODY_BELLY, BODY_HALF_LENGTH, HULL, LEG_PARTS, NECK_PIVOT, PIVOTS, PartId, Shape, bodySection, profile,
} from './anatomy';

// Procedural stylised low-poly white-tailed deer. The body, neck, head and legs are built from
// the same HULL shapes used for hit testing, so what you see is exactly what can be hit.
// Ears, antlers, eyes, tail and colour patches are decoration and marked `userData.decor`.

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
    const nx = r > 1e-6 ? sx / r : 0;
    const ny = r > 1e-6 ? sy / r : 0;
    const z = sz * BODY_HALF_LENGTH;
    const sec = bodySection(z)!;
    pos.setXYZ(i, nx * sec.halfWidth, sec.mid + ny * sec.halfHeight, z);
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
    const top = profile(BODY_BACK, cz);
    const bottom = profile(BODY_BELLY, cz);
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

/**
 * Builds a mesh for one anatomy shape, relative to `origin` (its part's pivot). `override`
 * replaces the deer's own materials (used by the X-ray view).
 */
export function shapeMesh(shape: Shape, origin: THREE.Vector3, override?: THREE.Material): THREE.Object3D {
  const rel = (p: { x: number; y: number; z: number }) => v(p.x, p.y, p.z).sub(origin);
  const mat = override ?? (shape.skin === 'hoof' ? DARK_MAT : COAT_MAT);
  if (shape.kind === 'body') return new THREE.Mesh(bodyGeometry(), override ?? VERTEX_MAT);
  if (shape.kind === 'ellipsoid') return blob(rel(shape.c), v(shape.r.x, shape.r.y, shape.r.z), mat, 9, 7);
  const mesh = segment(rel(shape.a), rel(shape.b), shape.r, shape.rb, mat, 8);
  // Round the joints so segments meet without gaps.
  const capA = blob(rel(shape.a), v(shape.r, shape.r, shape.r), mat, 7, 5);
  const capB = blob(rel(shape.b), v(shape.rb, shape.rb, shape.rb), mat, 7, 5);
  const g = new THREE.Group();
  g.add(mesh, capA, capB);
  return g;
}

const decor = <T extends THREE.Object3D>(o: T): T => {
  o.traverse((c) => (c.userData.decor = true));
  return o;
};

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
  const parts = new Map<PartId, THREE.Group>();
  for (const id of ['neck', ...LEG_PARTS] as PartId[]) {
    const g = new THREE.Group();
    g.position.set(PIVOTS[id].x, PIVOTS[id].y, PIVOTS[id].z);
    parts.set(id, g);
    root.add(g);
  }
  for (const shape of HULL) {
    const parent = shape.part ? parts.get(shape.part)! : root;
    parent.add(shapeMesh(shape, shape.part ? parent.position : v(0, 0, 0)));
  }

  // Tail: brown on top, white underside that flags when alarmed.
  const tail = new THREE.Group();
  tail.position.set(0, 1.0, -0.64);
  tail.rotation.x = -0.5;
  tail.add(blob(v(0, -0.07, -0.015), v(0.045, 0.09, 0.022), COAT_MAT, 6, 5));
  tail.add(blob(v(0, -0.07, -0.002), v(0.042, 0.085, 0.022), PALE_MAT, 6, 5));
  root.add(decor(tail));

  // Head decoration lives in the neck group, positioned in the head-up rest pose.
  const neck = parts.get('neck')!;
  const p = (x: number, y: number, z: number) => v(x - NECK_PIVOT.x, y - NECK_PIVOT.y, z - NECK_PIVOT.z);
  neck.add(decor(blob(p(0, 1.28, 0.775), v(0.058, 0.065, 0.035), PALE_MAT, 7, 5))); // throat patch
  neck.add(decor(blob(p(0, 1.393, 1.025), v(0.034, 0.027, 0.024), DARK_MAT, 6, 5))); // nose
  neck.add(decor(blob(p(0, 1.36, 0.98), v(0.034, 0.02, 0.04), PALE_MAT, 6, 4))); // chin

  const ears: THREE.Group[] = [];
  for (const s of [1, -1]) {
    // Big glossy eyes with a pale ring and a glint read as friendly at a distance.
    neck.add(decor(blob(p(s * 0.066, 1.475, 0.89), v(0.014, 0.037, 0.04), PALE_MAT, 7, 5)));
    neck.add(decor(blob(p(s * 0.073, 1.477, 0.893), v(0.012, 0.029, 0.031), EYE_MAT, 7, 5)));
    neck.add(decor(blob(p(s * 0.083, 1.488, 0.9), v(0.005, 0.008, 0.008), GLINT_MAT, 4, 3)));
    const e = decor(ear(s, p(s * 0.065, 1.53, 0.8)));
    neck.add(e);
    ears.push(e);
  }
  if (buck) {
    const rack = new THREE.Group();
    antlers(rack, p);
    neck.add(decor(rack));
  }
  return { root, neck, legs: LEG_PARTS.map((id) => parts.get(id)!), ears, tail };
}
