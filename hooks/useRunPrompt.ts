'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useConfig } from '@/contexts/ConfigContext';
import { useChat } from '@/contexts/ChatContext';
import { useImages } from '@/contexts/ImageContext';
import type { ChatMessage, ChatReferenceImage, ChatTurnSnapshot } from '@/contexts/ChatContext';
import { chatSessionPromptStorageKey } from '@/lib/constants';
import { parseSize, resolveRequestSize } from '@/lib/size';
import { buildRepeaterReply } from '@/lib/api-parsers';
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

function isRunningServerRun(run: ServerRunPublicRecord) {
  return run.status === 'queued' || run.status === 'running';
}

function isFinishedServerRun(run: ServerRunPublicRecord) {
  return run.status === 'completed' || run.status === 'failed' || run.status === 'canceled';
}

function hasTrackedPendingRunForSession(activeRunIds: Set<string>, sessionId: string) {
  const pendingRuns = readPendingServerRuns();
  const pendingIds = new Set(pendingRuns.map((item) => item.id));
  for (const runId of [...activeRunIds]) {
    if (!pendingIds.has(runId)) activeRunIds.delete(runId);
  }
  return pendingRuns.some((run) => run.sessionId === sessionId && activeRunIds.has(run.id));
}

function createRestoredMessages(run: ServerRunPublicRecord): ChatMessage[] {
  const createdAt = run.createdAt || Date.now();
  const running = isRunningServerRun(run);
  const failed = run.status === 'failed' || run.status === 'canceled';
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
      prompt: failed ? (result?.prompt || errorText) : result?.prompt ?? '',
      images: result?.images ?? [],
      text: result?.text ?? '',
      thinking: result?.thinking,
      thinkingDone: result?.thinkingDone,
      code: result?.code ?? '',
      extra: failed ? (result?.extra || 'error') : result?.extra ?? '',
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

function parseRunEventBlock(block: string): ServerRunPublicRecord | null {
  let eventType = 'message';
  const dataLines: string[] = [];

  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) {
      eventType = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
    }
  }

  if (eventType !== 'run' || dataLines.length === 0) return null;
  return JSON.parse(dataLines.join('\n')) as ServerRunPublicRecord;
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

  const { config, options, modelGateEnabled, modelGateUnlocked } = useConfig();
  const {
    sessions,
    activeSessionId,
    addBotMsg,
    addTextBotMsg,
    addUserMsg,
    updateUserMessage,
    truncateChatAfterMessage,
    replaceBotMessage,
    upsertMessages,
    setGeneratedSessionTitle,
    setLoading,
    setStatus,
    setDebugRaw,
    isLoading,
  } = useChat();
  const { images, selectedIndices, clearAll: clearImages } = useImages();

  const sessionsRef = useRef(sessions);
  const activeSessionIdRef = useRef(activeSessionId);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollPendingRunsRef = useRef<() => Promise<void>>(async () => undefined);
  const activeRunIdsRef = useRef<Set<string>>(new Set());
  const runEventControllersRef = useRef<Map<string, AbortController>>(new Map());
  const applyRunToChatRef = useRef<(run: ServerRunPublicRecord) => void>(() => undefined);

  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);
  useEffect(() => { activeSessionIdRef.current = activeSessionId; }, [activeSessionId]);

  const setStatusForSession = useCallback((
    sessionId: string,
    text: string,
    type: '' | 'ok' | 'err' | 'warn' = '',
  ) => {
    if (activeSessionIdRef.current === sessionId) setStatus(text, type);
  }, [setStatus]);

  const setDebugRawForSession = useCallback((sessionId: string, text: string) => {
    if (activeSessionIdRef.current === sessionId) setDebugRaw(text);
  }, [setDebugRaw]);

  const closeRunEvents = useCallback((runId: string) => {
    const controller = runEventControllersRef.current.get(runId);
    if (!controller) return;
    controller.abort();
    runEventControllersRef.current.delete(runId);
  }, []);

  const closeAllRunEvents = useCallback(() => {
    for (const controller of runEventControllersRef.current.values()) controller.abort();
    runEventControllersRef.current.clear();
  }, []);

  const subscribeRunEvents = useCallback((runId: string) => {
    if (typeof window === 'undefined') return;
    if (runEventControllersRef.current.has(runId)) return;

    const pending = readPendingServerRuns().find((item) => item.id === runId);
    if (!pending) return;

    const controller = new AbortController();
    runEventControllersRef.current.set(runId, controller);

    void (async () => {
      let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
      try {
        const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/events`, {
          headers: { 'x-run-access-token': pending.accessToken },
          signal: controller.signal,
        });
        if (!response.ok || !response.body) throw new Error('后台任务事件订阅失败');

        reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (!controller.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split('\n\n');
          buffer = blocks.pop() || '';

          for (const block of blocks) {
            const run = parseRunEventBlock(block);
            if (!run) continue;
            applyRunToChatRef.current(run);
            if (isFinishedServerRun(run)) return;
          }
        }

        const tail = decoder.decode();
        if (tail) buffer += tail;
        if (buffer.trim()) {
          const run = parseRunEventBlock(buffer);
          if (run) applyRunToChatRef.current(run);
        }
      } catch {
        // Polling remains the fallback when the streaming subscription fails.
      } finally {
        await reader?.cancel().catch(() => undefined);
        if (runEventControllersRef.current.get(runId) === controller) {
          runEventControllersRef.current.delete(runId);
        }
      }
    })();
  }, []);

  const applyRunToChat = useCallback((run: ServerRunPublicRecord) => {
    const running = isRunningServerRun(run);
    upsertMessages(run.sessionId, createRestoredMessages(run), run.prompt);
    if (run.result?.generatedTitle) setGeneratedSessionTitle(run.sessionId, run.result.generatedTitle);

    if (running) {
      activeRunIdsRef.current.add(run.id);
      setLoading(true, run.sessionId);
      subscribeRunEvents(run.id);
      setStatusForSession(
        run.sessionId,
        run.error || run.result?.statusText || '后台任务运行中...',
        run.error ? 'warn' : run.result?.statusType || 'warn',
      );
      return;
    }

    activeRunIdsRef.current.delete(run.id);
    closeRunEvents(run.id);
    removePendingServerRun(run.id);
    if (run.botMessageId === pendingRegenerateMessageId) setPendingRegenerateMessageId(null);

    if (run.result?.debugRaw) setDebugRawForSession(run.sessionId, run.result.debugRaw);
    if (run.result?.statusText) setStatusForSession(run.sessionId, run.result.statusText, run.result.statusType || '');
    else if (run.status === 'completed') setStatusForSession(run.sessionId, '任务完成', 'ok');
    else setStatusForSession(run.sessionId, run.error || '请求失败', run.status === 'canceled' ? 'warn' : 'err');

    if (!hasTrackedPendingRunForSession(activeRunIdsRef.current, run.sessionId)) {
      setLoading(false, run.sessionId);
    }
  }, [
    closeRunEvents,
    pendingRegenerateMessageId,
    setDebugRawForSession,
    setLoading,
    setStatusForSession,
    subscribeRunEvents,
    setGeneratedSessionTitle,
    upsertMessages,
  ]);

  useEffect(() => {
    applyRunToChatRef.current = applyRunToChat;
  }, [applyRunToChat]);

  const pollPendingRuns = useCallback(async () => {
    const pending = readPendingServerRuns();
    if (pending.length === 0) {
      activeRunIdsRef.current.clear();
      closeAllRunEvents();
      setLoading(false);
      return;
    }

    try {
      const response = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: pending.map((item) => ({ id: item.id, accessToken: item.accessToken })),
        }),
      });
      const data = await readRunResponse(response);
      const runs = Array.isArray(data.runs) ? data.runs : [];
      const seen = new Set(runs.map((run) => run.id));

      for (const run of runs) applyRunToChat(run);
      for (const item of pending) {
        if (seen.has(item.id)) continue;
        if (Date.now() - item.createdAt > SERVER_RUN_MISSING_TIMEOUT_MS) {
          removePendingServerRun(item.id);
          activeRunIdsRef.current.delete(item.id);
          closeRunEvents(item.id);
          replaceBotMessage(item.botMessageId, {
            prompt: '后台任务未成功提交，请重新发送。',
            images: [],
            text: '',
            code: '',
            extra: 'error',
            serverRunId: undefined,
          }, item.sessionId);
          setStatusForSession(item.sessionId, '后台任务未成功提交', 'err');
          if (!hasTrackedPendingRunForSession(activeRunIdsRef.current, item.sessionId)) {
            setLoading(false, item.sessionId);
          }
          continue;
        }
        subscribeRunEvents(item.id);
        setLoading(true, item.sessionId);
        setStatusForSession(item.sessionId, '后台任务提交中...', 'warn');
      }

      if (readPendingServerRuns().length > 0) {
        if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
        pollTimerRef.current = setTimeout(() => { void pollPendingRunsRef.current(); }, 2000);
      }
    } catch (error) {
      const activePendingRun = readPendingServerRuns().find((item) => item.sessionId === activeSessionIdRef.current);
      if (activePendingRun) {
        setStatusForSession(activePendingRun.sessionId, (error as Error).message || '后台任务同步失败', 'err');
      }
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      pollTimerRef.current = setTimeout(() => { void pollPendingRunsRef.current(); }, 4000);
    }
  }, [
    applyRunToChat,
    closeAllRunEvents,
    closeRunEvents,
    replaceBotMessage,
    setLoading,
    setStatusForSession,
    subscribeRunEvents,
  ]);

  useEffect(() => {
    pollPendingRunsRef.current = pollPendingRuns;
  }, [pollPendingRuns]);

  useEffect(() => {
    const initialPollId = setTimeout(() => { void pollPendingRuns(); }, 0);
    return () => {
      clearTimeout(initialPollId);
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      closeAllRunEvents();
    };
  }, [closeAllRunEvents, pollPendingRuns]);

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
    setStatusForSession(payload.sessionId, '后台任务已提交...', 'warn');

    const body = JSON.stringify({
      ...payload,
      config: { ...payload.config, serverAccessToken: '' },
    });
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (payload.config.serverAccessToken) headers['x-server-access-token'] = payload.config.serverAccessToken;
    const response = await fetch('/api/runs', {
      method: 'POST',
      headers,
      body,
      keepalive: body.length < 60_000,
    });
    const data = await readRunResponse(response);
    if (data.run) applyRunToChat(data.run);
    void pollPendingRuns();
  }, [applyRunToChat, pollPendingRuns, setLoading, setStatusForSession]);

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
      if (modelGateEnabled && !modelGateUnlocked) {
        const reply = buildRepeaterReply(cleanPrompt);
        if (targetBotMessageId) {
          replaceBotMessage(targetBotMessageId, {
            prompt: '',
            images: [],
            text: reply,
            code: '',
            extra: '',
            serverRunId: undefined,
          }, sessionId);
        } else if (existingUserMessageId) {
          updateUserMessage(existingUserMessageId, cleanPrompt, sessionId);
          truncateChatAfterMessage(existingUserMessageId, sessionId);
          addTextBotMsg(reply, '', sessionId);
        } else {
          addUserMsg(cleanPrompt, sessionId);
          addTextBotMsg(reply, '', sessionId);
        }
        setDebugRawForSession(sessionId, reply);
        setStatusForSession(sessionId, '回复完成', 'ok');
        return;
      }

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
      if (requestedMode === 'edits' && referenceImages.length === 0) {
        throw new Error('参考图加载失败，请重新上传后重试。');
      }
      const requestSnapshot = runOptions.requestSnapshot
        ?? createTurnSnapshot(config, options, requestedMode, resolvedSize, requestedMode === 'edits' ? referenceImages : []);
      const shouldStream = requestedMode === 'chat' && options.streaming;
      const normalizedRequest: ChatTurnSnapshot = {
        ...requestSnapshot,
        size: parseSize(requestSnapshot.size) ? requestSnapshot.size : resolvedSize,
        streaming: shouldStream,
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
        options: { ...options, streaming: shouldStream },
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
      setStatusForSession(sessionId, message, 'err');
      if (!hasTrackedPendingRunForSession(activeRunIdsRef.current, sessionId)) {
        setLoading(false, sessionId);
      }
    }
  }, [
    activeSessionId,
    addBotMsg,
    addTextBotMsg,
    addUserMsg,
    clearImages,
    config,
    images,
    isLoading,
    modelGateEnabled,
    modelGateUnlocked,
    options,
    replaceBotMessage,
    selectedIndices,
    setDebugRawForSession,
    setLoading,
    setStatusForSession,
    submitServerRun,
    truncateChatAfterMessage,
    updateUserMessage,
  ]);

  const handleCancel = useCallback(() => {
    const sessionId = activeSessionId;
    const pending = readPendingServerRuns().filter((item) => (
      item.sessionId === sessionId && activeRunIdsRef.current.has(item.id)
    ));
    if (pending.length === 0) return;
    setStatusForSession(sessionId, '正在取消后台任务...', 'warn');
    void Promise.allSettled(pending.map((item) => fetch(`/api/runs/${encodeURIComponent(item.id)}`, {
      method: 'DELETE',
      headers: { 'x-run-access-token': item.accessToken },
    }).then(readRunResponse).then(() => item)))
      .then((results) => {
        const canceled = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
        canceled.forEach((item) => {
          closeRunEvents(item.id);
          removePendingServerRun(item.id);
          activeRunIdsRef.current.delete(item.id);
          replaceBotMessage(item.botMessageId, {
            prompt: '用户已取消本次请求。',
            images: [],
            text: '',
            code: '',
            extra: 'error',
            serverRunId: undefined,
          }, item.sessionId);
        });
        setPendingRegenerateMessageId((current) => (
          canceled.some((item) => item.botMessageId === current) ? null : current
        ));
        if (!hasTrackedPendingRunForSession(activeRunIdsRef.current, sessionId)) {
          setLoading(false, sessionId);
        }
        if (canceled.length === pending.length) {
          setStatusForSession(sessionId, '已取消', 'warn');
        } else if (canceled.length > 0) {
          setStatusForSession(sessionId, `已取消 ${canceled.length} 个任务，${pending.length - canceled.length} 个任务仍在运行`, 'warn');
        } else {
          setStatusForSession(sessionId, '取消失败，后台任务仍在运行', 'err');
        }
        void pollPendingRuns();
      });
  }, [activeSessionId, closeRunEvents, pollPendingRuns, replaceBotMessage, setLoading, setStatusForSession]);

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
