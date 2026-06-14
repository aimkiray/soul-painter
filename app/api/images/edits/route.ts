import { NextRequest, NextResponse } from 'next/server';
import { validateRequest, proxyUpstreamFormDataStream } from '@/lib/server-proxy';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

function dataUrlToBlob(dataUrl: string): { blob: Blob; mime: string } {
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!match) throw new Error('图片数据格式无效');

  const mime = match[1] || 'image/png';
  const isBase64 = !!match[2];
  const data = match[3] || '';
  const binary = isBase64 ? atob(data) : decodeURIComponent(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { blob: new Blob([bytes], { type: mime }), mime };
}

function extensionForMime(mime: string): string {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';
  return 'png';
}

function appendImage(form: FormData, field: string, value: string, index: number) {
  const { blob, mime } = dataUrlToBlob(value);
  form.append(field, blob, `${field}-${index}.${extensionForMime(mime)}`);
}

function buildMultipartForm(body: Record<string, unknown>): FormData {
  const form = new FormData();
  const images = Array.isArray(body.images) ? body.images : [];
  let imageCount = 0;

  for (const item of images) {
    const record = item as Record<string, unknown>;
    const value = record?.image_url || record?.dataUrl || record?.url;
    if (typeof value === 'string' && value.startsWith('data:')) {
      appendImage(form, 'image[]', value, imageCount);
      imageCount++;
    }
  }

  if (imageCount === 0) throw new Error('未找到可上传的图片数据');

  if (typeof body.mask === 'string' && body.mask.startsWith('data:')) {
    appendImage(form, 'mask', body.mask, 0);
  }

  for (const [key, value] of Object.entries(body)) {
    if (key === 'images' || key === 'mask' || value === undefined || value === null) continue;
    if (Array.isArray(value) || typeof value === 'object') continue;
    form.append(key, String(value));
  }

  return form;
}

export async function POST(request: NextRequest) {
  const validated = await validateRequest(request);
  if (validated instanceof NextResponse) return validated;

  try {
    const origin = request.headers.get('origin') || '';
    const contentType = request.headers.get('content-type') || '';
    const form = contentType.includes('multipart/form-data')
      ? await request.formData()
      : buildMultipartForm(await request.json());

    return await proxyUpstreamFormDataStream(
      validated.baseUrl, validated.apiKey,
      '/v1/images/edits', form, origin,
      request.signal,
    );
  } catch (err: unknown) {
    return NextResponse.json(
      { error: { message: (err as Error).message || '代理请求失败' } },
      { status: 502 }
    );
  }
}
