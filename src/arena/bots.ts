import * as THREE from 'three';
import { createCharacter } from './character';
import { hitZone } from './hitbox';
import type { V3 } from './projectile';
import type { Hittable } from './targets';
import { Shot, WEAPONS, WeaponDef } from './weapons';
import type { ArenaWorld } from './world';

// Simple deathmatch bots: wander between open spots, spot enemies with line of sight,
// strafe while shooting short bursts. They lead moving targets and allow for bullet drop,
// with an aiming error that shrinks the longer they keep a target in view.

export const BOT_RIFLE: WeaponDef = { ...WEAPONS.rifle, damage: 13, headMultiplier: 2.5 };

const VIEW_RANGE = 65; // m
const VIEW_HALF_ANGLE = 1.0; // rad
const WALK = 3.2;
const STRAFE = 2.8;
const TURN = 5; // rad/s
const RESPAWN = 3; // s

export const BOT_LOOKS = [
  { name: '小紅', body: 0xe0483e, legs: 0x3d3a4a, head: 0xf2c9a0 },
  { name: '阿藍', body: 0x3f7fe0, legs: 0x3d3a4a, head: 0xe8b98c },
  { name: '小黃', body: 0xf0b92e, legs: 0x3d3a4a, head: 0xd9a77c },
];

export interface BotContext {
  world: ArenaWorld;
  rand: () => number;
  /** Everyone who can be shot at in the match (the player and all bots). */
  fighters: Hittable[];
  fire(shot: Shot, origin: THREE.Vector3, dir: THREE.Vector3, owner: Bot): void;
  spawnSpot(): THREE.Vector3;
}

export class Bot implements Hittable {
  readonly model;
  hp = 100;
  private goal: THREE.Vector3 | null = null;
  private target: Hittable | null = null;
  private seen = 0; // s the current target has been in view
  private look = 0; // s until the next visibility check
  private strafe = 1;
  private strafeLeft = 0;
  private cooldown = 0;
  private burst = 0;
  private error = new THREE.Vector3();
  private lastTargetPos = new THREE.Vector3();
  private targetVel = new THREE.Vector3();
  private deadFor = 0;
  private walkPhase = 0;
  private inv = new THREE.Matrix4();
  private alertFrom: THREE.Vector3 | null = null;

  constructor(readonly name: string, look: { body: number; legs: number; head: number }) {
    this.model = createCharacter({ ...look, gun: true });
  }

  get alive(): boolean {
    return this.hp > 0;
  }

  get position(): THREE.Vector3 {
    return this.model.root.position;
  }

  spawn(at: THREE.Vector3) {
    this.hp = 100;
    this.deadFor = 0;
    this.target = null;
    this.goal = null;
    this.model.body.rotation.x = 0;
    this.model.root.position.copy(at);
  }

  /** Being shot turns the bot toward where the shot came from. */
  alert(from: THREE.Vector3) {
    this.alertFrom = from.clone();
  }

  test(a: V3, b: V3) {
    if (!this.alive) return null;
    this.inv.copy(this.model.root.matrixWorld).invert();
    return hitZone(new THREE.Vector3(a.x, a.y, a.z).applyMatrix4(this.inv), new THREE.Vector3(b.x, b.y, b.z).applyMatrix4(this.inv));
  }

  damage(amount: number): boolean {
    if (!this.alive) return false;
    this.hp -= amount;
    return this.hp <= 0;
  }

  private eye(): THREE.Vector3 {
    return this.position.clone().setY(this.position.y + 1.55);
  }

  private faceToward(p: THREE.Vector3, dt: number): number {
    const root = this.model.root;
    const want = Math.atan2(p.x - root.position.x, p.z - root.position.z);
    let diff = want - root.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    root.rotation.y += THREE.MathUtils.clamp(diff, -TURN * dt, TURN * dt);
    return Math.abs(diff);
  }

  private canSee(h: Hittable, ctx: BotContext): boolean {
    const eye = this.eye();
    const chest = h.position.clone().setY(h.position.y + 1.2);
    const to = chest.clone().sub(eye);
    const d = to.length();
    if (d > VIEW_RANGE) return false;
    const facing = new THREE.Vector3(Math.sin(this.model.root.rotation.y), 0, Math.cos(this.model.root.rotation.y));
    const angle = facing.angleTo(to.setY(0));
    if (angle > VIEW_HALF_ANGLE && d > 6 && h !== this.target) return false;
    return ctx.world.lineOfSight(eye, chest);
  }

  update(dt: number, ctx: BotContext) {
    const root = this.model.root;
    if (!this.alive) {
      this.deadFor += dt;
      this.model.body.rotation.x = -Math.min(1, this.deadFor * 4) * (Math.PI / 2 - 0.1);
      if (this.deadFor > RESPAWN) this.spawn(ctx.spawnSpot());
      root.updateMatrixWorld();
      return;
    }

    // Perception (a few times a second).
    this.look -= dt;
    if (this.look <= 0) {
      this.look = 0.2;
      let best: Hittable | null = null;
      let bestD = Infinity;
      for (const h of ctx.fighters) {
        if (h === this || !h.alive || !this.canSee(h, ctx)) continue;
        const d = h.position.distanceTo(root.position);
        if (d < bestD) {
          best = h;
          bestD = d;
        }
      }
      if (best !== this.target) {
        this.seen = 0;
        this.burst = 0;
        this.cooldown = 0.35 + ctx.rand() * 0.4; // reaction time
        if (best) this.lastTargetPos.copy(best.position);
      }
      this.target = best;
    }

    const move = new THREE.Vector3();
    if (this.target && this.target.alive) {
      const t = this.target;
      this.seen += dt;
      this.targetVel.lerp(t.position.clone().sub(this.lastTargetPos).divideScalar(Math.max(dt, 1e-3)), 0.2);
      this.lastTargetPos.copy(t.position);
      const d = t.position.distanceTo(root.position);
      const to = t.position.clone().sub(root.position).setY(0).normalize();
      const side = new THREE.Vector3(to.z, 0, -to.x);
      this.strafeLeft -= dt;
      if (this.strafeLeft <= 0) {
        this.strafe = ctx.rand() < 0.5 ? -1 : 1;
        this.strafeLeft = 0.6 + ctx.rand() * 0.9;
      }
      move.addScaledVector(side, this.strafe * STRAFE);
      if (d > 35) move.addScaledVector(to, WALK);
      else if (d < 8) move.addScaledVector(to, -WALK);
      const off = this.faceToward(t.position, dt);
      this.shoot(dt, d, off, ctx);
    } else {
      this.target = null;
      if (this.alertFrom) {
        if (this.faceToward(this.alertFrom, dt) < 0.1) this.alertFrom = null;
      } else {
        if (!this.goal || this.goal.distanceTo(root.position) < 2) this.goal = ctx.spawnSpot();
        move.copy(this.goal).sub(root.position).setY(0).normalize().multiplyScalar(WALK);
        this.faceToward(this.goal, dt);
      }
    }

    const before = root.position.clone();
    root.position.addScaledVector(move, dt);
    ctx.world.resolve(root.position, 0.35);
    // Stuck against cover while wandering: pick somewhere else.
    if (!this.target && move.lengthSq() > 0 && before.distanceTo(root.position) < 0.2 * WALK * dt) this.goal = null;
    const moving = move.lengthSq() > 0.1;
    this.walkPhase += dt * (moving ? 11 : 0);
    this.model.body.position.y = moving ? Math.abs(Math.sin(this.walkPhase)) * 0.05 : 0;
    root.updateMatrixWorld();
  }

  private shoot(dt: number, d: number, facingError: number, ctx: BotContext) {
    this.cooldown -= dt;
    if (this.cooldown > 0 || facingError > 0.3 || !this.target) return;
    if (this.burst <= 0) {
      this.burst = 3 + Math.floor(ctx.rand() * 3);
      // New aim error per burst; tighter the longer the target has been tracked.
      const spread = (0.35 + d * 0.025) * (this.seen > 2 ? 0.5 : 1);
      this.error.set(ctx.rand() - 0.5, (ctx.rand() - 0.5) * 0.8, ctx.rand() - 0.5).multiplyScalar(spread * 2);
    }
    const t = this.target;
    const speed = BOT_RIFLE.speed;
    const tof = d / speed;
    const aim = t.position.clone().setY(t.position.y + 1.2).addScaledVector(this.targetVel, tof).add(this.error);
    aim.y += 0.5 * 9.81 * tof * tof; // hold over for drop
    const origin = this.eye().add(new THREE.Vector3(Math.sin(this.model.root.rotation.y), 0, Math.cos(this.model.root.rotation.y)).multiplyScalar(0.6));
    const dir = aim.sub(origin).normalize();
    ctx.fire({ weapon: BOT_RIFLE, power: 1 }, origin, dir, this);
    this.burst -= 1;
    this.cooldown = this.burst > 0 ? BOT_RIFLE.interval * 1.5 : 0.7 + ctx.rand() * 0.8;
  }
}
