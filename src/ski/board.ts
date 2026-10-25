import * as THREE from 'three';

// Snowboard physics. Gravity pulls along the slope, snow friction and air drag slow you,
// and the board's edge decides where the speed goes:
//  - carving (lean): the board turns on its edge and the velocity follows it, little speed lost;
//  - skidding (turn + lean): the board is thrown sideways toward the lean and scrubs speed
//    while the path curves that way;
//  - braking (turn + lean back): the board goes fully across the slope and stops you.
// Leaving the ground happens naturally off lips and rollers; the jump button adds an ollie.

export interface Ground {
  height(x: number, z: number): number;
  normal(x: number, z: number, out?: { x: number; y: number; z: number }): { x: number; y: number; z: number };
}

export interface BoardInput {
  lean: number; // -1..1, left/right weight
  press: number; // -1..1, forward (nose) / back (tail)
  turn: boolean; // the turn button: throw the board sideways
  jump: boolean; // held to crouch, released to pop
}

export const PHYS = {
  g: 9.81,
  glide: 0.045, // snow friction while running flat on the base
  skid: 0.32,
  brake: 0.75,
  drag: 0.0055, // 1/m, standing
  dragTuck: 0.0036, // pressing the nose, crouched
  dragBack: 0.0075,
  carveRadius: 8, // m at full lean
  maxCarveAccel: 13, // m/s², lateral grip limit
  pivotRate: 1.8, // rad/s turning while nearly stopped
  edgeRate: 7, // rad/s the board swings when thrown sideways
  pop: 3.2, // m/s ollie
  popCharged: 5.5,
  charge: 0.45, // s to a full crouch
  airSpin: 7.5, // rad/s spinning with the turn button in the air
  airSteer: 1.6,
  crashImpact: 15, // m/s into the slope
  crashAngle: 0.95, // rad: landing more sideways than this is a fall
  push: 1.4, // m/s² skating on the flat
  airGap: 0.35, // m off the snow before it counts as airborne (small hops stay 'riding')
};

export type BoardEvent =
  | { type: 'takeoff' }
  | { type: 'land'; impact: number; spin: number; air: number }
  | { type: 'crash'; reason: 'landing' | 'obstacle' };

const tmpN = { x: 0, y: 1, z: 0 };
const up = new THREE.Vector3(0, 1, 0);

export class Board {
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  /** Direction the nose points (yaw, 0 = +z). */
  heading = 0;
  grounded = true;
  airTime = 0;
  spin = 0; // yaw turned while airborne
  charge = 0;
  /** 0 riding straight on the base .. 1 fully sideways (for spray and sound). */
  skid = 0;
  /** Carving edge angle cue, -1..1 (for camera roll). */
  edge = 0;
  private wasJump = false;
  readonly normal = new THREE.Vector3(0, 1, 0);

  place(x: number, z: number, heading: number, ground: Ground) {
    this.pos.set(x, ground.height(x, z), z);
    this.vel.set(0, 0, 0);
    this.heading = heading;
    this.grounded = true;
    this.airTime = 0;
    this.spin = 0;
    this.charge = 0;
    this.skid = 0;
  }

  /** Nose direction in the horizontal plane. */
  forward(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(Math.sin(this.heading), 0, Math.cos(this.heading));
  }

  get speed(): number {
    return this.vel.length();
  }

  step(dt: number, input: BoardInput, ground: Ground): BoardEvent[] {
    const events: BoardEvent[] = [];
    // Crouch while the jump button is held; pop on release.
    let pop = 0;
    if (input.jump) this.charge = Math.min(PHYS.charge, this.charge + dt);
    else if (this.wasJump) {
      pop = this.grounded ? PHYS.pop + (PHYS.popCharged - PHYS.pop) * (this.charge / PHYS.charge) : 0;
      this.charge = 0;
    }
    this.wasJump = input.jump;

    const n0 = ground.normal(this.pos.x, this.pos.z, tmpN);
    this.normal.set(n0.x, n0.y, n0.z);
    if (this.grounded) this.groundControl(dt, input, pop);
    else this.airControl(dt, input);

    // Full gravity; the snow pushes back only when the board would sink into it, so the board
    // leaves the ground by itself wherever the slope falls away faster than gravity can follow.
    this.vel.y -= PHYS.g * dt;
    this.pos.addScaledVector(this.vel, dt);
    const h = ground.height(this.pos.x, this.pos.z);
    const n = ground.normal(this.pos.x, this.pos.z, tmpN);
    this.normal.set(n.x, n.y, n.z);
    if (this.pos.y <= h) {
      this.pos.y = h;
      const impact = this.removeInto(this.normal);
      if (!this.grounded) events.push(this.land(impact));
    } else if (this.grounded && (this.pos.y - h > PHYS.airGap || pop > 0)) {
      this.grounded = false;
      this.airTime = 0;
      this.spin = 0;
      events.push({ type: 'takeoff' });
    }
    if (!this.grounded) this.airTime += dt;
    return events;
  }

  /** Removes any velocity pointing into the surface; returns how fast it was going in. */
  private removeInto(n: THREE.Vector3): number {
    const into = this.vel.dot(n);
    if (into < 0) this.vel.addScaledVector(n, -into);
    return Math.max(0, -into);
  }

  private groundControl(dt: number, input: BoardInput, pop: number) {
    const n = this.normal;
    const along = this.vel.clone().addScaledVector(n, -this.vel.dot(n));
    const speed = along.length();
    const velYaw = speed > 0.3 ? Math.atan2(along.x, along.z) : this.heading;
    // Which end of the board leads (riding switch is fine).
    const switchStance = Math.abs(wrap(velYaw - this.heading)) > Math.PI / 2;
    const leadYaw = switchStance ? wrap(this.heading + Math.PI) : this.heading;

    let mu = PHYS.glide;
    let dragK = PHYS.drag;
    const press = input.press;
    const lean = Math.abs(input.lean) > 0.12 ? input.lean : 0;

    if (input.turn) {
      let target: number;
      if (press < -0.35 || lean === 0) {
        // Brake: square across the travel direction, on whichever side is closer.
        const side = wrap(this.heading - velYaw) >= 0 ? 1 : -1;
        target = velYaw + side * (Math.PI / 2);
        mu = press < -0.35 ? PHYS.brake : PHYS.skid;
      } else {
        // Skid turn: the board swings toward the lean and the path bends that way.
        // Lean right (+) turns right, which is toward -x when facing +z: yaw decreases.
        const dir = lean > 0 ? -1 : 1;
        target = velYaw + dir * 1.25;
        mu = PHYS.skid;
        this.vel.applyAxisAngle(n, dir * Math.min(1.5, 0.6 + speed * 0.05) * Math.abs(lean) * dt);
      }
      this.heading = approachAngle(this.heading, target, PHYS.edgeRate * dt, true);
    } else {
      // Carve on the edge: the radius shrinks with lean, limited by grip at speed.
      const rate =
        speed < 3 ? -lean * PHYS.pivotRate : -lean * Math.min(speed / PHYS.carveRadius, PHYS.maxCarveAccel / speed);
      this.heading = wrap(this.heading + rate * dt);
      // The velocity follows the board's leading end.
      const want = switchStance ? wrap(this.heading + Math.PI) : this.heading;
      if (speed > 0.3) {
        const turn = clampAbs(wrap(want - velYaw), 6 * dt);
        this.vel.applyAxisAngle(n, turn);
        this.vel.multiplyScalar(1 - Math.abs(turn) * 0.04);
      }
      if (press > 0) {
        mu -= 0.012 * press;
        dragK = PHYS.drag + (PHYS.dragTuck - PHYS.drag) * press;
      } else if (press < 0) {
        mu += 0.05 * -press;
        dragK = PHYS.drag + (PHYS.dragBack - PHYS.drag) * -press;
      }
    }
    this.edge += ((input.turn ? 0 : -lean) - this.edge) * Math.min(1, dt * 6);
    this.skid = Math.abs(Math.sin(wrap(leadYaw - velYaw))) * Math.min(1, speed / 4);

    // Snow friction (scaled by how hard the slope presses back) and air drag on the motion
    // along the surface.
    const normalPart = this.vel.dot(n);
    const t = this.vel.clone().addScaledVector(n, -normalPart);
    const v = t.length();
    if (v > 1e-4) {
      const decel = mu * PHYS.g * n.y + dragK * v * v;
      t.multiplyScalar(Math.max(0, v - decel * dt) / v);
      this.vel.copy(t).addScaledVector(n, normalPart);
    }
    // Skating push on the flat.
    if (press > 0.3 && v < 3 && !input.turn) {
      const f = this.forward();
      f.addScaledVector(n, -f.dot(n)).normalize();
      this.vel.addScaledVector(f, PHYS.push * press * dt);
    }
    if (pop > 0) this.vel.addScaledVector(n.clone().lerp(up, 0.3).normalize(), pop);
  }

  private airControl(dt: number, input: BoardInput) {
    const v = this.vel.length();
    this.vel.multiplyScalar(1 - PHYS.drag * v * dt);
    const lean = Math.abs(input.lean) > 0.12 ? input.lean : 0;
    const rate = -lean * (input.turn ? PHYS.airSpin : PHYS.airSteer);
    this.heading = wrap(this.heading + rate * dt);
    this.spin += rate * dt;
    this.skid = 0;
  }

  private land(impact: number): BoardEvent {
    const n = this.normal;
    const spin = this.spin;
    const air = this.airTime;
    this.grounded = true;
    this.airTime = 0;
    this.spin = 0;
    const flat = this.vel.clone().addScaledVector(n, -this.vel.dot(n));
    if (flat.lengthSq() > 1) {
      const velYaw = Math.atan2(flat.x, flat.z);
      const off = Math.abs(wrap(velYaw - this.heading));
      const sideways = Math.min(off, Math.PI - off);
      if (sideways > PHYS.crashAngle || impact > PHYS.crashImpact) return { type: 'crash', reason: 'landing' };
      // A slightly crooked landing costs some speed.
      this.vel.multiplyScalar(1 - sideways * 0.35);
    } else if (impact > PHYS.crashImpact) return { type: 'crash', reason: 'landing' };
    return { type: 'land', impact, spin, air };
  }
}

export function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function clampAbs(v: number, m: number): number {
  return Math.max(-m, Math.min(m, v));
}

/** Moves angle `a` toward `b` by at most `max`; with `either`, toward b or b+π, whichever is nearer. */
function approachAngle(a: number, b: number, max: number, either = false): number {
  let d = wrap(b - a);
  if (either && Math.abs(d) > Math.PI / 2) d = wrap(d + Math.PI);
  return wrap(a + clampAbs(d, max));
}
