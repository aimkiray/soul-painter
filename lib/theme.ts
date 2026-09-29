'use client';

export const THEME_STORAGE_KEY = 'imggen-theme-v1';
export const THEME_EVENT = 'soul-painter:theme';

export const THEMES = [
  'default',
  'matrix',
  'amber',
  'solarized-dark',
  'monokai',
  'nord',
  'dracula',
] as const;

export type ThemeName = (typeof THEMES)[number];

export function readTheme(): ThemeName {
  if (typeof document === 'undefined') return 'default';
  const current = document.documentElement.getAttribute('data-theme') || 'default';
  return (THEMES as readonly string[]).includes(current) ? (current as ThemeName) : 'default';
}

export function applyTheme(theme: ThemeName) {
  if (theme === 'default') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event(THEME_EVENT));
}

export function cycleTheme(): ThemeName {
  const next = THEMES[(THEMES.indexOf(readTheme()) + 1) % THEMES.length];
  applyTheme(next);
  return next;
}
