import { COMPRESS_THRESHOLD, MAX_EDGE } from './constants';

function pngHasAlpha(file: File): boolean {
  return file.type === 'image/png' || /\.png$/i.test(file.name || '');
}

export interface CompressResult {
  file: File;
  originalSize: number;
  compressed: boolean;
  naturalWidth: number;
  naturalHeight: number;
}

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

function decodeWithImageElement(file: File): Promise<DecodedImage | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        resolve({ source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) });
      } catch {
        URL.revokeObjectURL(url);
        resolve(null);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

async function decodeImage(file: File): Promise<DecodedImage | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      // imageOrientation: 'from-image' applies EXIF rotation so decoded
      // dimensions and pixels match what the <img> element would show.
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      // Older Safari lacks the options argument — fall back to <img> decoding.
    }
  }
  return decodeWithImageElement(file);
}

export async function compressIfNeeded(file: File): Promise<CompressResult> {
  const passthrough = (naturalWidth = 0, naturalHeight = 0): CompressResult => ({
    file,
    originalSize: file.size,
    compressed: false,
    naturalWidth,
    naturalHeight,
  });

  let decoded: DecodedImage | null = null;
  try {
    decoded = await decodeImage(file);
  } catch {
    return passthrough();
  }
  if (!decoded) return passthrough();
  const { width: w, height: h } = decoded;

  try {
    if (file.size <= COMPRESS_THRESHOLD && w <= MAX_EDGE && h <= MAX_EDGE) {
      return passthrough(w, h);
    }

    const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
    const tw = Math.max(1, Math.round(w * scale));
    const th = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext('2d');
    if (!ctx) return passthrough(w, h);
    ctx.drawImage(decoded.source, 0, 0, tw, th);

    const keepPng = pngHasAlpha(file);
    const outType = keepPng ? 'image/png' : 'image/jpeg';
    const quality = keepPng ? undefined : 0.85;
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, outType, quality);
    });
    if (!blob) return passthrough(w, h);
    // A larger re-encode gains nothing — keep the original file.
    if (blob.size >= file.size) return passthrough(w, h);

    const ext = keepPng ? 'png' : 'jpg';
    const newName = (file.name || 'image').replace(/\.[^.]+$/, '') + '.compressed.' + ext;
    const newFile = new File([blob], newName, { type: outType });
    return { file: newFile, originalSize: file.size, compressed: true, naturalWidth: tw, naturalHeight: th };
  } catch {
    return passthrough(w, h);
  } finally {
    decoded.release();
  }
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
}
