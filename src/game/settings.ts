// Player settings, kept in this browser (falls back to defaults when storage is unavailable).

const KEY = 'sniper.settings.v1';

export interface Settings {
  bulletCam: boolean;
  windArrow: boolean;
  gyroAim: boolean;
  haptics: boolean;
}

export const DEFAULT_SETTINGS: Settings = { bulletCam: true, windArrow: true, gyroAim: false, haptics: true };

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Not persisted; the in-memory settings still apply for this visit.
  }
}
