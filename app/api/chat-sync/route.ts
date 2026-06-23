import { promises as fs } from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { CHAT_MESSAGES_MAX, CHAT_SESSIONS_MAX } from '@/lib/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CHAT_SYNC_MAX_BODY_BYTES = 2 * 1024 * 1024;
const CHAT_SYNC_LOCK_STALE_MS = 60_000;
const CHAT_SYNC_LOCK_RETRY_MS = 25;

const accountLocks = new Map<string, Promise<void>>();

type SyncMessage = Record<string, unknown> & {
  id: string;
  role: 'user' | 'bot';
  createdAt: number;
  updatedAt?: number;
};

type SyncSession = Record<string, unknown> & {
  id: string;
  title: string;
  messages: SyncMessage[];
  createdAt: number;
  updatedAt: number;
};

interface SyncTombstone {
  type: 'session' | 'message';
  id: string;
  sessionId?: string;
  deletedAt: number;
}

interface SyncStore {
  user: string;
  sessions: SyncSession[];
  tombstones: SyncTombstone[];
  activeSessionId: string;
  updatedAt: number;
}

function cleanString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function cleanNumber(value: unknown, fallback = Date.now()) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function accountId(username: string, secret: string) {
  return createHash('sha256')
    .update(`${username.trim().toLowerCase()}\0${secret}`)
    .digest('hex');
}

function dataFileFor(id: string) {
  return path.join(process.cwd(), 'data', 'chat-sync', `${id}.json`);
}

function lockFileFor(id: string) {
  return path.join(process.cwd(), 'data', 'chat-sync', `${id}.lock`);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorCode(error: unknown) {
  return error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code || '')
    : '';
}

async function acquireFileLock(id: string) {
  const lockFile = lockFileFor(id);
  await fs.mkdir(path.dirname(lockFile), { recursive: true });

  while (true) {
    try {
      const handle = await fs.open(lockFile, 'wx');
      try {
        await handle.writeFile(JSON.stringify({ pid: process.pid, acquiredAt: Date.now() }), 'utf8');
      } finally {
        await handle.close();
      }

      let released = false;
      return async () => {
        if (released) return;
        released = true;
        await fs.unlink(lockFile).catch(() => undefined);
      };
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error;

      try {
        const stat = await fs.stat(lockFile);
        if (Date.now() - stat.mtimeMs > CHAT_SYNC_LOCK_STALE_MS) {
          await fs.unlink(lockFile).catch(() => undefined);
          continue;
        }
      } catch (statError) {
        if (errorCode(statError) === 'ENOENT') continue;
        throw statError;
      }

      await sleep(CHAT_SYNC_LOCK_RETRY_MS + Math.floor(Math.random() * CHAT_SYNC_LOCK_RETRY_MS));
    }
  }
}

async function withAccountLock<T>(id: string, task: () => Promise<T>) {
  const previous = accountLocks.get(id) || Promise.resolve();
  let releaseMemoryLock: () => void = () => {};
  const current = new Promise<void>((resolve) => {
    releaseMemoryLock = resolve;
  });
  const queued = previous.catch(() => undefined).then(() => current);
  accountLocks.set(id, queued);

  await previous.catch(() => undefined);
  let releaseFileLock: (() => Promise<void>) | null = null;
  try {
    releaseFileLock = await acquireFileLock(id);
    return await task();
  } finally {
    if (releaseFileLock) await releaseFileLock();
    releaseMemoryLock();
    if (accountLocks.get(id) === queued) accountLocks.delete(id);
  }
}

function sanitizeMessage(value: unknown): SyncMessage | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = cleanString(raw.id);
  if (!id) return null;
  return {
    ...raw,
    id,
    role: raw.role === 'user' ? 'user' : 'bot',
    prompt: typeof raw.prompt === 'string' ? raw.prompt : '',
    images: Array.isArray(raw.images) ? raw.images.slice(0, 10) : [],
    text: typeof raw.text === 'string' ? raw.text : '',
    code: '',
    extra: typeof raw.extra === 'string' ? raw.extra : '',
    createdAt: cleanNumber(raw.createdAt),
    updatedAt: typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : undefined,
    editedAt: typeof raw.editedAt === 'number' && Number.isFinite(raw.editedAt) ? raw.editedAt : undefined,
  };
}

function sanitizeSession(value: unknown): SyncSession | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = cleanString(raw.id);
  if (!id) return null;
  const messages = Array.isArray(raw.messages)
    ? raw.messages.map(sanitizeMessage).filter((message): message is SyncMessage => message !== null)
    : [];
  return {
    ...raw,
    id,
    title: cleanString(raw.title, '新聊天').slice(0, 24),
    titleSource: raw.titleSource === 'generated' || raw.titleSource === 'manual' ? raw.titleSource : 'auto',
    messages: messages.slice(-CHAT_MESSAGES_MAX),
    createdAt: cleanNumber(raw.createdAt),
    updatedAt: cleanNumber(raw.updatedAt),
  };
}

function sanitizeTombstone(value: unknown): SyncTombstone | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<SyncTombstone>;
  const type = raw.type === 'session' || raw.type === 'message' ? raw.type : null;
  const id = cleanString(raw.id);
  const sessionId = cleanString(raw.sessionId);
  const deletedAt = cleanNumber(raw.deletedAt, 0);
  if (!type || !id || deletedAt <= 0) return null;
  if (type === 'message' && !sessionId) return null;
  return {
    type,
    id,
    sessionId: sessionId || undefined,
    deletedAt,
  };
}

function tombstoneKey(tombstone: SyncTombstone) {
  return `${tombstone.type}:${tombstone.sessionId || ''}:${tombstone.id}`;
}

function mergeTombstones(...groups: SyncTombstone[][]) {
  const byKey = new Map<string, SyncTombstone>();
  for (const tombstones of groups) {
    for (const tombstone of tombstones) {
      const key = tombstoneKey(tombstone);
      const current = byKey.get(key);
      if (!current || tombstone.deletedAt > current.deletedAt) {
        byKey.set(key, tombstone);
      }
    }
  }
  return [...byKey.values()]
    .sort((a, b) => b.deletedAt - a.deletedAt)
    .slice(0, 1000);
}

function sortMessages(messages: SyncMessage[]) {
  return messages
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(-CHAT_MESSAGES_MAX);
}

function messageStamp(message: SyncMessage) {
  return message.updatedAt || message.createdAt || 0;
}

function sessionStamp(session: SyncSession) {
  return session.updatedAt || session.createdAt || 0;
}

function mergeSession(a: SyncSession, b: SyncSession): SyncSession {
  const newer = sessionStamp(a) >= sessionStamp(b) ? a : b;
  const older = newer === a ? b : a;
  const messagesById = new Map<string, SyncMessage>();

  for (const message of older.messages) messagesById.set(message.id, message);
  for (const message of newer.messages) {
    const current = messagesById.get(message.id);
    if (!current || messageStamp(message) >= messageStamp(current)) {
      messagesById.set(message.id, message);
    }
  }

  return {
    ...older,
    ...newer,
    createdAt: Math.min(a.createdAt, b.createdAt),
    updatedAt: Math.max(sessionStamp(a), sessionStamp(b)),
    messages: sortMessages([...messagesById.values()]),
  };
}

function mergeSessions(localSessions: SyncSession[], storedSessions: SyncSession[]) {
  const byId = new Map<string, SyncSession>();
  for (const session of storedSessions) byId.set(session.id, session);
  for (const session of localSessions) {
    const current = byId.get(session.id);
    byId.set(session.id, current ? mergeSession(current, session) : session);
  }
  return [...byId.values()]
    .sort((a, b) => sessionStamp(b) - sessionStamp(a))
    .slice(0, CHAT_SESSIONS_MAX);
}

function applyTombstones(sessions: SyncSession[], tombstones: SyncTombstone[]) {
  const sessionDeletes = new Map<string, number>();
  const messageDeletes = new Map<string, number>();

  for (const tombstone of tombstones) {
    if (tombstone.type === 'session') {
      sessionDeletes.set(tombstone.id, Math.max(sessionDeletes.get(tombstone.id) || 0, tombstone.deletedAt));
    } else if (tombstone.sessionId) {
      const key = `${tombstone.sessionId}:${tombstone.id}`;
      messageDeletes.set(key, Math.max(messageDeletes.get(key) || 0, tombstone.deletedAt));
    }
  }

  return sessions
    .filter((session) => (sessionDeletes.get(session.id) || 0) < sessionStamp(session))
    .map((session) => ({
      ...session,
      messages: session.messages.filter((message) => (
        (messageDeletes.get(`${session.id}:${message.id}`) || 0) < messageStamp(message)
      )),
    }))
    .slice(0, CHAT_SESSIONS_MAX);
}

async function readStore(file: string, user: string): Promise<SyncStore> {
  try {
    const raw = JSON.parse(await fs.readFile(file, 'utf8')) as Partial<SyncStore>;
    return {
      user: cleanString(raw.user, user),
      sessions: Array.isArray(raw.sessions)
        ? raw.sessions.map(sanitizeSession).filter((session): session is SyncSession => session !== null)
        : [],
      tombstones: Array.isArray(raw.tombstones)
        ? raw.tombstones.map(sanitizeTombstone).filter((item): item is SyncTombstone => item !== null)
        : [],
      activeSessionId: cleanString(raw.activeSessionId),
      updatedAt: cleanNumber(raw.updatedAt, 0),
    };
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return { user, sessions: [], tombstones: [], activeSessionId: '', updatedAt: 0 };
    }
    throw new Error('聊天同步存档读取失败，已停止覆盖写入');
  }
}

async function writeStore(file: string, store: SyncStore) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tempFile = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  );
  try {
    await fs.writeFile(tempFile, JSON.stringify(store), 'utf8');
    await fs.rename(tempFile, file);
  } catch (error) {
    await fs.unlink(tempFile).catch(() => undefined);
    throw error;
  }
}

export async function POST(request: NextRequest) {
  try {
    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > CHAT_SYNC_MAX_BODY_BYTES) {
      return NextResponse.json({ error: '同步数据过大' }, { status: 413 });
    }

    const rawBody = await request.text().catch(() => '');
    if (new TextEncoder().encode(rawBody).length > CHAT_SYNC_MAX_BODY_BYTES) {
      return NextResponse.json({ error: '同步数据过大' }, { status: 413 });
    }
    let parsedBody: unknown = {};
    try {
      parsedBody = rawBody ? JSON.parse(rawBody) as unknown : {};
    } catch {
      return NextResponse.json({ error: '同步数据格式错误' }, { status: 400 });
    }
    const body = parsedBody && typeof parsedBody === 'object' && !Array.isArray(parsedBody)
      ? parsedBody as Record<string, unknown>
      : {};
    const username = cleanString(body.username).slice(0, 32);
    const secret = cleanString(body.secret);
    if (!username || secret.length < 4) {
      return NextResponse.json({ error: '请输入玩家名和至少 4 位同步密钥' }, { status: 400 });
    }

    const id = accountId(username, secret);
    const file = dataFileFor(id);
    const rawSessions = Array.isArray(body.sessions) ? body.sessions as unknown[] : [];
    const localSessions = rawSessions.length > 0
      ? rawSessions.map(sanitizeSession).filter((session): session is SyncSession => session !== null)
      : [];
    const rawTombstones = Array.isArray(body.tombstones) ? body.tombstones as unknown[] : [];
    const localTombstones = rawTombstones.length > 0
      ? rawTombstones.map(sanitizeTombstone).filter((item): item is SyncTombstone => item !== null)
      : [];
    const requestedActiveId = cleanString(body.activeSessionId);
    const updated = await withAccountLock(id, async () => {
      const stored = await readStore(file, username);
      const tombstones = mergeTombstones(localTombstones, stored.tombstones);
      const sessions = applyTombstones(mergeSessions(localSessions, stored.sessions), tombstones);
      const storedActiveId = cleanString(stored.activeSessionId);
      const activeSessionId = sessions.some((session) => session.id === requestedActiveId)
        ? requestedActiveId
        : sessions.some((session) => session.id === storedActiveId)
          ? storedActiveId
        : sessions[0]?.id || '';

      const nextStore: SyncStore = {
        user: username,
        sessions,
        tombstones,
        activeSessionId,
        updatedAt: Date.now(),
      };
      await writeStore(file, nextStore);
      return nextStore;
    });

    return NextResponse.json({ ok: true, ...updated });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || '聊天记录同步失败' },
      { status: 500 },
    );
  }
}
