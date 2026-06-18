import type { ImageRef } from '@/types';
import { USER_ABORT_SENTINEL } from '@/lib/api';
import { OFFICIAL_IMAGE_MAX_EDGE } from './constants';

const EDIT_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const QUALITY_STEPS = [0.92, 0.84, 0.76, 0.68, 0.58];
const SCALE_STEPS = [1, 0.85, 0.7, 0.55, 0.42];

function abortError() {
  return new Error(USER_ABORT_SENTINEL);
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError();
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
  signal?: AbortSignal,
): Promise<Blob | null> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }

    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', handleAbort);
      fn();
    };
    const handleAbort = () => settle(() => reject(abortError()));

    signal?.addEventListener('abort', handleAbort, { once: true });
    canvas.toBlob((blob) => {
      settle(() => {
        if (signal?.aborted) reject(abortError());
        else resolve(blob);
      });
    }, type, quality);
  });
}

function loadImage(src: string, signal?: AbortSignal): Promise<HTMLImageElement | null> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }

    const img = new Image();
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', handleAbort);
      img.onload = null;
      img.onerror = null;
      fn();
    };
    const handleAbort = () => {
      img.src = '';
      settle(() => reject(abortError()));
    };

    signal?.addEventListener('abort', handleAbort, { once: true });
    img.onload = () => settle(() => resolve(img));
    img.onerror = () => settle(() => resolve(null));
    img.src = src;
  });
}

function hasAlpha(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;

  for (let y = 0; y < canvas.height; y += 128) {
    const height = Math.min(128, canvas.height - y);
    const data = ctx.getImageData(0, y, canvas.width, height).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 255) return true;
    }
  }
  return false;
}

function drawScaled(source: HTMLCanvasElement, scale: number) {
  if (scale === 1) return source;

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return source;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function encodeWithinBudget(source: HTMLCanvasElement, transparent: boolean, signal?: AbortSignal) {
  const type = transparent ? 'image/webp' : 'image/jpeg';
  let smallest: Blob | null = null;

  for (const scale of SCALE_STEPS) {
    throwIfAborted(signal);
    const canvas = drawScaled(source, scale);
    for (const quality of QUALITY_STEPS) {
      throwIfAborted(signal);
      const blob = await canvasToBlob(canvas, type, quality, signal);
      if (!blob) continue;
      if (!smallest || blob.size < smallest.size) smallest = blob;
      if (blob.size <= EDIT_IMAGE_MAX_BYTES) return blob;
    }
  }

  return smallest;
}

export async function blobToEditBlob(blob: Blob, sourceUrl?: string, signal?: AbortSignal): Promise<Blob | null> {
  throwIfAborted(signal);
  const objectUrl = sourceUrl || URL.createObjectURL(blob);
  try {
    const img = await loadImage(objectUrl, signal);
    if (!img) return blob;
    throwIfAborted(signal);

    const scale = Math.min(1, OFFICIAL_IMAGE_MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return blob;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    if (blob.size <= EDIT_IMAGE_MAX_BYTES && scale === 1) return blob;
    throwIfAborted(signal);
    return await encodeWithinBudget(canvas, hasAlpha(canvas), signal) || blob;
  } finally {
    if (!sourceUrl) URL.revokeObjectURL(objectUrl);
  }
}

export function imageRefToEditBlob(image: ImageRef, signal?: AbortSignal): Promise<Blob | null> {
  return blobToEditBlob(image.file, image.objectUrl, signal);
}
