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
import { readLimitedText } from '@/lib/limited-body';
import { checkRateLimit, clientIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CHAT_ASSET_RATE_LIMIT = 120;
const CHAT_ASSET_RATE_WINDOW_MS = 60_000;

function tooLargeResponse() {
  return NextResponse.json({ error: 'Image request is too large' }, { status: 413 });
}

export async function POST(request: NextRequest) {
  if (!checkRateLimit(`chat-assets:${clientIp(request)}`, CHAT_ASSET_RATE_LIMIT, CHAT_ASSET_RATE_WINDOW_MS)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  try {
    const contentLength = Number(request.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > CHAT_ASSET_MAX_BODY_BYTES) {
      return tooLargeResponse();
    }

    const limited = await readLimitedText(request, CHAT_ASSET_MAX_BODY_BYTES);
    if ('tooLarge' in limited) return tooLargeResponse();
    let body: Record<string, unknown> = {};
    try {
      const parsed = limited.text ? JSON.parse(limited.text) : {};
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        body = parsed as Record<string, unknown>;
      }
    } catch {
      body = {};
    }

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
