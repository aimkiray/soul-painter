import { NextRequest, NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'crypto';
import { checkRateLimit, clientIp, isRateLimited } from '@/lib/rate-limit';
import {
  copyChatAssetsBetweenSessions,
} from '@/lib/chat-assets';
import {
  createUserChatAssetSession,
  getAnonymousChatAssetSessionId,
  setChatAssetSession,
} from '@/lib/chat-asset-session';
import { migrateRuntimeAssetSession } from '@/lib/server-runner';
import { prepareDatabase, prisma } from '@/lib/prisma';
import { decodeSyncMessageMetadata, encodeSyncMessageMetadata } from '@/lib/chat-sync-message';
import { acceptClientEntityStamp } from '@/lib/chat-sync-lww';
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
// Per-field size cap inside the 5MB body budget: a single text/prompt/code/
// extra field can never exceed ~2MB of characters.
const CHAT_SYNC_MAX_FIELD_CHARS = 2 * 1024 * 1024;
// Entity ids are client-generated but should never be unbounded key strings.
const CHAT_SYNC_ID_MAX_CHARS = 128;
// Global per-request cap on entities processed inside the write transaction
// (sessions + messages + tombstones combined) so one request cannot force
// hundreds of thousands of row ops; the client re-syncs the remainder.
const CHAT_SYNC_MAX_PROCESSED_ENTITIES = 8_000;
// Tolerated client clock skew: incoming entity stamps may be at most this far
// in the future before they are clamped for compare/store.
const CHAT_SYNC_CLOCK_SKEW_MS = 60_000;
const TITLE_SOURCES = new Set(['auto', 'manual', 'generated']);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function cleanString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

/** Message content keeps its original text (leading/trailing whitespace
 *  included) but is capped per field so one entity cannot smuggle in a
 *  multi-MB string under the body limit. */
function rawString(value: unknown, fallback = '') {
  const text = typeof value === 'string' ? value : fallback;
  return text.length > CHAT_SYNC_MAX_FIELD_CHARS ? text.slice(0, CHAT_SYNC_MAX_FIELD_CHARS) : text;
}

/** Bounded-length id: clients generate these, so cap them before they are
 *  used as primary keys. */
function cleanId(value: unknown) {
  return cleanString(value).slice(0, CHAT_SYNC_ID_MAX_CHARS);
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

/** Clamp a client-supplied ms stamp into [0, maxStamp]; stamps beyond the
 *  skew window cannot inflate comparisons or get stored as far-future dates. */
function clampStamp(value: number, maxStamp: number) {
  return Math.min(Math.max(value, 0), maxStamp);
}

function cleanClampedDate(value: unknown, fallbackMs: number, maxStamp: number) {
  return cleanDate(clampStamp(cleanNumber(value, fallbackMs), maxStamp), fallbackMs);
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

function entityStamp(value: Record<string, unknown>, maxStamp: number) {
  return clampStamp(cleanNumber(value.updatedAt, cleanNumber(value.createdAt, 0)), maxStamp);
}

// LWW compares client stamps to the row's stored clientStamp — both live in
// the client's clock domain. Rows written before the column existed have
// clientStamp=0; their updatedAt (a server stamp captured at write time) is a
// close-enough stand-in.
function rowClientStamp(row: { clientStamp: bigint | number | null; updatedAt: Date } | null | undefined) {
  if (!row) return null;
  const stored = Number(row.clientStamp || 0);
  return stored > 0 ? stored : row.updatedAt.getTime();
}

/** Thin wrapper: stamp extraction + clamping stays route-local; the
 *  acceptance rule itself lives in lib/chat-sync-lww for testability. */
function shouldAcceptClientEntity(
  value: Record<string, unknown>,
  responseStamp: number,
  serverStamp: number | null | undefined,
  maxStamp: number,
) {
  return acceptClientEntityStamp(entityStamp(value, maxStamp), responseStamp, serverStamp);
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
    const now = new Date();
    const nowMs = now.getTime();
    // Incoming entity stamps may lead the server clock slightly; clamp them to
    // now+skew before they are compared or stored.
    const maxClientStamp = nowMs + CHAT_SYNC_CLOCK_SKEW_MS;
    // The client cursor is attacker-controlled: clamp into [0, now] so a
    // far-future cursor cannot suppress every entity the client pushes.
    const responseStamp = Math.min(Math.max(clientKnownUpdatedAt, 0), nowMs);
    const responseDate = new Date(responseStamp);
    // Cap inbound entity counts so a hostile client cannot make the transaction
    // walk unbounded arrays.
    const clientSessions = (Array.isArray(body.sessions) ? body.sessions : []).slice(0, CHAT_SYNC_SESSION_LIMIT);
    const clientTombstones = (Array.isArray(body.tombstones) ? body.tombstones : []).slice(0, CHAT_SYNC_TOMBSTONE_LIMIT);
    // Set inside the transaction when the processed-entity budget (or a
    // storage cap) runs out; surfaced on the response so the client knows to
    // re-sync the remainder.
    let requestTruncated = false;
    // Tombstones accepted for rows that no longer exist still need an echo so
    // the client can acknowledge them — otherwise they stay dirty and are
    // re-pushed on every sync forever.
    let ackedTombstones: Array<{ type: string; id: string; sessionId?: string; deletedAt: number }> = [];
    // Server-side commit stamp produced inside the write transaction; the
    // response cursor uses it so rows committed later can never carry a stamp
    // at-or-below the cursor (which would skip them in future echoes).
    let committedStamp = 0;

    await withWriteRetry(() => prisma.$transaction(async (tx) => {
      const touchedSessionIds = new Set<string>();
      ackedTombstones = [];
      // Commit-ordered write stamp: user.updatedAt is already this account's
      // high-water mark (every write tx stamps it), so +1 keeps each commit's
      // stamp above every previously committed row for this user — a
      // late-committed row can never hide below the cursor we hand back.
      const currentUser = await tx.user.findUnique({
        where: { id: user.id },
        select: { updatedAt: true },
      });
      const writeMs = Math.max(Date.now(), (currentUser?.updatedAt.getTime() ?? 0) + 1);
      const writeStamp = new Date(writeMs);
      committedStamp = writeMs;
      // Per-attempt budget: retried transactions re-scan from scratch.
      let processedEntities = 0;
      requestTruncated = false;
      const takeEntity = () => {
        if (processedEntities >= CHAT_SYNC_MAX_PROCESSED_ENTITIES) {
          requestTruncated = true;
          return false;
        }
        processedEntities += 1;
        return true;
      };

      // Tombstones run before upserts: deletes shrink the live counts first,
      // so an account at the cap can still sync its way back under it instead
      // of having every push rejected by the (now non-fatal) cap check.
      for (const value of clientTombstones) {
        const tomb = asRecord(value);
        if (!tomb) continue;
        if (!takeEntity()) break;

        const type = tomb.type;
        if (type !== 'session' && type !== 'message') continue;
        const tombId = cleanId(tomb.id);
        if (!tombId) continue;
        const tombSessionId = cleanId(tomb.sessionId);
        const tombStamp = clampStamp(cleanNumber(tomb.deletedAt, 0), maxClientStamp);
        const ackTombstone = () => ackedTombstones.push(type === 'session'
          ? { type: 'session', id: tombId, deletedAt: tombStamp }
          : { type: 'message', id: tombId, sessionId: tombSessionId, deletedAt: tombStamp });
        // No responseStamp gate here: the cursor only says what the client
        // has SEEN, not what the server has applied — a delete stamped below
        // it must still delete (the row lookup below decides), or the tombstone
        // ack would silently drop the delete while the row lives on server-side.

        if (type === 'session') {
          const existingSession = await tx.session.findUnique({
            where: { id: tombId },
            select: { userId: true, updatedAt: true, clientStamp: true, deletedAt: true },
          });
          // No ack for rows owned by another user: the tombstone is invalid.
          if (existingSession && existingSession.userId !== user.id) continue;
          if (!existingSession || existingSession.deletedAt) {
            ackTombstone();
            continue;
          }
          // Stale delete (a newer client write exists): reject; the echoed row
          // resurrects the session client-side.
          if (tombStamp < (rowClientStamp(existingSession) ?? 0)) continue;
          await tx.session.update({
            where: { id: tombId },
            // deletedAt AND clientStamp both store the client-domain delete
            // stamp: a stale upsert arriving later must lose to this delete in
            // LWW (clientStamp), and echoed tombstones compare correctly
            // against client-side tombstones (deletedAt). updatedAt still
            // gets the server commit stamp for the echo cursor.
            data: { deletedAt: new Date(tombStamp), updatedAt: writeStamp, clientStamp: tombStamp },
          });
        } else if (type === 'message') {
          const existingMessage = await tx.message.findUnique({
            where: { id: tombId },
            select: {
              sessionId: true,
              updatedAt: true,
              clientStamp: true,
              deletedAt: true,
              session: { select: { userId: true } },
            },
          });
          if (existingMessage
            && (existingMessage.session.userId !== user.id
              || (tombSessionId && existingMessage.sessionId !== tombSessionId))) {
            continue;
          }
          if (!existingMessage || existingMessage.deletedAt) {
            ackTombstone();
            continue;
          }
          if (tombStamp < (rowClientStamp(existingMessage) ?? 0)) continue;
          await tx.message.update({
            where: { id: tombId },
            data: { deletedAt: new Date(tombStamp), updatedAt: writeStamp, clientStamp: tombStamp },
          });
          touchedSessionIds.add(existingMessage.sessionId);
        }
      }

      sessionLoop: for (const value of clientSessions) {
        const rawSession = asRecord(value);
        if (!rawSession) continue;

        const sessionId = cleanId(rawSession.id);
        if (!sessionId) continue;
        if (!takeEntity()) break;

        const rawMessages = Array.isArray(rawSession.messages)
          ? rawSession.messages.slice(0, CHAT_SYNC_MESSAGE_LIMIT)
              .map(asRecord).filter((item): item is Record<string, unknown> => item !== null)
          : [];
        const title = cleanString(rawSession.title, '新聊天').slice(0, 24);
        const titleSource = TITLE_SOURCES.has(String(rawSession.titleSource))
          ? String(rawSession.titleSource)
          : 'auto';
        const createdAt = cleanClampedDate(rawSession.createdAt, nowMs, maxClientStamp);

        const existingSession = await tx.session.findUnique({
          where: { id: sessionId },
          select: {
            userId: true,
            updatedAt: true,
            clientStamp: true,
            deletedAt: true,
            titleSource: true,
          },
        });
        if (existingSession && existingSession.userId !== user.id) continue;
        // A session tombstoned since the client's cursor stays deleted —
        // unless this push carries a strictly newer client stamp, which means
        // the user recreated it after deleting (LWW lets the upsert win).
        if (existingSession?.deletedAt
          && existingSession.updatedAt > responseDate
          && entityStamp(rawSession, maxClientStamp) <= existingSession.deletedAt.getTime()) continue;

        const sessionStamp = entityStamp(rawSession, maxClientStamp);
        const sessionChanged = shouldAcceptClientEntity(
          rawSession,
          responseStamp,
          rowClientStamp(existingSession),
          maxClientStamp,
        );
        // Nothing-to-do fast path — only safe once the stored row is known
        // (a slow-clock client's stamps can sit below the server cursor).
        if (!sessionChanged && rawMessages.length === 0) continue;

        if (!existingSession) {
          const sessionCount = await tx.session.count({
            where: { userId: user.id, deletedAt: null },
          });
          // Skip rather than abort the transaction: tombstones already ran, so
          // a delete-heavy payload still frees capacity, and the skipped entity
          // stays dirty client-side for a later retry.
          if (sessionCount >= CHAT_SYNC_SESSION_LIMIT) {
            requestTruncated = true;
            continue;
          }
          await tx.session.upsert({
            where: { id: sessionId },
            update: {},
            create: { id: sessionId, userId: user.id, title, titleSource, createdAt, updatedAt: writeStamp, clientStamp: sessionStamp },
          });
          touchedSessionIds.add(sessionId);
        } else if (sessionChanged) {
          const protectsManualTitle = existingSession.updatedAt > responseDate
            && existingSession.titleSource === 'manual'
            && titleSource !== 'manual';
          if (!protectsManualTitle) {
            await tx.session.update({
              where: { id: sessionId },
              data: { title, titleSource, deletedAt: null, updatedAt: writeStamp, clientStamp: sessionStamp },
            });
            touchedSessionIds.add(sessionId);
          }
        }

        for (const rawMsg of rawMessages) {
          if (!takeEntity()) break sessionLoop;
          const msgId = cleanId(rawMsg.id);
          if (!msgId) continue;

          const existingMessage = await tx.message.findUnique({
            where: { id: msgId },
            select: {
              sessionId: true,
              updatedAt: true,
              clientStamp: true,
              session: { select: { userId: true } },
            },
          });
          if (existingMessage && (existingMessage.session.userId !== user.id || existingMessage.sessionId !== sessionId)) {
            continue;
          }
          const messageStamp = entityStamp(rawMsg, maxClientStamp);
          if (!shouldAcceptClientEntity(rawMsg, responseStamp, rowClientStamp(existingMessage), maxClientStamp)) {
            continue;
          }

          const role = rawMsg.role === 'user' ? 'user' : 'bot';
          const msgCreatedAt = cleanClampedDate(rawMsg.createdAt, nowMs, maxClientStamp);
          const text = rawString(rawMsg.text);
          const prompt = rawString(rawMsg.prompt);
          const code = rawString(rawMsg.code);
          const extra = encodeSyncMessageMetadata({
            ...rawMsg,
            extra: rawString(rawMsg.extra),
            thinking: rawString(rawMsg.thinking),
          });
          const imagesJson = Array.isArray(rawMsg.images) ? JSON.stringify(rawMsg.images.slice(0, 10)) : '[]';
          const images = imagesJson.length <= CHAT_SYNC_MAX_FIELD_CHARS ? imagesJson : '[]';

          if (existingMessage) {
            await tx.message.update({
              where: { id: msgId },
              data: { text, prompt, code, extra, images, deletedAt: null, updatedAt: writeStamp, clientStamp: messageStamp },
            });
          } else {
            const messageCount = await tx.message.count({
              where: { sessionId, deletedAt: null },
            });
            if (messageCount >= CHAT_SYNC_MESSAGE_LIMIT) {
              requestTruncated = true;
              continue;
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
                updatedAt: writeStamp,
                clientStamp: messageStamp,
              },
            });
          }
          touchedSessionIds.add(sessionId);
        }
      }

      for (const sessionId of touchedSessionIds) {
        await tx.session.updateMany({
          where: { id: sessionId, userId: user.id, deletedAt: null },
          data: { updatedAt: writeStamp },
        });
      }

      await tx.user.update({
        where: { id: user.id },
        data: { updatedAt: writeStamp },
      });
    }, CHAT_SYNC_TX_OPTIONS));

    const updatedSessions = await withWriteRetry(() => prisma.session.findMany({
      where: {
        userId: user.id,
        // gte (not gt) so rows sharing the client's known millisecond are not
        // missed; the client merges by id so re-sends are deduplicated.
        OR: [
          { updatedAt: { gte: responseDate } },
          { messages: { some: { updatedAt: { gte: responseDate } } } },
        ],
      },
      // The response must cover the stored caps (200/2000), not the smaller
      // client-side display caps, or long histories never converge.
      include: { messages: { orderBy: { createdAt: 'desc' }, take: CHAT_SYNC_MESSAGE_LIMIT } },
      orderBy: { updatedAt: 'desc' },
      take: CHAT_SYNC_SESSION_LIMIT,
    }));

    const activeSessions = [];
    const newTombstones = [];

    for (const s of updatedSessions) {
      if (s.deletedAt) {
        newTombstones.push({ type: 'session', id: s.id, deletedAt: s.deletedAt.getTime() });
      } else {
        const msgs = [];
        // take:CHAT_SYNC_MESSAGE_LIMIT above fetched the newest first; flip back to asc.
        for (const m of [...s.messages].reverse()) {
          if (m.deletedAt) {
            newTombstones.push({ type: 'message', id: m.id, sessionId: m.sessionId, deletedAt: m.deletedAt.getTime() });
          } else {
            const metadata = decodeSyncMessageMetadata(m.extra);
            msgs.push({
              id: m.id,
              role: m.role,
              createdAt: m.createdAt.getTime(),
              // Echoed entity stamps are the client-domain clientStamp, not the
              // server commit stamp — merge comparisons run against local
              // client-clock stamps.
              updatedAt: rowClientStamp(m),
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
          updatedAt: rowClientStamp(s),
          messages: msgs.slice(-CHAT_SYNC_MESSAGE_LIMIT),
        });
      }
    }

    // Acknowledged tombstones for rows that no longer exist; the client drops
    // their syncDirty flags once it sees them echoed back.
    newTombstones.push(...ackedTombstones);

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
      // The response below swaps the cookie to the user session; in-flight
      // runs still holding the anonymous session id would otherwise write
      // result images into a dir the new cookie can never resolve.
      migrateRuntimeAssetSession(anonymousAssetSessionId, userAssetSession.id);
    }

    const response = NextResponse.json({
      ok: true,
      // Truncated merges must NOT advance the client cursor: unprocessed
      // entities sit below the new stamp and would never be re-sent. Hold the
      // cursor at the inbound value so the next incremental pass retries them.
      updatedAt: requestTruncated ? responseStamp : (committedStamp || now.getTime()),
      sessions: activeSessions,
      tombstones: newTombstones,
      activeSessionId: cleanString(body.activeSessionId),
      username,
      assetMigrationWarning: assetMigrationWarning || undefined,
      // True when the processed-entity budget stopped the merge early; the
      // client re-syncs the remainder on its next incremental pass.
      truncated: requestTruncated,
    });
    setChatAssetSession(response, userAssetSession, request);
    return response;
  } catch (error) {
    if (error instanceof ChatSyncHttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    // Internal detail is logged, never echoed — prisma/driver messages can
    // contain schema or query internals.
    console.error('Chat sync failed:', error);
    return NextResponse.json(
      { error: '同步失败，请稍后重试' },
      { status: 500 },
    );
  }
}
