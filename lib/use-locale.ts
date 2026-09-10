import { useSyncExternalStore } from 'react';
import { getLocale, subscribeLocale } from './i18n';

export function useLocale() {
  return useSyncExternalStore(subscribeLocale, getLocale, () => 'en' as const);
}
