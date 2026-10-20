import { LOOK, PLAYER } from '../game/config';

/** Device-independent player intent, sampled once per frame. */
export interface InputFrame {
  moveX: number; // -1..1, strafe
  moveY: number; // -1..1, forward
  run: boolean;
  lookYaw: number; // radians to add this frame
  lookPitch: number;
}

/** Discrete actions shared by keyboard/mouse and the on-screen controls. */
export interface Actions {
  toggleScope(): void;
  toggleStance(): void;
  toggleTracking(): void;
  beginShot(): void; // start holding breath
  releaseShot(fire: boolean): void; // fire, or cancel if false
  stepZero(delta: number): void;
  cycleMagnification(): void;
  isScoped(): boolean;
  /** A short tap on the play area (touch), or the interact key at screen centre (desktop). */
  tap(clientX: number, clientY: number): void;
}

const JOYSTICK_RADIUS = 50;

/**
 * Merges keyboard/mouse and touch into a single InputFrame and dispatches discrete actions.
 * Touch layout: left half of the play area is a floating-origin joystick, right half is
 * drag-to-look. On-screen buttons sit above the canvas and handle their own events.
 */
export class Input {
  private keys = new Set<string>();
  private yaw = 0;
  private pitch = 0;
  private stick = { x: 0, y: 0 };
  private stickPointer: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private lookPointer: number | null = null;
  private lookLast = { x: 0, y: 0 };
  private lookStart = { x: 0, y: 0, t: 0 };
  private mouseShot = false;
  readonly isTouch: boolean;

  constructor(
    private canvas: HTMLCanvasElement,
    private knob: HTMLElement,
    private actions: Actions,
  ) {
    this.isTouch = matchMedia('(pointer: coarse)').matches;
    if (this.isTouch) document.body.classList.add('touch');

    addEventListener('keydown', (e) => this.onKey(e));
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    addEventListener('mouseup', (e) => this.onMouseUp(e));
    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== canvas) return;
      this.yaw -= e.movementX * LOOK.mouseSensitivity * LOOK.horizontalBoost;
      this.pitch -= e.movementY * LOOK.mouseSensitivity;
    });
    addEventListener('wheel', (e) => {
      if (document.pointerLockElement === canvas) actions.stepZero(e.deltaY < 0 ? 1 : -1);
    });

    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    addEventListener('pointermove', (e) => this.onPointerMove(e));
    addEventListener('pointerup', (e) => this.onPointerUp(e));
    addEventListener('pointercancel', (e) => this.onPointerUp(e));
  }

  private onKey(e: KeyboardEvent) {
    if (e.repeat) return;
    this.keys.add(e.code);
    if (e.code === 'KeyC') this.actions.toggleStance();
    if (e.code === 'KeyT') this.actions.toggleTracking();
    if (e.code === 'KeyZ') this.actions.cycleMagnification();
    if (e.code === 'KeyE') {
      const r = this.canvas.getBoundingClientRect();
      this.actions.tap(r.left + r.width / 2, r.top + r.height / 2);
    }
  }

  private onMouseDown(e: MouseEvent) {
    if (this.isTouch) return;
    if (document.pointerLockElement !== this.canvas) {
      this.canvas.requestPointerLock();
      return;
    }
    if (e.button === 2) this.actions.toggleScope();
    if (e.button === 0 && this.actions.isScoped()) {
      this.mouseShot = true;
      this.actions.beginShot();
    }
  }

  private onMouseUp(e: MouseEvent) {
    if (e.button === 0 && this.mouseShot) {
      this.mouseShot = false;
      this.actions.releaseShot(true);
    }
  }

  private onPointerDown(e: PointerEvent) {
    if (e.pointerType === 'mouse') return;
    const rect = this.canvas.getBoundingClientRect();
    if (e.clientX < rect.left + rect.width / 2 && this.stickPointer === null) {
      this.stickPointer = e.pointerId;
      this.stickOrigin = { x: e.clientX, y: e.clientY };
    } else if (this.lookPointer === null) {
      this.lookPointer = e.pointerId;
      this.lookLast = { x: e.clientX, y: e.clientY };
      this.lookStart = { x: e.clientX, y: e.clientY, t: performance.now() };
    }
  }

  private onPointerMove(e: PointerEvent) {
    if (e.pointerId === this.stickPointer) {
      let dx = e.clientX - this.stickOrigin.x;
      let dy = e.clientY - this.stickOrigin.y;
      const len = Math.hypot(dx, dy);
      if (len > JOYSTICK_RADIUS) {
        dx = (dx / len) * JOYSTICK_RADIUS;
        dy = (dy / len) * JOYSTICK_RADIUS;
      }
      this.stick = { x: dx / JOYSTICK_RADIUS, y: -dy / JOYSTICK_RADIUS };
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    } else if (e.pointerId === this.lookPointer) {
      this.yaw -= (e.clientX - this.lookLast.x) * LOOK.touchSensitivity * LOOK.horizontalBoost;
      this.pitch -= (e.clientY - this.lookLast.y) * LOOK.touchSensitivity;
      this.lookLast = { x: e.clientX, y: e.clientY };
    }
  }

  private onPointerUp(e: PointerEvent) {
    if (e.pointerId === this.stickPointer) {
      this.stickPointer = null;
      this.stick = { x: 0, y: 0 };
      this.knob.style.transform = '';
    } else if (e.pointerId === this.lookPointer) {
      this.lookPointer = null;
      const moved = Math.hypot(e.clientX - this.lookStart.x, e.clientY - this.lookStart.y);
      if (moved < 10 && performance.now() - this.lookStart.t < 300) this.actions.tap(e.clientX, e.clientY);
    }
  }

  /** Returns the accumulated intent since the last call and resets look deltas. */
  sample(): InputFrame {
    let moveX = this.stick.x;
    let moveY = this.stick.y;
    let run = Math.hypot(moveX, moveY) >= PLAYER.runThreshold;
    if (this.keys.has('KeyW')) moveY += 1;
    if (this.keys.has('KeyS')) moveY -= 1;
    if (this.keys.has('KeyD')) moveX += 1;
    if (this.keys.has('KeyA')) moveX -= 1;
    if (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) run = true;
    const len = Math.hypot(moveX, moveY);
    if (len > 1) {
      moveX /= len;
      moveY /= len;
    }
    if (len === 0) run = false;
    const frame = { moveX, moveY, run, lookYaw: this.yaw, lookPitch: this.pitch };
    this.yaw = 0;
    this.pitch = 0;
    return frame;
  }
}
