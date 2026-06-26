'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useConfig } from '@/contexts/ConfigContext';
import { useChat } from '@/contexts/ChatContext';
import { useImages } from '@/contexts/ImageContext';
import type { ChatMessage, ChatReferenceImage, ChatTurnSnapshot } from '@/contexts/ChatContext';
import { chatSessionPromptStorageKey } from '@/lib/constants';
import { parseSize, resolveRequestSize } from '@/lib/size';
import {
  type RunMode,
  imageRefToReferenceImage,
  createTurnSnapshot,
} from '@/lib/image-ref-utils';
import {
  addPendingServerRun,
  createServerRunAccessToken,
  createServerRunId,
  readPendingServerRuns,
  removePendingServerRun,
  type ServerRunCreatePayload,
  type ServerRunPublicRecord,
} from '@/lib/server-runs';
import type { ImageRef } from '@/types';

export interface PromptRunOptions {
  existingUserMessageId?: string;
  targetBotMessageId?: string;
  historyMessages?: ChatMessage[];
  requestSnapshot?: ChatTurnSnapshot;
}

const SERVER_RUN_MISSING_TIMEOUT_MS = 30_000;

function createRestoredMessages(run: ServerRunPublicRecord): ChatMessage[] {
  const createdAt = run.createdAt || Date.now();
  const running = run.status === 'queued' || run.status === 'running';
  const result = run.result;
  const errorText = run.error || '请求失败';

  return [
    {
      id: run.userMessageId,
      role: 'user',
      prompt: run.prompt,
      images: [],
      text: '',
      code: '',
      extra: '',
      request: run.request,
      createdAt,
      updatedAt: run.updatedAt,
      syncDirty: true,
      serverRunId: running ? run.id : undefined,
    },
    {
      id: run.botMessageId,
      role: 'bot',
      prompt: result?.prompt ?? (run.status === 'failed' || run.status === 'canceled' ? errorText : ''),
      images: result?.images ?? [],
      text: result?.text ?? '',
      thinking: result?.thinking,
      thinkingDone: result?.thinkingDone,
      code: result?.code ?? '',
      extra: result?.extra ?? (run.status === 'failed' || run.status === 'canceled' ? 'error' : ''),
      createdAt: createdAt + 1,
      updatedAt: run.updatedAt,
      syncDirty: true,
      serverRunId: running ? run.id : undefined,
    },
  ];
}

interface RunApiResponse {
  error?: string | { message?: string };
  runs?: ServerRunPublicRecord[];
  run?: ServerRunPublicRecord;
}

async function readRunResponse(response: Response): Promise<RunApiResponse> {
  const data = await response.json().catch(() => ({} as RunApiResponse)) as RunApiResponse;
  if (!response.ok) {
    const error = typeof data.error === 'string'
      ? data.error
      : typeof (data.error as { message?: string } | undefined)?.message === 'string'
        ? (data.error as { message: string }).message
        : '后台任务请求失败';
    throw new Error(error);
  }
  return data;
}

export function useRunPrompt() {
  const [pendingRegenerateMessageId, setPendingRegenerateMessageId] = useState<string | null>(null);

  const { config, options } = useConfig();
  const {
    sessions,
    activeSessionId,
    addBotMsg,
    addUserMsg,
    updateUserMessage,
    truncateChatAfterMessage,
    replaceBotMessage,
    upsertMessages,
    setLoading,
    setStatus,
    setDebugRaw,
    isLoading,
  } = useChat();
  const { images, selectedIndices, clearAll: clearImages } = useImages();

  const sessionsRef = useRef(sessions);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollPendingRunsRef = useRef<() => Promise<void>>(async () => undefined);
  const activeRunIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);

  const applyRunToChat = useCallback((run: ServerRunPublicRecord) => {
    const running = run.status === 'queued' || run.status === 'running';
    upsertMessages(run.sessionId, createRestoredMessages(run), run.prompt);

    if (running) {
      activeRunIdsRef.current.add(run.id);
      setLoading(true, run.sessionId);
      setStatus(run.error || '后台任务运行中...', 'warn');
      return;
    }

    activeRunIdsRef.current.delete(run.id);
    removePendingServerRun(run.id);
    if (run.botMessageId === pendingRegenerateMessageId) setPendingRegenerateMessageId(null);

    if (run.result?.debugRaw) setDebugRaw(run.result.debugRaw);
    if (run.result?.statusText) setStatus(run.result.statusText, run.result.statusType || '');
    else if (run.status === 'completed') setStatus('任务完成', 'ok');
    else setStatus(run.error || '请求失败', run.status === 'canceled' ? 'warn' : 'err');

    if (activeRunIdsRef.current.size === 0) setLoading(false, run.sessionId);
  }, [pendingRegenerateMessageId, setDebugRaw, setLoading, setStatus, upsertMessages]);

  const pollPendingRuns = useCallback(async () => {
    const pending = readPendingServerRuns();
    if (pending.length === 0) {
      activeRunIdsRef.current.clear();
      setLoading(false);
      return;
    }

    try {
      const response = await fetch(
        `/api/runs?ids=${encodeURIComponent(pending.map((item) => item.id).join(','))}&tokens=${encodeURIComponent(pending.map((item) => item.accessToken).join(','))}`,
      );
      const data = await readRunResponse(response);
      const runs = Array.isArray(data.runs) ? data.runs : [];
      const seen = new Set(runs.map((run) => run.id));

      for (const run of runs) applyRunToChat(run);
      for (const item of pending) {
        if (seen.has(item.id)) continue;
        if (Date.now() - item.createdAt > SERVER_RUN_MISSING_TIMEOUT_MS) {
          removePendingServerRun(item.id);
          activeRunIdsRef.current.delete(item.id);
          replaceBotMessage(item.botMessageId, {
            prompt: '后台任务未成功提交，请重新发送。',
            images: [],
            text: '',
            code: '',
            extra: 'error',
            serverRunId: undefined,
          }, item.sessionId);
          setStatus('后台任务未成功提交', 'err');
          continue;
        }
        setLoading(true, item.sessionId);
        setStatus('后台任务提交中...', 'warn');
      }

      if (readPendingServerRuns().length > 0) {
        if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
        pollTimerRef.current = setTimeout(() => { void pollPendingRunsRef.current(); }, 2000);
      }
    } catch (error) {
      setStatus((error as Error).message || '后台任务同步失败', 'err');
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      pollTimerRef.current = setTimeout(() => { void pollPendingRunsRef.current(); }, 4000);
    }
  }, [applyRunToChat, replaceBotMessage, setLoading, setStatus]);

  useEffect(() => {
    pollPendingRunsRef.current = pollPendingRuns;
  }, [pollPendingRuns]);

  useEffect(() => {
    const initialPollId = setTimeout(() => { void pollPendingRuns(); }, 0);
    return () => {
      clearTimeout(initialPollId);
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [pollPendingRuns]);

  const submitServerRun = useCallback(async (payload: ServerRunCreatePayload) => {
    addPendingServerRun({
      id: payload.id,
      accessToken: payload.accessToken,
      sessionId: payload.sessionId,
      userMessageId: payload.userMessageId,
      botMessageId: payload.botMessageId,
      createdAt: Date.now(),
    });
    activeRunIdsRef.current.add(payload.id);
    setLoading(true, payload.sessionId);
    setStatus('后台任务已提交...', 'warn');

    const body = JSON.stringify(payload);
    const response = await fetch('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: body.length < 60_000,
    });
    const data = await readRunResponse(response);
    if (data.run) applyRunToChat(data.run);
    void pollPendingRuns();
  }, [applyRunToChat, pollPendingRuns, setLoading, setStatus]);

  const runPrompt = useCallback(async (
    prompt: string,
    runOptions: PromptRunOptions = {},
  ) => {
    const cleanPrompt = prompt.trim();
    if (!cleanPrompt || isLoading) return;

    const sessionId = activeSessionId;
    const existingUserMessageId = runOptions.existingUserMessageId;
    const targetBotMessageId = runOptions.targetBotMessageId;
    const currentSessionMessages = sessionsRef.current.find((session) => session.id === sessionId)?.messages ?? [];
    const sessionMessages = runOptions.historyMessages ?? currentSessionMessages;
    let submittedBotMessageId = targetBotMessageId || '';

    const runId = createServerRunId();
    const accessToken = createServerRunAccessToken();
    const requestController = new AbortController();

    try {
      if (options.persistPrompt) {
        try { localStorage.setItem(chatSessionPromptStorageKey(sessionId), cleanPrompt); } catch { /* ignore */ }
      }

      const isSnapshotRun = !!runOptions.requestSnapshot;
      const validSelectedIndices = [...selectedIndices].filter((index) => index >= 0 && index < images.length);
      const selectedImagesForRun = !isSnapshotRun && config.mode !== 'chat' && validSelectedIndices.length > 0
        ? validSelectedIndices.map((index) => images[index]).filter((image): image is ImageRef => !!image)
        : [];
      const requestedMode: RunMode = runOptions.requestSnapshot?.mode
        ?? (config.mode === 'chat' ? 'chat' : selectedImagesForRun.length > 0 ? 'edits' : 'images');
      const resolvedSize = runOptions.requestSnapshot?.size
        ?? resolveRequestSize(config.size, selectedImagesForRun);
      const referenceImages = runOptions.requestSnapshot?.referenceImages
        ?? (requestedMode === 'edits'
          ? (await Promise.all(selectedImagesForRun.map((image) => imageRefToReferenceImage(image, requestController.signal))))
              .filter((reference): reference is ChatReferenceImage => reference !== null)
          : []);
      const requestSnapshot = runOptions.requestSnapshot
        ?? createTurnSnapshot(config, options, requestedMode, resolvedSize, requestedMode === 'edits' ? referenceImages : []);
      const normalizedRequest: ChatTurnSnapshot = {
        ...requestSnapshot,
        size: parseSize(requestSnapshot.size) ? requestSnapshot.size : resolvedSize,
        streaming: false,
      };

      let userMessageId = existingUserMessageId || '';
      let botMessageId = targetBotMessageId || '';

      if (targetBotMessageId) {
        setPendingRegenerateMessageId(targetBotMessageId);
        replaceBotMessage(targetBotMessageId, {
          prompt: '',
          images: [],
          text: '',
          code: '',
          extra: '',
          serverRunId: runId,
        }, sessionId);
        const priorUser = [...sessionMessages].reverse().find((message) => message.role === 'user' && message.prompt.trim());
        userMessageId = priorUser?.id || createServerRunId();
      } else if (existingUserMessageId) {
        updateUserMessage(existingUserMessageId, cleanPrompt, sessionId, normalizedRequest, { markEdited: true });
        truncateChatAfterMessage(existingUserMessageId, sessionId);
        userMessageId = existingUserMessageId;
        botMessageId = addBotMsg([], '', '', sessionId, runId);
        submittedBotMessageId = botMessageId;
      } else {
        userMessageId = addUserMsg(cleanPrompt, sessionId, normalizedRequest, runId);
        botMessageId = addBotMsg([], '', '', sessionId, runId);
        submittedBotMessageId = botMessageId;
      }

      if (!isSnapshotRun && options.clearOnSubmit) clearImages();

      await submitServerRun({
        id: runId,
        accessToken,
        sessionId,
        userMessageId,
        botMessageId,
        prompt: cleanPrompt,
        config,
        options: { ...options, streaming: false },
        request: normalizedRequest,
        historyMessages: sessionMessages,
      });
    } catch (error) {
      const message = (error as Error).message || '后台任务提交失败';
      removePendingServerRun(runId);
      activeRunIdsRef.current.delete(runId);
      setPendingRegenerateMessageId((current) => (current === targetBotMessageId ? null : current));
      if (submittedBotMessageId) {
        replaceBotMessage(submittedBotMessageId, {
          prompt: message,
          images: [],
          text: '',
          code: '',
          extra: 'error',
          serverRunId: undefined,
        }, sessionId);
      } else {
        const botMessageId = addBotMsg([], '', 'error', sessionId);
        replaceBotMessage(botMessageId, {
          prompt: message,
          images: [],
          text: '',
          code: '',
          extra: 'error',
          serverRunId: undefined,
        }, sessionId);
      }
      setStatus(message, 'err');
      if (activeRunIdsRef.current.size === 0) setLoading(false, sessionId);
    }
  }, [
    activeSessionId,
    addBotMsg,
    addUserMsg,
    clearImages,
    config,
    images,
    isLoading,
    options,
    replaceBotMessage,
    selectedIndices,
    setLoading,
    setStatus,
    submitServerRun,
    truncateChatAfterMessage,
    updateUserMessage,
  ]);

  const handleCancel = useCallback(() => {
    const pending = readPendingServerRuns().filter((item) => activeRunIdsRef.current.has(item.id));
    if (pending.length === 0) return;
    setStatus('正在取消后台任务...', 'warn');
    void Promise.allSettled(pending.map((item) => fetch(`/api/runs/${encodeURIComponent(item.id)}`, {
      method: 'DELETE',
      headers: { 'x-run-access-token': item.accessToken },
    })))
      .finally(() => {
        pending.forEach((item) => removePendingServerRun(item.id));
        activeRunIdsRef.current.clear();
        setLoading(false);
        setStatus('已取消', 'warn');
        void pollPendingRuns();
      });
  }, [pollPendingRuns, setLoading, setStatus]);

  const handleSend = useCallback((prompt: string) => {
    void runPrompt(prompt);
  }, [runPrompt]);

  const handleRegenerateMessage = useCallback((messageId: string) => {
    if (isLoading) return;
    const session = sessionsRef.current.find((item) => item.id === activeSessionId);
    if (!session) return;
    const botIndex = session.messages.findIndex((message) => message.id === messageId && message.role === 'bot');
    if (botIndex <= 0) return;
    const priorMessages = session.messages.slice(0, botIndex);
    const userMessage = [...priorMessages].reverse().find((message) => message.role === 'user' && message.prompt.trim());
    if (!userMessage) return;
    void runPrompt(userMessage.prompt, {
      targetBotMessageId: messageId,
      historyMessages: priorMessages.filter((message) => message.id !== userMessage.id),
      requestSnapshot: userMessage.request,
    });
  }, [activeSessionId, isLoading, runPrompt]);

  const handleEditMessage = useCallback((messageId: string, prompt: string) => {
    if (isLoading) return;
    const session = sessionsRef.current.find((item) => item.id === activeSessionId);
    if (!session) return;
    const messageIndex = session.messages.findIndex((message) => message.id === messageId && message.role === 'user');
    if (messageIndex < 0) return;
    const userMessage = session.messages[messageIndex];
    const historyMessages = session.messages.slice(0, messageIndex);
    void runPrompt(prompt, {
      existingUserMessageId: messageId,
      historyMessages,
      requestSnapshot: userMessage.request,
    });
  }, [activeSessionId, isLoading, runPrompt]);

  return {
    handleSend,
    handleRegenerateMessage,
    handleEditMessage,
    handleCancel,
    pendingRegenerateMessageId,
  };
}
