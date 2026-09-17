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

  it('falls back to code-point splitting when Intl.Segmenter is missing', () => {
    const descriptor = Object.getOwnPropertyDescriptor(Intl, 'Segmenter');
    Object.defineProperty(Intl, 'Segmenter', { value: undefined, configurable: true, writable: true });
    try {
      expect(normalizeChatTitle('a'.repeat(30), { maxLength: 24 })).toBe('a'.repeat(24));
      // Without the segmenter the ZWJ sequence is cut mid-family — that
      // degraded split is the documented fallback behavior.
      expect(normalizeChatTitle(`${'x'.repeat(23)}👨‍👩‍👧 tail`, { maxLength: 24 }))
        .toBe(`${'x'.repeat(23)}👨`);
    } finally {
      if (descriptor) Object.defineProperty(Intl, 'Segmenter', descriptor);
    }
  });
});
