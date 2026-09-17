import { describe, it, expect } from 'vitest';
import { extractModelGateMessage, isRecord, stringifyTextContent, parseErrorDetail, extractChatResponseParts, buildChatMessages, CHAT_HISTORY_BUDGET } from '@/lib/api-parsers';
import type { ChatMessage } from '@/contexts/ChatContext';

function historyMessage(id: string, role: 'user' | 'bot', prompt = '', text = ''): ChatMessage {
  return { id, role, prompt, text, images: [], code: '', extra: '', createdAt: 0 };
}

describe('api-parsers', () => {
  it('extractModelGateMessage extracts message from standard error format', () => {
    const errorText = 'HTTP 418: Gate unlocked';
    expect(extractModelGateMessage(errorText)).toBe('Gate unlocked');
  });

  it('extractModelGateMessage extracts plain string message', () => {
    expect(extractModelGateMessage('Simple string message')).toBe(null);
  });

  it('extractModelGateMessage returns empty string for unknown formats', () => {
    expect(extractModelGateMessage('')).toBe(null);
  });

  it('isRecord correctly identifies records', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord([])).toBe(false);
    expect(isRecord('test')).toBe(false);
  });

  it('stringifyTextContent processes content objects correctly', () => {
    expect(stringifyTextContent('text')).toBe('text');
    expect(stringifyTextContent({ type: 'text', text: 'hello' })).toBe('hello');
    expect(stringifyTextContent({ type: 'image_url' })).toBe('');
    expect(stringifyTextContent([{ type: 'text', text: 'hello' }, { type: 'text', text: ' world' }])).toBe('hello world');
  });

  it('extractChatResponseParts surfaces upstream error bodies', () => {
    expect(() => extractChatResponseParts({ error: { message: 'rate limited' } }, 'openai'))
      .toThrow('rate limited');
    expect(() => extractChatResponseParts({ type: 'error', error: { type: 'overloaded_error', message: 'busy' } }, 'claude'))
      .toThrow('busy');
    expect(() => extractChatResponseParts({ error: 'upstream down' }, 'openai'))
      .toThrow('upstream down');
  });

  it('extractChatResponseParts still parses a normal openai reply', () => {
    const parts = extractChatResponseParts(
      { choices: [{ message: { content: 'hi' } }] },
      'openai',
    );
    expect(parts.text).toBe('hi');
  });

  it('parseErrorDetail falls back gracefully', () => {
    expect(parseErrorDetail(JSON.stringify({ error: { message: 'API error' } }))).toBe('API error');
    expect(parseErrorDetail(JSON.stringify({ message: 'General error' }))).toBe('General error');
    expect(parseErrorDetail(JSON.stringify({ error: { message: 42 } }))).toBe('42');
  });

  it('buildChatMessages trims oldest turns to stay under the budget', () => {
    const big = 'x'.repeat(CHAT_HISTORY_BUDGET);
    const history = [
      historyMessage('u1', 'user', big),
      historyMessage('b1', 'bot', '', big),
      historyMessage('u2', 'user', 'second'),
      historyMessage('b2', 'bot', '', 'reply'),
    ];
    const out = buildChatMessages(history, 'now', 'sys', 5);
    expect(out[0]).toEqual({ role: 'system', content: 'sys' });
    expect(out).toContainEqual({ role: 'user', content: 'second' });
    expect(out).toContainEqual({ role: 'assistant', content: 'reply' });
    expect(out[out.length - 1]).toEqual({ role: 'user', content: 'now' });
    expect(out.some((m) => m.content === big)).toBe(false);
  });

  it('buildChatMessages measures the budget in UTF-8 bytes, not UTF-16 units', () => {
    // ~36KB on the wire but only ~12K in string.length units.
    const cjk = '汉'.repeat(12 * 1024);
    const history = [
      historyMessage('u1', 'user', cjk),
      historyMessage('b1', 'bot', '', cjk),
    ];
    const out = buildChatMessages(history, 'now', '', 5);
    expect(out).toEqual([{ role: 'user', content: 'now' }]);
  });
});
