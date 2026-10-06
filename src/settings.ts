import type { BrushSettings, EraserSettings, FillSettings, OnionSettings } from './editor/editor';

export interface AppSettings {
  /** auto: once a pen is used, fingers only pan/zoom. */
  penMode: 'auto' | 'pen' | 'any';
  leftHanded: boolean;
  scrubAudio: boolean;
  showLayers: boolean;
  color: string;
  recentColors: string[];
  brush: BrushSettings;
  eraser: EraserSettings;
  fill: FillSettings;
  onion: OnionSettings;
}

const KEY = 'karekare.settings';

export const defaults: AppSettings = {
  penMode: 'auto',
  leftHanded: false,
  scrubAudio: true,
  showLayers: true,
  color: '#1f2430',
  recentColors: [],
  brush: { kind: 'pen', size: 6, opacity: 1, smoothing: 0.4 },
  eraser: { size: 24 },
  fill: { tolerance: 20, expand: 1, sampleAll: false },
  onion: { enabled: true, before: 1, after: 0, opacity: 0.3 },
};

export const settings: AppSettings = load();

function load(): AppSettings {
  const s = structuredClone(defaults);
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (raw && typeof raw === 'object') {
      for (const k of Object.keys(s) as (keyof AppSettings)[]) {
        const v = raw[k];
        if (v === undefined || typeof v !== typeof s[k]) continue;
        if (typeof v === 'object' && !Array.isArray(v)) Object.assign(s[k] as object, v);
        else (s as unknown as Record<string, unknown>)[k] = v;
      }
    }
  } catch {
    // Ignore corrupt or blocked storage.
  }
  return s;
}

let timer: ReturnType<typeof setTimeout> | undefined;

export function saveSettings(): void {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      // Ignore.
    }
  }, 300);
}
