'use client';

import React, { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { ImageHit } from '@/types';
import { imageHitToStoredUrl, normalizeChatImageHit, toStoredChatImageHit } from '@/lib/chat-asset-client';
import {
  ACTIVE_CHAT_SESSION_STORAGE_KEY,
  CHAT_MESSAGES_MAX,
  CHAT_MESSAGES_STORAGE_KEY,
  CHAT_SESSIONS_MAX,
  CHAT_SESSIONS_STORAGE_KEY,
  CHAT_SYNC_SESSION_AUTH_STORAGE_KEY,
  CHAT_SYNC_TOMBSTONES_STORAGE_KEY,
  chatSessionPromptStorageKey,
  LAST_PROMPT_KEY,
} from '@/lib/constants';

export interface ChatMessage {
  id: string;
  role: 'user' | 'bot';
  prompt: string;
  images: ImageHit[];
  text: string;
  code: string;
  extra: string;
  request?: ChatTurnSnapshot;
  createdAt: number;
  updatedAt?: number;
  editedAt?: number;
}

export interface ChatReferenceImage {
  image: ImageHit;
  mask?: ImageHit;
}

export interface ChatTurnSnapshot {
  mode: 'images' | 'edits' | 'chat';
  model: string;
  chatModel: string;
  size: string;
  n: number;
  quality: string;
  format: string;
  background: string;
  moderation: string;
  compression: number;
  systemPrompt: string;
  streaming: boolean;
  contextLimit: number;
  referenceImages: ChatReferenceImage[];
}

export interface ChatSession {
  id: string;
  title: string;
  titleSource?: 'auto' | 'generated' | 'manual';
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface ChatSyncTombstone {
  type: 'session' | 'message';
  id: string;
  sessionId?: string;
  deletedAt: number;
}

interface ChatSyncAuth {
  username: string;
  secret: string;
}

interface ChatSyncResponse {
  ok?: boolean;
  sessions?: unknown;
  activeSessionId?: string;
  tombstones?: unknown;
  updatedAt?: number;
  error?: string;
}

interface ChatSyncSnapshot {
  sessions: ChatSession[];
  activeSessionId: string;
  tombstones: ChatSyncTombstone[];
}

interface ChatSyncResult {
  updatedAt: number;
  applied: boolean;
}

interface ChatContextValue {
  sessions: ChatSession[];
  activeSessionId: string;
  loadingSessionId: string | null;
  messages: ChatMessage[];
  isLoading: boolean;
  statusText: string;
  statusType: '' | 'ok' | 'err' | 'warn';
  debugRaw: string;
  debugVisible: boolean;
  createChatSession: () => string;
  switchChatSession: (sessionId: string) => void;
  renameChatSession: (sessionId: string, title: string) => void;
  setGeneratedSessionTitle: (sessionId: string, title: string) => void;
  deleteChatSession: (sessionId: string) => void;
  clearChatSession: (sessionId: string) => void;
  getSyncSnapshot: () => Promise<ChatSyncSnapshot>;
  applySyncedSessions: (sessions: unknown, activeSessionId?: string, tombstones?: unknown, options?: { silent?: boolean }) => void;
  syncChatHistory: (auth: ChatSyncAuth, options?: { silent?: boolean }) => Promise<ChatSyncResult>;
  addUserMsg: (prompt: string, sessionId?: string, request?: ChatTurnSnapshot) => string;
  addBotMsg: (images: ImageHit[], code: string, extra: string, sessionId?: string) => string;
  addTextBotMsg: (text: string, code: string, sessionId?: string) => string;
  updateLastBotMsg: (images: ImageHit[], code?: string, sessionId?: string) => void;
  updateLastBotText: (text: string, sessionId?: string) => void;
  updateBotMsg: (messageId: string, images: ImageHit[], code?: string, sessionId?: string) => void;
  updateBotText: (messageId: string, text: string, sessionId?: string) => void;
  addErrorMsg: (error: string, sessionId?: string) => void;
  deleteMessage: (messageId: string, sessionId?: string) => void;
  restoreSessionMessages: (sessionId: string, messages: ChatMessage[]) => void;
  updateUserMessage: (
    messageId: string,
    prompt: string,
    sessionId?: string,
    request?: ChatTurnSnapshot,
    options?: { markEdited?: boolean },
  ) => void;
  truncateChatAfterMessage: (messageId: string, sessionId?: string) => void;
  replaceBotMessage: (
    messageId: string,
    message: Pick<ChatMessage, 'prompt' | 'images' | 'text' | 'code' | 'extra'>,
    sessionId?: string,
  ) => void;
  setLoading: (v: boolean, sessionId?: string) => void;
  setStatus: (text: string, type?: '' | 'ok' | 'err' | 'warn') => void;
  setDebugRaw: (text: string) => void;
  toggleDebug: () => void;
  showDebug: () => void;
  clearCurrentChat: () => void;
  clearChat: () => void;
}

const ChatContext = createContext<ChatContextValue | undefined>(undefined);
const DEFAULT_CHAT_TITLE = '新聊天';
const LEGACY_CHAT_TITLE = '默认聊天';
const SESSION_TITLE_MAX = 24;
const EMPTY_MESSAGES: ChatMessage[] = [];

function createSessionId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function createMessageId() {
  return createSessionId();
}

function createChatMessage(
  message: Pick<ChatMessage, 'role' | 'prompt' | 'images' | 'text' | 'code' | 'extra'> & {
    request?: ChatTurnSnapshot;
  },
  id = createMessageId(),
): ChatMessage {
  return {
    ...message,
    id,
    createdAt: Date.now(),
  };
}

function normalizeSessionTitle(value: unknown, fallback = DEFAULT_CHAT_TITLE) {
  const title = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (!title) return fallback;
  return title.length > SESSION_TITLE_MAX ? `${title.slice(0, SESSION_TITLE_MAX)}...` : title;
}

function sessionTitleFromMessages(messages: ChatMessage[], fallback = DEFAULT_CHAT_TITLE) {
  const firstPrompt = messages.find((message) => message.role === 'user' && message.prompt.trim())?.prompt;
  return normalizeSessionTitle(firstPrompt, fallback);
}

function isAutoManagedSessionTitle(session: ChatSession) {
  if (session.titleSource === 'generated' || session.titleSource === 'manual') return false;
  return session.title === DEFAULT_CHAT_TITLE
    || session.title === LEGACY_CHAT_TITLE
    || session.title === sessionTitleFromMessages(session.messages, session.title);
}

function inferTitleSource(title: string, messages: ChatMessage[]): ChatSession['titleSource'] {
  return title === DEFAULT_CHAT_TITLE
    || title === LEGACY_CHAT_TITLE
    || title === sessionTitleFromMessages(messages, title)
      ? 'auto'
      : 'manual';
}

function createEmptySession(messages: ChatMessage[] = [], title?: string): ChatSession {
  const now = Date.now();
  const normalizedTitle = normalizeSessionTitle(title || sessionTitleFromMessages(messages));
  return {
    id: createSessionId(),
    title: normalizedTitle,
    titleSource: inferTitleSource(normalizedTitle, messages),
    messages: messages.slice(-CHAT_MESSAGES_MAX),
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeStoredMessages(value: unknown): ChatMessage[] {
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
      code: typeof message.code === 'string' ? message.code : '',
      extra: typeof message.extra === 'string' ? message.extra : '',
      request: normalizeStoredTurnSnapshot(message.request),
      createdAt: typeof message.createdAt === 'number' && Number.isFinite(message.createdAt) ? message.createdAt : Date.now(),
      updatedAt: typeof message.updatedAt === 'number' && Number.isFinite(message.updatedAt) ? message.updatedAt : undefined,
      editedAt: typeof message.editedAt === 'number' && Number.isFinite(message.editedAt) ? message.editedAt : undefined,
    }))
    .slice(-CHAT_MESSAGES_MAX);
}

function normalizeStoredReferenceImage(value: unknown): ChatReferenceImage | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<ChatReferenceImage>;
  const image = normalizeChatImageHit(raw.image ?? value);
  if (!image) return null;
  const mask = normalizeChatImageHit(raw.mask);
  return mask ? { image, mask } : { image };
}

function normalizeStoredTurnSnapshot(value: unknown): ChatTurnSnapshot | undefined {
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

function normalizeStoredSession(value: unknown): ChatSession | null {
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
  };
}

function normalizeStoredSessions(value: unknown): ChatSession[] {
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

function normalizeSyncTombstones(value: unknown): ChatSyncTombstone[] {
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
      seen.set(key, { type, id, sessionId, deletedAt });
    }
  }
  return [...seen.values()]
    .sort((a, b) => b.deletedAt - a.deletedAt)
    .slice(0, 1000);
}

function loadSyncTombstones(): ChatSyncTombstone[] {
  try {
    return normalizeSyncTombstones(JSON.parse(localStorage.getItem(CHAT_SYNC_TOMBSTONES_STORAGE_KEY) || '[]'));
  } catch {
    return [];
  }
}

function readSessionSyncAuth(): ChatSyncAuth | null {
  try {
    const raw = JSON.parse(sessionStorage.getItem(CHAT_SYNC_SESSION_AUTH_STORAGE_KEY) || 'null') as Partial<ChatSyncAuth> | null;
    const username = typeof raw?.username === 'string' ? raw.username.trim() : '';
    const secret = typeof raw?.secret === 'string' ? raw.secret : '';
    return username && secret ? { username, secret } : null;
  } catch {
    return null;
  }
}

function isPlaceholderSession(session: ChatSession) {
  return session.messages.length === 0
    && (session.titleSource === 'auto' || !session.titleSource)
    && (session.title === DEFAULT_CHAT_TITLE || session.title === LEGACY_CHAT_TITLE);
}

function loadLegacyStoredMessages(): ChatMessage[] {
  try {
    return normalizeStoredMessages(JSON.parse(localStorage.getItem(CHAT_MESSAGES_STORAGE_KEY) || '[]'));
  } catch {
    return [];
  }
}

function loadChatState(): { sessions: ChatSession[]; activeSessionId: string } {
  try {
    const storedSessions = normalizeStoredSessions(
      JSON.parse(localStorage.getItem(CHAT_SESSIONS_STORAGE_KEY) || '[]'),
    );
    const migratedFromLegacy = storedSessions.length === 0;
    const sessions = migratedFromLegacy
      ? [createEmptySession(loadLegacyStoredMessages(), LEGACY_CHAT_TITLE)]
      : storedSessions;

    const storedActiveSessionId = localStorage.getItem(ACTIVE_CHAT_SESSION_STORAGE_KEY) || '';
    const activeSessionId = sessions.some((session) => session.id === storedActiveSessionId)
      ? storedActiveSessionId
      : sessions[0].id;

    migrateLegacyPromptToSession(activeSessionId);

    return { sessions, activeSessionId };
  } catch {
    const session = createEmptySession();
    return { sessions: [session], activeSessionId: session.id };
  }
}

function migrateLegacyPromptToSession(sessionId: string) {
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

function removeSessionPrompt(sessionId: string) {
  try {
    localStorage.removeItem(chatSessionPromptStorageKey(sessionId));
  } catch {
    // ignore
  }
}

function stripHeavyMessageData(message: ChatMessage): ChatMessage {
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

function stripHeavyTurnSnapshotData(request: ChatTurnSnapshot | undefined): ChatTurnSnapshot | undefined {
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

function persistStoredSessions(sessions: ChatSession[], activeSessionId: string) {
  const sessionCaps = [CHAT_SESSIONS_MAX, 10, 5, 1];
  const messageCaps = [CHAT_MESSAGES_MAX, 50, 20, 5, 0];

  for (const sessionCap of sessionCaps) {
    for (const messageCap of messageCaps) {
      const payload = sessions.slice(0, sessionCap).map((session) => ({
        ...session,
        messages: (messageCap === 0 ? [] : session.messages.slice(-messageCap)).map(stripHeavyMessageData),
      }));

      try {
        localStorage.setItem(CHAT_SESSIONS_STORAGE_KEY, JSON.stringify(payload));
        localStorage.setItem(ACTIVE_CHAT_SESSION_STORAGE_KEY, activeSessionId);
        localStorage.removeItem(CHAT_MESSAGES_STORAGE_KEY);
        return;
      } catch {
        // Try a smaller storage payload below.
      }
    }
  }

  try {
    localStorage.removeItem(CHAT_SESSIONS_STORAGE_KEY);
  } catch {
    // ignore
  }
}

async function prepareMessagesForStorage(messages: ChatMessage[]): Promise<{
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

async function prepareImageHitForStorage(image: ImageHit | undefined): Promise<{
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

async function prepareTurnSnapshotForStorage(request: ChatTurnSnapshot | undefined): Promise<{
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

async function prepareSessionsForStorage(sessions: ChatSession[]): Promise<{
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

function isEmptyBotMessage(message: ChatMessage | undefined) {
  return !!message
    && message.role === 'bot'
    && !message.prompt
    && message.images.length === 0
    && !message.text
    && !message.code
    && !message.extra;
}

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [initialState] = useState(loadChatState);
  const [sessions, setSessions] = useState<ChatSession[]>(initialState.sessions);
  const [activeSessionId, setActiveSessionId] = useState(initialState.activeSessionId);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingSessionId, setLoadingSessionId] = useState<string | null>(null);
  const [statusText, setStatusText] = useState('');
  const [statusType, setStatusType] = useState<'' | 'ok' | 'err' | 'warn'>('');
  const [debugRaw, setDebugRaw] = useState('（尚未请求）');
  const [debugVisible, setDebugVisible] = useState(false);
  const [syncTombstones, setSyncTombstones] = useState<ChatSyncTombstone[]>(loadSyncTombstones);
  const [autoSyncRetryTick, setAutoSyncRetryTick] = useState(0);
  const applyingSyncRef = useRef(false);
  const lastAutoSyncSignatureRef = useRef('');
  const autoSyncFailureCountRef = useRef(0);
  const localMutationRevisionRef = useRef(0);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) || sessions[0],
    [sessions, activeSessionId],
  );
  const messages = useMemo(() => activeSession?.messages || EMPTY_MESSAGES, [activeSession]);

  const markLocalMutation = useCallback(() => {
    localMutationRevisionRef.current += 1;
  }, []);

  const addSyncTombstones = useCallback((items: ChatSyncTombstone[]) => {
    if (items.length === 0) return;
    markLocalMutation();
    setSyncTombstones((prev) => normalizeSyncTombstones([...items, ...prev]));
  }, [markLocalMutation]);

  const updateSessionMessages = useCallback((
    sessionId: string,
    updater: (messages: ChatMessage[], session: ChatSession) => ChatMessage[],
  ) => {
    markLocalMutation();
    setSessions((prev) => prev.map((session) => {
      if (session.id !== sessionId) return session;

      const nextMessages = updater(session.messages, session).slice(-CHAT_MESSAGES_MAX);
      const title = isAutoManagedSessionTitle(session)
        ? sessionTitleFromMessages(nextMessages, DEFAULT_CHAT_TITLE)
        : session.title;

      return {
        ...session,
        title,
        messages: nextMessages,
        updatedAt: Date.now(),
      };
    }));
  }, [markLocalMutation]);

  const createChatSession = useCallback(() => {
    markLocalMutation();
    const session = createEmptySession();
    setSessions((prev) => [session, ...prev].slice(0, CHAT_SESSIONS_MAX));
    setActiveSessionId(session.id);
    setStatusText('');
    setStatusType('');
    setDebugRaw('（尚未请求）');
    setDebugVisible(false);
    return session.id;
  }, [markLocalMutation]);

  const switchChatSession = useCallback((sessionId: string) => {
    if (!sessions.some((session) => session.id === sessionId)) return;
    markLocalMutation();
    setActiveSessionId(sessionId);
  }, [sessions, markLocalMutation]);

  const renameChatSession = useCallback((sessionId: string, title: string) => {
    const cleanTitle = normalizeSessionTitle(title, '');
    if (!cleanTitle) return;
    markLocalMutation();
    setSessions((prev) => prev.map((session) => (
      session.id === sessionId
        ? { ...session, title: cleanTitle, titleSource: 'manual', updatedAt: Date.now() }
        : session
    )));
  }, [markLocalMutation]);

  const setGeneratedSessionTitle = useCallback((sessionId: string, title: string) => {
    const cleanTitle = normalizeSessionTitle(title, '');
    if (!cleanTitle) return;
    markLocalMutation();
    setSessions((prev) => prev.map((session) => (
      session.id === sessionId && isAutoManagedSessionTitle(session)
        ? { ...session, title: cleanTitle, titleSource: 'generated', updatedAt: Date.now() }
        : session
    )));
  }, [markLocalMutation]);

  const deleteChatSession = useCallback((sessionId: string) => {
    if (isLoading && loadingSessionId === sessionId) return;

    const index = sessions.findIndex((session) => session.id === sessionId);
    if (index < 0) return;
    addSyncTombstones([{ type: 'session', id: sessionId, deletedAt: Date.now() }]);

    if (sessions.length <= 1) {
      const replacement = createEmptySession();
      removeSessionPrompt(sessionId);
      markLocalMutation();
      setSessions([replacement]);
      setActiveSessionId(replacement.id);
      return;
    }

    const nextSessions = sessions.filter((session) => session.id !== sessionId);
    removeSessionPrompt(sessionId);
    markLocalMutation();
    setSessions(nextSessions);
    if (activeSessionId === sessionId) {
      setActiveSessionId(nextSessions[Math.min(index, nextSessions.length - 1)]?.id || nextSessions[0].id);
    }
  }, [sessions, activeSessionId, isLoading, loadingSessionId, addSyncTombstones, markLocalMutation]);

  const clearChatSession = useCallback((sessionId: string) => {
    if (isLoading && loadingSessionId === sessionId) return;
    const now = Date.now();
    const target = sessions.find((session) => session.id === sessionId);
    addSyncTombstones((target?.messages || []).map((message) => ({
      type: 'message',
      id: message.id,
      sessionId,
      deletedAt: now,
    })));
    markLocalMutation();
    setSessions((prev) => prev.map((session) => (
      session.id === sessionId
        ? {
          ...session,
          title: DEFAULT_CHAT_TITLE,
          titleSource: 'auto',
          messages: [],
          updatedAt: Date.now(),
        }
        : session
    )));
    if (sessionId !== activeSessionId) return;
    setStatusText('');
    setStatusType('');
    setDebugRaw('（尚未请求）');
    setDebugVisible(false);
  }, [sessions, activeSessionId, isLoading, loadingSessionId, addSyncTombstones, markLocalMutation]);

  const getSyncSnapshot = useCallback(async () => {
    const recentSessions = sessions.slice(0, CHAT_SESSIONS_MAX);
    const skipOnlyPlaceholder = recentSessions.length === 1
      && isPlaceholderSession(recentSessions[0])
      && syncTombstones.length === 0;
    const sessionsForSync = skipOnlyPlaceholder ? [] : recentSessions;
    const { storedSessions } = await prepareSessionsForStorage(sessionsForSync);
    return {
      sessions: storedSessions,
      activeSessionId: skipOnlyPlaceholder ? '' : activeSessionId,
      tombstones: syncTombstones,
    };
  }, [sessions, activeSessionId, syncTombstones]);

  const applySyncedSessions = useCallback((
    value: unknown,
    nextActiveSessionId?: string,
    tombstones?: unknown,
    applyOptions?: { silent?: boolean },
  ) => {
    applyingSyncRef.current = true;
    const normalizedSessions = normalizeStoredSessions(value);
    const nextSessions = normalizedSessions.length > 0 ? normalizedSessions : [createEmptySession()];
    setSessions(nextSessions);
    setSyncTombstones(normalizeSyncTombstones(tombstones));
    setActiveSessionId(
      nextSessions.some((session) => session.id === nextActiveSessionId)
        ? nextActiveSessionId as string
        : nextSessions[0].id,
    );
    if (!applyOptions?.silent) {
      setStatusText('聊天记录已同步');
      setStatusType('ok');
    }
    window.setTimeout(() => {
      applyingSyncRef.current = false;
    }, 0);
  }, []);

  const syncChatHistory = useCallback(async (auth: ChatSyncAuth, syncOptions?: { silent?: boolean }) => {
    const username = auth.username.trim();
    const secret = auth.secret;
    if (!username || secret.length < 4) throw new Error('请输入玩家名和至少 4 位同步密钥');
    const requestRevision = localMutationRevisionRef.current;
    const snapshot = await getSyncSnapshot();
    const response = await fetch('/api/chat-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        secret,
        sessions: snapshot.sessions,
        activeSessionId: snapshot.activeSessionId,
        tombstones: snapshot.tombstones,
      }),
    });
    const data = await response.json().catch(() => ({} as ChatSyncResponse)) as ChatSyncResponse;
    if (!response.ok || !data.ok) throw new Error(data.error || 'SYNC FAILED');
    if (localMutationRevisionRef.current !== requestRevision) {
      return { updatedAt: data.updatedAt || Date.now(), applied: false };
    }
    applySyncedSessions(data.sessions, data.activeSessionId, data.tombstones, syncOptions);
    return { updatedAt: data.updatedAt || Date.now(), applied: true };
  }, [getSyncSnapshot, applySyncedSessions]);

  const addUserMsg = useCallback((prompt: string, sessionId = activeSessionId, request?: ChatTurnSnapshot) => {
    const message = createChatMessage({ role: 'user', prompt, images: [], text: '', code: '', extra: '', request });
    updateSessionMessages(sessionId, (prev) => [
      ...prev,
      message,
    ]);
    return message.id;
  }, [activeSessionId, updateSessionMessages]);

  const addBotMsg = useCallback((images: ImageHit[], code: string, extra: string, sessionId = activeSessionId) => {
    const message = createChatMessage({ role: 'bot', prompt: '', images, text: '', code, extra });
    updateSessionMessages(sessionId, (prev) => [
      ...prev,
      message,
    ]);
    return message.id;
  }, [activeSessionId, updateSessionMessages]);

  const addTextBotMsg = useCallback((text: string, code: string, sessionId = activeSessionId) => {
    const message = createChatMessage({ role: 'bot', prompt: '', images: [], text, code, extra: '' });
    updateSessionMessages(sessionId, (prev) => [
      ...prev,
      message,
    ]);
    return message.id;
  }, [activeSessionId, updateSessionMessages]);

  const updateLastBotMsg = useCallback((images: ImageHit[], code?: string, sessionId = activeSessionId) => {
    updateSessionMessages(sessionId, (prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (last.role !== 'bot') return prev;
      const updated: ChatMessage = { ...last, images: [...images], code: code ?? last.code, updatedAt: Date.now() };
      return [...prev.slice(0, -1), updated];
    });
  }, [activeSessionId, updateSessionMessages]);

  const updateLastBotText = useCallback((text: string, sessionId = activeSessionId) => {
    updateSessionMessages(sessionId, (prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (last.role !== 'bot') return prev;
      return [...prev.slice(0, -1), { ...last, text, updatedAt: Date.now() }];
    });
  }, [activeSessionId, updateSessionMessages]);

  const updateBotMsg = useCallback((messageId: string, images: ImageHit[], code?: string, sessionId = activeSessionId) => {
    updateSessionMessages(sessionId, (prev) => prev.map((message) => (
      message.id === messageId && message.role === 'bot'
        ? { ...message, images: [...images], code: code ?? message.code, updatedAt: Date.now() }
        : message
    )));
  }, [activeSessionId, updateSessionMessages]);

  const updateBotText = useCallback((messageId: string, text: string, sessionId = activeSessionId) => {
    updateSessionMessages(sessionId, (prev) => prev.map((message) => (
      message.id === messageId && message.role === 'bot'
        ? { ...message, text, updatedAt: Date.now() }
        : message
    )));
  }, [activeSessionId, updateSessionMessages]);

  const addErrorMsg = useCallback((error: string, sessionId = activeSessionId) => {
    updateSessionMessages(sessionId, (prev) => {
      const errorMessage = createChatMessage({ role: 'bot', prompt: error, images: [], text: '', code: '', extra: 'error' });
      if (isEmptyBotMessage(prev[prev.length - 1])) {
        return [...prev.slice(0, -1), errorMessage];
      }
      return [...prev, errorMessage];
    });
  }, [activeSessionId, updateSessionMessages]);

  const deleteMessage = useCallback((messageId: string, sessionId = activeSessionId) => {
    const session = sessions.find((item) => item.id === sessionId);
    if (session?.messages.some((message) => message.id === messageId)) {
      addSyncTombstones([{ type: 'message', id: messageId, sessionId, deletedAt: Date.now() }]);
    }
    updateSessionMessages(sessionId, (prev) => prev.filter((message) => message.id !== messageId));
  }, [sessions, activeSessionId, updateSessionMessages, addSyncTombstones]);

  const restoreSessionMessages = useCallback((sessionId: string, messages: ChatMessage[]) => {
    if (messages.length > 0) {
      const restoredMessageIds = new Set(messages.map((message) => message.id));
      setSyncTombstones((prev) => prev.filter((tombstone) => !(
        tombstone.type === 'message'
        && tombstone.sessionId === sessionId
        && restoredMessageIds.has(tombstone.id)
      )));
    }
    updateSessionMessages(sessionId, () => messages);
  }, [updateSessionMessages]);

  const updateUserMessage = useCallback((
    messageId: string,
    prompt: string,
    sessionId = activeSessionId,
    request?: ChatTurnSnapshot,
    options?: { markEdited?: boolean },
  ) => {
    const cleanPrompt = prompt.trim();
    if (!cleanPrompt) return;
    updateSessionMessages(sessionId, (prev) => prev.map((message) => (
      message.id === messageId && message.role === 'user'
        ? {
          ...message,
          prompt: cleanPrompt,
          request: request ?? message.request,
          updatedAt: Date.now(),
          editedAt: options?.markEdited ? Date.now() : message.editedAt,
        }
        : message
    )));
  }, [activeSessionId, updateSessionMessages]);

  const truncateChatAfterMessage = useCallback((messageId: string, sessionId = activeSessionId) => {
    const session = sessions.find((item) => item.id === sessionId);
    const targetIndex = session?.messages.findIndex((message) => message.id === messageId) ?? -1;
    if (session && targetIndex >= 0) {
      const now = Date.now();
      addSyncTombstones(session.messages.slice(targetIndex + 1).map((message) => ({
        type: 'message',
        id: message.id,
        sessionId,
        deletedAt: now,
      })));
    }
    updateSessionMessages(sessionId, (prev) => {
      const index = prev.findIndex((message) => message.id === messageId);
      if (index < 0) return prev;
      return prev.slice(0, index + 1);
    });
  }, [sessions, activeSessionId, updateSessionMessages, addSyncTombstones]);

  const replaceBotMessage = useCallback((
    messageId: string,
    message: Pick<ChatMessage, 'prompt' | 'images' | 'text' | 'code' | 'extra'>,
    sessionId = activeSessionId,
  ) => {
    updateSessionMessages(sessionId, (prev) => prev.map((current) => (
      current.id === messageId && current.role === 'bot'
        ? { ...current, ...message, role: 'bot', updatedAt: Date.now() }
        : current
    )));
  }, [activeSessionId, updateSessionMessages]);

  const setLoading = useCallback((value: boolean, sessionId = activeSessionId) => {
    setIsLoading(value);
    setLoadingSessionId(value ? sessionId : null);
  }, [activeSessionId]);

  const setStatus = useCallback((text: string, type: '' | 'ok' | 'err' | 'warn' = '') => {
    setStatusText(text);
    setStatusType(type);
  }, []);

  const toggleDebug = useCallback(() => {
    setDebugVisible((prev) => !prev);
  }, []);

  const showDebug = useCallback(() => {
    setDebugVisible(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        const recentSessions = sessions.slice(0, CHAT_SESSIONS_MAX);
        const { storedSessions, memorySessions, changed } = await prepareSessionsForStorage(recentSessions);

        if (cancelled) return;
        if (changed) {
          setSessions((current) => current.map((session) => {
            const replacement = memorySessions.find((item) => item.id === session.id);
            return replacement ? { ...session, messages: replacement.messages } : session;
          }));
        }

        persistStoredSessions(storedSessions, activeSessionId);
      })();
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [sessions, activeSessionId]);

  useEffect(() => {
    try {
      localStorage.setItem(CHAT_SYNC_TOMBSTONES_STORAGE_KEY, JSON.stringify(syncTombstones));
    } catch {
      // ignore
    }
  }, [syncTombstones]);

  useEffect(() => {
    if (applyingSyncRef.current) return;
    const auth = readSessionSyncAuth();
    if (!auth) return;
    const timer = window.setTimeout(() => {
      void (async () => {
        const snapshot = await getSyncSnapshot();
        const signature = JSON.stringify({
          activeSessionId: snapshot.activeSessionId,
          sessions: snapshot.sessions.map((session) => ({
            id: session.id,
            updatedAt: session.updatedAt,
            messages: session.messages.map((message) => ({
              id: message.id,
              updatedAt: message.updatedAt || message.createdAt,
            })),
          })),
          tombstones: snapshot.tombstones,
        });
        if (signature === lastAutoSyncSignatureRef.current) return;
        try {
          const result = await syncChatHistory(auth, { silent: true });
          if (result.applied) {
            autoSyncFailureCountRef.current = 0;
            lastAutoSyncSignatureRef.current = signature;
          } else {
            setAutoSyncRetryTick((value) => value + 1);
          }
        } catch {
          autoSyncFailureCountRef.current += 1;
          window.setTimeout(() => {
            setAutoSyncRetryTick((value) => value + 1);
          }, Math.min(30_000, 2_000 * autoSyncFailureCountRef.current));
        }
      })();
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [sessions, activeSessionId, syncTombstones, autoSyncRetryTick, getSyncSnapshot, syncChatHistory]);

  const clearCurrentChat = useCallback(() => {
    clearChatSession(activeSessionId);
  }, [activeSessionId, clearChatSession]);

  const value = useMemo(() => ({
    sessions,
    activeSessionId,
    loadingSessionId,
    messages,
    isLoading,
    statusText,
    statusType,
    debugRaw,
    debugVisible,
    createChatSession,
    switchChatSession,
    renameChatSession,
    setGeneratedSessionTitle,
    deleteChatSession,
    clearChatSession,
    getSyncSnapshot,
    applySyncedSessions,
    syncChatHistory,
    addUserMsg,
    addBotMsg,
    addTextBotMsg,
    updateLastBotMsg,
    updateLastBotText,
    updateBotMsg,
    updateBotText,
    addErrorMsg,
    deleteMessage,
    restoreSessionMessages,
    updateUserMessage,
    truncateChatAfterMessage,
    replaceBotMessage,
    setLoading,
    setStatus,
    setDebugRaw,
    toggleDebug,
    showDebug,
    clearCurrentChat,
    clearChat: clearCurrentChat,
  }), [
    sessions,
    activeSessionId,
    loadingSessionId,
    messages,
    isLoading,
    statusText,
    statusType,
    debugRaw,
    debugVisible,
    createChatSession,
    switchChatSession,
    renameChatSession,
    setGeneratedSessionTitle,
    deleteChatSession,
    clearChatSession,
    getSyncSnapshot,
    applySyncedSessions,
    syncChatHistory,
    addUserMsg,
    addBotMsg,
    addTextBotMsg,
    updateLastBotMsg,
    updateLastBotText,
    updateBotMsg,
    updateBotText,
    addErrorMsg,
    deleteMessage,
    restoreSessionMessages,
    updateUserMessage,
    truncateChatAfterMessage,
    replaceBotMessage,
    setLoading,
    setStatus,
    setDebugRaw,
    toggleDebug,
    showDebug,
    clearCurrentChat,
  ]);

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used within ChatProvider');
  return ctx;
}
