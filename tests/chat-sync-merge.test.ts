import { describe, it, expect } from 'vitest';
import {
  mergeSyncedSessionList,
  mergeSyncTombstoneLists,
  resolveSyncedActiveSessionId,
} from '@/lib/storage/chat-sync';
import type { ChatSession, ChatSyncTombstone } from '@/contexts/ChatContext';

function session(id: string, updatedAt = 1_000): ChatSession {
  return { id, title: id, messages: [], createdAt: updatedAt, updatedAt };
}

describe('applySyncedSessions helpers', () => {
  it('keeps the current active session when the incoming id is empty or unknown', () => {
    const sessions = [session('a'), session('b')];
    expect(resolveSyncedActiveSessionId(sessions, undefined, 'b')).toBe('b');
    expect(resolveSyncedActiveSessionId(sessions, '', 'b')).toBe('b');
    expect(resolveSyncedActiveSessionId(sessions, 'not-a-session', 'b')).toBe('b');
  });

  it('uses the incoming active id when it exists, else falls back to the first session', () => {
    const sessions = [session('a'), session('b')];
    expect(resolveSyncedActiveSessionId(sessions, 'a', 'b')).toBe('a');
    expect(resolveSyncedActiveSessionId(sessions, undefined, 'gone')).toBe('a');
  });

  it('keeps local tombstones the server did not echo back', () => {
    const local: ChatSyncTombstone[] = [
      { type: 'session', id: 'old-session', deletedAt: 500, syncDirty: true },
    ];
    const incoming: ChatSyncTombstone[] = [
      { type: 'message', id: 'm1', sessionId: 's1', deletedAt: 600 },
    ];
    const merged = mergeSyncTombstoneLists(local, incoming);
    expect(merged.some((t) => t.type === 'session' && t.id === 'old-session' && t.syncDirty)).toBe(true);
    expect(merged.some((t) => t.type === 'message' && t.id === 'm1')).toBe(true);
  });

  it('clears syncDirty once the server echoes the tombstone', () => {
    // Re-marking an echoed tombstone dirty would re-push it every sync —
    // the bump in deletedAt then triggers another sync, forever.
    const local: ChatSyncTombstone[] = [
      { type: 'message', id: 'm1', sessionId: 's1', deletedAt: 500, syncDirty: true },
    ];
    const incoming: ChatSyncTombstone[] = [
      { type: 'message', id: 'm1', sessionId: 's1', deletedAt: 600 },
    ];
    const merged = mergeSyncTombstoneLists(local, incoming);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: 'm1', deletedAt: 600 });
    expect(merged[0].syncDirty).toBeFalsy();
  });

  it('clears syncDirty when the server echoes the same deletedAt', () => {
    // The common case: the server echoes back the exact tombstone we pushed.
    const local: ChatSyncTombstone[] = [
      { type: 'message', id: 'm1', sessionId: 's1', deletedAt: 500, syncDirty: true },
    ];
    const incoming: ChatSyncTombstone[] = [
      { type: 'message', id: 'm1', sessionId: 's1', deletedAt: 500 },
    ];
    const merged = mergeSyncTombstoneLists(local, incoming);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: 'm1', deletedAt: 500 });
    expect(merged[0].syncDirty).toBeFalsy();
  });

  it('keeps syncDirty when the local tombstone is newer than the echo', () => {
    const local: ChatSyncTombstone[] = [
      { type: 'message', id: 'm1', sessionId: 's1', deletedAt: 700, syncDirty: true },
    ];
    const incoming: ChatSyncTombstone[] = [
      { type: 'message', id: 'm1', sessionId: 's1', deletedAt: 600 },
    ];
    const merged = mergeSyncTombstoneLists(local, incoming);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: 'm1', deletedAt: 700, syncDirty: true });
  });

  it('applies tombstones when merging local and incoming sessions', () => {
    const merged = mergeSyncedSessionList(
      [session('local-only'), session('dead')],
      [session('remote')],
      [{ type: 'session', id: 'dead', deletedAt: 100 }],
    );
    expect(merged.map((s) => s.id).sort()).toEqual(['local-only', 'remote']);
  });
});
