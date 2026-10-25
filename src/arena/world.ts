import * as THREE from 'three';
import { mulberry32 } from '../world/random';
import { Terrain, WATER_LEVEL } from '../world/terrain';
import { createTerrainObject } from '../world/terrainMesh';
import { segmentBox } from './hitbox';
import type { V3 } from './projectile';

// Arena: a flattened patch of the hunting valley with simple cover, lit for a bright,
// saturated low-poly look. Obstacles are axis-aligned boxes used for movement and shots.

export const ARENA_HALF = 60; // m, half-size of the square play area

export interface Obstacle {
  min: V3;
  max: V3;
}

const PALETTE = {
  sky: 0x8fd3ff,
  crate: 0xe0a352,
  crateDark: 0xb87a33,
  wall: 0xf1e9da,
  roof: 0xd9493f,
  barrel: 0x3f86d1,
  rock: 0xa4a9ae,
  fence: 0x8a5a3a,
};

/** Brighter, more saturated vertex colours for the low-poly look. */
function brighten(root: THREE.Object3D) {
  const c = new THREE.Color();
  const hsl = { h: 0, s: 0, l: 0 };
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const col = o.geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
    o.receiveShadow = true;
    if (!col || o.geometry.userData.bright) return;
    o.geometry.userData.bright = true;
    for (let i = 0; i < col.count; i++) {
      c.fromBufferAttribute(col, i);
      c.getHSL(hsl);
      c.setHSL(hsl.h, Math.min(1, hsl.s * 1.3), 0.32 + hsl.l * 0.7);
      c.toArray(col.array as Float32Array, i * 3);
    }
    col.needsUpdate = true;
  });
}

export class ArenaWorld {
  readonly terrain: Terrain;
  readonly center: { x: number; z: number };
  readonly obstacles: Obstacle[] = [];
  readonly group = new THREE.Group();
  readonly sun: THREE.DirectionalLight;
  private seed: number;

  constructor(scene: THREE.Scene, seed: number) {
    this.terrain = new Terrain(seed, 0.12);
    // A dry patch beside the river.
    const z = 0;
    this.center = { x: this.terrain.riverX(z) + 170, z };

    scene.background = new THREE.Color(PALETTE.sky);
    scene.fog = new THREE.Fog(PALETTE.sky, 140, 520);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x6f8f4a, 1.25));
    this.sun = new THREE.DirectionalLight(0xfff4dd, 2.1);
    this.sun.position.set(this.center.x + 40, 120, this.center.z + 60);
    this.sun.target.position.set(this.center.x, 0, this.center.z);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -ARENA_HALF - 10;
    sc.right = sc.top = ARENA_HALF + 10;
    sc.near = 10;
    sc.far = 300;
    this.sun.shadow.bias = -0.0008;
    scene.add(this.sun, this.sun.target);

    const ground = createTerrainObject(this.terrain);
    brighten(ground);
    scene.add(ground);
    this.seed = seed;
    this.layout(false);
    scene.add(this.group);
  }

  /** Rebuilds the cover; the range layout keeps the shooting lane in front of the spawn open. */
  layout(range: boolean) {
    for (const o of [...this.group.children]) {
      this.group.remove(o);
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    }
    this.obstacles.length = 0;
    this.buildCover(this.seed, range ? (x, z) => Math.abs(x) < 18 && z > -50 && z < 32 : () => false);
  }

  height(x: number, z: number): number {
    return this.terrain.height(x, z);
  }

  /** World position from arena-local coordinates (origin at the arena centre). */
  at(lx: number, lz: number): THREE.Vector3 {
    const x = this.center.x + lx;
    const z = this.center.z + lz;
    return new THREE.Vector3(x, this.height(x, z), z);
  }

  private box(lx: number, lz: number, w: number, h: number, d: number, color: number, top?: number) {
    const p = this.at(lx, lz);
    const base = Math.min(
      this.height(p.x - w / 2, p.z - d / 2),
      this.height(p.x + w / 2, p.z + d / 2),
      this.height(p.x - w / 2, p.z + d / 2),
      this.height(p.x + w / 2, p.z - d / 2),
    );
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
    mesh.position.set(p.x, base + h / 2, p.z);
    mesh.castShadow = mesh.receiveShadow = true;
    this.group.add(mesh);
    if (top !== undefined) {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.2, 0.25, d + 0.2), new THREE.MeshLambertMaterial({ color: top }));
      cap.position.set(p.x, base + h + 0.12, p.z);
      cap.castShadow = true;
      this.group.add(cap);
    }
    this.obstacles.push({
      min: { x: p.x - w / 2, y: base - 1, z: p.z - d / 2 },
      max: { x: p.x + w / 2, y: base + h + (top !== undefined ? 0.25 : 0), z: p.z + d / 2 },
    });
  }

  private buildCover(seed: number, blocked: (x: number, z: number) => boolean) {
    const rand = mulberry32(seed + 900);
    // Low walls and crate stacks scattered across the middle, leaving open lanes for shooting.
    const walls: Array<[number, number, number, number]> = [
      [-22, -10, 8, 0.6], [18, -18, 0.6, 8], [-8, 22, 10, 0.6], [26, 16, 0.6, 9], [-30, 28, 0.6, 7], [6, -38, 9, 0.6],
    ];
    for (const [x, z, w, d] of walls) if (!blocked(x, z)) this.box(x, z, w, 1.4, d, PALETTE.wall, PALETTE.roof);
    for (let i = 0; i < 14; i++) {
      const x = (rand() - 0.5) * 90;
      const z = (rand() - 0.5) * 90;
      if (Math.hypot(x, z + 45) < 10 || blocked(x, z)) continue; // keep the player spawn clear
      const stack = rand() < 0.35 ? 2 : 1;
      for (let s = 0; s < stack; s++) this.box(x + s * 0.2, z, 1.3, 1.3 * (s + 1), 1.3, s ? PALETTE.crateDark : PALETTE.crate);
    }
    for (let i = 0; i < 10; i++) {
      const x = (rand() - 0.5) * 100;
      const z = (rand() - 0.5) * 100;
      if (Math.hypot(x, z + 45) < 10 || blocked(x, z)) continue;
      if (rand() < 0.5) this.box(x, z, 0.8, 1.1, 0.8, PALETTE.barrel);
      else this.box(x, z, 2 + rand() * 2, 0.9 + rand() * 1.2, 1.6 + rand(), PALETTE.rock);
    }
    // Fence posts mark the boundary.
    for (let i = -ARENA_HALF; i <= ARENA_HALF; i += 6) {
      for (const [lx, lz] of [[i, -ARENA_HALF], [i, ARENA_HALF], [-ARENA_HALF, i], [ARENA_HALF, i]] as const) {
        const p = this.at(lx, lz);
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.25, 1.4, 0.25), new THREE.MeshLambertMaterial({ color: PALETTE.fence }));
        post.position.set(p.x, p.y + 0.7, p.z);
        post.castShadow = true;
        this.group.add(post);
      }
    }
  }

  /** Pushes a circle (x,z,radius) out of obstacles and keeps it inside the arena. */
  resolve(pos: THREE.Vector3, radius: number) {
    for (const o of this.obstacles) {
      const cx = Math.max(o.min.x, Math.min(pos.x, o.max.x));
      const cz = Math.max(o.min.z, Math.min(pos.z, o.max.z));
      const dx = pos.x - cx;
      const dz = pos.z - cz;
      const d = Math.hypot(dx, dz);
      if (d < radius) {
        if (d > 1e-6) {
          pos.x = cx + (dx / d) * radius;
          pos.z = cz + (dz / d) * radius;
        } else {
          pos.x += radius; // inside: nudge out
        }
      }
    }
    const lim = ARENA_HALF - 1;
    pos.x = Math.max(this.center.x - lim, Math.min(this.center.x + lim, pos.x));
    pos.z = Math.max(this.center.z - lim, Math.min(this.center.z + lim, pos.z));
    pos.y = this.height(pos.x, pos.z);
  }

  /** First obstacle or ground contact along a→b: fraction and surface normal. */
  collide(a: V3, b: V3): { t: number; normal: THREE.Vector3 } | null {
    let best: { t: number; normal: THREE.Vector3 } | null = null;
    for (const o of this.obstacles) {
      const t = segmentBox(a, b, o.min, o.max);
      if (t === null || (best && t >= best.t)) continue;
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
      // Normal of the face that was struck.
      const n = new THREE.Vector3();
      const eps = 1e-3;
      if (Math.abs(p.x - o.min.x) < eps) n.set(-1, 0, 0);
      else if (Math.abs(p.x - o.max.x) < eps) n.set(1, 0, 0);
      else if (Math.abs(p.z - o.min.z) < eps) n.set(0, 0, -1);
      else if (Math.abs(p.z - o.max.z) < eps) n.set(0, 0, 1);
      else n.set(0, 1, 0);
      best = { t, normal: n };
    }
    if (b.y < this.height(b.x, b.z)) {
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 10; i++) {
        const m = (lo + hi) / 2;
        const y = a.y + (b.y - a.y) * m;
        if (y < this.height(a.x + (b.x - a.x) * m, a.z + (b.z - a.z) * m)) hi = m;
        else lo = m;
      }
      if (!best || hi < best.t) best = { t: hi, normal: new THREE.Vector3(0, 1, 0) };
    }
    return best;
  }

  /** Clear line between two points (no obstacle or ground in between). */
  lineOfSight(a: V3, b: V3): boolean {
    const hit = this.collide(a, b);
    return !hit || hit.t > 0.999;
  }

  /** A random open spot at least `margin` from obstacles, in arena-local bounds. */
  randomOpenSpot(rand: () => number, margin = 1.5, half = ARENA_HALF - 5): THREE.Vector3 {
    for (let i = 0; i < 50; i++) {
      const p = this.at((rand() - 0.5) * half * 2, (rand() - 0.5) * half * 2);
      if (p.y < WATER_LEVEL + 0.5) continue;
      const clear = this.obstacles.every(
        (o) => p.x < o.min.x - margin || p.x > o.max.x + margin || p.z < o.min.z - margin || p.z > o.max.z + margin,
      );
      if (clear) return p;
    }
    return this.at(0, 0);
  }
}
