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

export async function compressIfNeeded(file: File): Promise<CompressResult> {
  let nw = 0, nh = 0;

  if (file.size <= COMPRESS_THRESHOLD) {
    const dims = await new Promise<{ w: number; h: number } | null>((res) => {
      const img = new Image();
      const objUrl = URL.createObjectURL(file);
      img.onload = () => { res({ w: img.naturalWidth, h: img.naturalHeight }); URL.revokeObjectURL(objUrl); };
      img.onerror = () => { res(null); URL.revokeObjectURL(objUrl); };
      img.src = objUrl;
    });
    if (dims) { nw = dims.w; nh = dims.h; }
    if (!dims || (dims.w <= MAX_EDGE && dims.h <= MAX_EDGE)) {
      return { file, originalSize: file.size, compressed: false, naturalWidth: nw, naturalHeight: nh };
    }
  }

  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const { naturalWidth: w, naturalHeight: h } = img;
      nw = w; nh = h;
      const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
      const tw = Math.round(w * scale);
      const th = Math.round(h * scale);
      const canvas = document.createElement('canvas');
      canvas.width = tw;
      canvas.height = th;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, tw, th);
      const keepPng = pngHasAlpha(file);
      const outType = keepPng ? 'image/png' : 'image/jpeg';
      const quality = keepPng ? undefined : 0.85;
      canvas.toBlob((blob) => {
        URL.revokeObjectURL(url);
        // Always use compressed version for oversized files — even if PNG re-encode
        // produces a larger file (rare), the downscaled version is better for API payload
        if (!blob) {
          resolve({ file, originalSize: file.size, compressed: false, naturalWidth: nw, naturalHeight: nh });
          return;
        }
        const ext = keepPng ? 'png' : 'jpg';
        const newName = (file.name || 'image').replace(/\.[^.]+$/, '') + '.compressed.' + ext;
        const newFile = new File([blob], newName, { type: outType });
        resolve({ file: newFile, originalSize: file.size, compressed: true, naturalWidth: tw, naturalHeight: th });
      }, outType, quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve({ file, originalSize: file.size, compressed: false, naturalWidth: nw, naturalHeight: nh }); };
    img.src = url;
  });
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
}
