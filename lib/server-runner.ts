import type { AppConfig, AppOptions, ImageHit } from '@/types';
import { getChatProviderConfig, type ChatApiFormat } from '@/lib/chat-config';
import type { ChatReferenceImage, ChatTurnSnapshot } from '@/contexts/ChatContext';
import type { RequestBody } from '@/lib/request-helpers';
import type { ServerRunRecord, ServerRunResult } from '@/lib/server-runs';
import type { ChatContentParts } from '@/lib/chat-thinking';
import { fetchRemoteImageBytes, isValidChatAssetId, readChatAsset } from '@/lib/chat-assets';
import { fetchPinned } from '@/lib/pinned-fetch';
import { extractImage } from '@/lib/image-extract';
import {
  buildChatMessages,
  extractChatResponseText,
  extractChatResponseParts,
  normalizeGeneratedTitle,
  parseResponseBody,
} from '@/lib/api-parsers';
import {
  REQUEST_MAX_ATTEMPTS,
  REQUEST_RETRY_DELAYS_MS,
  RequestAttemptsExhaustedError,
  RequestStatusError,
  errorMessage,
  errorStatus,
  isRetryableRequestError,
  setRequestParam,
} from '@/lib/request-helpers';
import { readServerRun, updateServerRunIf } from '@/lib/server-run-store';
import { processChatStream } from '@/lib/stream-utils';
import { buildUpstreamUrl, normalizeUpstreamBaseUrl } from '@/lib/upstream-url';
import { isSameUpstreamBaseUrl, resolveUpstreamBaseUrl } from '@/lib/upstream-security';

type UpstreamAuthMode = 'bearer' | 'anthropic';

interface UpstreamTarget {
  baseUrl: string;
  apiKey: string;
  authMode: UpstreamAuthMode;
  trustedBaseUrls: string[];
}

const globalForServerRuns = globalThis as unknown as {
  serverRunPromises?: Map<string, Promise<void>>;
  serverRunControllers?: Map<string, AbortController>;
  serverRunRuntimeSecrets?: Map<string, ServerRunRuntimeSecrets>;
};

interface ServerRunRuntimeSecrets {
  credentials: Partial<Pick<
    AppConfig,
    | 'apiKey'
    | 'chatApiKey'
    | 'claudeApiKey'
    | 'baseUrl'
    | 'chatBaseUrl'
    | 'claudeBaseUrl'
  >>;
  assetSessionId: string;
  allowServerDefaults: boolean;
}

const activeRuns = globalForServerRuns.serverRunPromises ?? new Map<string, Promise<void>>();
const activeControllers = globalForServerRuns.serverRunControllers ?? new Map<string, AbortController>();
const runtimeSecrets = globalForServerRuns.serverRunRuntimeSecrets ?? new Map<string, ServerRunRuntimeSecrets>();
globalForServerRuns.serverRunPromises = activeRuns;
globalForServerRuns.serverRunControllers = activeControllers;
globalForServerRuns.serverRunRuntimeSecrets = runtimeSecrets;

const CHAT_PARTIAL_WRITE_INTERVAL_MS = 120;

// Callers must register secrets synchronously *before* ensureServerRunStarted:
// the executor checks runtimeSecrets.has(id) only after `await readServerRun`
// resolves, so anything registered in the same synchronous tick (e.g. a POST
// handler) is guaranteed to be observed.
export function registerServerRunRuntimeSecrets(runId: string, secrets: ServerRunRuntimeSecrets) {
  runtimeSecrets.set(runId, secrets);
}

function runConfig(run: ServerRunRecord): AppConfig {
  return {
    ...run.config,
    ...runtimeSecrets.get(run.id)?.credentials,
  };
}

function runAssetSessionId(runId: string) {
  return runtimeSecrets.get(runId)?.assetSessionId || '';
}

function runAllowsServerDefaults(runId: string) {
  return runtimeSecrets.get(runId)?.allowServerDefaults === true;
}

function validateBaseUrl(value: string) {
  const baseUrl = normalizeUpstreamBaseUrl(value);
  if (!baseUrl) {
    throw new Error('Base URL 无效或未配置。仅允许 http/https 协议。');
  }
  return baseUrl;
}

function imageTarget(config: AppConfig, allowServerDefaults: boolean): UpstreamTarget {
  const defaultBaseUrl = process.env.DEFAULT_BASE_URL || '';
  if (!config.apiKey && config.baseUrl && !isSameUpstreamBaseUrl(config.baseUrl, defaultBaseUrl)) {
    throw new Error('自定义 Base URL 必须同时提供 API Key。');
  }
  return {
    apiKey: config.apiKey || (allowServerDefaults ? process.env.DEFAULT_API_KEY : '') || '',
    baseUrl: validateBaseUrl(config.baseUrl || defaultBaseUrl),
    authMode: 'bearer',
    trustedBaseUrls: allowServerDefaults ? [defaultBaseUrl] : [],
  };
}

function chatTarget(config: AppConfig, format: ChatApiFormat, allowServerDefaults: boolean): UpstreamTarget {
  if (format === 'claude') {
    const defaultBaseUrl = process.env.DEFAULT_CLAUDE_BASE_URL || process.env.DEFAULT_CHAT_BASE_URL || process.env.DEFAULT_BASE_URL || '';
    if (!config.claudeApiKey && config.claudeBaseUrl && !isSameUpstreamBaseUrl(config.claudeBaseUrl, defaultBaseUrl)) {
      throw new Error('自定义 Claude Base URL 必须同时提供 API Key。');
    }
    return {
      apiKey: config.claudeApiKey || (allowServerDefaults ? process.env.DEFAULT_CLAUDE_API_KEY || process.env.DEFAULT_CHAT_API_KEY || process.env.DEFAULT_API_KEY : '') || '',
      baseUrl: validateBaseUrl(config.claudeBaseUrl || defaultBaseUrl),
      authMode: 'anthropic',
      trustedBaseUrls: allowServerDefaults ? [defaultBaseUrl] : [],
    };
  }

  const defaultBaseUrl = process.env.DEFAULT_CHAT_BASE_URL || process.env.DEFAULT_BASE_URL || '';
  const suppliedApiKey = config.chatApiKey || config.apiKey;
  if (!suppliedApiKey && config.chatBaseUrl && !isSameUpstreamBaseUrl(config.chatBaseUrl, defaultBaseUrl)) {
    throw new Error('自定义 Chat Base URL 必须同时提供 API Key。');
  }
  return {
    apiKey: suppliedApiKey || (allowServerDefaults ? process.env.DEFAULT_CHAT_API_KEY || process.env.DEFAULT_API_KEY : '') || '',
    baseUrl: validateBaseUrl(config.chatBaseUrl || defaultBaseUrl),
    authMode: 'bearer',
    trustedBaseUrls: allowServerDefaults ? [defaultBaseUrl] : [],
  };
}

function requireApiKey(target: UpstreamTarget) {
  if (!target.apiKey) throw new Error('未配置 API Key。请在设置中填写，或在服务端 .env 中设置默认 API Key。');
}

function describeRetryFailure(error: unknown) {
  const status = errorStatus(error);
  if (status === 429) return '上游限流';
  if (status && status >= 500) return '上游服务器错误';
  if (status === 408 || /timeout|timed out|超时/i.test(errorMessage(error))) return '请求超时';
  return '请求失败';
}

function buildErrorHint(msg: string): string {
  if (msg.includes('413') || /too large|请求体|超过上限|Image is too large/i.test(msg)) {
    return '\n参考图总大小过大，请删除不必要的参考图或换用更小的图片后重试';
  }
  if (/no available channel for model/i.test(msg)) {
    return '\n当前 API 渠道没有这个模型的可用通道。请在设置中切换对应的 Base URL/API Key，或更换可用模型。';
  }
  if (msg.includes('401')) return '\nAPI Key 无效或未配置，请在设置中填写或检查 .env';
  if (msg.includes('400')) return '\n请求参数有误，请检查 Base URL 格式';
  if (msg.includes('404') || msg.includes('405')) return '\n接口不存在，请确认 Base URL 是否支持 OpenAI 兼容 API';
  if (/5\d\d/.test(msg)) return '\n上游服务器错误，请稍后重试或检查服务状态';
  return '\n请检查 API Key 和 Base URL 配置';
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('任务已取消'));
      return;
    }

    const timeoutId = setTimeout(() => {
      signal.removeEventListener('abort', handleAbort);
      resolve();
    }, ms);

    const handleAbort = () => {
      clearTimeout(timeoutId);
      reject(new Error('任务已取消'));
    };

    signal.addEventListener('abort', handleAbort, { once: true });
  });
}

async function retryable<T>(
  label: string,
  signal: AbortSignal,
  operation: () => Promise<T>,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= REQUEST_MAX_ATTEMPTS; attempt += 1) {
    if (signal.aborted) throw new Error('任务已取消');
    try {
      return await operation();
    } catch (error) {
      if (signal.aborted) throw new Error('任务已取消');
      lastError = error;
      const retryableError = isRetryableRequestError(error);
      if (!retryableError || attempt >= REQUEST_MAX_ATTEMPTS) {
        if (retryableError && attempt >= REQUEST_MAX_ATTEMPTS) {
          throw new RequestAttemptsExhaustedError(error);
        }
        throw error;
      }

      const delay = REQUEST_RETRY_DELAYS_MS[attempt - 1] ?? REQUEST_RETRY_DELAYS_MS[REQUEST_RETRY_DELAYS_MS.length - 1];
      const retryCount = REQUEST_MAX_ATTEMPTS - 1;
      await updateServerRunStatus(
        label,
        `[RETRY ${attempt}/${retryCount}] ${describeRetryFailure(error)}，${Math.round(delay / 1000)}s 后再次请求`,
      );
      await sleep(delay, signal);
    }
  }

  throw new RequestAttemptsExhaustedError(lastError);
}

async function updateServerRunStatus(runId: string, statusText: string) {
  // Keep any accumulated streaming result so retry status text does not blank it out.
  // Only write while the run is still active: a retry status enqueued before a
  // cancel must not land after it and clear the terminal record's `error`.
  await updateServerRunIf(runId, { error: statusText }, (run) => run.status === 'queued' || run.status === 'running');
}

function upstreamHeaders(target: UpstreamTarget, contentType?: string): HeadersInit {
  requireApiKey(target);
  const headers: HeadersInit = target.authMode === 'anthropic'
    ? {
        'x-api-key': target.apiKey,
        'anthropic-version': '2023-06-01',
      }
    : {
        'Authorization': `Bearer ${target.apiKey}`,
      };
  if (contentType) headers['Content-Type'] = contentType;
  return headers;
}

async function fetchUpstreamResponse<T>(
  target: UpstreamTarget,
  path: string,
  body: BodyInit,
  options: AppOptions,
  signal: AbortSignal,
  handleResponse: (response: Response) => Promise<T>,
  contentType?: string,
) {
  const timeoutSec = Math.min(3600, Math.max(1, Math.floor(Number(options.timeout) || 1)));
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutSec * 1000);
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  // The signal may have fired between entry and listener registration.
  if (signal.aborted) controller.abort();

  try {
    const upstream = await resolveUpstreamBaseUrl(target.baseUrl, target.trustedBaseUrls);
    const response = await fetchPinned(buildUpstreamUrl(upstream.baseUrl, path), {
      method: 'POST',
      headers: upstreamHeaders(target, contentType),
      body,
      signal: controller.signal,
      redirect: 'error',
    }, upstream.addresses);
    if (!response.ok) {
      const text = await response.text();
      throw new RequestStatusError({ status: response.status, statusText: response.statusText, text });
    }
    return await handleResponse(response);
  } catch (error) {
    if (controller.signal.aborted) {
      throw signal.aborted
        ? new Error('任务已取消')
        : new Error(`请求超时 (${timeoutSec}s)。可在设置中调大超时秒数。`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    signal.removeEventListener('abort', abort);
  }
}

async function fetchUpstreamText(
  target: UpstreamTarget,
  path: string,
  body: BodyInit,
  options: AppOptions,
  signal: AbortSignal,
  contentType?: string,
) {
  return fetchUpstreamResponse(
    target,
    path,
    body,
    options,
    signal,
    (response) => response.text(),
    contentType,
  );
}

function toClaudeMessagesBody(body: Record<string, unknown>) {
  const sourceMessages = Array.isArray(body.messages) ? body.messages : [];
  const systemParts: string[] = [];
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const item of sourceMessages) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const role = typeof record.role === 'string' ? record.role : '';
    const content = typeof record.content === 'string' ? record.content.trim() : '';
    if (!content) continue;
    if (role === 'system' || role === 'developer') systemParts.push(content);
    else if (role === 'user' || role === 'assistant') messages.push({ role, content });
  }

  const maxTokens = Number(body.max_tokens ?? body.maxTokens ?? 4096);
  const claudeBody: Record<string, unknown> = {
    model: body.model,
    messages,
    max_tokens: Number.isFinite(maxTokens) && maxTokens > 0 ? Math.floor(maxTokens) : 4096,
  };
  if (body.stream !== undefined) claudeBody.stream = Boolean(body.stream);
  if (systemParts.length > 0) claudeBody.system = systemParts.join('\n\n');
  return claudeBody;
}

function chatResultFromParts(
  parts: ChatContentParts,
  statusText: string,
  statusType: ServerRunResult['statusType'],
  debugRaw?: string,
): ServerRunResult {
  return {
    prompt: '',
    images: [],
    text: parts.text,
    thinking: parts.thinking,
    thinkingDone: parts.thinkingDone,
    code: '',
    extra: '',
    ...(debugRaw ? { debugRaw } : {}),
    statusText,
    statusType,
  };
}

async function generateRunTitle(run: ServerRunRecord, assistantText: string, signal: AbortSignal) {
  if (run.historyMessages.some((message) => message.role === 'user' && message.prompt.trim())) return '';
  if (!assistantText.trim()) return '';

  const config = runConfig(run);
  const format = run.request.chatApiFormat || config.chatApiFormat;
  const provider = getChatProviderConfig(config, format);
  const titleModel = provider.titleModel || provider.model;
  if (!titleModel) return '';

  const target = chatTarget(config, format, runAllowsServerDefaults(run.id));
  const body = {
    model: titleModel,
    messages: [
      {
        role: 'system',
        content: 'Summarize this conversation into a concise Chinese chat title. Return only the final title without quotes, punctuation, markdown, or reasoning.',
      },
      {
        role: 'user',
        content: `User: ${run.prompt}\nAssistant: ${assistantText.slice(0, 1200)}`,
      },
    ],
    stream: false,
  };
  const upstreamBody = format === 'claude' ? toClaudeMessagesBody(body) : body;
  const text = await fetchUpstreamText(
    target,
    format === 'claude' ? '/messages' : '/chat/completions',
    JSON.stringify(upstreamBody),
    { ...run.options, streaming: false, timeout: Math.min(20, Math.max(1, run.options.timeout)) },
    signal,
    'application/json',
  );
  return normalizeGeneratedTitle(extractChatResponseText(parseResponseBody(text), format));
}

function createPartialChatRunWriter(runId: string) {
  let latestParts: ChatContentParts | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastWriteAt = 0;
  let canceled = false;
  let writeQueue: Promise<void> = Promise.resolve();

  const writeParts = (parts: ChatContentParts) => {
    lastWriteAt = Date.now();
    const result = chatResultFromParts(parts, '正在回复...', 'warn');
    writeQueue = writeQueue
      .catch(() => undefined)
      // Conditional write: a partial enqueued before a cancel must not land
      // after it and replace the terminal record's result.
      .then(() => updateServerRunIf(runId, { result, error: undefined }, (run) => run.status === 'queued' || run.status === 'running'))
      .then(() => undefined, () => undefined);
  };

  const flushLatest = () => {
    timer = null;
    if (canceled || !latestParts) return;
    const parts = latestParts;
    latestParts = null;
    writeParts(parts);
  };

  return {
    enqueue(parts: ChatContentParts) {
      if (canceled) return;
      latestParts = parts;
      const delay = Math.max(0, CHAT_PARTIAL_WRITE_INTERVAL_MS - (Date.now() - lastWriteAt));
      if (delay === 0) {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        flushLatest();
      } else if (!timer) {
        timer = setTimeout(flushLatest, delay);
      }
    },
    cancel() {
      canceled = true;
      latestParts = null;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
    async flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      flushLatest();
      await writeQueue;
    },
  };
}

function applyImageParams(target: RequestBody, request: ChatTurnSnapshot) {
  if (request.quality && request.quality !== 'auto') setRequestParam(target, 'quality', request.quality);
  if (request.background && request.background !== 'auto') setRequestParam(target, 'background', request.background);
  setRequestParam(target, 'output_format', request.format || 'png');
  if ((request.format === 'jpeg' || request.format === 'webp') && !Number.isNaN(request.compression)) {
    setRequestParam(target, 'output_compression', request.compression);
  }
  if (request.moderation && request.moderation !== 'auto') setRequestParam(target, 'moderation', request.moderation);
}

function dataUrlToBlob(dataUrl: string): Blob {
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/);
  if (!match) throw new Error('图片数据格式无效');
  const mime = match[1] || 'image/png';
  const data = (match[3] || '').replace(/\s+/g, '');
  const binary = match[2]
    ? Buffer.from(data, 'base64')
    : Buffer.from(decodeURIComponent(data), 'utf8');
  return new Blob([binary], { type: mime });
}

function blobExt(blob: Blob) {
  if (blob.type === 'image/jpeg') return 'jpg';
  if (blob.type === 'image/webp') return 'webp';
  if (blob.type === 'image/gif') return 'gif';
  return 'png';
}

function localChatAssetId(source: string) {
  const match = /^\/api\/chat-assets\/([^/?#]+)$/.exec(source);
  if (!match || !isValidChatAssetId(match[1])) {
    throw new Error('参考图来源无效');
  }

  return match[1];
}

async function imageHitToBlob(image: ImageHit, assetSessionId: string, signal: AbortSignal): Promise<Blob | null> {
  const source = image.dataUrl || image.url;
  if (!source) return null;
  if (source.startsWith('data:')) return dataUrlToBlob(source);

  if (signal.aborted) throw new Error('任务已取消');
  if (/^https?:\/\//i.test(source)) {
    // Remote reference images go through the same SSRF validation + size/mime limits
    // as the chat asset mirror endpoint.
    const { bytes, mime } = await fetchRemoteImageBytes(source);
    if (signal.aborted) throw new Error('任务已取消');
    return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime });
  }

  if (!assetSessionId) throw new Error('参考图会话无效，请重新上传参考图');
  const assetId = localChatAssetId(source);
  const { bytes, mime } = await readChatAsset(assetSessionId, assetId);
  if (signal.aborted) throw new Error('任务已取消');
  return new Blob([bytes], { type: mime });
}

async function buildEditsForm(
  references: ChatReferenceImage[],
  prompt: string,
  request: ChatTurnSnapshot,
  assetSessionId: string,
  signal: AbortSignal,
) {
  const form = new FormData();
  form.append('model', request.model);
  form.append('prompt', prompt);
  if (request.size && request.size !== 'auto') form.append('size', request.size);

  const imageBlobs = await Promise.all(references.map((reference) => imageHitToBlob(reference.image, assetSessionId, signal)));
  if (imageBlobs.length === 0 || imageBlobs.some((blob) => !blob)) {
    throw new Error('参考图加载失败，请重新上传后重试。');
  }
  imageBlobs.forEach((blob, index) => {
    if (blob) form.append('image[]', blob, `image-${index + 1}.${blobExt(blob)}`);
  });

  const maskBlob = await imageHitToBlob(references[0]?.mask || {}, assetSessionId, signal);
  if (maskBlob) form.append('mask', maskBlob, `mask.${blobExt(maskBlob)}`);
  applyImageParams(form, request);
  return form;
}

async function runChat(run: ServerRunRecord, signal: AbortSignal): Promise<ServerRunResult> {
  const config = runConfig(run);
  const format = run.request.chatApiFormat || run.config.chatApiFormat;
  const target = chatTarget(config, format, runAllowsServerDefaults(run.id));
  const streaming = Boolean(run.request.streaming && run.options.streaming);
  const body = {
    model: run.request.chatModel || config.chatModel,
    messages: buildChatMessages(run.historyMessages, run.prompt, run.request.systemPrompt || '', run.request.contextLimit),
    stream: streaming,
  };
  const upstreamBody = format === 'claude' ? toClaudeMessagesBody(body) : body;
  const upstreamPath = format === 'claude' ? '/messages' : '/chat/completions';

  if (streaming) {
    return retryable(run.id, signal, () => runChatStreamAttempt(
      run,
      target,
      format,
      upstreamPath,
      upstreamBody,
      signal,
    ));
  }

  const text = await retryable(run.id, signal, () => fetchUpstreamText(
    target,
    upstreamPath,
    JSON.stringify(upstreamBody),
    run.options,
    signal,
    'application/json',
  ));
  const response = JSON.parse(text);
  const parts = extractChatResponseParts(response, format);
  if (!parts.text.trim() && !parts.thinking.trim()) throw new Error('响应为空');
  return chatResultFromParts(parts, '回复完成', 'ok', debugRawFromResponse(text));
}

// debugRaw/code mirror the upstream image response, which embeds the same
// base64 bytes that result.images[].dataUrl already stores (~3x the cost per
// image). Deep-clone the response replacing every inline image payload —
// `b64_json`-style carrier fields, `data:image/...` strings, and data URLs
// embedded inside larger text blobs — with a short placeholder.
const BASE64_CARRIER_KEYS = new Set(['b64_json', 'result', 'image', 'src', 'data']);
const LONG_BASE64_RE = /^[A-Za-z0-9+/=\r\n]+$/;
const EMBEDDED_DATA_IMAGE_RE = /data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\r\n]+/gi;

function omitBase64(value: string) {
  return `[base64 omitted: ${Buffer.byteLength(value, 'utf8')} bytes]`;
}

function stripInlineImageData(value: unknown, key?: string): unknown {
  if (typeof value === 'string') {
    if (/^data:image\//i.test(value)) return omitBase64(value);
    if (key && BASE64_CARRIER_KEYS.has(key.toLowerCase()) && value.length >= 200 && LONG_BASE64_RE.test(value)) {
      return omitBase64(value);
    }
    return value.replace(EMBEDDED_DATA_IMAGE_RE, (match) => omitBase64(match));
  }
  if (Array.isArray(value)) return value.map((item) => stripInlineImageData(item));
  if (value && typeof value === 'object') {
    const stripped: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      stripped[childKey] = stripInlineImageData(childValue, childKey);
    }
    return stripped;
  }
  return value;
}

const DEBUG_RAW_MAX_CHARS = 1024 * 1024;

function debugRawFromResponse(response: unknown) {
  const out = typeof response === 'string'
    ? stripInlineImageData(response) as string
    : JSON.stringify(stripInlineImageData(response), null, 2);
  // Hard cap: any payload shape the stripper misses (e.g. a bare multi-MB
  // base64 blob inside a text field) must not reach the persisted record.
  return out.length > DEBUG_RAW_MAX_CHARS
    ? `${out.slice(0, DEBUG_RAW_MAX_CHARS)}\n[debugRaw truncated at ${DEBUG_RAW_MAX_CHARS} chars]`
    : out;
}

async function runSingleImage(run: ServerRunRecord, body: Record<string, unknown>, signal: AbortSignal) {
  const text = await fetchUpstreamText(
    imageTarget(runConfig(run), runAllowsServerDefaults(run.id)),
    '/images/generations',
    JSON.stringify(body),
    run.options,
    signal,
    'application/json',
  );
  const response = parseResponseBody(text);
  const hit = extractImage(response);
  if (!hit) throw new Error('响应中未找到图片');
  return { hit, debugRaw: debugRawFromResponse(response) };
}

function requestedImageCountFor(run: ServerRunRecord) {
  const n = Math.floor(Number(run.request.n));
  // Match the composer's option list (up to 20 sequential upstream requests).
  return Number.isFinite(n) ? Math.min(20, Math.max(1, n)) : 1;
}

async function runImageGeneration(run: ServerRunRecord, signal: AbortSignal): Promise<ServerRunResult> {
  const requestedImageCount = requestedImageCountFor(run);
  const body: Record<string, unknown> = {
    model: run.request.model || run.config.model,
    prompt: run.prompt,
    n: 1,
    size: run.request.size,
  };
  applyImageParams(body, run.request);

  const hits: ImageHit[] = [];
  let debugRaw = '';
  for (let index = 0; index < requestedImageCount; index += 1) {
    const result = await retryable(run.id, signal, () => runSingleImage(run, body, signal));
    hits.push(result.hit);
    if (!debugRaw) debugRaw = result.debugRaw;
    if (index < requestedImageCount - 1) await sleep(200, signal);
  }

  return {
    prompt: '',
    images: hits,
    text: '',
    code: debugRaw,
    extra: '',
    debugRaw,
    statusText: `生成完成 ${hits.length} 张`,
    statusType: 'ok',
  };
}

async function runSingleEdit(run: ServerRunRecord, form: FormData, signal: AbortSignal) {
  const text = await fetchUpstreamText(
    imageTarget(runConfig(run), runAllowsServerDefaults(run.id)),
    '/images/edits',
    form,
    run.options,
    signal,
  );
  const response = parseResponseBody(text);
  const hit = extractImage(response);
  if (!hit) throw new Error('响应中未找到图片');
  return { hit, debugRaw: debugRawFromResponse(response) };
}

async function runImageEdit(run: ServerRunRecord, signal: AbortSignal): Promise<ServerRunResult> {
  const assetSessionId = runAssetSessionId(run.id);
  const requestedImageCount = requestedImageCountFor(run);
  const hits: ImageHit[] = [];
  let debugRaw = '';

  for (let index = 0; index < requestedImageCount; index += 1) {
    const result = await retryable(run.id, signal, async () => {
      const form = await buildEditsForm(run.request.referenceImages, run.prompt, run.request, assetSessionId, signal);
      return runSingleEdit(run, form, signal);
    });
    hits.push(result.hit);
    if (!debugRaw) debugRaw = result.debugRaw;
    if (index < requestedImageCount - 1) await sleep(200, signal);
  }

  return {
    prompt: '',
    images: hits,
    text: '',
    code: debugRaw,
    extra: '',
    debugRaw,
    statusText: `生成完成 ${hits.length} 张`,
    statusType: 'ok',
  };
}

async function runChatStreamAttempt(
  run: ServerRunRecord,
  target: UpstreamTarget,
  format: ChatApiFormat,
  upstreamPath: string,
  upstreamBody: Record<string, unknown>,
  signal: AbortSignal,
): Promise<ServerRunResult> {
  const partialWriter = createPartialChatRunWriter(run.id);

  try {
    const { parts, debugRaw } = await fetchUpstreamResponse(
      target,
      upstreamPath,
      JSON.stringify(upstreamBody),
      run.options,
      signal,
      async (response) => {
        const contentType = response.headers.get('content-type') || '';

        if (!/text\/event-stream|stream/i.test(contentType)) {
          const text = await response.text();
          const parsed = JSON.parse(text);
          return {
            parts: extractChatResponseParts(parsed, format),
            debugRaw: debugRawFromResponse(parsed),
          };
        }

        if (!response.body) throw new Error('响应为空');
        const parts = await processChatStream(
          response.body,
          (nextParts) => partialWriter.enqueue(nextParts),
          format,
          signal,
          { minEmitIntervalMs: CHAT_PARTIAL_WRITE_INTERVAL_MS },
        );
        return {
          parts,
          debugRaw: JSON.stringify(parts, null, 2),
        };
      },
      'application/json',
    );

    partialWriter.enqueue(parts);
    await partialWriter.flush();
    if (!parts.text.trim() && !parts.thinking.trim()) throw new Error('响应为空');
    return chatResultFromParts(parts, '回复完成', 'ok', debugRaw);
  } catch (error) {
    partialWriter.cancel();
    await partialWriter.flush();
    throw error;
  }
}

// Reference-image data URLs are multi-MB payloads the executor only needs
// while the run is active; nothing server-side reads them from the store once
// the run leaves 'queued' (the public view strips down to {url} anyway).
function stripRequestDataUrls(request: ServerRunRecord['request']): ServerRunRecord['request'] {
  if (!request || !Array.isArray(request.referenceImages)) return request;
  return {
    ...request,
    referenceImages: request.referenceImages.map((reference) => {
      if (!reference || typeof reference !== 'object') return reference;
      const next = { ...reference };
      if (next.image?.dataUrl) next.image = { url: next.image.url };
      if (next.mask?.dataUrl) next.mask = { url: next.mask.url };
      return next;
    }),
  };
}

async function executeServerRun(id: string, controller: AbortController) {
  const run = await readServerRun(id);
  if (!run || run.status === 'completed' || run.status === 'failed' || run.status === 'canceled') return;

  // Strip historyMessages and inline reference-image data at the running
  // transition too: a restart can never resume a run (runtime secrets are
  // memory-only), so persisting multi-MB payloads would just re-serialize them
  // on every streaming flush. Execution continues from the already-read `run`,
  // which still carries the full payload.
  const started = await updateServerRunIf(id, {
    status: 'running',
    startedAt: Date.now(),
    error: undefined,
    historyMessages: [],
    request: stripRequestDataUrls(run.request),
  }, (current) => current.status === 'queued');
  // A cancel (or another terminal write) landed between the read and the write.
  if (!started) return;

  try {
    const result = run.request.mode === 'chat'
      ? await runChat(run, controller.signal)
      : run.request.mode === 'edits'
        ? await runImageEdit(run, controller.signal)
        : await runImageGeneration(run, controller.signal);

    let completedResult = result;
    try {
      const titleSource = result.text || (result.images.length > 0 ? `生成完成 ${result.images.length} 张图片` : '');
      const generatedTitle = await generateRunTitle(run, titleSource, controller.signal);
      if (generatedTitle) completedResult = { ...result, generatedTitle };
    } catch (error) {
      if (controller.signal.aborted) throw error;
    }

    // Conditional write: a cancel that landed while the run finished must not
    // be resurrected to 'completed'.
    await updateServerRunIf(id, {
      status: 'completed',
      result: completedResult,
      error: undefined,
      completedAt: Date.now(),
      historyMessages: [],
      request: stripRequestDataUrls(run.request),
    }, (current) => current.status === 'queued' || current.status === 'running');
  } catch (error) {
    const message = errorMessage(error);
    const canceled = controller.signal.aborted || message === '任务已取消';
    const finalMessage = canceled ? '用户已取消本次请求。' : message + buildErrorHint(message);
    try {
      await updateServerRunIf(id, {
        status: canceled ? 'canceled' : 'failed',
        error: finalMessage,
        completedAt: Date.now(),
        historyMessages: [],
        request: stripRequestDataUrls(run.request),
        result: {
          prompt: finalMessage,
          images: [],
          text: '',
          code: '',
          extra: 'error',
          debugRaw: finalMessage,
          statusText: canceled ? '已取消' : '请求失败',
          statusType: canceled ? 'warn' : 'err',
        },
      }, (current) => current.status === 'queued' || current.status === 'running');
    } catch (writeError) {
      // The store may be unavailable (e.g. disk full); never rethrow here.
      console.error(`Failed to record final state for server run ${id}`, writeError);
    }
  }
}

export function ensureServerRunStarted(id: string) {
  const existing = activeRuns.get(id);
  if (existing) return existing;

  const controller = new AbortController();
  activeControllers.set(id, controller);
  const promise = (async () => {
    const run = await readServerRun(id);
    // A persisted 'running' record reaching this point is orphaned — its
    // executor died with the process (a live one would have returned from
    // activeRuns above) and its request payload was stripped at the running
    // transition, so it cannot resume even if a duplicate POST re-registered
    // secrets. 'queued' records can only resume when secrets exist this boot.
    const orphaned = run?.status === 'running'
      || (run?.status === 'queued' && !runtimeSecrets.has(id));
    if (run && orphaned) {
      const message = '后台任务因服务进程重启已中断，请重新发送。';
      // Conditional write: a cancel that landed first must not be flipped to
      // 'failed' by this restart-orphan sweep.
      await updateServerRunIf(id, {
        status: 'failed',
        error: message,
        completedAt: Date.now(),
        historyMessages: [],
        request: stripRequestDataUrls(run.request),
        result: {
          prompt: message,
          images: [],
          text: '',
          code: '',
          extra: 'error',
          debugRaw: message,
          statusText: '请求失败',
          statusType: 'err',
        },
      }, (current) => current.status === 'queued' || current.status === 'running');
      return;
    }
    await executeServerRun(id, controller);
  })().catch((error) => {
    // Callers intentionally discard this promise; absorb failures so they
    // never surface as unhandled rejections.
    console.error(`Server run ${id} failed unexpectedly`, error);
  }).finally(() => {
    activeRuns.delete(id);
    activeControllers.delete(id);
    runtimeSecrets.delete(id);
  });
  activeRuns.set(id, promise);
  return promise;
}

export async function cancelServerRun(id: string) {
  activeControllers.get(id)?.abort();
  runtimeSecrets.delete(id);
  const existing = await readServerRun(id);
  // The predicate runs inside the store's write queue, so a run that reached a
  // terminal state between the abort signal and the write cannot be clobbered.
  await updateServerRunIf(id, {
    status: 'canceled',
    error: '用户已取消本次请求。',
    completedAt: Date.now(),
    historyMessages: [],
    ...(existing ? { request: stripRequestDataUrls(existing.request) } : {}),
    result: {
      prompt: '用户已取消本次请求。',
      images: [],
      text: '',
      code: '',
      extra: 'error',
      debugRaw: '用户已取消本次请求。',
      statusText: '已取消',
      statusType: 'warn',
    },
  }, (run) => run.status === 'queued' || run.status === 'running');
}
