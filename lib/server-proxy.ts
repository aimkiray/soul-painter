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

    // Log outgoing request
    const bodyInfo = body instanceof FormData
      ? `FormData(${[...body.entries()].map(([k, v]) => `${k}=${v instanceof Blob ? `Blob(${v.size}bytes,${v.type})` : v}`).join(', ')})`
      : typeof body === 'string' ? body.slice(0, 200) : String(body).slice(0, 200);
    console.log(`[proxy] POST ${url}`);
    console.log(`[proxy] Content-Type: ${contentType || '(auto)'}`);
    console.log(`[proxy] Body: ${bodyInfo}`);

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

/** Proxy a streaming fetch to upstream — pipes SSE directly back to client */
export async function proxyUpstreamStream(
  baseUrl: string,
  apiKey: string,
  path: string,
  body: string,
  origin: string,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_SEC * 1000);

  try {
    const url = `${baseUrl}${path}`;
    console.log(`[proxy-stream] POST ${url}`);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body,
      signal: controller.signal,
    });

    if (!res.ok || !res.body) {
      const text = await res.text();
      clearTimeout(timeoutId);
      return new Response(text, {
        status: res.status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': origin,
        },
      });
    }

    const stream = res.body;
    return new Response(stream as unknown as ReadableStream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': origin,
      },
    });
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      return new Response(JSON.stringify({ error: { message: `上游请求超时 (${TIMEOUT_SEC}s)` } }), {
        status: 504,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: { message: `代理连接失败: ${(err as Error).message}` } }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
