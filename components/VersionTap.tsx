'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useConfig } from '@/contexts/ConfigContext';
import { useChat } from '@/contexts/ChatContext';

const MODEL_GATE_UNLOCK_TAPS = 3;

// Version stamp in the footer — triple-tap it to unlock the model gate.
export default function VersionTap() {
  const { modelGateEnabled, modelGateUnlocked, setModelGateUnlocked } = useConfig();
  const { setStatus } = useChat();
  const [tapping, setTapping] = useState(false);
  const [locallyUnlocked, setLocallyUnlocked] = useState(false);
  const titleUnlocked = modelGateUnlocked || locallyUnlocked;
  const localTapsRef = useRef(0);
  const pendingTapsRef = useRef(0);
  const processingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
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
        const taps = Math.min(localTapsRef.current, MODEL_GATE_UNLOCK_TAPS);
        setStatus(`版本号确认已记录 ${taps}/${MODEL_GATE_UNLOCK_TAPS}`, 'warn');
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

  if (!modelGateEnabled) return <span className="shrink-0 text-theme-dim">v1.0</span>;

  return (
    <button
      type="button"
      onClick={handleVersionClick}
      className={`hit-x-8 hit-y-4 shrink-0 cursor-pointer text-theme-dim hover:text-theme-fg ${tapping ? 'animate-pulse motion-reduce:animate-none' : ''}`}
      title="版本信息"
    >
      v1.0
    </button>
  );
}
