import type { ChatSession, ChatSyncTombstone } from '@/contexts/ChatContext';

export interface IncrementalSyncPayload {
  sessions: ChatSession[];
  tombstones: ChatSyncTombstone[];
}

export function syncEntityStamp(value: { createdAt?: number; updatedAt?: number }) {
  return typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt)
    ? value.updatedAt
    : typeof value.createdAt === 'number' && Number.isFinite(value.createdAt)
      ? value.createdAt
      : 0;
}

export function shouldSendSyncEntity(
  value: { createdAt?: number; updatedAt?: number; syncDirty?: boolean },
  clientKnownUpdatedAt: number,
) {
  return value.syncDirty === true || syncEntityStamp(value) > clientKnownUpdatedAt;
}

export function shouldSendSyncTombstone(tombstone: ChatSyncTombstone, clientKnownUpdatedAt: number) {
  return tombstone.syncDirty === true || tombstone.deletedAt > clientKnownUpdatedAt;
}

export function buildIncrementalSyncPayload(
  sessions: ChatSession[],
  tombstones: ChatSyncTombstone[],
  clientKnownUpdatedAt: number,
): IncrementalSyncPayload {
  const sessionsToSend = sessions
    .map((session) => {
      const messages = session.messages
        .filter((message) => shouldSendSyncEntity(message, clientKnownUpdatedAt))
        // syncDirty is client-internal bookkeeping — strip it so the server
        // never stores (and echoes back) a stale "pending" marker.
        .map((message) => (message.syncDirty ? { ...message, syncDirty: undefined } : message));
      if (!shouldSendSyncEntity(session, clientKnownUpdatedAt) && messages.length === 0) return null;
      return session.syncDirty
        ? { ...session, syncDirty: undefined, messages }
        : { ...session, messages };
    })
    .filter((session): session is ChatSession => session !== null);

  return {
    sessions: sessionsToSend,
    tombstones: tombstones
      .filter((tombstone) => shouldSendSyncTombstone(tombstone, clientKnownUpdatedAt))
      .map((tombstone) => (tombstone.syncDirty ? { ...tombstone, syncDirty: undefined } : tombstone)),
  };
}
