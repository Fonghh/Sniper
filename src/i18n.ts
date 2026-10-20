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
  hitGround: '落在地面',
  miss: '未命中',
  hitAnimalPlain: '命中！',
  // Debug-only organ readout (enable with __sniper.setDebugHits(true)).
  hitAnimal: (organs: string[], passThrough: boolean) =>
    `命中：${organs.length ? organs.join('、') : '肌肉'}${passThrough ? ' · 貫穿' : ' · 留在體內'}`,
  deerDown: (seconds: number) => `鹿倒下了（中彈後 ${seconds.toFixed(1)} 秒）`,
  tracking: '追蹤中',
  sign: {
    hitSite: '中彈處：散落的鹿毛和血跡。從這裡開始追。',
    hitSiteClean: '中彈處：只有散落的鹿毛，沒有血。',
    track: (running: boolean) => (running ? '受傷鹿的足跡，蹄印張開、步幅很大 —— 牠在全速奔跑。' : '受傷鹿的足跡，步幅變小 —— 牠放慢了。'),
    bed: '鹿曾在這裡趴下，草被壓平，還有一灘血。牠就在附近。',
    blood: {
      frothy: '粉紅色、帶細小氣泡的血 —— 很可能命中肺部。牠應該跑不遠。',
      bright: '大量鮮紅色的血 —— 很可能命中心臟或大血管。',
      dark: '暗紅色的血 —— 可能命中肝臟。牠會撐上幾分鐘。',
      gut: '血裡混著綠褐色的胃內容物 —— 打中胃腸。牠會跑一段再躲起來。',
      sparse: '零星的鮮紅血滴 —— 可能只傷到肌肉或腿。',
    },
  },
  flight: (m: number, t: number) => `${m.toFixed(0)} m · 飛行 ${t.toFixed(2)} 秒`,
} as const;
