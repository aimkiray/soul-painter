import { timingSafeEqual } from 'node:crypto';

function isTruthy(value: string | undefined) {
  return ['1', 'true', 'yes', 'on'].includes((value || '').trim().toLowerCase());
}

export function allowAnonymousDefaultApiKey() {
  return isTruthy(process.env.ALLOW_ANONYMOUS_DEFAULT_API_KEY);
}

export function serverDefaultAccessRequired() {
  return process.env.NODE_ENV === 'production' && !allowAnonymousDefaultApiKey();
}

export function hasServerAccessToken() {
  return !!process.env.SERVER_ACCESS_TOKEN?.trim();
}

export function isServerAccessTokenValid(value: string | null | undefined) {
  const expected = process.env.SERVER_ACCESS_TOKEN?.trim() || '';
  if (!expected || !value) return false;
  const actualBuffer = Buffer.from(value.trim());
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function assertServerDefaultAccess(value: string | null | undefined) {
  if (serverDefaultAccessAuthorized(value)) return;
  if (!hasServerAccessToken()) {
    throw new Error('服务端默认 API Key 已禁用，请配置 SERVER_ACCESS_TOKEN。');
  }
  throw new Error('缺少或无效的服务端访问令牌。');
}

export function serverDefaultAccessAuthorized(value: string | null | undefined) {
  return !serverDefaultAccessRequired() || isServerAccessTokenValid(value);
}
