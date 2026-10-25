import * as THREE from 'three';
import { ProjectileState, STEP, stepProjectile } from '../arena/projectile';
import { Trail } from '../arena/trails';
import type { ArenaWorld } from '../arena/world';
import type { Enemy, HitPart } from './enemies';
import type { Fx } from './fx';
import type { BowStats } from './skills';

// The player's arrows: real gravity and drag, piercing, and the elemental effects from the
// skill cards applied on hit.

export interface ArrowHit {
  enemy: Enemy;
  part: HitPart;
  damage: number;
  crit: boolean;
  killed: boolean;
  point: THREE.Vector3;
}

interface Arrow {
  state: ProjectileState;
  mesh: THREE.Object3D;
  trail: Trail;
  hit: Set<Enemy>;
  giant: boolean;
  stats: BowStats;
  done: boolean;
  stuck: number;
  steps: number;
}

const MAX_FLIGHT = 3; // s
const STICK = 2.5; // s an arrow stays in the ground

function arrowMesh(giant: boolean, crossbow: boolean): THREE.Group {
  const g = new THREE.Group();
  const len = crossbow ? 0.5 : 0.75;
  const shaft = new THREE.Mesh(
    new THREE.BoxGeometry(0.03, 0.03, len).translate(0, 0, -len / 2 - 0.05),
    new THREE.MeshLambertMaterial({ color: crossbow ? 0x4a4a52 : 0xb07a45 }),
  );
  const tip = new THREE.Mesh(
    new THREE.ConeGeometry(0.045, 0.14, 4).rotateX(Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: giant ? 0xff4f9a : 0xfff2b0 }),
  );
  g.add(shaft, tip);
  for (const r of [0, Math.PI / 2]) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.18), new THREE.MeshLambertMaterial({ color: 0xff5470, side: THREE.DoubleSide }));
    f.position.z = -len;
    f.rotation.set(Math.PI / 2, r, 0);
    g.add(f);
  }
  if (giant) g.scale.setScalar(3.2);
  return g;
}

function trailColor(s: BowStats, giant: boolean): number {
  if (giant) return 0xff4f9a;
  if (s.fire) return 0xff7a2a;
  if (s.lightning) return 0xc58bff;
  if (s.frost) return 0x8fe0ff;
  if (s.poison) return 0x9cf05a;
  return 0xffffff;
}

export class Arrows {
  private live: Arrow[] = [];
  private trails: Trail[] = [];
  private acc = 0;
  onHit: (h: ArrowHit) => void = () => {};
  onBlast: (p: THREE.Vector3) => void = () => {};

  constructor(
    private scene: THREE.Scene,
    private world: ArenaWorld,
    private enemies: () => Enemy[],
    private fx: Fx,
  ) {}

  fire(origin: THREE.Vector3, dir: THREE.Vector3, stats: BowStats, giant: boolean) {
    const v = dir.clone().normalize().multiplyScalar(stats.speed * (giant ? 1.1 : 1));
    const mesh = arrowMesh(giant, stats.crossbow);
    mesh.position.copy(origin);
    this.scene.add(mesh);
    const trail = new Trail(trailColor(stats, giant), giant ? 0.9 : 0.6, 0.5, giant ? 0.012 : 0.004);
    this.scene.add(trail.mesh);
    this.trails.push(trail);
    this.live.push({
      state: { pos: { x: origin.x, y: origin.y, z: origin.z }, vel: { x: v.x, y: v.y, z: v.z }, time: 0 },
      mesh,
      trail,
      hit: new Set(),
      giant,
      stats,
      done: false,
      stuck: 0,
      steps: 0,
    });
  }

  update(dt: number, camera: THREE.Vector3) {
    this.acc = Math.min(this.acc + dt, 0.1);
    const steps = Math.floor(this.acc / STEP);
    this.acc -= steps * STEP;
    const enemies = this.enemies();
    for (const a of this.live) {
      if (a.stuck > 0) {
        a.stuck -= dt;
        if (a.stuck <= 0) a.done = true;
        continue;
      }
      for (let i = 0; i < steps && !a.done && a.stuck <= 0; i++) this.step(a, enemies);
      if (a.done || a.stuck > 0) continue;
      const s = a.state;
      a.mesh.position.set(s.pos.x, s.pos.y, s.pos.z);
      a.mesh.lookAt(s.pos.x + s.vel.x, s.pos.y + s.vel.y, s.pos.z + s.vel.z);
    }
    this.live = this.live.filter((a) => {
      if (a.done) {
        this.scene.remove(a.mesh);
        a.trail.finish();
      }
      return !a.done;
    });
    this.trails = this.trails.filter((t) => {
      const keep = t.update(dt, camera);
      if (!keep) {
        this.scene.remove(t.mesh);
        t.dispose();
      }
      return keep;
    });
  }

  private step(a: Arrow, enemies: Enemy[]) {
    const from = a.state.pos;
    const next = stepProjectile(a.state, { drag: a.stats.drag, gravity: 9.81 });
    const wall = this.world.collide(from, next.pos);
    const at = (t: number) =>
      new THREE.Vector3(from.x + (next.pos.x - from.x) * t, from.y + (next.pos.y - from.y) * t, from.z + (next.pos.z - from.z) * t);
    // Enemies along this step, nearest first (an arrow can pass through several).
    const hits: Array<{ e: Enemy; part: HitPart; t: number }> = [];
    for (const e of enemies) {
      if (!e.alive || a.hit.has(e)) continue;
      const dx = e.position.x - from.x;
      const dz = e.position.z - from.z;
      const reach = 2.5 * e.def.scale + Math.hypot(next.pos.x - from.x, next.pos.z - from.z);
      if (dx * dx + dz * dz > reach * reach) continue;
      const r = e.test(from, next.pos);
      if (r && (!wall || r.t < wall.t)) hits.push({ e, part: r.part, t: r.t });
    }
    hits.sort((p, q) => p.t - q.t);
    for (const h of hits) {
      a.hit.add(h.e);
      const point = at(h.t);
      a.trail.add(point);
      if (h.part === 'shield' && !a.giant) {
        // Blocked: sparks off the shield, the arrow drops.
        this.fx.burst(point, 0xdde6f0, 12, 5);
        a.done = true;
        this.onHit({ enemy: h.e, part: 'shield', damage: 0, crit: false, killed: false, point });
        return;
      }
      this.strike(a, h.e, h.part === 'shield' ? 'body' : h.part, point, new THREE.Vector3(next.vel.x, next.vel.y, next.vel.z));
      if (!a.giant && a.hit.size > a.stats.pierce) {
        a.done = true;
        return;
      }
    }
    if (wall) {
      const point = at(wall.t);
      a.trail.add(point);
      this.fx.puff(point, 0xd8c8a8, 4, 0.6);
      if (a.stats.explosive) this.blast(a, point, null);
      a.stuck = STICK;
      a.mesh.position.copy(point);
      a.mesh.lookAt(point.x + next.vel.x, point.y + next.vel.y, point.z + next.vel.z);
      return;
    }
    a.state = next;
    if (++a.steps % 3 === 0) a.trail.add(next.pos);
    if (next.time > MAX_FLIGHT) a.done = true;
  }

  private strike(a: Arrow, e: Enemy, part: HitPart, point: THREE.Vector3, dir: THREE.Vector3) {
    const s = a.stats;
    const crit = Math.random() < s.crit;
    const damage = Math.round(s.damage * (a.giant ? 4 : 1) * (part === 'head' ? 2 : 1) * (crit ? 2.5 : 1));
    const killed = e.damage(damage, dir, a.giant ? 3 : 1);
    this.fx.burst(point, crit ? 0xffe04a : 0xffffff, crit ? 22 : 12, crit ? 9 : 6);
    if (s.fire) {
      e.burn = 3;
      e.burnDps = 8 * s.fire;
      this.fx.burst(point, 0xff6a1f, 10, 4);
    }
    if (s.frost) {
      e.slowLeft = 2;
      if (Math.random() < 0.12 * s.frost) e.frozenLeft = 1.3;
      this.fx.burst(point, 0x8fe0ff, 10, 4);
    }
    if (s.poison) {
      e.poisonStacks = Math.min(4 * s.poison, e.poisonStacks + 1);
      e.poisonLeft = 4;
    }
    this.onHit({ enemy: e, part, damage, crit, killed, point });
    if (s.lightning) this.chain(e, damage * (0.35 + 0.15 * s.lightning), 2);
    if (s.explosive) this.blast(a, point, e);
  }

  /** Lightning jumps from `from` to the nearest unhit enemies. */
  private chain(from: Enemy, damage: number, jumps: number) {
    const done = new Set<Enemy>([from]);
    let cur = from;
    for (let j = 0; j < jumps; j++) {
      let best: Enemy | null = null;
      let bestD = 7;
      for (const e of this.enemies()) {
        if (!e.alive || done.has(e)) continue;
        const d = e.position.distanceTo(cur.position);
        if (d < bestD) {
          best = e;
          bestD = d;
        }
      }
      if (!best) return;
      done.add(best);
      this.fx.bolt(cur.centre(), best.centre());
      const killed = best.damage(Math.round(damage), null, 0.5);
      this.onHit({ enemy: best, part: 'body', damage: Math.round(damage), crit: false, killed, point: best.centre() });
      cur = best;
    }
  }

  private blast(a: Arrow, p: THREE.Vector3, skip: Enemy | null) {
    const r = 1.8 + 0.5 * a.stats.explosive;
    this.fx.explosion(p, r);
    this.onBlast(p);
    const dmg = Math.round(a.stats.damage * (0.5 + 0.2 * a.stats.explosive));
    for (const e of this.enemies()) {
      if (!e.alive || e === skip) continue;
      const c = e.centre();
      if (c.distanceTo(p) > r + 0.4 * e.def.scale) continue;
      const killed = e.damage(dmg, c.clone().sub(p), 1.5);
      this.onHit({ enemy: e, part: 'body', damage: dmg, crit: false, killed, point: c });
    }
  }

  clear() {
    for (const a of this.live) this.scene.remove(a.mesh);
    for (const t of this.trails) {
      this.scene.remove(t.mesh);
      t.dispose();
    }
    this.live = [];
    this.trails = [];
  }
}
