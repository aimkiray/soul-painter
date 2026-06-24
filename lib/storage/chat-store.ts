import type { ImageHit } from '@/types';
import type { ChatMessage, ChatReferenceImage, ChatSession, ChatSyncTombstone, ChatTurnSnapshot } from '@/contexts/ChatContext';
import { imageHitToStoredUrl, toStoredChatImageHit } from '@/lib/chat-asset-client';
import {
  CHAT_MESSAGES_STORAGE_KEY,
  CHAT_SESSIONS_STORAGE_KEY,
  ACTIVE_CHAT_SESSION_STORAGE_KEY,
  CHAT_SYNC_SESSION_AUTH_STORAGE_KEY,
  CHAT_SYNC_TOMBSTONES_STORAGE_KEY,
  LAST_PROMPT_KEY,
  chatSessionPromptStorageKey,
  CHAT_MESSAGES_MAX,
  CHAT_SESSIONS_MAX,
} from '@/lib/constants';
import { get, set, del } from 'idb-keyval';

import {
  normalizeStoredMessages,
  normalizeStoredSessions,
  normalizeSyncTombstones,
  createEmptySession,
  isEmptyBotMessage,
  LEGACY_CHAT_TITLE,
} from '@/lib/storage/chat-normalize';

export interface ChatSyncAuth {
  username: string;
  secret: string;
  clientKnownUpdatedAt?: number;
}

function readSessionSyncAuthRecord(): Record<string, unknown> | null {
  try {
    const raw = JSON.parse(sessionStorage.getItem(CHAT_SYNC_SESSION_AUTH_STORAGE_KEY) || 'null') as unknown;
    return raw && typeof raw === 'object' && !Array.isArray(raw)
      ? raw as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export async function loadSyncTombstones(): Promise<ChatSyncTombstone[]> {
  try {
    const raw = await get(CHAT_SYNC_TOMBSTONES_STORAGE_KEY);
    return normalizeSyncTombstones(JSON.parse(raw || '[]'));
  } catch {
    return [];
  }
}

export function readSessionSyncAuth(): ChatSyncAuth | null {
  const raw = readSessionSyncAuthRecord();
  const username = typeof raw?.username === 'string' ? raw.username.trim() : '';
  const secret = typeof raw?.secret === 'string' ? raw.secret : '';
  const clientKnownUpdatedAt = typeof raw?.syncedAt === 'number' ? raw.syncedAt : undefined;
  return username && secret ? { username, secret, clientKnownUpdatedAt } : null;
}

export function persistSessionSyncAuth(auth: ChatSyncAuth, syncedAt: number) {
  try {
    sessionStorage.setItem(CHAT_SYNC_SESSION_AUTH_STORAGE_KEY, JSON.stringify({
      username: auth.username,
      secret: auth.secret,
      syncedAt,
    }));
  } catch {
    // ignore
  }
}

export async function loadLegacyStoredMessages(): Promise<ChatMessage[]> {
  try {
    const raw = await get(CHAT_MESSAGES_STORAGE_KEY);
    return normalizeStoredMessages(JSON.parse(raw || '[]'));
  } catch {
    return [];
  }
}

export async function loadChatState(): Promise<{ sessions: ChatSession[]; activeSessionId: string }> {
  try {
    const rawSessions = await get(CHAT_SESSIONS_STORAGE_KEY);
    const storedSessions = normalizeStoredSessions(
      JSON.parse(rawSessions || '[]'),
    );
    const migratedFromLegacy = storedSessions.length === 0;
    const sessions = migratedFromLegacy
      ? [createEmptySession(await loadLegacyStoredMessages(), LEGACY_CHAT_TITLE)]
      : storedSessions;

    const storedActiveSessionId = await get(ACTIVE_CHAT_SESSION_STORAGE_KEY) || '';
    const activeSessionId = sessions.some((session) => session.id === storedActiveSessionId)
      ? storedActiveSessionId
      : sessions[0].id;

    await migrateLegacyPromptToSession(activeSessionId);

    return { sessions, activeSessionId };
  } catch {
    const session = createEmptySession();
    return { sessions: [session], activeSessionId: session.id };
  }
}

export async function migrateLegacyPromptToSession(sessionId: string) {
  try {
    const legacyPrompt = localStorage.getItem(LAST_PROMPT_KEY);
    if (!legacyPrompt) return;
    const sessionPromptKey = chatSessionPromptStorageKey(sessionId);
    if (!localStorage.getItem(sessionPromptKey)) {
      localStorage.setItem(sessionPromptKey, legacyPrompt);
    }
    localStorage.removeItem(LAST_PROMPT_KEY);
  } catch {
    // ignore
  }
}

export function removeSessionPrompt(sessionId: string) {
  try {
    localStorage.removeItem(chatSessionPromptStorageKey(sessionId));
  } catch {
    // ignore
  }
}

export function stripHeavyMessageData(message: ChatMessage): ChatMessage {
  const images = message.images
    .map(toStoredChatImageHit)
    .filter((image): image is ImageHit => image !== null);

  return {
    ...message,
    code: '',
    images,
    request: stripHeavyTurnSnapshotData(message.request),
  };
}

export function stripHeavyTurnSnapshotData(request: ChatTurnSnapshot | undefined): ChatTurnSnapshot | undefined {
  if (!request) return undefined;
  const referenceImages = request.referenceImages
    .map((reference) => {
      const image = toStoredChatImageHit(reference.image);
      if (!image) return null;
      const mask = reference.mask ? toStoredChatImageHit(reference.mask) : null;
      return mask ? { image, mask } : { image };
    })
    .filter((reference): reference is ChatReferenceImage => reference !== null);
  return { ...request, referenceImages };
}

export async function persistStoredSessions(sessions: ChatSession[], activeSessionId: string) {
  const sessionCaps = [CHAT_SESSIONS_MAX, 10, 5, 1];
  const messageCaps = [CHAT_MESSAGES_MAX, 50, 20, 5, 0];

  for (const sessionCap of sessionCaps) {
    for (const messageCap of messageCaps) {
      const payload = sessions.slice(0, sessionCap).map((session) => ({
        ...session,
        messages: (messageCap === 0 ? [] : session.messages.slice(-messageCap)).map(stripHeavyMessageData),
      }));

      try {
        await set(CHAT_SESSIONS_STORAGE_KEY, JSON.stringify(payload));
        await set(ACTIVE_CHAT_SESSION_STORAGE_KEY, activeSessionId);
        await del(CHAT_MESSAGES_STORAGE_KEY);
        return;
      } catch {
        // Try a smaller storage payload below.
      }
    }
  }

  try {
    await del(CHAT_SESSIONS_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export async function prepareMessagesForStorage(messages: ChatMessage[]): Promise<{
  storedMessages: ChatMessage[];
  memoryMessages: ChatMessage[];
  changed: boolean;
}> {
  const storedMessages: ChatMessage[] = [];
  const memoryMessages: ChatMessage[] = [];
  let changed = false;

  for (const message of messages) {
    const storedImages: ImageHit[] = [];
    const memoryImages: ImageHit[] = [];

    for (const image of message.images) {
      const url = await imageHitToStoredUrl(image);
      if (url) {
        const storedImage = { url };
        storedImages.push(storedImage);
        memoryImages.push(storedImage);
        if (!image.url || image.url !== url) changed = true;
      } else if (image.dataUrl) {
        memoryImages.push({ dataUrl: image.dataUrl });
      }
    }

    const preparedRequest = await prepareTurnSnapshotForStorage(message.request);
    changed = changed || preparedRequest.changed;

    storedMessages.push({ ...message, images: storedImages, code: '', request: preparedRequest.storedRequest });
    memoryMessages.push({ ...message, images: memoryImages, request: preparedRequest.memoryRequest });
  }

  return { storedMessages, memoryMessages, changed };
}

export async function prepareImageHitForStorage(image: ImageHit | undefined): Promise<{
  storedImage?: ImageHit;
  memoryImage?: ImageHit;
  changed: boolean;
}> {
  if (!image) return { changed: false };
  const url = await imageHitToStoredUrl(image);
  if (url) {
    return {
      storedImage: { url },
      memoryImage: { url },
      changed: !image.url || image.url !== url,
    };
  }
  if (image.dataUrl) return { memoryImage: { dataUrl: image.dataUrl }, changed: false };
  return { changed: false };
}

export async function prepareTurnSnapshotForStorage(request: ChatTurnSnapshot | undefined): Promise<{
  storedRequest?: ChatTurnSnapshot;
  memoryRequest?: ChatTurnSnapshot;
  changed: boolean;
}> {
  if (!request) return { changed: false };

  const storedReferences: ChatReferenceImage[] = [];
  const memoryReferences: ChatReferenceImage[] = [];
  let changed = false;

  for (const reference of request.referenceImages) {
    const preparedImage = await prepareImageHitForStorage(reference.image);
    const preparedMask = await prepareImageHitForStorage(reference.mask);
    changed = changed || preparedImage.changed || preparedMask.changed;

    if (preparedImage.storedImage) {
      storedReferences.push(preparedMask.storedImage
        ? { image: preparedImage.storedImage, mask: preparedMask.storedImage }
        : { image: preparedImage.storedImage });
    }

    if (preparedImage.memoryImage) {
      memoryReferences.push(preparedMask.memoryImage
        ? { image: preparedImage.memoryImage, mask: preparedMask.memoryImage }
        : { image: preparedImage.memoryImage });
    }
  }

  return {
    storedRequest: { ...request, referenceImages: storedReferences },
    memoryRequest: { ...request, referenceImages: memoryReferences },
    changed,
  };
}

export async function prepareSessionsForStorage(sessions: ChatSession[]): Promise<{
  storedSessions: ChatSession[];
  memorySessions: ChatSession[];
  changed: boolean;
}> {
  const storedSessions: ChatSession[] = [];
  const memorySessions: ChatSession[] = [];
  let changed = false;

  for (const session of sessions) {
    const persistableMessages = isEmptyBotMessage(session.messages[session.messages.length - 1])
      ? session.messages.slice(0, -1)
      : session.messages;
    const recentMessages = persistableMessages.slice(-CHAT_MESSAGES_MAX);
    const prepared = await prepareMessagesForStorage(recentMessages);
    changed = changed || prepared.changed;
    storedSessions.push({ ...session, messages: prepared.storedMessages });
    memorySessions.push({ ...session, messages: prepared.memoryMessages });
  }

  return { storedSessions, memorySessions, changed };
}
