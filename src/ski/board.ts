import * as THREE from 'three';

// Snowboard physics. Gravity pulls along the slope, snow friction and air drag slow you,
// and the board's angle to the fall line decides where the speed goes:
//  - lean alone: the board turns a little off the fall line (up to ~40°), a gentle turn;
//  - stick centred: the board keeps its current line;
//  - turn + lean: the board goes further, up to straight across the slope (a hard turn);
//  - turn + lean back: the board goes square across and slides, braking.
// The path follows the board only as fast as the edge can grip; the rest is a sideways
// slide that scrubs speed, so a hard turn at high speed becomes a long skid. Leaving the
// ground happens naturally off lips and rollers; the jump button adds an ollie.

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
  skidFriction: 0.9, // extra friction when the board slides fully sideways
  brakeFriction: 1.45, // the uphill edge digs in: stops you even on the steepest pitch
  drag: 0.0042, // 1/m, standing
  dragTuck: 0.0026, // pressing the nose, crouched
  dragBack: 0.006,
  grip: 8, // m/s², sideways force a flat-ish board holds while turning (hard turns skid)
  carveGrip: 19, // m/s² with the board pressed on its edge (full lean): a clean carve
  brakeGrip: 0.8, // braking lets the board slide
  gentleAngle: 0.7, // rad off the fall line at full lean without the turn button (~40°)
  swingSlow: 2.4, // rad/s the board swings when slow
  swingFast: 1.3, // rad/s at 25 m/s
  pivotRate: 1.8, // rad/s turning on the flat
  pop: 4.5, // m/s ollie (about 1 m high)
  popCharged: 7.8, // fully crouched (about 3 m)
  charge: 0.45, // s to a full crouch
  airSpin: 7.5, // rad/s spinning with the turn button in the air
  airSteer: 0.3, // rad/s: leaning in the air barely turns the board (the turn button spins it)
  crashImpact: 15, // m/s into the slope
  crashAngle: 0.95, // rad: landing more sideways than this is a fall
  push: 2.5, // m/s² skating on the flat
  airGap: 0.6, // m off the snow before it counts as airborne (small hops stay 'riding')
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
  /** Body and board roll (rad, + toward the board's -x side): into the carve, against a skid. */
  inclination = 0;
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
    if (this.grounded) this.groundControl(dt, input, pop, ground);
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

  private groundControl(dt: number, input: BoardInput, pop: number, ground: Ground) {
    const n = this.normal;
    const along = this.vel.clone().addScaledVector(n, -this.vel.dot(n));
    const speed = along.length();
    const velYaw = speed > 0.3 ? Math.atan2(along.x, along.z) : this.heading;
    const press = input.press;
    const lean = Math.abs(input.lean) > 0.12 ? input.lean : 0;
    // The slope's fall line, measured over a few metres so bumps don't swing it around.
    const e = 3;
    const gx = (ground.height(this.pos.x + e, this.pos.z) - ground.height(this.pos.x - e, this.pos.z)) / (2 * e);
    const gz = (ground.height(this.pos.x, this.pos.z + e) - ground.height(this.pos.x, this.pos.z - e)) / (2 * e);
    const fallYaw = Math.atan2(-gx, -gz);
    // Steer against the fall line only on a real slope while moving; otherwise pivot.
    const onSlope = Math.hypot(gx, gz) > 0.12 && speed > 2; // steeper than ~7°
    // The board swings quickly when slow, more slowly at speed.
    const rate = PHYS.swingSlow + (PHYS.swingFast - PHYS.swingSlow) * Math.min(1, speed / 25);
    // Pressing the board onto its edge (leaning without the turn button) grips much harder.
    let grip = input.turn ? PHYS.grip : PHYS.grip + (PHYS.carveGrip - PHYS.grip) * Math.abs(lean);
    let slide = PHYS.skidFriction;

    if (input.turn && (press < -0.35 || lean === 0)) {
      // Brake: board square to the fall line on the nearer side, sliding sideways.
      const ref = onSlope ? fallYaw : velYaw;
      const side = wrap(this.heading - ref) >= 0 ? 1 : -1;
      if (speed > 1) this.heading = approachAngle(this.heading, ref + side * (Math.PI / 2), rate * 2 * dt, true);
      grip = PHYS.brakeGrip;
      slide = PHYS.brakeFriction;
    } else if (onSlope && lean !== 0) {
      // The stick sets the board's angle to the fall line: a little on its own (a gentle
      // turn), up to straight across with the turn button (a hard turn / traverse).
      // With the stick centred the board simply keeps its line (so a ridge crest or a
      // traverse can be held).
      // Lean right (+) turns right, toward -x when facing +z: the yaw decreases.
      const angle = input.turn
        ? Math.sign(lean) * (PHYS.gentleAngle + (Math.PI / 2 - PHYS.gentleAngle) * Math.abs(lean))
        : lean * PHYS.gentleAngle;
      // The target is for the leading end; riding switch, the nose points the other way.
      const ridingSwitch = speed > 0.3 && Math.abs(wrap(velYaw - this.heading)) > Math.PI / 2;
      const target = fallYaw - angle + (ridingSwitch ? Math.PI : 0);
      this.heading = approachAngle(this.heading, target, rate * dt);
    } else {
      // Flat or slow: no useful fall line, so the stick pivots the board directly.
      this.heading = wrap(this.heading - lean * Math.min(PHYS.pivotRate, PHYS.grip / Math.max(speed, 1)) * dt);
    }

    // The path follows the board's leading end only as fast as the edge can grip
    // (ω = a / v). Whatever it can't follow becomes a sideways slide that scrubs speed, so
    // throwing the board across at high speed means a long skid.
    const switchStance = Math.abs(wrap(velYaw - this.heading)) > Math.PI / 2;
    const leadYaw = switchStance ? wrap(this.heading + Math.PI) : this.heading;
    let slip = 0;
    let turnRate = 0;
    if (speed > 0.3) {
      const turn = clampAbs(wrap(leadYaw - velYaw), (grip / Math.max(speed, 1)) * dt);
      this.vel.applyAxisAngle(n, turn);
      slip = Math.abs(Math.sin(wrap(leadYaw - velYaw - turn)));
      turnRate = turn / dt;
    }
    // Lean into the turn by the sideways acceleration (tan φ = a / g), and away from a skid.
    const carveTilt = Math.atan((-speed * turnRate) / PHYS.g) * (switchStance ? -1 : 1);
    const sideV = this.vel.x * Math.cos(this.heading) - this.vel.z * Math.sin(this.heading);
    const skidTilt = Math.sign(sideV) * slip * Math.min(1, speed / 6) * 0.6;
    const tilt = clampAbs(carveTilt + skidTilt, 0.85);
    this.inclination += (tilt - this.inclination) * Math.min(1, dt * 8);
    let mu = PHYS.glide + slide * slip;
    let dragK = PHYS.drag;
    if (press > 0 && !input.turn) {
      mu -= 0.012 * press;
      dragK = PHYS.drag + (PHYS.dragTuck - PHYS.drag) * press;
    } else if (press < 0 && !input.turn) {
      mu += 0.05 * -press;
      dragK = PHYS.drag + (PHYS.dragBack - PHYS.drag) * -press;
    }
    this.edge += (-lean * (input.turn ? 1 : 0.7) - this.edge) * Math.min(1, dt * 6);
    this.skid = slip * Math.min(1, speed / 4);

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
    if (press > 0.3 && v < 4 && !input.turn) {
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
    this.inclination *= 1 - Math.min(1, dt * 4);
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
