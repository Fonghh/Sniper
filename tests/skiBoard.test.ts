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
    expect(skid.skid).toBeGreaterThan(0.5);
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
    const events = run(b, g, idle, 1.5);
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
    for (const z of [200, 600, 1000]) {
      const mid = c.height(c.centerX(z), z);
      const w = c.halfWidth(z);
      expect(c.height(c.centerX(z) + w + 25, z)).toBeGreaterThan(mid + 10);
      expect(c.height(c.centerX(z) - w - 25, z)).toBeGreaterThan(mid + 10);
    }
  });

  it('keeps the couloir line free of rocks and trees', () => {
    for (const o of c.obstacles) expect(Math.abs(o.x - c.centerX(o.z))).toBeGreaterThan(1.5);
  });
});
