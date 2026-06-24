import type { AppConfig, AppOptions, ImageHit, ImageRef } from '@/types';
import type { ChatReferenceImage, ChatTurnSnapshot } from '@/contexts/ChatContext';
import { USER_ABORT_SENTINEL } from '@/lib/api';
import { uploadChatImage } from '@/lib/chat-asset-client';
import { blobToEditBlob } from '@/lib/image-edit';
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

export async function imageHitToBlob(image: ImageHit, signal?: AbortSignal): Promise<Blob | null> {
  const source = image.dataUrl || image.url;
  if (!source) return null;
  try {
    if (signal?.aborted) throw new Error(USER_ABORT_SENTINEL);
    const response = await fetch(source, { signal });
    if (!response.ok) return null;
    if (signal?.aborted) throw new Error(USER_ABORT_SENTINEL);
    return blobToEditBlob(await response.blob(), source, signal);
  } catch (error) {
    if ((error as Error).message === USER_ABORT_SENTINEL || signal?.aborted) throw error;
    return null;
  }
}

export function blobExt(blob: Blob) {
  if (blob.type === 'image/jpeg') return 'jpg';
  if (blob.type === 'image/webp') return 'webp';
  if (blob.type === 'image/gif') return 'gif';
  return 'png';
}

export async function buildEditsFormFromReferences(
  references: ChatReferenceImage[],
  prompt: string,
  size: string | null,
  model: string,
  signal?: AbortSignal,
): Promise<FormData> {
  const form = new FormData();
  form.append('model', model);
  form.append('prompt', prompt);
  if (size) form.append('size', size);

  if (signal?.aborted) throw new Error(USER_ABORT_SENTINEL);
  const imageBlobs = await Promise.all(references.map((reference) => imageHitToBlob(reference.image, signal)));
  if (signal?.aborted) throw new Error(USER_ABORT_SENTINEL);
  imageBlobs.forEach((blob, i) => {
    if (!blob) return;
    form.append('image[]', blob, `image-${i + 1}.${blobExt(blob)}`);
  });

  const maskBlob = await imageHitToBlob(references[0]?.mask || {}, signal);
  if (maskBlob) form.append('mask', maskBlob, `mask.${blobExt(maskBlob)}`);
  return form;
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

export async function ensureModelGateAccess(modelGateEnabled: boolean, signal?: AbortSignal): Promise<void> {
  if (!modelGateEnabled) return;
  if (signal?.aborted) throw new Error(USER_ABORT_SENTINEL);

  let response: Response;
  try {
    response = await fetch('/api/model-gate', { signal });
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
      throw new Error(USER_ABORT_SENTINEL);
    }
    throw error;
  }
  const data = await response.json().catch(() => null) as { unlocked?: boolean; message?: string } | null;
  if (signal?.aborted) throw new Error(USER_ABORT_SENTINEL);
  if (data?.unlocked) return;

  throw new Error(`HTTP 418 ${data?.message || '模型访问未解锁'}`);
}
