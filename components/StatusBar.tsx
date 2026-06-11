'use client';

import React from 'react';
import { useConfig } from '@/contexts/ConfigContext';

export default function StatusBar() {
  const { config } = useConfig();
  return (
    <header className="flex-shrink-0 bg-[#aa0000] text-white px-2 py-1 font-mono text-sm flex items-center justify-center gap-2">
      <span>灵魂画师</span>
      <span className="text-[#ffff55]">::</span>
      <span className="text-[#CCC]">{config.model}</span>
      <span className="text-[#ffff55]">::</span>
      <span className="text-[#CCC]">v1.0</span>
    </header>
  );
}
