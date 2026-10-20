// All user-facing strings live here so another language can be added later.
export const STRINGS = {
  title: 'Sniper 狩獵',
  hintDesktop: '點擊開始 · WASD 移動 · Shift 跑 · 右鍵開鏡 · 左鍵按住閉氣放開開火 · C 趴下 · 滾輪歸零 · Z 倍率',
  hintTouch: '左手搖桿移動（推到底奔跑）· 右手拖曳看四周',
  speed: (v: number) => `速度 ${v.toFixed(1)} m/s`,
  altitude: (h: number) => `海拔 ${h.toFixed(0)} m`,
  wind: (v: number) => `${v.toFixed(1)} m/s`,
  heart: (bpm: number) => `心跳 ${bpm.toFixed(0)}`,
  scopeOn: '開鏡',
  scopeOff: '關鏡',
  stand: '站起',
  prone: '趴下',
  track: '追蹤',
  fire: '開火',
  rested: '架槍',
  cycling: '拉栓中',
  zero: (m: number) => `歸零 ${m}`,
  noRange: '— m',
  range: (m: number, deg: number) =>
    Math.abs(deg) < 2 ? `${m.toFixed(0)} m` : `${m.toFixed(0)} m ${deg < 0 ? '↓' : '↑'}${Math.abs(deg).toFixed(0)}°`,
  offset: (right: number, up: number) => {
    const cm = (v: number) => Math.abs(v * 100).toFixed(0);
    return `${right >= 0 ? '右' : '左'} ${cm(right)} cm · ${up >= 0 ? '上' : '下'} ${cm(up)} cm`;
  },
  hitBull: '命中紅心！',
  hitBoard: '命中靶板',
  hitGround: (m: number) => `落在地面 · ${m.toFixed(0)} m`,
  miss: '未命中',
  flight: (m: number, t: number) => `${m.toFixed(0)} m · 飛行 ${t.toFixed(2)} 秒`,
} as const;
