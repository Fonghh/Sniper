// Synthesized arena sounds (WebAudio, no assets). The context starts on the first gesture.

type Sound = 'rifle' | 'bow' | 'throw' | 'blast' | 'hit' | 'head' | 'kill' | 'reload' | 'hurt' | 'impact' | 'empty';

export class ArenaAudio {
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private master: GainNode | null = null;

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  private burst(dur: number, freq: number, q: number, vol: number, type: BiquadFilterType = 'lowpass', at = 0) {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    const t = c.currentTime + at;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t, Math.random() * 0.5, dur + 0.05);
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, at = 0) {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = type;
    const t = c.currentTime + at;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** `distance` in metres attenuates other people's sounds. */
  play(s: Sound, distance = 0) {
    if (!this.ctx || !this.noise) return;
    const v = 1 / (1 + distance / 12);
    switch (s) {
      case 'rifle':
        this.burst(0.12, 2600, 0.7, 0.7 * v);
        this.tone('triangle', 150, 50, 0.12, 0.6 * v);
        break;
      case 'bow':
        this.tone('triangle', 220, 90, 0.18, 0.5 * v);
        this.burst(0.08, 1800, 1, 0.25 * v, 'bandpass');
        break;
      case 'throw':
        this.burst(0.25, 900, 2, 0.3 * v, 'bandpass');
        break;
      case 'blast':
        this.burst(0.9, 500, 0.6, 1.1 * v);
        this.tone('sine', 90, 30, 0.6, 0.9 * v);
        break;
      case 'hit':
        this.tone('square', 1500, 1200, 0.05, 0.12);
        break;
      case 'head':
        this.tone('sine', 1900, 1900, 0.12, 0.3);
        this.tone('sine', 2850, 2850, 0.1, 0.12);
        break;
      case 'kill':
        this.tone('sine', 880, 880, 0.08, 0.3);
        this.tone('sine', 1320, 1320, 0.16, 0.3, 0.08);
        break;
      case 'reload':
        this.burst(0.04, 3000, 3, 0.4, 'bandpass');
        this.burst(0.05, 2200, 3, 0.4, 'bandpass', 0.35);
        break;
      case 'hurt':
        this.tone('sawtooth', 160, 90, 0.18, 0.25);
        break;
      case 'impact':
        this.burst(0.06, 1200, 1.5, 0.25 * v, 'bandpass');
        break;
      case 'empty':
        this.burst(0.03, 4000, 4, 0.3, 'bandpass');
        break;
    }
  }
}
