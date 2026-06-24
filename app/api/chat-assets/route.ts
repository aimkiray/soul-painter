import { NextRequest, NextResponse } from 'next/server';
import {
  CHAT_ASSET_MAX_BODY_BYTES,
  clearChatAssets,
  resolveChatAsset,
} from '@/lib/chat-assets';
import {
  clearChatAssetSession,
  getChatAssetSession,
  setChatAssetSession,
} from '@/lib/chat-asset-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > CHAT_ASSET_MAX_BODY_BYTES) {
      throw new Error('Image request is too large');
    }

    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    if (body.action === 'clear-session') {
      const response = NextResponse.json({ ok: true });
      clearChatAssetSession(response, request);
      return response;
    }

    const image = typeof body.image === 'string' ? body.image : '';
    const url = typeof body.url === 'string' ? body.url : '';
    const session = await getChatAssetSession(request);
    const asset = await resolveChatAsset(session.id, image ? { dataUrl: image } : { url });
    const response = NextResponse.json(asset);
    setChatAssetSession(response, session, request);
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to save chat asset' },
      { status: 400 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const session = await getChatAssetSession(request);
  await clearChatAssets(session.id);
  const response = NextResponse.json({ ok: true });
  clearChatAssetSession(response, request);
  return response;
}
