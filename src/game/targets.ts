import * as THREE from 'three';
import type { Terrain } from '../world/terrain';

const BOARD_HALF = 0.5; // m, square backer
export const BULL_RADIUS = 0.15; // roughly a deer's heart-lung zone is ~0.3 m across

export interface TargetHit {
  target: Target;
  point: THREE.Vector3;
  offsetRight: number; // m, + right of centre as seen by the shooter
  offsetUp: number;
  inBull: boolean;
}

/** A practice board standing on the terrain, facing the shooter. */
export class Target {
  readonly object = new THREE.Group();
  readonly center: THREE.Vector3;
  private normal: THREE.Vector3;
  private right: THREE.Vector3;
  private marks = new THREE.Group();

  constructor(terrain: Terrain, x: number, z: number, face: THREE.Vector3) {
    const y = terrain.height(x, z) + 1.1;
    this.center = new THREE.Vector3(x, y, z);
    this.normal = new THREE.Vector3(face.x - x, 0, face.z - z).normalize();
    this.right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), this.normal).normalize();

    const board = new THREE.Mesh(
      new THREE.BoxGeometry(BOARD_HALF * 2, BOARD_HALF * 2, 0.04),
      new THREE.MeshLambertMaterial({ color: 0xf2efe6 }),
    );
    const bull = new THREE.Mesh(
      new THREE.CircleGeometry(BULL_RADIUS, 24),
      new THREE.MeshBasicMaterial({ color: 0xc0392b }),
    );
    bull.position.z = 0.021;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.1, 0.08), new THREE.MeshLambertMaterial({ color: 0x6b4f35 }));
    post.position.y = -0.85;
    this.object.add(board, bull, post, this.marks);
    this.object.position.copy(this.center);
    this.object.lookAt(this.center.clone().add(this.normal));
  }

  /** Segment test against the board face; returns the hit or null. `mark` leaves a bullet hole. */
  intersect(a: THREE.Vector3, b: THREE.Vector3, mark = true): TargetHit | null {
    const da = a.clone().sub(this.center).dot(this.normal);
    const db = b.clone().sub(this.center).dot(this.normal);
    if (da < 0 || db > 0 || da === db) return null; // must cross from the front
    const point = a.clone().lerp(b, da / (da - db));
    const rel = point.clone().sub(this.center);
    // The board faces the shooter, so the shooter's right is the board's -right.
    const offsetRight = -rel.dot(this.right);
    const offsetUp = rel.y;
    if (Math.abs(offsetRight) > BOARD_HALF || Math.abs(offsetUp) > BOARD_HALF) return null;
    const inBull = Math.hypot(offsetRight, offsetUp) <= BULL_RADIUS;
    if (!mark) return { target: this, point, offsetRight, offsetUp, inBull };
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.02, 8), new THREE.MeshBasicMaterial({ color: 0x111111 }));
    hole.position.set(-offsetRight, offsetUp, 0.025);
    this.marks.add(hole);
    return { target: this, point, offsetRight, offsetUp, inBull };
  }
}

/** Places practice boards along the opening sight line: 100 m, 200 m, the meadow, and beyond. */
export function createRange(terrain: Terrain, eye: THREE.Vector3, meadow: { x: number; z: number }): Target[] {
  const dir = new THREE.Vector3(meadow.x - eye.x, 0, meadow.z - eye.z);
  const meadowDist = dir.length();
  dir.normalize();
  const side = new THREE.Vector3(-dir.z, 0, dir.x);
  const spots: Array<[number, number]> = [
    [100, -6],
    [200, 8],
    [meadowDist, 0],
    [meadowDist + 70, -12],
  ];
  return spots.map(([d, s]) => {
    const p = eye.clone().addScaledVector(dir, d).addScaledVector(side, s);
    return new Target(terrain, p.x, p.z, eye);
  });
}
