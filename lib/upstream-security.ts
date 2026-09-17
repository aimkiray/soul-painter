import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { normalizeUpstreamBaseUrl } from '@/lib/upstream-url';
import type { ResolvedAddress } from '@/lib/pinned-fetch';

function isTruthy(value: string | undefined) {
  return ['1', 'true', 'yes', 'on'].includes((value || '').trim().toLowerCase());
}

function configuredHostAllowlist() {
  return new Set(
    (process.env.UPSTREAM_HOST_ALLOWLIST || '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

function normalizedHostname(hostname: string) {
  return hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase().replace(/\.$/, '');
}

function ipv4IsPrivate(value: string) {
  const parts = value.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && (c === 0 || c === 2))
    || (a === 192 && b === 31 && c === 196)
    || (a === 192 && b === 52 && c === 193)
    || (a === 192 && b === 88 && c === 99)
    || (a === 192 && b === 168)
    || (a === 192 && b === 175 && c === 48)
    || (a === 198 && b >= 18 && b <= 19)
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224;
}

function ipv6IsPrivate(value: string) {
  const normalized = value.toLowerCase();
  if (normalized === '::' || normalized === '::1') return true;
  // Covers ::/128, ::ffff:0:0/96 (IPv4-mapped) and other deprecated v4-compatible forms.
  if (normalized.startsWith('::')) return true;
  if (normalized.startsWith('64:ff9b:')) return true; // NAT64 well-known/local-use prefixes
  if (/^(fc|fd|fe[89ab]|ff)/.test(normalized)) return true;
  if (normalized.startsWith('2001:db8:')) return true;
  return false;
}

export function addressIsPrivate(address: string) {
  const version = isIP(address);
  return version === 4 ? ipv4IsPrivate(address) : version === 6 ? ipv6IsPrivate(address) : true;
}

function isTrustedBaseUrl(baseUrl: string, trustedBaseUrls: string[]) {
  return trustedBaseUrls.some((value) => normalizeUpstreamBaseUrl(value) === baseUrl);
}

export interface ResolvedUpstreamBaseUrl {
  baseUrl: string;
  /** Validated addresses to pin DNS resolution to; empty means the host is trusted
   *  (env default / allowlisted) and callers may use a plain fetch. */
  addresses: ResolvedAddress[];
}

export async function resolveUpstreamBaseUrl(
  value: string,
  trustedBaseUrls: string[] = [],
): Promise<ResolvedUpstreamBaseUrl> {
  const baseUrl = normalizeUpstreamBaseUrl(value);
  if (!baseUrl) throw new Error('Base URL 无效或未配置。仅允许 http/https 协议。');
  if (isTrustedBaseUrl(baseUrl, trustedBaseUrls)) return { baseUrl, addresses: [] };

  const url = new URL(baseUrl);
  const hostname = normalizedHostname(url.hostname);
  const allowlist = configuredHostAllowlist();
  if (isTruthy(process.env.ALLOW_PRIVATE_UPSTREAMS) || allowlist.has(hostname)) {
    return { baseUrl, addresses: [] };
  }
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error('为防止 SSRF，不允许访问本机或本地域名。');
  }
  const literalFamily = isIP(hostname);
  if (literalFamily) {
    if (addressIsPrivate(hostname)) throw new Error('为防止 SSRF，不允许访问内网或保留 IP。');
    return { baseUrl, addresses: [{ address: hostname, family: literalFamily }] };
  }

  let addresses: ResolvedAddress[];
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error('无法解析 Base URL 的主机名。');
  }
  if (addresses.length === 0 || addresses.some(({ address }) => addressIsPrivate(address))) {
    throw new Error('为防止 SSRF，不允许访问解析到内网或保留 IP 的主机。');
  }
  return { baseUrl, addresses };
}

export async function validateUpstreamBaseUrl(value: string, trustedBaseUrls: string[] = []) {
  return (await resolveUpstreamBaseUrl(value, trustedBaseUrls)).baseUrl;
}

export function isSameUpstreamBaseUrl(value: string, expected: string) {
  const actual = normalizeUpstreamBaseUrl(value);
  const configured = normalizeUpstreamBaseUrl(expected);
  return !!actual && !!configured && actual === configured;
}
