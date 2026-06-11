import { NextRequest, NextResponse } from 'next/server';
import { validateRequest, proxyUpstream, proxyUpstreamStream } from '@/lib/server-proxy';

export async function POST(request: NextRequest) {
  const validated = validateRequest(request);
  if (validated instanceof NextResponse) return validated;

  try {
    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const body = await request.json();
      const origin = request.headers.get('origin') || '';

      if (body.stream) {
        return await proxyUpstreamStream(
          validated.baseUrl, validated.apiKey,
          '/v1/images/edits', JSON.stringify(body), origin,
        );
      }

      return await proxyUpstream(
        validated.baseUrl, validated.apiKey,
        '/v1/images/edits', JSON.stringify(body),
        origin, 'application/json',
      );
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json(
        { error: { message: '无法解析 multipart 请求体' } },
        { status: 400 }
      );
    }

    const proxyForm = new FormData();
    for (const [key, value] of formData.entries()) {
      if (value instanceof File) {
        proxyForm.append(key, value, value.name);
      } else {
        proxyForm.append(key, value as string);
      }
    }

    return await proxyUpstream(
      validated.baseUrl, validated.apiKey,
      '/v1/images/edits', proxyForm,
      request.headers.get('origin') || '',
    );
  } catch (err: unknown) {
    return NextResponse.json(
      { error: { message: (err as Error).message || '代理请求失败' } },
      { status: 502 }
    );
  }
}
