import { afterEach, describe, expect, it, vi } from 'vitest';
import { clientIp } from '@/lib/rate-limit';

function requestWithHeaders(headers: Record<string, string>) {
  return { headers: new Headers(headers) };
}

describe('clientIp', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('ignores forwarded headers without a declared trusted proxy', () => {
    // Without TRUST_PROXY the headers are attacker-controlled: honoring them
    // would mint a fresh rate-limit bucket per request.
    vi.stubEnv('TRUST_PROXY', '');
    expect(clientIp(requestWithHeaders({
      'x-forwarded-for': '1.2.3.4',
      'x-real-ip': '5.6.7.8',
    }))).toBe('direct');
  });

  it('uses the rightmost X-Forwarded-For entry behind a trusted proxy', () => {
    // nginx appends the real client IP at the right end; earlier entries are
    // client-supplied and spoofable.
    vi.stubEnv('TRUST_PROXY', '1');
    expect(clientIp(requestWithHeaders({
      'x-forwarded-for': '9.9.9.9, 8.8.8.8, 1.2.3.4',
    }))).toBe('1.2.3.4');
  });

  it('falls back to X-Real-IP then a shared unknown bucket when trusted', () => {
    vi.stubEnv('TRUST_PROXY', 'true');
    expect(clientIp(requestWithHeaders({ 'x-real-ip': '10.0.0.1' }))).toBe('10.0.0.1');
    expect(clientIp(requestWithHeaders({}))).toBe('unknown');
  });

  it('normalizes IPv6 spellings into one bucket', () => {
    vi.stubEnv('TRUST_PROXY', '1');
    expect(clientIp(requestWithHeaders({ 'x-forwarded-for': '[::1]' }))).toBe('::1');
    expect(clientIp(requestWithHeaders({ 'x-forwarded-for': '::1' }))).toBe('::1');
  });
});
