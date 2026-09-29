'use client';

import React, { useCallback, useRef, useEffect, useMemo } from 'react';
import { useChat } from '@/contexts/ChatContext';
import { useConfig } from '@/contexts/ConfigContext';
import { useI18n } from '@/contexts/I18nContext';
import { useImages } from '@/contexts/ImageContext';
import { hitToFile } from '@/lib/image-ref-utils';
import type { ImageHit } from '@/types';
import ChatBubble from './ChatBubble';

const CHAT_CONTENT_CLASS = 'chat-content-width';

function isPendingBotMessage(message: { role: string; prompt: string; images: unknown[]; text: string; code: string; extra: string; serverRunId?: string }) {
  return message.role === 'bot'
    && !message.prompt
    && message.images.length === 0
    && !message.text
    && !message.code
    && !message.extra;
}

interface ChatAreaProps {
  onRegenerateMessage?: (messageId: string) => void;
  onEditMessage?: (messageId: string, prompt: string) => void;
  pendingMessageId?: string | null;
}

export default function ChatArea({ onRegenerateMessage, onEditMessage, pendingMessageId = null }: ChatAreaProps) {
  const { config } = useConfig();
  const { t } = useI18n();
  const { hasImages, addFiles } = useImages();
  const {
    messages,
    isLoading,
    activeSessionId,
    deleteMessage,
    setStatus,
  } = useChat();
  const isActiveSessionLoading = isLoading;
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  const handleDelete = useCallback(
    (messageId: string) => deleteMessage(messageId, activeSessionId),
    [deleteMessage, activeSessionId],
  );
  const addingRefKeysRef = useRef(new Set<string>());
  const handleUseAsReference = useCallback((hit: ImageHit, index: number) => {
    const key = `${index}:${(hit.dataUrl || hit.url || '').slice(0, 80)}`;
    if (addingRefKeysRef.current.has(key)) return;
    addingRefKeysRef.current.add(key);
    void (async () => {
      try {
        const file = await hitToFile(hit, index);
        if (!file) {
          setStatus(t('refAddFailed'), 'err');
          return;
        }
        await addFiles([file]);
        setStatus(
          config.mode === 'chat' ? t('refAddedChatMode') : t('refAdded'),
          config.mode === 'chat' ? 'warn' : 'ok',
        );
      } finally {
        addingRefKeysRef.current.delete(key);
      }
    })();
  }, [addFiles, setStatus, config.mode, t]);
  const lastUserIndex = messages.findLastIndex((message) => message.role === 'user');
  const hasAssistantForCurrentTurn = lastUserIndex >= 0
    && messages.slice(lastUserIndex + 1).some((message) => message.role === 'bot');
  // One pass: regenerate is offered on bot messages that follow a user prompt.
  const seenUserPromptByIndex = useMemo(() => {
    const flags: boolean[] = [];
    let seen = false;
    for (const message of messages) {
      flags.push(seen);
      if (message.role === 'user' && message.prompt.trim()) seen = true;
    }
    return flags;
  }, [messages]);
  const hasActiveAssistantMessage = isActiveSessionLoading && (
    hasAssistantForCurrentTurn
    || messages.some((message) => isPendingBotMessage(message) || message.id === pendingMessageId)
  );
  const emptyTitle = config.mode === 'chat'
    ? 'CHAT READY'
    : hasImages
      ? 'EDIT READY'
      : 'IMG READY';
  const emptySubtitle = config.mode === 'chat'
    ? t('waitingInput')
    : hasImages
      ? t('refsReady')
      : t('waitingDesc');

  // Switching sessions always lands at the latest message — reset the
  // near-bottom flag so auto-scroll isn't suppressed by the previous
  // session's scroll position.
  useEffect(() => {
    isNearBottomRef.current = true;
    bottomRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [activeSessionId]);

  useEffect(() => {
    if (!isNearBottomRef.current) return;
    bottomRef.current?.scrollIntoView({ behavior: isActiveSessionLoading ? 'auto' : 'smooth' });
  }, [messages, isActiveSessionLoading]);

  // Images have no reserved height — they expand the content column as they
  // finish loading, after the session-switch scroll has already run. Keep the
  // view pinned to the bottom while near-bottom (scrolling up releases it).
  useEffect(() => {
    const content = scrollRef.current?.firstElementChild;
    if (!content) return;
    const observer = new ResizeObserver(() => {
      if (isNearBottomRef.current) bottomRef.current?.scrollIntoView({ behavior: 'auto' });
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [activeSessionId, messages.length]);

  if (messages.length === 0 && !isActiveSessionLoading) {
    return (
      <div className="flex-1 overflow-y-auto py-8 sm:py-16 flex flex-col" role="log" aria-live="off" aria-label={t('chatLog')}>
        <div className={`${CHAT_CONTENT_CLASS} flex-1 flex flex-col`}>
          <div className="m-auto flex flex-col items-center justify-center px-16 py-32 text-center font-mono">
            <p className="text-body-14 uppercase text-theme-fg">
              {emptyTitle}
              <span aria-hidden className="ml-4 inline-block h-14 w-8 animate-blink bg-theme-fg align-middle motion-reduce:hidden" />
            </p>
            <p className="mt-4 text-body-14 text-theme-muted">{emptySubtitle}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="scroll-fade-y -mx-2 flex-1 overflow-y-auto overflow-x-hidden px-2 py-8 sm:py-16 flex flex-col"
      id="chat-scroll"
      ref={scrollRef}
      onScroll={handleScroll}
      role="log"
      aria-live="off"
      aria-label={t('chatLog')}
    >
      <span className="sr-only" role="status">
        {isActiveSessionLoading ? t('generating') : messages.at(-1)?.extra === 'error' ? t('lastGenFailed') : ''}
      </span>
      <div className={`${CHAT_CONTENT_CLASS} flex flex-col`}>
        {messages.map((msg, i) => {
          const isRegeneratingMessage = msg.id === pendingMessageId;
          const isServerRunPending = !!msg.serverRunId && isPendingBotMessage(msg);
          const isMessagePending = isRegeneratingMessage || isServerRunPending;
          const canRegenerate = msg.role === 'bot' && seenUserPromptByIndex[i];
          return (
            <ChatBubble
              key={msg.id}
              message={msg}
              isPending={isMessagePending}
              isRegenerating={isRegeneratingMessage}
              disabled={isLoading}
              canRegenerate={canRegenerate}
              onDelete={handleDelete}
              onEdit={onEditMessage}
              onRegenerate={onRegenerateMessage}
              onUseAsReference={handleUseAsReference}
            />
          );
        })}
        {isActiveSessionLoading && !hasActiveAssistantMessage && (
          <div className="mb-12 flex flex-col items-start gap-4">
            <span className="px-4 font-mono text-body-10 uppercase text-theme-muted">{t('assistantLabel')}</span>
            <div className="w-fit max-w-full min-w-0 px-12 py-8 ring-1 ring-theme-fg/30">
              <span className="text-theme-dim">
                {t('generating')}
                <span aria-hidden className="ml-4 inline-block h-12 w-6 animate-blink bg-theme-dim align-middle motion-reduce:hidden" />
              </span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
