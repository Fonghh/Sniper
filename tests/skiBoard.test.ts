import { describe, expect, it } from 'vitest';
import { Board, BoardInput, Ground, wrap } from '../src/ski/board';
import { COURSE_LENGTH, Course, FINISH_Z, START_Z } from '../src/ski/course';

/** A plane falling away along +z at `deg` degrees, optionally ending in a lip at z = lipZ. */
function slope(deg: number, lipZ = Infinity): Ground {
  const k = Math.tan((deg * Math.PI) / 180);
  const height = (_x: number, z: number) => -k * z - (z > lipZ ? (z - lipZ) * 0.35 : 0);
  return {
    height,
    normal(x, z, out = { x: 0, y: 1, z: 0 }) {
      const e = 0.05;
      const hz = (height(x, z + e) - height(x, z - e)) / (2 * e);
      const len = Math.hypot(hz, 1);
      out.x = 0;
      out.y = 1 / len;
      out.z = -hz / len;
      return out;
    },
  };
}

const idle: BoardInput = { lean: 0, press: 0, turn: false, jump: false };
const DT = 1 / 120;
function run(b: Board, g: Ground, input: BoardInput, seconds: number) {
  const events = [];
  for (let t = 0; t < seconds; t += DT) events.push(...b.step(DT, input, g));
  return events;
}

describe('snowboard physics', () => {
  it('accelerates down a slope toward a believable top speed', () => {
    const g = slope(30);
    const b = new Board();
    b.place(0, 0, 0, g);
    run(b, g, idle, 2);
    expect(b.speed).toBeGreaterThan(6);
    run(b, g, idle, 40);
    const standing = b.speed;
    expect(standing).toBeGreaterThan(20);
    expect(standing).toBeLessThan(35);
    run(b, g, { ...idle, press: 1 }, 30);
    expect(b.speed).toBeGreaterThan(standing + 2); // tucked runs faster
    expect(b.grounded).toBe(true);
  });

  it('stays still on gentle ground and needs a push', () => {
    const g = slope(1.5);
    const b = new Board();
    b.place(0, 0, 0, g);
    run(b, g, idle, 3);
    expect(b.speed).toBeLessThan(0.5);
    run(b, g, { ...idle, press: 1 }, 3);
    expect(b.speed).toBeGreaterThan(1);
  });

  it('brakes to a stop with the board across the slope', () => {
    const g = slope(20);
    const b = new Board();
    b.place(0, 0, 0, g);
    run(b, g, idle, 4);
    expect(b.speed).toBeGreaterThan(10);
    run(b, g, { lean: 0, press: -1, turn: true, jump: false }, 4);
    expect(b.speed).toBeLessThan(2);
    expect(Math.abs(Math.abs(wrap(b.heading)) - Math.PI / 2)).toBeLessThan(0.3);
  });

  it('carving right turns toward -x and keeps most of the speed', () => {
    const g = slope(15);
    const b = new Board();
    b.place(0, 0, 0, g);
    run(b, g, idle, 3);
    const before = b.speed;
    run(b, g, { ...idle, lean: 1 }, 0.4);
    expect(b.vel.x).toBeLessThan(-1);
    expect(b.speed).toBeGreaterThan(before * 0.9);
  });

  it('the skid turn scrubs more speed than a carve', () => {
    const g = slope(15);
    const carve = new Board();
    const skid = new Board();
    for (const b of [carve, skid]) {
      b.place(0, 0, 0, g);
      run(b, g, idle, 3);
    }
    run(carve, g, { ...idle, lean: 1 }, 1);
    run(skid, g, { ...idle, lean: 1, turn: true }, 1);
    expect(skid.speed).toBeLessThan(carve.speed - 1.5);
    expect(skid.skid).toBeGreaterThan(0.1);
  });

  it('stands still and keeps its heading on the start pad of the real course', () => {
    const c = new Course();
    const b = new Board();
    b.place(c.centerX(START_Z), START_Z, 0, c);
    run(b, c, idle, 3);
    expect(Math.abs(b.heading)).toBeLessThan(0.05);
    run(b, c, { ...idle, press: 1 }, 6);
    expect(Math.abs(wrap(b.heading))).toBeLessThan(0.3);
    expect(b.pos.z).toBeGreaterThan(START_Z + 10);
  });

    it('leaning alone only turns the board a little off the fall line', () => {
    const g = slope(25);
    const b = new Board();
    b.place(0, 0, 0, g);
    run(b, g, idle, 3);
    run(b, g, { ...idle, lean: 1 }, 2);
    expect(Math.abs(wrap(b.heading))).toBeLessThan(0.75);
    expect(Math.abs(wrap(b.heading))).toBeGreaterThan(0.6);
  });

  it('a hard turn puts the board across the slope; at speed it skids a long way', () => {
    const g = slope(25);
    const b = new Board();
    b.place(0, 0, 0, g);
    run(b, g, { ...idle, press: 1 }, 6);
    expect(b.speed).toBeGreaterThan(20);
    const v0 = b.speed;
    const from = b.pos.clone();
    let skidded = 0;
    for (let t = 0; t < 3; t += DT) {
      b.step(DT, { lean: 1, press: 0, turn: true, jump: false }, g);
      skidded = Math.max(skidded, b.skid);
    }
    expect(Math.abs(Math.abs(wrap(b.heading)) - Math.PI / 2)).toBeLessThan(0.15);
    expect(skidded).toBeGreaterThan(0.5);
    expect(b.speed).toBeLessThan(v0 * 0.65);
    expect(b.pos.distanceTo(from)).toBeGreaterThan(25); // a long skid, not an instant stop
  });

  it('a pressed-edge carve at speed turns cleanly and leans the rider into it', () => {
    const g = slope(25);
    const b = new Board();
    b.place(0, 0, 0, g);
    run(b, g, { ...idle, press: 1 }, 6);
    const v0 = b.speed;
    let lean = 0;
    for (let t = 0; t < 1.2; t += DT) {
      b.step(DT, { ...idle, lean: 1 }, g);
      lean = Math.max(lean, b.inclination);
    }
    expect(b.vel.x).toBeLessThan(-5); // turned right
    expect(b.speed).toBeGreaterThan(v0 * 0.85);
    expect(lean).toBeGreaterThan(0.5); // ~30°+ into the turn
  });

  it('S-turns hold the speed down on a steep slope', () => {
    const g = slope(32);
    const straight = new Board();
    const sturn = new Board();
    for (const b of [straight, sturn]) b.place(0, 0, 0, g);
    run(straight, g, idle, 12);
    for (let i = 0; i < 6; i++) run(sturn, g, { lean: i % 2 ? 1 : -1, press: 0, turn: true, jump: false }, 2);
    expect(sturn.speed).toBeLessThan(straight.speed * 0.6);
  });

  it('flies off a lip, lands straight, and crashes landing sideways', () => {
    const g = slope(15, 40);
    const b = new Board();
    b.place(0, 0, 0, g);
    const events = run(b, g, { ...idle, press: 1 }, 9);
    expect(events.some((e) => e.type === 'takeoff')).toBe(true);
    expect(events.some((e) => e.type === 'land')).toBe(true);

    const c = new Board();
    c.place(0, 0, 0, g);
    for (let t = 0; t < 8 && c.grounded; t += DT) c.step(DT, { ...idle, press: 1 }, g);
    expect(c.grounded).toBe(false);
    // Spin a quarter turn in the air and hold it.
    const ev: Array<{ type: string }> = [];
    for (let t = 0; t < 4; t += DT) {
      const spin = !c.grounded && Math.abs(c.spin) < Math.PI / 2;
      ev.push(...c.step(DT, { lean: spin ? 1 : 0, press: 0, turn: spin, jump: false }, g));
      if (ev.some((e) => e.type === 'land' || e.type === 'crash')) break;
    }
    expect(ev.some((e) => e.type === 'crash')).toBe(true);
  });

  it('the jump button pops off flat-ish ground', () => {
    const g = slope(5);
    const b = new Board();
    b.place(0, 0, 0, g);
    run(b, g, { ...idle, jump: true }, 0.5);
    const events = run(b, g, idle, 3);
    expect(events[0]?.type).toBe('takeoff');
    expect(events.some((e) => e.type === 'land')).toBe(true);
  });
});

describe('ski course', () => {
  const c = new Course();
  it('runs downhill from the start to the finish', () => {
    const top = c.height(c.centerX(START_Z), START_Z);
    const bottom = c.height(c.centerX(FINISH_Z), FINISH_Z);
    expect(top - bottom).toBeGreaterThan(400);
    for (let z = START_Z; z < COURSE_LENGTH - 20; z += 50) {
      expect(c.height(c.centerX(z + 50), z + 50)).toBeLessThan(c.height(c.centerX(z), z) + 3);
    }
  });

  it('is walled in: the edges rise above the channel', () => {
    for (const z of [600, 900, 1300]) {
      const mid = c.height(c.centerX(z), z);
      const w = c.halfWidth(z);
      expect(c.height(c.centerX(z) + w + 40, z)).toBeGreaterThan(mid + 10);
      expect(c.height(c.centerX(z) - w - 40, z)).toBeGreaterThan(mid + 10);
    }
  });

  it('starts on a ridge crest that falls away to both sides', () => {
    const z = 80;
    const crest = c.height(c.centerX(z), z);
    expect(c.height(c.centerX(z) + 30, z)).toBeLessThan(crest - 15);
    expect(c.height(c.centerX(z) - 30, z)).toBeLessThan(crest - 15);
  });

  it('has cliff bands with gaps: a sheer drop in places, a rideable ramp in others', () => {
    let sheer = 0;
    let ramp = 0;
    const b = c.bands[1];
    for (let dx = -200; dx <= 200; dx += 4) {
      const x = c.centerX(b.z) + dx;
      // Steepest 2 m step through the band at this x.
      let steepest = 0;
      for (let z = b.z - 40; z < b.z + 40; z += 1) steepest = Math.max(steepest, c.height(x, z) - c.height(x, z + 2));
      if (steepest > 6) sheer++;
      else if (steepest < 3) ramp++;
    }
    expect(sheer).toBeGreaterThan(30);
    expect(ramp).toBeGreaterThan(10);
  });

  it('keeps the middle line free of rocks and trees', () => {
    for (const o of c.obstacles) expect(Math.abs(o.x - c.centerX(o.z))).toBeGreaterThan(1.5);
  });
});
