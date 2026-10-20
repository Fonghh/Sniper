import { describe, expect, it } from 'vitest';
import { UNRECOVERED_PENALTY, scoreAnimal, sessionTotal } from '../src/game/scoring';

describe('scoring', () => {
  it('a clean one-shot heart kill at 300 m earns the top grade', () => {
    const s = scoreAnimal({ shots: [{ category: 'heart', range: 300, time: 10 }], downAt: 17, runDistance: 60 });
    expect(s.total).toBe(100 + 30 + 50);
    expect(s.grade).toBe('A');
    const far = scoreAnimal({ shots: [{ category: 'lungs', range: 400, time: 0 }], downAt: 8, runDistance: 40 });
    expect(far.grade).toBe('A');
  });

  it('a gut shot finished with follow-ups scores poorly', () => {
    const s = scoreAnimal({
      shots: [
        { category: 'gut', range: 280, time: 0 },
        { category: 'lungs', range: 120, time: 90 },
      ],
      downAt: 120,
      runDistance: 180,
    });
    expect(s.total).toBeLessThan(50);
    expect(s.grade).toBe('D');
    expect(s.lines.map((l) => l.key)).toEqual(expect.arrayContaining(['extraShots', 'poorFirst']));
  });

  it('heart and lungs beat a liver hit, which beats a gut hit', () => {
    const at = (category: 'heart' | 'liver' | 'gut') =>
      scoreAnimal({ shots: [{ category, range: 250, time: 0 }], downAt: null, runDistance: 0 }).total;
    expect(at('heart')).toBeGreaterThan(at('liver'));
    expect(at('liver')).toBeGreaterThan(at('gut'));
  });

  it('leaving a wounded deer behind costs points', () => {
    const clean = scoreAnimal({ shots: [{ category: 'heart', range: 300, time: 0 }], downAt: 6, runDistance: 40 });
    expect(sessionTotal([clean], 1)).toBe(clean.total + UNRECOVERED_PENALTY);
  });
});
