import { describe, it, expect } from 'vitest';
import { CUSTOM_SIZE_PATTERN, parseSize } from '@/lib/size';

describe('CUSTOM_SIZE_PATTERN vs parseSize', () => {
  it('accepts and parses a normal 2-5 digit size', () => {
    expect(CUSTOM_SIZE_PATTERN.test('1024x1024')).toBe(true);
    expect(parseSize('1024x1024')).toEqual({ naturalWidth: 1024, naturalHeight: 1024 });
  });

  it('rejects single-digit sides consistently', () => {
    expect(CUSTOM_SIZE_PATTERN.test('1x1')).toBe(false);
    expect(parseSize('1x1')).toBeNull();
  });

  it('rejects mixed digit counts consistently', () => {
    expect(CUSTOM_SIZE_PATTERN.test('99999x1')).toBe(false);
    expect(parseSize('99999x1')).toBeNull();
  });

  it('accepts uppercase X and trims whitespace', () => {
    expect(CUSTOM_SIZE_PATTERN.test('1024X768')).toBe(true);
    expect(parseSize(' 1024X768 ')).toEqual({ naturalWidth: 1024, naturalHeight: 768 });
  });

  it('rejects non-size strings', () => {
    for (const bad of ['', 'auto', '1024', 'x1024', '1024x', '1x2x3', 'abc']) {
      expect(CUSTOM_SIZE_PATTERN.test(bad)).toBe(false);
      expect(parseSize(bad)).toBeNull();
    }
  });
});
