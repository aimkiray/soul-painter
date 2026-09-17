export function canvasHasStrokes(canvas: HTMLCanvasElement | null): boolean {
  if (!canvas || canvas.width <= 0 || canvas.height <= 0) return false;
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  try {
    // Read the bitmap in horizontal bands so one getImageData call never
    // allocates the full RGBA buffer, and bail on the first opaque pixel.
    const bandHeight = 64;
    for (let y = 0; y < canvas.height; y += bandHeight) {
      const height = Math.min(bandHeight, canvas.height - y);
      const data = ctx.getImageData(0, y, canvas.width, height).data;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) return true;
    }
  } catch {
    // Tainted (cross-origin) canvases throw SecurityError on readback.
    return false;
  }
  return false;
}
