import { describe, expect, it } from 'vitest';
import { decodeSyncMessageMetadata, encodeSyncMessageMetadata } from '@/lib/chat-sync-message';

describe('chat sync message metadata', () => {
  it('round trips request snapshots and thinking fields', () => {
    const encoded = encodeSyncMessageMetadata({
      extra: 'ok',
      thinking: 'draft reasoning',
      thinkingDone: false,
      editedAt: 1234,
      request: {
        mode: 'edits',
        model: 'image-model',
        chatModel: 'chat-model',
        chatApiFormat: 'openai',
        size: '1024x1024',
        n: 1,
        quality: 'high',
        format: 'png',
        background: 'auto',
        moderation: 'auto',
        compression: 80,
        systemPrompt: '',
        streaming: true,
        contextLimit: 5,
        referenceImages: [{ image: { url: `/api/chat-assets/${'a'.repeat(64)}.png` }, mask: { dataUrl: 'data:image/png;base64,AA==' } }],
      },
    });

    const decoded = decodeSyncMessageMetadata(encoded);
    expect(decoded.extra).toBe('ok');
    expect(decoded.thinking).toBe('draft reasoning');
    expect(decoded.thinkingDone).toBe(false);
    expect(decoded.editedAt).toBe(1234);
    expect(decoded.request?.mode).toBe('edits');
    expect(decoded.request?.referenceImages).toHaveLength(1);
  });

  it('keeps legacy extra strings readable', () => {
    expect(decodeSyncMessageMetadata('legacy error')).toEqual({
      extra: 'legacy error',
      thinking: '',
      thinkingDone: true,
    });
  });
});
