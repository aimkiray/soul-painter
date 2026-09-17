import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { CHAT_ASSET_SESSION_COOKIE } from '@/lib/constants';
import {
  createUserChatAssetSession,
  getChatAssetSession,
  isAnonymousChatAssetSessionId,
  isChatAssetSessionId,
  readSignedUserChatAssetSession,
} from '@/lib/chat-asset-session';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const USER_SECRET_HASH = 'a'.repeat(64);

function requestWithAssetSessionCookie(value: string): NextRequest {
  return {
    cookies: {
      get: (name: string) => (name === CHAT_ASSET_SESSION_COOKIE ? { value } : undefined),
    },
    headers: new Headers(),
    nextUrl: new URL('http://localhost'),
  } as unknown as NextRequest;
}

function tamperToken(token: string) {
  return `${token.slice(0, -1)}${token.endsWith('0') ? '1' : '0'}`;
}

describe('chat-asset-session', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('creates a valid signed user asset session', async () => {
    const session = createUserChatAssetSession(USER_ID, USER_SECRET_HASH);
    const resolvedUserIds: string[] = [];

    const verified = await readSignedUserChatAssetSession(session.cookieValue, async (userId) => {
      resolvedUserIds.push(userId);
      return USER_SECRET_HASH;
    });

    expect(isChatAssetSessionId(session.id)).toBe(true);
    expect(session.id.startsWith('usr_')).toBe(true);
    expect(verified).toEqual(session);
    expect(resolvedUserIds).toEqual([USER_ID]);
  });

  it('rejects forged signed user asset sessions', async () => {
    const session = createUserChatAssetSession(USER_ID, USER_SECRET_HASH);

    await expect(readSignedUserChatAssetSession(
      tamperToken(session.cookieValue),
      async () => USER_SECRET_HASH,
    )).resolves.toBeNull();
  });

  it('rejects signed user asset sessions for unknown users', async () => {
    const session = createUserChatAssetSession(USER_ID, USER_SECRET_HASH);

    await expect(readSignedUserChatAssetSession(
      session.cookieValue,
      async () => null,
    )).resolves.toBeNull();
  });

  it('keeps anonymous sessions separate from forged user tokens', async () => {
    // No signing secret: bare anonymous ids are accepted as-is (local dev mode).
    vi.stubEnv('CHAT_ASSET_SESSION_SECRET', '');
    vi.stubEnv('SERVER_ACCESS_TOKEN', '');
    vi.stubEnv('DEFAULT_API_KEY', '');
    const anonymousSessionId = 'b'.repeat(32);
    const signedSession = createUserChatAssetSession(USER_ID, USER_SECRET_HASH);

    await expect(getChatAssetSession(
      requestWithAssetSessionCookie(anonymousSessionId),
      async () => USER_SECRET_HASH,
    )).resolves.toEqual({
      id: anonymousSessionId,
      cookieValue: anonymousSessionId,
    });

    const fallback = await getChatAssetSession(
      requestWithAssetSessionCookie(tamperToken(signedSession.cookieValue)),
      async () => USER_SECRET_HASH,
    );

    expect(isAnonymousChatAssetSessionId(fallback.id)).toBe(true);
    expect(fallback.id).not.toBe(signedSession.id);
  });

  it('signs anonymous session cookies when a secret is configured', async () => {
    vi.stubEnv('CHAT_ASSET_SESSION_SECRET', 'test-anonymous-secret');
    const unsignedSessionId = 'b'.repeat(32);

    // An unsigned cookie is rejected and rotated into a signed session.
    const minted = await getChatAssetSession(
      requestWithAssetSessionCookie(unsignedSessionId),
      async () => USER_SECRET_HASH,
    );
    expect(isAnonymousChatAssetSessionId(minted.id)).toBe(true);
    expect(minted.id).not.toBe(unsignedSessionId);
    expect(minted.cookieValue).toMatch(/^[a-f0-9]{32}\.[a-f0-9]{64}$/);

    // The signed cookie value round-trips back to the same session id.
    await expect(getChatAssetSession(
      requestWithAssetSessionCookie(minted.cookieValue),
      async () => USER_SECRET_HASH,
    )).resolves.toEqual({
      id: minted.id,
      cookieValue: minted.cookieValue,
    });

    // A tampered signature is rejected and a fresh anonymous session is issued.
    const forged = await getChatAssetSession(
      requestWithAssetSessionCookie(tamperToken(minted.cookieValue)),
      async () => USER_SECRET_HASH,
    );
    expect(isAnonymousChatAssetSessionId(forged.id)).toBe(true);
    expect(forged.id).not.toBe(minted.id);
    expect(forged.cookieValue).toMatch(/^[a-f0-9]{32}\.[a-f0-9]{64}$/);
  });
});
