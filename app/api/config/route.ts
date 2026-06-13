import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    defaultBaseUrl: process.env.DEFAULT_BASE_URL || '',
    hasDefaultKey: !!process.env.DEFAULT_API_KEY,
    defaultChatBaseUrl: process.env.DEFAULT_CHAT_BASE_URL || process.env.DEFAULT_BASE_URL || '',
    hasDefaultChatKey: !!(process.env.DEFAULT_CHAT_API_KEY || process.env.DEFAULT_API_KEY),
  });
}
