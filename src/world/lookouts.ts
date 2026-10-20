import * as THREE from 'three';
import type { Terrain } from './terrain';

const KEY = 'sniper.lookouts.v1';
export const DISCOVER_RADIUS = 15; // m

export interface Lookout {
  id: number;
  x: number;
  z: number;
  discovered: boolean;
}

/** Hilltop lookouts with a simple marker post; visited ones are remembered for fast travel. */
export class Lookouts {
  readonly points: Lookout[];
  readonly group = new THREE.Group();

  constructor(
    private terrain: Terrain,
    count: number,
  ) {
    const known = this.load();
    this.points = terrain.lookouts(count).map((p, id) => ({ id, ...p, discovered: known.has(id) }));
    for (const p of this.points) this.group.add(this.marker(p));
  }

  private storageKey() {
    return `${KEY}.${this.terrain.seed}`;
  }

  private load(): Set<number> {
    try {
      return new Set(JSON.parse(localStorage.getItem(this.storageKey()) ?? '[]') as number[]);
    } catch {
      return new Set();
    }
  }

  private save() {
    try {
      localStorage.setItem(this.storageKey(), JSON.stringify(this.points.filter((p) => p.discovered).map((p) => p.id)));
    } catch {
      // Not remembered across visits.
    }
  }

  private marker(p: Lookout): THREE.Object3D {
    const g = new THREE.Group();
    g.position.set(p.x, this.terrain.height(p.x, p.z), p.z);
    const wood = new THREE.MeshLambertMaterial({ color: 0x7a5636, flatShading: true });
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 3.2, 6), wood);
    post.position.y = 1.6;
    const flag = new THREE.Mesh(
      new THREE.PlaneGeometry(0.7, 0.42),
      new THREE.MeshLambertMaterial({ color: 0xe0b23a, side: THREE.DoubleSide }),
    );
    flag.position.set(0.37, 2.95, 0);
    const cairn = new THREE.Mesh(new THREE.DodecahedronGeometry(0.45, 0), new THREE.MeshLambertMaterial({ color: 0x8a877d, flatShading: true }));
    cairn.position.y = 0.2;
    g.add(post, flag, cairn);
    return g;
  }

  /** Marks lookouts the player is standing at; returns ones discovered just now. */
  visit(x: number, z: number): Lookout[] {
    const found = this.points.filter((p) => !p.discovered && Math.hypot(p.x - x, p.z - z) < DISCOVER_RADIUS);
    for (const p of found) p.discovered = true;
    if (found.length) this.save();
    return found;
  }
}
