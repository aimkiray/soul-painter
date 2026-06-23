'use client';

import React, { useState } from 'react';
import { useChat } from '@/contexts/ChatContext';
import { CHAT_SYNC_AUTH_STORAGE_KEY, CHAT_SYNC_SESSION_AUTH_STORAGE_KEY } from '@/lib/constants';

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
  const status = message.toUpperCase().slice(0, 12).padEnd(12, ' ');
  return [
    '╔══════════════════════╗',
    '║ CHAT SYNC: READY     ║',
    `║ STATUS: ${status} ║`,
    '╚══════════════════════╝',
  ].join('\n');
}

export default function LoginModal({ open, onClose, onAuthChange }: LoginModalProps) {
  const { syncChatHistory, setStatus } = useChat();
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
      const result = await syncChatHistory({ username: cleanUsername, secret: cleanSecret });
      const nextSyncedAt = result.updatedAt || Date.now();
      localStorage.setItem(CHAT_SYNC_AUTH_STORAGE_KEY, JSON.stringify({
        username: cleanUsername,
        syncedAt: nextSyncedAt,
      }));
      sessionStorage.setItem(CHAT_SYNC_SESSION_AUTH_STORAGE_KEY, JSON.stringify({
        username: cleanUsername,
        secret: cleanSecret,
        syncedAt: nextSyncedAt,
      }));
      setSyncedAt(nextSyncedAt);
      onAuthChange?.(cleanUsername);
      setMessage(result.applied ? 'SYNC COMPLETE' : 'SYNC QUEUED');
      setStatus(result.applied ? '聊天记录已同步' : '聊天已更新，将继续后台同步', result.applied ? 'ok' : 'warn');
    } catch (error) {
      const text = (error as Error).message || 'SYNC FAILED';
      setMessage(text.toUpperCase().slice(0, 32));
      setStatus('聊天记录同步失败', 'err');
    } finally {
      setSyncing(false);
    }
  };

  const logout = () => {
    localStorage.removeItem(CHAT_SYNC_AUTH_STORAGE_KEY);
    sessionStorage.removeItem(CHAT_SYNC_SESSION_AUTH_STORAGE_KEY);
    setSecret('');
    setSyncedAt(undefined);
    onAuthChange?.('');
    setMessage('SIGNED OUT');
    setStatus('已退出登录', 'warn');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3">
      <div className="w-full max-w-md border-2 border-[#00aaaa] bg-black font-mono text-[#CCC] shadow-[8px_8px_0_#001f1f]">
        <div className="flex items-center justify-between border-b-2 border-[#00aaaa] bg-[#0000aa] px-2 py-1 text-white">
          <span>SYNC</span>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer text-white hover:text-[#ffff55]"
            aria-label="关闭登录"
          >
            [X]
          </button>
        </div>

        <form
          className="space-y-4 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void syncHistory();
          }}
        >
          <pre className="overflow-x-auto border-2 border-[#555] bg-[#000022] p-3 text-xs leading-5 text-[#00ff00]">{loginStatusBox(message)}</pre>
          <p className="text-xs leading-5 text-[#AAA]">
            第一次输入名字和同步密钥就会自动创建账号。之后用同样的信息登录，就能同步聊天记录。
          </p>

          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs text-[#ffff55]">名字</span>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                disabled={syncing}
                autoComplete="username"
                className="h-9 w-full border-2 border-[#00aaaa] bg-black px-2 text-sm text-[#CCC] outline-none focus:border-[#ffff55] disabled:opacity-60"
                placeholder="例如：PLAYER_1"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs text-[#ffff55]">同步密钥</span>
              <input
                value={secret}
                onChange={(event) => setSecret(event.target.value)}
                disabled={syncing}
                type="password"
                autoComplete="current-password"
                className="h-9 w-full border-2 border-[#00aaaa] bg-black px-2 text-sm text-[#CCC] outline-none focus:border-[#ffff55] disabled:opacity-60"
                placeholder="至少 4 位"
              />
            </label>
          </div>

          <div className="flex items-center justify-between gap-2 border-y-2 border-[#333] py-2 text-xs">
            <span className="text-[#888]">LAST SYNC</span>
            <span className="text-[#00aaaa]">{formatSyncTime(syncedAt)}</span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={logout}
              disabled={syncing}
              className="h-9 cursor-pointer border-2 border-[#777] bg-black text-xs text-[#CCC] hover:border-[#ff5555] hover:text-[#ff5555] disabled:cursor-wait disabled:opacity-60"
            >
              退出登录
            </button>
            <button
              type="submit"
              disabled={syncing}
              className="h-9 cursor-pointer border-2 border-[#ffff55] bg-[#00aaaa] text-xs text-black shadow-[4px_4px_0_#555] hover:bg-[#00cccc] active:translate-x-1 active:translate-y-1 active:shadow-none disabled:cursor-wait disabled:opacity-60"
            >
              {syncing ? '同步中...' : '登录并同步'}
            </button>
          </div>
          <p className="text-[0.7rem] leading-5 text-[#777]">
            退出登录不会删除聊天记录，下次用同样的名字和同步密钥登录还能继续同步。
          </p>
        </form>
      </div>
    </div>
  );
}
