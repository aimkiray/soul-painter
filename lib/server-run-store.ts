import { promises as fs } from 'fs';
import path from 'path';
import type { ServerRunRecord } from '@/lib/server-runs';
import { publishServerRunUpdate } from '@/lib/server-run-events';

const DATA_DIR = path.join(process.cwd(), 'data');
const RUNS_FILE = path.join(DATA_DIR, 'server-runs.json');
const RUNS_TMP_FILE = `${RUNS_FILE}.tmp`;
const MAX_STORED_RUNS = 200;
// Run records carry base64 image payloads; a count cap alone let this file grow
// past the V8 string limit (~512MB) and fill the disk. Cap serialized bytes too.
const MAX_STORED_RUNS_BYTES = 64 * 1024 * 1024;
const FLUSH_DEBOUNCE_MS = 500;

// Module state is pinned on globalThis so Next.js dev-mode HMR re-evaluation
// shares one cache/write-queue instead of silently dropping pending writes.
interface RunStoreState {
  writeQueue: Promise<void>;
  dataFileReady: boolean;
  runsCache: ServerRunRecord[] | null;
  cacheMtimeMs: number;
  flushTimer: ReturnType<typeof setTimeout> | null;
  dirty: boolean;
}

const state = ((globalThis as Record<string, unknown>).__soulPainterRunStore ??= {
  writeQueue: Promise.resolve(),
  dataFileReady: false,
  runsCache: null,
  cacheMtimeMs: 0,
  flushTimer: null,
  dirty: false,
}) as RunStoreState;

let writeQueue = state.writeQueue;
let dataFileReady = state.dataFileReady;
let runsCache = state.runsCache;
let cacheMtimeMs = state.cacheMtimeMs;
let flushTimer = state.flushTimer;
let dirty = state.dirty;

function syncState() {
  state.writeQueue = writeQueue;
  state.dataFileReady = dataFileReady;
  state.runsCache = runsCache;
  state.cacheMtimeMs = cacheMtimeMs;
  state.flushTimer = flushTimer;
  state.dirty = dirty;
}

async function ensureDataFile() {
  if (dataFileReady) return;
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(RUNS_FILE);
  } catch {
    await fs.writeFile(RUNS_FILE, '[]', 'utf8');
  }
  dataFileReady = true;
}

function isActiveRun(run: ServerRunRecord) {
  return run.status === 'queued' || run.status === 'running';
}

function isRunRecord(item: unknown): item is ServerRunRecord {
  return !!item
    && typeof item === 'object'
    && typeof (item as ServerRunRecord).id === 'string';
}

async function readAllRunsUnsafe(): Promise<ServerRunRecord[]> {
  await ensureDataFile();
  if (runsCache) {
    try {
      const stat = await fs.stat(RUNS_FILE);
      if (stat.mtimeMs === cacheMtimeMs) return runsCache;
    } catch {
      // Fall through and reload when the file cannot be statted.
    }
  }
  try {
    const raw = await fs.readFile(RUNS_FILE, 'utf8');
    const parsed = JSON.parse(raw || '[]') as unknown;
    runsCache = Array.isArray(parsed) ? parsed.filter(isRunRecord) : [];
    try {
      cacheMtimeMs = (await fs.stat(RUNS_FILE)).mtimeMs;
    } catch {
      cacheMtimeMs = 0;
    }
    return runsCache;
  } catch (error) {
    console.error(`Failed to read server runs from ${RUNS_FILE}`, error);
    runsCache = runsCache ?? [];
    return runsCache;
  }
}

// Active runs are never trimmed so a long queue cannot evict in-flight work.
function trimRuns(runs: ServerRunRecord[]) {
  const sorted = [...runs].sort((a, b) => b.createdAt - a.createdAt);
  const active = sorted.filter(isActiveRun);
  const rest = sorted.filter((run) => !isActiveRun(run));
  return [...active, ...rest.slice(0, Math.max(0, MAX_STORED_RUNS - active.length))];
}

async function writeAllRunsUnsafe(runs: ServerRunRecord[]) {
  await ensureDataFile();
  let sorted = trimRuns(runs);
  let out = JSON.stringify(sorted, null, 2);
  if (out.length > MAX_STORED_RUNS_BYTES) {
    const active = sorted.filter(isActiveRun);
    const rest = sorted.filter((run) => !isActiveRun(run));
    let total = sorted.reduce((sum, run) => sum + JSON.stringify(run).length, 0);
    while (rest.length > 0 && total > MAX_STORED_RUNS_BYTES) {
      const dropped = rest.pop()!;
      total -= JSON.stringify(dropped).length;
    }
    sorted = [...active, ...rest];
    out = JSON.stringify(sorted, null, 2);
  }
  await fs.writeFile(RUNS_TMP_FILE, out, 'utf8');
  await fs.rename(RUNS_TMP_FILE, RUNS_FILE);
  runsCache = sorted;
  try {
    cacheMtimeMs = (await fs.stat(RUNS_FILE)).mtimeMs;
  } catch {
    cacheMtimeMs = 0;
  }
}

// Streaming partial results update runs up to ~8x/sec; merging them into one
// debounced write avoids rewriting the whole file on every chunk.
function scheduleFlush() {
  dirty = true;
  if (flushTimer) {
    syncState();
    return;
  }
  flushTimer = setTimeout(() => {
    flushTimer = null;
    enqueueWrite(async () => {
      if (!dirty || !runsCache) return;
      dirty = false;
      try {
        await writeAllRunsUnsafe(runsCache);
      } catch (error) {
        dirty = true;
        console.error(`Failed to persist server runs to ${RUNS_FILE}`, error);
      }
    });
  }, FLUSH_DEBOUNCE_MS);
  syncState();
}

function enqueueWrite<T>(task: () => Promise<T>) {
  const next = writeQueue.then(task, task);
  writeQueue = next.then(() => undefined, () => undefined);
  void next.then(syncState, syncState);
  return next;
}

export function readServerRuns(ids?: string[]) {
  return enqueueWrite(async () => {
    const runs = await readAllRunsUnsafe();
    // Callers always pass a non-empty id list; an empty list means "nothing to fetch".
    if (!ids || ids.length === 0) return [];
    const idSet = new Set(ids);
    return runs.filter((run) => idSet.has(run.id));
  });
}

export function readServerRun(id: string) {
  return enqueueWrite(async () => {
    const runs = await readAllRunsUnsafe();
    return runs.find((run) => run.id === id) || null;
  });
}

export function createServerRun(run: ServerRunRecord) {
  return enqueueWrite(async () => {
    const runs = await readAllRunsUnsafe();
    const existing = runs.find((item) => item.id === run.id);
    if (existing) return { created: false as const, run: existing };
    runs.unshift(run);
    try {
      await writeAllRunsUnsafe(runs);
    } catch (error) {
      // The in-memory record stays valid and the debounced flush keeps
      // retrying — a read-only/misconfigured data dir must not fail creation.
      scheduleFlush();
      console.error(`Failed to persist new server run to ${RUNS_FILE}; running in-memory until a write succeeds`, error);
    }
    publishServerRunUpdate(run);
    return { created: true as const, run };
  });
}

export function updateServerRun(id: string, patch: Partial<ServerRunRecord>) {
  return enqueueWrite(async () => {
    const runs = await readAllRunsUnsafe();
    const index = runs.findIndex((item) => item.id === id);
    if (index < 0) return null;
    const next = {
      ...runs[index],
      ...patch,
      updatedAt: Date.now(),
    };
    runs[index] = next;
    scheduleFlush();
    publishServerRunUpdate(next);
    return next;
  });
}

// Read-modify-write inside the write queue so a terminal transition cannot be
// overwritten by a late-arriving patch (e.g. cancel racing a completion).
export function updateServerRunIf(
  id: string,
  patch: Partial<ServerRunRecord>,
  predicate: (run: ServerRunRecord) => boolean,
) {
  return enqueueWrite(async () => {
    const runs = await readAllRunsUnsafe();
    const index = runs.findIndex((item) => item.id === id);
    if (index < 0 || !predicate(runs[index])) return null;
    const next = {
      ...runs[index],
      ...patch,
      updatedAt: Date.now(),
    };
    runs[index] = next;
    scheduleFlush();
    publishServerRunUpdate(next);
    return next;
  });
}
