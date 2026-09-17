import { describe, expect, it } from 'vitest';
import { buildIncrementalSyncPayload } from '@/lib/storage/chat-sync-delta';
import type { ChatSession, ChatSyncTombstone } from '@/contexts/ChatContext';

function session(overrides: Partial<ChatSession>): ChatSession {
  return {
    id: 'session-1',
    title: 'Test',
    messages: [],
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

describe('chat-sync-delta', () => {
  it('sends dirty messages even when the local clock is behind the server cursor', () => {
    const payload = buildIncrementalSyncPayload([
      session({
        messages: [{
          id: 'message-1',
          role: 'user',
          prompt: 'new prompt',
          images: [],
          text: '',
          code: '',
          extra: '',
          createdAt: 1_000,
          updatedAt: 1_000,
          syncDirty: true,
        }],
      }),
    ], [], 10_000);

    expect(payload.sessions).toHaveLength(1);
    expect(payload.sessions[0].messages.map((message) => message.id)).toEqual(['message-1']);
  });

  it('does not send unchanged old messages just because their session changed', () => {
    const payload = buildIncrementalSyncPayload([
      session({
        syncDirty: true,
        updatedAt: 12_000,
        messages: [{
          id: 'old-message',
          role: 'bot',
          prompt: '',
          images: [],
          text: 'server should keep the newer copy',
          code: '',
          extra: '',
          createdAt: 1_000,
          updatedAt: 2_000,
        }],
      }),
    ], [], 10_000);

    expect(payload.sessions).toHaveLength(1);
    expect(payload.sessions[0].messages).toEqual([]);
  });

  it('sends dirty tombstones even when deletedAt is older than the server cursor', () => {
    const tombstones: ChatSyncTombstone[] = [{
      type: 'message',
      id: 'message-1',
      sessionId: 'session-1',
      deletedAt: 1_000,
      syncDirty: true,
    }];

    const sent = buildIncrementalSyncPayload([], tombstones, 10_000).tombstones;
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ id: 'message-1', deletedAt: 1_000 });
  });

  it('strips the client-internal syncDirty flag from everything it uploads', () => {
    const payload = buildIncrementalSyncPayload([
      session({
        syncDirty: true,
        updatedAt: 12_000,
        messages: [{
          id: 'message-1',
          role: 'user',
          prompt: 'p',
          images: [],
          text: '',
          code: '',
          extra: '',
          createdAt: 11_000,
          updatedAt: 11_000,
          syncDirty: true,
        }],
      }),
    ], [{
      type: 'message',
      id: 'old',
      sessionId: 'session-1',
      deletedAt: 11_000,
      syncDirty: true,
    }], 10_000);

    expect(payload.sessions[0].syncDirty).toBeUndefined();
    expect(payload.sessions[0].messages[0].syncDirty).toBeUndefined();
    expect(payload.tombstones[0].syncDirty).toBeUndefined();
  });
});
