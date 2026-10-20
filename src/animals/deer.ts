import * as THREE from 'three';
import type { Ammo } from '../ballistics/ammo';
import { vec3 } from '../core/vec3';
import { Pose, WoundResult, findEntry, findGraze, traceWound } from './anatomy';
import { BodyState, DeerBrain, World } from './brain';
import { createDeerModel, DeerModel } from './deerModel';
import type { PlayerSignal } from './perception';
import { Condition, Physiology, categorize } from './physiology';
import { bloodTypeFor, worstCategory } from '../tracking/signs';
import type { Sign } from '../tracking/signs';
import { TrailRecorder } from '../tracking/trail';

const GRAZE_PITCH = 1.7; // head down
const ALERT_PITCH = -0.1; // head up
const BEDDED_DROP = 0.42; // m the body sinks when lying with legs folded

export interface DeerHit {
  wound: WoundResult;
  /** Body pose at the moment of the hit, so the X-ray can show the wound as it happened. */
  pose: Pose;
  /** Shooter-to-entry distance, m. */
  range: number;
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
  /** Where trail signs go; set by the Herd. */
  signSink: ((sign: Omit<Sign, 'id'>) => void) | null = null;
  private trail: TrailRecorder | null = null;
  /** Game time and place it went down (set by the game when the condition changes). */
  downAt: number | null = null;
  downPos: { x: number; z: number } | null = null;
  harvested = false;
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
    readonly buck: boolean,
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
    return !this.harvested && (this.condition === 'healthy' || this.condition === 'wounded');
  }

  /** Down or dead, and not yet collected. */
  get harvestable(): boolean {
    return !this.harvested && (this.condition === 'down' || this.condition === 'dead');
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
      // The spot where it fell is the end of the trail.
      this.trail?.update(this.brain.x, this.groundY, this.brain.z, this.brain.yaw, 0, true);
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
    this.trail?.update(brain.x, this.groundY, brain.z, brain.yaw, brain.speed, brain.behavior === 'bedded');
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

  /** Side-effect-free version of testHit: would this segment enter the body? */
  probe(a: THREE.Vector3, b: THREE.Vector3): boolean {
    if (!this.hittable) return false;
    this.inv.copy(this.model.root.matrixWorld).invert();
    const la = a.clone().applyMatrix4(this.inv);
    const lb = b.clone().applyMatrix4(this.inv);
    const A = vec3(la.x, la.y, la.z);
    const B = vec3(lb.x, lb.y, lb.z);
    return findEntry(A, B, this.pose) !== null || findGraze(A, B, this.pose, this.buck) !== null;
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
    origin: THREE.Vector3,
  ): { hit: DeerHit; fraction: number } | { antler: THREE.Vector3; fraction: number } | null {
    if (!this.hittable) return null;
    this.inv.copy(this.model.root.matrixWorld).invert();
    const la = a.clone().applyMatrix4(this.inv);
    const lb = b.clone().applyMatrix4(this.inv);
    const A = vec3(la.x, la.y, la.z);
    const B = vec3(lb.x, lb.y, lb.z);
    const dir = lb.clone().sub(la).normalize();
    let f = findEntry(A, B, this.pose);
    let wound: WoundResult;
    if (f !== null) {
      const entry = la.clone().lerp(lb, f);
      wound = traceWound(ammo, vec3(entry.x, entry.y, entry.z), vec3(dir.x, dir.y, dir.z), velocity, this.pose);
    } else {
      const graze = findGraze(A, B, this.pose, this.buck);
      if (!graze) return null;
      f = graze.fraction;
      const at = la.clone().lerp(lb, f);
      if (graze.kind === 'antler') {
        // Antler: the bullet glances off; the deer is unharmed but bolts.
        const world = at.applyMatrix4(this.model.root.matrixWorld);
        const back = new THREE.Vector3().copy(a).sub(b).normalize().multiplyScalar(50).add(world);
        this.scare({ x: back.x, z: back.z });
        return { antler: world, fraction: f };
      }
      // Ear or tail: a shallow graze through thin tissue, no organs.
      const out = at.clone().addScaledVector(dir, 0.03);
      wound = {
        entry: vec3(at.x, at.y, at.z),
        dir: vec3(dir.x, dir.y, dir.z),
        exit: vec3(out.x, out.y, out.z),
        exitVelocity: velocity * 0.97,
        penetration: 0.03,
        channel: ammo.diameterM,
        organs: [],
      };
    }
    const entry = new THREE.Vector3(wound.entry.x, wound.entry.y, wound.entry.z);
    const toWorld = (v: { x: number; y: number; z: number }) =>
      new THREE.Vector3(v.x, v.y, v.z).applyMatrix4(this.model.root.matrixWorld);
    const entryWorld = toWorld(entry);
    const hit: DeerHit = {
      wound,
      pose: { neckPitch: this.pose.neckPitch, legs: [...this.pose.legs] as Pose['legs'] },
      range: entryWorld.distanceTo(origin),
      entryWorld,
      exitWorld: wound.exit ? toWorld(wound.exit) : null,
      time,
    };
    this.hits.push(hit);
    this.physiology.applyWound(wound);
    // Start (or update) the trail: the worst wound so far decides what the blood looks like.
    const category = worstCategory(this.hits.map((h) => categorize(h.wound)));
    const blood = category ? bloodTypeFor(category) : null;
    if (!this.trail && this.signSink) this.trail = new TrailRecorder(this.id, this.signSink);
    if (this.trail) {
      if (this.hits.length === 1) this.trail.hit(this.brain.x, this.groundY, this.brain.z, blood);
      else this.trail.blood = blood;
    }
    // A hit deer bolts away from the shot's direction of travel.
    const back = new THREE.Vector3().copy(a).sub(b).normalize().multiplyScalar(50).add(hit.entryWorld);
    this.scare({ x: back.x, z: back.z });
    return { hit, fraction: f };
  }
}
