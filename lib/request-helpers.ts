import { USER_ABORT_SENTINEL } from '@/lib/api';
import { CHAT_SYNC_AUTH_STORAGE_KEY } from '@/lib/constants';
import { parseErrorDetail } from '@/lib/api-parsers';

export type RequestBody = Record<string, unknown> | FormData;

export function setRequestParam(target: RequestBody, key: string, value: unknown) {
  if (target instanceof FormData) {
    target.set(key, String(value));
    return;
  }
  target[key] = value;
}

export function deleteRequestParam(target: RequestBody, key: string) {
  if (target instanceof FormData) {
    target.delete(key);
    return;
  }
  delete target[key];
}

export function getFormImageCount(form: FormData) {
  return form.getAll('image[]').filter((value) => value instanceof Blob).length;
}

export function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw new Error(USER_ABORT_SENTINEL);
}

export function abortableDelay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error(USER_ABORT_SENTINEL));
      return;
    }

    const timeoutId = setTimeout(() => {
      signal.removeEventListener('abort', handleAbort);
      resolve();
    }, ms);

    const handleAbort = () => {
      clearTimeout(timeoutId);
      reject(new Error(USER_ABORT_SENTINEL));
    };

    signal.addEventListener('abort', handleAbort, { once: true });
  });
}

export const REQUEST_MAX_ATTEMPTS = 3;
export const REQUEST_RETRY_DELAYS_MS = [4000, 8000] as const;

export interface RequestFailureResult {
  status: number;
  statusText: string;
  text: string;
}

export class RequestStatusError extends Error {
  status: number;

  constructor(result: RequestFailureResult) {
    const detail = parseErrorDetail(result.text) || result.statusText || '请求失败';
    super(result.status ? `HTTP ${result.status} ${detail}` : detail);
    this.name = 'RequestStatusError';
    this.status = result.status;
  }
}

export class RequestAttemptsExhaustedError extends Error {
  constructor(error: unknown) {
    super(buildFinalFailureMessage(errorMessage(error)));
    this.name = 'RequestAttemptsExhaustedError';
  }
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || '请求失败');
}

export function errorStatus(error: unknown) {
  if (error instanceof RequestStatusError) return error.status;
  const match = /^HTTP\s+(\d+)/i.exec(errorMessage(error));
  return match ? Number(match[1]) : null;
}

export function isRetryableRequestError(error: unknown) {
  const message = errorMessage(error);
  if (message === USER_ABORT_SENTINEL) return true;
  if (/no available channel for model/i.test(message)) return false;

  const status = errorStatus(error);
  if (status !== null) {
    return status === 0 || status === 408 || status === 429 || (status >= 500 && status < 600);
  }

  return /timeout|timed out|network|fetch|failed|超时|响应中未找到图片|响应为空|无响应/i.test(message);
}

export function buildFinalFailureMessage(message: string) {
  return `请求失败，已自动重试 ${REQUEST_MAX_ATTEMPTS - 1} 次仍未成功。\n${message || '上游未返回有效结果'}`;
}

export function readSyncUsername() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CHAT_SYNC_AUTH_STORAGE_KEY) || 'null');
    return typeof parsed?.username === 'string' ? parsed.username.trim() : '';
  } catch {
    return '';
  }
}
