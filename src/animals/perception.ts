// Deer senses: sight and hearing (no smell, by design). Pure functions so they can be tested.
// Detection is gradual: senses add "suspicion" per second; thresholds trigger alert and flight.

export interface PlayerSignal {
  x: number;
  y: number; // eye height in world
  z: number;
  prone: boolean;
  speed: number; // m/s over ground
  running: boolean;
}

export interface DeerSenses {
  x: number;
  y: number; // eye height in world
  z: number;
  yaw: number; // facing, Three.js convention (0 looks toward -z... see headingVector)
  headDown: boolean; // grazing: much less watchful
}

export const SENSES = {
  sightRange: 160, // m at which a standing, walking person is just noticeable
  blindArc: (60 * Math.PI) / 180, // directly behind the deer (total width)
  aboveAngle: (8 * Math.PI) / 180, // deer rarely look up: beyond this, sight is reduced
  aboveFactor: 0.4,
  proneFactor: 0.35,
  stillFactor: 0.3, // deer key on movement
  runFactor: 1.5,
  grazingFactor: 0.45,
  sightRate: 2.5, // suspicion per second at point-blank
  hearing: { prone: 12, walk: 35, run: 85 }, // m
  hearingRate: 1.5,
  alertAt: 1,
  fleeAt: 2.2,
  decay: 0.35, // suspicion lost per second without stimulus
} as const;

/** Unit facing vector in the xz-plane for a Three.js yaw (rotation.y), where local +z is forward. */
export function headingVector(yaw: number): { x: number; z: number } {
  return { x: Math.sin(yaw), z: Math.cos(yaw) };
}

/** Effective sight range for this player, before line of sight and field of view. */
export function sightRange(deer: DeerSenses, p: PlayerSignal): number {
  let r = SENSES.sightRange;
  if (p.prone) r *= SENSES.proneFactor;
  if (p.speed < 0.2) r *= SENSES.stillFactor;
  else if (p.running) r *= SENSES.runFactor;
  if (deer.headDown) r *= SENSES.grazingFactor;
  const flat = Math.hypot(p.x - deer.x, p.z - deer.z);
  if (Math.atan2(p.y - deer.y, flat) > SENSES.aboveAngle) r *= SENSES.aboveFactor;
  return r;
}

/** Suspicion per second from seeing the player (0 if unseen). `clearLine` is terrain line of sight. */
export function sightRate(deer: DeerSenses, p: PlayerSignal, clearLine: boolean): number {
  if (!clearLine) return 0;
  const dx = p.x - deer.x;
  const dz = p.z - deer.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) return SENSES.sightRate;
  const f = headingVector(deer.yaw);
  const cosAngle = (dx * f.x + dz * f.z) / d;
  if (Math.acos(Math.max(-1, Math.min(1, cosAngle))) > Math.PI - SENSES.blindArc / 2) return 0;
  const r = sightRange(deer, p);
  return d >= r ? 0 : SENSES.sightRate * (1 - d / r);
}

export function noiseRadius(p: PlayerSignal): number {
  if (p.speed < 0.2) return 0;
  if (p.prone) return SENSES.hearing.prone;
  return p.running ? SENSES.hearing.run : SENSES.hearing.walk;
}

/** Suspicion per second from hearing the player's movement. */
export function hearingRate(deer: DeerSenses, p: PlayerSignal): number {
  const r = noiseRadius(p);
  const d = Math.hypot(p.x - deer.x, p.y - deer.y, p.z - deer.z);
  return d >= r ? 0 : SENSES.hearingRate * (1 - d / r);
}
