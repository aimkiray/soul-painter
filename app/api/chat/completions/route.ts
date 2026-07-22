import { NextRequest, NextResponse } from 'next/server';
import { corsPreflightResponse, validateRequest, proxyUpstreamStream } from '@/lib/server-proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const OPTIONS = corsPreflightResponse;

type ChatApiFormat = 'openai' | 'claude';

function getChatApiFormat(request: NextRequest): ChatApiFormat {
  return request.headers.get('x-chat-api-format') === 'claude' ? 'claude' : 'openai';
}

function stringifyMessageContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
          return part.text;
        }
        return '';
      })
      .join('');
  }
  return value == null ? '' : String(value);
}

function toClaudeMessagesBody(body: Record<string, unknown>) {
  const sourceMessages = Array.isArray(body.messages) ? body.messages : [];
  const systemParts: string[] = [];
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const item of sourceMessages) {
    if (!item || typeof item !== 'object') continue;
    const role = 'role' in item && typeof item.role === 'string' ? item.role : '';
    const content = stringifyMessageContent('content' in item ? item.content : '').trim();
    if (!content) continue;

    if (role === 'system' || role === 'developer') {
      systemParts.push(content);
    } else if (role === 'user' || role === 'assistant') {
      messages.push({ role, content });
    }
  }

  const maxTokens = Number(body.max_tokens ?? body.maxTokens ?? 4096);
  const claudeBody: Record<string, unknown> = {
    model: body.model,
    messages,
    max_tokens: Number.isFinite(maxTokens) && maxTokens > 0 ? Math.floor(maxTokens) : 4096,
  };

  if (body.stream !== undefined) claudeBody.stream = Boolean(body.stream);
  if (systemParts.length > 0) claudeBody.system = systemParts.join('\n\n');
  if (body.temperature !== undefined) claudeBody.temperature = body.temperature;
  if (body.top_p !== undefined) claudeBody.top_p = body.top_p;
  if (Array.isArray(body.stop)) claudeBody.stop_sequences = body.stop;
  else if (typeof body.stop === 'string' && body.stop) claudeBody.stop_sequences = [body.stop];

  return claudeBody;
}

export async function POST(request: NextRequest) {
  const format = getChatApiFormat(request);
  const validated = await validateRequest(request, format === 'claude' ? 'claude' : 'chat');
  if (validated instanceof NextResponse) return validated;

  try {
    const body = await request.json();
    const origin = request.headers.get('origin') || '';
    const recordBody = body && typeof body === 'object' && !Array.isArray(body)
      ? body as Record<string, unknown>
      : {};
    const upstreamPath = format === 'claude' ? '/messages' : '/chat/completions';
    const upstreamBody = format === 'claude'
      ? toClaudeMessagesBody(recordBody)
      : body;

    return await proxyUpstreamStream(
      validated.baseUrl, validated.apiKey,
      upstreamPath, JSON.stringify(upstreamBody), origin,
      request.signal,
      format === 'claude' ? { authMode: 'anthropic' } : undefined,
    );
  } catch (err: unknown) {
    return NextResponse.json(
      { error: { message: (err as Error).message || '代理请求失败' } },
      { status: 502 }
    );
  }
}
