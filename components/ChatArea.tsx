'use client';

import React, { useRef, useEffect } from 'react';
import { useChat } from '@/contexts/ChatContext';
import ChatBubble from './ChatBubble';

const CHAT_CONTENT_CLASS = 'chat-content-width px-2 sm:px-3';

function isPendingBotMessage(message: { role: string; prompt: string; images: unknown[]; text: string; code: string; extra: string }) {
  return message.role === 'bot'
    && !message.prompt
    && message.images.length === 0
    && !message.text
    && !message.code
    && !message.extra;
}

interface ChatAreaProps {
  onRegenerateMessage?: (messageId: string) => void;
  pendingMessageId?: string | null;
}

export default function ChatArea({ onRegenerateMessage, pendingMessageId = null }: ChatAreaProps) {
  const {
    messages,
    isLoading,
    activeSessionId,
    loadingSessionId,
    deleteMessage,
    updateUserMessage,
  } = useChat();
  const isActiveSessionLoading = isLoading && loadingSessionId === activeSessionId;
  const bottomRef = useRef<HTMLDivElement>(null);
  const hasActivePendingBotMessage = isActiveSessionLoading && messages.some((message) => (
    isPendingBotMessage(message) || message.id === pendingMessageId
  ));

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isActiveSessionLoading]);

  if (messages.length === 0 && !isActiveSessionLoading) {
    return (
      <div className="chat-scroll-gutter flex-1 overflow-y-auto py-2 sm:py-4 flex flex-col">
        <div className={`${CHAT_CONTENT_CLASS} flex-1 flex flex-col`}>
          <div className="m-auto flex flex-col items-center justify-center text-center px-4 py-8 select-none">
            <p className="text-[#CCC] text-sm">输入提示词开始生成图片</p>
            <p className="text-[#00aaaa] text-sm mt-1">Ctrl+Enter / Enter 发送 · Shift+Enter 换行</p>
            <p className="text-[#CCC] text-sm mt-1">拖拽/粘贴图片启动图生图 · F1 打开设置</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-scroll-gutter flex-1 overflow-y-auto py-2 sm:py-4 flex flex-col" id="chat-scroll">
      <div className={`${CHAT_CONTENT_CLASS} flex flex-col`}>
        {messages.map((msg, i) => {
          const isMessagePending = isActiveSessionLoading
            && (isPendingBotMessage(msg) || msg.id === pendingMessageId);
          const canRegenerate = msg.role === 'bot'
            && messages.slice(0, i).some((message) => message.role === 'user' && message.prompt.trim());
          return (
            <ChatBubble
              key={msg.id}
              message={msg}
              messageIndex={i}
              isPending={isMessagePending}
              disabled={isLoading}
              canRegenerate={canRegenerate}
              onDelete={(messageId) => deleteMessage(messageId, activeSessionId)}
              onEdit={(messageId, prompt) => updateUserMessage(messageId, prompt, activeSessionId)}
              onRegenerate={onRegenerateMessage}
            />
          );
        })}
        {isActiveSessionLoading && !hasActivePendingBotMessage && (
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
