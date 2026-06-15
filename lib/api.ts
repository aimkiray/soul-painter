import { AppConfig, AppOptions } from '@/types';

type ProxyKind = 'image' | 'chat';

function getHeaders(config: AppConfig, kind: ProxyKind = 'image', isFormData = false) {
  const apiKey = kind === 'chat' ? (config.chatApiKey || config.apiKey) : config.apiKey;
  const baseUrl = kind === 'chat' ? (config.chatBaseUrl || config.baseUrl) : config.baseUrl;
  const headers: Record<string, string> = {
    'Accept': 'application/json',
  };
  if (!isFormData) headers['Content-Type'] = 'application/json';
  if (apiKey) headers['x-api-key'] = apiKey;
  if (baseUrl) headers['x-base-url'] = baseUrl;
  return headers;
}

function stripSSEComments(text: string): string {
  return text.split('\n').filter(line => !line.startsWith(':')).join('\n').trim();
}

export const USER_ABORT_SENTINEL = '__USER_ABORT__';

export async function proxyRequestStream(
  endpoint: string,
  config: AppConfig,
  body: unknown,
  options: AppOptions,
  externalSignal?: AbortSignal,
  kind: ProxyKind = 'image',
): Promise<{ ok: boolean; status: number; stream: ReadableStream<Uint8Array> | null; text: string }> {
  const isFormData = body instanceof FormData;
  const headers = getHeaders(config, kind, isFormData);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeout * 1000);

  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timeoutId);
      throw new Error(USER_ABORT_SENTINEL);
    }
    externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: isFormData ? body : JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok || !res.body) {
      const text = await res.text();
      clearTimeout(timeoutId);
      return { ok: false, status: res.status, stream: null, text };
    }

    clearTimeout(timeoutId);
    return { ok: true, status: res.status, stream: res.body, text: '' };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      if (externalSignal?.aborted) throw new Error(USER_ABORT_SENTINEL);
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
  kind: ProxyKind = 'image',
  externalSignal?: AbortSignal,
) {
  const isFormData = body instanceof FormData;
  const headers = getHeaders(config, kind, isFormData);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeout * 1000);

  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timeoutId);
      throw new Error(USER_ABORT_SENTINEL);
    }
    externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: isFormData ? body : JSON.stringify(body),
      signal: controller.signal,
    });

    const rawText = await res.text();
    const cleaned = stripSSEComments(rawText);

    const sseErrorMatch = cleaned.match(/^data:\s*(\{.+\})\s*$/m);
    if (sseErrorMatch) {
      try {
        const evt = JSON.parse(sseErrorMatch[1]);
        if (evt.error) {
          return { ok: false, status: evt.status || 500, statusText: '', text: evt.message || cleaned };
        }
      } catch { /* not an SSE error */ }
    }

    const text = cleaned;
    return { ok: res.ok, status: res.status, statusText: res.statusText, text };
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      if (externalSignal?.aborted) throw new Error(USER_ABORT_SENTINEL);
      throw new Error(`请求超时 (${options.timeout}s)。可在设置中调大超时秒数。`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
