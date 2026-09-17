import { NextRequest, NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'crypto';
import { CHAT_MESSAGES_MAX, CHAT_SESSIONS_MAX } from '@/lib/constants';
import { checkRateLimit, clientIp, isRateLimited } from '@/lib/rate-limit';
import {
  copyChatAssetsBetweenSessions,
} from '@/lib/chat-assets';
import {
  createUserChatAssetSession,
  getAnonymousChatAssetSessionId,
  setChatAssetSession,
} from '@/lib/chat-asset-session';
import { prepareDatabase, prisma } from '@/lib/prisma';
import { decodeSyncMessageMetadata, encodeSyncMessageMetadata } from '@/lib/chat-sync-message';
import { readLimitedText } from '@/lib/limited-body';

const CHAT_SYNC_MAX_BODY_BYTES = 5 * 1024 * 1024;
const CHAT_SYNC_WRITE_RETRIES = 4;
const CHAT_SYNC_TX_OPTIONS = { timeout: 15_000, maxWait: 10_000 } as const;
const CHAT_SYNC_SESSION_LIMIT = 200;
const CHAT_SYNC_MESSAGE_LIMIT = 2000;
const CHAT_SYNC_TOMBSTONE_LIMIT = 500;
const CHAT_SYNC_NEW_SECRET_MIN = 6;
const CHAT_SYNC_AUTH_RATE_LIMIT = 10;
const CHAT_SYNC_AUTH_RATE_WINDOW_MS = 60_000;
const CHAT_SYNC_CREATE_RATE_LIMIT = 10;
const CHAT_SYNC_CREATE_RATE_WINDOW_MS = 60 * 60 * 1000;
const TITLE_SOURCES = new Set(['auto', 'manual', 'generated']);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function cleanString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

/** Message content keeps its original text (leading/trailing whitespace included). */
function rawString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function normalizeUsername(value: unknown) {
  return cleanString(value).slice(0, 32).toLowerCase();
}

function cleanNumber(value: unknown, fallback = Date.now()) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function cleanDate(value: unknown, fallback = Date.now()) {
  const date = new Date(cleanNumber(value, fallback));
  return Number.isFinite(date.getTime()) ? date : new Date(fallback);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hashSecret(username: string, secret: string) {
  return createHash('sha256')
    .update(`${username}\0${secret}`)
    .digest('hex');
}

class ChatSyncHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

interface ChatSyncUser {
  id: string;
  username: string;
  secret: string;
}

async function findUsersByNormalizedUsername(username: string) {
  return prisma.$queryRaw<ChatSyncUser[]>`
    SELECT id, username, secret
    FROM "User"
    WHERE lower(username) = ${username}
    ORDER BY "createdAt" ASC
    LIMIT 2
  `;
}

async function createChatSyncUser(username: string, secretHash: string): Promise<ChatSyncUser> {
  return withWriteRetry(() => prisma.user.upsert({
    where: { username },
    update: {},
    create: { username, secret: secretHash },
    select: { id: true, username: true, secret: true },
  }));
}

function safeSecretEqual(actual: string, expected: string) {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function entityStamp(value: Record<string, unknown>) {
  return cleanNumber(value.updatedAt, cleanNumber(value.createdAt, 0));
}

/** Dirty entities bypass the incremental gate but still lose to a strictly newer
 *  server record; equal stamps go to the client so both sides converge. */
function shouldAcceptClientEntity(
  value: Record<string, unknown>,
  clientKnownUpdatedAt: number,
  serverStamp?: number | null,
) {
  const clientStamp = entityStamp(value);
  if (value.syncDirty === true) return serverStamp == null || clientStamp >= serverStamp;
  return clientStamp > clientKnownUpdatedAt;
}

function shouldAcceptClientTombstone(
  value: Record<string, unknown>,
  clientKnownUpdatedAt: number,
  serverStamp?: number | null,
) {
  const clientStamp = cleanNumber(value.deletedAt, 0);
  if (value.syncDirty === true) return serverStamp == null || clientStamp >= serverStamp;
  return clientStamp > clientKnownUpdatedAt;
}

function parseImages(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isRetryableWriteError(error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code || '')
    : '';
  const message = error instanceof Error ? error.message : String(error);
  return code === 'P1008'
    || code === 'P2002'
    || code === 'P2028'
    || code === 'P2034'
    || /SQLITE_BUSY|database is locked|write conflict|deadlock|timed out/i.test(message);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withWriteRetry<T>(task: () => Promise<T>) {
  let lastError: unknown;
  for (let attempt = 0; attempt < CHAT_SYNC_WRITE_RETRIES; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (!isRetryableWriteError(error) || attempt === CHAT_SYNC_WRITE_RETRIES - 1) break;
      await sleep(40 * 2 ** attempt + Math.floor(Math.random() * 25));
    }
  }
  throw lastError;
}

export async function POST(request: NextRequest) {
  try {
    const limited = await readLimitedText(request, CHAT_SYNC_MAX_BODY_BYTES);
    if ('tooLarge' in limited) {
      return NextResponse.json({ error: '同步数据过大' }, { status: 413 });
    }
    const rawBody = limited.text;

    let body: Record<string, unknown> = {};
    try {
      const parsed = rawBody ? JSON.parse(rawBody) : {};
      body = asRecord(parsed) || {};
    } catch {
      return NextResponse.json({ error: '同步数据格式错误' }, { status: 400 });
    }

    const username = normalizeUsername(body.username);
    const secret = cleanString(body.secret);
    if (!username || secret.length < 4) {
      return NextResponse.json({ error: '请输入玩家名和至少 4 位同步密钥' }, { status: 400 });
    }

    const authRateKey = `chat-sync:${clientIp(request)}:${username}`;
    if (isRateLimited(authRateKey, CHAT_SYNC_AUTH_RATE_LIMIT, CHAT_SYNC_AUTH_RATE_WINDOW_MS)) {
      return NextResponse.json({ error: '玩家名或同步密钥错误' }, { status: 401 });
    }

    await prepareDatabase();

    const secretHash = hashSecret(username, secret);
    const existingUsers = await findUsersByNormalizedUsername(username);
    if (existingUsers.length > 1) {
      throw new ChatSyncHttpError('用户名大小写冲突，请使用最初创建时的名字大小写登录', 409);
    }
    if (existingUsers.length === 0 && secret.length < CHAT_SYNC_NEW_SECRET_MIN) {
      return NextResponse.json({ error: '新账号同步密钥至少需要 6 位' }, { status: 400 });
    }
    const user = existingUsers[0] ?? await (async () => {
      if (!checkRateLimit(`chat-sync-create:${clientIp(request)}`, CHAT_SYNC_CREATE_RATE_LIMIT, CHAT_SYNC_CREATE_RATE_WINDOW_MS)) {
        throw new ChatSyncHttpError('账号创建过于频繁，请稍后再试', 429);
      }
      return createChatSyncUser(username, secretHash);
    })();

    if (!safeSecretEqual(user.secret, secretHash)) {
      checkRateLimit(authRateKey, CHAT_SYNC_AUTH_RATE_LIMIT, CHAT_SYNC_AUTH_RATE_WINDOW_MS);
      return NextResponse.json({ error: '玩家名或同步密钥错误' }, { status: 401 });
    }

    const clientKnownUpdatedAt = cleanNumber(body.clientKnownUpdatedAt, 0);
    const responseDate = cleanDate(clientKnownUpdatedAt, 0);
    // Cap inbound entity counts so a hostile client cannot make the transaction
    // walk unbounded arrays.
    const clientSessions = (Array.isArray(body.sessions) ? body.sessions : []).slice(0, CHAT_SYNC_SESSION_LIMIT);
    const clientTombstones = (Array.isArray(body.tombstones) ? body.tombstones : []).slice(0, CHAT_SYNC_TOMBSTONE_LIMIT);
    const now = new Date();

    await withWriteRetry(() => prisma.$transaction(async (tx) => {
      const touchedSessionIds = new Set<string>();

      for (const value of clientSessions) {
        const rawSession = asRecord(value);
        if (!rawSession) continue;

        const sessionId = cleanString(rawSession.id);
        if (!sessionId) continue;

        const rawMessages = Array.isArray(rawSession.messages)
          ? rawSession.messages.slice(0, CHAT_SYNC_MESSAGE_LIMIT)
              .map(asRecord).filter((item): item is Record<string, unknown> => item !== null)
          : [];
        // Pre-filter: dirty entities always pass here and are re-checked against
        // the existing server row below before any write happens.
        const changedMessages = rawMessages.filter((message) => (
          shouldAcceptClientEntity(message, clientKnownUpdatedAt)
        ));
        if (!shouldAcceptClientEntity(rawSession, clientKnownUpdatedAt) && changedMessages.length === 0) continue;

        const title = cleanString(rawSession.title, '新聊天').slice(0, 24);
        const titleSource = TITLE_SOURCES.has(String(rawSession.titleSource))
          ? String(rawSession.titleSource)
          : 'auto';
        const createdAt = cleanDate(rawSession.createdAt, now.getTime());

        const existingSession = await tx.session.findUnique({
          where: { id: sessionId },
          select: {
            userId: true,
            updatedAt: true,
            deletedAt: true,
            titleSource: true,
          },
        });
        if (existingSession && existingSession.userId !== user.id) continue;
        if (existingSession?.deletedAt && existingSession.updatedAt > responseDate) continue;

        const sessionChanged = shouldAcceptClientEntity(
          rawSession,
          clientKnownUpdatedAt,
          existingSession ? existingSession.updatedAt.getTime() : null,
        );

        if (!existingSession) {
          const sessionCount = await tx.session.count({
            where: { userId: user.id, deletedAt: null },
          });
          if (sessionCount >= CHAT_SYNC_SESSION_LIMIT) {
            throw new ChatSyncHttpError(`会话数量已达上限（${CHAT_SYNC_SESSION_LIMIT}），请删除旧会话后再同步`, 400);
          }
          await tx.session.upsert({
            where: { id: sessionId },
            update: {},
            create: { id: sessionId, userId: user.id, title, titleSource, createdAt, updatedAt: now },
          });
          touchedSessionIds.add(sessionId);
        } else if (sessionChanged) {
          const protectsManualTitle = existingSession.updatedAt > responseDate
            && existingSession.titleSource === 'manual'
            && titleSource !== 'manual';
          if (!protectsManualTitle) {
            await tx.session.update({
              where: { id: sessionId },
              data: { title, titleSource, deletedAt: null, updatedAt: now },
            });
            touchedSessionIds.add(sessionId);
          }
        }

        for (const rawMsg of changedMessages) {
          const msgId = cleanString(rawMsg.id);
          if (!msgId) continue;

          const existingMessage = await tx.message.findUnique({
            where: { id: msgId },
            select: {
              sessionId: true,
              updatedAt: true,
              session: { select: { userId: true } },
            },
          });
          if (existingMessage && (existingMessage.session.userId !== user.id || existingMessage.sessionId !== sessionId)) {
            continue;
          }
          if (!shouldAcceptClientEntity(
            rawMsg,
            clientKnownUpdatedAt,
            existingMessage ? existingMessage.updatedAt.getTime() : null,
          )) {
            continue;
          }

          const role = rawMsg.role === 'user' ? 'user' : 'bot';
          const msgCreatedAt = cleanDate(rawMsg.createdAt, now.getTime());
          const text = rawString(rawMsg.text);
          const prompt = rawString(rawMsg.prompt);
          const code = rawString(rawMsg.code);
          const extra = encodeSyncMessageMetadata(rawMsg);
          const images = Array.isArray(rawMsg.images) ? JSON.stringify(rawMsg.images.slice(0, 10)) : '[]';

          if (existingMessage) {
            await tx.message.update({
              where: { id: msgId },
              data: { text, prompt, code, extra, images, deletedAt: null, updatedAt: now },
            });
          } else {
            const messageCount = await tx.message.count({
              where: { sessionId, deletedAt: null },
            });
            if (messageCount >= CHAT_SYNC_MESSAGE_LIMIT) {
              throw new ChatSyncHttpError(`单会话消息数量已达上限（${CHAT_SYNC_MESSAGE_LIMIT}），无法继续同步`, 400);
            }
            await tx.message.upsert({
              where: { id: msgId },
              update: {},
              create: {
                id: msgId,
                sessionId,
                role,
                text,
                prompt,
                code,
                extra,
                images,
                createdAt: msgCreatedAt,
                updatedAt: now,
              },
            });
          }
          touchedSessionIds.add(sessionId);
        }
      }

      for (const value of clientTombstones) {
        const tomb = asRecord(value);
        if (!tomb || !shouldAcceptClientTombstone(tomb, clientKnownUpdatedAt)) continue;

        const type = tomb.type;
        const tombId = cleanString(tomb.id);
        if (!tombId) continue;

        if (type === 'session') {
          const existingSession = await tx.session.findUnique({
            where: { id: tombId },
            select: { userId: true, updatedAt: true },
          });
          if (!existingSession || existingSession.userId !== user.id) continue;
          if (!shouldAcceptClientTombstone(tomb, clientKnownUpdatedAt, existingSession.updatedAt.getTime())) continue;
          if (tomb.syncDirty !== true && existingSession.updatedAt > responseDate) continue;
          await tx.session.update({
            where: { id: tombId },
            data: { deletedAt: now, updatedAt: now },
          });
        } else if (type === 'message') {
          const existingMessage = await tx.message.findUnique({
            where: { id: tombId },
            select: {
              sessionId: true,
              updatedAt: true,
              session: { select: { userId: true } },
            },
          });
          const sessionId = cleanString(tomb.sessionId);
          if (
            !existingMessage
            || existingMessage.session.userId !== user.id
            || (sessionId && existingMessage.sessionId !== sessionId)
            || !shouldAcceptClientTombstone(tomb, clientKnownUpdatedAt, existingMessage.updatedAt.getTime())
            || (tomb.syncDirty !== true && existingMessage.updatedAt > responseDate)
          ) {
            continue;
          }
          await tx.message.update({
            where: { id: tombId },
            data: { deletedAt: now, updatedAt: now },
          });
          touchedSessionIds.add(existingMessage.sessionId);
        }
      }

      for (const sessionId of touchedSessionIds) {
        await tx.session.updateMany({
          where: { id: sessionId, userId: user.id, deletedAt: null },
          data: { updatedAt: now },
        });
      }

      await tx.user.update({
        where: { id: user.id },
        data: { updatedAt: now },
      });
    }, CHAT_SYNC_TX_OPTIONS));

    const updatedSessions = await prisma.session.findMany({
      where: {
        userId: user.id,
        // gte (not gt) so rows sharing the client's known millisecond are not
        // missed; the client merges by id so re-sends are deduplicated.
        OR: [
          { updatedAt: { gte: responseDate } },
          { messages: { some: { updatedAt: { gte: responseDate } } } },
        ],
      },
      include: { messages: { orderBy: { createdAt: 'desc' }, take: CHAT_MESSAGES_MAX } },
      orderBy: { updatedAt: 'desc' },
      take: CHAT_SESSIONS_MAX,
    });

    const activeSessions = [];
    const newTombstones = [];

    for (const s of updatedSessions) {
      if (s.deletedAt) {
        newTombstones.push({ type: 'session', id: s.id, deletedAt: s.deletedAt.getTime() });
      } else {
        const msgs = [];
        // take:CHAT_MESSAGES_MAX above fetched the newest first; flip back to asc.
        for (const m of [...s.messages].reverse()) {
          if (m.deletedAt) {
            newTombstones.push({ type: 'message', id: m.id, sessionId: m.sessionId, deletedAt: m.deletedAt.getTime() });
          } else {
            const metadata = decodeSyncMessageMetadata(m.extra);
            msgs.push({
              id: m.id,
              role: m.role,
              createdAt: m.createdAt.getTime(),
              updatedAt: m.updatedAt.getTime(),
              text: m.text,
              prompt: m.prompt,
              code: m.code,
              extra: metadata.extra,
              thinking: metadata.thinking,
              thinkingDone: metadata.thinkingDone,
              request: metadata.request,
              editedAt: metadata.editedAt,
              images: parseImages(m.images),
            });
          }
        }

        activeSessions.push({
          id: s.id,
          title: s.title,
          titleSource: s.titleSource,
          createdAt: s.createdAt.getTime(),
          updatedAt: s.updatedAt.getTime(),
          messages: msgs.slice(-CHAT_MESSAGES_MAX),
        });
      }
    }

    const userAssetSession = createUserChatAssetSession(user.id, user.secret);
    const anonymousAssetSessionId = getAnonymousChatAssetSessionId(request);
    let assetMigrationWarning = '';
    if (anonymousAssetSessionId) {
      try {
        const migration = await copyChatAssetsBetweenSessions(anonymousAssetSessionId, userAssetSession.id);
        if (migration.failed.length > 0) {
          assetMigrationWarning = '部分聊天图片迁移失败，请稍后重新同步';
          console.warn('Some anonymous chat assets failed to migrate', {
            sourceSessionId: anonymousAssetSessionId,
            targetSessionId: userAssetSession.id,
            failed: migration.failed,
          });
        }
      } catch (error) {
        assetMigrationWarning = '部分聊天图片迁移失败，请稍后重新同步';
        console.warn('Failed to migrate anonymous chat assets', error);
      }
    }

    const response = NextResponse.json({
      ok: true,
      updatedAt: now.getTime(),
      sessions: activeSessions,
      tombstones: newTombstones,
      activeSessionId: cleanString(body.activeSessionId),
      username,
      assetMigrationWarning: assetMigrationWarning || undefined,
    });
    setChatAssetSession(response, userAssetSession, request);
    return response;
  } catch (error) {
    if (error instanceof ChatSyncHttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error(error);
    return NextResponse.json(
      { error: (error as Error).message || '聊天记录同步失败' },
      { status: 500 },
    );
  }
}
