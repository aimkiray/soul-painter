'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import { LANG_STORAGE_KEY, t, type Lang, type MsgKey } from '@/lib/i18n';

interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: MsgKey, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue>({
  lang: 'en',
  setLang: () => {},
  t: (key, vars) => t('en', key, vars),
});

// The language choice lives in localStorage, so it is modelled as an external
// store: both snapshots default to en and the client picks up a stored zh
// preference after hydration without a setState-in-effect pass.
const listeners = new Set<() => void>();
// Overrides localStorage when storage is blocked so the toggle still works
// for the current session.
let memoryLang: Lang | null = null;

function subscribeLang(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === LANG_STORAGE_KEY) onChange();
  };
  listeners.add(onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

function getLangSnapshot(): Lang {
  try {
    const stored = localStorage.getItem(LANG_STORAGE_KEY);
    if (stored === 'en' || stored === 'zh') return stored;
  } catch { /* storage blocked */ }
  return memoryLang ?? 'en';
}

function getLangServerSnapshot(): Lang {
  return 'en';
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const lang = useSyncExternalStore(subscribeLang, getLangSnapshot, getLangServerSnapshot);

  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    memoryLang = next;
    try {
      localStorage.setItem(LANG_STORAGE_KEY, next);
    } catch { /* storage blocked — memoryLang keeps the session choice */ }
    listeners.forEach((onChange) => onChange());
  }, []);

  const value = useMemo<I18nContextValue>(() => ({
    lang,
    setLang,
    t: (key, vars) => t(lang, key, vars),
  }), [lang, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
