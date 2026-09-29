'use client';

import React, { useEffect } from 'react';
import { useChat } from '@/contexts/ChatContext';
import { useI18n } from '@/contexts/I18nContext';
import { translateServerMessage } from '@/lib/i18n';
import { useWindowDrag } from '@/hooks/useWindowDrag';
import { registerModalLayer } from '@/lib/modal-stack';

export default function DebugPanel() {
  const { debugRaw, debugVisible, toggleDebug } = useChat();
  const { lang, t } = useI18n();
  const { dragStyle, onTitlePointerDown } = useWindowDrag();

  // Escape closes it through the shared layer stack like every other overlay.
  useEffect(() => {
    if (!debugVisible) return;
    return registerModalLayer('debug-panel', toggleDebug);
  }, [debugVisible, toggleDebug]);

  return (
    <>
      {debugVisible && (
        <div
          data-window
          role="dialog"
          aria-label={t('debugPanel')}
          style={dragStyle}
          className="fixed inset-x-8 bottom-32 z-50 bg-theme-bg font-mono text-body-14 text-theme-fg ring-1 ring-theme-fg/30 sm:inset-x-auto sm:right-8 sm:w-320"
        >
          {/* window title bar — drag handle */}
          <div
            className="flex h-26 shrink-0 cursor-grab touch-none items-center justify-between gap-4 border-b border-theme-fg/30 px-8"
            onPointerDown={onTitlePointerDown}
            title={t('dragMoveReset')}
          >
            <span className="truncate">~/debug</span>
            <button
              onClick={toggleDebug}
              onPointerDown={(event) => event.stopPropagation()}
              className="hit-x-4 hit-y-4 flex size-16 shrink-0 cursor-pointer items-center justify-center rounded-full border border-transparent bg-theme-fg text-theme-bg hover:border-theme-fg hover:bg-transparent hover:text-theme-fg"
              aria-label={t('closeDebug')}
            >
              <svg viewBox="0 0 24 24" className="size-full shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <div className="max-h-256 overflow-auto p-8">
            <pre className="whitespace-pre-wrap break-all text-body-10 text-theme-dim">
              {translateServerMessage(lang, debugRaw)}
            </pre>
          </div>
        </div>
      )}
    </>
  );
}
