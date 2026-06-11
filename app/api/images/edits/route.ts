import { NextRequest, NextResponse } from 'next/server';
import { validateRequest, proxyUpstream } from '@/lib/server-proxy';
import { convertResponseImages, ImageFormat } from '@/lib/image-convert';

export async function POST(request: NextRequest) {
  const validated = validateRequest(request);
  if (validated instanceof NextResponse) return validated;

  try {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json(
        { error: { message: '无法解析 multipart 请求体' } },
        { status: 400 }
      );
    }

    const outputFormat = (formData.get('output_format') as string || 'webp') as ImageFormat;
    const outputCompression = parseInt(formData.get('output_compression') as string, 10) || 80;
    formData.delete('output_format');
    formData.delete('output_compression');

    const proxyForm = new FormData();
    for (const [key, value] of formData.entries()) {
      if (value instanceof File) {
        proxyForm.append(key, value, value.name);
      } else {
        proxyForm.append(key, value as string);
      }
    }

    const res = await proxyUpstream(
      validated.baseUrl, validated.apiKey,
      '/v1/images/edits', proxyForm,
      request.headers.get('origin') || '',
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
