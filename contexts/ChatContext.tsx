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
import { readPendingServerRuns } from '@/lib/server-runs';
import { isLocalDataCleared } from '@/lib/local-data-cleared';

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
  serverRunId?: string;
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
  messages: ChatMessage[];
  isLoading: boolean;
  isSessionLoading: (sessionId: string) => boolean;
  statusText: string;
  statusType: '' | 'ok' | 'err' | 'warn';
  debugRaw: string;
  debugVisible: boolean;
  promptDrafts: Record<string, string>;
  setPromptDraft: (sessionId: string, text: string) => void;
  createChatSession: () => string;
  switchChatSession: (sessionId: string) => void;
  renameChatSession: (sessionId: string, title: string) => void;
  setGeneratedSessionTitle: (sessionId: string, title: string) => void;
  deleteChatSession: (sessionId: string) => void;
  clearChatSession: (sessionId: string) => void;
  getSyncSnapshot: () => Promise<ChatSyncSnapshot>;
  applySyncedSessions: (sessions: unknown, activeSessionId?: string, tombstones?: unknown, options?: { silent?: boolean }) => void;
  syncChatHistory: (auth: ChatSyncAuth, options?: { silent?: boolean }) => Promise<ChatSyncResult>;
  addUserMsg: (prompt: string, sessionId?: string, request?: ChatTurnSnapshot, serverRunId?: string) => string;
  addBotMsg: (images: ImageHit[], code: string, extra: string, sessionId?: string, serverRunId?: string) => string;
  addTextBotMsg: (text: string, code: string, sessionId?: string, thinking?: string, thinkingDone?: boolean) => string;
  deleteMessage: (messageId: string, sessionId?: string) => void;
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
    message: Pick<ChatMessage, 'prompt' | 'images' | 'text' | 'code' | 'extra'> & Partial<Pick<ChatMessage, 'thinking' | 'thinkingDone' | 'serverRunId'>>,
    sessionId?: string,
  ) => void;
  upsertMessages: (sessionId: string, messages: ChatMessage[], titleHint?: string) => void;
  setLoading: (v: boolean, sessionId?: string) => void;
  setStatus: (text: string, type?: '' | 'ok' | 'err' | 'warn') => void;
  setDebugRaw: (text: string) => void;
  toggleDebug: () => void;
  showDebug: () => void;
  clearCurrentChat: () => void;
  clearChat: () => void;
}

function sessionTitleCacheKey(messages: ChatMessage[]) {
  const last = messages[messages.length - 1];
  const firstUser = messages.find((message) => message.role === 'user');
  return `${messages.map((message) => message.id).join('|')}|${last?.thinkingDone ?? ''}|${last?.images.length ?? 0}|${firstUser?.prompt.length ?? 0}|${firstUser?.prompt.slice(0, 32) ?? ''}`;
}

const ChatContext = createContext<ChatContextValue | undefined>(undefined);
export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [initialState, setInitialState] = useState(createFallbackChatState);
  const [sessions, setSessions] = useState<ChatSession[]>(initialState.sessions);
  const [activeSessionId, setActiveSessionId] = useState(initialState.activeSessionId);
  const [loadingSessionIds, setLoadingSessionIds] = useState<string[]>([]);
  const [statusText, setStatusText] = useState('');
  const [statusType, setStatusType] = useState<'' | 'ok' | 'err' | 'warn'>('');
  const [debugRaw, setDebugRaw] = useState('（尚未请求）');
  const [debugVisible, setDebugVisible] = useState(false);
  const [promptDrafts, setPromptDrafts] = useState<Record<string, string>>({});
  const [syncTombstones, setSyncTombstones] = useState<ChatSyncTombstone[]>([]);
  const [storageReady, setStorageReady] = useState(false);
  const [autoSyncRetryTick, setAutoSyncRetryTick] = useState(0);
  const applyingSyncRef = useRef(false);
  const lastAutoSyncSignatureRef = useRef('');
  const autoSyncFailureCountRef = useRef(0);
  const autoSyncRetryTimerRef = useRef<number | null>(null);
  const localMutationRevisionRef = useRef(0);
  const activeSessionIdRef = useRef(activeSessionId);
  const loadingSessionIdsRef = useRef(loadingSessionIds);
  const storageLoadFailedRef = useRef(false);
  const sessionTitleCacheRef = useRef(new Map<string, { key: string; title: string }>());


  useEffect(() => { activeSessionIdRef.current = activeSessionId; }, [activeSessionId]);
  useEffect(() => { loadingSessionIdsRef.current = loadingSessionIds; }, [loadingSessionIds]);

  useEffect(() => {
    let cancelled = false;
    const timeoutId = window.setTimeout(async () => {
      try {
        const loaded = await loadChatState();
        const tombstones = await loadSyncTombstones();
        if (cancelled) return;
        if (loaded.loadFailed) storageLoadFailedRef.current = true;
        setInitialState(loaded);
        setSessions(loaded.sessions);
        setActiveSessionId(loaded.activeSessionId);
        setSyncTombstones(tombstones);
      } catch {
        // Keep the fallback session when IndexedDB is unavailable.
        storageLoadFailedRef.current = true;
      } finally {
        if (!cancelled) setStorageReady(true);
      }
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, []);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) || sessions[0],
    [sessions, activeSessionId],
  );
  const messages = useMemo(() => activeSession?.messages || EMPTY_MESSAGES, [activeSession]);
  const isSessionLoading = useCallback((sessionId: string) => (
    loadingSessionIds.includes(sessionId)
  ), [loadingSessionIds]);
  const isLoading = isSessionLoading(activeSessionId);

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

  // Messages pushed past CHAT_MESSAGES_MAX are dropped from the local view
  // only — NO sync tombstone is queued. Eviction is a local retention limit,
  // not a user delete; broadcasting it would delete the messages server-side
  // and on every other device. mergeSyncedMessages applies the same cap on
  // the way in so the view stays bounded without oscillation.
  const updateSessionMessages = useCallback((
    sessionId: string,
    updater: (messages: ChatMessage[], session: ChatSession) => ChatMessage[],
  ) => {
    markLocalMutation();
    setSessions((prev) => prev.map((session) => {
      if (session.id !== sessionId) return session;

      const updated = updater(session.messages, session);
      const nextMessages = updated.slice(-CHAT_MESSAGES_MAX);
      let title = session.title;
      if (isAutoManagedSessionTitle(session)) {
        const titleKey = sessionTitleCacheKey(nextMessages);
        const cached = sessionTitleCacheRef.current.get(session.id);
        if (cached && cached.key === titleKey) {
          title = cached.title;
        } else {
          title = sessionTitleFromMessages(nextMessages, DEFAULT_CHAT_TITLE);
          sessionTitleCacheRef.current.set(session.id, { key: titleKey, title });
        }
      }
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
    setStatusText('');
    setStatusType('');
    setDebugRaw('（尚未请求）');
    setDebugVisible(false);
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

  const setPromptDraft = useCallback((sessionId: string, text: string) => {
    setPromptDrafts((prev) => {
      if (!text) {
        if (!(sessionId in prev)) return prev;
        const next = { ...prev };
        delete next[sessionId];
        return next;
      }
      return prev[sessionId] === text ? prev : { ...prev, [sessionId]: text };
    });
  }, []);

  const deleteChatSession = useCallback((sessionId: string) => {
    if (isSessionLoading(sessionId)) return;

    const index = sessions.findIndex((session) => session.id === sessionId);
    if (index < 0) return;
    addSyncTombstones([{ type: 'session', id: sessionId, deletedAt: Date.now() }]);
    sessionTitleCacheRef.current.delete(sessionId);
    setPromptDraft(sessionId, '');

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
  }, [sessions, activeSessionId, isSessionLoading, addSyncTombstones, markLocalMutation, setPromptDraft]);

  const clearChatSession = useCallback((sessionId: string) => {
    if (isSessionLoading(sessionId)) return;
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
  }, [sessions, activeSessionId, isSessionLoading, addSyncTombstones, markLocalMutation]);

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


  const addUserMsg = useCallback((prompt: string, sessionId = activeSessionId, request?: ChatTurnSnapshot, serverRunId?: string) => {
    const message = createChatMessage({ role: 'user', prompt, images: [], text: '', code: '', extra: '', request, serverRunId });
    updateSessionMessages(sessionId, (prev) => [
      ...prev,
      message,
    ]);
    return message.id;
  }, [activeSessionId, updateSessionMessages]);

  const addBotMsg = useCallback((images: ImageHit[], code: string, extra: string, sessionId = activeSessionId, serverRunId?: string) => {
    const message = createChatMessage({ role: 'bot', prompt: '', images, text: '', code, extra, serverRunId });
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

  const deleteMessage = useCallback((messageId: string, sessionId = activeSessionId) => {
    const session = sessions.find((item) => item.id === sessionId);
    const target = session?.messages.find((message) => message.id === messageId);
    if (target?.serverRunId && readPendingServerRuns().some((run) => run.id === target.serverRunId)) {
      if (sessionId === activeSessionId) {
        setStatusText('任务进行中，无法删除');
        setStatusType('warn');
      }
      return;
    }
    if (session?.messages.some((message) => message.id === messageId)) {
      addSyncTombstones([{ type: 'message', id: messageId, sessionId, deletedAt: Date.now() }]);
    }
    updateSessionMessages(sessionId, (prev) => prev.filter((message) => message.id !== messageId));
  }, [sessions, activeSessionId, updateSessionMessages, addSyncTombstones]);

  const upsertMessages = useCallback((sessionId: string, incomingMessages: ChatMessage[], titleHint?: string) => {
    if (incomingMessages.length === 0) return;
    markLocalMutation();
    setSessions((prev) => {
      const now = Date.now();
      const applyMessages = (session: ChatSession): ChatSession => {
        const byId = new Map(session.messages.map((message) => [message.id, message]));
        for (const message of incomingMessages) {
          const existing = byId.get(message.id);
          byId.set(message.id, {
            ...existing,
            ...message,
            // Keep the original stamp so a restored/regenerated pair keeps
            // its position instead of being re-sorted to the end.
            createdAt: existing?.createdAt ?? message.createdAt,
            syncDirty: true,
          });
        }
        const sortedMessages = [...byId.values()]
          .sort((a, b) => a.createdAt - b.createdAt);
        const nextMessages = sortedMessages.slice(-CHAT_MESSAGES_MAX);
        const title = isAutoManagedSessionTitle(session)
          ? sessionTitleFromMessages(nextMessages, titleHint || DEFAULT_CHAT_TITLE)
          : session.title;

        return {
          ...session,
          title,
          messages: nextMessages,
          updatedAt: now,
          syncDirty: true,
        };
      };

      if (prev.some((session) => session.id === sessionId)) {
        return prev.map((session) => (
          session.id === sessionId ? applyMessages(session) : session
        ));
      }

      const nextMessages = incomingMessages
        .sort((a, b) => a.createdAt - b.createdAt)
        .slice(-CHAT_MESSAGES_MAX);
      const createdAt = Math.min(...nextMessages.map((message) => message.createdAt), now);

      return [
        {
          id: sessionId,
          title: sessionTitleFromMessages(nextMessages, titleHint || DEFAULT_CHAT_TITLE),
          titleSource: 'auto' as const,
          messages: nextMessages,
          createdAt,
          updatedAt: now,
          syncDirty: true,
        },
        ...prev,
      ].slice(0, CHAT_SESSIONS_MAX);
    });
  }, [markLocalMutation]);

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
    message: Pick<ChatMessage, 'prompt' | 'images' | 'text' | 'code' | 'extra'> & Partial<Pick<ChatMessage, 'thinking' | 'thinkingDone' | 'serverRunId'>>,
    sessionId = activeSessionId,
  ) => {
    updateSessionMessages(sessionId, (prev) => prev.map((current) => (
      current.id === messageId && current.role === 'bot'
        ? { ...current, ...message, role: 'bot', updatedAt: Date.now(), syncDirty: true }
        : current
    )));
  }, [activeSessionId, updateSessionMessages]);

  const setLoading = useCallback((value: boolean, sessionId?: string) => {
    if (!value && !sessionId) {
      setLoadingSessionIds([]);
      return;
    }

    const targetSessionId = sessionId || activeSessionId;
    setLoadingSessionIds((current) => {
      if (value) {
        return current.includes(targetSessionId) ? current : [...current, targetSessionId];
      }
      return current.filter((id) => id !== targetSessionId);
    });
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
    if (!storageReady || storageLoadFailedRef.current || isLocalDataCleared()) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        const recentSessions = sessions.slice(0, CHAT_SESSIONS_MAX);
        const { storedSessions, memorySessions, changed } = await prepareSessionsForStorage(recentSessions);

        if (cancelled || isLocalDataCleared()) return;
        if (changed) {
          // prepareSessionsForStorage 只改写 messages 的 images/request（dataUrl→asset URL）；
          // 按 id 逐条合并，避免用 await 前的旧快照整体覆盖流式新增的消息
          const snapshotById = new Map(
            recentSessions.flatMap((session) => session.messages.map((message) => [message.id, message] as const)),
          );
          setSessions((current) => current.map((session) => {
            const replacement = memorySessions.find((item) => item.id === session.id);
            if (!replacement) return session;
            const preparedById = new Map(replacement.messages.map((message) => [message.id, message]));
            return {
              ...session,
              messages: session.messages.map((message) => {
                const prepared = preparedById.get(message.id);
                // Only adopt the prepared fields when the live message is the
                // same object the snapshot was built from — a concurrent
                // replaceBotMessage would otherwise be overwritten.
                if (prepared && snapshotById.get(message.id) === message) {
                  return { ...message, images: prepared.images, request: prepared.request };
                }
                return message;
              }),
            };
          }));
        }

        if (!isLocalDataCleared()) {
          persistStoredSessions(storedSessions, activeSessionIdRef.current, () => cancelled || isLocalDataCleared());
        }
      })().catch(() => { /* storage write failures are non-fatal */ });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [sessions, activeSessionId, storageReady]);

  useEffect(() => {
    if (!storageReady || storageLoadFailedRef.current || isLocalDataCleared()) return;
    import('idb-keyval')
      .then(({ set }) => {
        // The dynamic import may resolve after a clearAll landed — re-check.
        if (isLocalDataCleared()) return undefined;
        return set(CHAT_SYNC_TOMBSTONES_STORAGE_KEY, JSON.stringify(syncTombstones));
      })
      .catch(() => { /* ignore */ });
  }, [syncTombstones, storageReady]);

  useEffect(() => {
    if (!storageReady) return;
    if (applyingSyncRef.current) return;
    // While runs are in flight every state change would re-arm the debounce
    // and POST mid-run snapshots; a completion mutation re-triggers this
    // effect naturally once loading clears.
    if (loadingSessionIdsRef.current.length > 0) return;
    const auth = readSessionSyncAuth();
    if (!auth) return;
    const timer = window.setTimeout(() => {
      if (loadingSessionIdsRef.current.length > 0) return;
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
          } else if (loadingSessionIdsRef.current.length === 0) {
            // run 进行中不重试：run 结束后的 localMutation 会让 signature 变化并自然触发下一次同步
            setAutoSyncRetryTick((value) => value + 1);
          }
        } catch {
          autoSyncFailureCountRef.current += 1;
          if (autoSyncRetryTimerRef.current) window.clearTimeout(autoSyncRetryTimerRef.current);
          autoSyncRetryTimerRef.current = window.setTimeout(() => {
            autoSyncRetryTimerRef.current = null;
            setAutoSyncRetryTick((value) => value + 1);
          }, Math.min(30_000, 2_000 * autoSyncFailureCountRef.current));
        }
      })();
    }, 1500);
    return () => {
      window.clearTimeout(timer);
      if (autoSyncRetryTimerRef.current) {
        window.clearTimeout(autoSyncRetryTimerRef.current);
        autoSyncRetryTimerRef.current = null;
      }
    };
  }, [sessions, activeSessionId, syncTombstones, autoSyncRetryTick, getSyncSnapshot, syncChatHistory, storageReady]);

  const clearCurrentChat = useCallback(() => {
    clearChatSession(activeSessionId);
  }, [activeSessionId, clearChatSession]);

  const value = useMemo(() => ({
    sessions,
    activeSessionId,
    messages,
    isLoading,
    isSessionLoading,
    statusText,
    statusType,
    debugRaw,
    debugVisible,
    promptDrafts,
    setPromptDraft,
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
    deleteMessage,
    updateUserMessage,
    truncateChatAfterMessage,
    replaceBotMessage,
    upsertMessages,
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
    messages,
    isLoading,
    isSessionLoading,
    statusText,
    statusType,
    debugRaw,
    debugVisible,
    promptDrafts,
    setPromptDraft,
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
    deleteMessage,
    updateUserMessage,
    truncateChatAfterMessage,
    replaceBotMessage,
    upsertMessages,
    setLoading,
    setStatus,
    setDebugRaw,
    toggleDebug,
    showDebug,
    clearCurrentChat,
  ]);

  return <ChatContext.Provider value={value}>{storageReady ? children : null}</ChatContext.Provider>;
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used within ChatProvider');
  return ctx;
}
