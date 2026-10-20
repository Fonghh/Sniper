import { BLOOD_SPACING, BloodType, HIGHLIGHT_RADIUS, NOTICE_RADIUS, Sign, SignKind, TRACK_SPACING } from './signs';

/**
 * Records the signs one wounded deer leaves as it moves: the hit site, blood at a spacing set
 * by the wound, hoof tracks, and a pool where it beds down.
 */
export class TrailRecorder {
  blood: BloodType | null = null;
  private sinceBlood = 0;
  private sinceTrack = 0;
  private last: { x: number; z: number } | null = null;
  private seq = 0;
  private bedded = false;

  constructor(
    private deerId: number,
    private emit: (sign: Omit<Sign, 'id'>) => void,
  ) {}

  private push(kind: SignKind, x: number, y: number, z: number, heading: number, running: boolean) {
    this.emit({
      deerId: this.deerId,
      seq: this.seq++,
      kind,
      blood: kind === 'track' ? null : this.blood,
      x, y, z, heading, running,
      discovered: false,
    });
  }

  /** Called when the deer is hit; `blood` is the worst wound's blood type so far. */
  hit(x: number, y: number, z: number, blood: BloodType | null) {
    this.blood = blood;
    this.push('hitSite', x, y, z, 0, false);
    this.last = { x, z };
    this.sinceBlood = 0;
    this.sinceTrack = 0;
  }

  /** Feed the deer's position every frame while it is wounded. */
  update(x: number, y: number, z: number, heading: number, speed: number, bedded: boolean) {
    if (!this.last) return;
    const step = Math.hypot(x - this.last.x, z - this.last.z);
    this.last = { x, z };
    if (bedded && !this.bedded) this.push('bed', x, y, z, heading, false);
    this.bedded = bedded;
    if (step === 0) return;
    const running = speed > 4;
    this.sinceTrack += step;
    if (this.sinceTrack >= TRACK_SPACING) {
      this.sinceTrack = 0;
      this.push('track', x, y, z, heading, running);
    }
    if (this.blood) {
      this.sinceBlood += step;
      if (this.sinceBlood >= BLOOD_SPACING[this.blood]) {
        this.sinceBlood = 0;
        this.push('blood', x, y, z, heading, running);
      }
    }
  }
}

/** All signs in the world, plus discovery and "next clue" logic for tracking mode. */
export class SignBook {
  readonly signs: Sign[] = [];
  private nextId = 0;

  add(sign: Omit<Sign, 'id'>): Sign {
    const s = { ...sign, id: this.nextId++ };
    this.signs.push(s);
    return s;
  }

  /** Marks signs within notice range as discovered; returns the newly discovered ones. */
  discover(px: number, pz: number): Sign[] {
    const found: Sign[] = [];
    for (const s of this.signs) {
      if (s.discovered) continue;
      if (Math.hypot(s.x - px, s.z - pz) <= NOTICE_RADIUS) {
        s.discovered = true;
        found.push(s);
      }
    }
    return found;
  }

  /** Signs bright enough to see in tracking mode. */
  visible(px: number, pz: number): Sign[] {
    return this.signs.filter((s) => Math.hypot(s.x - px, s.z - pz) <= HIGHLIGHT_RADIUS);
  }

  /**
   * The clue that leads on from what has been found: for each trail, the first undiscovered
   * sign after the furthest discovered one. Only points one step ahead, never at the deer.
   */
  nextClues(): Sign[] {
    const byDeer = new Map<number, Sign[]>();
    for (const s of this.signs) {
      const list = byDeer.get(s.deerId) ?? [];
      list.push(s);
      byDeer.set(s.deerId, list);
    }
    const out: Sign[] = [];
    for (const list of byDeer.values()) {
      list.sort((a, b) => a.seq - b.seq);
      let furthest = -1;
      for (const s of list) if (s.discovered) furthest = Math.max(furthest, s.seq);
      if (furthest < 0) continue;
      const next = list.find((s) => s.seq > furthest && !s.discovered);
      if (next) out.push(next);
    }
    return out;
  }
}
