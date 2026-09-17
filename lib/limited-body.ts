/** Reads a request/response body with a hard byte cap, for bodies whose
 *  content-length is missing or untrusted (e.g. chunked transfer-encoding). */
export async function readLimitedBody(
  source: { headers: Headers; body: ReadableStream<Uint8Array> | null },
  maxBytes: number,
): Promise<{ body: ArrayBuffer } | { tooLarge: true }> {
  const declared = Number(source.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return { tooLarge: true };
  if (!source.body) return { body: new ArrayBuffer(0) };

  const reader = source.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { tooLarge: true };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { body: bytes.buffer as ArrayBuffer };
}

export async function readLimitedText(
  source: { headers: Headers; body: ReadableStream<Uint8Array> | null },
  maxBytes: number,
): Promise<{ text: string } | { tooLarge: true }> {
  const limited = await readLimitedBody(source, maxBytes);
  if ('tooLarge' in limited) return limited;
  return { text: new TextDecoder().decode(limited.body) };
}
