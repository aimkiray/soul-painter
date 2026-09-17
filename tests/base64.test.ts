import { describe, it, expect } from 'vitest';
import { normalizeToDataUrl } from '@/lib/base64';

// atob('iVBORw0KGgo=') === the 8-byte PNG magic header.
const PNG_B64 = 'iVBORw0KGgo=';

describe('normalizeToDataUrl', () => {
  it('accepts a data url prefix with an empty mime', () => {
    const result = normalizeToDataUrl(`data:;base64,${PNG_B64}`);
    expect(result.mime).toBe('image/png');
    expect(result.dataUrl).toBe(`data:image/png;base64,${PNG_B64}`);
  });

  it('rejects padding characters in the middle of the payload', () => {
    expect(() => normalizeToDataUrl('ab=cd')).toThrow('包含非法的 Base64 字符');
  });

  it('fails on unknown magic bytes instead of defaulting to png', () => {
    expect(() => normalizeToDataUrl('a'.repeat(100))).toThrow('无法识别的图片格式');
    expect(() => normalizeToDataUrl(`data:;base64,${'a'.repeat(100)}`)).toThrow('无法识别的图片格式');
    expect(() => normalizeToDataUrl(`data:image/png;base64,${'a'.repeat(100)}`)).toThrow('无法识别的图片格式');
  });
});
