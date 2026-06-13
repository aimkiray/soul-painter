'use client';

import React from 'react';
import { useConfig } from '@/contexts/ConfigContext';
import { useImages } from '@/contexts/ImageContext';

export default function StatusBar() {
  const { config } = useConfig();
  const { selectedIndices } = useImages();
  const activeModel = config.mode === 'chat' && selectedIndices.size === 0 ? config.chatModel : config.model;
  return (
    <header className="flex-shrink-0 bg-[#aa0000] text-white px-2 py-1 font-mono text-sm flex items-center justify-center gap-2">
      <span>灵魂画师</span>
      <span className="text-[#ffff55]">::</span>
      <span className="text-[#CCC]">{activeModel}</span>
      <span className="text-[#ffff55]">::</span>
      <span className="text-[#CCC]">v1.0</span>
    </header>
  );
}
