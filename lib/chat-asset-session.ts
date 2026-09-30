import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import type { NextRequest, NextResponse } from 'next/server';
import { CHAT_ASSET_SESSION_COOKIE } from '@/lib/constants';
import { prepareDatabase, prisma } from '@/lib/prisma';

const USER_SESSION_TOKEN_PATTERN = /^usr_([a-f0-9]{32})\.([a-f0-9-]{1,64})\.([a-f0-9]{64})$/;
const ANONYMOUS_SIGNED_SESSION_PATTERN = /^([a-f0-9]{32})\.([a-f0-9]{64})$/;

export {
  isAnonymousChatAssetSessionId,
  isChatAssetSessionId,
} from '@/lib/chat-asset-session-id';

export interface ChatAssetSession {
  id: string;
  cookieValue: string;
}

export type ChatAssetUserSecretResolver = (userId: string) => Promise<string | null>;

// Per-process fallback: with no configured secret the old code accepted any
// well-formed id UNSIGNED — a known session id then granted full read/write
// to that session's assets. Anonymous sessions dying with the process is
// consistent with runtimeSecrets being memory-only anyway.
let fallbackAnonymousSecret = '';
function anonymousSessionSecret() {
  const configured = (
    process.env.CHAT_ASSET_SESSION_SECRET
    || process.env.SERVER_ACCESS_TOKEN
    || process.env.DEFAULT_API_KEY
    || ''
  ).trim();
  if (configured) return configured;
  if (!fallbackAnonymousSecret) fallbackAnonymousSecret = randomBytes(32).toString('hex');
  return fallbackAnonymousSecret;
}

function signAnonymousSessionId(sessionId: string, secret: string) {
  return createHmac('sha256', secret)
    .update(`chat-asset-session:${sessionId}`)
    .digest('hex');
}

function anonymousCookieValue(sessionId: string) {
  return `${sessionId}.${signAnonymousSessionId(sessionId, anonymousSessionSecret())}`;
}

function readAnonymousSessionId(value: string): string | null {
  const match = ANONYMOUS_SIGNED_SESSION_PATTERN.exec(value);
  if (!match) return null;
  if (!safeEqualHex(match[2], signAnonymousSessionId(match[1], anonymousSessionSecret()))) return null;
  return match[1];
}

export function getAnonymousChatAssetSessionId(request: NextRequest) {
  const value = request.cookies.get(CHAT_ASSET_SESSION_COOKIE)?.value || '';
  return readAnonymousSessionId(value);
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

// Every signed user-cookie validation hits this — including each asset GET,
// so a restored chat with N images would issue N queries. Cache positives
// briefly; negatives stay uncached so a just-created account resolves
// immediately, and the map is bounded.
const USER_SECRET_CACHE_MS = 60_000;
const userSecretCache = new Map<string, { secret: string; at: number }>();

async function resolveUserSecretFromDatabase(userId: string) {
  const cached = userSecretCache.get(userId);
  if (cached && Date.now() - cached.at < USER_SECRET_CACHE_MS) return cached.secret;
  // Runs on every signed user-cookie validation (asset GETs included) — make
  // sure the pragma'd connection exists before the first query rather than
  // relying on /api/chat-sync having initialized it.
  await prepareDatabase();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { secret: true },
  });
  const secret = user?.secret || null;
  if (secret) {
    if (userSecretCache.size > 500) userSecretCache.clear();
    userSecretCache.set(userId, { secret, at: Date.now() });
  } else {
    userSecretCache.delete(userId);
  }
  return secret;
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
  const anonymousId = readAnonymousSessionId(existing);
  if (anonymousId) return { id: anonymousId, cookieValue: anonymousCookieValue(anonymousId) };

  const sessionId = randomBytes(16).toString('hex');
  return { id: sessionId, cookieValue: anonymousCookieValue(sessionId) };
}

export function shouldUseSecureCookie(request: NextRequest) {
  // CHAT_ASSET_COOKIE_SECURE overrides the heuristic below:
  // '1'/'true' → always Secure; '0'/'false' → never (e.g. plain-HTTP deploys).
  const configured = (process.env.CHAT_ASSET_COOKIE_SECURE || 'auto').trim().toLowerCase();
  if (configured === '1' || configured === 'true') return true;
  if (configured === '0' || configured === 'false') return false;

  // Deployments should have nginx overwrite `X-Forwarded-Proto: $scheme` so
  // this reflects the real client-facing scheme, not a spoofable header.
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
