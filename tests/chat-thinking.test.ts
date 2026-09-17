import { describe, it, expect } from 'vitest';
import { splitThinkTaggedContent, composeChatContentParts } from '@/lib/chat-thinking';

describe('splitThinkTaggedContent', () => {
  it('strips an orphan closing think tag from the text', () => {
    const parts = splitThinkTaggedContent('hello</think> world');
    expect(parts.text).toBe('hello world');
    expect(parts.thinking).toBe('');
    expect(parts.thinkingDone).toBe(true);
  });

  it('keeps extracting real thinking blocks', () => {
    const parts = splitThinkTaggedContent('<think>reasoning</think>answer');
    expect(parts.text).toBe('answer');
    expect(parts.thinking).toBe('reasoning');
  });

  it('extracts <thinking> blocks', () => {
    const parts = splitThinkTaggedContent('<thinking>ponder</thinking>answer');
    expect(parts.text).toBe('answer');
    expect(parts.thinking).toBe('ponder');
    expect(parts.thinkingDone).toBe(true);
  });

  it('extracts <analysis> blocks', () => {
    const parts = splitThinkTaggedContent('<analysis>deep</analysis>answer');
    expect(parts.text).toBe('answer');
    expect(parts.thinking).toBe('deep');
    expect(parts.thinkingDone).toBe(true);
  });

  it('strips orphan closing <thinking>/<analysis> tags from the text', () => {
    expect(splitThinkTaggedContent('a</thinking>b').text).toBe('ab');
    expect(splitThinkTaggedContent('a</analysis>b').text).toBe('ab');
  });

  it('marks an unclosed <analysis> block as still thinking', () => {
    const parts = splitThinkTaggedContent('hi<analysis>mid');
    expect(parts.text).toBe('hi');
    expect(parts.thinking).toBe('mid');
    expect(parts.thinkingDone).toBe(false);
  });
});

describe('composeChatContentParts', () => {
  it('strips orphan closing tags from composed text', () => {
    expect(composeChatContentParts('partial</think>done').text).toBe('partialdone');
  });
});
