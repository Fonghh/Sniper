// All user-facing strings live here so another language can be added later.
export const STRINGS = {
  title: 'Sniper 狩獵',
  hintDesktop: '點擊畫面開始 · WASD 移動 · Shift 奔跑 · 滑鼠看',
  hintTouch: '左手搖桿移動（推到底奔跑）· 右手拖曳看四周',
  speed: (v: number) => `速度 ${v.toFixed(1)} m/s`,
  altitude: (h: number) => `海拔 ${h.toFixed(0)} m`,
  wind: (v: number) => `${v.toFixed(1)} m/s`,
} as const;
