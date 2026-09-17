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
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip')?.trim() || 'unknown';
}
