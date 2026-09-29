'use client';

import React from 'react';
import { useConfig } from '@/contexts/ConfigContext';
import { useChat } from '@/contexts/ChatContext';
import VersionTap from './VersionTap';

export default function Footer() {
  const { statusText, statusType } = useChat();
  const { config } = useConfig();

  const statusColor = statusType === 'err' ? 'text-error'
    : statusType === 'ok' ? 'text-theme-fg'
    : statusType === 'warn' ? 'text-theme-dim'
    : 'text-theme-muted';
  const modeLabel = config.mode === 'chat' ? 'CHAT' : 'IMG';
  const outputLabel = config.mode === 'chat' ? 'MARKDOWN' : config.format.toUpperCase();

  return (
    <footer className="flex h-26 shrink-0 items-center justify-between gap-8 border-t border-theme-fg/30 px-8 font-mono text-body-10 uppercase lg:px-16">
      {statusText ? (
        <span role="status" aria-live="polite" className={`truncate ${statusColor}`}>{statusText}</span>
      ) : (
        <span className="flex min-w-0 items-center gap-8 overflow-hidden whitespace-nowrap text-theme-dim">
          <span className="text-theme-fg">[READY]</span>
          <span className="hidden md:inline">MODE {modeLabel}</span>
          <span className="hidden md:inline">INPUT PROMPT</span>
          <span>OUTPUT {outputLabel}</span>
          <span className="hidden text-theme-muted lg:inline">[T]THEME [Y]SYNC [S]SETTINGS [D]DEBUG</span>
        </span>
      )}
      <span className="shrink-0 tabular-nums"><VersionTap /></span>
    </footer>
  );
}
