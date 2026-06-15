import { NextRequest, NextResponse } from 'next/server';
import {
  CHAT_ASSET_MAX_BODY_BYTES,
  clearChatAssets,
  getChatAssetSession,
  resolveChatAsset,
  setChatAssetSession,
} from '@/lib/chat-assets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > CHAT_ASSET_MAX_BODY_BYTES) {
      throw new Error('Image request is too large');
    }

    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const image = typeof body.image === 'string' ? body.image : '';
    const url = typeof body.url === 'string' ? body.url : '';
    const sessionId = getChatAssetSession(request);
    const asset = await resolveChatAsset(sessionId, image ? { dataUrl: image } : { url });
    const response = NextResponse.json(asset);
    setChatAssetSession(response, sessionId, request);
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to save chat asset' },
      { status: 400 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const sessionId = getChatAssetSession(request);
  await clearChatAssets(sessionId);
  const response = NextResponse.json({ ok: true });
  setChatAssetSession(response, sessionId, request);
  return response;
}
