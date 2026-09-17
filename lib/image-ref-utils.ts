import type { AppConfig, AppOptions, ImageHit, ImageRef } from '@/types';
import type { ChatReferenceImage, ChatTurnSnapshot } from '@/contexts/ChatContext';
import { USER_ABORT_SENTINEL } from '@/lib/api';
import { uploadChatImage } from '@/lib/chat-asset-client';
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

export async function imageRefToReferenceImage(image: ImageRef, signal?: AbortSignal): Promise<ChatReferenceImage | null> {
  const storedImage = await imageRefToStoredHit(image, signal);
  if (!storedImage) return null;
  const mask = await canvasToImageHit(image.maskCanvas, signal);
  return mask ? { image: storedImage, mask } : { image: storedImage };
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
