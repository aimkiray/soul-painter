'use client';

import React, { useState } from 'react';
import { useChat } from '@/contexts/ChatContext';
import { CHAT_SYNC_AUTH_STORAGE_KEY, CHAT_SYNC_SESSION_AUTH_STORAGE_KEY } from '@/lib/constants';
import { useWindowDrag } from '@/hooks/useWindowDrag';
import Modal from './Modal';

interface LoginModalProps {
  open: boolean;
  onClose: () => void;
  onAuthChange?: (username: string) => void;
}

interface StoredSyncAuth {
  username: string;
  syncedAt?: number;
}

function readStoredAuth(): StoredSyncAuth | null {
  if (typeof window === 'undefined') return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(CHAT_SYNC_AUTH_STORAGE_KEY) || 'null');
    if (!parsed || typeof parsed !== 'object') return null;
    const username = typeof parsed.username === 'string' ? parsed.username : '';
    if (!username) return null;
    return {
      username,
      syncedAt: typeof parsed.syncedAt === 'number' ? parsed.syncedAt : undefined,
    };
  } catch {
    return null;
  }
}

function readSessionAuth(username: string): { secret: string; syncedAt?: number } | null {
  if (typeof window === 'undefined') return null;
  try {
    const parsed = JSON.parse(sessionStorage.getItem(CHAT_SYNC_SESSION_AUTH_STORAGE_KEY) || 'null');
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.username !== 'string' || parsed.username !== username) return null;
    const secret = typeof parsed.secret === 'string' ? parsed.secret : '';
    if (!secret) return null;
    return {
      secret,
      syncedAt: typeof parsed.syncedAt === 'number' ? parsed.syncedAt : undefined,
    };
  } catch {
    return null;
  }
}

function formatSyncTime(value?: number) {
  if (!value) return 'NO DATA';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return 'UNKNOWN';
  }
}

function loginStatusBox(message: string) {
  const status = `STATUS: ${message.toUpperCase()}`.slice(0, 24).padEnd(24, ' ');
  return [
    '╔══════════════════════════╗',
    `║ ${'CHAT SYNC: READY'.padEnd(24, ' ')} ║`,
    `║ ${status} ║`,
    '╚══════════════════════════╝',
  ].join('\n');
}

function loginStatusColor(message: string) {
  return message === 'AUTH FAILED' ? 'text-error' : 'text-theme-fg';
}

function clearAssetSessionCookie() {
  void fetch('/api/chat-assets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'clear-session' }),
  }).catch(() => undefined);
}

export default function LoginModal({ open, onClose, onAuthChange }: LoginModalProps) {
  const { syncChatHistory, setStatus } = useChat();
  const { dragStyle, onTitlePointerDown } = useWindowDrag();
  const [initialAuth] = useState(readStoredAuth);
  const [initialSessionAuth] = useState(() => readSessionAuth(initialAuth?.username || ''));
  const [username, setUsername] = useState(initialAuth?.username || '');
  const [secret, setSecret] = useState(initialSessionAuth?.secret || '');
  const [syncedAt, setSyncedAt] = useState<number | undefined>(initialSessionAuth?.syncedAt || initialAuth?.syncedAt);
  const [message, setMessage] = useState(initialSessionAuth ? 'AUTO SYNC ON' : initialAuth ? 'SAVE SLOT FOUND' : 'READY');
  const [syncing, setSyncing] = useState(false);

  if (!open) return null;

  const syncHistory = async () => {
    const cleanUsername = username.trim();
    const cleanSecret = secret.trim();
    if (!cleanUsername || cleanSecret.length < 4) {
      setMessage('FILL FORM');
      return;
    }

    setSyncing(true);
    setMessage('CONNECTING...');
    try {
      const result = await syncChatHistory({ username: cleanUsername, secret: cleanSecret, clientKnownUpdatedAt: syncedAt || 0 });
      const nextSyncedAt = result.applied ? result.updatedAt || Date.now() : syncedAt;
      const syncedUsername = result.username || cleanUsername;
      localStorage.setItem(CHAT_SYNC_AUTH_STORAGE_KEY, JSON.stringify({
        username: syncedUsername,
        syncedAt: nextSyncedAt,
      }));
      sessionStorage.setItem(CHAT_SYNC_SESSION_AUTH_STORAGE_KEY, JSON.stringify({
        username: syncedUsername,
        secret: cleanSecret,
        syncedAt: nextSyncedAt,
      }));
      if (result.applied) setSyncedAt(nextSyncedAt);
      onAuthChange?.(syncedUsername);
      setMessage(result.assetMigrationWarning ? 'SYNC WARNING' : result.applied ? 'SYNC COMPLETE' : 'SYNC QUEUED');
      setStatus(
        result.assetMigrationWarning || (result.applied ? '聊天记录已同步' : '聊天已更新，将继续后台同步'),
        result.assetMigrationWarning || !result.applied ? 'warn' : 'ok',
      );
    } catch (error) {
      const syncError = error as Error & { status?: number };
      const text = syncError.message || 'SYNC FAILED';
      const authRejected = syncError.status === 401 || syncError.status === 409;
      if (authRejected) {
        clearAssetSessionCookie();
        localStorage.removeItem(CHAT_SYNC_AUTH_STORAGE_KEY);
        sessionStorage.removeItem(CHAT_SYNC_SESSION_AUTH_STORAGE_KEY);
        setSyncedAt(undefined);
        onAuthChange?.('');
      }
      setMessage(authRejected ? 'AUTH FAILED' : 'SYNC FAILED');
      setStatus(text, 'err');
    } finally {
      setSyncing(false);
    }
  };

  const logout = () => {
    clearAssetSessionCookie();
    localStorage.removeItem(CHAT_SYNC_AUTH_STORAGE_KEY);
    sessionStorage.removeItem(CHAT_SYNC_SESSION_AUTH_STORAGE_KEY);
    setSecret('');
    setSyncedAt(undefined);
    onAuthChange?.('');
    setMessage('SIGNED OUT');
    setStatus('已退出登录', 'warn');
  };

  return (
    <Modal
      id="login"
      onClose={onClose}
      ariaLabel="同步登录"
      backdropClassName="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-12 backdrop-blur-xs"
      panelClassName="w-full max-w-md bg-theme-bg font-mono text-body-14 text-theme-fg ring-1 ring-theme-fg/30"
      panelStyle={dragStyle}
    >
      {/* window title bar — drag handle */}
      <div
        className="flex h-26 shrink-0 cursor-grab touch-none items-center justify-between gap-4 border-b border-theme-fg/30 px-8"
        onPointerDown={onTitlePointerDown}
            title="拖拽移动 · 双击复位"
      >
        <span className="truncate">~/sync</span>
        <button
          type="button"
          onClick={onClose}
          onPointerDown={(event) => event.stopPropagation()}
          className="hit-x-4 hit-y-4 flex size-16 shrink-0 cursor-pointer items-center justify-center rounded-full border border-transparent bg-theme-fg text-theme-bg hover:border-theme-fg hover:bg-transparent hover:text-theme-fg"
          aria-label="关闭登录"
        >
          <svg viewBox="0 0 24 24" className="size-full shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>

      <form
        className="space-y-16 p-12"
        onKeyDown={(event) => {
          // Block implicit form submission while an IME composition is active.
          if (event.nativeEvent.isComposing && event.key === 'Enter') event.preventDefault();
        }}
        onSubmit={(event) => {
          event.preventDefault();
          void syncHistory();
        }}
      >
          <pre className={`overflow-x-auto bg-theme-fg/10 p-8 text-body-10 ring-1 ring-theme-fg/30 ${loginStatusColor(message)}`}>{loginStatusBox(message)}</pre>
          <p className="text-body-10 text-theme-dim">
            第一次输入名字和同步密钥就会自动创建账号。之后用同样的信息登录，就能同步聊天记录。
          </p>

          <div className="space-y-12">
            <label className="block">
              <span className="mb-4 block text-body-10 uppercase text-theme-muted">名字</span>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                disabled={syncing}
                autoComplete="username"
                className="h-32 w-full bg-theme-bg px-8 text-body-14 text-theme-fg outline-none ring-1 ring-theme-fg/30 placeholder:text-theme-muted focus:ring-theme-fg disabled:opacity-60"
                placeholder="例如：PLAYER_1"
              />
            </label>

            <label className="block">
              <span className="mb-4 block text-body-10 uppercase text-theme-muted">同步密钥</span>
              <input
                value={secret}
                onChange={(event) => setSecret(event.target.value)}
                disabled={syncing}
                type="password"
                autoComplete="current-password"
                className="h-32 w-full bg-theme-bg px-8 text-body-14 text-theme-fg outline-none ring-1 ring-theme-fg/30 placeholder:text-theme-muted focus:ring-theme-fg disabled:opacity-60"
                placeholder="至少 4 位"
              />
            </label>
          </div>

          <div className="flex items-center justify-between gap-8 border-y border-theme-fg/30 py-8 text-body-10 uppercase">
            <span className="text-theme-muted">LAST SYNC</span>
            <span className="text-theme-fg">{formatSyncTime(syncedAt)}</span>
          </div>

          <div className="grid grid-cols-2 gap-8">
            <button
              type="button"
              onClick={logout}
              disabled={syncing}
              className="h-32 cursor-pointer text-body-10 uppercase text-theme-dim ring-1 ring-theme-fg/30 hover:bg-theme-fg/10 hover:text-theme-fg disabled:cursor-wait disabled:opacity-60"
            >
              退出登录
            </button>
            <button
              type="submit"
              disabled={syncing}
              className="h-32 cursor-pointer border border-transparent bg-theme-fg text-body-10 uppercase text-theme-bg hover:border-theme-fg hover:bg-transparent hover:text-theme-fg disabled:cursor-wait disabled:opacity-60"
            >
              {syncing ? '同步中...' : '登录并同步'}
            </button>
          </div>
          <p className="text-body-10 text-theme-muted">
            退出登录不会删除聊天记录，下次用同样的名字和同步密钥登录还能继续同步。
          </p>
      </form>
    </Modal>
  );
}
