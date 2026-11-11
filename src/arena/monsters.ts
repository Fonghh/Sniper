import * as THREE from 'three';
import { createCharacter } from './character';
import { Zone, hitZone } from './hitbox';
import type { V3 } from './projectile';
import type { Hittable } from './targets';
import { Shot, WEAPONS, WeaponDef } from './weapons';
import type { ArenaWorld } from './world';

// PvE wave monsters. Most rush the player for melee; spitters keep their distance and lob
// slow acid globs on a visible arc, so the bullet-drop theme works both ways.

export type MonsterKind = 'grunt' | 'runner' | 'brute' | 'spitter';

interface KindDef {
  name: string;
  hp: number;
  speed: number; // m/s
  scale: number;
  damage: number; // per melee hit
  score: number;
  look: { body: number; legs: number; head: number; eyes: number };
}

export const KINDS: Record<MonsterKind, KindDef> = {
  grunt: { name: '殭屍', hp: 70, speed: 2.6, scale: 1, damage: 15, score: 100, look: { body: 0x6f9a4a, legs: 0x5a4636, head: 0x9cc46a, eyes: 0xffee55 } },
  runner: { name: '衝刺怪', hp: 40, speed: 6, scale: 0.85, damage: 10, score: 150, look: { body: 0xd0663a, legs: 0x3c3030, head: 0xe89a6a, eyes: 0xffffff } },
  brute: { name: '巨漢', hp: 400, speed: 1.8, scale: 1.55, damage: 35, score: 500, look: { body: 0x7a3a5a, legs: 0x3a2a36, head: 0xa8607e, eyes: 0xff4040 } },
  spitter: { name: '吐酸怪', hp: 60, speed: 2.2, scale: 1.05, damage: 0, score: 200, look: { body: 0x7a5ad0, legs: 0x3a3050, head: 0x9dff3a, eyes: 0x1b1b1b } },
};

export const ACID: WeaponDef = {
  ...WEAPONS.grenade,
  id: 'acid',
  name: '酸液',
  speed: 16,
  projectile: { drag: 0.004, gravity: 9.81 },
  damage: 18,
  headMultiplier: 1,
  fuse: 0,
  blastRadius: 0,
};

const RISE = 0.9; // s climbing out of the ground
const WINDUP = 0.45; // s before a swing lands
const COOLDOWN = 1.1;
const SPIT_EVERY = 3; // s
const SPIT_RANGE: [number, number] = [14, 28];
const SINK = 1.6; // s a body lies before sinking away

export interface MonsterContext {
  world: ArenaWorld;
  player: Hittable;
  monsters: Monster[];
  rand: () => number;
  hurt(amount: number, from: THREE.Vector3): void;
  spit(shot: Shot, origin: THREE.Vector3, dir: THREE.Vector3, owner: Monster): void;
}

/**
 * Launch angle (radians above horizontal) for a drag-free lob covering `d` horizontally and
 * `h` vertically at speed v, low arc; null when out of reach.
 */
export function lobAngle(v: number, d: number, h: number, g = 9.81): number | null {
  const v2 = v * v;
  const disc = v2 * v2 - g * (g * d * d + 2 * h * v2);
  if (disc < 0) return null;
  return Math.atan2(v2 - Math.sqrt(disc), g * d);
}

export class Monster implements Hittable {
  readonly team = 'monster';
  readonly def: KindDef;
  readonly model;
  hp: number;
  private age = 0;
  private cooldown = 0;
  private windup = -1;
  private deadFor = 0;
  private stuckFor = 0;
  private sidestep = 0;
  private sideDir = 1;
  private spitCd = 1.5;
  private phase = Math.random() * 6;
  private inv = new THREE.Matrix4();
  private ground = 0;

  constructor(
    readonly kind: MonsterKind,
    at: THREE.Vector3,
  ) {
    this.def = KINDS[kind];
    this.hp = this.def.hp;
    this.model = createCharacter(this.def.look);
    this.model.root.scale.setScalar(this.def.scale);
    this.model.root.position.copy(at);
    this.ground = at.y;
    if (kind === 'spitter') {
      // Glowing acid sacs on the back.
      const sac = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 0), new THREE.MeshBasicMaterial({ color: 0x9dff3a }));
      sac.position.set(0, 1.3, -0.22);
      this.model.body.add(sac);
    }
  }

  get alive(): boolean {
    return this.hp > 0;
  }

  get position(): THREE.Vector3 {
    return this.model.root.position;
  }

  /** Gone from the scene (sunk away after dying). */
  get removed(): boolean {
    return this.deadFor > SINK + 1;
  }

  test(a: V3, b: V3) {
    if (!this.alive) return null;
    this.inv.copy(this.model.root.matrixWorld).invert();
    return hitZone(new THREE.Vector3(a.x, a.y, a.z).applyMatrix4(this.inv), new THREE.Vector3(b.x, b.y, b.z).applyMatrix4(this.inv));
  }

  damage(amount: number, _zone: Zone): boolean {
    if (!this.alive) return false;
    this.hp -= amount;
    // Flinch: a hit interrupts a swing (brutes shrug it off).
    if (this.kind !== 'brute') {
      this.windup = -1;
      this.cooldown = Math.max(this.cooldown, 0.25);
    }
    return this.hp <= 0;
  }

  update(dt: number, ctx: MonsterContext) {
    const root = this.model.root;
    this.age += dt;
    if (!this.alive) {
      this.deadFor += dt;
      this.model.body.rotation.x = -Math.min(1, this.deadFor * 4) * (Math.PI / 2 - 0.1);
      if (this.deadFor > SINK) root.position.y = this.ground - (this.deadFor - SINK) * 1.2;
      root.updateMatrixWorld();
      return;
    }
    if (this.age < RISE) {
      root.position.y = this.ground - (1 - this.age / RISE) * 1.9 * this.def.scale;
      root.updateMatrixWorld();
      return;
    }

    const p = ctx.player.position;
    const to = p.clone().sub(root.position).setY(0);
    const d = to.length();
    to.normalize();
    root.rotation.y = Math.atan2(to.x, to.z);
    this.cooldown -= dt;

    const move = new THREE.Vector3();
    if (this.kind === 'spitter') {
      if (d > SPIT_RANGE[1]) move.copy(to);
      else if (d < SPIT_RANGE[0]) move.copy(to).negate();
      else move.set(to.z, 0, -to.x).multiplyScalar(0.4 * this.sideDir);
      this.spitCd -= dt;
      if (this.spitCd <= 0 && d < SPIT_RANGE[1] + 6 && ctx.player.alive) this.spit(d, ctx);
    } else if (ctx.player.alive) {
      const reach = 1.1 + 0.4 * this.def.scale;
      if (this.windup >= 0) {
        this.windup += dt;
        this.model.arms.rotation.x = -this.windup / WINDUP;
        if (this.windup >= WINDUP) {
          if (d < reach + 0.7) ctx.hurt(this.def.damage, root.position);
          this.windup = -1;
          this.cooldown = COOLDOWN;
        }
      } else {
        this.model.arms.rotation.x *= Math.exp(-dt * 10);
        if (d < reach && this.cooldown <= 0) this.windup = 0;
        else if (d > reach * 0.8) move.copy(to);
      }
    }

    // Sidestep around cover when progress stalls.
    if (this.sidestep > 0) {
      this.sidestep -= dt;
      move.set(to.z * this.sideDir, 0, -to.x * this.sideDir);
    }
    const before = root.position.clone();
    root.position.addScaledVector(move, this.def.speed * dt);
    // Keep a little space from other monsters.
    for (const o of ctx.monsters) {
      if (o === this || !o.alive) continue;
      const dx = root.position.x - o.position.x;
      const dz = root.position.z - o.position.z;
      const gap = 0.45 * (this.def.scale + o.def.scale);
      const dd = Math.hypot(dx, dz);
      if (dd < gap && dd > 1e-4) {
        root.position.x += (dx / dd) * (gap - dd) * 0.5;
        root.position.z += (dz / dd) * (gap - dd) * 0.5;
      }
    }
    ctx.world.resolve(root.position, 0.3 * this.def.scale);
    this.ground = root.position.y;
    const moved = before.setY(root.position.y).distanceTo(root.position);
    if (move.lengthSq() > 0.1 && moved < this.def.speed * dt * 0.3) {
      this.stuckFor += dt;
      if (this.stuckFor > 0.4) {
        this.sidestep = 0.9;
        this.sideDir = ctx.rand() < 0.5 ? -1 : 1;
        this.stuckFor = 0;
      }
    } else this.stuckFor = 0;
    if (this.kind === 'spitter' && ctx.rand() < dt * 0.4) this.sideDir *= -1;

    this.phase += dt * this.def.speed * 3.5 * (move.lengthSq() > 0.01 ? 1 : 0);
    this.model.body.position.y = Math.abs(Math.sin(this.phase)) * 0.06;
    this.model.body.rotation.z = Math.sin(this.phase) * 0.05;
    root.updateMatrixWorld();
  }

  private spit(d: number, ctx: MonsterContext) {
    const root = this.model.root;
    const origin = root.position.clone().setY(root.position.y + 1.5 * this.def.scale);
    const target = ctx.player.position.clone().setY(ctx.player.position.y + 1.1);
    if (!ctx.world.lineOfSight(origin, target)) {
      this.spitCd = 0.5;
      return;
    }
    // Drag shortens the lob a little; aim slightly long. A small random miss keeps it dodgeable.
    const angle = lobAngle(ACID.speed, d * 1.07 + (ctx.rand() - 0.5) * 2, target.y - origin.y);
    if (angle === null) {
      this.spitCd = 0.5;
      return;
    }
    const flat = target.clone().sub(origin).setY(0).normalize();
    const dir = flat.multiplyScalar(Math.cos(angle)).setY(Math.sin(angle));
    ctx.spit({ weapon: ACID, power: 1 }, origin, dir, this);
    this.spitCd = SPIT_EVERY * (0.8 + ctx.rand() * 0.4);
  }
}

/** Who shows up in wave `k` (1-based): more grunts each wave, then runners, spitters, brutes. */
export function waveRoster(k: number): MonsterKind[] {
  const out: MonsterKind[] = [];
  const add = (kind: MonsterKind, n: number) => {
    for (let i = 0; i < n; i++) out.push(kind);
  };
  add('grunt', 3 + 2 * k);
  add('runner', k >= 2 ? k : 0);
  add('spitter', k >= 3 ? Math.floor(k / 2) : 0);
  add('brute', k >= 4 ? Math.floor((k - 2) / 2) : 0);
  // Interleave so the heavy hitters are not all at the end.
  for (let i = out.length - 1; i > 0; i--) {
    const j = (i * 7919 + k * 31) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
