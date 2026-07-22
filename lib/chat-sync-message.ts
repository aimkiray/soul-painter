import type { ChatTurnSnapshot } from '@/contexts/ChatContext';
import { normalizeStoredTurnSnapshot } from '@/lib/storage/chat-normalize';

const SYNC_MESSAGE_PREFIX = 'chat-sync-v1:';

interface SyncMessageMetadata {
  extra: string;
  thinking: string;
  thinkingDone: boolean;
  request?: ChatTurnSnapshot;
  editedAt?: number;
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function encodeSyncMessageMetadata(value: Record<string, unknown>) {
  const metadata: SyncMessageMetadata = {
    extra: typeof value.extra === 'string' ? value.extra : '',
    thinking: typeof value.thinking === 'string' ? value.thinking : '',
    thinkingDone: typeof value.thinkingDone === 'boolean' ? value.thinkingDone : true,
    request: normalizeStoredTurnSnapshot(value.request),
    editedAt: finiteNumber(value.editedAt),
  };
  return `${SYNC_MESSAGE_PREFIX}${JSON.stringify(metadata)}`;
}

export function decodeSyncMessageMetadata(value: string): SyncMessageMetadata {
  if (!value.startsWith(SYNC_MESSAGE_PREFIX)) {
    return { extra: value, thinking: '', thinkingDone: true };
  }
  try {
    const parsed = JSON.parse(value.slice(SYNC_MESSAGE_PREFIX.length)) as Record<string, unknown>;
    return {
      extra: typeof parsed.extra === 'string' ? parsed.extra : '',
      thinking: typeof parsed.thinking === 'string' ? parsed.thinking : '',
      thinkingDone: typeof parsed.thinkingDone === 'boolean' ? parsed.thinkingDone : true,
      request: normalizeStoredTurnSnapshot(parsed.request),
      editedAt: finiteNumber(parsed.editedAt),
    };
  } catch {
    return { extra: '', thinking: '', thinkingDone: true };
  }
}
