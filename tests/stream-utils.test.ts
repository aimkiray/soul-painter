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

  it('processChatStream parses CRLF-delimited events', async () => {
    const events =
      'data: {"choices":[{"delta":{"content":"hello"}}]}\r\n\r\n' +
      'data: {"choices":[{"delta":{"content":" world"}}]}\r\n\r\n' +
      'data: [DONE]\r\n\r\n';

    const result = await processChatStream(
      streamFromText(events),
      () => {},
      'openai',
      undefined,
      { minEmitIntervalMs: 0 },
    );

    expect(result.text).toBe('hello world');
  });

  it('processChatStream throws the upstream message from error events', async () => {
    const stream = streamFromText('event: error\ndata: {"message":"boom"}\n\n');

    await expect(
      processChatStream(stream, () => {}, 'openai', undefined, { minEmitIntervalMs: 0 }),
    ).rejects.toThrow('boom');
  });

  it('processChatStream handles a trailing event without a blank-line terminator', async () => {
    const stream = streamFromText('data: {"choices":[{"delta":{"content":"tail"}}]}');

    const result = await processChatStream(
      stream,
      () => {},
      'openai',
      undefined,
      { minEmitIntervalMs: 0 },
    );

    expect(result.text).toBe('tail');
  });
});
