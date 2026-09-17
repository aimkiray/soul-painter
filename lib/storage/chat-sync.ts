import { useCallback, type MutableRefObject } from 'react';
import type { ChatSession, ChatSyncTombstone } from '@/contexts/ChatContext';
import { CHAT_SESSIONS_MAX } from '@/lib/constants';
import {
  isPlaceholderSession,
  normalizeStoredSessions,
  normalizeSyncTombstones,
  createEmptySession,
} from '@/lib/storage/chat-normalize';
import { prepareSessionsForStorage, type ChatSyncAuth } from '@/lib/storage/chat-store';
import { buildIncrementalSyncPayload } from '@/lib/storage/chat-sync-delta';

export interface ChatSyncResponse {
  ok?: boolean;
  sessions?: unknown;
  activeSessionId?: string;
  tombstones?: unknown;
  updatedAt?: number;
  username?: string;
  assetMigrationWarning?: string;
  error?: string;
}

export interface ChatSyncSnapshot {
  sessions: ChatSession[];
  activeSessionId: string;
  tombstones: ChatSyncTombstone[];
}

export interface ChatSyncResult {
  updatedAt: number;
  applied: boolean;
  username?: string;
  assetMigrationWarning?: string;
}

interface UseChatSyncParams {
  sessions: ChatSession[];
  activeSessionId: string;
  syncTombstones: ChatSyncTombstone[];
  localMutationRevisionRef: MutableRefObject<number>;
  applyingSyncRef: MutableRefObject<boolean>;
  setSessions: (sessions: ChatSession[]) => void;
  setSyncTombstones: (value: ChatSyncTombstone[] | ((prev: ChatSyncTombstone[]) => ChatSyncTombstone[])) => void;
  setActiveSessionId: (id: string) => void;
  setStatusText: (text: string) => void;
  setStatusType: (type: '' | 'ok' | 'err' | 'warn') => void;
}

function tombstoneKey(tombstone: ChatSyncTombstone) {
  return `${tombstone.type}:${tombstone.sessionId || ''}:${tombstone.id}`;
}

export function mergeSyncTombstoneLists(
  local: ChatSyncTombstone[],
  incoming: ChatSyncTombstone[],
): ChatSyncTombstone[] {
  const incomingByKey = new Map(incoming.map((t) => [tombstoneKey(t), t]));
  // Local tombstones the server did not echo must survive, otherwise a pending
  // delete is silently undone. An echoed tombstone is acknowledged and loses
  // syncDirty — unless its local deletedAt is strictly newer, in which case the
  // server still needs to learn the newer stamp on the next sync.
  const retained = local
    .filter((t) => t.syncDirty === true || !incomingByKey.has(tombstoneKey(t)))
    .map((t) => {
      const echoed = incomingByKey.get(tombstoneKey(t));
      if (!echoed || t.syncDirty !== true) return t;
      return { ...t, syncDirty: t.deletedAt > echoed.deletedAt };
    });
  return normalizeSyncTombstones([...retained, ...incoming]);
}

export function mergeSyncedSessionList(
  local: ChatSession[],
  incoming: ChatSession[],
  tombstones: ChatSyncTombstone[],
): ChatSession[] {
  const byId = new Map<string, ChatSession>();
  for (const s of local) byId.set(s.id, s);
  for (const s of incoming) byId.set(s.id, s);

  const sessionDeletes = new Set<string>();
  const messageDeletes = new Set<string>();
  for (const t of tombstones) {
    if (t.type === 'session') sessionDeletes.add(t.id);
    else if (t.sessionId) messageDeletes.add(`${t.sessionId}:${t.id}`);
  }

  const merged = Array.from(byId.values())
    .filter((s) => !sessionDeletes.has(s.id))
    .map((s) => ({
      ...s,
      messages: s.messages.filter((m) => !messageDeletes.has(`${s.id}:${m.id}`)),
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, CHAT_SESSIONS_MAX);

  return merged.length > 0 ? merged : [createEmptySession()];
}

export function resolveSyncedActiveSessionId(
  sessions: ChatSession[],
  incomingActiveSessionId: string | undefined,
  currentActiveSessionId: string,
): string {
  if (incomingActiveSessionId && sessions.some((s) => s.id === incomingActiveSessionId)) {
    return incomingActiveSessionId;
  }
  // The server dropped/never knew the incoming active id — keep the local one
  // if it still exists, only then fall back to the first merged session.
  if (sessions.some((s) => s.id === currentActiveSessionId)) return currentActiveSessionId;
  return sessions[0]?.id || '';
}

export function useChatSync({
  sessions,
  activeSessionId,
  syncTombstones,
  localMutationRevisionRef,
  applyingSyncRef,
  setSessions,
  setSyncTombstones,
  setActiveSessionId,
  setStatusText,
  setStatusType,
}: UseChatSyncParams) {
  const getSyncSnapshot = useCallback(async (): Promise<ChatSyncSnapshot> => {
    const recentSessions = sessions.slice(0, CHAT_SESSIONS_MAX);
    const skipOnlyPlaceholder = recentSessions.length === 1
      && isPlaceholderSession(recentSessions[0])
      && syncTombstones.length === 0;
    const sessionsForSync = skipOnlyPlaceholder ? [] : recentSessions;
    const { storedSessions } = await prepareSessionsForStorage(sessionsForSync);
    return {
      sessions: storedSessions,
      activeSessionId: skipOnlyPlaceholder ? '' : activeSessionId,
      tombstones: syncTombstones,
    };
  }, [sessions, activeSessionId, syncTombstones]);

  const applySyncedSessions = useCallback((
    value: unknown,
    nextActiveSessionId?: string,
    tombstones?: unknown,
    applyOptions?: { silent?: boolean },
  ) => {
    applyingSyncRef.current = true;
    const incomingSessions = normalizeStoredSessions(value);
    const incomingTombstones = normalizeSyncTombstones(tombstones);

    // Session filtering must use the merged tombstone list — a locally
    // retained (not yet echoed) delete still applies to the UI.
    const mergedTombstones = mergeSyncTombstoneLists(syncTombstones, incomingTombstones);
    setSyncTombstones(mergedTombstones);

    const nextSessions = mergeSyncedSessionList(sessions, incomingSessions, mergedTombstones);
    setSessions(nextSessions);

    setActiveSessionId(resolveSyncedActiveSessionId(nextSessions, nextActiveSessionId, activeSessionId));

    if (!applyOptions?.silent) {
      setStatusText('聊天记录已同步');
      setStatusType('ok');
    }
    window.setTimeout(() => {
      applyingSyncRef.current = false;
    }, 0);
  }, [sessions, activeSessionId, syncTombstones, setSessions, setSyncTombstones, setActiveSessionId, setStatusText, setStatusType, applyingSyncRef]);

  const syncChatHistory = useCallback(async (
    auth: ChatSyncAuth,
    syncOptions?: { silent?: boolean }
  ): Promise<ChatSyncResult> => {
    const username = auth.username.trim();
    const secret = auth.secret;
    const clientKnownUpdatedAt = auth.clientKnownUpdatedAt || 0;
    
    if (!username || secret.length < 4) throw new Error('请输入玩家名和至少 4 位同步密钥');
    const requestRevision = localMutationRevisionRef.current;
    const snapshot = await getSyncSnapshot();
    
    const incremental = buildIncrementalSyncPayload(
      snapshot.sessions,
      snapshot.tombstones,
      clientKnownUpdatedAt,
    );

    const response = await fetch('/api/chat-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        secret,
        clientKnownUpdatedAt,
        sessions: incremental.sessions,
        activeSessionId: snapshot.activeSessionId,
        tombstones: incremental.tombstones,
      }),
    });
    const data = await response.json().catch(() => ({} as ChatSyncResponse)) as ChatSyncResponse;
    if (!response.ok || !data.ok) {
      const error = new Error(data.error || 'SYNC FAILED') as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    if (localMutationRevisionRef.current !== requestRevision) {
      return { updatedAt: clientKnownUpdatedAt, applied: false, username: data.username || username };
    }
    applySyncedSessions(data.sessions, data.activeSessionId, data.tombstones, syncOptions);
    return {
      updatedAt: data.updatedAt || Date.now(),
      applied: true,
      username: data.username || username,
      assetMigrationWarning: data.assetMigrationWarning,
    };
  }, [getSyncSnapshot, applySyncedSessions, localMutationRevisionRef]);

  return {
    getSyncSnapshot,
    applySyncedSessions,
    syncChatHistory,
  };
}
