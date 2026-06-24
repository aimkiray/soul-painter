import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { CHAT_MESSAGES_MAX, CHAT_SESSIONS_MAX } from '@/lib/constants';
import { prepareDatabase, prisma } from '@/lib/prisma';

const CHAT_SYNC_MAX_BODY_BYTES = 5 * 1024 * 1024;
const CHAT_SYNC_WRITE_RETRIES = 4;
const TITLE_SOURCES = new Set(['auto', 'manual', 'generated']);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function cleanString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
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
    .update(`${username.trim().toLowerCase()}\0${secret}`)
    .digest('hex');
}

function entityStamp(value: Record<string, unknown>) {
  return cleanNumber(value.updatedAt, cleanNumber(value.createdAt, 0));
}

function shouldAcceptClientEntity(value: Record<string, unknown>, clientKnownUpdatedAt: number) {
  return value.syncDirty === true || entityStamp(value) > clientKnownUpdatedAt;
}

function shouldAcceptClientTombstone(value: Record<string, unknown>, clientKnownUpdatedAt: number) {
  return value.syncDirty === true || cleanNumber(value.deletedAt, 0) > clientKnownUpdatedAt;
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
    const rawBody = await request.text().catch(() => '');
    if (new TextEncoder().encode(rawBody).length > CHAT_SYNC_MAX_BODY_BYTES) {
      return NextResponse.json({ error: '同步数据过大' }, { status: 413 });
    }

    let body: Record<string, unknown> = {};
    try {
      const parsed = rawBody ? JSON.parse(rawBody) : {};
      body = asRecord(parsed) || {};
    } catch {
      return NextResponse.json({ error: '同步数据格式错误' }, { status: 400 });
    }

    const username = cleanString(body.username).slice(0, 32);
    const secret = cleanString(body.secret);
    if (!username || secret.length < 4) {
      return NextResponse.json({ error: '请输入玩家名和至少 4 位同步密钥' }, { status: 400 });
    }

    await prepareDatabase();

    const secretHash = hashSecret(username, secret);
    const user = await withWriteRetry(() => prisma.user.upsert({
      where: { username },
      update: {},
      create: { username, secret: secretHash },
    }));

    if (user.secret !== secretHash) {
      return NextResponse.json({ error: '同步密钥错误' }, { status: 401 });
    }

    const clientKnownUpdatedAt = cleanNumber(body.clientKnownUpdatedAt, 0);
    const responseDate = cleanDate(clientKnownUpdatedAt, 0);
    const clientSessions = Array.isArray(body.sessions) ? body.sessions : [];
    const clientTombstones = Array.isArray(body.tombstones) ? body.tombstones : [];
    const now = new Date();

    await withWriteRetry(() => prisma.$transaction(async (tx) => {
      const touchedSessionIds = new Set<string>();

      for (const value of clientSessions) {
        const rawSession = asRecord(value);
        if (!rawSession) continue;

        const sessionId = cleanString(rawSession.id);
        if (!sessionId) continue;

        const rawMessages = Array.isArray(rawSession.messages)
          ? rawSession.messages.map(asRecord).filter((item): item is Record<string, unknown> => item !== null)
          : [];
        const changedMessages = rawMessages.filter((message) => (
          shouldAcceptClientEntity(message, clientKnownUpdatedAt)
        ));
        const sessionChanged = shouldAcceptClientEntity(rawSession, clientKnownUpdatedAt);
        if (!sessionChanged && changedMessages.length === 0) continue;

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

        if (!existingSession) {
          await tx.session.create({
            data: { id: sessionId, userId: user.id, title, titleSource, createdAt, updatedAt: now },
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
              session: { select: { userId: true } },
            },
          });
          if (existingMessage && (existingMessage.session.userId !== user.id || existingMessage.sessionId !== sessionId)) {
            continue;
          }

          const role = rawMsg.role === 'user' ? 'user' : 'bot';
          const msgCreatedAt = cleanDate(rawMsg.createdAt, now.getTime());
          const text = cleanString(rawMsg.text);
          const prompt = cleanString(rawMsg.prompt);
          const code = cleanString(rawMsg.code);
          const extra = cleanString(rawMsg.extra);
          const images = Array.isArray(rawMsg.images) ? JSON.stringify(rawMsg.images.slice(0, 10)) : '[]';

          if (existingMessage) {
            await tx.message.update({
              where: { id: msgId },
              data: { text, prompt, code, extra, images, deletedAt: null, updatedAt: now },
            });
          } else {
            await tx.message.create({
              data: {
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
          if (!existingSession || existingSession.userId !== user.id || existingSession.updatedAt > responseDate) continue;
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
            || existingMessage.updatedAt > responseDate
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
    }));

    const updatedSessions = await prisma.session.findMany({
      where: {
        userId: user.id,
        OR: [
          { updatedAt: { gt: responseDate } },
          { messages: { some: { updatedAt: { gt: responseDate } } } },
        ],
      },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
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
        for (const m of s.messages) {
          if (m.deletedAt) {
            newTombstones.push({ type: 'message', id: m.id, sessionId: m.sessionId, deletedAt: m.deletedAt.getTime() });
          } else {
            msgs.push({
              id: m.id,
              role: m.role,
              createdAt: m.createdAt.getTime(),
              updatedAt: m.updatedAt.getTime(),
              text: m.text,
              prompt: m.prompt,
              code: m.code,
              extra: m.extra,
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

    return NextResponse.json({
      ok: true,
      updatedAt: now.getTime(),
      sessions: activeSessions,
      tombstones: newTombstones,
      activeSessionId: cleanString(body.activeSessionId),
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: (error as Error).message || '聊天记录同步失败' },
      { status: 500 },
    );
  }
}
