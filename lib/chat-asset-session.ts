import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import type { NextRequest, NextResponse } from 'next/server';
import { CHAT_ASSET_SESSION_COOKIE } from '@/lib/constants';
import { isAnonymousChatAssetSessionId } from '@/lib/chat-asset-session-id';
import { prisma } from '@/lib/prisma';

const USER_SESSION_TOKEN_PATTERN = /^usr_([a-f0-9]{32})\.([a-f0-9-]{1,64})\.([a-f0-9]{64})$/;

export {
  isAnonymousChatAssetSessionId,
  isChatAssetSessionId,
} from '@/lib/chat-asset-session-id';

export interface ChatAssetSession {
  id: string;
  cookieValue: string;
}

export type ChatAssetUserSecretResolver = (userId: string) => Promise<string | null>;

export function getAnonymousChatAssetSessionId(request: NextRequest) {
  const value = request.cookies.get(CHAT_ASSET_SESSION_COOKIE)?.value || '';
  return isAnonymousChatAssetSessionId(value) ? value : null;
}

function userAssetSessionId(userId: string) {
  return `usr_${createHash('sha256').update(userId).digest('hex').slice(0, 32)}`;
}

function signUserAssetSession(sessionId: string, userSecretHash: string) {
  return createHmac('sha256', userSecretHash)
    .update(`chat-asset-session:${sessionId}`)
    .digest('hex');
}

function safeEqualHex(a: string, b: string) {
  if (!/^[a-f0-9]+$/i.test(a) || !/^[a-f0-9]+$/i.test(b) || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

async function resolveUserSecretFromDatabase(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { secret: true },
  });
  return user?.secret || null;
}

export function createUserChatAssetSession(userId: string, userSecretHash: string): ChatAssetSession {
  const sessionId = userAssetSessionId(userId);
  return {
    id: sessionId,
    cookieValue: `${sessionId}.${userId}.${signUserAssetSession(sessionId, userSecretHash)}`,
  };
}

export async function readSignedUserChatAssetSession(
  value: string,
  resolveUserSecret: ChatAssetUserSecretResolver = resolveUserSecretFromDatabase,
): Promise<ChatAssetSession | null> {
  const match = USER_SESSION_TOKEN_PATTERN.exec(value);
  if (!match) return null;

  const sessionId = `usr_${match[1]}`;
  const userId = match[2];
  const signature = match[3];
  if (sessionId !== userAssetSessionId(userId)) return null;

  const userSecretHash = await resolveUserSecret(userId);
  if (!userSecretHash) return null;

  const expected = signUserAssetSession(sessionId, userSecretHash);
  if (!safeEqualHex(signature, expected)) return null;
  return { id: sessionId, cookieValue: value };
}

export async function getChatAssetSession(
  request: NextRequest,
  resolveUserSecret: ChatAssetUserSecretResolver = resolveUserSecretFromDatabase,
): Promise<ChatAssetSession> {
  const existing = request.cookies.get(CHAT_ASSET_SESSION_COOKIE)?.value || '';
  const signedSession = await readSignedUserChatAssetSession(existing, resolveUserSecret);
  if (signedSession) return signedSession;
  if (isAnonymousChatAssetSessionId(existing)) return { id: existing, cookieValue: existing };

  const sessionId = randomBytes(16).toString('hex');
  return { id: sessionId, cookieValue: sessionId };
}

function shouldUseSecureCookie(request: NextRequest) {
  const configured = (process.env.CHAT_ASSET_COOKIE_SECURE || 'auto').trim().toLowerCase();
  if (configured === 'true') return true;
  if (configured === 'false') return false;

  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
  if (forwardedProto) return forwardedProto === 'https';
  return request.nextUrl.protocol === 'https:';
}

export function setChatAssetSession(response: NextResponse, session: ChatAssetSession, request: NextRequest) {
  response.cookies.set(CHAT_ASSET_SESSION_COOKIE, session.cookieValue, {
    httpOnly: true,
    sameSite: 'lax',
    secure: shouldUseSecureCookie(request),
    path: '/',
    maxAge: 365 * 24 * 60 * 60,
  });
}

export function clearChatAssetSession(response: NextResponse, request: NextRequest) {
  response.cookies.set(CHAT_ASSET_SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: shouldUseSecureCookie(request),
    path: '/',
    maxAge: 0,
  });
}
