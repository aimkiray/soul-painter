import { Agent, fetch as undiciFetch } from 'undici';
import type { RequestInit as UndiciRequestInit } from 'undici';
import type { LookupFunction } from 'node:net';

export interface ResolvedAddress {
  address: string;
  family: number;
}

// Dispatchers are pooled per validated address set so keep-alive connections are
// reused. The pool is bounded so hostile hostnames cannot grow it without limit.
const MAX_PINNED_DISPATCHERS = 128;
const pinnedDispatchers = new Map<string, Agent>();

export function createPinnedDispatcher(addresses: ResolvedAddress[]): Agent {
  const key = addresses
    .map((entry) => `${entry.address}/${entry.family}`)
    .sort()
    .join('|');
  const cached = pinnedDispatchers.get(key);
  if (cached && !cached.closed && !cached.destroyed) {
    // Refresh recency for LRU eviction.
    pinnedDispatchers.delete(key);
    pinnedDispatchers.set(key, cached);
    return cached;
  }

  const lookup: LookupFunction = (_hostname, options, callback) => {
    if (options.all) {
      callback(null, addresses.map(({ address, family }) => ({ address, family })));
      return;
    }
    const first = addresses[0];
    callback(null, first.address, first.family);
  };
  const dispatcher = new Agent({ connect: { lookup } });
  pinnedDispatchers.set(key, dispatcher);
  while (pinnedDispatchers.size > MAX_PINNED_DISPATCHERS) {
    const oldestKey = pinnedDispatchers.keys().next().value;
    if (oldestKey === undefined || oldestKey === key) break;
    const oldest = pinnedDispatchers.get(oldestKey);
    pinnedDispatchers.delete(oldestKey);
    void oldest?.close().catch(() => undefined);
  }
  return dispatcher;
}

/** Fetch with DNS pinned to already-validated addresses, closing the lookup/resolve TOCTOU gap.
 *  An empty address list falls back to a regular fetch (trusted server-side targets). */
export function fetchPinned(
  url: string | URL,
  init: RequestInit,
  addresses: ResolvedAddress[],
): Promise<Response> {
  if (addresses.length === 0) return fetch(url, init);
  return undiciFetch(url, {
    ...(init as UndiciRequestInit),
    dispatcher: createPinnedDispatcher(addresses),
  }) as unknown as Promise<Response>;
}
