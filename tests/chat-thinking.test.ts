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
});

describe('composeChatContentParts', () => {
  it('strips orphan closing tags from composed text', () => {
    expect(composeChatContentParts('partial</think>done').text).toBe('partialdone');
  });
});
