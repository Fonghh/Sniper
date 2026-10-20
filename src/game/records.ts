// Personal bests, kept in this browser only (localStorage may be unavailable, e.g. private mode).

const KEY = 'sniper.records.v1';

export interface Records {
  bestAnimal: number | null;
  bestSession: number | null;
  harvests: number;
}

const EMPTY: Records = { bestAnimal: null, bestSession: null, harvests: 0 };

export function loadRecords(): Records {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...EMPTY, ...JSON.parse(raw) } : { ...EMPTY };
  } catch {
    return { ...EMPTY };
  }
}

function save(r: Records) {
  try {
    localStorage.setItem(KEY, JSON.stringify(r));
  } catch {
    // Storage unavailable: records simply are not kept.
  }
}

/** Records a harvested animal's score; returns true if it is a new personal best. */
export function recordHarvest(score: number): boolean {
  const r = loadRecords();
  r.harvests += 1;
  const best = r.bestAnimal === null || score > r.bestAnimal;
  if (best) r.bestAnimal = score;
  save(r);
  return best;
}

/** Records a finished hunt's total; returns true if it is a new personal best. */
export function recordSession(total: number): boolean {
  const r = loadRecords();
  const best = r.bestSession === null || total > r.bestSession;
  if (best) r.bestSession = total;
  save(r);
  return best;
}
