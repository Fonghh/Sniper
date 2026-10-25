// Synthesized mountain sounds: wind that rises with speed, the hiss of a carve, the scrape of
// a skid, and thumps for landings and falls. Starts on the first user gesture.

export class SkiAudio {
  private ctx: AudioContext | null = null;
  private wind: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private carve: GainNode | null = null;
  private scrape: GainNode | null = null;
  private master: GainNode | null = null;

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const c = (this.ctx = new Ctx());
    this.master = c.createGain();
    this.master.gain.value = 0.6;
    this.master.connect(c.destination);
    const buf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const loop = (type: BiquadFilterType, freq: number, q: number) => {
      const src = c.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const f = c.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = c.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(this.master!);
      src.start();
      return { f, g };
    };
    const w = loop('lowpass', 400, 0.7);
    this.wind = w.g;
    this.windFilter = w.f;
    this.carve = loop('bandpass', 2400, 1.2).g;
    this.scrape = loop('bandpass', 700, 0.9).g;
  }

  /** Called every frame with the ride state. */
  update(speed: number, grounded: boolean, skid: number, edge: number) {
    if (!this.ctx || !this.wind) return;
    const t = this.ctx.currentTime;
    const s = Math.min(1, speed / 30);
    this.wind.gain.setTargetAtTime(0.05 + s * s * 0.9, t, 0.1);
    this.windFilter!.frequency.setTargetAtTime(300 + s * 1500, t, 0.1);
    const on = grounded ? Math.min(1, speed / 8) : 0;
    this.carve!.gain.setTargetAtTime(on * (0.08 + Math.abs(edge) * 0.25) * (1 - skid), t, 0.05);
    this.scrape!.gain.setTargetAtTime(on * skid * 0.7, t, 0.05);
  }

  thump(strength: number) {
    if (!this.ctx) return;
    const c = this.ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.frequency.setValueAtTime(110, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(40, c.currentTime + 0.25);
    g.gain.setValueAtTime(Math.min(1, 0.2 + strength * 0.08), c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.3);
    o.connect(g).connect(this.master!);
    o.start();
    o.stop(c.currentTime + 0.32);
  }

  silence() {
    if (!this.ctx || !this.wind) return;
    const t = this.ctx.currentTime;
    for (const g of [this.wind, this.carve!, this.scrape!]) g.gain.setTargetAtTime(0, t, 0.1);
  }
}
