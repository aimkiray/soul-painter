import { normalizeToDataUrl } from './base64';
import { ImageHit } from '@/types';

// URL-ish fields arrive either as a bare string or wrapped as { url }
// (the real OpenAI image_url shape) — accept both.
function unwrapUrlish(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const nested = (value as Record<string, unknown>).url;
    if (typeof nested === 'string') return nested;
  }
  return null;
}

function findImageInText(text: string): ImageHit | null {
  if (typeof text !== 'string') return null;
  const im = text.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (im) {
    const u = im[1];
    if (u.startsWith('data:')) {
      try { return { dataUrl: normalizeToDataUrl(u).dataUrl }; } catch { /* ignore */ }
    } else if (u.startsWith('http')) return { url: u };
  }
  // A corrupt candidate must not hide a later valid one — walk every match.
  for (const dm of text.matchAll(/(?:data:image\/[a-z]+;base64,)+([A-Za-z0-9+/=\s]+)/gi)) {
    const cleaned = dm[1].replace(/\s+/g, '');
    const b64 = (/^[A-Za-z0-9+/]*={0,2}/.exec(cleaned) || [''])[0];
    if (b64) {
      try { return { dataUrl: normalizeToDataUrl(b64).dataUrl }; } catch { /* try the next match */ }
    }
  }
  const md = text.match(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/);
  if (md) return { url: md[1] };
  const bu = text.match(/https?:\/\/[^\s"'<>)]+\.(?:png|jpe?g|gif|webp)(?:\?[^\s"'<>)]*)?/i);
  if (bu) return { url: bu[0] };
  for (const bb of text.matchAll(/[A-Za-z0-9+/=]{200,}/g)) {
    try { return { dataUrl: normalizeToDataUrl(bb[0]).dataUrl }; } catch { /* try the next match */ }
  }
  return null;
}

export function extractImage(resp: unknown): ImageHit | null {
  if (resp && Array.isArray((resp as Record<string, unknown>).output)) {
    for (const item of (resp as Record<string, unknown[]>).output) {
      if (item && (item as Record<string, unknown>).type === 'image_generation_call' && (item as Record<string, unknown>).result) {
        try { return { dataUrl: normalizeToDataUrl((item as Record<string, string>).result).dataUrl }; } catch { /* ignore */ }
      }
      if (item && (item as Record<string, unknown>).type === 'message' && Array.isArray((item as Record<string, unknown>).content)) {
        for (const part of (item as { content: Record<string, unknown>[] }).content) {
          if (part && part.type === 'output_image') {
            const u = unwrapUrlish(part.image_url) || unwrapUrlish(part.url)
              || unwrapUrlish(part.b64_json) || unwrapUrlish(part.image);
            if (typeof u === 'string') {
              if (u.startsWith('data:') || u.startsWith('http')) {
                try { return u.startsWith('data:') ? { dataUrl: normalizeToDataUrl(u).dataUrl } : { url: u }; } catch { /* ignore */ }
              } else {
                try { return { dataUrl: normalizeToDataUrl(u).dataUrl }; } catch { /* ignore */ }
              }
            }
          }
          if (part && typeof part.text === 'string') {
            const hit = findImageInText(part.text as string);
            if (hit) return hit;
          }
        }
      }
    }
  }
  if (resp && Array.isArray((resp as Record<string, unknown>).data)) {
    for (const item of (resp as Record<string, unknown[]>).data as (Record<string, string> | null)[]) {
      if (!item || typeof item !== 'object') continue;
      if (item.url) return { url: item.url };
      if (item.b64_json) {
        try { return { dataUrl: normalizeToDataUrl(item.b64_json).dataUrl }; } catch { /* ignore */ }
      }
    }
  }
  if (resp && Array.isArray((resp as Record<string, unknown>).choices)) {
    for (const c of (resp as Record<string, unknown[]>).choices as unknown[]) {
      if (!c || typeof c !== 'object') continue;
      const choice = c as Record<string, unknown>;
      const msg = (choice.message ?? choice.delta) as Record<string, unknown> | undefined;
      if (!msg || typeof msg !== 'object') continue;
      const sideChannels: unknown[] = [];
      if (Array.isArray(msg.images)) sideChannels.push(...(msg.images as unknown[]));
      if (msg.image) sideChannels.push(msg.image);
      if (Array.isArray(msg.attachments)) sideChannels.push(...(msg.attachments as unknown[]));
      for (const item of sideChannels) {
        if (typeof item === 'string') {
          if (item.startsWith('data:')) { try { return { dataUrl: normalizeToDataUrl(item).dataUrl }; } catch { /* ignore */ } }
          else if (item.startsWith('http')) return { url: item };
        } else if (item && typeof item === 'object') {
          const rec = item as Record<string, unknown>;
          const u = unwrapUrlish(rec.url) || unwrapUrlish(rec.image_url) || unwrapUrlish(rec.b64_json) || unwrapUrlish(rec.image) || unwrapUrlish(rec.src);
          if (typeof u === 'string') {
            if (u.startsWith('data:')) { try { return { dataUrl: normalizeToDataUrl(u).dataUrl }; } catch { /* ignore */ } }
            else if (u.startsWith('http')) return { url: u };
            else { try { return { dataUrl: normalizeToDataUrl(u).dataUrl }; } catch { /* ignore */ } }
          }
        }
      }
      const content = msg.content;
      if (typeof content === 'string') {
        const hit = findImageInText(content);
        if (hit) return hit;
      } else if (Array.isArray(content)) {
        for (const part of content as (Record<string, unknown> | null)[]) {
          if (!part || typeof part !== 'object') continue;
          if (part.type === 'image_url' && part.image_url) {
            const u = typeof part.image_url === 'string' ? part.image_url : (part.image_url as Record<string, string>).url;
            if (u) {
              if (u.startsWith('data:')) {
                try { return { dataUrl: normalizeToDataUrl(u).dataUrl }; } catch { /* ignore */ }
              } else return { url: u };
            }
          }
          if (typeof part.text === 'string') {
            const hit = findImageInText(part.text as string);
            if (hit) return hit;
          }
        }
      }
    }
  }
  return findImageInText(JSON.stringify(resp));
}
