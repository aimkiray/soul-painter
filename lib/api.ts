import { AppConfig, AppOptions } from '@/types';

function getHeaders(config: AppConfig, multipart = false) {
  const headers: Record<string, string> = {
    'Accept': 'application/json',
  };
  if (config.apiKey) headers['x-api-key'] = config.apiKey;
  if (config.baseUrl) headers['x-base-url'] = config.baseUrl;
  if (!multipart) headers['Content-Type'] = 'application/json';
  return headers;
}

export async function proxyRequestStream(
  endpoint: string,
  config: AppConfig,
  body: unknown,
  options: AppOptions,
): Promise<{ ok: boolean; status: number; stream: ReadableStream<Uint8Array> | null; text: string }> {
  const headers = getHeaders(config, false);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeout * 1000);

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok || !res.body) {
      const text = await res.text();
      clearTimeout(timeoutId);
      return { ok: false, status: res.status, stream: null, text };
    }

    return { ok: true, status: res.status, stream: res.body, text: '' };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`请求超时 (${options.timeout}s)。可在设置中调大超时秒数。`);
    }
    throw err;
  }
}

export async function proxyRequest(
  endpoint: string,
  config: AppConfig,
  body: unknown,
  options: AppOptions,
  multipart = false,
) {
  const headers = getHeaders(config, multipart);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeout * 1000);

  try {
    let res: Response;
    if (multipart && body instanceof FormData) {
      res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });
    } else {
      res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    }

    const text = await res.text();
    return { ok: res.ok, status: res.status, statusText: res.statusText, text };
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`请求超时 (${options.timeout}s)。可在设置中调大超时秒数。`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
