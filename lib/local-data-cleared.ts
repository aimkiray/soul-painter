import { LOCAL_DATA_CLEARED_STORAGE_KEY } from '@/lib/constants';

const CLEARED_SESSION_KEY = 'sp-cleared';

let cleared = false;

export function markLocalDataCleared() {
  cleared = true;
  try { sessionStorage.setItem(CLEARED_SESSION_KEY, '1'); } catch { /* ignore */ }
}

export function isLocalDataCleared() {
  if (cleared) return true;
  try {
    if (sessionStorage.getItem(CLEARED_SESSION_KEY) === '1') {
      cleared = true;
      return true;
    }
    // Persistent marker written by clearAll after wiping storage — survives
    // the reload and is visible to every tab on this origin.
    if (localStorage.getItem(LOCAL_DATA_CLEARED_STORAGE_KEY) !== null) {
      cleared = true;
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

// Explicit user actions (a successful login sync, a manual config save)
// re-consent to local persistence — only then is the marker lifted.
export function clearLocalDataClearedMarker() {
  cleared = false;
  try { sessionStorage.removeItem(CLEARED_SESSION_KEY); } catch { /* ignore */ }
  try { localStorage.removeItem(LOCAL_DATA_CLEARED_STORAGE_KEY); } catch { /* ignore */ }
}

// The storage event only fires in OTHER tabs — it propagates the cleared
// marker so their in-flight writes stop too.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === LOCAL_DATA_CLEARED_STORAGE_KEY && event.newValue !== null) {
      cleared = true;
    }
  });
}
