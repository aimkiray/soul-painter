'use client';

import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import { ImageHit } from '@/types';
import { imageHitToStoredUrl, normalizeChatImageHit, toStoredChatImageHit } from '@/lib/chat-asset-client';
import {
  ACTIVE_CHAT_SESSION_STORAGE_KEY,
  CHAT_MESSAGES_MAX,
  CHAT_MESSAGES_STORAGE_KEY,
  CHAT_SESSIONS_MAX,
  CHAT_SESSIONS_STORAGE_KEY,
  chatSessionPromptStorageKey,
  LAST_PROMPT_KEY,
} from '@/lib/constants';

export interface ChatMessage {
  role: 'user' | 'bot';
  prompt: string;
  images: ImageHit[];
  text: string;
  code: string;
  extra: string;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
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
  deleteChatSession: (sessionId: string) => void;
  addUserMsg: (prompt: string, sessionId?: string) => void;
  addBotMsg: (images: ImageHit[], code: string, extra: string, sessionId?: string) => void;
  addTextBotMsg: (text: string, code: string, sessionId?: string) => void;
  updateLastBotMsg: (images: ImageHit[], code?: string, sessionId?: string) => void;
  updateLastBotText: (text: string, sessionId?: string) => void;
  addErrorMsg: (error: string, sessionId?: string) => void;
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

function normalizeSessionTitle(value: unknown, fallback = DEFAULT_CHAT_TITLE) {
  const title = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (!title) return fallback;
  return title.length > SESSION_TITLE_MAX ? `${title.slice(0, SESSION_TITLE_MAX)}...` : title;
}

function sessionTitleFromMessages(messages: ChatMessage[], fallback = DEFAULT_CHAT_TITLE) {
  const firstPrompt = messages.find((message) => message.role === 'user' && message.prompt.trim())?.prompt;
  return normalizeSessionTitle(firstPrompt, fallback);
}

function createEmptySession(messages: ChatMessage[] = [], title?: string): ChatSession {
  const now = Date.now();
  return {
    id: createSessionId(),
    title: normalizeSessionTitle(title || sessionTitleFromMessages(messages)),
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
    }))
    .slice(-CHAT_MESSAGES_MAX);
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
  };
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

    storedMessages.push({ ...message, images: storedImages, code: '' });
    memoryMessages.push({ ...message, images: memoryImages });
  }

  return { storedMessages, memoryMessages, changed };
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

function shouldAutoRenameSession(session: ChatSession) {
  return !session.messages.some((message) => message.role === 'user' && message.prompt.trim())
    && (session.title === DEFAULT_CHAT_TITLE || session.title === LEGACY_CHAT_TITLE);
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

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) || sessions[0],
    [sessions, activeSessionId],
  );
  const messages = useMemo(() => activeSession?.messages || EMPTY_MESSAGES, [activeSession]);

  const updateSessionMessages = useCallback((
    sessionId: string,
    updater: (messages: ChatMessage[], session: ChatSession) => ChatMessage[],
  ) => {
    setSessions((prev) => prev.map((session) => {
      if (session.id !== sessionId) return session;

      const nextMessages = updater(session.messages, session).slice(-CHAT_MESSAGES_MAX);
      const title = shouldAutoRenameSession(session)
        ? sessionTitleFromMessages(nextMessages, session.title)
        : session.title;

      return {
        ...session,
        title,
        messages: nextMessages,
        updatedAt: Date.now(),
      };
    }));
  }, []);

  const createChatSession = useCallback(() => {
    const session = createEmptySession();
    setSessions((prev) => [session, ...prev].slice(0, CHAT_SESSIONS_MAX));
    setActiveSessionId(session.id);
    setStatusText('');
    setStatusType('');
    setDebugRaw('（尚未请求）');
    setDebugVisible(false);
    return session.id;
  }, []);

  const switchChatSession = useCallback((sessionId: string) => {
    if (!sessions.some((session) => session.id === sessionId)) return;
    setActiveSessionId(sessionId);
  }, [sessions]);

  const renameChatSession = useCallback((sessionId: string, title: string) => {
    const cleanTitle = normalizeSessionTitle(title, '');
    if (!cleanTitle) return;
    setSessions((prev) => prev.map((session) => (
      session.id === sessionId
        ? { ...session, title: cleanTitle, updatedAt: Date.now() }
        : session
    )));
  }, []);

  const deleteChatSession = useCallback((sessionId: string) => {
    if (isLoading && loadingSessionId === sessionId) return;

    const index = sessions.findIndex((session) => session.id === sessionId);
    if (index < 0) return;

    if (sessions.length <= 1) {
      const replacement = createEmptySession();
      removeSessionPrompt(sessionId);
      setSessions([replacement]);
      setActiveSessionId(replacement.id);
      return;
    }

    const nextSessions = sessions.filter((session) => session.id !== sessionId);
    removeSessionPrompt(sessionId);
    setSessions(nextSessions);
    if (activeSessionId === sessionId) {
      setActiveSessionId(nextSessions[Math.min(index, nextSessions.length - 1)]?.id || nextSessions[0].id);
    }
  }, [sessions, activeSessionId, isLoading, loadingSessionId]);

  const addUserMsg = useCallback((prompt: string, sessionId = activeSessionId) => {
    updateSessionMessages(sessionId, (prev) => [
      ...prev,
      { role: 'user', prompt, images: [], text: '', code: '', extra: '' },
    ]);
  }, [activeSessionId, updateSessionMessages]);

  const addBotMsg = useCallback((images: ImageHit[], code: string, extra: string, sessionId = activeSessionId) => {
    updateSessionMessages(sessionId, (prev) => [
      ...prev,
      { role: 'bot', prompt: '', images, text: '', code, extra },
    ]);
  }, [activeSessionId, updateSessionMessages]);

  const addTextBotMsg = useCallback((text: string, code: string, sessionId = activeSessionId) => {
    updateSessionMessages(sessionId, (prev) => [
      ...prev,
      { role: 'bot', prompt: '', images: [], text, code, extra: '' },
    ]);
  }, [activeSessionId, updateSessionMessages]);

  const updateLastBotMsg = useCallback((images: ImageHit[], code?: string, sessionId = activeSessionId) => {
    updateSessionMessages(sessionId, (prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (last.role !== 'bot') return prev;
      const updated: ChatMessage = { ...last, images: [...images], code: code ?? last.code };
      return [...prev.slice(0, -1), updated];
    });
  }, [activeSessionId, updateSessionMessages]);

  const updateLastBotText = useCallback((text: string, sessionId = activeSessionId) => {
    updateSessionMessages(sessionId, (prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (last.role !== 'bot') return prev;
      return [...prev.slice(0, -1), { ...last, text }];
    });
  }, [activeSessionId, updateSessionMessages]);

  const addErrorMsg = useCallback((error: string, sessionId = activeSessionId) => {
    updateSessionMessages(sessionId, (prev) => {
      const errorMessage: ChatMessage = { role: 'bot', prompt: error, images: [], text: '', code: '', extra: 'error' };
      if (isEmptyBotMessage(prev[prev.length - 1])) {
        return [...prev.slice(0, -1), errorMessage];
      }
      return [...prev, errorMessage];
    });
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

  const clearCurrentChat = useCallback(() => {
    updateSessionMessages(activeSessionId, () => []);
    setStatusText('');
    setStatusType('');
    setDebugRaw('（尚未请求）');
    setDebugVisible(false);
  }, [activeSessionId, updateSessionMessages]);

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
    deleteChatSession,
    addUserMsg,
    addBotMsg,
    addTextBotMsg,
    updateLastBotMsg,
    updateLastBotText,
    addErrorMsg,
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
    deleteChatSession,
    addUserMsg,
    addBotMsg,
    addTextBotMsg,
    updateLastBotMsg,
    updateLastBotText,
    addErrorMsg,
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
