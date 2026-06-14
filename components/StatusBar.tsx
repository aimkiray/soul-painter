'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useConfig } from '@/contexts/ConfigContext';
import { useChat } from '@/contexts/ChatContext';

export default function StatusBar() {
  const { config, modelGateEnabled } = useConfig();
  const { setStatus } = useChat();
  const activeModel = config.mode === 'chat' ? config.chatModel : config.model;
  const [tapping, setTapping] = useState(false);
  const pendingTapsRef = useRef(0);
  const processingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const postVersionTap = async () => {
    const response = await fetch('/api/model-gate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'tap' }),
    });
    if (!response.ok) throw new Error('tap failed');
    return response.json().catch(() => null) as Promise<{ unlocked?: boolean } | null>;
  };

  const flushPendingTaps = async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    setTapping(true);

    try {
      let latest: { unlocked?: boolean } | null = null;
      while (pendingTapsRef.current > 0) {
        pendingTapsRef.current -= 1;
        latest = await postVersionTap();
        if (latest?.unlocked) {
          pendingTapsRef.current = 0;
          break;
        }
      }

      if (!mountedRef.current) return;
      if (latest?.unlocked) {
        setStatus('模型访问已解锁', 'ok');
      } else {
        setStatus('标题栏确认已记录', 'warn');
      }
    } catch {
      pendingTapsRef.current = 0;
      if (mountedRef.current) setStatus('解锁状态同步失败', 'err');
    } finally {
      processingRef.current = false;
      if (mountedRef.current) setTapping(false);
      if (pendingTapsRef.current > 0 && mountedRef.current) {
        void flushPendingTaps();
      }
    }
  };

  const handleVersionClick = async () => {
    if (!modelGateEnabled) return;
    pendingTapsRef.current += 1;
    void flushPendingTaps();
  };

  return (
    <header className="flex-shrink-0 bg-[#aa0000] text-white px-2 py-1 font-mono text-sm flex items-center justify-center gap-2">
      <span>灵魂画师</span>
      <span className="text-[#ffff55]">::</span>
      <span className="text-[#CCC]">{activeModel}</span>
      <span className="text-[#ffff55]">::</span>
      {modelGateEnabled ? (
        <button
          type="button"
          onClick={handleVersionClick}
          className={`text-[#CCC] cursor-pointer hover:text-white ${tapping ? 'animate-pulse' : ''}`}
          title="版本信息"
        >
          v1.0
        </button>
      ) : (
        <span className="text-[#CCC]">v1.0</span>
      )}
    </header>
  );
}
