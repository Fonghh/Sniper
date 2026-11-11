import type { BoardInput } from './board';

// Portrait controls. Left thumb: a weight stick (up = press the nose, down = sit back,
// sideways = lean onto that edge). Right thumb: TURN (hold to throw the board sideways)
// and JUMP (hold to crouch, release to pop). Keyboard: WASD/arrows, Shift = turn, Space = jump.

const RADIUS = 56; // px of stick travel

export class SkiControls {
  readonly input: BoardInput = { lean: 0, press: 0, turn: false, jump: false };
  private stick = { x: 0, y: 0 };
  private stickPointer: number | null = null;
  private origin = { x: 0, y: 0 };
  private keys = new Set<string>();
  private turnTouch = false;
  private jumpTouch = false;
  onAny: () => void = () => {};

  constructor(area: HTMLElement, private base: HTMLElement, private knob: HTMLElement, turn: HTMLElement, jump: HTMLElement) {
    if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');
    addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      this.onAny();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    area.addEventListener('pointerdown', (e) => {
      const r = area.getBoundingClientRect();
      if (e.clientX > r.left + r.width * 0.55 || this.stickPointer !== null) return;
      this.onAny();
      this.stickPointer = e.pointerId;
      // The stick re-centres under the thumb (inside the left half).
      this.origin = { x: e.clientX, y: e.clientY };
      this.base.style.left = `${e.clientX - r.left - 60}px`;
      this.base.style.top = `${e.clientY - r.top - 60}px`;
      this.base.classList.add('active');
      area.setPointerCapture(e.pointerId);
    });
    area.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stickPointer) return;
      let dx = e.clientX - this.origin.x;
      let dy = e.clientY - this.origin.y;
      const len = Math.hypot(dx, dy);
      if (len > RADIUS) {
        dx = (dx / len) * RADIUS;
        dy = (dy / len) * RADIUS;
      }
      this.stick = { x: dx / RADIUS, y: -dy / RADIUS };
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    });
    const release = (e: PointerEvent) => {
      if (e.pointerId !== this.stickPointer) return;
      this.stickPointer = null;
      this.stick = { x: 0, y: 0 };
      this.knob.style.transform = '';
      this.base.classList.remove('active');
      this.base.style.left = this.base.style.top = '';
    };
    area.addEventListener('pointerup', release);
    area.addEventListener('pointercancel', release);

    const hold = (el: HTMLElement, set: (on: boolean) => void) => {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.onAny();
        el.setPointerCapture(e.pointerId);
        el.classList.add('on');
        set(true);
      });
      const up = () => {
        el.classList.remove('on');
        set(false);
      };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    };
    hold(turn, (on) => (this.turnTouch = on));
    hold(jump, (on) => (this.jumpTouch = on));
  }

  update() {
    const k = this.keys;
    let x = this.stick.x;
    let y = this.stick.y;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyW') || k.has('ArrowUp')) y += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y -= 1;
    this.input.lean = Math.max(-1, Math.min(1, x));
    this.input.press = Math.max(-1, Math.min(1, y));
    this.input.turn = this.turnTouch || k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyK');
    this.input.jump = this.jumpTouch || k.has('Space') || k.has('KeyJ');
  }

  reset() {
    this.stick = { x: 0, y: 0 };
    this.turnTouch = this.jumpTouch = false;
    this.input.turn = this.input.jump = false;
  }
}
