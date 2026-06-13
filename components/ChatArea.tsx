'use client';

import React, { useRef, useEffect } from 'react';
import { useChat } from '@/contexts/ChatContext';
import ChatBubble from './ChatBubble';

export default function ChatArea() {
  const { messages, isLoading } = useChat();
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastMessage = messages[messages.length - 1];
  const hasActiveBotMessage = isLoading && lastMessage?.role === 'bot';
  const pendingBotIndex = hasActiveBotMessage && !lastMessage.text && lastMessage.images.length === 0 && !lastMessage.code && !lastMessage.extra
    ? messages.length - 1
    : -1;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  if (messages.length === 0 && !isLoading) {
    return (
      <div className="flex-1 overflow-y-auto p-2 sm:p-4 flex flex-col">
        <div className="m-auto flex flex-col items-center justify-center text-center px-4 py-8 select-none">
          <p className="text-[#CCC] text-sm">输入提示词开始生成图片</p>
          <p className="text-[#00aaaa] text-sm mt-1">Ctrl+Enter / Enter 发送 · Shift+Enter 换行</p>
          <p className="text-[#CCC] text-sm mt-1">拖拽/粘贴图片启动图生图 · F1 打开设置</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-2 sm:p-4 flex flex-col" id="chat-scroll">
      {messages.map((msg, i) => (
        <ChatBubble key={i} message={msg} isPending={i === pendingBotIndex} />
      ))}
      {isLoading && !hasActiveBotMessage && (
        <div className="flex flex-col gap-1 mb-3 items-start">
          <span className="text-xs px-1 text-[#CCC]">Assistant</span>
          <div className="bg-[#111] text-[#CCC] border border-[#AAA] py-2 px-3 max-w-[90%] sm:max-w-[80%]">
            <span className="animate-pulse text-sm">生成中...</span>
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
