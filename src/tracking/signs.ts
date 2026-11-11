import type { HitCategory } from '../animals/physiology';

// Sign left by a wounded animal. Blood character tells an experienced hunter what was hit:
// lungs → pink and frothy, heart/arteries → bright and heavy, liver → dark red,
// gut → mixed with stomach contents, muscle/leg → sparse bright drops.

export type BloodType = 'frothy' | 'bright' | 'dark' | 'gut' | 'sparse';
export type SignKind = 'hitSite' | 'blood' | 'track' | 'bed';

export interface Sign {
  id: number;
  deerId: number;
  /** Order along this deer's trail, starting at 0 for the hit site. */
  seq: number;
  kind: SignKind;
  blood: BloodType | null;
  x: number;
  y: number;
  z: number;
  /** Travel direction (Three.js yaw) for hoof tracks. */
  heading: number;
  /** Running when the sign was left (long strides). */
  running: boolean;
  discovered: boolean;
}

const SEVERITY: HitCategory[] = ['cns', 'heart', 'lungs', 'hip', 'liver', 'gut', 'leg', 'muscle'];

/** The most serious of several wounds decides the trail's character. */
export function worstCategory(categories: HitCategory[]): HitCategory | null {
  let best: HitCategory | null = null;
  for (const c of categories) if (best === null || SEVERITY.indexOf(c) < SEVERITY.indexOf(best)) best = c;
  return best;
}

export function bloodTypeFor(category: HitCategory): BloodType | null {
  switch (category) {
    case 'cns':
      return null; // drops on the spot
    case 'heart':
    case 'hip': // femoral arteries
      return 'bright';
    case 'lungs':
      return 'frothy';
    case 'liver':
      return 'dark';
    case 'gut':
      return 'gut';
    default:
      return 'sparse';
  }
}

/** Metres between blood signs: heavy bleeding leaves a dense trail, a gut shot very little. */
export const BLOOD_SPACING: Record<BloodType, number> = {
  bright: 1.5,
  frothy: 2.5,
  dark: 4,
  sparse: 7,
  gut: 9,
};

/** Hoof tracks of the wounded deer are left this often, so even a thin blood trail can be followed. */
export const TRACK_SPACING = 4;

/** How close (m) the hunter must be, in tracking mode, to notice a sign. */
export const NOTICE_RADIUS = 6;
/** Signs are highlighted within this radius in tracking mode. */
export const HIGHLIGHT_RADIUS = 35;
