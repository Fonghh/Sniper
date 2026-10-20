import { ZERO_STEPS } from '../game/rifle';
import { STRINGS } from '../i18n';
import type { Actions } from '../input/input';

const $ = (id: string) => document.getElementById(id)!;

export interface HudState {
  scoped: boolean;
  prone: boolean;
  rested: boolean;
  cycling: boolean;
  zeroIndex: number;
  magnification: number;
  stamina: number;
  exhausted: boolean;
  heartRate: number;
  rangeText: string;
}

/**
 * On-screen controls and scope overlay for portrait play. Both thumbs stay in the lower
 * half: joystick bottom-left, fire bottom-right with the zero slider above it, and the
 * small mode buttons in a column at mid-right.
 */
export class Hud {
  private scopeBtn = $('btn-scope');
  private stanceBtn = $('btn-stance');
  private fireBtn = $('btn-fire');
  private zeroTrack = $('zero-track');
  private zeroThumb = $('zero-thumb');
  private zeroLabel = $('zero-label');
  private magBtn = $('btn-mag');
  private scope = $('scope');
  private reticle = $('reticle') as unknown as SVGSVGElement;
  private range = $('scope-range');
  private breath = $('breath-fill');
  private status = $('status');
  private toast = $('toast');
  private toastTimer = 0;
  private lastZero = -1;
  private lastReticleKey = '';

  constructor(private actions: Actions) {
    this.scopeBtn.textContent = STRINGS.scopeOn;
    $('btn-track').textContent = STRINGS.track;
    this.fireBtn.textContent = STRINGS.fire;
    const tap = (el: HTMLElement, fn: () => void) =>
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        fn();
      });
    tap(this.scopeBtn, () => actions.toggleScope());
    tap(this.stanceBtn, () => actions.toggleStance());
    tap(this.magBtn, () => actions.cycleMagnification());
    this.bindFire();
    this.bindZeroSlider();
  }

  /** Press = hold breath, release on the button = fire, slide off then release = cancel. */
  private bindFire() {
    const btn = this.fireBtn;
    let active: number | null = null;
    let inside = false;
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      active = e.pointerId;
      inside = true;
      btn.setPointerCapture(e.pointerId);
      btn.classList.add('held');
      this.actions.beginShot();
    });
    btn.addEventListener('pointermove', (e) => {
      if (e.pointerId !== active) return;
      const r = btn.getBoundingClientRect();
      inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      btn.classList.toggle('cancel', !inside);
    });
    const end = (e: PointerEvent, cancelled: boolean) => {
      if (e.pointerId !== active) return;
      active = null;
      btn.classList.remove('held', 'cancel');
      this.actions.releaseShot(inside && !cancelled);
    };
    btn.addEventListener('pointerup', (e) => end(e, false));
    btn.addEventListener('pointercancel', (e) => end(e, true));
  }

  /** Vertical slider snapping to 50 m steps; drag up for longer zero. */
  private bindZeroSlider() {
    const track = this.zeroTrack;
    let active: number | null = null;
    const apply = (clientY: number) => {
      const r = track.getBoundingClientRect();
      const t = 1 - Math.min(Math.max((clientY - r.top) / r.height, 0), 1);
      const idx = Math.round(t * (ZERO_STEPS.length - 1));
      // Translate the absolute position into a relative step for the shared action.
      const delta = idx - Math.max(this.lastZero, 0);
      if (delta !== 0) this.actions.stepZero(delta);
    };
    track.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      active = e.pointerId;
      track.setPointerCapture(e.pointerId);
      apply(e.clientY);
    });
    track.addEventListener('pointermove', (e) => {
      if (e.pointerId === active) apply(e.clientY);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId === active) active = null;
    };
    track.addEventListener('pointerup', end);
    track.addEventListener('pointercancel', end);
  }

  showToast(text: string, seconds = 3) {
    this.toast.textContent = text;
    this.toast.classList.add('show');
    this.toastTimer = seconds;
  }

  update(dt: number, s: HudState, fovDeg: number, viewHeightPx: number) {
    document.body.classList.toggle('scoped', s.scoped);
    this.scopeBtn.textContent = s.scoped ? STRINGS.scopeOff : STRINGS.scopeOn;
    this.stanceBtn.textContent = s.prone ? STRINGS.stand : STRINGS.prone;

    if (s.zeroIndex !== this.lastZero) {
      this.lastZero = s.zeroIndex;
      const t = s.zeroIndex / (ZERO_STEPS.length - 1);
      this.zeroThumb.style.bottom = `${t * 100}%`;
      this.zeroLabel.textContent = STRINGS.zero(ZERO_STEPS[s.zeroIndex]);
    }
    this.magBtn.textContent = `${s.magnification}x`;
    this.range.textContent = s.rangeText;
    this.breath.style.width = `${s.stamina * 100}%`;
    this.breath.classList.toggle('exhausted', s.exhausted);
    this.fireBtn.classList.toggle('cycling', s.cycling);

    const tags: string[] = [];
    if (s.rested && s.scoped) tags.push(STRINGS.rested);
    if (s.cycling) tags.push(STRINGS.cycling);
    if (s.heartRate > 90) tags.push(STRINGS.heart(s.heartRate));
    this.status.textContent = tags.join(' · ');

    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toast.classList.remove('show');
    }
    if (s.scoped) this.drawReticle(fovDeg, viewHeightPx);
  }

  /** First-focal-plane mil reticle: hash marks scale with magnification. */
  private drawReticle(fovDeg: number, heightPx: number) {
    const w = this.scope.clientWidth;
    const h = this.scope.clientHeight;
    const key = `${fovDeg}|${w}|${h}`;
    if (key === this.lastReticleKey) return;
    this.lastReticleKey = key;
    const pxPerMil = (heightPx / 2 / Math.tan(((fovDeg / 2) * Math.PI) / 180)) * 0.001;
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(w, h) * 0.46;
    this.scope.style.setProperty('--r', `${radius}px`);
    const lines: string[] = [];
    const line = (x1: number, y1: number, x2: number, y2: number, sw: number) =>
      lines.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke-width="${sw}"/>`);
    const inner = Math.min(radius * 0.55, 5.5 * pxPerMil);
    // Thin crosshair near the centre, thick posts toward the edge (duplex).
    line(cx - inner, cy, cx + inner, cy, 1);
    line(cx, cy - inner, cx, cy + inner, 1);
    line(cx - radius, cy, cx - inner, cy, 4);
    line(cx + inner, cy, cx + radius, cy, 4);
    line(cx, cy + inner, cx, cy + radius, 4);
    line(cx, cy - radius, cx, cy - inner, 4);
    // Hash marks are skipped at low power where they would crowd into a blob.
    const showHashes = pxPerMil >= 7;
    for (let m = 1; m <= 5 && showHashes; m++) {
      const y = cy + m * pxPerMil;
      if (y - cy > inner) break;
      const half = m % 2 === 0 ? 9 : 5;
      line(cx - half, y, cx + half, y, 1);
    }
    for (let m = 1; m <= 4 && showHashes; m++) {
      for (const sgn of [-1, 1]) {
        const x = cx + sgn * m * pxPerMil;
        if (Math.abs(x - cx) > inner) continue;
        line(x, cy - 4, x, cy + 4, 1);
      }
    }
    this.reticle.setAttribute('viewBox', `0 0 ${w} ${h}`);
    this.reticle.innerHTML = `<g stroke="#111" stroke-linecap="square">${lines.join('')}</g>`;
  }
}
