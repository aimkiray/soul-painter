import { NextRequest, NextResponse } from 'next/server';
import { validateRequest, proxyUpstreamStream } from '@/lib/server-proxy';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const validated = await validateRequest(request, 'chat');
  if (validated instanceof NextResponse) return validated;

  try {
    const body = await request.json();
    const origin = request.headers.get('origin') || '';

    return await proxyUpstreamStream(
      validated.baseUrl, validated.apiKey,
      '/v1/chat/completions', JSON.stringify(body), origin,
      request.signal,
    );
  } catch (err: unknown) {
    return NextResponse.json(
      { error: { message: (err as Error).message || '代理请求失败' } },
      { status: 502 }
    );
  }
}
