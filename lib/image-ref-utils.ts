import type { AppConfig, AppOptions, ImageHit, ImageRef } from '@/types';
import type { ChatReferenceImage, ChatTurnSnapshot } from '@/contexts/ChatContext';
import { USER_ABORT_SENTINEL } from '@/lib/api';
import { imageHitToStoredUrl, uploadChatImage } from '@/lib/chat-asset-client';
import { getChatProviderConfig, getActiveChatModel } from '@/lib/chat-config';

export type RunMode = ChatTurnSnapshot['mode'];

export function blobToDataUrl(blob: Blob, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error(USER_ABORT_SENTINEL));
      return;
    }

    const reader = new FileReader();
    const handleAbort = () => {
      reader.abort();
      reject(new Error(USER_ABORT_SENTINEL));
    };

    signal?.addEventListener('abort', handleAbort, { once: true });
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read image'));
    reader.onabort = () => reject(new Error(USER_ABORT_SENTINEL));
    reader.onloadend = () => signal?.removeEventListener('abort', handleAbort);
    reader.readAsDataURL(blob);
  });
}

export async function canvasToImageHit(canvas: HTMLCanvasElement | null, signal?: AbortSignal): Promise<ImageHit | undefined> {
  if (!canvas) return undefined;
  if (signal?.aborted) throw new Error(USER_ABORT_SENTINEL);
  const dataUrl = canvas.toDataURL('image/png');
  if (signal?.aborted) throw new Error(USER_ABORT_SENTINEL);
  const url = await uploadChatImage(dataUrl, signal);
  return url ? { url } : { dataUrl };
}

export async function imageRefToStoredHit(image: ImageRef, signal?: AbortSignal): Promise<ImageHit | null> {
  try {
    if (signal?.aborted) throw new Error(USER_ABORT_SENTINEL);
    const dataUrl = await blobToDataUrl(image.file, signal);
    if (signal?.aborted) throw new Error(USER_ABORT_SENTINEL);
    const url = await uploadChatImage(dataUrl, signal);
    return url ? { url } : { dataUrl };
  } catch (error) {
    if ((error as Error).message === USER_ABORT_SENTINEL || signal?.aborted) throw error;
    return null;
  }
}

// OpenAI images/edits mask convention: alpha=0 marks the edit region and
// every other pixel must be fully opaque. The editor stores semi-transparent
// stroke overlays (alpha≈0.55) — binarize the alpha channel so painted
// pixels become holes and untouched pixels become opaque, independent of
// the stroke alpha.
export async function maskCanvasToImageHit(maskCanvas: HTMLCanvasElement | null, signal?: AbortSignal): Promise<ImageHit | undefined> {
  if (!maskCanvas) return undefined;
  if (signal?.aborted) throw new Error(USER_ABORT_SENTINEL);
  const srcCtx = maskCanvas.getContext('2d');
  if (!srcCtx) return undefined;
  const { width, height } = maskCanvas;
  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const ctx = out.getContext('2d');
  if (!ctx) return undefined;
  const src = srcCtx.getImageData(0, 0, width, height);
  const dst = ctx.createImageData(width, height);
  for (let i = 0; i < src.data.length; i += 4) {
    dst.data[i] = 255;
    dst.data[i + 1] = 255;
    dst.data[i + 2] = 255;
    dst.data[i + 3] = src.data[i + 3] > 0 ? 0 : 255;
  }
  ctx.putImageData(dst, 0, 0);
  return canvasToImageHit(out, signal);
}

export async function imageRefToReferenceImage(image: ImageRef, signal?: AbortSignal): Promise<ChatReferenceImage | null> {
  const storedImage = await imageRefToStoredHit(image, signal);
  if (!storedImage) return null;
  const mask = await maskCanvasToImageHit(image.maskCanvas, signal);
  return mask ? { image: storedImage, mask } : { image: storedImage };
}

// data: URLs fetch locally; remote URLs go through /api/chat-assets because
// provider CDNs don't send CORS headers to us.
export async function hitToFile(hit: ImageHit, index = 0): Promise<File | null> {
  let link = hit.dataUrl || '';
  if (!link) link = (await imageHitToStoredUrl(hit)) || '';
  if (!link) return null;
  try {
    const blob = await (await fetch(link)).blob();
    if (!blob.type.startsWith('image/')) return null;
    const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
    return new File([blob], `ref-${Date.now()}-${index + 1}.${ext}`, { type: blob.type });
  } catch {
    return null;
  }
}

export function createTurnSnapshot(
  config: AppConfig,
  options: AppOptions,
  mode: RunMode,
  resolvedSize: string,
  referenceImages: ChatReferenceImage[],
): ChatTurnSnapshot {
  const chatProvider = getChatProviderConfig(config, getActiveChatModel(config));
  return {
    mode,
    model: config.model,
    chatModel: chatProvider.model,
    chatApiFormat: chatProvider.format,
    chatEffort: mode === 'chat' ? config.chatEffort : undefined,
    size: resolvedSize,
    n: config.n,
    quality: config.quality,
    format: config.format,
    background: config.background,
    moderation: config.moderation,
    compression: config.compression,
    systemPrompt: config.systemPrompt,
    streaming: options.streaming,
    contextLimit: options.contextLimit,
    referenceImages,
  };
}
