import { describe, it, expect } from 'vitest';
import { extractOpenAIStreamDelta, extractClaudeStreamDelta, processChatStream } from '@/lib/stream-utils';

function streamFromText(text: string) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

describe('stream-utils', () => {
  it('extractOpenAIStreamDelta extracts text correctly', () => {
    const data = {
      choices: [{
        delta: { content: 'hello world' }
      }]
    };
    const delta = extractOpenAIStreamDelta(data);
    expect(delta.text).toBe('hello world');
  });

  it('extractOpenAIStreamDelta extracts thinking correctly', () => {
    const data = {
      choices: [{
        delta: { reasoning_content: 'thinking process' }
      }]
    };
    const delta = extractOpenAIStreamDelta(data);
    expect(delta.thinking).toBe('thinking process');
  });

  it('extractClaudeStreamDelta extracts text correctly', () => {
    const data = {
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: 'claude response' }
    };
    const delta = extractClaudeStreamDelta(data);
    expect(delta.text).toBe('claude response');
  });

  it('processChatStream coalesces rapid deltas and flushes the final state', async () => {
    const events = [
      'data: {"choices":[{"delta":{"content":"hello"}}]}',
      '',
      'data: {"choices":[{"delta":{"content":" world"}}]}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');
    const updates: string[] = [];

    const result = await processChatStream(
      streamFromText(events),
      (parts) => updates.push(parts.text),
      'openai',
      undefined,
      { minEmitIntervalMs: 10_000 },
    );

    expect(result.text).toBe('hello world');
    expect(updates).toEqual(['hello', 'hello world']);
  });
});
