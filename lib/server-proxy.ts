import { NextRequest, NextResponse } from 'next/server';

export const TIMEOUT_SEC = 600;
export const MAX_BODY_SIZE = 10 * 1024 * 1024;

export interface ValidatedRequest {
  apiKey: string;
  baseUrl: string;
}

/** Validate API key, base URL, and body size. Returns validated values or an error Response. */
export function validateRequest(request: NextRequest): ValidatedRequest | NextResponse {
  const apiKey = request.headers.get('x-api-key') || process.env.DEFAULT_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: { message: '未配置 API Key。请在设置中填写，或在服务端 .env 中设置 DEFAULT_API_KEY。' } },
      { status: 401 }
    );
  }

  const baseUrl = (request.headers.get('x-base-url') || process.env.DEFAULT_BASE_URL || '').replace(/\/+$/, '');
  if (!baseUrl || !/^https?:\/\/[\w.-]+(:\d+)?$/.test(baseUrl)) {
    return NextResponse.json(
      { error: { message: 'Base URL 无效或未配置。仅允许 http/https 协议。' } },
      { status: 400 }
    );
  }

  const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
  if (contentLength > MAX_BODY_SIZE) {
    return NextResponse.json(
      { error: { message: `请求体 ${(contentLength / 1024 / 1024).toFixed(1)}MB 超过上限 10MB` } },
      { status: 413 }
    );
  }

  return { apiKey, baseUrl };
}

/** Proxy a fetch to the upstream API with timeout and CORS headers */
export async function proxyUpstream(
  baseUrl: string,
  apiKey: string,
  path: string,
  body: BodyInit,
  origin: string,
  contentType?: string,
): Promise<NextResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_SEC * 1000);

  try {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json',
    };
    if (contentType) {
      headers['Content-Type'] = contentType;
    }

    const url = `${baseUrl}${path}`;
    console.log(`[proxy] POST ${url}`);

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });

    const responseBody = await res.text();
    const responseType = res.headers.get('content-type') || 'application/json';
    console.log(`[proxy] Response: ${res.status} ${res.statusText} (${responseBody.length} bytes)`);

    return new NextResponse(responseBody, {
      status: res.status,
      headers: {
        'Content-Type': responseType,
        'Access-Control-Allow-Origin': origin,
      },
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      return NextResponse.json(
        { error: { message: `上游请求超时 (${TIMEOUT_SEC}s)` } },
        { status: 504 }
      );
    }
    return NextResponse.json(
      { error: { message: `代理连接失败: ${(err as Error).message}` } },
      { status: 502 }
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Proxy a streaming fetch to upstream — pipes SSE with keepalive to prevent CDN timeout */
export async function proxyUpstreamStream(
  baseUrl: string,
  apiKey: string,
  path: string,
  body: string,
  origin: string,
  requestSignal?: AbortSignal,
): Promise<Response> {
  const url = `${baseUrl}${path}`;
  console.log(`[proxy-stream] POST ${url}`);

  const stream = new ReadableStream({
    async start(ctrl) {
      const encoder = new TextEncoder();
      const upstreamController = new AbortController();
      const timeoutId = setTimeout(() => upstreamController.abort(), TIMEOUT_SEC * 1000);

      if (requestSignal) {
        requestSignal.addEventListener('abort', () => upstreamController.abort());
      }

      const keepalive = setInterval(() => {
        try { ctrl.enqueue(encoder.encode(': keepalive\n\n')); } catch { /* closed */ }
      }, 25_000);
      try { ctrl.enqueue(encoder.encode(': keepalive\n\n')); } catch { /* closed */ }

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
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
          const { done, value } = await reader.read();
          if (done) break;
          ctrl.enqueue(value);
        }
        ctrl.close();
      } catch (err: unknown) {
        clearInterval(keepalive);
        clearTimeout(timeoutId);
        const msg = err instanceof Error && err.name === 'AbortError'
          ? `上游请求超时 (${TIMEOUT_SEC}s)`
          : `代理连接失败: ${(err as Error).message}`;
        try {
          ctrl.enqueue(encoder.encode(`data: ${JSON.stringify({ error: true, status: 502, message: msg })}\n\n`));
          ctrl.close();
        } catch { /* already closed */ }
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
