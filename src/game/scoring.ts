import type { HitCategory } from '../animals/physiology';

// Ethical-hunting score for one animal: rewards a well-placed first shot, a quick death and
// distance; penalises follow-up shots and poor placement. A wounded animal that is never
// recovered costs points at the end of the hunt.

export interface ShotRecord {
  category: HitCategory;
  range: number; // m
  time: number; // game time of the hit
}

export interface AnimalRecord {
  shots: ShotRecord[];
  /** Game time it went down, or null if still on its feet. */
  downAt: number | null;
  /** Metres between the first hit and where it went down. */
  runDistance: number;
}

export interface ScoreLine {
  key: 'placement' | 'distance' | 'quickKill' | 'extraShots' | 'poorFirst';
  points: number;
}

export type Grade = 'S' | 'A' | 'B' | 'C' | 'D';

export interface AnimalScore {
  lines: ScoreLine[];
  total: number;
  grade: Grade;
  timeToDown: number | null;
}

/** Points for where the first bullet landed. Heart and lungs are the ethical target. */
export const PLACEMENT: Record<HitCategory, number> = {
  heart: 100,
  lungs: 100,
  cns: 70, // instant, but a small target with a high risk of a bad wound
  hip: 60, // anchors a deer facing away; a fair shot, not the ideal one
  liver: 45,
  gut: 0,
  leg: 0,
  muscle: 0,
};

export const UNRECOVERED_PENALTY = -100;

export function gradeFor(total: number): Grade {
  if (total >= 230) return 'S';
  if (total >= 170) return 'A';
  if (total >= 110) return 'B';
  if (total >= 50) return 'C';
  return 'D';
}

export function scoreAnimal(r: AnimalRecord): AnimalScore {
  const first = r.shots[0];
  const lines: ScoreLine[] = [];
  lines.push({ key: 'placement', points: PLACEMENT[first.category] });
  lines.push({ key: 'distance', points: Math.round(Math.min(first.range, 450) / 10) });
  const timeToDown = r.downAt === null ? null : Math.max(0, r.downAt - first.time);
  if (timeToDown !== null) {
    const quick = timeToDown <= 10 ? 50 : timeToDown <= 30 ? 30 : timeToDown <= 120 ? 10 : 0;
    if (quick) lines.push({ key: 'quickKill', points: quick });
  }
  if (r.shots.length > 1) lines.push({ key: 'extraShots', points: -20 * (r.shots.length - 1) });
  if (first.category === 'gut' || first.category === 'leg') lines.push({ key: 'poorFirst', points: -30 });
  const total = lines.reduce((s, l) => s + l.points, 0);
  return { lines, total, grade: gradeFor(total), timeToDown };
}

/** Session total: harvested animals' scores plus a penalty per wounded animal left behind. */
export function sessionTotal(harvested: AnimalScore[], unrecoveredWounded: number): number {
  return harvested.reduce((s, a) => s + a.total, 0) + unrecoveredWounded * UNRECOVERED_PENALTY;
}
