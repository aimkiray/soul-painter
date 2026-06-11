import { NextRequest, NextResponse } from 'next/server';
import { validateRequest, proxyUpstream } from '@/lib/server-proxy';
import { convertResponseImages, ImageFormat } from '@/lib/image-convert';

export async function POST(request: NextRequest) {
  const validated = validateRequest(request);
  if (validated instanceof NextResponse) return validated;

  try {
    const body = await request.json();

    const outputFormat = (body.output_format || 'webp') as ImageFormat;
    const outputCompression = parseInt(body.output_compression, 10) || 80;
    delete body.output_format;
    delete body.output_compression;

    const res = await proxyUpstream(
      validated.baseUrl, validated.apiKey,
      '/v1/images/generations', JSON.stringify(body),
      request.headers.get('origin') || '', 'application/json',
    );

    if (res.status === 200 && outputFormat !== 'webp') {
      const text = await res.text();
      const converted = await convertResponseImages(text, outputFormat, outputCompression);
      return new NextResponse(converted, {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': request.headers.get('origin') || '',
        },
      });
    }

    return res;
  } catch (err: unknown) {
    return NextResponse.json(
      { error: { message: (err as Error).message || '代理请求失败' } },
      { status: 502 }
    );
  }
}
