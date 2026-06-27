import { createHash, timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { subscribeServerRunUpdates } from '@/lib/server-run-events';
import { toPublicServerRun, type ServerRunRecord, type ServerRunStatus } from '@/lib/server-runs';
import { readServerRun } from '@/lib/server-run-store';
import { ensureServerRunStarted } from '@/lib/server-runner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RUN_EVENT_POLL_INTERVAL_MS = 1000;
const RUN_EVENT_KEEPALIVE_INTERVAL_MS = 25_000;

interface RouteParams {
  params: Promise<{ runId: string }>;
}

function hashAccessToken(runId: string, token: string) {
  return createHash('sha256').update(`${runId}\0${token}`).digest('hex');
}

function safeEqual(value: string, expected: string) {
  const valueBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);
  return valueBuffer.length === expectedBuffer.length && timingSafeEqual(valueBuffer, expectedBuffer);
}

function requestAccessToken(request: NextRequest) {
  return request.headers.get('x-run-access-token') || '';
}

function assertAuthorized(request: NextRequest, run: ServerRunRecord) {
  const token = requestAccessToken(request);
  return !!token && safeEqual(hashAccessToken(run.id, token), run.accessTokenHash);
}

function isFinishedStatus(status: ServerRunStatus) {
  return status === 'completed' || status === 'failed' || status === 'canceled';
}

function serializeRun(run: ServerRunRecord) {
  return JSON.stringify(toPublicServerRun(run));
}

function encodeRunEvent(payload: string) {
  return `event: run\ndata: ${payload}\n\n`;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { runId } = await params;
  const run = await readServerRun(runId);
  if (!run) return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  if (!assertAuthorized(request, run)) return NextResponse.json({ error: '无权访问任务' }, { status: 404 });

  if (run.status === 'queued' || run.status === 'running') {
    void ensureServerRunStarted(run.id);
  }

  let closeStream = () => {};
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      let unsubscribe = () => {};
      let keepaliveId: ReturnType<typeof setInterval> | null = null;
      let pollId: ReturnType<typeof setInterval> | null = null;
      let polling = false;
      let lastPayload = '';

      const close = () => {
        if (closed) return;
        closed = true;
        if (keepaliveId) clearInterval(keepaliveId);
        if (pollId) clearInterval(pollId);
        unsubscribe();
        request.signal.removeEventListener('abort', close);
        try { controller.close(); } catch { /* already closed */ }
      };

      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          close();
        }
      };

      const sendRun = (nextRun: ServerRunRecord) => {
        const payload = serializeRun(nextRun);
        if (payload !== lastPayload) {
          lastPayload = payload;
          send(encodeRunEvent(payload));
        }
        if (isFinishedStatus(nextRun.status)) close();
      };

      const pollRun = async () => {
        if (closed || polling) return;
        polling = true;
        try {
          const nextRun = await readServerRun(runId);
          if (nextRun) sendRun(nextRun);
          else close();
        } catch {
          // Keep the SSE connection alive; the next poll or client fallback can recover.
        } finally {
          polling = false;
        }
      };

      closeStream = close;
      request.signal.addEventListener('abort', close, { once: true });
      keepaliveId = setInterval(() => send(': keepalive\n\n'), RUN_EVENT_KEEPALIVE_INTERVAL_MS);
      pollId = setInterval(() => { void pollRun(); }, RUN_EVENT_POLL_INTERVAL_MS);
      send('retry: 1500\n\n');

      unsubscribe = subscribeServerRunUpdates(runId, sendRun);
      await pollRun();
    },
    cancel() {
      closeStream();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
