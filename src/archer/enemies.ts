import * as THREE from 'three';
import { segmentBox, sphereEntry } from '../arena/hitbox';
import type { V3 } from '../arena/projectile';
import type { WorldLike } from './level';

// Chibi monsters: a big round head (the weak spot) on a small round body. They charge the
// player; shield bearers block arrows from the front (lob one over the top), bombers keep
// their distance and lob bombs with a warning ring, archers shoot arrows (often from up on a
// platform), tanks and bosses soak up damage.

export type EnemyKind = 'grunt' | 'runner' | 'shield' | 'bomber' | 'archer' | 'tank' | 'boss';
export type HitPart = 'head' | 'body' | 'shield';

interface KindDef {
  name: string;
  hp: number;
  speed: number;
  scale: number;
  damage: number;
  score: number;
  colors: { skin: number; cloth: number; band: number };
}

export const KINDS: Record<EnemyKind, KindDef> = {
  grunt: { name: '小兵', hp: 60, speed: 2.4, scale: 1.3, damage: 10, score: 10, colors: { skin: 0xf3e6d8, cloth: 0xd9473a, band: 0xd9473a } },
  runner: { name: '衝衝', hp: 30, speed: 5.5, scale: 1.05, damage: 6, score: 12, colors: { skin: 0xf6e3c4, cloth: 0xf2b02c, band: 0x2b2b2b } },
  shield: { name: '盾兵', hp: 80, speed: 1.8, scale: 1.35, damage: 12, score: 18, colors: { skin: 0xe9e2f5, cloth: 0x3f6fd6, band: 0x3f6fd6 } },
  bomber: { name: '炸彈兵', hp: 45, speed: 2, scale: 1.25, damage: 15, score: 16, colors: { skin: 0xdff2d6, cloth: 0x4c8a3c, band: 0xf0e14a } },
  archer: { name: '弓手', hp: 40, speed: 2, scale: 1.2, damage: 8, score: 15, colors: { skin: 0xf3e0c8, cloth: 0x8a3fd6, band: 0x8a3fd6 } },
  tank: { name: '巨巨', hp: 400, speed: 1.4, scale: 2.1, damage: 25, score: 60, colors: { skin: 0xd9c2a8, cloth: 0x7a4b2e, band: 0x8a8f96 } },
  boss: { name: '大魔王', hp: 2400, speed: 1.6, scale: 3.6, damage: 35, score: 400, colors: { skin: 0xc9a7e8, cloth: 0x5a2c8a, band: 0xffd23c } },
};

// Hit shapes in the unscaled local frame (feet at the origin, facing +z).
const HEAD = { c: { x: 0, y: 1.05, z: 0 }, r: 0.42 };
const BODY = { c: { x: 0, y: 0.45, z: 0 }, r: 0.36 };
const SHIELD = { min: { x: -0.48, y: 0.12, z: 0.38 }, max: { x: 0.48, y: 1.02, z: 0.5 } };

const lambert = (color: number) => new THREE.MeshLambertMaterial({ color, flatShading: true });

function buildChibi(kind: EnemyKind) {
  const c = KINDS[kind].colors;
  const root = new THREE.Group();
  const body = new THREE.Group(); // tips over when dying
  root.add(body);
  const skin = lambert(c.skin);
  const cloth = lambert(c.cloth);
  const mats = [skin, cloth];
  const torso = new THREE.Mesh(new THREE.IcosahedronGeometry(BODY.r, 1), cloth);
  torso.position.set(BODY.c.x, BODY.c.y, BODY.c.z);
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(HEAD.r, 2), skin);
  head.position.set(HEAD.c.x, HEAD.c.y, HEAD.c.z);
  body.add(torso, head);
  // Headband or helmet.
  const band = new THREE.Mesh(new THREE.CylinderGeometry(HEAD.r * 1.02, HEAD.r * 1.02, 0.16, 16), lambert(c.band));
  band.position.set(0, HEAD.c.y + 0.16, 0);
  body.add(band);
  if (kind === 'tank' || kind === 'boss') {
    const helm = new THREE.Mesh(new THREE.SphereGeometry(HEAD.r * 1.06, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), lambert(c.band));
    helm.position.set(0, HEAD.c.y + 0.05, 0);
    body.add(helm);
  }
  if (kind === 'boss') {
    for (let i = 0; i < 5; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 5), lambert(0xffd23c));
      const a = (i / 5) * Math.PI * 2;
      spike.position.set(Math.sin(a) * 0.3, HEAD.c.y + 0.5, Math.cos(a) * 0.3);
      body.add(spike);
    }
  }
  // Big cartoon eyes on the +z face.
  for (const s of [-1, 1]) {
    const white = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    white.position.set(s * 0.15, HEAD.c.y + 0.02, HEAD.r * 0.86);
    white.scale.z = 0.5;
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: 0x151515 }));
    pupil.position.set(s * 0.15, HEAD.c.y + 0.01, HEAD.r * 0.86 + 0.05);
    pupil.scale.z = 0.5;
    body.add(white, pupil);
  }
  // Stubby feet and hands.
  const feet: THREE.Mesh[] = [];
  for (const s of [-1, 1]) {
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), cloth);
    foot.position.set(s * 0.16, 0.1, 0.04);
    foot.scale.set(1, 0.7, 1.3);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), skin);
    hand.position.set(s * 0.4, 0.5, 0.1);
    body.add(foot, hand);
    feet.push(foot);
  }
  let shield: THREE.Mesh | null = null;
  if (kind === 'shield') {
    shield = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.1, 18).rotateX(Math.PI / 2), lambert(0xb9c2cc));
    shield.position.set(0, 0.6, 0.45);
    const boss = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), lambert(0xffd23c));
    boss.position.z = 0.06;
    shield.add(boss);
    body.add(shield);
  }
  if (kind === 'archer') {
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0.35, 0), new THREE.Vector3(0, 0, 0.18), new THREE.Vector3(0, -0.35, 0));
    const bow = new THREE.Mesh(new THREE.TubeGeometry(curve, 10, 0.03, 5), lambert(0x6f4a2e));
    bow.position.set(-0.42, 0.6, 0.15);
    body.add(bow);
  }
  if (kind === 'bomber') {
    const bag = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), lambert(0x333333));
    bag.position.set(0.28, 0.5, -0.25);
    body.add(bag);
  }
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  root.scale.setScalar(KINDS[kind].scale);
  return { root, body, feet, mats, shield };
}

export interface EnemyContext {
  world: WorldLike;
  player: THREE.Vector3;
  enemies: Enemy[];
  rand: () => number;
  hurt(amount: number, from: THREE.Vector3): void;
  lob(from: THREE.Vector3, to: THREE.Vector3, damage: number): void;
  shoot(from: THREE.Vector3, damage: number): void;
}

const WINDUP = 0.5;
const COOLDOWN = 1.1;

export class Enemy {
  readonly def: KindDef;
  readonly model;
  readonly maxHp: number;
  hp: number;
  /** Knockback velocity (horizontal), decays quickly. */
  readonly push = new THREE.Vector3();
  burn = 0; // s of burning left
  burnDps = 0;
  poisonStacks = 0;
  poisonLeft = 0;
  slowLeft = 0;
  frozenLeft = 0;
  private flash = 0;
  private windup = -1;
  private cooldown = 0;
  private throwCd = 2;
  private phase = Math.random() * 6;
  private deadFor = 0;
  private spin = new THREE.Vector3();
  private fly = new THREE.Vector3();
  private inv = new THREE.Matrix4();
  private age = 0;
  private stuckFor = 0;
  private sidestep = 0;
  private sideDir = 1;

  /** Height of the platform it stands on (it stays put up there), or null on the ground. */
  readonly perch: number | null;

  constructor(
    readonly kind: EnemyKind,
    at: THREE.Vector3,
    hpScale: number,
    perch: number | null = null,
  ) {
    this.perch = perch;
    this.def = KINDS[kind];
    this.maxHp = this.hp = Math.round(this.def.hp * hpScale);
    this.model = buildChibi(kind);
    this.model.root.position.copy(at);
  }

  get alive(): boolean {
    return this.hp > 0;
  }

  get position(): THREE.Vector3 {
    return this.model.root.position;
  }

  /** Gone (death animation over). */
  get removed(): boolean {
    return !this.alive && this.deadFor > 1.1;
  }

  /** Centre of mass in world space (for effects and chaining). */
  centre(out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.position).setY(this.position.y + 0.75 * this.def.scale);
  }

  /** First part a world segment touches, with the fraction along it. */
  test(a: V3, b: V3): { part: HitPart; t: number } | null {
    if (!this.alive) return null;
    this.inv.copy(this.model.root.matrixWorld).invert();
    const la = new THREE.Vector3(a.x, a.y, a.z).applyMatrix4(this.inv);
    const lb = new THREE.Vector3(b.x, b.y, b.z).applyMatrix4(this.inv);
    let best: { part: HitPart; t: number } | null = null;
    const consider = (part: HitPart, t: number | null) => {
      if (t !== null && (!best || t < best.t)) best = { part, t };
    };
    consider('head', sphereEntry(la, lb, HEAD.c, HEAD.r));
    consider('body', sphereEntry(la, lb, BODY.c, BODY.r));
    if (this.kind === 'shield') consider('shield', segmentBox(la, lb, SHIELD.min, SHIELD.max));
    return best;
  }

  /** Applies damage; returns true if it killed. `dir` pushes the enemy back. */
  damage(amount: number, dir: THREE.Vector3 | null, knock = 1): boolean {
    if (!this.alive) return false;
    this.hp -= amount;
    this.flash = 0.08;
    if (dir) this.push.addScaledVector(dir.clone().setY(0).normalize(), (knock * 3) / this.def.scale);
    if (this.hp <= 0) {
      // Launched away, spinning.
      this.fly.copy(dir ?? new THREE.Vector3(0, 0, 1)).setY(0).normalize().multiplyScalar(5 / this.def.scale);
      this.fly.y = 6 / Math.sqrt(this.def.scale);
      this.spin.set(Math.random() * 10 - 5, Math.random() * 10 - 5, Math.random() * 10 - 5);
      return true;
    }
    return false;
  }

  update(dt: number, ctx: EnemyContext) {
    const root = this.model.root;
    this.age += dt;
    this.flash = Math.max(0, this.flash - dt);
    const tint = this.frozenLeft > 0 ? 0x4aa8ff : this.flash > 0 ? 0xffffff : this.burn > 0 ? 0x7a2a00 : this.poisonLeft > 0 ? 0x1f5a00 : 0;
    for (const m of this.model.mats) m.emissive.setHex(tint);

    if (!this.alive) {
      this.deadFor += dt;
      this.fly.y -= 18 * dt;
      root.position.addScaledVector(this.fly, dt);
      root.rotation.x += this.spin.x * dt;
      root.rotation.z += this.spin.z * dt;
      const s = this.def.scale * Math.max(0.01, 1 - Math.max(0, this.deadFor - 0.7) / 0.4);
      root.scale.setScalar(s);
      root.updateMatrixWorld();
      return;
    }

    // Status effects.
    if (this.burn > 0) {
      this.burn -= dt;
      this.hp -= this.burnDps * dt;
    }
    if (this.poisonLeft > 0) {
      this.poisonLeft -= dt;
      this.hp -= this.poisonStacks * 4 * dt;
      if (this.poisonLeft <= 0) this.poisonStacks = 0;
    }
    if (this.hp <= 0) {
      this.damage(0, null);
      this.hp = -1;
      return;
    }
    this.slowLeft = Math.max(0, this.slowLeft - dt);
    if (this.frozenLeft > 0) {
      this.frozenLeft -= dt;
      root.updateMatrixWorld();
      return;
    }
    const speed = this.def.speed * (this.slowLeft > 0 ? 0.55 : 1);

    const to = ctx.player.clone().sub(root.position).setY(0);
    const d = to.length();
    to.normalize();
    root.rotation.y = Math.atan2(to.x, to.z);
    this.cooldown -= dt;
    const reach = 0.9 + 0.5 * this.def.scale;
    const move = new THREE.Vector3();
    const ranged = this.kind === 'bomber' || this.kind === 'archer';

    if (this.kind === 'archer') {
      this.throwCd -= dt;
      if (this.perch === null) {
        if (d < 12) move.copy(to).negate();
        else if (d > 24) move.copy(to);
      }
      // Draw (lean back), then loose.
      if (this.throwCd < 0.5) this.model.body.rotation.x = -0.25 * (1 - Math.max(0, this.throwCd) / 0.5);
      if (this.throwCd <= 0 && d < 40) {
        ctx.shoot(this.centre().setY(root.position.y + 1.1 * this.def.scale), this.def.damage);
        this.throwCd = 2.2 + ctx.rand() * 1.2;
        this.model.body.rotation.x = 0;
      }
    } else if (this.kind === 'bomber' || this.kind === 'boss') {
      this.throwCd -= dt;
      if (this.perch !== null) {
        // Stays on its platform.
      } else if (ranged && d < 12) move.copy(to).negate();
      else if (!ranged || d > 20) move.copy(to);
      if (this.throwCd <= 0 && d < 30) {
        const shots = this.kind === 'boss' ? 3 : 1;
        for (let i = 0; i < shots; i++) {
          const off = new THREE.Vector3((ctx.rand() - 0.5) * 6 * (shots > 1 ? 1 : 0.4), 0, (ctx.rand() - 0.5) * 6 * (shots > 1 ? 1 : 0.4));
          ctx.lob(this.centre().setY(root.position.y + 1.4 * this.def.scale), ctx.player.clone().add(off), this.def.damage);
        }
        this.throwCd = this.kind === 'boss' ? 4 : 3.5 + ctx.rand();
      }
    } else move.copy(to);

    if (!ranged) {
      if (this.windup >= 0) {
        this.windup += dt;
        move.set(0, 0, 0);
        this.model.body.rotation.x = -0.4 * Math.sin((this.windup / WINDUP) * Math.PI);
        if (this.windup >= WINDUP) {
          if (d < reach + 0.6) ctx.hurt(this.def.damage, root.position);
          this.windup = -1;
          this.cooldown = COOLDOWN;
        }
      } else if (d < reach) {
        move.set(0, 0, 0);
        if (this.cooldown <= 0) this.windup = 0;
      }
    }

    // Separation from the pack.
    for (const o of ctx.enemies) {
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
    if (this.perch !== null) {
      move.set(0, 0, 0);
      this.push.set(0, 0, 0);
    }
    // Blocked by cover: sidestep along it for a moment.
    if (this.sidestep > 0) {
      this.sidestep -= dt;
      if (move.lengthSq() > 0.01) move.set(to.z * this.sideDir, 0, -to.x * this.sideDir).addScaledVector(to, 0.25).normalize();
    }
    const before = root.position.clone();
    root.position.addScaledVector(move, speed * dt).addScaledVector(this.push, dt);
    this.push.multiplyScalar(Math.exp(-dt * 8));
    if (this.perch === null) ctx.world.resolve(root.position, 0.35 * this.def.scale);
    else root.position.y = this.perch;
    const progressed = before.distanceTo(root.position);
    if (move.lengthSq() > 0.01 && progressed < speed * dt * 0.35) {
      this.stuckFor += dt;
      if (this.stuckFor > 0.3) {
        this.sidestep = 0.9;
        this.sideDir = ctx.rand() < 0.5 ? -1 : 1;
        this.stuckFor = 0;
      }
    } else this.stuckFor = 0;

    // Waddle.
    const walking = move.lengthSq() > 0.01;
    this.phase += dt * speed * 4 * (walking ? 1 : 0);
    if (this.windup < 0 && this.kind !== 'archer') this.model.body.rotation.x = 0;
    this.model.body.rotation.z = Math.sin(this.phase) * 0.12;
    this.model.body.position.y = Math.abs(Math.sin(this.phase)) * 0.08;
    this.model.feet[0].position.z = 0.04 + Math.sin(this.phase) * 0.1;
    this.model.feet[1].position.z = 0.04 - Math.sin(this.phase) * 0.1;
    // Pop in when spawning.
    root.scale.setScalar(this.def.scale * Math.min(1, 0.2 + this.age * 2.5));
    root.updateMatrixWorld();
  }
}

/** Number and kinds of monsters in wave `k` (1-based); every 5th wave has a boss. */
export function waveRoster(k: number): EnemyKind[] {
  const out: EnemyKind[] = [];
  const add = (kind: EnemyKind, n: number) => {
    for (let i = 0; i < n; i++) out.push(kind);
  };
  add('grunt', 4 + 2 * k);
  add('runner', k >= 2 ? 1 + k : 0);
  add('shield', k >= 3 ? Math.floor(k / 1.5) : 0);
  add('bomber', k >= 4 ? Math.floor(k / 2) : 0);
  add('archer', k >= 2 ? 1 + Math.floor(k / 3) : 0);
  add('tank', k >= 6 ? Math.floor((k - 4) / 2) : 0);
  if (k % 5 === 0) add('boss', 1);
  // Interleave so the tough ones don't all come last (deterministic per wave).
  for (let i = out.length - 1; i > 0; i--) {
    const j = (i * 7919 + k * 31) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** HP multiplier for wave `k`. */
export function waveHp(k: number): number {
  return 1 + 0.15 * (k - 1);
}
