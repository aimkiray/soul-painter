import type { ImageHit } from '@/types';
import type { ChatMessage, ChatReferenceImage, ChatSession, ChatSyncTombstone, ChatTurnSnapshot } from '@/contexts/ChatContext';
import { normalizeChatImageHit } from '@/lib/chat-asset-client';
import { normalizeChatTitle } from '@/lib/title';
import { CHAT_MESSAGES_MAX, CHAT_SESSIONS_MAX } from '@/lib/constants';

export const DEFAULT_CHAT_TITLE = '新聊天';
export const LEGACY_CHAT_TITLE = '默认聊天';
export const SESSION_TITLE_MAX = 24;
export const EMPTY_MESSAGES: ChatMessage[] = [];
export const FALLBACK_SESSION_ID = '__initial_chat_session__';
export const FALLBACK_SESSION_TIME = 0;

export function createSessionId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createMessageId() {
  return createSessionId();
}

export function createChatMessage(
  message: Pick<ChatMessage, 'role' | 'prompt' | 'images' | 'text' | 'code' | 'extra'> & {
    thinking?: string;
    thinkingDone?: boolean;
    request?: ChatTurnSnapshot;
    serverRunId?: string;
  },
  id = createMessageId(),
): ChatMessage {
  return {
    ...message,
    id,
    createdAt: Date.now(),
    syncDirty: true,
  };
}

export function normalizeSessionTitle(value: unknown, fallback = DEFAULT_CHAT_TITLE) {
  const title = normalizeChatTitle(value, { fallback, maxLength: SESSION_TITLE_MAX, appendEllipsis: true });
  if (!title) return fallback;
  return title;
}

export function sessionTitleFromMessages(messages: ChatMessage[], fallback = DEFAULT_CHAT_TITLE) {
  const firstPrompt = messages.find((message) => message.role === 'user' && message.prompt.trim())?.prompt;
  return normalizeSessionTitle(firstPrompt, fallback);
}

export function isAutoManagedSessionTitle(session: ChatSession) {
  if (session.titleSource === 'generated' || session.titleSource === 'manual') return false;
  return session.title === DEFAULT_CHAT_TITLE
    || session.title === LEGACY_CHAT_TITLE
    || session.title === sessionTitleFromMessages(session.messages, session.title);
}

export function inferTitleSource(title: string, messages: ChatMessage[]): ChatSession['titleSource'] {
  return title === DEFAULT_CHAT_TITLE
    || title === LEGACY_CHAT_TITLE
    || title === sessionTitleFromMessages(messages, title)
      ? 'auto'
      : 'manual';
}

export function createEmptySession(messages: ChatMessage[] = [], title?: string): ChatSession {
  const now = Date.now();
  const normalizedTitle = normalizeSessionTitle(title || sessionTitleFromMessages(messages));
  return {
    id: createSessionId(),
    title: normalizedTitle,
    titleSource: inferTitleSource(normalizedTitle, messages),
    messages: messages.slice(-CHAT_MESSAGES_MAX),
    createdAt: now,
    updatedAt: now,
    syncDirty: true,
  };
}

export function createFallbackChatState(): { sessions: ChatSession[]; activeSessionId: string } {
  const session: ChatSession = {
    id: FALLBACK_SESSION_ID,
    title: DEFAULT_CHAT_TITLE,
    titleSource: 'auto',
    messages: [],
    createdAt: FALLBACK_SESSION_TIME,
    updatedAt: FALLBACK_SESSION_TIME,
  };
  return { sessions: [session], activeSessionId: session.id };
}

export function normalizeStoredMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((message): message is Partial<ChatMessage> => !!message && typeof message === 'object')
    .map((message): ChatMessage => ({
      id: typeof message.id === 'string' && message.id.trim() ? message.id : createMessageId(),
      role: message.role === 'user' ? 'user' : 'bot',
      prompt: typeof message.prompt === 'string' ? message.prompt : '',
      images: Array.isArray(message.images)
        ? message.images
            .map(normalizeChatImageHit)
            .filter((image): image is ImageHit => image !== null)
        : [],
      text: typeof message.text === 'string' ? message.text : '',
      thinking: typeof message.thinking === 'string' ? message.thinking : '',
      thinkingDone: typeof message.thinkingDone === 'boolean' ? message.thinkingDone : true,
      code: typeof message.code === 'string' ? message.code : '',
      extra: typeof message.extra === 'string' ? message.extra : '',
      request: normalizeStoredTurnSnapshot(message.request),
      createdAt: typeof message.createdAt === 'number' && Number.isFinite(message.createdAt) ? message.createdAt : Date.now(),
      updatedAt: typeof message.updatedAt === 'number' && Number.isFinite(message.updatedAt) ? message.updatedAt : undefined,
      editedAt: typeof message.editedAt === 'number' && Number.isFinite(message.editedAt) ? message.editedAt : undefined,
      syncDirty: message.syncDirty === true,
      serverRunId: typeof message.serverRunId === 'string' && message.serverRunId.trim() ? message.serverRunId : undefined,
    }))
    .slice(-CHAT_MESSAGES_MAX);
}

export function normalizeStoredReferenceImage(value: unknown): ChatReferenceImage | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<ChatReferenceImage>;
  const image = normalizeChatImageHit(raw.image ?? value);
  if (!image) return null;
  const mask = normalizeChatImageHit(raw.mask);
  return mask ? { image, mask } : { image };
}

export function normalizeStoredTurnSnapshot(value: unknown): ChatTurnSnapshot | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Partial<ChatTurnSnapshot>;
  const mode = raw.mode === 'chat' || raw.mode === 'edits' ? raw.mode : 'images';
  const referenceImages = Array.isArray(raw.referenceImages)
    ? raw.referenceImages
        .map(normalizeStoredReferenceImage)
        .filter((image): image is ChatReferenceImage => image !== null)
    : [];

  return {
    mode,
    model: typeof raw.model === 'string' ? raw.model : '',
    chatModel: typeof raw.chatModel === 'string' ? raw.chatModel : '',
    chatApiFormat: raw.chatApiFormat === 'claude' ? 'claude' : raw.chatApiFormat === 'openai' ? 'openai' : undefined,
    size: typeof raw.size === 'string' ? raw.size : 'auto',
    n: typeof raw.n === 'number' && Number.isFinite(raw.n) ? raw.n : 1,
    quality: typeof raw.quality === 'string' ? raw.quality : 'auto',
    format: typeof raw.format === 'string' ? raw.format : 'png',
    background: typeof raw.background === 'string' ? raw.background : 'auto',
    moderation: typeof raw.moderation === 'string' ? raw.moderation : 'auto',
    compression: typeof raw.compression === 'number' && Number.isFinite(raw.compression) ? raw.compression : 80,
    systemPrompt: typeof raw.systemPrompt === 'string' ? raw.systemPrompt : '',
    streaming: typeof raw.streaming === 'boolean' ? raw.streaming : true,
    contextLimit: typeof raw.contextLimit === 'number' && Number.isFinite(raw.contextLimit) ? raw.contextLimit : 5,
    referenceImages,
  };
}

export function normalizeStoredSession(value: unknown): ChatSession | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<ChatSession>;
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id : createSessionId();
  const messages = normalizeStoredMessages(raw.messages);
  const createdAt = typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now();
  const updatedAt = typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : createdAt;

  return {
    id,
    title: normalizeSessionTitle(raw.title, sessionTitleFromMessages(messages)),
    titleSource: raw.titleSource === 'generated' || raw.titleSource === 'manual' || raw.titleSource === 'auto'
      ? raw.titleSource
      : inferTitleSource(normalizeSessionTitle(raw.title, sessionTitleFromMessages(messages)), messages),
    messages,
    createdAt,
    updatedAt,
    syncDirty: raw.syncDirty === true,
  };
}

export function normalizeStoredSessions(value: unknown): ChatSession[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const sessions: ChatSession[] = [];
  for (const item of value) {
    const session = normalizeStoredSession(item);
    if (!session || seen.has(session.id)) continue;
    seen.add(session.id);
    sessions.push(session);
    if (sessions.length >= CHAT_SESSIONS_MAX) break;
  }
  return sessions;
}

export function normalizeSyncTombstones(value: unknown): ChatSyncTombstone[] {
  if (!Array.isArray(value)) return [];
  const seen = new Map<string, ChatSyncTombstone>();
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Partial<ChatSyncTombstone>;
    const type = raw.type === 'session' || raw.type === 'message' ? raw.type : null;
    const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id : '';
    const sessionId = typeof raw.sessionId === 'string' && raw.sessionId.trim() ? raw.sessionId : undefined;
    const deletedAt = typeof raw.deletedAt === 'number' && Number.isFinite(raw.deletedAt) ? raw.deletedAt : 0;
    if (!type || !id || deletedAt <= 0) continue;
    if (type === 'message' && !sessionId) continue;
    const key = `${type}:${sessionId || ''}:${id}`;
    const current = seen.get(key);
    if (!current || deletedAt > current.deletedAt) {
      seen.set(key, { type, id, sessionId, deletedAt, syncDirty: raw.syncDirty === true });
    }
  }
  return [...seen.values()]
    .sort((a, b) => b.deletedAt - a.deletedAt)
    .slice(0, 1000);
}

export function isPlaceholderSession(session: ChatSession) {
  return session.messages.length === 0
    && (session.titleSource === 'auto' || !session.titleSource)
    && (session.title === DEFAULT_CHAT_TITLE || session.title === LEGACY_CHAT_TITLE);
}

export function isEmptyBotMessage(message: ChatMessage | undefined) {
  return !!message
    && message.role === 'bot'
    && !message.prompt
    && message.images.length === 0
    && !message.text
    && !message.thinking
    && !message.code
    && !message.extra
    && !message.serverRunId;
}
