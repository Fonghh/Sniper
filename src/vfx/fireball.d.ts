import type * as THREE from 'three';

/** Handle returned by the fireball VFX module (see fireball.js header for the lifecycle). */
export interface VFXHandle {
  readonly group: THREE.Group;
  update(deltaSeconds: number): void;
  /** Plays the impact at a world point (front of the flame is moved onto it). */
  hit(worldPosition?: THREE.Vector3, worldNormal?: THREE.Vector3): void;
  /** Lets the effect wind down naturally (no impact burst). */
  stop(): void;
  reset(): void;
  dispose(): void;
  setOptions(options: VFXOptions): void;
  setDirection(vector: THREE.Vector3, speed?: number): void;
  readonly finished: boolean;
  readonly phase: 'starting' | 'active' | 'ending' | 'finished';
}

export interface VFXOptions {
  size?: number;
  speed?: number;
  detail?: number;
  color?: string;
  density?: number;
}

export const defaultOptions: Required<VFXOptions>;
export default function createVFX(options?: VFXOptions): VFXHandle;
