import {
  OFFICIAL_IMAGE_MAX_EDGE,
  OFFICIAL_IMAGE_MAX_PIXELS,
  OFFICIAL_IMAGE_MAX_RATIO,
  OFFICIAL_IMAGE_MIN_PIXELS,
  OFFICIAL_IMAGE_SIZE_MULTIPLE,
  SIZE_PRESETS,
  ORIGINAL_ASPECT_SIZE,
} from './constants';

export interface Dimensions {
  naturalWidth: number;
  naturalHeight: number;
}

export function parseSize(size: string): Dimensions | null {
  const match = /^(\d+)x(\d+)$/i.exec(size);
  if (!match) return null;
  const naturalWidth = parseInt(match[1], 10);
  const naturalHeight = parseInt(match[2], 10);
  if (!naturalWidth || !naturalHeight) return null;
  return { naturalWidth, naturalHeight };
}

export function fitToOfficialImageBounds(
  width: number,
  height: number,
  maxEdge = OFFICIAL_IMAGE_MAX_EDGE,
): { width: number; height: number } {
  const safeWidth = Math.max(1, Math.round(width || 1));
  const safeHeight = Math.max(1, Math.round(height || 1));
  const scale = Math.min(1, maxEdge / Math.max(safeWidth, safeHeight));
  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale)),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function buildBestSupportedSize(width: number, height: number): { width: number; height: number } {
  const safeWidth = Math.max(1, Math.round(width || 1));
  const safeHeight = Math.max(1, Math.round(height || 1));
  const rawRatio = safeWidth / safeHeight;
  const ratio = clamp(rawRatio, 1 / OFFICIAL_IMAGE_MAX_RATIO, OFFICIAL_IMAGE_MAX_RATIO);
  const targetArea = clamp(safeWidth * safeHeight, OFFICIAL_IMAGE_MIN_PIXELS, OFFICIAL_IMAGE_MAX_PIXELS);
  const landscape = ratio >= 1;
  let best: { width: number; height: number; score: number } | null = null;

  for (let longSide = OFFICIAL_IMAGE_SIZE_MULTIPLE; longSide <= OFFICIAL_IMAGE_MAX_EDGE; longSide += OFFICIAL_IMAGE_SIZE_MULTIPLE) {
    const derivedShort = landscape
      ? Math.round((longSide / ratio) / OFFICIAL_IMAGE_SIZE_MULTIPLE) * OFFICIAL_IMAGE_SIZE_MULTIPLE
      : Math.round((longSide * ratio) / OFFICIAL_IMAGE_SIZE_MULTIPLE) * OFFICIAL_IMAGE_SIZE_MULTIPLE;
    const shortSide = Math.max(OFFICIAL_IMAGE_SIZE_MULTIPLE, derivedShort);
    const candidateWidth = landscape ? longSide : shortSide;
    const candidateHeight = landscape ? shortSide : longSide;
    const candidateArea = candidateWidth * candidateHeight;
    const candidateRatio = candidateWidth / candidateHeight;

    if (Math.max(candidateWidth, candidateHeight) > OFFICIAL_IMAGE_MAX_EDGE) continue;
    if (candidateArea < OFFICIAL_IMAGE_MIN_PIXELS || candidateArea > OFFICIAL_IMAGE_MAX_PIXELS) continue;
    if (candidateRatio > OFFICIAL_IMAGE_MAX_RATIO || candidateHeight / candidateWidth > OFFICIAL_IMAGE_MAX_RATIO) continue;

    const score =
      Math.abs(Math.log(candidateRatio / ratio)) * 100 +
      Math.abs(Math.log(candidateArea / targetArea));
    if (!best || score < best.score) {
      best = { width: candidateWidth, height: candidateHeight, score };
    }
  }

  if (best) return { width: best.width, height: best.height };
  return fitToOfficialImageBounds(safeWidth, safeHeight);
}

export function resolveRequestSize(
  size: string,
  references: Dimensions[],
  fallback = '1024x1024',
): string {
  if (size === 'auto') return 'auto';
  if (size === ORIGINAL_ASPECT_SIZE && references.length === 0) return 'auto';
  const parsed = parseSize(size);
  if (parsed) {
    const fitted = buildBestSupportedSize(parsed.naturalWidth, parsed.naturalHeight);
    return `${fitted.width}x${fitted.height}`;
  }

  const source = size === ORIGINAL_ASPECT_SIZE
    ? references.find((img) => img.naturalWidth > 0 && img.naturalHeight > 0)
    : parseSize(fallback);

  const fitted = source
    ? buildBestSupportedSize(source.naturalWidth, source.naturalHeight)
    : buildBestSupportedSize(1024, 1024);
  return `${fitted.width}x${fitted.height}`;
}

export function formatSizeDisplay(size: string, references: Dimensions[]): string {
  if (size === ORIGINAL_ASPECT_SIZE) {
    const resolved = resolveRequestSize(size, references);
    return `原图比例 · ${parseSize(resolved) ? resolved : 'auto'}`;
  }
  return SIZE_PRESETS.find((preset) => preset.value === size)?.label || size;
}
