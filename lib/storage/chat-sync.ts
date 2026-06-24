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
  setSyncTombstones: (tombstones: ChatSyncTombstone[]) => void;
  setActiveSessionId: (id: string) => void;
  setStatusText: (text: string) => void;
  setStatusType: (type: '' | 'ok' | 'err' | 'warn') => void;
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
    
    setSyncTombstones(incomingTombstones);
    
    const byId = new Map<string, ChatSession>();
    for (const s of sessions) byId.set(s.id, s);
    for (const s of incomingSessions) byId.set(s.id, s);
    
    const merged = Array.from(byId.values());
    const sessionDeletes = new Set<string>();
    const messageDeletes = new Set<string>();
    
    for (const t of incomingTombstones) {
      if (t.type === 'session') sessionDeletes.add(t.id);
      else if (t.sessionId) messageDeletes.add(`${t.sessionId}:${t.id}`);
    }
    
    let nextSessions = merged
      .filter(s => !sessionDeletes.has(s.id))
      .map(s => ({
         ...s,
         messages: s.messages.filter(m => !messageDeletes.has(`${s.id}:${m.id}`))
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, CHAT_SESSIONS_MAX);
      
    if (nextSessions.length === 0) nextSessions = [createEmptySession()];
    
    setSessions(nextSessions);
    
    setActiveSessionId(
      nextSessions.some(session => session.id === nextActiveSessionId)
        ? nextActiveSessionId as string
        : nextSessions[0].id
    );

    if (!applyOptions?.silent) {
      setStatusText('聊天记录已同步');
      setStatusType('ok');
    }
    window.setTimeout(() => {
      applyingSyncRef.current = false;
    }, 0);
  }, [sessions, setSessions, setSyncTombstones, setActiveSessionId, setStatusText, setStatusType, applyingSyncRef]);

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
