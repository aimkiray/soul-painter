import { describe, it, expect } from 'vitest';
import { normalizeChatTitle } from '@/lib/title';

describe('normalizeChatTitle', () => {
  it('does not split a ZWJ emoji when truncating', () => {
    const family = '👨‍👩‍👧';
    const title = normalizeChatTitle(`${'x'.repeat(23)}${family} tail`, { maxLength: 24 });
    expect(title).toBe(`${'x'.repeat(23)}${family}`);
  });

  it('still truncates long plain titles', () => {
    expect(normalizeChatTitle('一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三四五', { maxLength: 24 }))
      .toBe('一二三四五六七八九十一二三四五六七八九十一二三四');
  });
});
