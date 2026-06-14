'use client';

import React, { useCallback, useState } from 'react';
import { useConfig } from '@/contexts/ConfigContext';
import { useChat } from '@/contexts/ChatContext';
import { MODEL_GATE_VERSION_TAPS } from '@/lib/model-gate';

export default function StatusBar() {
  const { config, options } = useConfig();
  const { setStatus } = useChat();
  const activeModel = config.mode === 'chat' ? config.chatModel : config.model;
  const [tapping, setTapping] = useState(false);

  const handleVersionClick = useCallback(async () => {
    if (!options.requireVersionUnlock || tapping) return;
    setTapping(true);
    try {
      const response = await fetch('/api/model-gate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'tap' }),
      });
      const data = await response.json().catch(() => null) as { unlocked?: boolean; remaining?: number } | null;
      if (data?.unlocked) {
        setStatus('模型访问已解锁', 'ok');
      } else {
        const remaining = Math.max(0, data?.remaining ?? MODEL_GATE_VERSION_TAPS);
        setStatus(`还差 ${remaining} 次点击即可解锁`, 'warn');
      }
    } catch {
      setStatus('解锁状态同步失败', 'err');
    } finally {
      setTapping(false);
    }
  }, [options.requireVersionUnlock, setStatus, tapping]);

  return (
    <header className="flex-shrink-0 bg-[#aa0000] text-white px-2 py-1 font-mono text-sm flex items-center justify-center gap-2">
      <span>灵魂画师</span>
      <span className="text-[#ffff55]">::</span>
      <span className="text-[#CCC]">{activeModel}</span>
      <span className="text-[#ffff55]">::</span>
      {options.requireVersionUnlock ? (
        <button
          type="button"
          onClick={handleVersionClick}
          className="text-[#CCC] cursor-pointer hover:text-white"
          title="连点 6 次解锁模型访问"
        >
          v1.0
        </button>
      ) : (
        <span className="text-[#CCC]">v1.0</span>
      )}
    </header>
  );
}
