import { NextRequest, NextResponse } from 'next/server';
import {
  getRandomModelGateMessage,
  MODEL_GATE_UNLOCKED_COOKIE,
  verifyModelGateUnlockToken,
} from './model-gate';
import { isModelGateEnabled } from './model-gate-env';
import { buildUpstreamUrl, normalizeUpstreamBaseUrl } from './upstream-url';
import { assertServerDefaultAccess, serverDefaultAccessAuthorized } from './server-access';
import { isSameUpstreamBaseUrl, resolveUpstreamBaseUrl } from './upstream-security';
import { fetchPinned, type ResolvedAddress } from './pinned-fetch';
import { readLimitedText } from './limited-body';

export const TIMEOUT_SEC = 600;
export const MAX_BODY_SIZE = 32 * 1024 * 1024;

export interface ValidatedRequest {
  apiKey: string;
  baseUrl: string;
  /** DNS-pinned addresses from SSRF validation; empty for trusted base URLs. */
  addresses: ResolvedAddress[];
}

type UpstreamAuthMode = 'bearer' | 'anthropic';

interface UpstreamProxyOptions {
  authMode?: UpstreamAuthMode;
  contentType?: string;
  /** Whether the caller consumes the response as an event stream; keepalive
   *  comment lines are only emitted when true (they would corrupt JSON bodies). */
  sseExpected?: boolean;
  addresses?: ResolvedAddress[];
}

type RequestKind = 'image' | 'chat' | 'claude';

function isAllowedCorsOrigin(origin: string) {
  if (!origin) return false;
  return new Set(
    (process.env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  ).has(origin);
}

export function corsPreflightResponse(request: NextRequest) {
  const origin = request.headers.get('origin') || '';
  if (!isAllowedCorsOrigin(origin)) {
    return NextResponse.json({ error: { message: 'Origin 不在允许列表中。' } }, { status: 403 });
  }
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, X-Base-URL, X-Chat-API-Format, X-Server-Access-Token',
      'Access-Control-Max-Age': '600',
      Vary: 'Origin',
    },
  });
}

/** Validate API key, base URL, and body size. Returns validated values or an error Response.
 *  Chat requests can use OpenAI-compatible or Claude-specific defaults. */
export async function validateRequest(request: NextRequest, kind: RequestKind = 'image'): Promise<ValidatedRequest | NextResponse> {
  const modelGateUnlocked = await verifyModelGateUnlockToken(request.cookies.get(MODEL_GATE_UNLOCKED_COOKIE)?.value);
  if (isModelGateEnabled() && !modelGateUnlocked) {
    return NextResponse.json(
      { error: { code: 'model_gate_locked', message: getRandomModelGateMessage() } },
      { status: 418 }
    );
  }

  const keyEnv = kind === 'claude'
    ? (process.env.DEFAULT_CLAUDE_API_KEY || process.env.DEFAULT_CHAT_API_KEY || process.env.DEFAULT_API_KEY)
    : kind === 'chat'
      ? (process.env.DEFAULT_CHAT_API_KEY || process.env.DEFAULT_API_KEY)
      : process.env.DEFAULT_API_KEY;
  const urlEnv = kind === 'claude'
    ? (process.env.DEFAULT_CLAUDE_BASE_URL || process.env.DEFAULT_CHAT_BASE_URL || process.env.DEFAULT_BASE_URL)
    : kind === 'chat'
      ? (process.env.DEFAULT_CHAT_BASE_URL || process.env.DEFAULT_BASE_URL)
      : process.env.DEFAULT_BASE_URL;

  const suppliedApiKey = request.headers.get('x-api-key') || '';
  const requestedBaseUrl = request.headers.get('x-base-url') || '';
  const serverAccessToken = request.headers.get('x-server-access-token');
  const baseUrl = normalizeUpstreamBaseUrl(requestedBaseUrl || urlEnv || '');
  if (!baseUrl) {
    return NextResponse.json(
      { error: { message: 'Base URL 无效或未配置。仅允许 http/https 协议。' } },
      { status: 400 },
    );
  }
  const usesServerDefault = !suppliedApiKey;
  if (usesServerDefault && !isSameUpstreamBaseUrl(baseUrl, urlEnv || '')) {
    return NextResponse.json(
      { error: { message: '自定义 Base URL 必须同时提供 API Key。' } },
      { status: 401 },
    );
  }
  if (usesServerDefault) {
    try {
      assertServerDefaultAccess(serverAccessToken);
    } catch (error) {
      return NextResponse.json({ error: { message: (error as Error).message } }, { status: 401 });
    }
  }
  let addresses: ResolvedAddress[] = [];
  try {
    const trustedBaseUrls = serverDefaultAccessAuthorized(serverAccessToken) ? [urlEnv || ''] : [];
    addresses = (await resolveUpstreamBaseUrl(baseUrl, trustedBaseUrls)).addresses;
  } catch (error) {
    return NextResponse.json({ error: { message: (error as Error).message } }, { status: 400 });
  }

  const apiKey = suppliedApiKey || keyEnv;
  if (!apiKey) {
    const envName = kind === 'claude'
      ? 'DEFAULT_CLAUDE_API_KEY、DEFAULT_CHAT_API_KEY 或 DEFAULT_API_KEY'
      : kind === 'chat'
        ? 'DEFAULT_CHAT_API_KEY 或 DEFAULT_API_KEY'
        : 'DEFAULT_API_KEY';
    return NextResponse.json(
      { error: { message: `未配置 API Key。请在设置中填写，或在服务端 .env 中设置 ${envName}。` } },
      { status: 401 }
    );
  }

  const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
  if (contentLength > MAX_BODY_SIZE) {
    return NextResponse.json(
      { error: { message: `请求体 ${(contentLength / 1024 / 1024).toFixed(1)}MB 超过上限 32MB` } },
      { status: 413 }
    );
  }

  return { apiKey, baseUrl, addresses };
}

async function proxyUpstreamBodyStream(
  baseUrl: string,
  apiKey: string,
  path: string,
  body: BodyInit,
  origin: string,
  requestSignal?: AbortSignal,
  options: UpstreamProxyOptions = {},
): Promise<Response> {
  const url = buildUpstreamUrl(baseUrl, path);
  console.log(`[proxy-stream] POST ${url}`);

  const stream = new ReadableStream({
    async start(ctrl) {
      const encoder = new TextEncoder();
      const upstreamController = new AbortController();
      const timeoutId = setTimeout(() => upstreamController.abort(), TIMEOUT_SEC * 1000);

      const abortUpstream = () => upstreamController.abort();
      if (requestSignal) {
        requestSignal.addEventListener('abort', abortUpstream, { once: true });
      }

      let keepalive: ReturnType<typeof setInterval> | null = null;
      const stopKeepalive = () => {
        if (keepalive) {
          clearInterval(keepalive);
          keepalive = null;
        }
      };
      if (options.sseExpected) {
        keepalive = setInterval(() => {
          try { ctrl.enqueue(encoder.encode(': keepalive\n\n')); } catch { /* closed */ }
        }, 25_000);
        try { ctrl.enqueue(encoder.encode(': keepalive\n\n')); } catch { /* closed */ }
      }

      try {
        const headers: HeadersInit = options.authMode === 'anthropic'
          ? {
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
            }
          : {
              'Authorization': `Bearer ${apiKey}`,
            };
        if (options.contentType) headers['Content-Type'] = options.contentType;

        if (requestSignal?.aborted) {
          ctrl.close();
          return;
        }

        const res = await fetchPinned(url, {
          method: 'POST',
          headers,
          body,
          signal: upstreamController.signal,
          redirect: 'error',
        }, options.addresses ?? []);

        if (!res.ok || !res.body) {
          stopKeepalive();
          const limited = await readLimitedText(res, 64 * 1024).catch(() => ({ text: '' }) as const);
          const text = 'tooLarge' in limited ? '(upstream error body too large)' : limited.text;
          const payload = JSON.stringify({ error: true, status: res.status, message: text });
          // Non-SSE consumers expect a plain JSON body; an SSE frame would
          // corrupt their parse.
          ctrl.enqueue(encoder.encode(options.sseExpected ? `data: ${payload}\n\n` : payload));
          ctrl.close();
          return;
        }

        const reader = res.body.getReader();
        while (true) {
          if (requestSignal?.aborted) {
            await reader.cancel().catch(() => {});
            break;
          }
          const { done, value } = await reader.read();
          if (done) break;
          // First upstream byte received; keepalive is only needed while waiting.
          stopKeepalive();
          if (requestSignal?.aborted) {
            await reader.cancel().catch(() => {});
            break;
          }
          ctrl.enqueue(value);
        }
        ctrl.close();
      } catch (err: unknown) {
        if (requestSignal?.aborted) {
          try { ctrl.close(); } catch { /* already closed */ }
          return;
        }
        const msg = err instanceof Error && err.name === 'AbortError'
          ? `上游请求超时 (${TIMEOUT_SEC}s)`
          : `代理连接失败: ${(err as Error).message}`;
        try {
          const payload = JSON.stringify({ error: true, status: 502, message: msg });
          ctrl.enqueue(encoder.encode(options.sseExpected ? `data: ${payload}\n\n` : payload));
          ctrl.close();
        } catch { /* already closed */ }
      } finally {
        stopKeepalive();
        clearTimeout(timeoutId);
        if (requestSignal) {
          requestSignal.removeEventListener('abort', abortUpstream);
        }
      }
    },
  });

  const responseHeaders: Record<string, string> = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  };
  if (isAllowedCorsOrigin(origin)) {
    responseHeaders['Access-Control-Allow-Origin'] = origin;
    responseHeaders.Vary = 'Origin';
  }

  return new Response(stream, {
    status: 200,
    headers: responseHeaders,
  });
}

/** Proxy a JSON request body as a streaming response with keepalive. */
export async function proxyUpstreamStream(
  baseUrl: string,
  apiKey: string,
  path: string,
  body: string,
  origin: string,
  requestSignal?: AbortSignal,
  options: Omit<UpstreamProxyOptions, 'contentType'> = {},
): Promise<Response> {
  return proxyUpstreamBodyStream(
    baseUrl,
    apiKey,
    path,
    body,
    origin,
    requestSignal,
    {
      ...options,
      contentType: 'application/json',
    },
  );
}

/** Proxy multipart form data without overriding the generated boundary. */
export async function proxyUpstreamFormDataStream(
  baseUrl: string,
  apiKey: string,
  path: string,
  body: FormData,
  origin: string,
  requestSignal?: AbortSignal,
  options: Pick<UpstreamProxyOptions, 'sseExpected' | 'addresses'> = {},
): Promise<Response> {
  return proxyUpstreamBodyStream(baseUrl, apiKey, path, body, origin, requestSignal, options);
}
