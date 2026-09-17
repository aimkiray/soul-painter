let cleared = false;

export function markLocalDataCleared() {
  cleared = true;
  try { sessionStorage.setItem('sp-cleared', '1'); } catch { /* ignore */ }
}

export function isLocalDataCleared() {
  if (cleared) return true;
  try { return sessionStorage.getItem('sp-cleared') === '1'; } catch { return false; }
}
