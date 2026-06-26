'use client';

import React, { useRef, useEffect } from 'react';
import { useChat } from '@/contexts/ChatContext';
import { useConfig } from '@/contexts/ConfigContext';
import { useImages } from '@/contexts/ImageContext';
import ChatBubble from './ChatBubble';

const CHAT_CONTENT_CLASS = 'chat-content-width px-2 sm:px-3';

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
  const { hasImages } = useImages();
  const {
    messages,
    isLoading,
    activeSessionId,
    loadingSessionId,
    deleteMessage,
  } = useChat();
  const isActiveSessionLoading = isLoading && loadingSessionId === activeSessionId;
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastUserIndex = messages.findLastIndex((message) => message.role === 'user');
  const hasAssistantForCurrentTurn = lastUserIndex >= 0
    && messages.slice(lastUserIndex + 1).some((message) => message.role === 'bot');
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
    ? '等待输入'
    : hasImages
      ? '参考图已就绪'
      : '等待描述';

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isActiveSessionLoading]);

  if (messages.length === 0 && !isActiveSessionLoading) {
    return (
      <div className="chat-scroll-gutter flex-1 overflow-y-auto py-2 sm:py-4 flex flex-col">
        <div className={`${CHAT_CONTENT_CLASS} flex-1 flex flex-col`}>
          <div className="m-auto flex flex-col items-center justify-center text-center px-4 py-8 select-none">
            <p className="text-[#00aaaa] text-sm tracking-normal">{emptyTitle}</p>
            <p className="text-[#CCC] text-sm mt-1">{emptySubtitle}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-scroll-gutter flex-1 overflow-y-auto py-2 sm:py-4 flex flex-col" id="chat-scroll">
      <div className={`${CHAT_CONTENT_CLASS} flex flex-col`}>
        {messages.map((msg, i) => {
          const isRegeneratingMessage = msg.id === pendingMessageId;
          const isServerRunPending = !!msg.serverRunId && isPendingBotMessage(msg);
          const isMessagePending = isRegeneratingMessage || isServerRunPending || (isActiveSessionLoading && isPendingBotMessage(msg));
          const canRegenerate = msg.role === 'bot'
            && messages.slice(0, i).some((message) => message.role === 'user' && message.prompt.trim());
          return (
            <ChatBubble
              key={msg.id}
              message={msg}
              messageIndex={i}
              isPending={isMessagePending}
              isRegenerating={isRegeneratingMessage}
              disabled={isLoading}
              canRegenerate={canRegenerate}
              onDelete={(messageId) => deleteMessage(messageId, activeSessionId)}
              onEdit={onEditMessage}
              onRegenerate={onRegenerateMessage}
            />
          );
        })}
        {isActiveSessionLoading && !hasActiveAssistantMessage && (
          <div className="flex flex-col gap-1 mb-3 items-start">
            <span className="text-xs px-1 text-[#CCC]">Assistant</span>
            <div className="w-fit max-w-full min-w-0 bg-[#111] text-[#CCC] border-2 border-[#AAA] py-2 px-3">
              <span className="animate-pulse text-sm">生成中...</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
