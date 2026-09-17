import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { ipIsPrivate } from '@/lib/ip-private';
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

export function addressIsPrivate(address: string) {
  // Byte-level classification lives in ip-private.ts so expanded IPv6 forms
  // (v4-mapped/v4-compatible, 6to4, Teredo, NAT64…) cannot slip past prefix
  // string checks.
  return ipIsPrivate(address);
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
