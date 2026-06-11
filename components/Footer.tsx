'use client';

import React, { useState, useEffect } from 'react';
import { useChat } from '@/contexts/ChatContext';

export default function Footer() {
  const [time, setTime] = useState('');
  const { statusText, statusType } = useChat();

  useEffect(() => {
    const update = () => setTime(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  const statusColor = statusType === 'err' ? 'text-[#ff5555]' : statusType === 'ok' ? 'text-[#00aa00]' : 'text-black';

  return (
    <footer className="flex-shrink-0 bg-[#AAA] text-black px-2 py-1.5 sm:py-1 font-mono text-sm flex items-center justify-between gap-2">
      {statusText ? (
        <span className={`truncate ${statusColor}`}>{statusText}</span>
      ) : (
        <>
          <span className="hidden md:inline">F1 设置 | Enter 发送 | Shift+Enter 换行</span>
          <span className="md:hidden">F1 设置 · Enter 发送</span>
        </>
      )}
      <span className="shrink-0 ml-auto">{time}</span>
    </footer>
  );
}
