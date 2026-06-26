'use client';

import React, { useState, useEffect } from 'react';
import { useConfig } from '@/contexts/ConfigContext';
import { useChat } from '@/contexts/ChatContext';

export default function Footer() {
  const [time, setTime] = useState('');
  const { statusText, statusType } = useChat();
  const { config } = useConfig();

  useEffect(() => {
    const update = () => setTime(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  const statusColor = statusType === 'err' ? 'text-[#ff5555]'
    : statusType === 'ok' ? 'text-[#00aa00]'
    : statusType === 'warn' ? 'text-[#aa6600]'
    : 'text-black';
  const modeLabel = config.mode === 'chat' ? 'CHAT' : 'IMG';
  const outputLabel = config.mode === 'chat' ? 'MARKDOWN' : config.format.toUpperCase();

  return (
    <footer className="flex-shrink-0 bg-[#AAA] text-black px-2 py-1.5 sm:py-1 font-mono text-sm flex items-center justify-between gap-2">
      {statusText ? (
        <span className={`truncate ${statusColor}`}>{statusText}</span>
      ) : (
        <>
          <span className="hidden min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap md:flex">
            <span className="font-bold text-[#005555]">[READY]</span>
            <span className="font-bold text-[#660000]">MODE</span>
            <span className="font-bold text-black">{modeLabel}</span>
            <span className="font-bold text-[#660000]">INPUT</span>
            <span className="font-bold text-black">PROMPT</span>
            <span className="font-bold text-[#660000]">OUTPUT</span>
            <span className="font-bold text-black">{outputLabel}</span>
          </span>
          <span className="flex min-w-0 items-center gap-1.5 truncate md:hidden">
            <span className="font-bold text-[#005555]">[READY]</span>
            <span className="text-black">{modeLabel}</span>
            <span className="text-black">{outputLabel}</span>
          </span>
        </>
      )}
      <span className="shrink-0 ml-auto">{time}</span>
    </footer>
  );
}
