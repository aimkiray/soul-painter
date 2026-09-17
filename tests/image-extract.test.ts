import { describe, it, expect } from 'vitest';
import { extractImage } from '@/lib/image-extract';

// atob('iVBORw0KGgo=') === the 8-byte PNG magic header.
const PNG_B64 = 'iVBORw0KGgo=';

describe('extractImage', () => {
  it('does not throw on malformed choices', () => {
    expect(extractImage({ choices: [null] })).toBeNull();
    expect(extractImage({ choices: [{ index: 0, finish_reason: 'stop' }] })).toBeNull();
    expect(extractImage({ choices: [{ message: null }] })).toBeNull();
  });

  it('restores a base64 data url containing whitespace', () => {
    const content = `done data:image/png;base64,${PNG_B64.slice(0, 6)}\n${PNG_B64.slice(6)}`;
    expect(extractImage({ choices: [{ message: { content } }] })).toEqual({
      dataUrl: `data:image/png;base64,${PNG_B64}`,
    });
  });

  it('does not mistake a long alphanumeric string for an image', () => {
    const content = 'x'.repeat(250);
    expect(extractImage({ choices: [{ message: { content } }] })).toBeNull();
    expect(extractImage({ data: [{ b64_json: content }] })).toBeNull();
  });

  it('still extracts a real base64 image payload', () => {
    expect(extractImage({ data: [{ b64_json: PNG_B64 }] })).toEqual({
      dataUrl: `data:image/png;base64,${PNG_B64}`,
    });
  });

  it('unwraps object-form image_url in message images', () => {
    const resp = {
      choices: [{ message: { images: [{ image_url: { url: 'https://x.test/gen?id=1' } }] } }],
    };
    expect(extractImage(resp)).toEqual({ url: 'https://x.test/gen?id=1' });
  });

  it('keeps looking past a corrupt data-url candidate', () => {
    const corrupt = `data:image/png;base64,${'a'.repeat(64)}`;
    const valid = `data:image/png;base64,${PNG_B64}`;
    const content = `${corrupt}! ${valid}`;
    expect(extractImage({ choices: [{ message: { content } }] })).toEqual({
      dataUrl: `data:image/png;base64,${PNG_B64}`,
    });
  });

  it('keeps looking past a long non-image token for a bare base64 image', () => {
    const token = 'a'.repeat(250);
    // PNG magic followed by padding — a valid ≥200-char base64 candidate.
    const payload = `iVBORw0KGgo${'A'.repeat(200)}`;
    const content = `${token} ${payload}`;
    expect(extractImage({ choices: [{ message: { content } }] })).toEqual({
      dataUrl: `data:image/png;base64,${payload}`,
    });
  });
});
