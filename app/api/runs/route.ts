import { NextRequest, NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'crypto';
import type { ServerRunCreatePayload } from '@/lib/server-runs';
import {
  toPublicServerRun,
  type ServerRunRecord,
} from '@/lib/server-runs';
import { readServerRuns, upsertServerRun } from '@/lib/server-run-store';
import { ensureServerRunStarted, registerServerRunRuntimeSecrets } from '@/lib/server-runner';
import {
  getRandomModelGateMessage,
  MODEL_GATE_UNLOCKED_COOKIE,
  verifyModelGateUnlockToken,
} from '@/lib/model-gate';
import { isModelGateEnabled } from '@/lib/model-gate-env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RUN_CREATE_MAX_BODY_BYTES = 32 * 1024 * 1024;

function isRunPayload(value: unknown): value is ServerRunCreatePayload {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Partial<ServerRunCreatePayload>;
  return !!payload.id
    && !!payload.accessToken
    && !!payload.sessionId
    && !!payload.userMessageId
    && !!payload.botMessageId
    && typeof payload.prompt === 'string'
    && !!payload.config
    && !!payload.options
    && !!payload.request
    && Array.isArray(payload.historyMessages);
}

function hashAccessToken(runId: string, token: string) {
  return createHash('sha256').update(`${runId}\0${token}`).digest('hex');
}

function safeEqual(value: string, expected: string) {
  const valueBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);
  return valueBuffer.length === expectedBuffer.length && timingSafeEqual(valueBuffer, expectedBuffer);
}

function isAuthorizedRun(run: ServerRunRecord, token: string) {
  return !!token && safeEqual(hashAccessToken(run.id, token), run.accessTokenHash);
}

function sanitizeConfig(config: ServerRunCreatePayload['config']): ServerRunCreatePayload['config'] {
  return {
    ...config,
    apiKey: '',
    baseUrl: '',
    chatApiKey: '',
    chatBaseUrl: '',
    claudeApiKey: '',
    claudeBaseUrl: '',
  };
}

function pickRuntimeCredentials(config: ServerRunCreatePayload['config']) {
  return {
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    chatApiKey: config.chatApiKey,
    chatBaseUrl: config.chatBaseUrl,
    claudeApiKey: config.claudeApiKey,
    claudeBaseUrl: config.claudeBaseUrl,
  };
}

async function validateModelGate(request: NextRequest) {
  const modelGateUnlocked = await verifyModelGateUnlockToken(request.cookies.get(MODEL_GATE_UNLOCKED_COOKIE)?.value);
  if (isModelGateEnabled() && !modelGateUnlocked) {
    return NextResponse.json(
      { error: { code: 'model_gate_locked', message: getRandomModelGateMessage() } },
      { status: 418 },
    );
  }
  return null;
}

export async function POST(request: NextRequest) {
  const gateResponse = await validateModelGate(request);
  if (gateResponse) return gateResponse;

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).length > RUN_CREATE_MAX_BODY_BYTES) {
    return NextResponse.json({ error: '任务数据过大' }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody || '{}');
  } catch {
    return NextResponse.json({ error: '任务数据格式错误' }, { status: 400 });
  }

  if (!isRunPayload(body)) {
    return NextResponse.json({ error: '任务参数不完整' }, { status: 400 });
  }

  const now = Date.now();
  const record: ServerRunRecord = {
    id: body.id,
    sessionId: body.sessionId,
    userMessageId: body.userMessageId,
    botMessageId: body.botMessageId,
    prompt: body.prompt,
    config: sanitizeConfig(body.config),
    options: body.options,
    request: body.request,
    historyMessages: body.historyMessages,
    appOrigin: request.headers.get('origin') || body.appOrigin || '',
    accessTokenHash: hashAccessToken(body.id, body.accessToken),
    status: 'queued',
    createdAt: now,
    updatedAt: now,
  };

  registerServerRunRuntimeSecrets(record.id, {
    credentials: pickRuntimeCredentials(body.config),
    assetCookie: request.headers.get('cookie') || '',
  });
  await upsertServerRun(record);
  void ensureServerRunStarted(record.id);
  return NextResponse.json({ ok: true, run: toPublicServerRun(record) });
}

export async function GET(request: NextRequest) {
  const ids = (request.nextUrl.searchParams.get('ids') || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, 50);
  const tokens = (request.nextUrl.searchParams.get('tokens') || '')
    .split(',')
    .map((token) => token.trim())
    .slice(0, ids.length);
  if (ids.length === 0) return NextResponse.json({ ok: true, runs: [] });

  const tokenById = new Map(ids.map((id, index) => [id, tokens[index] || '']));
  const runs = await readServerRuns(ids);
  const authorizedRuns = runs.filter((run) => isAuthorizedRun(run, tokenById.get(run.id) || ''));
  for (const run of authorizedRuns) {
    if (run.status === 'queued' || run.status === 'running') {
      void ensureServerRunStarted(run.id);
    }
  }
  return NextResponse.json({ ok: true, runs: authorizedRuns.map(toPublicServerRun) });
}
