import * as THREE from 'three';
import type { InputFrame } from '../input/input';
import { hitZone } from './hitbox';
import type { V3 } from './projectile';
import type { Hittable } from './targets';
import type { ArenaWorld } from './world';

// First-person arena player: quick movement, health with regeneration, respawn.

export const PLAYER_ARENA = {
  walk: 4.8, // m/s
  run: 6.5,
  adsFactor: 0.55,
  eye: 1.6,
  radius: 0.35,
  maxHp: 100,
  regenDelay: 4, // s without damage
  regenRate: 18, // hp/s
  maxPitch: 1.45,
};

export class ArenaPlayer implements Hittable {
  readonly pos = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  hp = PLAYER_ARENA.maxHp;
  sinceHit = 99;
  /** Seconds of spawn protection left. */
  shield = 0;
  speed = 0;
  private inv = new THREE.Matrix4();
  private frame = new THREE.Matrix4();

  constructor(private world: ArenaWorld) {}

  get alive(): boolean {
    return this.hp > 0;
  }

  get position(): THREE.Vector3 {
    return this.pos;
  }

  spawn(at: THREE.Vector3, yaw: number) {
    this.pos.copy(at);
    this.yaw = yaw;
    this.pitch = 0;
    this.hp = PLAYER_ARENA.maxHp;
    this.sinceHit = 99;
    this.shield = 2;
  }

  update(dt: number, input: InputFrame, ads: boolean, lookScale: number) {
    this.sinceHit += dt;
    this.shield = Math.max(0, this.shield - dt);
    if (!this.alive) return;
    this.yaw += input.lookYaw * lookScale;
    this.pitch = THREE.MathUtils.clamp(this.pitch + input.lookPitch * lookScale, -PLAYER_ARENA.maxPitch, PLAYER_ARENA.maxPitch);
    const max = (input.run && !ads ? PLAYER_ARENA.run : PLAYER_ARENA.walk) * (ads ? PLAYER_ARENA.adsFactor : 1);
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const mx = input.moveY * fx - input.moveX * fz;
    const mz = input.moveY * fz + input.moveX * fx;
    const before = this.pos.clone();
    this.pos.x += mx * max * dt;
    this.pos.z += mz * max * dt;
    this.world.resolve(this.pos, PLAYER_ARENA.radius);
    this.speed = before.setY(this.pos.y).distanceTo(this.pos) / Math.max(dt, 1e-4);
    if (this.sinceHit > PLAYER_ARENA.regenDelay) this.hp = Math.min(PLAYER_ARENA.maxHp, this.hp + PLAYER_ARENA.regenRate * dt);
  }

  eye(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(this.pos.x, this.pos.y + PLAYER_ARENA.eye, this.pos.z);
  }

  test(a: V3, b: V3) {
    if (!this.alive) return null;
    // Body faces the view direction (-z in camera terms → +z of the character after a half turn).
    this.frame.makeRotationY(this.yaw + Math.PI).setPosition(this.pos);
    this.inv.copy(this.frame).invert();
    const la = new THREE.Vector3(a.x, a.y, a.z).applyMatrix4(this.inv);
    const lb = new THREE.Vector3(b.x, b.y, b.z).applyMatrix4(this.inv);
    return hitZone(la, lb);
  }

  damage(amount: number): boolean {
    if (!this.alive || this.shield > 0) return false;
    this.hp -= amount;
    this.sinceHit = 0;
    return this.hp <= 0;
  }
}
