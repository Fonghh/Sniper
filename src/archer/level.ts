import * as THREE from 'three';
import { segmentBox } from '../arena/hitbox';
import type { V3 } from '../arena/projectile';
import { mulberry32 } from '../world/random';

// A level that runs forward (+z): clearings joined by short corridors, each clearing a
// fight. Some clearings fork around a rock block, and from the second one on there are
// raised platforms where archers and bombers perch. A gate at the end of each clearing
// opens once it is cleared. Built lazily as the player advances.

export const ZONE_LEN = 36; // m
export const CORRIDOR_LEN = 14;
export const STRIDE = ZONE_LEN + CORRIDOR_LEN;
const CORRIDOR_HALF = 5;

export type BoxKind = 'wall' | 'cover' | 'platform' | 'gate' | 'block';

export interface Box {
  min: V3;
  max: V3;
  kind: BoxKind;
  color: number;
}

export interface Zone {
  index: number;
  z0: number;
  z1: number;
  half: number; // half-width of the clearing
  fork: boolean;
  platforms: Box[];
  gate: Box;
  gateOpen: boolean;
}

/** What the arrows, enemies and player need from the world. */
export interface WorldLike {
  height(x: number, z: number): number;
  resolve(pos: THREE.Vector3, radius: number): void;
  collide(a: V3, b: V3): { t: number; normal: THREE.Vector3 } | null;
  lineOfSight(a: V3, b: V3): boolean;
}

const COLORS = {
  ground: 0xd9a35a,
  groundDark: 0xc48a45,
  wall: 0xb88a5e,
  wallDark: 0x9c7048,
  crate: 0xe0a352,
  platform: 0x8e9aa6,
  platformTop: 0x6f4a2e,
  block: 0xa77c55,
};

/** Pure layout of one zone (boxes and metadata), deterministic per seed and index. */
export function zoneLayout(seed: number, index: number): { zone: Zone; boxes: Box[] } {
  const rand = mulberry32(seed * 1000 + index * 7919);
  const z0 = index * STRIDE;
  const z1 = z0 + ZONE_LEN;
  const fork = index > 0 && index % 3 === 2;
  const half = fork ? 15 : 13;
  const boxes: Box[] = [];
  const box = (x0: number, x1: number, y1: number, za: number, zb: number, kind: BoxKind, color: number, y0 = -1) =>
    boxes.push({ min: { x: x0, y: y0, z: za }, max: { x: x1, y: y1, z: zb }, kind, color });

  // Side walls of the clearing and the corridor after it, jagged tops.
  for (let z = z0; z < z1; z += 4) {
    for (const s of [-1, 1]) {
      const h = 5 + rand() * 4;
      const x0 = s < 0 ? -half - 3 : half;
      box(x0, x0 + 3, h, z, z + 4, 'wall', rand() < 0.5 ? COLORS.wall : COLORS.wallDark);
    }
  }
  for (let z = z1; z < z1 + CORRIDOR_LEN; z += 3.5) {
    for (const s of [-1, 1]) {
      const h = 5 + rand() * 3;
      const x0 = s < 0 ? -CORRIDOR_HALF - 3 : CORRIDOR_HALF;
      box(x0, x0 + 3, h, z, Math.min(z + 3.5, z1 + CORRIDOR_LEN), 'wall', rand() < 0.5 ? COLORS.wall : COLORS.wallDark);
    }
  }
  // Shoulders where the clearing narrows into its corridors.
  for (const s of [-1, 1]) {
    const xa = s < 0 ? -half : CORRIDOR_HALF;
    const xb = s < 0 ? -CORRIDOR_HALF : half;
    box(xa, xb, 6, z1 - 1, z1, 'wall', COLORS.wall);
    if (index > 0) box(xa, xb, 6, z0, z0 + 1, 'wall', COLORS.wall);
  }
  if (index === 0) box(-half, half, 6, -2, -1, 'wall', COLORS.wall);

  // Fork: a rock block splits the clearing into two lanes.
  if (fork) box(-4, 4, 7, z0 + 7, z0 + 25, 'block', COLORS.block);

  // Low cover: crates and short walls.
  const coverCount = 4 + Math.floor(rand() * 3);
  for (let i = 0; i < coverCount; i++) {
    const z = z0 + 6 + rand() * (ZONE_LEN - 16);
    const x = (rand() - 0.5) * (half * 2 - 6);
    if (fork && Math.abs(x) < 6 && z > z0 + 5 && z < z0 + 27) continue;
    if (Math.abs(x) < 2.5 && z < z0 + 10) continue; // keep the entrance clear
    const wide = rand() < 0.4;
    const w = wide ? 3 + rand() * 2 : 1.2;
    const d = wide ? 0.8 : 1.2;
    box(x - w / 2, x + w / 2, wide ? 1.2 : 1.2 + (rand() < 0.3 ? 1.2 : 0), z - d / 2, z + d / 2, 'cover', COLORS.crate, 0);
  }

  // Raised platforms near the far end, for shooters.
  const platforms: Box[] = [];
  if (index > 0) {
    const n = index % 2 === 0 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const s = n === 2 ? (i === 0 ? -1 : 1) : rand() < 0.5 ? -1 : 1;
      const x = s * (half - 3.5);
      const z = z1 - 7 - rand() * 8;
      const h = 3.5 + rand() * 1.5;
      const p: Box = { min: { x: x - 2.2, y: -1, z: z - 2.2 }, max: { x: x + 2.2, y: h, z: z + 2.2 }, kind: 'platform', color: COLORS.platform };
      boxes.push(p);
      platforms.push(p);
    }
  }

  // Gate across the corridor.
  const gz = z1 + CORRIDOR_LEN / 2;
  const gate: Box = { min: { x: -CORRIDOR_HALF, y: 0, z: gz - 0.3 }, max: { x: CORRIDOR_HALF, y: 3.2, z: gz + 0.3 }, kind: 'gate', color: 0xff6a3d };
  boxes.push(gate);
  return { zone: { index, z0, z1, half, fork, platforms, gate, gateOpen: false }, boxes };
}

export class Level implements WorldLike {
  readonly zones: Zone[] = [];
  private boxes: Box[] = [];
  private gates = new Map<Zone, THREE.Mesh>();
  readonly sun: THREE.DirectionalLight;

  constructor(
    private scene: THREE.Scene,
    readonly seed: number,
  ) {
    scene.background = new THREE.Color(0xa9d8ff);
    scene.fog = new THREE.Fog(0xcde6f5, 60, 190);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x9a7a52, 1.3));
    this.sun = new THREE.DirectionalLight(0xfff0d8, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -40;
    sc.right = sc.top = 40;
    sc.near = 1;
    sc.far = 200;
    this.sun.shadow.bias = -0.0008;
    scene.add(this.sun, this.sun.target);
  }

  /** Makes sure zones 0..n exist. */
  ensure(n: number) {
    while (this.zones.length <= n) this.build(this.zones.length);
  }

  private build(index: number) {
    const { zone, boxes } = zoneLayout(this.seed, index);
    this.zones.push(zone);
    const solid = boxes.filter((b) => b.kind !== 'gate');
    this.boxes.push(...boxes);
    // All the zone's solid boxes as one instanced mesh.
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ flatShading: true }), solid.length);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    solid.forEach((b, i) => {
      m.makeScale(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z).setPosition(
        (b.min.x + b.max.x) / 2,
        (b.min.y + b.max.y) / 2,
        (b.min.z + b.max.z) / 2,
      );
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c.setHex(b.color));
    });
    mesh.castShadow = mesh.receiveShadow = true;
    this.scene.add(mesh);
    // Wooden decks on the platforms.
    for (const p of zone.platforms) {
      const deck = new THREE.Mesh(
        new THREE.BoxGeometry(p.max.x - p.min.x + 0.4, 0.25, p.max.z - p.min.z + 0.4),
        new THREE.MeshLambertMaterial({ color: COLORS.platformTop }),
      );
      deck.position.set((p.min.x + p.max.x) / 2, p.max.y + 0.12, (p.min.z + p.max.z) / 2);
      deck.castShadow = deck.receiveShadow = true;
      this.scene.add(deck);
    }
    // Ground for this stretch.
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(70, STRIDE, 14, 10).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ vertexColors: true }));
    const pos = ground.geometry.getAttribute('position') as THREE.BufferAttribute;
    const col = new Float32Array(pos.count * 3);
    const rand = mulberry32(this.seed + index * 31);
    for (let i = 0; i < pos.count; i++) c.setHex(rand() < 0.5 ? COLORS.ground : COLORS.groundDark).toArray(col, i * 3);
    ground.geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
    ground.position.set(0, 0, zone.z0 + STRIDE / 2 - (index === 0 ? 0 : 0));
    ground.receiveShadow = true;
    this.scene.add(ground);
    if (index === 0) {
      const back = ground.clone();
      back.position.z = -STRIDE / 2;
      this.scene.add(back);
    }
    // The gate: a glowing barrier.
    const g = zone.gate;
    const gate = new THREE.Mesh(
      new THREE.BoxGeometry(g.max.x - g.min.x, g.max.y - g.min.y, 0.3),
      new THREE.MeshBasicMaterial({ color: 0xff6a3d, transparent: true, opacity: 0.55 }),
    );
    gate.position.set(0, (g.min.y + g.max.y) / 2, (g.min.z + g.max.z) / 2);
    this.scene.add(gate);
    this.gates.set(zone, gate);
  }

  /** Closes every gate again (a new run on the same level). */
  reset() {
    for (const [zone, mesh] of this.gates) {
      if (zone.gateOpen) this.boxes.push(zone.gate);
      zone.gateOpen = false;
      mesh.visible = true;
      mesh.position.y = (zone.gate.min.y + zone.gate.max.y) / 2;
    }
  }

  openGate(zone: Zone) {
    zone.gateOpen = true;
    const i = this.boxes.indexOf(zone.gate);
    if (i >= 0) this.boxes.splice(i, 1);
  }

  /** Lowers opened gates into the ground. */
  update(dt: number, player: THREE.Vector3) {
    for (const [zone, mesh] of this.gates) {
      if (zone.gateOpen && mesh.visible) {
        mesh.position.y -= dt * 4;
        if (mesh.position.y < -2) mesh.visible = false;
      }
    }
    this.sun.position.set(player.x + 30, 60, player.z - 20);
    this.sun.target.position.copy(player);
    this.sun.target.updateMatrixWorld();
  }

  height(_x?: number, _z?: number): number {
    return 0;
  }

  /** The zone containing z (or the corridor after it). */
  zoneAt(z: number): Zone | null {
    const i = Math.floor(z / STRIDE);
    return this.zones[i] ?? null;
  }

  private near(x: number, z: number, r: number): Box[] {
    return this.boxes.filter((b) => z > b.min.z - r - 1 && z < b.max.z + r + 1 && x > b.min.x - r - 1 && x < b.max.x + r + 1);
  }

  resolve(pos: THREE.Vector3, radius: number) {
    for (const b of this.near(pos.x, pos.z, radius)) {
      if (b.max.y < 0.3) continue;
      const cx = Math.max(b.min.x, Math.min(pos.x, b.max.x));
      const cz = Math.max(b.min.z, Math.min(pos.z, b.max.z));
      const dx = pos.x - cx;
      const dz = pos.z - cz;
      const d = Math.hypot(dx, dz);
      if (d < radius) {
        if (d > 1e-6) {
          pos.x = cx + (dx / d) * radius;
          pos.z = cz + (dz / d) * radius;
        } else {
          // Inside: leave through the nearest side.
          const opts = [b.min.x - pos.x, b.max.x - pos.x, b.min.z - pos.z, b.max.z - pos.z];
          const k = opts.reduce((bi, v, i) => (Math.abs(v) < Math.abs(opts[bi]) ? i : bi), 0);
          if (k < 2) pos.x += opts[k] + Math.sign(opts[k]) * radius;
          else pos.z += opts[k] + Math.sign(opts[k]) * radius;
        }
      }
    }
    pos.y = 0;
  }

  collide(a: V3, b: V3): { t: number; normal: THREE.Vector3 } | null {
    let best: { t: number; normal: THREE.Vector3 } | null = null;
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    const r = Math.hypot(b.x - a.x, b.z - a.z) / 2 + 1;
    for (const o of this.near(mx, mz, r)) {
      const t = segmentBox(a, b, o.min, o.max);
      if (t === null || (best && t >= best.t)) continue;
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
      const n = new THREE.Vector3();
      const eps = 1e-3;
      if (Math.abs(p.x - o.min.x) < eps) n.set(-1, 0, 0);
      else if (Math.abs(p.x - o.max.x) < eps) n.set(1, 0, 0);
      else if (Math.abs(p.z - o.min.z) < eps) n.set(0, 0, -1);
      else if (Math.abs(p.z - o.max.z) < eps) n.set(0, 0, 1);
      else n.set(0, 1, 0);
      best = { t, normal: n };
    }
    if (b.y < 0 && a.y >= 0) {
      const t = a.y / (a.y - b.y);
      if (!best || t < best.t) best = { t, normal: new THREE.Vector3(0, 1, 0) };
    }
    return best;
  }

  lineOfSight(a: V3, b: V3): boolean {
    const hit = this.collide(a, b);
    return !hit || hit.t > 0.999;
  }
}
