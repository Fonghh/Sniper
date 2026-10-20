// Ammunition definitions. BC values are G7 in lb/in² (the conventional unit).

export type BulletType = 'softPoint' | 'fmj';

export interface Ammo {
  id: string;
  name: string;
  type: BulletType;
  massKg: number;
  diameterM: number;
  bcG7: number;
  muzzleVelocity: number; // m/s
}

const GRAIN_TO_KG = 6.479891e-5;

export const AMMO: Record<string, Ammo> = {
  '308-sp-165': {
    id: '308-sp-165',
    name: '.308 軟尖擴張彈 165gr',
    type: 'softPoint',
    massKg: 165 * GRAIN_TO_KG,
    diameterM: 0.00782,
    bcG7: 0.209,
    muzzleVelocity: 805,
  },
  '308-fmj-147': {
    id: '308-fmj-147',
    name: '.308 全金屬被甲彈 147gr',
    type: 'fmj',
    massKg: 147 * GRAIN_TO_KG,
    diameterM: 0.00782,
    bcG7: 0.2,
    muzzleVelocity: 838,
  },
};
