'use client';

import React, { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { ImageHit } from '@/types';
import {
  CHAT_MESSAGES_MAX,
  CHAT_SESSIONS_MAX,
  CHAT_SYNC_TOMBSTONES_STORAGE_KEY,
} from '@/lib/constants';

import {
  DEFAULT_CHAT_TITLE,
  EMPTY_MESSAGES,
  createChatMessage,
  normalizeSessionTitle,
  sessionTitleFromMessages,
  isAutoManagedSessionTitle,
  createEmptySession,
  createFallbackChatState,
  normalizeSyncTombstones,
  isEmptyBotMessage,
} from '@/lib/storage/chat-normalize';

import {
  type ChatSyncAuth,
  loadSyncTombstones,
  readSessionSyncAuth,
  persistSessionSyncAuth,
  loadChatState,
  removeSessionPrompt,
  persistStoredSessions,
  prepareSessionsForStorage,
} from '@/lib/storage/chat-store';

import { useChatSync, type ChatSyncSnapshot, type ChatSyncResult } from '@/lib/storage/chat-sync';

export interface ChatMessage {
  id: string;
  role: 'user' | 'bot';
  prompt: string;
  images: ImageHit[];
  text: string;
  thinking?: string;
  thinkingDone?: boolean;
  code: string;
  extra: string;
  request?: ChatTurnSnapshot;
  createdAt: number;
  updatedAt?: number;
  editedAt?: number;
  syncDirty?: boolean;
}

export interface ChatReferenceImage {
  image: ImageHit;
  mask?: ImageHit;
}

export interface ChatTurnSnapshot {
  mode: 'images' | 'edits' | 'chat';
  model: string;
  chatModel: string;
  chatApiFormat?: 'openai' | 'claude';
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
  syncDirty?: boolean;
}

export interface ChatSyncTombstone {
  type: 'session' | 'message';
  id: string;
  sessionId?: string;
  deletedAt: number;
  syncDirty?: boolean;
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
  addTextBotMsg: (text: string, code: string, sessionId?: string, thinking?: string, thinkingDone?: boolean) => string;
  updateLastBotMsg: (images: ImageHit[], code?: string, sessionId?: string) => void;
  updateLastBotText: (text: string, sessionId?: string) => void;
  updateBotMsg: (messageId: string, images: ImageHit[], code?: string, sessionId?: string) => void;
  updateBotText: (messageId: string, text: string, sessionId?: string, thinking?: string, thinkingDone?: boolean) => void;
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
    message: Pick<ChatMessage, 'prompt' | 'images' | 'text' | 'code' | 'extra'> & Partial<Pick<ChatMessage, 'thinking' | 'thinkingDone'>>,
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
export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [initialState, setInitialState] = useState(createFallbackChatState);
  const [sessions, setSessions] = useState<ChatSession[]>(initialState.sessions);
  const [activeSessionId, setActiveSessionId] = useState(initialState.activeSessionId);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingSessionId, setLoadingSessionId] = useState<string | null>(null);
  const [statusText, setStatusText] = useState('');
  const [statusType, setStatusType] = useState<'' | 'ok' | 'err' | 'warn'>('');
  const [debugRaw, setDebugRaw] = useState('（尚未请求）');
  const [debugVisible, setDebugVisible] = useState(false);
  const [syncTombstones, setSyncTombstones] = useState<ChatSyncTombstone[]>([]);
  const [storageReady, setStorageReady] = useState(false);
  const [autoSyncRetryTick, setAutoSyncRetryTick] = useState(0);
  const applyingSyncRef = useRef(false);
  const lastAutoSyncSignatureRef = useRef('');
  const autoSyncFailureCountRef = useRef(0);
  const localMutationRevisionRef = useRef(0);

  useEffect(() => {
    const timeoutId = window.setTimeout(async () => {
      const loaded = await loadChatState();
      setInitialState(loaded);
      setSessions(loaded.sessions);
      setActiveSessionId(loaded.activeSessionId);
      setSyncTombstones(await loadSyncTombstones());
      setStorageReady(true);
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, []);

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
    setSyncTombstones((prev) => normalizeSyncTombstones([
      ...items.map((item) => ({ ...item, syncDirty: true })),
      ...prev,
    ]));
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
      const syncDirty = session.syncDirty === true || title !== session.title;

      return {
        ...session,
        title,
        messages: nextMessages,
        updatedAt: Date.now(),
        syncDirty,
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
        ? { ...session, title: cleanTitle, titleSource: 'manual', updatedAt: Date.now(), syncDirty: true }
        : session
    )));
  }, [markLocalMutation]);

  const setGeneratedSessionTitle = useCallback((sessionId: string, title: string) => {
    const cleanTitle = normalizeSessionTitle(title, '');
    if (!cleanTitle) return;
    markLocalMutation();
    setSessions((prev) => prev.map((session) => (
      session.id === sessionId && isAutoManagedSessionTitle(session)
        ? { ...session, title: cleanTitle, titleSource: 'generated', updatedAt: Date.now(), syncDirty: true }
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
          syncDirty: true,
        }
        : session
    )));
    if (sessionId !== activeSessionId) return;
    setStatusText('');
    setStatusType('');
    setDebugRaw('（尚未请求）');
    setDebugVisible(false);
  }, [sessions, activeSessionId, isLoading, loadingSessionId, addSyncTombstones, markLocalMutation]);

  const { getSyncSnapshot, applySyncedSessions, syncChatHistory } = useChatSync({
    sessions,
    activeSessionId,
    syncTombstones,
    localMutationRevisionRef,
    applyingSyncRef,
    setSessions,
    setSyncTombstones,
    setActiveSessionId,
    setStatusText,
    setStatusType,
  });


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

  const addTextBotMsg = useCallback((
    text: string,
    code: string,
    sessionId = activeSessionId,
    thinking?: string,
    thinkingDone?: boolean,
  ) => {
    const message = createChatMessage({
      role: 'bot',
      prompt: '',
      images: [],
      text,
      thinking,
      thinkingDone,
      code,
      extra: '',
    });
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
      const updated: ChatMessage = { ...last, images: [...images], code: code ?? last.code, updatedAt: Date.now(), syncDirty: true };
      return [...prev.slice(0, -1), updated];
    });
  }, [activeSessionId, updateSessionMessages]);

  const updateLastBotText = useCallback((text: string, sessionId = activeSessionId) => {
    updateSessionMessages(sessionId, (prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (last.role !== 'bot') return prev;
      return [...prev.slice(0, -1), { ...last, text, updatedAt: Date.now(), syncDirty: true }];
    });
  }, [activeSessionId, updateSessionMessages]);

  const updateBotMsg = useCallback((messageId: string, images: ImageHit[], code?: string, sessionId = activeSessionId) => {
    updateSessionMessages(sessionId, (prev) => prev.map((message) => (
      message.id === messageId && message.role === 'bot'
        ? { ...message, images: [...images], code: code ?? message.code, updatedAt: Date.now(), syncDirty: true }
        : message
    )));
  }, [activeSessionId, updateSessionMessages]);

  const updateBotText = useCallback((
    messageId: string,
    text: string,
    sessionId = activeSessionId,
    thinking?: string,
    thinkingDone?: boolean,
  ) => {
    updateSessionMessages(sessionId, (prev) => prev.map((message) => (
      message.id === messageId && message.role === 'bot'
        ? {
          ...message,
          text,
          thinking: thinking ?? message.thinking,
          thinkingDone: thinkingDone ?? message.thinkingDone,
          updatedAt: Date.now(),
          syncDirty: true,
        }
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
          syncDirty: true,
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
    message: Pick<ChatMessage, 'prompt' | 'images' | 'text' | 'code' | 'extra'> & Partial<Pick<ChatMessage, 'thinking' | 'thinkingDone'>>,
    sessionId = activeSessionId,
  ) => {
    updateSessionMessages(sessionId, (prev) => prev.map((current) => (
      current.id === messageId && current.role === 'bot'
        ? { ...current, ...message, role: 'bot', updatedAt: Date.now(), syncDirty: true }
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
    if (!storageReady) return;
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
  }, [sessions, activeSessionId, storageReady]);

  useEffect(() => {
    if (!storageReady) return;
    try {
      import('idb-keyval').then(({ set }) => set(CHAT_SYNC_TOMBSTONES_STORAGE_KEY, JSON.stringify(syncTombstones)));
    } catch {
      // ignore
    }
  }, [syncTombstones, storageReady]);

  useEffect(() => {
    if (!storageReady) return;
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
            persistSessionSyncAuth(auth, result.updatedAt);
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
  }, [sessions, activeSessionId, syncTombstones, autoSyncRetryTick, getSyncSnapshot, syncChatHistory, storageReady]);

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
