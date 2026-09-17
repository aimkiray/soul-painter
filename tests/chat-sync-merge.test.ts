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

describe('mergeSyncedSessionList dirty/ack semantics', () => {
  it('clears message syncDirty when the server echoes it back', () => {
    // The server re-stamps stored entities with its own clock, so the echo
    // is always >= the local stamp — an acknowledged upload must go clean
    // or it would be re-sent on every single sync.
    const local = [session('s1', 100)];
    local[0].messages = [{
      id: 'm1', role: 'bot', prompt: '', images: [], text: 'hi', thinking: '',
      thinkingDone: true, code: '', extra: '', createdAt: 50, updatedAt: 80, syncDirty: true,
    }];
    const echoed = [session('s1', 200)];
    echoed[0].messages = [{
      id: 'm1', role: 'bot', prompt: '', images: [], text: 'hi', thinking: '',
      thinkingDone: true, code: '', extra: '', createdAt: 50, updatedAt: 150, syncDirty: true,
    }];
    const merged = mergeSyncedSessionList(local, echoed, []);
    expect(merged[0].messages[0].syncDirty).toBe(false);
  });

  it('keeps message syncDirty when the echo is strictly older than the local edit', () => {
    const local = [session('s1', 300)];
    local[0].messages = [{
      id: 'm1', role: 'bot', prompt: '', images: [], text: 'edited locally', thinking: '',
      thinkingDone: true, code: '', extra: '', createdAt: 50, updatedAt: 290, syncDirty: true,
    }];
    const echoed = [session('s1', 200)];
    echoed[0].messages = [{
      id: 'm1', role: 'bot', prompt: '', images: [], text: 'hi', thinking: '',
      thinkingDone: true, code: '', extra: '', createdAt: 50, updatedAt: 150,
    }];
    const merged = mergeSyncedSessionList(local, echoed, []);
    expect(merged[0].messages[0]).toMatchObject({ text: 'edited locally', syncDirty: true });
  });

  it('does not trust an echoed syncDirty flag on a message new to this device', () => {
    // The server stores the client-controlled flag verbatim; another device
    // that uploaded dirty would otherwise re-dirty this device forever.
    const echoed = [session('s2', 200)];
    echoed[0].messages = [{
      id: 'm9', role: 'user', prompt: '', images: [], text: 'from device B', thinking: '',
      thinkingDone: true, code: '', extra: '', createdAt: 150, updatedAt: 150, syncDirty: true,
    }];
    echoed[0].syncDirty = true;
    const merged = mergeSyncedSessionList([session('local')], echoed, []);
    const synced = merged.find((s) => s.id === 's2');
    expect(synced?.syncDirty).toBe(false);
    expect(synced?.messages[0].syncDirty).toBe(false);
  });

  it('clears session syncDirty when the echo is at least as new', () => {
    const local = [{ ...session('s1', 100), syncDirty: true }];
    const echoed = [{ ...session('s1', 200), syncDirty: true }];
    const merged = mergeSyncedSessionList(local, echoed, []);
    expect(merged[0].syncDirty).toBe(false);
  });
});

describe('mergeSyncedSessionList image identity', () => {
  const localImage = (dataUrl: string, url?: string) => ({ dataUrl, url });

  it('pairs local dataUrls by url identity, not position', () => {
    // Local [A(unuploaded), B(uploaded)] synced as [B] — index pairing would
    // graft A's dataUrl onto B's asset URL.
    const local = [session('s1', 100)];
    local[0].messages = [{
      id: 'm1', role: 'bot', prompt: '', thinking: '', thinkingDone: true, code: '', extra: '',
      text: '', createdAt: 50,
      images: [localImage('data:image/png;base64,AAAA'), localImage('data:image/png;base64,BBBB', '/api/chat-assets/b')],
    }];
    const echoed = [session('s1', 200)];
    echoed[0].messages = [{
      id: 'm1', role: 'bot', prompt: '', thinking: '', thinkingDone: true, code: '', extra: '',
      text: '', createdAt: 50,
      images: [{ url: '/api/chat-assets/b' }],
    }];
    const merged = mergeSyncedSessionList(local, echoed, []);
    const images = merged[0].messages[0].images;
    // B keeps its own dataUrl; A survives as a trailing local-only entry.
    expect(images).toEqual([
      { url: '/api/chat-assets/b', dataUrl: 'data:image/png;base64,BBBB' },
      { dataUrl: 'data:image/png;base64,AAAA', url: undefined },
    ]);
  });

  it('does not graft a local dataUrl onto an unrelated synced image', () => {
    const local = [session('s1', 100)];
    local[0].messages = [{
      id: 'm1', role: 'bot', prompt: '', thinking: '', thinkingDone: true, code: '', extra: '',
      text: '', createdAt: 50,
      images: [localImage('data:image/png;base64,AAAA')],
    }];
    const echoed = [session('s1', 200)];
    echoed[0].messages = [{
      id: 'm1', role: 'bot', prompt: '', thinking: '', thinkingDone: true, code: '', extra: '',
      text: '', createdAt: 50,
      images: [{ url: '/api/chat-assets/other' }],
    }];
    const merged = mergeSyncedSessionList(local, echoed, []);
    const images = merged[0].messages[0].images;
    expect(images[0].url).toBe('/api/chat-assets/other');
    expect(images[0].dataUrl).toBeUndefined();
    expect(images[1]?.dataUrl).toBe('data:image/png;base64,AAAA');
  });
});
