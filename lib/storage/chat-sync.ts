import { useCallback, type MutableRefObject } from 'react';
import type { ChatMessage, ChatReferenceImage, ChatSession, ChatSyncTombstone, ChatTurnSnapshot } from '@/contexts/ChatContext';
import type { ImageHit } from '@/types';
import { CHAT_MESSAGES_MAX, CHAT_SESSIONS_MAX } from '@/lib/constants';
import {
  isPlaceholderSession,
  normalizeStoredSessions,
  normalizeSyncTombstones,
  createEmptySession,
} from '@/lib/storage/chat-normalize';
import { prepareSessionsForStorage, type ChatSyncAuth } from '@/lib/storage/chat-store';
import { buildIncrementalSyncPayload, syncEntityStamp } from '@/lib/storage/chat-sync-delta';
import { clearLocalDataClearedMarker } from '@/lib/local-data-cleared';

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

// The synced copy of a tombstoned entity carrying a newer stamp means the
// entity was recreated server-side after the delete — resurrection wins and
// the local tombstone is dropped.
function tombstoneResurrectedBy(tombstone: ChatSyncTombstone, incoming: ChatSession[]): boolean {
  const session = tombstone.type === 'session'
    ? incoming.find((s) => s.id === tombstone.id)
    : incoming.find((s) => s.id === tombstone.sessionId);
  if (!session) return false;
  if (tombstone.type === 'session') return syncEntityStamp(session) > tombstone.deletedAt;
  const message = session.messages.find((m) => m.id === tombstone.id);
  return !!message && syncEntityStamp(message) > tombstone.deletedAt;
}

export function mergeSyncTombstoneLists(
  local: ChatSyncTombstone[],
  incoming: ChatSyncTombstone[],
  incomingSessions?: ChatSession[],
): ChatSyncTombstone[] {
  const incomingByKey = new Map(incoming.map((t) => [tombstoneKey(t), t]));
  const now = Date.now();
  // Local tombstones the server did not echo must survive, otherwise a pending
  // delete is silently undone. An echoed tombstone is acknowledged and loses
  // syncDirty — unless its local deletedAt is strictly newer, in which case the
  // server still needs to learn the newer stamp on the next sync. A stamp in
  // the future relative to now is client clock skew, though: keeping it dirty
  // would re-push it forever, so it is acknowledged too.
  const retained = local
    .filter((t) => !incomingSessions || !tombstoneResurrectedBy(t, incomingSessions))
    .filter((t) => t.syncDirty === true || !incomingByKey.has(tombstoneKey(t)))
    .map((t) => {
      const echoed = incomingByKey.get(tombstoneKey(t));
      if (!echoed || t.syncDirty !== true) return t;
      return { ...t, syncDirty: t.deletedAt > echoed.deletedAt && t.deletedAt <= now };
    });
  return normalizeSyncTombstones([...retained, ...incoming]);
}

// The newest edit stamp a message carries; updatedAt/editedAt are absent on
// older stored messages, so fall back to createdAt.
function syncedMessageStamp(message: ChatMessage) {
  return Math.max(message.updatedAt ?? 0, message.editedAt ?? 0, message.createdAt ?? 0);
}

// A synced image has no stable id — pair it with the local copy by value:
// the asset url for uploaded images, or the exact dataUrl for inline ones.
// Index-based pairing would graft a dataUrl onto an unrelated image whenever
// the server omitted an un-uploaded local entry and shifted the positions.
function imageMergeKey(image: ImageHit): string | null {
  if (image.url) return `u:${image.url}`;
  if (image.dataUrl) return `d:${image.dataUrl}`;
  return null;
}

function mergeSyncedImages(synced: ImageHit[], local: ImageHit[]): ImageHit[] {
  const pool = new Map<string, ImageHit[]>();
  for (const candidate of local) {
    const key = imageMergeKey(candidate);
    if (!key) continue;
    const bucket = pool.get(key);
    if (bucket) bucket.push(candidate);
    else pool.set(key, [candidate]);
  }
  const take = (key: string | null) => {
    if (!key) return undefined;
    const bucket = pool.get(key);
    const hit = bucket?.shift();
    if (bucket && bucket.length === 0) pool.delete(key);
    return hit;
  };

  const merged = synced.map((image) => {
    const localImage = take(imageMergeKey(image));
    if (!localImage) return image;
    return {
      ...image,
      dataUrl: image.dataUrl ?? localImage.dataUrl,
      url: image.url ?? localImage.url,
    };
  });
  // Un-uploaded local-only images (dataUrl, no url) never reached the server —
  // keep the ones not already matched, in their original relative order.
  for (const candidate of local) {
    if (candidate.url || !candidate.dataUrl) continue;
    if (take(imageMergeKey(candidate))) merged.push(candidate);
  }
  return merged;
}

function mergeSyncedRequest(synced: ChatTurnSnapshot | undefined, local: ChatTurnSnapshot | undefined) {
  if (!synced) return local;
  if (!local) return synced;
  const pool = new Map<string, ChatReferenceImage[]>();
  for (const reference of local.referenceImages) {
    const key = imageMergeKey(reference.image);
    if (!key) continue;
    const bucket = pool.get(key);
    if (bucket) bucket.push(reference);
    else pool.set(key, [reference]);
  }
  const take = (key: string | null) => {
    if (!key) return undefined;
    const bucket = pool.get(key);
    const hit = bucket?.shift();
    if (bucket && bucket.length === 0) pool.delete(key);
    return hit;
  };

  const referenceImages = synced.referenceImages.map((reference) => {
    const localReference = take(imageMergeKey(reference.image));
    if (!localReference) return reference;
    return {
      ...reference,
      image: { ...reference.image, dataUrl: reference.image.dataUrl ?? localReference.image.dataUrl },
      mask: reference.mask
        ? { ...reference.mask, dataUrl: reference.mask.dataUrl ?? localReference.mask?.dataUrl }
        : localReference.mask,
    };
  });
  for (const reference of local.referenceImages) {
    if (reference.image.url || !reference.image.dataUrl) continue;
    if (take(imageMergeKey(reference.image))) referenceImages.push(reference);
  }

  return {
    ...synced,
    referenceImages,
  };
}

// Per-message merge: an echoed message with a stamp at least as new as the
// local copy means the server holds that version — the local mutation is
// acknowledged, so syncDirty clears. (The echoed syncDirty flag itself is
// client-controlled metadata the server stores verbatim; it is not proof of
// a pending change and is never trusted.) A strictly-older echo keeps the
// local copy dirty so it is re-uploaded next round.
function mergeSyncedMessages(local: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>(local.map((message) => [message.id, message]));
  for (const synced of incoming) {
    const existing = byId.get(synced.id);
    if (!existing) {
      byId.set(synced.id, synced.syncDirty ? { ...synced, syncDirty: false } : synced);
      continue;
    }
    if (syncedMessageStamp(synced) < syncedMessageStamp(existing)) continue;
    byId.set(synced.id, {
      ...synced,
      code: synced.code || existing.code,
      serverRunId: synced.serverRunId ?? existing.serverRunId,
      images: mergeSyncedImages(synced.images, existing.images),
      request: mergeSyncedRequest(synced.request, existing.request),
      syncDirty: false,
    });
  }
  return [...byId.values()]
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(-CHAT_MESSAGES_MAX);
}

export function mergeSyncedSessionList(
  local: ChatSession[],
  incoming: ChatSession[],
  tombstones: ChatSyncTombstone[],
): ChatSession[] {
  const incomingById = new Map<string, ChatSession>(incoming.map((s) => [s.id, s]));

  const sessionDeletes = new Set<string>();
  const messageDeletes = new Set<string>();
  for (const t of tombstones) {
    if (t.type === 'session') {
      // A synced session newer than the tombstone was resurrected
      // server-side — the delete no longer applies.
      const resurrected = incomingById.get(t.id);
      if (resurrected && syncEntityStamp(resurrected) > t.deletedAt) continue;
      sessionDeletes.add(t.id);
    } else if (t.sessionId) {
      const resurrected = incomingById.get(t.sessionId)?.messages.find((m) => m.id === t.id);
      if (resurrected && syncEntityStamp(resurrected) > t.deletedAt) continue;
      messageDeletes.add(`${t.sessionId}:${t.id}`);
    }
  }

  const byId = new Map<string, ChatSession>();
  for (const s of local) byId.set(s.id, s);
  for (const synced of incoming) {
    const existing = byId.get(synced.id);
    if (!existing) {
      byId.set(synced.id, {
        ...synced,
        syncDirty: false,
        messages: synced.messages
          .map((message) => (message.syncDirty ? { ...message, syncDirty: false } : message))
          .slice(-CHAT_MESSAGES_MAX),
      });
      continue;
    }
    const base = syncEntityStamp(synced) > syncEntityStamp(existing) ? synced : existing;
    byId.set(synced.id, {
      ...base,
      updatedAt: Math.max(synced.updatedAt, existing.updatedAt),
      // An echo at least as new as the local copy acknowledges the local
      // mutation; a strictly-older echo keeps the session dirty for re-upload.
      syncDirty: syncEntityStamp(synced) < syncEntityStamp(existing) && existing.syncDirty === true,
      messages: mergeSyncedMessages(existing.messages, synced.messages),
    });
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
    const mergedTombstones = mergeSyncTombstoneLists(syncTombstones, incomingTombstones, incomingSessions);
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
    // A successful sync is an explicit (re-)authentication — it lifts the
    // local-data-cleared marker so storage writes resume.
    clearLocalDataClearedMarker();
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
