'use client';

import React from 'react';
import { useChat } from '@/contexts/ChatContext';

export default function DebugPanel() {
  const { debugRaw, debugVisible, toggleDebug } = useChat();

  return (
    <>
      {debugVisible && (
        <div className="fixed bottom-2 left-2 right-2 sm:left-auto sm:right-2 sm:w-80 z-50 bg-black border-2 border-[#AAA] font-mono text-xs">
          <div className="bg-[#AAA] text-black px-2 py-1 flex items-center justify-between">
            <span>调试：原始响应</span>
            <button onClick={toggleDebug} className="text-white hover:text-[#ff5555] cursor-pointer">
              [X]
            </button>
          </div>
          <div className="p-2 max-h-64 overflow-auto">
            <pre className="text-[#CCC] whitespace-pre-wrap break-all leading-relaxed text-[11px]">
              {debugRaw}
            </pre>
          </div>
        </div>
      )}
    </>
  );
}
