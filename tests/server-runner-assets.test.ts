import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ImageHit } from '@/types';

vi.mock('@/lib/chat-assets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/chat-assets')>();
  return { ...actual, resolveChatAsset: vi.fn() };
});

import { resolveChatAsset } from '@/lib/chat-assets';
import {
  migrateRuntimeAssetSession,
  registerServerRunRuntimeSecrets,
  resultImagesToAssets,
} from '@/lib/server-runner';

const resolveChatAssetMock = vi.mocked(resolveChatAsset);

describe('resultImagesToAssets', () => {
  beforeEach(() => {
    resolveChatAssetMock.mockReset();
  });

  it('stores dataUrl hits as chat assets and keeps only the url', async () => {
    registerServerRunRuntimeSecrets('run-convert', {
      credentials: {},
      assetSessionId: 'a'.repeat(32),
      allowServerDefaults: false,
    });
    resolveChatAssetMock.mockResolvedValue({
      id: 'deadbeef.png',
      url: '/api/chat-assets/deadbeef.png',
      mime: 'image/png',
      size: 4,
    });

    const out = await resultImagesToAssets('run-convert', [
      { dataUrl: 'data:image/png;base64,AAAA' },
      { url: 'https://example.com/remote.png' },
    ]);

    expect(resolveChatAssetMock).toHaveBeenCalledWith('a'.repeat(32), { dataUrl: 'data:image/png;base64,AAAA' });
    expect(resolveChatAssetMock).toHaveBeenCalledTimes(1);
    expect(out).toEqual([
      { url: '/api/chat-assets/deadbeef.png' },
      { url: 'https://example.com/remote.png' },
    ]);
  });

  it('keeps the original hit when the asset save fails', async () => {
    registerServerRunRuntimeSecrets('run-fail', {
      credentials: {},
      assetSessionId: 'b'.repeat(32),
      allowServerDefaults: false,
    });
    resolveChatAssetMock.mockRejectedValue(new Error('quota'));
    const hit: ImageHit = { dataUrl: 'data:image/png;base64,BBBB' };

    const out = await resultImagesToAssets('run-fail', [hit]);
    expect(out).toEqual([hit]);
  });

  it('passes images through untouched without a registered asset session', async () => {
    const hits: ImageHit[] = [{ dataUrl: 'data:image/png;base64,CCCC' }];
    const out = await resultImagesToAssets('run-no-session', hits);
    expect(resolveChatAssetMock).not.toHaveBeenCalled();
    expect(out).toBe(hits);
  });

  it('follows an anonymous→user asset session migration mid-run', async () => {
    const anon = 'c'.repeat(32);
    const usr = `usr_${'d'.repeat(32)}`;
    registerServerRunRuntimeSecrets('run-migrate', {
      credentials: {},
      assetSessionId: anon,
      allowServerDefaults: false,
    });
    migrateRuntimeAssetSession(anon, usr);
    resolveChatAssetMock.mockResolvedValue({
      id: 'cafe.png',
      url: '/api/chat-assets/cafe.png',
      mime: 'image/png',
      size: 4,
    });

    await resultImagesToAssets('run-migrate', [{ dataUrl: 'data:image/png;base64,DDDD' }]);
    expect(resolveChatAssetMock).toHaveBeenCalledWith(usr, { dataUrl: 'data:image/png;base64,DDDD' });
  });
});
