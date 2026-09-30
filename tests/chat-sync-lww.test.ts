import { describe, expect, it } from 'vitest';
import { acceptClientEntityStamp } from '@/lib/chat-sync-lww';

describe('acceptClientEntityStamp', () => {
  it('accepts a brand-new entity even when its stamp sits below the cursor', () => {
    // Slow-clock client: entity stamp (client domain) < committed cursor
    // (server domain). There is no stored row to lose LWW against, so the
    // cursor must not reject it — the entity would stay syncDirty forever.
    expect(acceptClientEntityStamp(100, 500, null)).toBe(true);
    expect(acceptClientEntityStamp(100, 500, undefined)).toBe(true);
  });

  it('rejects a push strictly older than the stored row', () => {
    expect(acceptClientEntityStamp(100, 0, 200)).toBe(false);
    expect(acceptClientEntityStamp(100, 500, 200)).toBe(false);
  });

  it('accepts a push newer than the stored row regardless of the cursor', () => {
    // Slow-clock edit of an existing row: beats rowClientStamp but sits
    // below the server cursor — must still apply.
    expect(acceptClientEntityStamp(300, 500, 200)).toBe(true);
    expect(acceptClientEntityStamp(300, 0, 200)).toBe(true);
  });

  it('skips equal-stamp rewrites already covered by the cursor', () => {
    expect(acceptClientEntityStamp(200, 500, 200)).toBe(false);
    expect(acceptClientEntityStamp(200, 100, 200)).toBe(true);
  });
});
