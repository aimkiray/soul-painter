import { ImageHit } from '@/types';

const SAFE_REMOTE_IMAGE_URL = /^https?:\/\//i;
const SAFE_LOCAL_CHAT_ASSET_URL = /^\/api\/chat-assets\/[a-f0-9]{64}\.(png|jpe?g|webp|gif)$/i;
const SAFE_IMAGE_DATA_URL = /^data:image\/(png|jpe?g|webp|gif);base64,/i;
const assetResolveCache = new Map<string, Promise<string | null>>();

export function normalizeChatImageUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const url = value.trim();
  if (!url) return null;
  if (SAFE_LOCAL_CHAT_ASSET_URL.test(url) || SAFE_REMOTE_IMAGE_URL.test(url)) return url;
  return null;
}

export function normalizeChatImageDataUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const dataUrl = value.trim();
  if (!dataUrl || !SAFE_IMAGE_DATA_URL.test(dataUrl)) return null;
  return dataUrl;
}

export function normalizeChatImageHit(value: unknown): ImageHit | null {
  if (!value || typeof value !== 'object') return null;
  const image = value as ImageHit;
  const url = normalizeChatImageUrl(image.url);
  if (url) return { url };
  const dataUrl = normalizeChatImageDataUrl(image.dataUrl);
  if (dataUrl) return { dataUrl };
  return null;
}

export function toStoredChatImageHit(value: ImageHit): ImageHit | null {
  const url = normalizeChatImageUrl(value.url);
  return url && SAFE_LOCAL_CHAT_ASSET_URL.test(url) ? { url } : null;
}

async function postChatAsset(body: { image?: string; url?: string }, signal?: AbortSignal): Promise<string | null> {
  try {
    const response = await fetch('/api/chat-assets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) return null;
    const data = await response.json().catch(() => null) as { url?: string } | null;
    const url = normalizeChatImageUrl(data?.url);
    return url && SAFE_LOCAL_CHAT_ASSET_URL.test(url) ? url : null;
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function cacheResolve(key: string, resolve: () => Promise<string | null>): Promise<string | null> {
  const existing = assetResolveCache.get(key);
  if (existing) return existing;

  const pending = resolve().finally(() => {
    // Keep successful local URLs cached via their original key for this page lifetime,
    // but let failed attempts be retried after transient network errors.
  });
  assetResolveCache.set(key, pending);
  void pending.then((url) => {
    if (!url) assetResolveCache.delete(key);
  });
  return pending;
}

export async function uploadChatImage(dataUrl: string, signal?: AbortSignal): Promise<string | null> {
  const normalizedDataUrl = normalizeChatImageDataUrl(dataUrl);
  if (!normalizedDataUrl) return null;
  if (signal) return postChatAsset({ image: normalizedDataUrl }, signal);
  return cacheResolve(
    `data:${normalizedDataUrl.length}:${hashString(normalizedDataUrl)}`,
    () => postChatAsset({ image: normalizedDataUrl }),
  );
}

export async function imageHitToStoredUrl(image: ImageHit, signal?: AbortSignal): Promise<string | null> {
  const url = normalizeChatImageUrl(image.url);
  if (url) {
    if (SAFE_LOCAL_CHAT_ASSET_URL.test(url)) return url;
    if (signal) return postChatAsset({ url }, signal);
    return cacheResolve(`url:${url}`, () => postChatAsset({ url }));
  }

  const dataUrl = normalizeChatImageDataUrl(image.dataUrl);
  if (!dataUrl) return null;
  return uploadChatImage(dataUrl, signal);
}
