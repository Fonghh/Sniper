import * as THREE from 'three';
import type { Ammo } from '../ballistics/ammo';
import { vec3 } from '../core/vec3';
import { Pose, WoundResult, findEntry, traceWound } from './anatomy';
import { BodyState, DeerBrain, World } from './brain';
import { createDeerModel, DeerModel } from './deerModel';
import type { PlayerSignal } from './perception';
import { Condition, Physiology } from './physiology';

const GRAZE_PITCH = 1.7; // head down
const ALERT_PITCH = -0.1; // head up
const BEDDED_DROP = 0.42; // m the body sinks when lying with legs folded

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
  readonly pose: Pose = { neckPitch: GRAZE_PITCH, legs: [0, 0, 0, 0] };
  readonly hits: DeerHit[] = [];
  readonly brain: DeerBrain;
  onConditionChange: ((deer: Deer, condition: Condition) => void) | null = null;
  private fall = 0; // 0..1 fall animation progress
  private groundY: number;
  private lastCondition: Condition = 'healthy';
  private earTimer = 0;
  private gaitPhase = 0;
  private bedded = 0; // 0..1 lying-down blend
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
    this.brain = new DeerBrain(x, z, yaw, rand);
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

  get body(): BodyState {
    const p = this.physiology;
    const canMove = (p.condition === 'healthy' || p.condition === 'wounded') && !p.paralysed;
    const blood = Math.min(1, p.blood / 5);
    return { canMove, wounded: p.condition !== 'healthy', speedScale: p.mobility * (0.6 + 0.4 * blood) };
  }

  update(dt: number, world: World, player: PlayerSignal | null) {
    this.physiology.update(dt);
    const c = this.physiology.condition;
    if (c !== this.lastCondition) {
      this.lastCondition = c;
      this.onConditionChange?.(this, c);
    }
    const root = this.model.root;

    if (c === 'down' || c === 'dead') {
      // Tip over onto the side where it stands.
      this.fall = Math.min(1, this.fall + dt * 1.6);
      const k = 1 - (1 - this.fall) ** 3;
      root.rotation.z = k * (Math.PI / 2 - 0.15);
      // Lying on its side the body is ~0.2 m thick; lift so it rests on the ground, not in it.
      root.position.y = this.groundY + k * 0.12;
      this.model.neck.rotation.x = THREE.MathUtils.lerp(this.pose.neckPitch, 0.6, k);
      this.model.legs.forEach((leg) => (leg.rotation.x *= 1 - k));
      root.updateMatrixWorld();
      return;
    }

    const brain = this.brain;
    brain.update(dt, world, this.body, player);
    this.groundY = world.height(brain.x, brain.z);
    root.position.set(brain.x, this.groundY, brain.z);
    root.rotation.y = brain.yaw;

    // Head: down while grazing, up otherwise.
    const target = brain.headDown ? GRAZE_PITCH : ALERT_PITCH;
    this.pose.neckPitch += (target - this.pose.neckPitch) * Math.min(1, dt * 3);
    this.model.neck.rotation.x = this.pose.neckPitch;

    this.animateGait(dt);
    // Bedded: fold the legs and sink onto the ground.
    this.bedded += ((brain.behavior === 'bedded' ? 1 : 0) - this.bedded) * Math.min(1, dt * 3);
    if (this.bedded > 0.01) {
      const fold = [-1.3, -1.3, 1.5, 1.5];
      this.pose.legs = this.pose.legs.map((a, i) => THREE.MathUtils.lerp(a, fold[i], this.bedded)) as Pose['legs'];
      root.position.y -= BEDDED_DROP * this.bedded;
    }
    this.model.legs.forEach((leg, i) => (leg.rotation.x = this.pose.legs[i]));
    this.animateDetails(dt);
    root.updateMatrixWorld();
  }

  /** Walk: diagonal pairs alternate. Gallop: front and hind pairs swing together with a bound. */
  private animateGait(dt: number) {
    const speed = this.brain.speed;
    const galloping = speed > 4;
    this.gaitPhase += dt * (galloping ? speed * 0.75 : speed * 4.5);
    const ph = this.gaitPhase;
    if (speed < 0.05) {
      this.pose.legs = this.pose.legs.map((a) => a * (1 - Math.min(1, dt * 6))) as Pose['legs'];
      return;
    }
    if (galloping) {
      const amp = 0.75;
      this.pose.legs = [
        -amp * Math.sin(ph), -amp * Math.sin(ph + 0.35), amp * Math.sin(ph + 0.4), amp * Math.sin(ph + 0.75),
      ];
      this.model.root.position.y += 0.18 * Math.abs(Math.sin(ph)); // bounding
    } else {
      const amp = 0.32 * Math.min(1, speed / 1.2);
      this.pose.legs = [amp * Math.sin(ph), -amp * Math.sin(ph), -amp * Math.sin(ph), amp * Math.sin(ph)];
    }
  }

  /** Ear twitches and tail: small motions that make the animal feel alive. */
  private animateDetails(dt: number) {
    this.earTimer -= dt;
    if (this.earTimer <= 0) {
      this.earTimer = 1.5 + this.rand() * 4;
      const ear = this.model.ears[Math.floor(this.rand() * this.model.ears.length)];
      ear.userData.twitch = 0.25;
    }
    for (const ear of this.model.ears) {
      const t = (ear.userData.twitch as number | undefined) ?? 0;
      ear.userData.twitch = Math.max(0, t - dt);
      ear.rotation.x = t > 0 ? Math.sin(t * 40) * 0.35 : 0;
    }
    const flag = this.brain.alarm > 0 ? -1.9 : -0.5 + Math.sin(performance.now() * 0.004 + this.id) * 0.08;
    this.model.tail.rotation.x += (flag - this.model.tail.rotation.x) * Math.min(1, dt * 8);
  }

  /** Something frightening happened at `from` (shot, impact, herd-mate bolting). */
  scare(from: { x: number; z: number }) {
    this.brain.scare(from, this.body);
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
    // A hit deer bolts away from the shot's direction of travel.
    const back = new THREE.Vector3().copy(a).sub(b).normalize().multiplyScalar(50).add(hit.entryWorld);
    this.scare({ x: back.x, z: back.z });
    return { hit, fraction: f };
  }
}
