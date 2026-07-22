import { NextRequest, NextResponse } from 'next/server';
import { corsPreflightResponse, validateRequest, proxyUpstreamStream } from '@/lib/server-proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const OPTIONS = corsPreflightResponse;

export async function POST(request: NextRequest) {
  const validated = await validateRequest(request);
  if (validated instanceof NextResponse) return validated;

  try {
    const body = await request.json();
    const origin = request.headers.get('origin') || '';

    return await proxyUpstreamStream(
      validated.baseUrl, validated.apiKey,
      '/images/generations', JSON.stringify(body), origin,
      request.signal,
    );
  } catch (err: unknown) {
    return NextResponse.json(
      { error: { message: (err as Error).message || '代理请求失败' } },
      { status: 502 }
    );
  }
}
