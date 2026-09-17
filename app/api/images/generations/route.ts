import { NextRequest, NextResponse } from 'next/server';
import { corsPreflightResponse, validateRequest, proxyUpstreamStream, MAX_BODY_SIZE } from '@/lib/server-proxy';
import { readLimitedText } from '@/lib/limited-body';
import { checkRateLimit, clientIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Proxied upstream calls cost money: cap requests per IP per minute before any
// body is read. The `proxy:` bucket is shared with the other proxy routes.
const PROXY_RATE_LIMIT = 30;
const PROXY_RATE_WINDOW_MS = 60_000;

export const OPTIONS = corsPreflightResponse;

export async function POST(request: NextRequest) {
  if (!checkRateLimit(`proxy:${clientIp(request)}`, PROXY_RATE_LIMIT, PROXY_RATE_WINDOW_MS)) {
    return NextResponse.json({ error: { message: '请求过于频繁，请稍后再试' } }, { status: 429 });
  }
  const validated = await validateRequest(request);
  if (validated instanceof NextResponse) return validated;

  try {
    const limited = await readLimitedText(request, MAX_BODY_SIZE);
    if ('tooLarge' in limited) {
      return NextResponse.json(
        { error: { message: '请求体超过上限 32MB' } },
        { status: 413 },
      );
    }
    let body: unknown;
    try {
      body = limited.text ? JSON.parse(limited.text) : {};
    } catch {
      return NextResponse.json(
        { error: { message: '请求 JSON 格式错误' } },
        { status: 400 },
      );
    }
    const origin = request.headers.get('origin') || '';

    return await proxyUpstreamStream(
      validated.baseUrl, validated.apiKey,
      '/images/generations', JSON.stringify(body), origin,
      request.signal,
      {
        addresses: validated.addresses,
        sseExpected: !!body && typeof body === 'object' && !Array.isArray(body)
          && (body as Record<string, unknown>).stream === true,
      },
    );
  } catch (err: unknown) {
    return NextResponse.json(
      { error: { message: (err as Error).message || '代理请求失败' } },
      { status: 502 }
    );
  }
}
