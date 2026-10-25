import { beforeEach, describe, expect, it } from 'vitest';
import { loadRecords, recordHarvest, recordSession } from '../src/game/records';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../src/game/settings';

// Minimal in-memory localStorage for the node test environment.
beforeEach(() => {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  };
});

const entry = (score: number) => ({ at: '2026-10-20', buck: false, grade: 'A', score, range: 300, category: 'heart' });

describe('records', () => {
  it('tracks personal bests and keeps the newest harvests first', () => {
    expect(recordHarvest(entry(120))).toBe(true);
    expect(recordHarvest(entry(90))).toBe(false);
    expect(recordHarvest(entry(200))).toBe(true);
    const r = loadRecords();
    expect(r.bestAnimal).toBe(200);
    expect(r.harvests).toBe(3);
    expect(r.log.map((e) => e.score)).toEqual([200, 90, 120]);
    expect(recordSession(300)).toBe(true);
    expect(recordSession(100)).toBe(false);
  });

  it('works without storage', () => {
    (globalThis as unknown as { localStorage: unknown }).localStorage = undefined;
    expect(loadRecords().harvests).toBe(0);
    expect(recordHarvest(entry(50))).toBe(true);
  });
});

describe('settings', () => {
  it('defaults, then remembers changes', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    saveSettings({ ...DEFAULT_SETTINGS, bulletCam: false });
    expect(loadSettings().bulletCam).toBe(false);
  });
});
