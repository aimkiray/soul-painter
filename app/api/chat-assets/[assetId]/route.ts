import { NextRequest, NextResponse } from 'next/server';
import {
  CHAT_ASSET_CACHE_MAX_AGE_SECONDS,
  isValidChatAssetId,
  readChatAsset,
} from '@/lib/chat-assets';
import {
  getChatAssetSession,
  setChatAssetSession,
} from '@/lib/chat-asset-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ assetId: string }> },
) {
  const { assetId } = await context.params;
  if (!isValidChatAssetId(assetId)) {
    return NextResponse.json({ error: 'Invalid asset id' }, { status: 404 });
  }

  try {
    const session = await getChatAssetSession(request);
    const { bytes, mime } = await readChatAsset(session.id, assetId);
    const response = new NextResponse(bytes, {
      headers: {
        'Content-Type': mime,
        'Cache-Control': `private, max-age=${CHAT_ASSET_CACHE_MAX_AGE_SECONDS}`,
        'Vary': 'Cookie',
        'X-Content-Type-Options': 'nosniff',
      },
    });
    setChatAssetSession(response, session, request);
    return response;
  } catch {
    return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
  }
}
