import { NextRequest, NextResponse } from 'next/server';
import { isModelGateEnabled } from '@/lib/model-gate-env';
import { getServerModelConfig } from '@/lib/server-model-config';
import { hasServerAccessToken, serverDefaultAccessRequired } from '@/lib/server-access';
import { checkRateLimit, clientIp } from '@/lib/rate-limit';

// Config reads per IP per minute — this endpoint is polled by every client.
const CONFIG_RATE_LIMIT = 120;
const CONFIG_RATE_WINDOW_MS = 60_000;

export async function GET(request: NextRequest) {
  if (!checkRateLimit(`config:${clientIp(request)}`, CONFIG_RATE_LIMIT, CONFIG_RATE_WINDOW_MS)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }
  return NextResponse.json({
    ...getServerModelConfig(),
    // The default*BaseUrl fields only expose operator-provided env values —
    // never hardcoded internal hosts — so what they reveal is the deployer's
    // choice (they are public service URLs by design). Each is empty when the
    // corresponding env var is unset.
    defaultBaseUrl: process.env.DEFAULT_BASE_URL || '',
    hasDefaultKey: !!process.env.DEFAULT_API_KEY,
    defaultChatBaseUrl: process.env.DEFAULT_CHAT_BASE_URL || process.env.DEFAULT_BASE_URL || '',
    hasDefaultChatKey: !!(process.env.DEFAULT_CHAT_API_KEY || process.env.DEFAULT_API_KEY),
    defaultClaudeBaseUrl: process.env.DEFAULT_CLAUDE_BASE_URL || process.env.DEFAULT_CHAT_BASE_URL || process.env.DEFAULT_BASE_URL || '',
    hasDefaultClaudeKey: !!(process.env.DEFAULT_CLAUDE_API_KEY || process.env.DEFAULT_CHAT_API_KEY || process.env.DEFAULT_API_KEY),
    serverAccessRequired: serverDefaultAccessRequired(),
    serverAccessConfigured: hasServerAccessToken(),
    modelGateEnabled: isModelGateEnabled(),
  });
}
