'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useConfig } from '@/contexts/ConfigContext';
import { useChat } from '@/contexts/ChatContext';
import { REPEATER_MODEL_LABEL } from '@/lib/constants';

const MODEL_GATE_UNLOCK_TAPS = 3;

export default function StatusBar() {
  const { config, modelGateEnabled, modelGateUnlocked, setModelGateUnlocked } = useConfig();
  const { setStatus } = useChat();
  const activeModel = config.mode === 'chat' ? config.chatModel : config.model;
  const [tapping, setTapping] = useState(false);
  const [locallyUnlocked, setLocallyUnlocked] = useState(false);
  const localTapsRef = useRef(0);
  const pendingTapsRef = useRef(0);
  const processingRef = useRef(false);
  const mountedRef = useRef(true);
  const titleUnlocked = modelGateUnlocked || locallyUnlocked;
  const lockedRepeaterMode = modelGateEnabled && !titleUnlocked;
  const displayModel = lockedRepeaterMode ? REPEATER_MODEL_LABEL : activeModel;
  const modeLabel = config.mode === 'chat' ? '聊天' : '图片';

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
        setLocallyUnlocked(true);
        setModelGateUnlocked(true);
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
    if (!modelGateEnabled || titleUnlocked) return;
    localTapsRef.current += 1;
    if (localTapsRef.current >= MODEL_GATE_UNLOCK_TAPS) {
      setLocallyUnlocked(true);
      setModelGateUnlocked(true);
    }
    pendingTapsRef.current += 1;
    void flushPendingTaps();
  };

  return (
    <header className="flex-shrink-0 bg-[#aa0000] text-white px-2 py-1 font-mono text-sm flex items-center justify-center gap-2">
      <span>{lockedRepeaterMode ? '复读机' : '灵魂画师'}</span>
      <span className="text-[#ffff55]">::</span>
      <span className="text-[#CCC]">{modeLabel}</span>
      <span className="text-[#ffff55]">::</span>
      <span className="text-[#CCC]">{displayModel}</span>
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
