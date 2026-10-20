import * as THREE from 'three';
import type { Ammo } from '../ballistics/ammo';
import { vec3 } from '../core/vec3';
import { Pose, WoundResult, findEntry, traceWound } from './anatomy';
import { createDeerModel, DeerModel } from './deerModel';
import { Condition, Physiology } from './physiology';

const GRAZE_PITCH = 1.7; // head down
const ALERT_PITCH = -0.1; // head up

export interface DeerHit {
  wound: WoundResult;
  /** World-space points for later X-ray display. */
  entryWorld: THREE.Vector3;
  exitWorld: THREE.Vector3 | null;
  time: number; // game time of the hit
}

/** A deer standing on the terrain: visual model, pose, and wound physiology. */
export class Deer {
  readonly model: DeerModel;
  readonly physiology = new Physiology();
  readonly pose: Pose = { neckPitch: GRAZE_PITCH };
  readonly hits: DeerHit[] = [];
  onConditionChange: ((deer: Deer, condition: Condition) => void) | null = null;
  private grazeTimer: number;
  private grazing = true;
  private fall = 0; // 0..1 fall animation progress
  private groundY: number;
  private lastCondition: Condition = 'healthy';
  private inv = new THREE.Matrix4();

  constructor(
    readonly id: number,
    x: number,
    y: number,
    z: number,
    yaw: number,
    buck: boolean,
    private rand: () => number,
  ) {
    this.model = createDeerModel(buck);
    this.model.root.position.set(x, y, z);
    this.groundY = y;
    this.model.root.rotation.y = yaw;
    this.grazeTimer = rand() * 6;
    this.model.root.updateMatrixWorld();
  }

  get object(): THREE.Object3D {
    return this.model.root;
  }

  get condition(): Condition {
    return this.physiology.condition;
  }

  /** Only standing animals are hit-tested; fallen ones are treated as terrain for now. */
  get hittable(): boolean {
    return this.condition === 'healthy' || this.condition === 'wounded';
  }

  update(dt: number) {
    this.physiology.update(dt);
    const c = this.physiology.condition;
    if (c !== this.lastCondition) {
      this.lastCondition = c;
      this.onConditionChange?.(this, c);
    }

    if (c === 'down' || c === 'dead') {
      // Tip over onto the side.
      this.fall = Math.min(1, this.fall + dt * 1.6);
      const k = 1 - (1 - this.fall) ** 3;
      this.model.root.rotation.z = k * (Math.PI / 2 - 0.15);
      // Lying on its side the body is ~0.2 m thick; lift so it rests on the ground, not in it.
      this.model.root.position.y = this.groundY + k * 0.12;
      this.model.neck.rotation.x = THREE.MathUtils.lerp(this.pose.neckPitch, 0.6, k);
      this.model.root.updateMatrixWorld();
      return;
    }

    // Idle: alternate grazing and looking around.
    this.grazeTimer -= dt;
    if (this.grazeTimer <= 0) {
      this.grazing = !this.grazing;
      this.grazeTimer = this.grazing ? 4 + this.rand() * 8 : 2 + this.rand() * 4;
    }
    const target = this.grazing ? GRAZE_PITCH : ALERT_PITCH;
    this.pose.neckPitch += (target - this.pose.neckPitch) * Math.min(1, dt * 2.5);
    this.model.neck.rotation.x = this.pose.neckPitch;
    this.model.root.updateMatrixWorld();
  }

  /** Startles to attention (P5 will add fleeing). */
  alert() {
    this.grazing = false;
    this.grazeTimer = 3 + this.rand() * 3;
  }

  /**
   * Tests a world-space bullet segment against the body. On a hit, applies the wound and
   * returns it together with the world exit point (if the bullet passed through).
   */
  testHit(
    a: THREE.Vector3,
    b: THREE.Vector3,
    ammo: Ammo,
    velocity: number,
    time: number,
  ): { hit: DeerHit; fraction: number } | null {
    if (!this.hittable) return null;
    this.inv.copy(this.model.root.matrixWorld).invert();
    const la = a.clone().applyMatrix4(this.inv);
    const lb = b.clone().applyMatrix4(this.inv);
    const f = findEntry(vec3(la.x, la.y, la.z), vec3(lb.x, lb.y, lb.z), this.pose);
    if (f === null) return null;
    const entry = la.clone().lerp(lb, f);
    const dir = lb.clone().sub(la).normalize();
    const wound = traceWound(ammo, vec3(entry.x, entry.y, entry.z), vec3(dir.x, dir.y, dir.z), velocity, this.pose);
    const toWorld = (v: { x: number; y: number; z: number }) =>
      new THREE.Vector3(v.x, v.y, v.z).applyMatrix4(this.model.root.matrixWorld);
    const hit: DeerHit = {
      wound,
      entryWorld: toWorld(entry),
      exitWorld: wound.exit ? toWorld(wound.exit) : null,
      time,
    };
    this.hits.push(hit);
    this.physiology.applyWound(wound);
    this.alert();
    return { hit, fraction: f };
  }
}
