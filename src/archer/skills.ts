// Skill cards picked between waves, and the bow stats they add up to. Pure.

export type SkillId =
  | 'rapid'
  | 'power'
  | 'multishot'
  | 'diagonal'
  | 'pierce'
  | 'fire'
  | 'frost'
  | 'poison'
  | 'lightning'
  | 'explosive'
  | 'crossbow'
  | 'giant'
  | 'crit'
  | 'heal';

export interface Skill {
  id: SkillId;
  name: string;
  text: string;
  icon: string;
  color: string;
  /** How many times it can be taken (heal is unlimited). */
  max: number;
}

export const SKILLS: Record<SkillId, Skill> = {
  rapid: { id: 'rapid', name: '連射', text: '射速 +30%', icon: '⚡', color: '#3fb7ff', max: 5 },
  power: { id: 'power', name: '強力', text: '傷害 +40%', icon: '💪', color: '#ff6a3d', max: 5 },
  multishot: { id: 'multishot', name: '多重箭', text: '每次多射 1 支箭', icon: '🏹', color: '#ffb02e', max: 3 },
  diagonal: { id: 'diagonal', name: '斜向箭', text: '左右斜向各多 1 支箭', icon: '↗', color: '#ffd23c', max: 2 },
  pierce: { id: 'pierce', name: '穿透', text: '箭可以多穿過 1 個敵人', icon: '➶', color: '#9ad0ff', max: 3 },
  fire: { id: 'fire', name: '火焰箭', text: '命中後燃燒，持續傷害', icon: '🔥', color: '#ff5a1f', max: 3 },
  frost: { id: 'frost', name: '冰霜箭', text: '減速；有機會整隻凍住', icon: '❄', color: '#7fd6ff', max: 3 },
  poison: { id: 'poison', name: '劇毒箭', text: '毒可疊加，越疊越痛', icon: '☠', color: '#8be04a', max: 3 },
  lightning: { id: 'lightning', name: '閃電箭', text: '命中後電擊附近 2 個敵人', icon: 'ϟ', color: '#c58bff', max: 3 },
  explosive: { id: 'explosive', name: '爆裂箭', text: '命中處小爆炸', icon: '💥', color: '#ff8a3d', max: 3 },
  crossbow: { id: 'crossbow', name: '十字弓', text: '換成十字弓：箭更快更平、傷害 +20%', icon: '✚', color: '#5a8bff', max: 1 },
  giant: { id: 'giant', name: '蓄力巨箭', text: '每第 5 支箭變成巨箭：4 倍傷害、全穿透', icon: '➹', color: '#ff4f9a', max: 2 },
  crit: { id: 'crit', name: '鷹眼', text: '暴擊率 +20%（暴擊 2.5 倍）', icon: '◎', color: '#ffe04a', max: 3 },
  heal: { id: 'heal', name: '補血', text: '回復 40% 血量，上限 +20', icon: '❤', color: '#ff4f6a', max: 99 },
};

export interface BowStats {
  interval: number; // s between volleys
  damage: number;
  arrows: number; // forward arrows per volley
  diagonal: number; // extra pairs at ±25°
  pierce: number;
  speed: number; // m/s launch speed
  drag: number;
  fire: number; // levels of each element
  frost: number;
  poison: number;
  lightning: number;
  explosive: number;
  giantEvery: number; // 0 = never
  crit: number; // chance
  crossbow: boolean;
}

export type Taken = Partial<Record<SkillId, number>>;

export function bowStats(taken: Taken): BowStats {
  const n = (id: SkillId) => taken[id] ?? 0;
  const crossbow = n('crossbow') > 0;
  return {
    interval: (crossbow ? 0.42 : 0.38) / (1 + 0.3 * n('rapid')),
    damage: 30 * (1 + 0.4 * n('power')) * (crossbow ? 1.2 : 1),
    arrows: 1 + n('multishot'),
    diagonal: n('diagonal'),
    pierce: n('pierce'),
    speed: crossbow ? 95 : 58,
    drag: crossbow ? 0.0008 : 0.0012,
    fire: n('fire'),
    frost: n('frost'),
    poison: n('poison'),
    lightning: n('lightning'),
    explosive: n('explosive'),
    giantEvery: n('giant') > 0 ? Math.max(3, 6 - n('giant')) : 0,
    crit: Math.min(0.9, 0.05 + 0.2 * n('crit')),
    crossbow,
  };
}

/** Three different cards still available, drawn with `rand`. */
export function drawCards(taken: Taken, rand: () => number, count = 3): SkillId[] {
  const pool = (Object.keys(SKILLS) as SkillId[]).filter((id) => (taken[id] ?? 0) < SKILLS[id].max);
  const out: SkillId[] = [];
  while (out.length < count && pool.length) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  return out;
}

/** Rank title shown at the top, by waves cleared. */
export function rankFor(cleared: number): string {
  const ranks: Array<[number, string]> = [
    [0, 'NOOB'], [2, 'APPRENTICE'], [4, 'PRO'], [7, 'HAWKEYE'], [10, 'PREDATOR'], [14, 'ARCHERO'],
  ];
  let r = ranks[0][1];
  for (const [w, name] of ranks) if (cleared >= w) r = name;
  return r;
}
