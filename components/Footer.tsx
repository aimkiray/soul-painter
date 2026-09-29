'use client';

import React from 'react';
import { useConfig } from '@/contexts/ConfigContext';
import { useChat } from '@/contexts/ChatContext';
import { useI18n } from '@/contexts/I18nContext';
import { translateServerMessage } from '@/lib/i18n';
import VersionTap from './VersionTap';

export default function Footer() {
  const { statusText, statusType } = useChat();
  const { config } = useConfig();
  const { lang, t } = useI18n();

  const statusColor = statusType === 'err' ? 'text-error'
    : statusType === 'ok' ? 'text-theme-fg'
    : statusType === 'warn' ? 'text-theme-dim'
    : 'text-theme-muted';
  const modeLabel = config.mode === 'chat' ? 'CHAT' : 'IMG';
  const outputLabel = config.mode === 'chat' ? 'MARKDOWN' : config.format.toUpperCase();

  return (
    <footer className="flex h-26 shrink-0 items-center justify-between gap-8 border-t border-theme-fg/30 px-8 font-mono text-body-10 uppercase lg:px-16">
      {statusText ? (
        <span role="status" aria-live="polite" className={`truncate ${statusColor}`}>{translateServerMessage(lang, statusText)}</span>
      ) : (
        <span className="flex min-w-0 items-center gap-8 overflow-hidden whitespace-nowrap text-theme-dim">
          <span className="text-theme-fg">{t('ready')}</span>
          <span className="hidden md:inline">{t('footerMode', { mode: modeLabel })}</span>
          <span className="hidden md:inline">{t('footerInput')}</span>
          <span>{t('footerOutput', { output: outputLabel })}</span>
          <span className="hidden text-theme-muted lg:inline">{t('footerHotkeys')}</span>
        </span>
      )}
      <span className="flex shrink-0 items-center gap-8 tabular-nums">
        <a
          href="https://github.com/aimkiray/soul-painter"
          target="_blank"
          rel="noreferrer"
          aria-label={t('githubRepo')}
          title="github.com/aimkiray/soul-painter"
          className="hit-x-8 hit-y-4 cursor-pointer text-theme-dim hover:text-theme-fg"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="1em" height="1em" fill="currentColor" className="size-14" aria-hidden="true">
            <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
          </svg>
        </a>
        <VersionTap />
      </span>
    </footer>
  );
}
