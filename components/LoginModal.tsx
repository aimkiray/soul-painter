'use client';

import React, { useState } from 'react';
import { useChat } from '@/contexts/ChatContext';
import { useI18n } from '@/contexts/I18nContext';
import { translateServerMessage } from '@/lib/i18n';
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

function formatSyncTime(value: number | undefined, lang: 'zh' | 'en') {
  if (!value) return 'NO DATA';
  try {
    return new Date(value).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US');
  } catch {
    return 'UNKNOWN';
  }
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
  const { lang, t } = useI18n();
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
        result.assetMigrationWarning
          ? translateServerMessage(lang, result.assetMigrationWarning)
          : result.applied ? t('syncDone') : t('syncUpdating'),
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
      setStatus(translateServerMessage(lang, text), 'err');
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
    setStatus(t('loggedOut'), 'warn');
  };

  return (
    <Modal
      id="login"
      onClose={onClose}
      ariaLabel={t('syncLoginTitle')}
      backdropClassName="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-12 backdrop-blur-xs"
      panelClassName="w-full max-w-md bg-theme-bg font-mono text-body-14 text-theme-fg ring-1 ring-theme-fg/30"
      panelStyle={dragStyle}
    >
      {/* window title bar — drag handle */}
      <div
        className="flex h-26 shrink-0 cursor-grab touch-none items-center justify-between gap-4 border-b border-theme-fg/30 px-8"
        onPointerDown={onTitlePointerDown}
            title={t('dragMoveReset')}
      >
        <span className="truncate">~/sync</span>
        <button
          type="button"
          onClick={onClose}
          onPointerDown={(event) => event.stopPropagation()}
          className="hit-x-4 hit-y-4 flex size-16 shrink-0 cursor-pointer items-center justify-center rounded-full border border-transparent bg-theme-fg text-theme-bg hover:border-theme-fg hover:bg-transparent hover:text-theme-fg"
          aria-label={t('closeLogin')}
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
          <div className={`bg-theme-fg/10 p-8 ring-1 ring-theme-fg/30 ${loginStatusColor(message)}`}>
            <div className="px-8 py-4 font-mono text-body-10 uppercase ring-1 ring-theme-fg/50">
              <div>CHAT SYNC: READY</div>
              <div className="truncate">STATUS: {message.toUpperCase()}</div>
            </div>
          </div>
          <p className="text-body-10 text-theme-dim">
            {t('loginIntro')}
          </p>

          <div className="space-y-12">
            <label className="block">
              <span className="mb-4 block text-body-10 uppercase text-theme-muted">{t('nameLabel')}</span>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                disabled={syncing}
                autoComplete="username"
                className="h-32 w-full bg-theme-bg px-8 text-body-14 text-theme-fg outline-none ring-1 ring-theme-fg/30 placeholder:text-theme-muted focus:ring-theme-fg disabled:opacity-60"
                placeholder={t('namePh')}
              />
            </label>

            <label className="block">
              <span className="mb-4 block text-body-10 uppercase text-theme-muted">{t('secretLabel')}</span>
              <input
                value={secret}
                onChange={(event) => setSecret(event.target.value)}
                disabled={syncing}
                type="password"
                autoComplete="current-password"
                className="h-32 w-full bg-theme-bg px-8 text-body-14 text-theme-fg outline-none ring-1 ring-theme-fg/30 placeholder:text-theme-muted focus:ring-theme-fg disabled:opacity-60"
                placeholder={t('secretPh')}
              />
            </label>
          </div>

          <div className="flex items-center justify-between gap-8 border-y border-theme-fg/30 py-8 text-body-10 uppercase">
            <span className="text-theme-muted">LAST SYNC</span>
            <span className="text-theme-fg">{formatSyncTime(syncedAt, lang)}</span>
          </div>

          <div className="grid grid-cols-2 gap-8">
            <button
              type="button"
              onClick={logout}
              disabled={syncing}
              className="h-32 cursor-pointer text-body-10 uppercase text-theme-dim ring-1 ring-theme-fg/30 hover:bg-theme-fg/10 hover:text-theme-fg disabled:cursor-wait disabled:opacity-60"
            >
              {t('logout')}
            </button>
            <button
              type="submit"
              disabled={syncing}
              className="h-32 cursor-pointer border border-transparent bg-theme-fg text-body-10 uppercase text-theme-bg hover:border-theme-fg hover:bg-transparent hover:text-theme-fg disabled:cursor-wait disabled:opacity-60"
            >
              {syncing ? t('syncing') : t('loginAndSync')}
            </button>
          </div>
          <p className="text-body-10 text-theme-muted">
            {t('logoutNote')}
          </p>
      </form>
    </Modal>
  );
}
