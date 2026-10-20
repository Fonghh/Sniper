import * as THREE from 'three';
import type { InputFrame } from '../input/input';
import type { RestPoint } from '../world/vegetation';
import { HALF_MAP, Terrain } from '../world/terrain';
import { LOOK, PLAYER } from './config';
import { Stability, Stance } from './stability';

const MOVE_LIMIT = HALF_MAP - 70;
const REST_REACH = 0.9; // m beyond a rest's radius at which the rifle can be laid on it

export class Player {
  readonly pos = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  stance: Stance = 'stand';
  scoped = false;
  rested = false;
  running = false;
  speed = 0;
  readonly stability = new Stability();
  private eyeHeight: number = PLAYER.eyeHeightStand;

  constructor(
    private terrain: Terrain,
    private rests: RestPoint[],
  ) {}

  spawn(x: number, z: number, yaw: number, pitch: number) {
    this.pos.set(x, this.terrain.height(x, z), z);
    this.yaw = yaw;
    this.pitch = pitch;
  }

  toggleStance() {
    this.stance = this.stance === 'stand' ? 'prone' : 'stand';
  }

  update(dt: number, f: InputFrame, magnification: number) {
    // Scoped look slows with magnification so the reticle stays controllable.
    const lookScale = this.scoped ? 1 / magnification : 1;
    this.yaw += f.lookYaw * lookScale;
    this.pitch = THREE.MathUtils.clamp(this.pitch + f.lookPitch * lookScale, -LOOK.maxPitch, LOOK.maxPitch);

    this.running = f.run && this.stance === 'stand' && !this.scoped;
    const base = this.stance === 'prone' ? PLAYER.proneSpeed : PLAYER.walkSpeed;
    const speed = this.running ? PLAYER.runSpeed : base;
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const move = fwd.multiplyScalar(f.moveY).add(right.multiplyScalar(f.moveX));
    this.speed = move.length() * speed;
    this.pos.addScaledVector(move, speed * dt);
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -MOVE_LIMIT, MOVE_LIMIT);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -MOVE_LIMIT, MOVE_LIMIT);
    this.pos.y = this.terrain.height(this.pos.x, this.pos.z);

    const targetEye = this.stance === 'prone' ? PLAYER.eyeHeightProne : PLAYER.eyeHeightStand;
    this.eyeHeight += (targetEye - this.eyeHeight) * Math.min(1, dt * 6);

    this.rested = this.stance === 'prone' || (this.scoped && this.nearRest());
    this.stability.update(dt, this.running);
  }

  private nearRest(): boolean {
    for (const r of this.rests) {
      const d = Math.hypot(r.x - this.pos.x, r.z - this.pos.z);
      if (d < r.radius + REST_REACH) return true;
    }
    return false;
  }

  get eye(): THREE.Vector3 {
    return new THREE.Vector3(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z);
  }

  /** View orientation including rifle sway while scoped. */
  viewAngles(): { yaw: number; pitch: number } {
    if (!this.scoped) return { yaw: this.yaw, pitch: this.pitch };
    const o = this.stability.offset(this.stance, this.rested);
    return { yaw: this.yaw + o.yaw, pitch: this.pitch + o.pitch };
  }
}
