import { promises as fs } from 'fs';
import path from 'path';
import type { ServerRunRecord } from '@/lib/server-runs';

const DATA_DIR = path.join(process.cwd(), 'data');
const RUNS_FILE = path.join(DATA_DIR, 'server-runs.json');
const MAX_STORED_RUNS = 200;

let writeQueue = Promise.resolve();

async function ensureDataFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(RUNS_FILE);
  } catch {
    await fs.writeFile(RUNS_FILE, '[]', 'utf8');
  }
}

async function readAllRunsUnsafe(): Promise<ServerRunRecord[]> {
  await ensureDataFile();
  try {
    const raw = await fs.readFile(RUNS_FILE, 'utf8');
    const parsed = JSON.parse(raw || '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is ServerRunRecord => (
      !!item
      && typeof item === 'object'
      && typeof (item as ServerRunRecord).id === 'string'
    )) : [];
  } catch {
    return [];
  }
}

async function writeAllRunsUnsafe(runs: ServerRunRecord[]) {
  await ensureDataFile();
  const sorted = runs
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_STORED_RUNS);
  await fs.writeFile(RUNS_FILE, JSON.stringify(sorted, null, 2), 'utf8');
}

function enqueueWrite<T>(task: () => Promise<T>) {
  const next = writeQueue.then(task, task);
  writeQueue = next.then(() => undefined, () => undefined);
  return next;
}

export function readServerRuns(ids?: string[]) {
  return enqueueWrite(async () => {
    const runs = await readAllRunsUnsafe();
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

export function upsertServerRun(run: ServerRunRecord) {
  return enqueueWrite(async () => {
    const runs = await readAllRunsUnsafe();
    const index = runs.findIndex((item) => item.id === run.id);
    if (index >= 0) runs[index] = run;
    else runs.unshift(run);
    await writeAllRunsUnsafe(runs);
    return run;
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
    await writeAllRunsUnsafe(runs);
    return next;
  });
}
