import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('idb-keyval', () => ({
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
}));

import { get } from 'idb-keyval';
import { loadChatState } from '@/lib/storage/chat-store';
import { CHAT_MESSAGES_STORAGE_KEY, CHAT_SESSIONS_STORAGE_KEY } from '@/lib/constants';

const getMock = vi.mocked(get);

describe('loadChatState', () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  it('reports loadFailed when storage reads throw', async () => {
    getMock.mockRejectedValue(new Error('idb unavailable'));
    const state = await loadChatState();
    expect(state.loadFailed).toBe(true);
    expect(state.sessions).toHaveLength(1);
    expect(state.activeSessionId).toBe(state.sessions[0].id);
  });

  it('reports loadFailed when the legacy message read fails', async () => {
    getMock.mockImplementation(async (key) => {
      if (key === CHAT_SESSIONS_STORAGE_KEY) return undefined;
      if (key === CHAT_MESSAGES_STORAGE_KEY) throw new Error('corrupt');
      return undefined;
    });
    const state = await loadChatState();
    expect(state.loadFailed).toBe(true);
  });

  it('omits loadFailed on a clean empty load', async () => {
    getMock.mockResolvedValue(undefined);
    const state = await loadChatState();
    expect(state.loadFailed).toBeFalsy();
    expect(state.sessions).toHaveLength(1);
    expect(state.activeSessionId).toBe(state.sessions[0].id);
  });

  it('omits loadFailed when stored sessions parse cleanly', async () => {
    getMock.mockImplementation(async (key) => {
      if (key === CHAT_SESSIONS_STORAGE_KEY) {
        return JSON.stringify([{ id: 's1', title: 'T', messages: [], createdAt: 1, updatedAt: 2 }]);
      }
      return undefined;
    });
    const state = await loadChatState();
    expect(state.loadFailed).toBeFalsy();
    expect(state.sessions[0].id).toBe('s1');
    expect(state.activeSessionId).toBe('s1');
  });
});
