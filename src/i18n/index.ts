import { en } from './en';
import { tr } from './tr';

export type Lang = 'tr' | 'en';
export type StringKey = keyof typeof en;

const tables: Record<Lang, Record<StringKey, string>> = { en, tr };

let current: Lang = detect();

function detect(): Lang {
  try {
    const saved = localStorage.getItem('karekare.lang');
    if (saved === 'tr' || saved === 'en') return saved;
  } catch {
    // Storage may be blocked.
  }
  const langs = typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : [];
  return langs.some((l) => l?.toLowerCase().startsWith('tr')) ? 'tr' : 'en';
}

export function lang(): Lang {
  return current;
}

export function setLang(l: Lang): void {
  current = l;
  document.documentElement.lang = l;
  try {
    localStorage.setItem('karekare.lang', l);
  } catch {
    // Ignore.
  }
}

/** Translates a key, replacing `{name}` placeholders. */
export function t(key: StringKey, params?: Record<string, string | number>): string {
  let s = tables[current][key] ?? en[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}
