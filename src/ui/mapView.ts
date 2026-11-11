import { HALF_MAP, MAP_SIZE, Terrain, WATER_LEVEL } from '../world/terrain';
import type { Lookout } from '../world/lookouts';

const RES = 160; // heightmap pixels per side

/** Top-down shaded map with lookouts and the player; tap a visited lookout to travel there. */
export class MapView {
  private base: HTMLCanvasElement;
  onTravel: ((l: Lookout) => void) | null = null;
  private lookouts: Lookout[] = [];

  constructor(
    private canvas: HTMLCanvasElement,
    terrain: Terrain,
  ) {
    this.base = document.createElement('canvas');
    this.base.width = this.base.height = RES;
    const ctx = this.base.getContext('2d')!;
    const img = ctx.createImageData(RES, RES);
    const step = MAP_SIZE / RES;
    for (let j = 0; j < RES; j++) {
      for (let i = 0; i < RES; i++) {
        const x = -HALF_MAP + (i + 0.5) * step;
        const z = -HALF_MAP + (j + 0.5) * step;
        const h = terrain.height(x, z);
        // Hill shading from the north-west plus height tint.
        const shade = (terrain.height(x - step, z - step) - h) * 0.06;
        const k = (i + j * RES) * 4;
        if (h < WATER_LEVEL) {
          img.data.set([70, 120, 160, 255], k);
        } else {
          const t = Math.min(h / 200, 1);
          const base = [90 + 90 * t, 120 + 50 * t, 60 + 60 * t];
          for (let c = 0; c < 3; c++) img.data[k + c] = Math.max(0, Math.min(255, base[c] * (1 + shade)));
          img.data[k + 3] = 255;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    canvas.addEventListener('pointerup', (e) => this.onTap(e));
  }

  private toCanvas(x: number, z: number, size: number) {
    return { cx: ((x + HALF_MAP) / MAP_SIZE) * size, cy: ((z + HALF_MAP) / MAP_SIZE) * size };
  }

  draw(lookouts: Lookout[], player: { x: number; z: number; yaw: number }) {
    this.lookouts = lookouts;
    const size = this.canvas.clientWidth || 300;
    this.canvas.width = this.canvas.height = size * Math.min(devicePixelRatio, 2);
    const ctx = this.canvas.getContext('2d')!;
    ctx.setTransform(this.canvas.width / size, 0, 0, this.canvas.width / size, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.base, 0, 0, size, size);
    for (const l of lookouts) {
      const { cx, cy } = this.toCanvas(l.x, l.z, size);
      ctx.beginPath();
      ctx.arc(cx, cy, 9, 0, Math.PI * 2);
      ctx.fillStyle = l.discovered ? '#e0b23a' : 'rgba(200,200,200,0.55)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#1b1f1a';
      ctx.stroke();
    }
    // Player arrow (yaw 0 faces -z, which is "up" on this map).
    const { cx, cy } = this.toCanvas(player.x, player.z, size);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-player.yaw);
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(6, 7);
    ctx.lineTo(-6, 7);
    ctx.closePath();
    ctx.fillStyle = '#ff5a3c';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.restore();
  }

  private onTap(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    for (const l of this.lookouts) {
      const { cx, cy } = this.toCanvas(l.x, l.z, r.width);
      if (l.discovered && Math.hypot(cx - x, cy - y) < 20) {
        this.onTravel?.(l);
        return;
      }
    }
  }
}
