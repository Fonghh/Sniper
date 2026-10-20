import { PlayerSignal, SENSES, headingVector, hearingRate, sightRate } from './perception';

// Deer behaviour as a small state machine over a kinematic body (x, z, yaw, speed).
// Independent of rendering so it can be tested on a mock world.

export type Behavior = 'graze' | 'alert' | 'flee' | 'bedded' | 'down';

export interface World {
  height(x: number, z: number): number;
  /** Half-size of the area animals may roam (square centred on the origin). */
  limit: number;
  /** Terrain line of sight between two eye points. */
  lineOfSight(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean;
}

export interface BodyState {
  /** False once the animal is down (collapsed, dead or paralysed). */
  canMove: boolean;
  wounded: boolean;
  /** 0..1 multiplier on top speed (broken legs, blood loss). */
  speedScale: number;
}

export const BRAIN = {
  eyeHeight: 1.45,
  walkSpeed: 1.1,
  fleeSpeed: 12, // m/s, a bounding white-tail
  fleeDistance: [150, 250] as const, // healthy
  woundedFleeDistance: [80, 150] as const, // design cap: a bad shot runs at most ~150 m
  flushDistance: 25, // a bedded wounded deer bolts when the player comes this close
  reflushDistance: [60, 100] as const,
  replan: [0.6, 1.4] as const, // s between zigzag heading changes
  zigzag: [0.35, 0.8] as const, // rad, heading offset each replan
  probe: 10, // m ahead when checking terrain
  maxGrade: 0.9, // rise/run the deer will not run up or down
} as const;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/** Three.js yaw facing from (x,z) toward (tx,tz), with local +z forward. */
export const yawToward = (x: number, z: number, tx: number, tz: number) => Math.atan2(tx - x, tz - z);

export class DeerBrain {
  behavior: Behavior = 'graze';
  speed = 0;
  suspicion = 0;
  headDown = true;
  /** Seconds the white tail stays raised. */
  alarm = 0;
  onFlee: ((brain: DeerBrain, from: { x: number; z: number }) => void) | null = null;

  private targetSpeed = 0;
  private desiredYaw: number;
  private home: { x: number; z: number };
  private threat = { x: 0, z: 0 };
  private fleeStart = { x: 0, z: 0 };
  private fleeGoal = 0;
  private replanTimer = 0;
  private grazeTimer: number;
  private wanderTimer: number;
  private ambleTimer = 0;
  private zigSign = 1;

  constructor(
    public x: number,
    public z: number,
    public yaw: number,
    private rand: () => number,
  ) {
    this.desiredYaw = yaw;
    this.home = { x, z };
    this.grazeTimer = rand() * 6;
    this.wanderTimer = 5 + rand() * 10;
  }

  private range(r: readonly [number, number]) {
    return r[0] + this.rand() * (r[1] - r[0]);
  }

  /** Something frightening happened at `from` (gunshot origin, impact, a fleeing herd-mate). */
  scare(from: { x: number; z: number }, body: BodyState) {
    if (!body.canMove || this.behavior === 'flee') return;
    this.startFlee(from, body);
  }

  private startFlee(from: { x: number; z: number }, body: BodyState, distance?: number) {
    this.behavior = 'flee';
    this.threat = { ...from };
    this.fleeStart = { x: this.x, z: this.z };
    this.fleeGoal = distance ?? this.range(body.wounded ? BRAIN.woundedFleeDistance : BRAIN.fleeDistance);
    this.replanTimer = 0;
    this.headDown = false;
    this.alarm = 6;
    this.suspicion = SENSES.fleeAt;
    this.onFlee?.(this, from);
  }

  update(dt: number, world: World, body: BodyState, player: PlayerSignal | null) {
    this.alarm = Math.max(0, this.alarm - dt);
    if (!body.canMove) {
      this.behavior = 'down';
      this.speed = 0;
      return;
    }
    if (this.behavior === 'down') this.behavior = 'graze';

    if (player) this.sense(dt, world, body, player);

    switch (this.behavior) {
      case 'graze':
        this.updateGraze(dt);
        break;
      case 'alert':
        this.headDown = false;
        this.targetSpeed = 0;
        if (player && this.suspicion > 0.3) this.desiredYaw = yawToward(this.x, this.z, player.x, player.z);
        if (this.suspicion < 0.3) this.behavior = 'graze';
        break;
      case 'flee':
        this.updateFlee(dt, world, body);
        break;
      case 'bedded':
        this.targetSpeed = 0;
        this.headDown = false;
        if (player && Math.hypot(player.x - this.x, player.z - this.z) < BRAIN.flushDistance) {
          this.startFlee({ x: player.x, z: player.z }, body, this.range(BRAIN.reflushDistance));
        }
        break;
    }
    this.move(dt, world);
  }

  private sense(dt: number, world: World, body: BodyState, p: PlayerSignal) {
    if (this.behavior === 'flee' || this.behavior === 'bedded') return;
    const eyeY = world.height(this.x, this.z) + (this.headDown ? 0.5 : BRAIN.eyeHeight);
    const senses = { x: this.x, y: eyeY, z: this.z, yaw: this.yaw, headDown: this.headDown };
    const d = Math.hypot(p.x - this.x, p.z - this.z);
    // Line of sight is only worth tracing inside the (generous) maximum sight range.
    const los = d < SENSES.sightRange * SENSES.runFactor && world.lineOfSight(this.x, eyeY, this.z, p.x, p.y, p.z);
    const gain = sightRate(senses, p, los) + hearingRate(senses, p);
    this.suspicion = Math.max(0, this.suspicion + (gain > 0 ? gain : -SENSES.decay) * dt);
    if (this.suspicion >= SENSES.fleeAt) this.startFlee({ x: p.x, z: p.z }, body);
    else if (this.suspicion >= SENSES.alertAt && this.behavior === 'graze') {
      this.behavior = 'alert';
      this.alarm = 3;
    }
  }

  private updateGraze(dt: number) {
    this.grazeTimer -= dt;
    if (this.grazeTimer <= 0) {
      this.headDown = !this.headDown;
      this.grazeTimer = this.headDown ? 4 + this.rand() * 8 : 2 + this.rand() * 4;
    }
    // Occasionally amble a few metres, staying near home.
    this.wanderTimer -= dt;
    if (this.wanderTimer <= 0) {
      this.wanderTimer = 6 + this.rand() * 12;
      const away = Math.hypot(this.x - this.home.x, this.z - this.home.z);
      this.desiredYaw =
        away > 15 ? yawToward(this.x, this.z, this.home.x, this.home.z) : this.yaw + (this.rand() - 0.5) * 2;
      this.ambleTimer = 2 + this.rand() * 2;
      this.grazeTimer = Math.max(this.grazeTimer, 3);
      this.headDown = false;
    }
    this.ambleTimer = Math.max(0, this.ambleTimer - dt);
    this.targetSpeed = this.ambleTimer > 0 ? BRAIN.walkSpeed : 0;
  }

  private updateFlee(dt: number, world: World, body: BodyState) {
    this.targetSpeed = BRAIN.fleeSpeed * body.speedScale;
    this.replanTimer -= dt;
    if (this.replanTimer <= 0) {
      this.replanTimer = this.range(BRAIN.replan);
      this.zigSign = -this.zigSign;
      const away = yawToward(this.threat.x, this.threat.z, this.x, this.z);
      this.desiredYaw = this.steer(world, away + this.zigSign * this.range(BRAIN.zigzag));
    }
    const run = Math.hypot(this.x - this.fleeStart.x, this.z - this.fleeStart.z);
    if (run >= this.fleeGoal) {
      this.home = { x: this.x, z: this.z };
      if (body.wounded) {
        this.behavior = 'bedded';
      } else {
        this.behavior = 'alert';
        this.suspicion = SENSES.alertAt * 1.2;
      }
      this.targetSpeed = 0;
    }
  }

  /** Picks the heading nearest `wanted` that stays in bounds and avoids cliffs. */
  private steer(world: World, wanted: number): number {
    const h0 = world.height(this.x, this.z);
    let best = wanted;
    let bestScore = -Infinity;
    for (let k = -6; k <= 6; k++) {
      const yaw = wanted + k * 0.3;
      const f = headingVector(yaw);
      const px = this.x + f.x * BRAIN.probe;
      const pz = this.z + f.z * BRAIN.probe;
      if (Math.abs(px) > world.limit || Math.abs(pz) > world.limit) continue;
      const grade = Math.abs(world.height(px, pz) - h0) / BRAIN.probe;
      const score = -Math.abs(k) * 0.25 - (grade > BRAIN.maxGrade ? 10 : grade * 2);
      if (score > bestScore) {
        bestScore = score;
        best = yaw;
      }
    }
    // Cornered: turn back toward the middle of the area.
    if (bestScore === -Infinity) best = yawToward(this.x, this.z, 0, 0);
    return best;
  }

  private move(dt: number, world: World) {
    const accel = this.behavior === 'flee' ? 14 : 3;
    this.speed += Math.max(-accel * dt, Math.min(accel * dt, this.targetSpeed - this.speed));
    const turnRate = this.behavior === 'flee' ? 3.5 : 1.5;
    const diff = wrap(this.desiredYaw - this.yaw);
    this.yaw = wrap(this.yaw + Math.max(-turnRate * dt, Math.min(turnRate * dt, diff)));
    if (this.speed <= 0.01) return;
    const f = headingVector(this.yaw);
    this.x = Math.max(-world.limit, Math.min(world.limit, this.x + f.x * this.speed * dt));
    this.z = Math.max(-world.limit, Math.min(world.limit, this.z + f.z * this.speed * dt));
  }
}
