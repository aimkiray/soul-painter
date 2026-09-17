import { promises as fs, mkdirSync, renameSync, writeFileSync } from 'fs';
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
// Keep at least this many terminal runs even when active runs alone would
// otherwise slice the retained history down to zero.
const MIN_STORED_TERMINAL_RUNS = 50;
const FLUSH_DEBOUNCE_MS = 500;

// Module state is pinned on globalThis so Next.js dev-mode HMR re-evaluation
// shares one cache/write-queue instead of silently dropping pending writes.
// Every function below must read/write `state.*` directly: module-level `let`
// mirrors snapshot once at eval time and go stale on HMR — a pending
// `flushTimer` observed through a stale mirror made `scheduleFlush`
// early-return forever and writes were lost.
interface RunStoreState {
  writeQueue: Promise<void>;
  dataFileReady: boolean;
  runsCache: ServerRunRecord[] | null;
  cacheMtimeMs: number;
  flushTimer: ReturnType<typeof setTimeout> | null;
  dirty: boolean;
  exitHandlersInstalled: boolean;
}

const state = ((globalThis as Record<string, unknown>).__soulPainterRunStore ??= {
  writeQueue: Promise.resolve(),
  dataFileReady: false,
  runsCache: null,
  cacheMtimeMs: 0,
  flushTimer: null,
  dirty: false,
  exitHandlersInstalled: false,
}) as RunStoreState;

async function ensureDataFile() {
  if (state.dataFileReady) return;
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(RUNS_FILE);
  } catch {
    await fs.writeFile(RUNS_FILE, '[]', 'utf8');
  }
  state.dataFileReady = true;
}

function isActiveRun(run: ServerRunRecord) {
  return run.status === 'queued' || run.status === 'running';
}

function isTerminalStatus(status: ServerRunRecord['status'] | undefined) {
  return status === 'completed' || status === 'failed' || status === 'canceled';
}

function isRunRecord(item: unknown): item is ServerRunRecord {
  return !!item
    && typeof item === 'object'
    && typeof (item as ServerRunRecord).id === 'string';
}

async function readAllRunsUnsafe(): Promise<ServerRunRecord[]> {
  await ensureDataFile();
  if (state.runsCache) {
    try {
      const stat = await fs.stat(RUNS_FILE);
      if (stat.mtimeMs === state.cacheMtimeMs) return state.runsCache;
    } catch {
      // Fall through and reload when the file cannot be statted.
    }
  }

  let raw: string;
  try {
    raw = await fs.readFile(RUNS_FILE, 'utf8');
  } catch (error) {
    console.error(`Failed to read server runs from ${RUNS_FILE}`, error);
    state.runsCache = state.runsCache ?? [];
    return state.runsCache;
  }

  try {
    const parsed = JSON.parse(raw || '[]') as unknown;
    state.runsCache = Array.isArray(parsed) ? parsed.filter(isRunRecord) : [];
    try {
      state.cacheMtimeMs = (await fs.stat(RUNS_FILE)).mtimeMs;
    } catch {
      state.cacheMtimeMs = 0;
    }
    return state.runsCache;
  } catch (error) {
    console.error(`Failed to parse server runs from ${RUNS_FILE}`, error);
    // Quarantine a non-empty unparseable file once so a corrupt store does not
    // poison every read; after the rename the file is gone, so this cannot
    // repeat. A missing/empty file needs no quarantine. The cache is kept so
    // in-flight runs survive; the next write recreates the file via
    // tmp+rename.
    try {
      const stat = await fs.stat(RUNS_FILE);
      if (stat.size > 0) {
        await fs.rename(RUNS_FILE, `${RUNS_FILE}.corrupt-${Date.now()}`);
      }
    } catch {
      // Best effort only.
    }
    state.runsCache = state.runsCache ?? [];
    return state.runsCache;
  }
}

// Active runs are never trimmed so a long queue cannot evict in-flight work.
// Terminal runs keep a floor so a flood of active runs cannot zero out the
// persisted history entirely.
function trimRuns(runs: ServerRunRecord[]) {
  const sorted = [...runs].sort((a, b) => b.createdAt - a.createdAt);
  const active = sorted.filter(isActiveRun);
  const rest = sorted.filter((run) => !isActiveRun(run));
  return [...active, ...rest.slice(0, Math.max(MIN_STORED_TERMINAL_RUNS, MAX_STORED_RUNS - active.length))];
}

// result.debugRaw/result.code duplicate the base64 bytes already stored under
// result.images[].dataUrl; when over budget they are the first thing to go.
// Returns null when the record has nothing worth stripping.
function slimTerminalRun(run: ServerRunRecord): ServerRunRecord | null {
  if (isActiveRun(run) || !run.result) return null;
  if (run.result.debugRaw === undefined && !run.result.code) return null;
  return { ...run, result: { ...run.result, debugRaw: undefined, code: '' } };
}

// Produces the exact records + payload to persist. The store is written as
// compact JSON — pretty printing buys nothing for a server-side file — and
// sizes are measured in UTF-8 bytes (string .length undercounts CJK ~3x).
// When over budget, terminal records are slimmed then evicted oldest-first.
function prepareRunsForDisk(runs: ServerRunRecord[]) {
  let sorted = trimRuns(runs);
  let out = JSON.stringify(sorted);
  if (Buffer.byteLength(out, 'utf8') <= MAX_STORED_RUNS_BYTES) return { sorted, out };

  // Over budget: precompute each record's serialized size once.
  const sizeCache = new Map<ServerRunRecord, number>();
  const recordBytes = (run: ServerRunRecord) => {
    let size = sizeCache.get(run);
    if (size === undefined) {
      size = Buffer.byteLength(JSON.stringify(run), 'utf8');
      sizeCache.set(run, size);
    }
    return size;
  };
  // Array brackets plus one comma per element.
  let total = sorted.reduce((sum, run) => sum + recordBytes(run) + 1, 0) + 2;
  const active = sorted.filter(isActiveRun);
  const rest = sorted.filter((run) => !isActiveRun(run)); // newest first

  let stripped = 0;
  for (let i = rest.length - 1; i >= 0 && total > MAX_STORED_RUNS_BYTES; i -= 1) {
    const slimmed = slimTerminalRun(rest[i]);
    if (!slimmed) continue;
    total += recordBytes(slimmed) - recordBytes(rest[i]);
    rest[i] = slimmed;
    stripped += 1;
  }
  if (stripped > 0) {
    console.warn(`Stripped debug fields from ${stripped} terminal server run(s) to fit the ${MAX_STORED_RUNS_BYTES}-byte store budget`);
  }

  let dropped = 0;
  while (rest.length > 0 && total > MAX_STORED_RUNS_BYTES) {
    total -= recordBytes(rest.pop()!);
    dropped += 1;
  }
  if (dropped > 0) {
    console.warn(`Evicted ${dropped} terminal server run record(s) to fit the ${MAX_STORED_RUNS_BYTES}-byte store budget`);
  }

  sorted = [...active, ...rest];
  if (total > MAX_STORED_RUNS_BYTES) {
    // Only active runs remain and they alone exceed the budget — a losing
    // battle, but dropping in-flight work would be worse than a large file.
    console.error(`Active server runs alone need ~${total} bytes, over the ${MAX_STORED_RUNS_BYTES}-byte store budget; writing anyway`);
  }
  out = JSON.stringify(sorted);
  return { sorted, out };
}

async function writeAllRunsUnsafe(runs: ServerRunRecord[]) {
  await ensureDataFile();
  const { sorted, out } = prepareRunsForDisk(runs);
  const handle = await fs.open(RUNS_TMP_FILE, 'w');
  try {
    await handle.writeFile(out, 'utf8');
    try {
      // fsync the tmp file so a crash mid-rename cannot leave a torn store.
      await handle.sync();
    } catch {
      // Non-fatal: filesystems without fsync still get tmp+rename.
    }
  } finally {
    await handle.close();
  }
  await fs.rename(RUNS_TMP_FILE, RUNS_FILE);
  state.runsCache = sorted;
  try {
    state.cacheMtimeMs = (await fs.stat(RUNS_FILE)).mtimeMs;
  } catch {
    state.cacheMtimeMs = 0;
  }
}

// Streaming partial results update runs up to ~8x/sec; merging them into one
// debounced write avoids rewriting the whole file on every chunk.
function scheduleFlush() {
  state.dirty = true;
  if (state.flushTimer) return;
  state.flushTimer = setTimeout(() => {
    state.flushTimer = null;
    enqueueWrite(async () => {
      if (!state.dirty || !state.runsCache) return;
      state.dirty = false;
      try {
        await writeAllRunsUnsafe(state.runsCache);
      } catch (error) {
        state.dirty = true;
        console.error(`Failed to persist server runs to ${RUNS_FILE}`, error);
      }
    });
  }, FLUSH_DEBOUNCE_MS);
}

// Terminal transitions bypass the debounce: a SIGTERM inside the 500ms window
// would leave 'running' on disk, and the restart sweep would then mark the run
// failed ("服务进程重启已中断") and destroy a completed result. We are already
// inside the write queue here, so a direct write is safe.
async function persistPatch(runs: ServerRunRecord[], patch: Partial<ServerRunRecord>) {
  if (!isTerminalStatus(patch.status)) {
    scheduleFlush();
    return;
  }
  try {
    state.dirty = false;
    await writeAllRunsUnsafe(runs);
  } catch (error) {
    // Fall back to the debounced path; the record stays valid in memory.
    state.dirty = true;
    scheduleFlush();
    console.error(`Failed to persist terminal server run state to ${RUNS_FILE}`, error);
  }
}

// Synchronous best-effort flush for process shutdown: once the runtime starts
// tearing down, queued async writes may never run.
function flushRunsOnExit() {
  if (!state.dirty || !state.runsCache) return;
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    const { out } = prepareRunsForDisk(state.runsCache);
    writeFileSync(RUNS_TMP_FILE, out, 'utf8');
    renameSync(RUNS_TMP_FILE, RUNS_FILE);
    state.dirty = false;
  } catch (error) {
    console.error(`Failed to flush server runs to ${RUNS_FILE} on exit`, error);
  }
}

if (!state.exitHandlersInstalled) {
  state.exitHandlersInstalled = true;
  process.on('beforeExit', flushRunsOnExit);
  // once() removes this listener before it runs, so re-raising the signal hits
  // the default termination behavior (or another handler) after the flush.
  const flushThenReraise = (signal: 'SIGINT' | 'SIGTERM') => {
    flushRunsOnExit();
    try {
      process.kill(process.pid, signal);
    } catch {
      process.exit(128 + (signal === 'SIGTERM' ? 15 : 2));
    }
  };
  process.once('SIGINT', () => flushThenReraise('SIGINT'));
  process.once('SIGTERM', () => flushThenReraise('SIGTERM'));
}

function enqueueWrite<T>(task: () => Promise<T>) {
  const next = state.writeQueue.then(task, task);
  state.writeQueue = next.then(() => undefined, () => undefined);
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
    await persistPatch(runs, patch);
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
    await persistPatch(runs, patch);
    publishServerRunUpdate(next);
    return next;
  });
}
