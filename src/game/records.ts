// Personal bests, kept in this browser only (localStorage may be unavailable, e.g. private mode).

const KEY = 'sniper.records.v1';

/** One harvested animal, for the kill log in the cabin. */
export interface HarvestEntry {
  at: string; // ISO date
  buck: boolean;
  grade: string;
  score: number;
  range: number;
  category: string;
}

export interface Records {
  bestAnimal: number | null;
  bestSession: number | null;
  harvests: number;
  log: HarvestEntry[]; // newest first
}

const LOG_LIMIT = 50;
const EMPTY: Records = { bestAnimal: null, bestSession: null, harvests: 0, log: [] };

export function loadRecords(): Records {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...EMPTY, ...JSON.parse(raw) } : { ...EMPTY, log: [] };
  } catch {
    return { ...EMPTY, log: [] };
  }
}

function save(r: Records) {
  try {
    localStorage.setItem(KEY, JSON.stringify(r));
  } catch {
    // Storage unavailable: records simply are not kept.
  }
}

/** Records a harvested animal; returns true if its score is a new personal best. */
export function recordHarvest(entry: HarvestEntry): boolean {
  const r = loadRecords();
  r.harvests += 1;
  r.log = [entry, ...r.log].slice(0, LOG_LIMIT);
  const best = r.bestAnimal === null || entry.score > r.bestAnimal;
  if (best) r.bestAnimal = entry.score;
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
