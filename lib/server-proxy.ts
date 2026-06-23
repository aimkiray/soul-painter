import { NextRequest, NextResponse } from 'next/server';
import {
  getRandomModelGateMessage,
  MODEL_GATE_UNLOCKED_COOKIE,
  verifyModelGateUnlockToken,
} from './model-gate';
import { isModelGateEnabled } from './model-gate-env';

export const TIMEOUT_SEC = 600;
export const MAX_BODY_SIZE = 32 * 1024 * 1024;

export interface ValidatedRequest {
  apiKey: string;
  baseUrl: string;
}

type UpstreamAuthMode = 'bearer' | 'anthropic';

interface UpstreamProxyOptions {
  authMode?: UpstreamAuthMode;
  contentType?: string;
}

type RequestKind = 'image' | 'chat' | 'claude';

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

  const apiKey = request.headers.get('x-api-key') || keyEnv;
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

  const baseUrl = (request.headers.get('x-base-url') || urlEnv || '').replace(/\/+$/, '');
  if (!baseUrl || !/^https?:\/\/[\w.-]+(:\d+)?$/.test(baseUrl)) {
    return NextResponse.json(
      { error: { message: 'Base URL 无效或未配置。仅允许 http/https 协议。' } },
      { status: 400 }
    );
  }

  const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
  if (contentLength > MAX_BODY_SIZE) {
    return NextResponse.json(
      { error: { message: `请求体 ${(contentLength / 1024 / 1024).toFixed(1)}MB 超过上限 32MB` } },
      { status: 413 }
    );
  }

  return { apiKey, baseUrl };
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
  const url = `${baseUrl}${path}`;
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

      const keepalive = setInterval(() => {
        try { ctrl.enqueue(encoder.encode(': keepalive\n\n')); } catch { /* closed */ }
      }, 25_000);
      try { ctrl.enqueue(encoder.encode(': keepalive\n\n')); } catch { /* closed */ }

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

        const res = await fetch(url, {
          method: 'POST',
          headers,
          body,
          signal: upstreamController.signal,
        });

        clearInterval(keepalive);
        clearTimeout(timeoutId);

        if (!res.ok || !res.body) {
          const text = await res.text();
          ctrl.enqueue(encoder.encode(`data: ${JSON.stringify({ error: true, status: res.status, message: text })}\n\n`));
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
          if (requestSignal?.aborted) {
            await reader.cancel().catch(() => {});
            break;
          }
          ctrl.enqueue(value);
        }
        ctrl.close();
      } catch (err: unknown) {
        clearInterval(keepalive);
        clearTimeout(timeoutId);
        if (requestSignal?.aborted) {
          try { ctrl.close(); } catch { /* already closed */ }
          return;
        }
        const msg = err instanceof Error && err.name === 'AbortError'
          ? `上游请求超时 (${TIMEOUT_SEC}s)`
          : `代理连接失败: ${(err as Error).message}`;
        try {
          ctrl.enqueue(encoder.encode(`data: ${JSON.stringify({ error: true, status: 502, message: msg })}\n\n`));
          ctrl.close();
        } catch { /* already closed */ }
      } finally {
        if (requestSignal) {
          requestSignal.removeEventListener('abort', abortUpstream);
        }
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': origin,
    },
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
): Promise<Response> {
  return proxyUpstreamBodyStream(baseUrl, apiKey, path, body, origin, requestSignal);
}
