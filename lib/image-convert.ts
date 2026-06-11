import sharp from 'sharp';

export type ImageFormat = 'png' | 'jpeg' | 'webp';

export async function convertResponseImages(
  responseBody: string,
  targetFormat: ImageFormat,
  compression: number,
): Promise<string> {
  if (targetFormat === 'webp') return responseBody;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(responseBody);
  } catch {
    return responseBody;
  }

  const data = parsed.data;
  if (!Array.isArray(data)) return responseBody;

  let changed = false;
  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;

    if (typeof entry.b64_json === 'string') {
      const converted = await convertBase64(entry.b64_json as string, targetFormat, compression);
      if (converted) {
        entry.b64_json = converted;
        changed = true;
      }
    } else if (typeof entry.url === 'string' && (entry.url as string).startsWith('http')) {
      const converted = await convertFromUrl(entry.url as string, targetFormat, compression);
      if (converted) {
        delete entry.url;
        entry.b64_json = converted;
        changed = true;
      }
    }
  }

  return changed ? JSON.stringify(parsed) : responseBody;
}

async function convertBase64(
  b64: string,
  format: ImageFormat,
  compression: number,
): Promise<string | null> {
  try {
    const buf = Buffer.from(b64, 'base64');
    const converted = await applyFormat(sharp(buf), format, compression).toBuffer();
    return converted.toString('base64');
  } catch {
    return null;
  }
}

async function convertFromUrl(
  url: string,
  format: ImageFormat,
  compression: number,
): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const converted = await applyFormat(sharp(buf), format, compression).toBuffer();
    return converted.toString('base64');
  } catch {
    return null;
  }
}

function applyFormat(pipeline: sharp.Sharp, format: ImageFormat, compression: number): sharp.Sharp {
  switch (format) {
    case 'png':
      return pipeline.png();
    case 'jpeg':
      return pipeline.jpeg({ quality: compression || 80 });
    default:
      return pipeline.webp({ quality: compression || 80 });
  }
}
