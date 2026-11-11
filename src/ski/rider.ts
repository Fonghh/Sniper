import * as THREE from 'three';

// The rider seen from the chase camera: board, legs, jacket, arms out for balance, helmet.
// Regular stance (left foot toward the nose); the body faces the toe edge (-x in board
// space, with the nose along +z) and the head is turned down the hill.

const lambert = (color: number) => new THREE.MeshLambertMaterial({ color, flatShading: true });

export const STANCE = 0.27; // m from the centre to each binding

function buildBoard(): THREE.Group {
  const g = new THREE.Group();
  const base = lambert(0x1fb5c9); // bright, so the board's direction reads at a glance
  const top = lambert(0xf2f4f7);
  const accent = lambert(0xff5a36);
  const core = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.025, 1.2), base);
  g.add(core);
  for (const s of [-1, 1]) {
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.135, 0.025, 14, 1, false, 0, Math.PI), base);
    tip.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2;
    tip.position.z = s * 0.6;
    tip.rotation.x = 0;
    g.add(tip);
  }
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.004, 0.7), top);
  stripe.position.y = 0.014;
  const dot = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.005, 0.08), accent);
  dot.position.set(0, 0.015, 0.45);
  g.add(stripe, dot);
  for (const s of [-1, 1]) {
    const binding = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.07, 0.14), lambert(0x111111));
    binding.position.set(0, 0.05, s * STANCE);
    binding.rotation.y = s * 0.25;
    g.add(binding);
  }
  g.traverse((o) => (o.castShadow = true));
  return g;
}

/** A limb segment between two points (box stretched along the segment). */
class Segment {
  readonly mesh: THREE.Mesh;
  constructor(width: number, mat: THREE.Material) {
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(width, width, 1), mat);
    this.mesh.castShadow = true;
  }
  set(a: THREE.Vector3, b: THREE.Vector3) {
    this.mesh.position.copy(a).add(b).multiplyScalar(0.5);
    this.mesh.scale.z = a.distanceTo(b);
    this.mesh.lookAt(b.clone().applyMatrix4(this.mesh.parent!.matrixWorld));
  }
}

export class Rider {
  /** Placed at the board's centre on the snow, yawed to the board, tilted to the slope. */
  readonly root = new THREE.Group();
  readonly board = buildBoard();
  private legs: Array<{ thigh: Segment; shin: Segment; boot: THREE.Mesh; z: number }> = [];
  private torso = new THREE.Group();
  private arms: THREE.Mesh[] = [];

  constructor(scene: THREE.Scene) {
    this.root.add(this.board);
    const pants = lambert(0x24262b);
    const boots = lambert(0x15171a);
    for (const s of [-1, 1]) {
      const thigh = new Segment(0.16, pants);
      const shin = new Segment(0.14, pants);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.13), boots);
      boot.castShadow = true;
      this.root.add(thigh.mesh, shin.mesh, boot);
      this.legs.push({ thigh, shin, boot, z: s * STANCE });
    }
    // Upper body faces the toe edge (-x); shoulders lie along the board (z).
    const red = lambert(0xe2502c);
    const jacket = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.55, 0.4), red);
    jacket.position.y = 0.27;
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.38, 0.28), lambert(0x2b3440));
    pack.position.set(0.17, 0.3, 0);
    const helmet = new THREE.Mesh(new THREE.IcosahedronGeometry(0.14, 1), lambert(0xf2f2f2));
    helmet.position.set(-0.02, 0.72, 0);
    const goggles = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.2), lambert(0xffb020));
    goggles.position.set(-0.13, 0.72, 0);
    this.torso.add(jacket, pack, helmet, goggles);
    for (const s of [-1, 1]) {
      // Each arm reaches out toward its own end of the board.
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.55).translate(0, 0, s * 0.27), red);
      arm.position.set(0, 0.5, s * 0.2);
      this.torso.add(arm);
      this.arms.push(arm);
    }
    this.torso.traverse((o) => (o.castShadow = true));
    this.root.add(this.torso);
    scene.add(this.root);
  }

  /**
   * Poses the rider. `crouch` 0..1 bends the knees; `lean` shifts the hips toward the toe
   * (+) or heel (-) edge; `press` shifts them toward the nose (+) or tail (-).
   */
  pose(pos: THREE.Vector3, heading: number, normal: THREE.Vector3, roll: number, crouch: number, lean: number, press: number) {
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
    const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
    this.root.position.copy(pos);
    this.root.quaternion.copy(q).multiply(yaw);
    // Board and body roll together onto the edge (into a carve, away from a skid).
    this.root.rotateZ(roll);
    this.root.updateMatrixWorld(true);
    const edge = -roll;
    const hipY = 0.86 - crouch * 0.28;
    const hip = new THREE.Vector3(-0.05 - lean * 0.12, hipY, press * 0.12);
    this.torso.position.copy(hip);
    // The upper body leans with the weight: toward the toe/heel edge, toward the nose/tail.
    this.torso.rotation.set(-press * 0.3, 0, lean * 0.3);
    // Arms out along the board for balance, angled down; the edge raises one and drops the other.
    this.arms.forEach((arm, i) => {
      const s = i === 0 ? -1 : 1;
      arm.rotation.x = s * (0.65 - edge * 0.25);
    });
    for (const l of this.legs) {
      const foot = new THREE.Vector3(0, 0.12, l.z);
      const top = new THREE.Vector3(hip.x, hip.y, hip.z + l.z * 0.55);
      // Knees bend toward the toe side.
      const len = 0.48;
      const mid = foot.clone().add(top).multiplyScalar(0.5);
      const half = foot.distanceTo(top) / 2;
      const bend = Math.sqrt(Math.max(0, len * len - half * half));
      const knee = mid.add(new THREE.Vector3(-bend, 0, 0));
      l.thigh.set(top, knee);
      l.shin.set(knee, foot);
      l.boot.position.set(-0.02, 0.1, l.z);
      l.boot.rotation.y = Math.sign(l.z) * 0.25;
    }
  }
}
