import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertServerDefaultAccess, serverDefaultAccessAuthorized } from '@/lib/server-access';
import { addressIsPrivate, validateUpstreamBaseUrl } from '@/lib/upstream-security';

describe('server access and upstream security', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rejects private and metadata IP addresses', async () => {
    expect(addressIsPrivate('127.0.0.1')).toBe(true);
    expect(addressIsPrivate('169.254.169.254')).toBe(true);
    expect(addressIsPrivate('::1')).toBe(true);
    await expect(validateUpstreamBaseUrl('http://127.0.0.1:8080')).rejects.toThrow('SSRF');
  });

  it('allows a public literal IP and explicitly trusted private default', async () => {
    await expect(validateUpstreamBaseUrl('https://8.8.8.8')).resolves.toBe('https://8.8.8.8');
    await expect(validateUpstreamBaseUrl('http://127.0.0.1:8080', ['http://127.0.0.1:8080']))
      .resolves.toBe('http://127.0.0.1:8080');
  });

  it('requires the production server access token for default credentials', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SERVER_ACCESS_TOKEN', 'correct-token');
    expect(serverDefaultAccessAuthorized('wrong-token')).toBe(false);
    expect(() => assertServerDefaultAccess('wrong-token')).toThrow('无效');
    expect(() => assertServerDefaultAccess('correct-token')).not.toThrow();
  });

  it('supports an explicit anonymous-default opt-in', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ALLOW_ANONYMOUS_DEFAULT_API_KEY', 'true');
    expect(serverDefaultAccessAuthorized('')).toBe(true);
    expect(() => assertServerDefaultAccess('')).not.toThrow();
  });
});
