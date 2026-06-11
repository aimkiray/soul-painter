import { normalizeToDataUrl } from './base64';
import { ImageHit } from '@/types';

function findImageInText(text: string): ImageHit | null {
  if (typeof text !== 'string') return null;
  const im = text.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (im) {
    const u = im[1];
    if (u.startsWith('data:')) {
      try { return { dataUrl: normalizeToDataUrl(u).dataUrl }; } catch { /* ignore */ }
    } else if (u.startsWith('http')) return { url: u };
  }
  const dm = text.match(/(?:data:image\/[a-z]+;base64,)+([A-Za-z0-9+/=\s]+?)(?=["'\s<)]|$)/i);
  if (dm) {
    try { return { dataUrl: normalizeToDataUrl(dm[0]).dataUrl }; } catch { /* ignore */ }
  }
  const md = text.match(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/);
  if (md) return { url: md[1] };
  const bu = text.match(/https?:\/\/[^\s"'<>)]+\.(?:png|jpe?g|gif|webp)(?:\?[^\s"'<>)]*)?/i);
  if (bu) return { url: bu[0] };
  const bb = text.match(/[A-Za-z0-9+/=]{200,}/);
  if (bb) {
    try { return { dataUrl: normalizeToDataUrl(bb[0]).dataUrl }; } catch { /* ignore */ }
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
            const u = part.image_url || part.url || part.b64_json || part.image;
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
    for (const item of (resp as Record<string, unknown[]>).data as Record<string, string>[]) {
      if (item.url) return { url: item.url };
      if (item.b64_json) {
        try { return { dataUrl: normalizeToDataUrl(item.b64_json).dataUrl }; } catch { /* ignore */ }
      }
    }
  }
  if (resp && Array.isArray((resp as Record<string, unknown>).choices)) {
    for (const c of (resp as Record<string, unknown[]>).choices as Record<string, unknown>[]) {
      const msg = (c.message || c.delta) as Record<string, unknown>;
      const sideChannels: unknown[] = [];
      if (Array.isArray(msg.images)) sideChannels.push(...(msg.images as unknown[]));
      if (msg.image) sideChannels.push(msg.image);
      if (Array.isArray(msg.attachments)) sideChannels.push(...(msg.attachments as unknown[]));
      for (const item of sideChannels) {
        if (typeof item === 'string') {
          if (item.startsWith('data:')) { try { return { dataUrl: normalizeToDataUrl(item).dataUrl }; } catch { /* ignore */ } }
          else if (item.startsWith('http')) return { url: item };
        } else if (item && typeof item === 'object') {
          const u = (item as Record<string, string>).url || (item as Record<string, string>).image_url || (item as Record<string, string>).b64_json || (item as Record<string, string>).image || (item as Record<string, string>).src;
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
        for (const part of content as Record<string, unknown>[]) {
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
