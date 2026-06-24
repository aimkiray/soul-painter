import { ImageHit } from '@/types';
import { HISTORY_STORAGE_KEY, HISTORY_MAX } from '@/lib/constants';
import { imageHitToStoredUrl } from '@/lib/chat-asset-client';

import { get, set } from 'idb-keyval';

export async function saveHistoryEntry(
  prompt: string,
  mode: string,
  model: string,
  size: string,
  hits: ImageHit[],
) {
  try {
    const storedHits = (await Promise.all(hits.map((hit) => imageHitToStoredUrl(hit))))
      .filter((url): url is string => !!url)
      .map((url) => ({ link: url, isData: false }));
    if (storedHits.length === 0) return;

    const raw = await get(HISTORY_STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    const entry = {
      prompt,
      mode,
      model,
      size,
      n: storedHits.length,
      hits: storedHits,
      id: Math.random().toString(36).slice(2, 10),
      ts: Date.now(),
    };
    list.unshift(entry);
    while (list.length > HISTORY_MAX) list.pop();
    await set(HISTORY_STORAGE_KEY, JSON.stringify(list));
  } catch { /* ignore */ }
}
