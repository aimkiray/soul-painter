import { NextRequest, NextResponse } from 'next/server';
import { validateRequest, proxyUpstream } from '@/lib/server-proxy';

export async function POST(request: NextRequest) {
  const validated = validateRequest(request);
  if (validated instanceof NextResponse) return validated;

  try {
    const body = await request.json();
    return await proxyUpstream(
      validated.baseUrl, validated.apiKey,
      '/v1/images/generations', JSON.stringify(body),
      request.headers.get('origin') || '', 'application/json',
    );
  } catch (err: unknown) {
    return NextResponse.json(
      { error: { message: (err as Error).message || '代理请求失败' } },
      { status: 502 }
    );
  }
}
