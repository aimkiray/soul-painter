export function canvasHasStrokes(canvas: HTMLCanvasElement | null): boolean {
  if (!canvas) return false;
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0) return true;
  return false;
}

export function buildAlphaMaskBlob(im: { naturalWidth: number; naturalHeight: number; mask: HTMLCanvasElement }): Promise<Blob | null> {
  return new Promise((resolve) => {
    const w = im.naturalWidth || im.mask.width;
    const h = im.naturalHeight || im.mask.height;
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const ctx = out.getContext('2d')!;
    // White base = keep all pixels
    ctx.fillStyle = 'rgb(255,255,255)';
    ctx.fillRect(0, 0, w, h);
    // Subtract mask strokes from white background
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(im.mask, 0, 0, w, h);
    // Binarize: any non-fully-opaque pixel → fully transparent (alpha=0 = edit)
    const data = ctx.getImageData(0, 0, w, h);
    for (let i = 3; i < data.data.length; i += 4) {
      if (data.data[i] < 255) data.data[i] = 0;
    }
    ctx.putImageData(data, 0, 0);
    out.toBlob((b) => resolve(b), 'image/png');
  });
}

export async function buildMaskedComposite(im: {
  objectUrl: string;
  naturalWidth: number;
  naturalHeight: number;
  mask: HTMLCanvasElement;
}): Promise<string> {
  const htmlImg = await new Promise<HTMLImageElement>((res, rej) => {
    const x = new Image();
    x.onload = () => res(x);
    x.onerror = rej;
    x.src = im.objectUrl;
  });
  const out = document.createElement('canvas');
  out.width = im.naturalWidth || htmlImg.naturalWidth;
  out.height = im.naturalHeight || htmlImg.naturalHeight;
  const ctx = out.getContext('2d')!;
  ctx.drawImage(htmlImg, 0, 0, out.width, out.height);
  ctx.drawImage(im.mask, 0, 0, out.width, out.height);
  return new Promise((resolve) => {
    out.toBlob((blob) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as string);
      fr.readAsDataURL(blob!);
    }, 'image/png');
  });
}
