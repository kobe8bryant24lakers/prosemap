import { english } from './translations.ts';

export type Locale = 'en' | 'zh-CN';
export const LOCALE_STORAGE_KEY = 'prosemap.locale';
const listeners = new Set<() => void>();

export function readSavedLocale(): Locale {
  try {
    return globalThis.localStorage?.getItem(LOCALE_STORAGE_KEY) === 'zh-CN' ? 'zh-CN' : 'en';
  } catch {
    return 'en';
  }
}

let locale: Locale = readSavedLocale();
export function getLocale(): Locale { return locale; }
export function subscribeLocale(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function setLocale(next: Locale) {
  if (next !== 'en' && next !== 'zh-CN') return;
  locale = next;
  try { globalThis.localStorage?.setItem(LOCALE_STORAGE_KEY, next); } catch { /* In-memory fallback. */ }
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  listeners.forEach((listener) => listener());
}

const reverse = new Map(Object.entries(english).map(([zh, en]) => [en, zh]));
const templates = Object.entries(english).filter(([key]) => /\{\d+\}/.test(key)).map(([zh, en]) => {
  const compile = (value: string) => new RegExp('^' + value.split(/(\{\d+\})/).map((part) => /\{\d+\}/.test(part) ? '([\\s\\S]*?)' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('') + '$');
  return { zh, en, zhPattern: compile(zh), enPattern: compile(en) };
});

export function translate(key: string, target: Locale, ...values: Array<string | number>): string {
  const source = target === 'en' ? (english[key] ?? key) : (reverse.get(key) ?? key);
  return source.replace(/\{(\d+)\}/g, (placeholder, index: string) => values[Number(index)] === undefined ? placeholder : String(values[Number(index)]));
}

/** Translate known UI copy. Interpolated values are never recursively translated. */
export function t(key: string, ...values: Array<string | number>): string {
  return translate(key, locale, ...values);
}

/** Re-localize stored UI notices and backend errors, without touching document text. */
export function uiMessage(message: string): string {
  if (english[message] !== undefined || reverse.has(message)) return t(message);
  for (const entry of templates) {
    const pattern = locale === 'en' ? entry.zhPattern : entry.enPattern;
    const match = message.match(pattern);
    if (!match) continue;
    const source = locale === 'en' ? entry.zh : entry.en;
    const indices = [...source.matchAll(/\{(\d+)\}/g)].map((part) => Number(part[1]));
    const values: string[] = [];
    indices.forEach((index, offset) => { values[index] = match[offset + 1]; });
    return translate(entry.zh, locale, ...values);
  }
  return message;
}
