import type { ChatApiFormat } from '@/lib/chat-config';
import { ChatContentParts, composeChatContentParts } from '@/lib/chat-thinking';
import { USER_ABORT_SENTINEL } from '@/lib/api';
import { isRecord, stringifyTextContent } from '@/lib/api-parsers';

export interface ChatStreamDelta {
  text: string;
  thinking: string;
}

export const CHAT_STREAM_EMIT_INTERVAL_MS = 16;

export interface ChatStreamOptions {
  minEmitIntervalMs?: number;
}

export function getStreamEventError(evt: unknown, eventType: string): string | null {
  if (!isRecord(evt)) return eventType === 'error' ? '流式响应返回错误事件' : null;
  if (!evt.error && eventType !== 'error') return null;

  if (isRecord(evt.error)) {
    const message = typeof evt.error.message === 'string' ? evt.error.message : '';
    const type = typeof evt.error.type === 'string' ? evt.error.type : '';
    return message || type || '流式响应返回错误事件';
  }
  if (typeof evt.error === 'string' && evt.error.trim()) return evt.error;
  if (typeof evt.message === 'string' && evt.message.trim()) return evt.message;
  if (typeof evt.status === 'number') return `HTTP ${evt.status}`;
  return '流式响应返回错误事件';
}

export function extractOpenAIStreamDelta(evt: unknown): ChatStreamDelta {
  if (!isRecord(evt) || !Array.isArray(evt.choices)) return { text: '', thinking: '' };
  const choice = evt.choices[0];
  if (!isRecord(choice) || !isRecord(choice.delta)) return { text: '', thinking: '' };
  return {
    text: stringifyTextContent(choice.delta.content),
    thinking: stringifyTextContent(
      choice.delta.reasoning_content
      ?? choice.delta.reasoning
      ?? choice.delta.thinking
      ?? choice.delta.thoughts,
    ),
  };
}

export function extractClaudeStreamDelta(evt: unknown): ChatStreamDelta {
  if (!isRecord(evt) || evt.type !== 'content_block_delta' || !isRecord(evt.delta)) {
    return { text: '', thinking: '' };
  }
  if (evt.delta.type === 'text_delta') {
    return { text: typeof evt.delta.text === 'string' ? evt.delta.text : '', thinking: '' };
  }
  if (evt.delta.type === 'thinking_delta') {
    return { text: '', thinking: typeof evt.delta.thinking === 'string' ? evt.delta.thinking : '' };
  }
  return { text: '', thinking: '' };
}

export async function processChatStream(
  stream: ReadableStream<Uint8Array>,
  onDelta: (parts: ChatContentParts) => void,
  format: ChatApiFormat = 'openai',
  signal?: AbortSignal,
  options?: ChatStreamOptions,
): Promise<ChatContentParts> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let thinkingText = '';
  let hasStructuredThinking = false;
  let structuredThinkingDone = true;
  const minEmitIntervalMs = Math.max(0, options?.minEmitIntervalMs ?? CHAT_STREAM_EMIT_INTERVAL_MS);
  let lastEmitAt = 0;
  let pendingParts: ChatContentParts | null = null;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;

  const cancelReader = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener('abort', cancelReader, { once: true });

  const emitNow = (parts: ChatContentParts) => {
    lastEmitAt = Date.now();
    onDelta(parts);
  };

  const emitLatest = () => {
    if (!pendingParts) return;
    const nextParts = pendingParts;
    pendingParts = null;
    emitNow(nextParts);
  };

  const scheduleDelta = (parts: ChatContentParts) => {
    if (minEmitIntervalMs <= 0) {
      emitNow(parts);
      return;
    }

    const now = Date.now();
    pendingParts = parts;
    if (lastEmitAt === 0 || now - lastEmitAt >= minEmitIntervalMs) {
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
      }
      emitLatest();
      return;
    }

    if (!pendingTimer) {
      pendingTimer = setTimeout(() => {
        pendingTimer = null;
        emitLatest();
      }, minEmitIntervalMs - (now - lastEmitAt));
    }
  };

  const flushDelta = () => {
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
    emitLatest();
  };

  const processBlock = (block: string): boolean => {
    let eventType = 'message';
    const dataLines: string[] = [];

    for (const line of block.split(/\r\n|\r|\n/)) {
      if (line.startsWith('event:')) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        const value = line.slice(5);
        dataLines.push(value.startsWith(' ') ? value.slice(1) : value);
      }
    }

    const data = dataLines.join('\n');
    if (data === '[DONE]' || eventType === 'message_stop') return true;
    if (!data) return false;

    try {
      const evt = JSON.parse(data);
      const eventError = getStreamEventError(evt, eventType);
      if (eventError) throw new Error(eventError);

      const delta = format === 'claude'
        ? extractClaudeStreamDelta(evt)
        : extractOpenAIStreamDelta(evt);
      if (delta.thinking) {
        hasStructuredThinking = true;
        structuredThinkingDone = false;
        thinkingText += delta.thinking;
      }
      if (delta.text) {
        if (hasStructuredThinking) structuredThinkingDone = true;
        fullText += delta.text;
      }
      if (delta.text || delta.thinking) {
        scheduleDelta(composeChatContentParts(fullText, thinkingText, structuredThinkingDone));
      }
    } catch (e) {
      if (e instanceof SyntaxError) {
        if (eventType === 'error') {
          throw new Error(`流式响应返回错误事件${data ? `：${data.slice(0, 200)}` : ''}`);
        }
        return false;
      }
      if (e instanceof Error) throw e.message ? e : new Error('流式响应返回错误事件');
    }

    return false;
  };

  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel().catch(() => {});
        throw new Error(USER_ABORT_SENTINEL);
      }
      const { done, value } = await reader.read();
      if (signal?.aborted) throw new Error(USER_ABORT_SENTINEL);
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() || '';

      for (const block of blocks) {
        if (processBlock(block)) {
          flushDelta();
          return composeChatContentParts(fullText, thinkingText, true);
        }
      }
    }

    const tail = decoder.decode();
    if (tail) buffer += tail;
    if (buffer.trim() && processBlock(buffer)) {
      flushDelta();
      return composeChatContentParts(fullText, thinkingText, true);
    }
  } finally {
    flushDelta();
    signal?.removeEventListener('abort', cancelReader);
  }
  return composeChatContentParts(fullText, thinkingText, true);
}

