const buckets = new Map<string, number[]>();
const MAX_TRACKED_KEYS = 10_000;

function pruneStamps(stamps: number[], cutoff: number) {
  let index = 0;
  while (index < stamps.length && stamps[index] <= cutoff) index += 1;
  return index === 0 ? stamps : stamps.slice(index);
}

function sweepExpired(cutoff: number) {
  if (buckets.size <= MAX_TRACKED_KEYS) return;
  for (const [key, stamps] of buckets) {
    if (stamps.length === 0 || stamps[stamps.length - 1] <= cutoff) buckets.delete(key);
  }
  // Still over the cap: evict oldest keys (Map iterates in insertion order) so
  // an attacker cannot fill the table and disable limiting for everyone.
  for (const key of buckets.keys()) {
    if (buckets.size <= MAX_TRACKED_KEYS) break;
    buckets.delete(key);
  }
}

/** Records a hit and returns false once the key exceeds `limit` inside `windowMs`. */
export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const cutoff = now - windowMs;
  const stamps = pruneStamps(buckets.get(key) ?? [], cutoff);
  if (stamps.length >= limit) {
    buckets.set(key, stamps);
    sweepExpired(cutoff);
    return false;
  }
  stamps.push(now);
  buckets.set(key, stamps);
  sweepExpired(cutoff);
  return true;
}

/** Read-only check; pair with checkRateLimit to count only failures.
 *  Never inserts a new key, so it cannot grow the table by itself. */
export function isRateLimited(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const cutoff = now - windowMs;
  const existing = buckets.get(key);
  if (!existing) return false;
  const stamps = pruneStamps(existing, cutoff);
  if (stamps.length === 0) buckets.delete(key);
  else buckets.set(key, stamps);
  return stamps.length >= limit;
}

export function clientIp(request: { headers: Headers }): string {
  // Forwarded headers are only honored when the deployment declares a
  // trusted proxy (TRUST_PROXY=1) that overwrites/appends them — without
  // one, a client can mint a fresh bucket key per request and bypass every
  // rate limit. Next.js route handlers never expose the socket IP, so the
  // unproxied fallback is a shared 'direct' bucket: still protective of the
  // server, just not per-client.
  const trustedProxy = /^(1|true|yes)$/i.test(process.env.TRUST_PROXY || '');
  if (!trustedProxy) return 'direct';
  // nginx sets X-Forwarded-For via proxy_add_x_forwarded_for, which APPENDS
  // the real client IP at the right end; every earlier entry is
  // client-supplied and spoofable, so only the rightmost entry is trusted.
  const rightmost = request.headers.get('x-forwarded-for')
    ?.split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .pop();
  const raw = rightmost || request.headers.get('x-real-ip')?.trim() || 'unknown';
  // Normalize the bucket key (strip IPv6 brackets, lowercase) so equivalent
  // spellings like `[::1]` and `::1` share one rate-limit bucket.
  return raw.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
}
