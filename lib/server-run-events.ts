import type { ServerRunRecord } from '@/lib/server-runs';

type ServerRunListener = (run: ServerRunRecord) => void;

const globalForServerRunEvents = globalThis as unknown as {
  serverRunListeners?: Map<string, Set<ServerRunListener>>;
};

const listeners = globalForServerRunEvents.serverRunListeners ?? new Map<string, Set<ServerRunListener>>();
globalForServerRunEvents.serverRunListeners = listeners;

export function subscribeServerRunUpdates(runId: string, listener: ServerRunListener) {
  const runListeners = listeners.get(runId) ?? new Set<ServerRunListener>();
  runListeners.add(listener);
  listeners.set(runId, runListeners);

  return () => {
    runListeners.delete(listener);
    if (runListeners.size === 0) listeners.delete(runId);
  };
}

export function publishServerRunUpdate(run: ServerRunRecord) {
  const runListeners = listeners.get(run.id);
  if (!runListeners || runListeners.size === 0) return;

  for (const listener of [...runListeners]) {
    try {
      listener(run);
    } catch {
      // Ignore broken subscribers; SSE handlers clean themselves up on close.
    }
  }
}
