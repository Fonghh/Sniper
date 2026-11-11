// Rifle stability: breathing, heart rate, breath holding and the resulting sway.
// Pure logic, independent of rendering, so it can be unit-tested.

export type Stance = 'stand' | 'prone';

export const STABILITY = {
  restingHeartRate: 70,
  maxHeartRate: 150,
  heartRiseRate: 18, // bpm per second while running
  heartRecoveryTau: 2.2, // s; ≈ 6–7 s to settle after a sprint
  holdMax: 6, // s of breath hold from full stamina
  holdRecoverRate: 0.25, // stamina per second while breathing
  holdMinToStart: 0.15,
  exhaustedTime: 3, // s of heavy breathing after running out of breath
  // Base sway amplitude in radians (≈ how far the reticle wanders).
  amplitude: { stand: 0.0035, standRested: 0.0013, prone: 0.0009 },
  holdFactor: 0.3,
  exhaustedFactor: 1.8,
} as const;

export class Stability {
  heartRate: number = STABILITY.restingHeartRate;
  stamina = 1; // breath-hold reserve 0..1
  holding = false;
  exhausted = 0; // seconds of exhaustion remaining
  private time = 0;

  /** Starts a breath hold if there is enough reserve. Returns whether it started. */
  startHold(): boolean {
    if (this.exhausted > 0 || this.stamina < STABILITY.holdMinToStart) return false;
    this.holding = true;
    return true;
  }

  endHold() {
    this.holding = false;
  }

  update(dt: number, running: boolean) {
    this.time += dt;
    const s = STABILITY;
    if (running) {
      this.heartRate = Math.min(s.maxHeartRate, this.heartRate + s.heartRiseRate * dt);
    } else {
      this.heartRate = s.restingHeartRate + (this.heartRate - s.restingHeartRate) * Math.exp(-dt / s.heartRecoveryTau);
    }
    if (this.exhausted > 0) this.exhausted = Math.max(0, this.exhausted - dt);
    if (this.holding) {
      this.stamina -= dt / s.holdMax;
      if (this.stamina <= 0) {
        this.stamina = 0;
        this.holding = false;
        this.exhausted = s.exhaustedTime;
      }
    } else {
      this.stamina = Math.min(1, this.stamina + s.holdRecoverRate * dt);
    }
  }

  /** Overall sway amplitude in radians for the current posture and body state. */
  amplitude(stance: Stance, rested: boolean): number {
    const s = STABILITY;
    let a = stance === 'prone' ? s.amplitude.prone : rested ? s.amplitude.standRested : s.amplitude.stand;
    const heart = (this.heartRate - s.restingHeartRate) / (s.maxHeartRate - s.restingHeartRate);
    a *= 1 + 1.5 * heart;
    if (this.holding) a *= s.holdFactor;
    if (this.exhausted > 0) a *= s.exhaustedFactor;
    return a;
  }

  /** Current reticle offset (yaw, pitch) in radians. Smooth, bounded by ≈1.5× amplitude. */
  offset(stance: Stance, rested: boolean): { yaw: number; pitch: number } {
    const a = this.amplitude(stance, rested);
    const t = this.time;
    // Slow figure-eight drift plus a breathing rise/fall (suppressed while holding).
    const breath = this.holding ? 0 : 0.6 * Math.sin(t * Math.PI * 2 * 0.25);
    const beat = 0.15 * Math.max(0, Math.sin(t * Math.PI * 2 * (this.heartRate / 60))) ** 8;
    return {
      yaw: a * (0.7 * Math.sin(t * 0.9 + 1.3) + 0.3 * Math.sin(t * 2.3)),
      pitch: a * (0.4 * Math.sin(t * 1.3) + breath * 0.5 + beat - 0.0),
    };
  }
}
