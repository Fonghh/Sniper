import { describe, expect, it } from 'vitest';
import { BLOOD_SPACING, bloodTypeFor, worstCategory } from '../src/tracking/signs';
import { SignBook, TrailRecorder } from '../src/tracking/trail';

function walk(rec: TrailRecorder, metres: number, speed = 10) {
  for (let d = 0; d <= metres; d += 0.5) rec.update(0, 0, d, 0, speed, false);
}

describe('blood signs', () => {
  it('maps wounds to the blood a hunter would find', () => {
    expect(bloodTypeFor('lungs')).toBe('frothy');
    expect(bloodTypeFor('heart')).toBe('bright');
    expect(bloodTypeFor('liver')).toBe('dark');
    expect(bloodTypeFor('gut')).toBe('gut');
    expect(bloodTypeFor('muscle')).toBe('sparse');
    expect(bloodTypeFor('cns')).toBeNull();
  });

  it('the worst wound decides', () => {
    expect(worstCategory(['gut', 'lungs', 'muscle'])).toBe('lungs');
    expect(worstCategory([])).toBeNull();
  });

  it('heavier bleeding leaves a denser trail', () => {
    const count = (blood: 'bright' | 'gut') => {
      const book = new SignBook();
      const rec = new TrailRecorder(0, (s) => book.add(s));
      rec.hit(0, 0, 0, blood);
      walk(rec, 60);
      return book.signs.filter((s) => s.kind === 'blood').length;
    };
    expect(count('bright')).toBeGreaterThan(count('gut') * 3);
    expect(count('gut')).toBeGreaterThanOrEqual(Math.floor(60 / BLOOD_SPACING.gut) - 1);
  });

  it('hoof tracks keep even a thin trail followable, and bedding leaves a pool', () => {
    const book = new SignBook();
    const rec = new TrailRecorder(0, (s) => book.add(s));
    rec.hit(0, 0, 0, 'gut');
    walk(rec, 40);
    rec.update(0, 0, 40, 0, 0, true);
    const kinds = book.signs.map((s) => s.kind);
    expect(kinds[0]).toBe('hitSite');
    expect(kinds.filter((k) => k === 'track').length).toBeGreaterThanOrEqual(9);
    expect(kinds[kinds.length - 1]).toBe('bed');
  });
});

describe('tracking', () => {
  function trail() {
    const book = new SignBook();
    const rec = new TrailRecorder(0, (s) => book.add(s));
    rec.hit(0, 0, 0, 'frothy');
    walk(rec, 80);
    return book;
  }

  it('nothing is pointed out until the hit site is found', () => {
    const book = trail();
    expect(book.nextClues()).toEqual([]);
    book.discover(0, 0);
    expect(book.nextClues().length).toBe(1);
  });

  it('the next clue is only one step ahead of what was found, never the end of the trail', () => {
    const book = trail();
    book.discover(0, 0);
    const next = book.nextClues()[0];
    const last = book.signs[book.signs.length - 1];
    expect(next.z).toBeLessThan(15);
    expect(next.seq).toBeLessThan(last.seq);
    // Following it moves the pointer along.
    book.discover(next.x, next.z);
    expect(book.nextClues()[0].z).toBeGreaterThan(next.z);
  });

  it('signs are only noticed up close', () => {
    const book = trail();
    expect(book.discover(0, -30)).toEqual([]);
    expect(book.discover(0, -2).length).toBeGreaterThan(0);
  });
});
