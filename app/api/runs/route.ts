import { NextRequest, NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'crypto';
import type { ServerRunCreatePayload } from '@/lib/server-runs';
import {
  toPublicServerRun,
  type ServerRunRecord,
} from '@/lib/server-runs';
import { createServerRun, readServerRuns } from '@/lib/server-run-store';
import { ensureServerRunStarted, registerServerRunRuntimeSecrets } from '@/lib/server-runner';
import { assertServerDefaultAccess, serverDefaultAccessAuthorized } from '@/lib/server-access';
import {
  getRandomModelGateMessage,
  MODEL_GATE_UNLOCKED_COOKIE,
  verifyModelGateUnlockToken,
} from '@/lib/model-gate';
import { isModelGateEnabled } from '@/lib/model-gate-env';
import { getChatAssetSession } from '@/lib/chat-asset-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RUN_CREATE_MAX_BODY_BYTES = 32 * 1024 * 1024;

interface ServerRunQueryPayload {
  items: Array<{ id: string; accessToken: string }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isRunPayload(value: unknown): value is ServerRunCreatePayload {
  if (!isRecord(value)) return false;
  const payload = value as Partial<ServerRunCreatePayload>;
  const validId = (item: unknown) => typeof item === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(item);
  const config = isRecord(payload.config) ? payload.config : null;
  const options = isRecord(payload.options) ? payload.options : null;
  const runRequest = isRecord(payload.request) ? payload.request : null;
  const credentialFields = ['apiKey', 'baseUrl', 'chatApiKey', 'chatBaseUrl', 'claudeApiKey', 'claudeBaseUrl', 'serverAccessToken'];
  return validId(payload.id)
    && typeof payload.accessToken === 'string'
    && payload.accessToken.length >= 16
    && payload.accessToken.length <= 512
    && validId(payload.sessionId)
    && validId(payload.userMessageId)
    && validId(payload.botMessageId)
    && typeof payload.prompt === 'string'
    && !!config
    && credentialFields.every((field) => typeof config[field] === 'string')
    && !!options
    && typeof options.timeout === 'number'
    && Number.isFinite(options.timeout)
    && !!runRequest
    && (runRequest.mode === 'chat' || runRequest.mode === 'images' || runRequest.mode === 'edits')
    && Array.isArray(runRequest.referenceImages)
    && Array.isArray(payload.historyMessages)
    && payload.historyMessages.every(isRecord);
}

function isRunQueryPayload(value: unknown): value is ServerRunQueryPayload {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Partial<ServerRunQueryPayload>;
  return Array.isArray(payload.items)
    && payload.items.every((item) => (
      !!item
      && typeof item === 'object'
      && typeof item.id === 'string'
      && typeof item.accessToken === 'string'
    ));
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
    serverAccessToken: '',
    baseUrl: '',
    chatApiKey: '',
    chatBaseUrl: '',
    claudeApiKey: '',
    claudeBaseUrl: '',
  };
}

function usesServerDefaultForPrimaryRequest(payload: ServerRunCreatePayload) {
  if (payload.request.mode !== 'chat') return !payload.config.apiKey;
  if (payload.request.chatApiFormat === 'claude') return !payload.config.claudeApiKey;
  return !(payload.config.chatApiKey || payload.config.apiKey);
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
    if (isRunQueryPayload(body)) {
      const items = body.items
        .filter((item) => item.id.trim() && item.accessToken.trim())
        .slice(0, 50);
      if (items.length === 0) return NextResponse.json({ ok: true, runs: [] });

      const tokenById = new Map(items.map((item) => [item.id, item.accessToken]));
      const runs = await readServerRuns(items.map((item) => item.id));
      const authorizedRuns = runs.filter((run) => isAuthorizedRun(run, tokenById.get(run.id) || ''));
      for (const run of authorizedRuns) {
        if (run.status === 'queued' || run.status === 'running') {
          void ensureServerRunStarted(run.id);
        }
      }
      return NextResponse.json({ ok: true, runs: authorizedRuns.map(toPublicServerRun) });
    }

    return NextResponse.json({ error: '任务参数不完整' }, { status: 400 });
  }

  const gateResponse = await validateModelGate(request);
  if (gateResponse) return gateResponse;

  const serverAccessToken = request.headers.get('x-server-access-token') || body.config.serverAccessToken;

  if (usesServerDefaultForPrimaryRequest(body)) {
    try {
      assertServerDefaultAccess(serverAccessToken);
    } catch (error) {
      return NextResponse.json({ error: (error as Error).message }, { status: 401 });
    }
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
    accessTokenHash: hashAccessToken(body.id, body.accessToken),
    status: 'queued',
    createdAt: now,
    updatedAt: now,
  };

  const assetSession = await getChatAssetSession(request);
  const created = await createServerRun(record);
  if (!created.created) {
    if (!isAuthorizedRun(created.run, body.accessToken)) {
      return NextResponse.json({ error: '任务 ID 已存在' }, { status: 409 });
    }
    if (created.run.status === 'queued' || created.run.status === 'running') void ensureServerRunStarted(created.run.id);
    return NextResponse.json({ ok: true, run: toPublicServerRun(created.run) });
  }

  registerServerRunRuntimeSecrets(record.id, {
    credentials: pickRuntimeCredentials(body.config),
    assetSessionId: assetSession.id,
    allowServerDefaults: serverDefaultAccessAuthorized(serverAccessToken),
  });
  void ensureServerRunStarted(record.id);
  return NextResponse.json({ ok: true, run: toPublicServerRun(record) });
}

export async function GET() {
  return NextResponse.json({ error: '请使用 POST 查询后台任务状态' }, { status: 405 });
}
