'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useConfig } from '@/contexts/ConfigContext';
import { useChat } from '@/contexts/ChatContext';
import { useImages } from '@/contexts/ImageContext';
import type { ChatMessage, ChatReferenceImage, ChatTurnSnapshot } from '@/contexts/ChatContext';
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
  updatePendingServerRun,
  type PendingServerRunRef,
  type ServerRunCreatePayload,
  type ServerRunPublicRecord,
} from '@/lib/server-runs';
import { USER_ABORT_SENTINEL } from '@/lib/api';
import { currentLang } from '@/lib/i18n';
import { splitStreamEventBlocks } from '@/lib/stream-utils';
import type { ImageRef } from '@/types';

export interface PromptRunOptions {
  existingUserMessageId?: string;
  targetBotMessageId?: string;
  runUserMessageId?: string;
  historyMessages?: ChatMessage[];
  requestSnapshot?: ChatTurnSnapshot;
}

const SERVER_RUN_MISSING_TIMEOUT_MS = 30_000;
const SERVER_RUN_SUBMIT_TIMEOUT_MS = 60_000;

function updatePendingServerRunMissing(runId: string, missingSince: number | undefined) {
  updatePendingServerRun(runId, { missingSince });
}

function isRunningServerRun(run: ServerRunPublicRecord) {
  return run.status === 'queued' || run.status === 'running';
}

// How long a finished run stays queryable solely for its generatedTitle —
// covers the title-gen upstream call (bounded by the run's own timeout)
// plus the patch write; expiry just ends the window, nothing errors.
const RUN_TITLE_WATCH_MS = 45_000;

function isFinishedServerRun(run: ServerRunPublicRecord) {
  return run.status === 'completed' || run.status === 'failed' || run.status === 'canceled';
}

function hasTrackedPendingRunForSession(
  activeRunIds: Set<string>,
  ownedRuns: Map<string, PendingServerRunRef>,
  sessionId: string,
) {
  const pendingRuns = readPendingServerRuns();
  const pendingIds = new Set(pendingRuns.map((item) => item.id));
  // Owned runs stay tracked even when another tab clobbered the shared
  // pending list — pruning them here would make them un-cancelable and
  // flicker the loading flag between polls.
  for (const runId of [...activeRunIds]) {
    if (!pendingIds.has(runId) && !ownedRuns.has(runId)) activeRunIds.delete(runId);
  }
  const sessionOf = (id: string) => ownedRuns.get(id)?.sessionId
    ?? pendingRuns.find((run) => run.id === id)?.sessionId;
  for (const runId of activeRunIds) {
    if (sessionOf(runId) === sessionId) return true;
  }
  return false;
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

  for (const line of block.split(/\r\n|\r|\n/)) {
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
  const inFlightRef = useRef(false);
  const cancelRequestedRef = useRef(false);
  const preSubmitControllerRef = useRef<AbortController | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollPendingRunsRef = useRef<() => Promise<void>>(async () => undefined);
  const activeRunIdsRef = useRef<Set<string>>(new Set());
  const runEventControllersRef = useRef<Map<string, AbortController>>(new Map());
  const applyRunToChatRef = useRef<(run: ServerRunPublicRecord) => void>(() => undefined);
  const dispatchRunToChatRef = useRef<(run: ServerRunPublicRecord) => void>(() => undefined);
  // Runs this tab submitted — the shared pending list can be clobbered by
  // another tab's read-modify-write, so ownership is tracked separately.
  const ownedRunsRef = useRef<Map<string, PendingServerRunRef>>(new Map());
  // Runs the batch query reported missing — don't open a doomed SSE for them.
  const missingRunIdsRef = useRef<Set<string>>(new Set());
  // Last applied updatedAt per run — a stale record must not clobber a newer one.
  const lastAppliedRunStampRef = useRef<Map<string, number>>(new Map());
  const pendingRegenerateMessageIdRef = useRef<string | null>(null);
  // Streaming events are cumulative snapshots — coalesce bursts and apply only
  // the latest record per run so each SSE chunk doesn't re-render the chat.
  const runApplyQueueRef = useRef<Map<string, ServerRunPublicRecord>>(new Map());
  const runApplyFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);
  useEffect(() => { activeSessionIdRef.current = activeSessionId; }, [activeSessionId]);
  useEffect(() => { pendingRegenerateMessageIdRef.current = pendingRegenerateMessageId; }, [pendingRegenerateMessageId]);

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
    if (missingRunIdsRef.current.has(runId)) return;
    if (runEventControllersRef.current.has(runId)) return;

    // Fall back to this tab's owned record when another tab clobbered the
    // shared pending list — the access token is still needed for the SSE.
    const pending = readPendingServerRuns().find((item) => item.id === runId)
      ?? ownedRunsRef.current.get(runId);
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
          const { blocks, rest } = splitStreamEventBlocks(buffer);
          buffer = rest;

          for (const block of blocks) {
            const run = parseRunEventBlock(block);
            if (!run) continue;
            dispatchRunToChatRef.current(run);
            if (isFinishedServerRun(run)) return;
          }
        }

        const tail = decoder.decode();
        if (tail) buffer += tail;
        if (buffer.trim()) {
          const run = parseRunEventBlock(buffer);
          if (run) dispatchRunToChatRef.current(run);
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
    const lastApplied = lastAppliedRunStampRef.current.get(run.id);
    // <= dedupes same-stamp re-deliveries, but terminal records always land:
    // a canceled record may share the millisecond of a just-applied running
    // snapshot and skipping it would strand a generating bubble.
    if (lastApplied !== undefined && run.updatedAt <= lastApplied && isRunningServerRun(run)) return;
    lastAppliedRunStampRef.current.set(run.id, run.updatedAt);
    // Stale-application protection only matters while a run could still
    // deliver — bound the map by dropping stamps for untracked runs.
    if (lastAppliedRunStampRef.current.size > 1000) {
      for (const id of [...lastAppliedRunStampRef.current.keys()]) {
        if (!activeRunIdsRef.current.has(id) && !ownedRunsRef.current.has(id)) {
          lastAppliedRunStampRef.current.delete(id);
        }
        if (lastAppliedRunStampRef.current.size <= 500) break;
      }
    }

    const running = isRunningServerRun(run);
    if (!sessionsRef.current.some((session) => session.id === run.sessionId)) {
      // The session no longer exists locally (deleted, or wiped by clearAll)
      // — drop tracking instead of resurrecting a zombie session. The fresh
      // send path always creates the session before submitting, so a legit
      // run never lands here.
      console.warn('[useRunPrompt] dropping run for missing session', run.id, run.sessionId);
      activeRunIdsRef.current.delete(run.id);
      ownedRunsRef.current.delete(run.id);
      missingRunIdsRef.current.delete(run.id);
      runApplyQueueRef.current.delete(run.id);
      closeRunEvents(run.id);
      removePendingServerRun(run.id);
      setPendingRegenerateMessageId((current) => (current === run.botMessageId ? null : current));
      // A stale loading flag can outlive the session (e.g. clearAll wiped the
      // session list but not the per-session loading map) — clear it here so
      // no session is stuck on "generating" for a run we just dropped.
      if (!hasTrackedPendingRunForSession(activeRunIdsRef.current, ownedRunsRef.current, run.sessionId)) {
        setLoading(false, run.sessionId);
      }
      return;
    }

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
    // A completed run may still get its generatedTitle patched in moments
    // after the terminal write (title gen runs post-persist, and the SSE
    // stream already closed on 'completed'). Keep a bounded titleOnly ref so
    // the poll picks the patch up instead of losing the title until reload.
    if (run.status === 'completed' && !run.result?.generatedTitle) {
      const existing = ownedRunsRef.current.get(run.id)
        ?? readPendingServerRuns().find((item) => item.id === run.id);
      if (existing) {
        ownedRunsRef.current.set(run.id, {
          ...existing,
          titleOnly: true,
          keepUntil: Date.now() + RUN_TITLE_WATCH_MS,
          missingSince: undefined,
        });
      }
    } else {
      ownedRunsRef.current.delete(run.id);
    }
    missingRunIdsRef.current.delete(run.id);
    runApplyQueueRef.current.delete(run.id);
    closeRunEvents(run.id);
    removePendingServerRun(run.id);
    if (run.botMessageId === pendingRegenerateMessageIdRef.current) setPendingRegenerateMessageId(null);

    if (run.result?.debugRaw) setDebugRawForSession(run.sessionId, run.result.debugRaw);
    if (run.result?.statusText) setStatusForSession(run.sessionId, run.result.statusText, run.result.statusType || '');
    else if (run.status === 'completed') setStatusForSession(run.sessionId, '任务完成', 'ok');
    else setStatusForSession(run.sessionId, run.error || '请求失败', run.status === 'canceled' ? 'warn' : 'err');

    if (!hasTrackedPendingRunForSession(activeRunIdsRef.current, ownedRunsRef.current, run.sessionId)) {
      setLoading(false, run.sessionId);
    }
  }, [
    closeRunEvents,
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

  const flushQueuedRuns = useCallback(() => {
    runApplyFlushTimerRef.current = null;
    const queued = [...runApplyQueueRef.current.values()];
    runApplyQueueRef.current.clear();
    for (const run of queued) applyRunToChatRef.current(run);
  }, []);

  // Terminal states jump the queue — a finished run must apply now, and it
  // discards any still-queued intermediate snapshot for the same run.
  const dispatchRunToChat = useCallback((run: ServerRunPublicRecord) => {
    if (!isRunningServerRun(run)) {
      runApplyQueueRef.current.delete(run.id);
      applyRunToChatRef.current(run);
      return;
    }
    runApplyQueueRef.current.set(run.id, run);
    if (!runApplyFlushTimerRef.current) {
      runApplyFlushTimerRef.current = setTimeout(flushQueuedRuns, 120);
    }
  }, [flushQueuedRuns]);

  useEffect(() => {
    dispatchRunToChatRef.current = dispatchRunToChat;
  }, [dispatchRunToChat]);

  const cancelServerRun = useCallback(async (item: PendingServerRunRef): Promise<boolean> => {
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(item.id)}`, {
        method: 'DELETE',
        headers: { 'x-run-access-token': item.accessToken },
      });
      // 404 = the server never stored this run (submit POST never landed or
      // the record was reaped). Tear it down locally as canceled instead of
      // reporting failure — the run provably can't produce a result.
      const data = response.status === 404
        ? ({} as RunApiResponse)
        : await readRunResponse(response);
      if (data.run) {
        // Always route the terminal record through the common apply path:
        // it stamps lastAppliedRunStamp and purges the coalescing queue, so
        // a still-queued 'running' snapshot can't resurrect a zombie
        // generating bubble after the cancel.
        dispatchRunToChatRef.current(data.run);
      } else {
        runApplyQueueRef.current.delete(item.id);
        closeRunEvents(item.id);
        removePendingServerRun(item.id);
        ownedRunsRef.current.delete(item.id);
        missingRunIdsRef.current.delete(item.id);
        activeRunIdsRef.current.delete(item.id);
        replaceBotMessage(item.botMessageId, {
          prompt: '用户已取消本次请求。',
          images: [],
          text: '',
          code: '',
          extra: 'error',
          serverRunId: undefined,
        }, item.sessionId);
      }
      setPendingRegenerateMessageId((current) => (current === item.botMessageId ? null : current));
      if (!hasTrackedPendingRunForSession(activeRunIdsRef.current, ownedRunsRef.current, item.sessionId)) {
        setLoading(false, item.sessionId);
      }
      return true;
    } catch {
      return false;
    }
  }, [closeRunEvents, replaceBotMessage, setLoading]);

  const pollPendingRuns = useCallback(async () => {
    const pending = readPendingServerRuns();
    // Owned runs must be queried even when another tab clobbered the shared
    // pending list — otherwise a still-running owned run turns invisible
    // while other runs keep pending non-empty.
    const pendingIds = new Set(pending.map((item) => item.id));
    const ownedExtras = [...ownedRunsRef.current.values()].filter((item) => !pendingIds.has(item.id));
    const items = [...pending, ...ownedExtras];
    // missingSince lives in the shared pending list for shared items and on
    // the owned map entry for owned-only items.
    const setMissingSince = (item: PendingServerRunRef, value: number | undefined) => {
      if (pendingIds.has(item.id)) updatePendingServerRunMissing(item.id, value);
      // The has() guard matters: a terminal-applied or concurrently-deleted
      // owned entry must not be resurrected by a late missing-stamp write.
      else if (ownedRunsRef.current.has(item.id)) {
        ownedRunsRef.current.set(item.id, { ...item, missingSince: value });
      }
    };
    if (items.length === 0) {
      ownedRunsRef.current.clear();
      missingRunIdsRef.current.clear();
      activeRunIdsRef.current.clear();
      closeAllRunEvents();
      setLoading(false);
      // A pre-submit run (reference conversion / POST in flight) registered
      // no pending entry yet — keep its spinner and cancel affordance.
      if (inFlightRef.current && activeSessionIdRef.current) {
        setLoading(true, activeSessionIdRef.current);
      }
      return;
    }

    try {
      const response = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: items.map((item) => ({ id: item.id, accessToken: item.accessToken })),
        }),
        // A hung poll socket must not wedge the re-arm — fail into the
        // catch, which schedules the next attempt.
        signal: AbortSignal.timeout(30_000),
      });
      const data = await readRunResponse(response);
      const runs = Array.isArray(data.runs) ? data.runs : [];
      const seen = new Set(runs.map((run) => run.id));

      for (const run of runs) applyRunToChat(run);
      for (const item of items) {
        if (item.titleOnly) {
          // Title-watch refs: expiry or disappearance just ends the window —
          // the applied terminal result stays authoritative, no error paint.
          if (!seen.has(item.id) || (item.keepUntil !== undefined && Date.now() > item.keepUntil)) {
            ownedRunsRef.current.delete(item.id);
          }
          continue;
        }
        const isOwnedExtra = !pendingIds.has(item.id);
        const missingSince = item.missingSince;
        if (seen.has(item.id)) {
          missingRunIdsRef.current.delete(item.id);
          if (missingSince !== undefined) setMissingSince(item, undefined);
          continue;
        }
        missingRunIdsRef.current.add(item.id);
        if (missingSince === undefined) setMissingSince(item, Date.now());
        else if (Date.now() - missingSince > SERVER_RUN_MISSING_TIMEOUT_MS) {
          removePendingServerRun(item.id);
          ownedRunsRef.current.delete(item.id);
          missingRunIdsRef.current.delete(item.id);
          activeRunIdsRef.current.delete(item.id);
          runApplyQueueRef.current.delete(item.id);
          closeRunEvents(item.id);
          setPendingRegenerateMessageId((current) => (current === item.botMessageId ? null : current));
          replaceBotMessage(item.botMessageId, {
            prompt: isOwnedExtra ? '后台任务记录已丢失，请重新发送。' : '后台任务未成功提交，请重新发送。',
            images: [],
            text: '',
            code: '',
            extra: 'error',
            serverRunId: undefined,
          }, item.sessionId);
          setStatusForSession(item.sessionId, isOwnedExtra ? '后台任务记录已丢失' : '后台任务未成功提交', 'err');
          if (!hasTrackedPendingRunForSession(activeRunIdsRef.current, ownedRunsRef.current, item.sessionId)) {
            setLoading(false, item.sessionId);
          }
          continue;
        }
        setLoading(true, item.sessionId);
        setStatusForSession(item.sessionId, '后台任务提交中...', 'warn');
      }

      if (readPendingServerRuns().length > 0 || ownedRunsRef.current.size > 0) {
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
  ]);

  useEffect(() => {
    pollPendingRunsRef.current = pollPendingRuns;
  }, [pollPendingRuns]);

  useEffect(() => {
    const initialPollId = setTimeout(() => { void pollPendingRuns(); }, 0);
    return () => {
      clearTimeout(initialPollId);
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      if (runApplyFlushTimerRef.current) {
        clearTimeout(runApplyFlushTimerRef.current);
        runApplyFlushTimerRef.current = null;
        // Drain — queued snapshots would otherwise sit until some unrelated
        // dispatch schedules the next flush.
        flushQueuedRuns();
      }
      closeAllRunEvents();
    };
  }, [closeAllRunEvents, flushQueuedRuns, pollPendingRuns]);

  useEffect(() => () => {
    preSubmitControllerRef.current?.abort();
    preSubmitControllerRef.current = null;
  }, []);

  const submitServerRun = useCallback(async (payload: ServerRunCreatePayload, signal?: AbortSignal) => {
    const pendingRef: PendingServerRunRef = {
      id: payload.id,
      accessToken: payload.accessToken,
      sessionId: payload.sessionId,
      userMessageId: payload.userMessageId,
      botMessageId: payload.botMessageId,
      createdAt: Date.now(),
    };
    addPendingServerRun(pendingRef);
    ownedRunsRef.current.set(payload.id, pendingRef);
    activeRunIdsRef.current.add(payload.id);
    setLoading(true, payload.sessionId);
    setStatusForSession(payload.sessionId, '后台任务已提交...', 'warn');

    const body = JSON.stringify({
      ...payload,
      config: { ...payload.config, serverAccessToken: '' },
    });
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (payload.config.serverAccessToken) headers['x-server-access-token'] = payload.config.serverAccessToken;
    // A stalled socket must not hang the submit forever — cap it, and combine
    // with the caller's cancel signal when AbortSignal.any is available.
    const timeoutSignal = AbortSignal.timeout(SERVER_RUN_SUBMIT_TIMEOUT_MS);
    let submitSignal = timeoutSignal;
    if (signal) {
      if (typeof AbortSignal.any === 'function') {
        submitSignal = AbortSignal.any([signal, timeoutSignal]);
      } else {
        // Fallback for engines without AbortSignal.any: forward either
        // source's abort — dropping the timeout would let a stalled socket
        // hang the submit (and inFlightRef) forever.
        const combined = new AbortController();
        const forward = () => combined.abort();
        signal.addEventListener('abort', forward, { once: true });
        timeoutSignal.addEventListener('abort', forward, { once: true });
        if (signal.aborted || timeoutSignal.aborted) combined.abort();
        submitSignal = combined.signal;
      }
    }
    const response = await fetch('/api/runs', {
      method: 'POST',
      headers,
      body,
      keepalive: body.length < 60_000,
      signal: submitSignal,
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
    if (!cleanPrompt || isLoading || inFlightRef.current) return false;
    inFlightRef.current = true;
    cancelRequestedRef.current = false;

    const sessionId = activeSessionId;
    // Busy immediately — reference-image conversion below can take seconds,
    // and the window before submitServerRun otherwise shows no spinner and
    // no cancel affordance.
    setLoading(true, sessionId);
    const existingUserMessageId = runOptions.existingUserMessageId;
    const targetBotMessageId = runOptions.targetBotMessageId;
    const currentSessionMessages = sessionsRef.current.find((session) => session.id === sessionId)?.messages ?? [];
    const sessionMessages = runOptions.historyMessages ?? currentSessionMessages;
    // For restore-on-failure: the regenerate path clears the target bubble
    // before submit — if the submit never starts, put the old answer back.
    const previousBotMessage = targetBotMessageId
      ? currentSessionMessages.find((message) => message.id === targetBotMessageId && message.role === 'bot')
      : undefined;
    let submittedBotMessageId = targetBotMessageId || '';
    let userMessageCreated = false;
    // Set right before submitServerRun: an abort/failure before this point
    // means the run provably never reached the server — safe to restore the
    // previous regenerate answer instead of painting an error stub.
    let submitStarted = false;
    let normalizedRequest: ChatTurnSnapshot | undefined;

    const runId = createServerRunId();
    const accessToken = createServerRunAccessToken();
    const requestController = new AbortController();
    preSubmitControllerRef.current = requestController;

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
          updateUserMessage(existingUserMessageId, cleanPrompt, sessionId, undefined, { markEdited: true });
          truncateChatAfterMessage(existingUserMessageId, sessionId);
          addTextBotMsg(reply, '', sessionId);
        } else {
          addUserMsg(cleanPrompt, sessionId);
          addTextBotMsg(reply, '', sessionId);
        }
        setDebugRawForSession(sessionId, reply);
        setStatusForSession(sessionId, '回复完成', 'ok');
        setLoading(false, sessionId);
        return true;
      }

      const isSnapshotRun = !!runOptions.requestSnapshot;
      // Sort by grid index — selectedIndices is a Set in *toggle* order, so
      // deselect+reselect would silently reorder the reference list (and
      // rebind image[0]-paired semantics like masks) away from visual order.
      const validSelectedIndices = [...selectedIndices]
        .filter((index) => index >= 0 && index < images.length)
        .sort((a, b) => a - b);
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
      normalizedRequest = {
        ...requestSnapshot,
        size: parseSize(requestSnapshot.size) ? requestSnapshot.size : resolvedSize,
        streaming: shouldStream,
      };

      let userMessageId = existingUserMessageId || '';
      let botMessageId = targetBotMessageId || '';

      if (targetBotMessageId) {
        // A regenerate needs the real user message to attach the run to —
        // minting a fresh id here would orphan the pair on the server. The
        // fallback must search the FULL session messages: historyMessages
        // for a regenerate excludes the target's own user turn, so looking
        // there would silently pick the previous-previous user message.
        const priorUser = [...currentSessionMessages].reverse().find((message) => message.role === 'user' && message.prompt.trim());
        const resolvedUserMessageId = runOptions.runUserMessageId || priorUser?.id;
        if (!resolvedUserMessageId) {
          throw new Error('找不到可重新生成的原始消息，请重新发送。');
        }
        userMessageId = resolvedUserMessageId;
        setPendingRegenerateMessageId(targetBotMessageId);
        replaceBotMessage(targetBotMessageId, {
          prompt: '',
          images: [],
          text: '',
          // Clear the old turn's thinking too — merged updates keep it
          // otherwise and the regenerate would show stale reasoning.
          thinking: '',
          thinkingDone: false,
          code: '',
          extra: '',
          serverRunId: runId,
        }, sessionId);
      } else if (existingUserMessageId) {
        updateUserMessage(existingUserMessageId, cleanPrompt, sessionId, normalizedRequest, { markEdited: true });
        truncateChatAfterMessage(existingUserMessageId, sessionId);
        userMessageId = existingUserMessageId;
        botMessageId = addBotMsg([], '', '', sessionId, runId);
        submittedBotMessageId = botMessageId;
      } else {
        userMessageId = addUserMsg(cleanPrompt, sessionId, normalizedRequest, runId);
        userMessageCreated = true;
        botMessageId = addBotMsg([], '', '', sessionId, runId);
        submittedBotMessageId = botMessageId;
      }

      if (!isSnapshotRun && options.clearOnSubmit) clearImages();

      submitStarted = true;
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
        lang: currentLang(),
      }, requestController.signal);
      if (cancelRequestedRef.current) {
        // The cancel landed while the POST was in flight and could not abort
        // it — the run is live server-side now, so issue the DELETE here.
        void cancelServerRun({
          id: runId,
          accessToken,
          sessionId,
          userMessageId,
          botMessageId,
          createdAt: Date.now(),
        });
      }
      return true;
    } catch (error) {
      const aborted = cancelRequestedRef.current || (error as Error).message === USER_ABORT_SENTINEL;
      // A signal-driven abort/timeout (AbortError/TimeoutError DOMException)
      // leaves the POST possibly delivered; a TypeError only counts when it
      // looks like a fetch network failure — an unrelated code bug must not
      // keep the pending record alive for the 30s reconcile window.
      // 保留 pending 记录交给轮询对账（未落库的 run 由 missingSince 超时兜底清理）。
      const submitAborted = (error as Error).name === 'AbortError' || (error as Error).name === 'TimeoutError';
      const networkFailure = error instanceof TypeError
        && /fetch|network|load failed|failed to fetch/i.test((error as Error).message || '');
      const keepPending = aborted || submitAborted || networkFailure;
      const message = aborted
        ? '已取消'
        : submitAborted
          ? '后台任务提交超时，正在等待后台结果'
          : (error as Error).message || '后台任务提交失败';
      setPendingRegenerateMessageId((current) => (current === targetBotMessageId ? null : current));
      if (keepPending) {
        if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
        pollTimerRef.current = setTimeout(() => { void pollPendingRunsRef.current(); }, 1500);
      } else {
        removePendingServerRun(runId);
        ownedRunsRef.current.delete(runId);
        activeRunIdsRef.current.delete(runId);
      }
      if (submittedBotMessageId) {
        // !submitStarted => the run never reached the server (abort during
        // reference-image conversion, validation throw): the cleared
        // regenerate bubble gets its old answer back, even when the abort
        // was user-initiated — nothing exists to reconcile.
        const restorePrevious = previousBotMessage
          && submittedBotMessageId === targetBotMessageId
          && !submitStarted;
        replaceBotMessage(submittedBotMessageId, restorePrevious ? {
          // The rerun never reached the server — put the old answer back
          // instead of overwriting it with an error stub.
          prompt: previousBotMessage.prompt,
          images: previousBotMessage.images,
          text: previousBotMessage.text,
          code: previousBotMessage.code,
          extra: previousBotMessage.extra,
          thinking: previousBotMessage.thinking,
          thinkingDone: previousBotMessage.thinkingDone,
          serverRunId: undefined,
        } : {
          prompt: message,
          images: [],
          text: '',
          code: '',
          extra: 'error',
          serverRunId: keepPending ? runId : undefined,
        }, sessionId);
      } else if (!aborted) {
        if (!userMessageCreated && !existingUserMessageId && !targetBotMessageId) {
          addUserMsg(cleanPrompt, sessionId);
        } else if (existingUserMessageId && normalizedRequest) {
          // The edit failed before it was committed — apply it now so the
          // error bubble lands next to the edited turn, not at the tail.
          updateUserMessage(existingUserMessageId, cleanPrompt, sessionId, normalizedRequest, { markEdited: true });
          truncateChatAfterMessage(existingUserMessageId, sessionId);
        }
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
      setStatusForSession(sessionId, message, aborted || keepPending ? 'warn' : 'err');
      // keepPending only means the run MIGHT still land — if nothing is
      // actually tracked (e.g. a pre-submit abort before registration), the
      // loading flag must clear here or it sticks.
      if (!hasTrackedPendingRunForSession(activeRunIdsRef.current, ownedRunsRef.current, sessionId)) {
        setLoading(false, sessionId);
      }
      return false;
    } finally {
      inFlightRef.current = false;
      if (preSubmitControllerRef.current === requestController) {
        preSubmitControllerRef.current = null;
      }
    }
  }, [
    activeSessionId,
    addBotMsg,
    addTextBotMsg,
    addUserMsg,
    cancelServerRun,
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
    const preSubmit = preSubmitControllerRef.current;
    if (preSubmit) {
      cancelRequestedRef.current = true;
      preSubmitControllerRef.current = null;
      preSubmit.abort();
    }
    const sessionId = activeSessionId;
    const pending = readPendingServerRuns().filter((item) => (
      item.sessionId === sessionId && activeRunIdsRef.current.has(item.id)
    ));
    // Owned runs survive a clobbered shared pending list — a cancel must
    // still reach them.
    const pendingIds = new Set(pending.map((item) => item.id));
    for (const owned of ownedRunsRef.current.values()) {
      if (owned.sessionId === sessionId && activeRunIdsRef.current.has(owned.id) && !pendingIds.has(owned.id)) {
        pending.push(owned);
      }
    }
    if (pending.length === 0) return;
    setStatusForSession(sessionId, '正在取消后台任务...', 'warn');
    void Promise.allSettled(pending.map((item) => cancelServerRun(item)))
      .then((results) => {
        const canceled = results.filter((result) => result.status === 'fulfilled' && result.value).length;
        if (canceled === pending.length) {
          setStatusForSession(sessionId, '已取消', 'warn');
        } else if (canceled > 0) {
          setStatusForSession(sessionId, `已取消 ${canceled} 个任务，${pending.length - canceled} 个任务仍在运行`, 'warn');
        } else {
          setStatusForSession(sessionId, '取消失败，后台任务仍在运行', 'err');
        }
        void pollPendingRuns();
      });
  }, [activeSessionId, cancelServerRun, pollPendingRuns, setStatusForSession]);

  // Synchronous accept/reject so the composer can keep the draft when the
  // run never started (busy/racing) instead of clearing it into the void.
  const handleSend = useCallback((prompt: string): boolean => {
    if (!prompt.trim() || isLoading || inFlightRef.current) return false;
    void runPrompt(prompt);
    return true;
  }, [isLoading, runPrompt]);

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
      runUserMessageId: userMessage.id,
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
