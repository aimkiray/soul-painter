import { describe, it, expect } from 'vitest';
import { toClaudeMessagesBody } from '@/lib/claude-messages';

describe('toClaudeMessagesBody', () => {
  it('merges consecutive same-role messages so roles alternate', () => {
    // A failed/canceled turn leaves an unanswered user message; the next
    // prompt appends another — Anthropic rejects non-alternating roles.
    const out = toClaudeMessagesBody({
      model: 'claude-x',
      messages: [
        { role: 'user', content: 'first' },
        { role: 'user', content: 'second' },
        { role: 'assistant', content: 'answer' },
        { role: 'assistant', content: 'more' },
        { role: 'user', content: 'third' },
      ],
    });
    const messages = out.messages as Array<{ role: string; content: string }>;
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(messages[0].content).toBe('first\n\nsecond');
    expect(messages[1].content).toBe('answer\n\nmore');
  });

  it('moves system/developer messages into the system field', () => {
    const out = toClaudeMessagesBody({
      model: 'claude-x',
      messages: [
        { role: 'system', content: 'sys one' },
        { role: 'developer', content: 'sys two' },
        { role: 'user', content: 'hi' },
      ],
    });
    expect(out.system).toBe('sys one\n\nsys two');
    expect(out.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('drops empty-content messages and stringifies array parts', () => {
    const out = toClaudeMessagesBody({
      model: 'claude-x',
      messages: [
        { role: 'user', content: '  ' },
        { role: 'user', content: [{ type: 'text', text: 'a' }, 'b'] },
        { role: 'assistant', content: 'ok' },
      ],
    });
    expect(out.messages).toEqual([
      { role: 'user', content: 'ab' },
      { role: 'assistant', content: 'ok' },
    ]);
  });

  it('falls back to 4096 for invalid max_tokens and passes stream through', () => {
    const out = toClaudeMessagesBody({ model: 'm', messages: [], max_tokens: 'nope', stream: true });
    expect(out.max_tokens).toBe(4096);
    expect(out.stream).toBe(true);
  });
});
