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
import { getChatAssetSession, setChatAssetSession } from '@/lib/chat-asset-session';
import { CHAT_ASSET_SESSION_COOKIE } from '@/lib/constants';
import { checkRateLimit, clientIp, isRateLimited } from '@/lib/rate-limit';
import { readLimitedText } from '@/lib/limited-body';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RUN_CREATE_MAX_BODY_BYTES = 32 * 1024 * 1024;
const RUN_CREATE_RATE_LIMIT = 60;
const RUN_QUERY_RATE_LIMIT = 240;
const RUN_CREATE_RATE_WINDOW_MS = 60_000;
const RUN_TIMEOUT_MAX_SEC = 3600;
// Shares the `asset-session:` bucket with /api/chat-assets: this route now
// writes generated images into the asset store, so minting fresh anonymous
// sessions must be capped here too (60/hr/IP) or cookie-rotation could use it
// to dodge the upload endpoint's limit.
const ASSET_SESSION_MINT_LIMIT = 60;
const ASSET_SESSION_MINT_WINDOW_MS = 60 * 60 * 1000;

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
    && options.timeout <= RUN_TIMEOUT_MAX_SEC
    && !!runRequest
    && (runRequest.mode === 'chat' || runRequest.mode === 'images' || runRequest.mode === 'edits')
    && typeof runRequest.n === 'number'
    && Number.isFinite(runRequest.n)
    && Array.isArray(runRequest.referenceImages)
    // Element shapes matter: buildEditsForm dereferences reference.image and
    // would TypeError on [null] or {image: null}.
    && runRequest.referenceImages.every((reference) => (
      isRecord(reference)
      && isRecord(reference.image)
      && (typeof reference.image.dataUrl === 'string' || typeof reference.image.url === 'string')
      && (reference.mask === undefined
        || (isRecord(reference.mask)
          && (typeof reference.mask.dataUrl === 'string' || typeof reference.mask.url === 'string')))
    ))
    // Request fields consumed downstream must be typed or the executor
    // crashes on e.g. systemPrompt.trim() — and NaN contextLimit bypasses
    // the history-turn clamp in buildChatMessages.
    && (runRequest.systemPrompt === undefined || typeof runRequest.systemPrompt === 'string')
    && (runRequest.contextLimit === undefined
      || (typeof runRequest.contextLimit === 'number' && Number.isFinite(runRequest.contextLimit)))
    && (runRequest.chatApiFormat === undefined
      || runRequest.chatApiFormat === 'openai'
      || runRequest.chatApiFormat === 'claude')
    && (runRequest.chatModel === undefined || typeof runRequest.chatModel === 'string')
    && (runRequest.chatEffort === undefined || typeof runRequest.chatEffort === 'string')
    && (runRequest.streaming === undefined || typeof runRequest.streaming === 'boolean')
    // Bytes, not UTF-16 units: the cap bounds the upstream payload, and CJK
    // text is ~3 bytes per char on the wire.
    && Buffer.byteLength(payload.prompt, 'utf8') <= 512 * 1024
    && Array.isArray(payload.historyMessages)
    && payload.historyMessages.every((message) => (
      isRecord(message)
      // buildChatMessages pushes prompt/text verbatim as message content and
      // generateRunTitle calls prompt.trim() — non-strings crash or corrupt.
      && (message.role === undefined || message.role === 'user' || message.role === 'bot')
      && (message.prompt === undefined || typeof message.prompt === 'string')
      && (message.text === undefined || typeof message.text === 'string')
      && (message.extra === undefined || typeof message.extra === 'string')
    ));
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

// Explicit allowlist of non-secret fields the stored record needs (model
// names/format for execution and title generation). Credentials and base URLs
// live in runtimeSecrets so the on-disk record never carries them.
function sanitizeConfig(config: ServerRunCreatePayload['config']): ServerRunCreatePayload['config'] {
  return {
    mode: config.mode,
    model: config.model,
    chatModel: config.chatModel,
    titleModel: config.titleModel,
    chatApiFormat: config.chatApiFormat,
    chatEffort: config.chatEffort,
    openAIChatModels: config.openAIChatModels,
    customImageModels: config.customImageModels,
    customChatModels: config.customChatModels,
    claudeModel: config.claudeModel,
    claudeTitleModel: config.claudeTitleModel,
    claudeChatModels: config.claudeChatModels,
    customClaudeModels: config.customClaudeModels,
    size: config.size,
    n: config.n,
    quality: config.quality,
    format: config.format,
    background: config.background,
    moderation: config.moderation,
    compression: config.compression,
    systemPrompt: config.systemPrompt,
    // Secret/server fields — intentionally blanked in the stored record.
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
  // Mirror the executor's format resolution and credential fallback
  // (server-runner chatTarget: claudeApiKey || chatApiKey || apiKey) — a
  // narrower check here 401s requests whose user key would have worked.
  const format = payload.request.chatApiFormat || payload.config.chatApiFormat;
  if (format === 'claude') {
    return !(payload.config.claudeApiKey || payload.config.chatApiKey || payload.config.apiKey);
  }
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
  // Cheap pre-check so request floods are rejected before the body is read.
  if (isRateLimited(`runs:${clientIp(request)}`, RUN_CREATE_RATE_LIMIT, RUN_CREATE_RATE_WINDOW_MS)) {
    return NextResponse.json({ error: '任务创建过于频繁，请稍后再试' }, { status: 429 });
  }

  const limited = await readLimitedText(request, RUN_CREATE_MAX_BODY_BYTES);
  if ('tooLarge' in limited) {
    // Malformed/oversized bodies still consume create budget — otherwise a
    // flood of unparseable garbage bypasses the limiter entirely.
    checkRateLimit(`runs:${clientIp(request)}`, RUN_CREATE_RATE_LIMIT, RUN_CREATE_RATE_WINDOW_MS);
    return NextResponse.json({ error: '任务数据过大' }, { status: 413 });
  }
  const rawBody = limited.text;

  let body: unknown;
  try {
    body = JSON.parse(rawBody || '{}');
  } catch {
    checkRateLimit(`runs:${clientIp(request)}`, RUN_CREATE_RATE_LIMIT, RUN_CREATE_RATE_WINDOW_MS);
    return NextResponse.json({ error: '任务数据格式错误' }, { status: 400 });
  }

  if (!isRunPayload(body)) {
    if (isRunQueryPayload(body)) {
      // The create-path checkRateLimit below is skipped on this branch, so the
      // query path counts against its own (looser) bucket.
      if (!checkRateLimit(`runs-query:${clientIp(request)}`, RUN_QUERY_RATE_LIMIT, RUN_CREATE_RATE_WINDOW_MS)) {
        return NextResponse.json({ error: '任务查询过于频繁，请稍后再试' }, { status: 429 });
      }
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

    // Malformed create payloads still consume the create budget — otherwise
    // a flood of invalid bodies gets fully parsed and rejected for free.
    if (!checkRateLimit(`runs:${clientIp(request)}`, RUN_CREATE_RATE_LIMIT, RUN_CREATE_RATE_WINDOW_MS)) {
      return NextResponse.json({ error: '任务创建过于频繁，请稍后再试' }, { status: 429 });
    }
    return NextResponse.json({ error: '任务参数不完整' }, { status: 400 });
  }

  if (!checkRateLimit(`runs:${clientIp(request)}`, RUN_CREATE_RATE_LIMIT, RUN_CREATE_RATE_WINDOW_MS)) {
    return NextResponse.json({ error: '任务创建过于频繁，请稍后再试' }, { status: 429 });
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
    lang: body.lang === 'en' || body.lang === 'zh' ? body.lang : undefined,
    accessTokenHash: hashAccessToken(body.id, body.accessToken),
    status: 'queued',
    createdAt: now,
    updatedAt: now,
  };

  const assetSession = await getChatAssetSession(request);
  // Same mint check as /api/chat-assets POST: an absent/invalid cookie just
  // produced a fresh anonymous session — and a completed run can now write
  // images into it.
  const presentedAssetCookie = request.cookies.get(CHAT_ASSET_SESSION_COOKIE)?.value || '';
  if (presentedAssetCookie !== assetSession.cookieValue
    && !checkRateLimit(`asset-session:${clientIp(request)}`, ASSET_SESSION_MINT_LIMIT, ASSET_SESSION_MINT_WINDOW_MS)) {
    return NextResponse.json({ error: 'Too many sessions' }, { status: 429 });
  }
  const created = await createServerRun(record);
  if (!created.created) {
    if (!isAuthorizedRun(created.run, body.accessToken)) {
      return NextResponse.json({ error: '任务 ID 已存在' }, { status: 409 });
    }
    if (created.run.status === 'queued' || created.run.status === 'running') {
      // A duplicate POST after a server restart must re-register the
      // memory-only runtime secrets before the run can resume — and must stay
      // synchronous ahead of ensureServerRunStarted (see server-runner).
      registerServerRunRuntimeSecrets(created.run.id, {
        credentials: pickRuntimeCredentials(body.config),
        assetSessionId: assetSession.id,
        allowServerDefaults: serverDefaultAccessAuthorized(serverAccessToken),
      });
      void ensureServerRunStarted(created.run.id);
    }
    const response = NextResponse.json({ ok: true, run: toPublicServerRun(created.run) });
    setChatAssetSession(response, assetSession, request);
    return response;
  }

  // Ordering assumption: secrets must be registered synchronously before
  // ensureServerRunStarted — the executor checks runtimeSecrets.has(id) only
  // after `await readServerRun(id)` resolves, so this same-tick registration
  // is always observed.
  registerServerRunRuntimeSecrets(record.id, {
    credentials: pickRuntimeCredentials(body.config),
    assetSessionId: assetSession.id,
    allowServerDefaults: serverDefaultAccessAuthorized(serverAccessToken),
  });
  void ensureServerRunStarted(record.id);
  const response = NextResponse.json({ ok: true, run: toPublicServerRun(record) });
  setChatAssetSession(response, assetSession, request);
  return response;
}

export async function GET() {
  return NextResponse.json({ error: '请使用 POST 查询后台任务状态' }, { status: 405 });
}
