'use client';

import React from 'react';

interface MenuBarProps {
  activeTab: 'generate' | 'decode';
  onTabChange: (tab: 'generate' | 'decode') => void;
  onOpenSettings: () => void;
  onOpenChatSidebar?: () => void;
}

export default function MenuBar({ activeTab, onTabChange, onOpenSettings, onOpenChatSidebar }: MenuBarProps) {
  const tabBase = 'px-2 sm:px-3 py-1.5 sm:py-1 cursor-pointer whitespace-nowrap transition-colors flex items-center text-xs sm:text-sm';
  const tabActive = 'bg-black text-[#00aaaa]';
  const tabInactive = 'text-black hover:text-[#00aaaa]';

  return (
    <nav className="flex-shrink-0 bg-[#AAA] text-black px-1 sm:px-2 font-mono text-sm flex items-stretch justify-between" role="tablist" aria-label="功能标签">
      <div className="flex items-center gap-0.5 sm:gap-2">
        <button
          role="tab"
          aria-selected={activeTab === 'generate'}
          aria-controls="tab-generate"
          className={`${tabBase} ${activeTab === 'generate' ? tabActive : tabInactive}`}
          onClick={() => onTabChange('generate')}
        >
          {activeTab === 'generate' ? '[x]' : '[ ]'} API
        </button>

        <button
          role="tab"
          aria-selected={activeTab === 'decode'}
          aria-controls="tab-decode"
          className={`${tabBase} ${activeTab === 'decode' ? tabActive : tabInactive}`}
          onClick={() => onTabChange('decode')}
        >
          {activeTab === 'decode' ? '[x]' : '[ ]'} Base64
        </button>
      </div>

      <div className="flex items-center gap-1">
        {activeTab === 'generate' && onOpenChatSidebar && (
          <button
            onClick={onOpenChatSidebar}
            className="md:hidden cursor-pointer whitespace-nowrap hover:text-[#00aaaa] transition-colors px-1.5 sm:px-2 py-1.5 sm:py-1 text-xs sm:text-sm"
            aria-label="打开聊天列表"
          >
            聊天
          </button>
        )}
        <button
          onClick={onOpenSettings}
          className="cursor-pointer whitespace-nowrap hover:text-[#00aaaa] transition-colors px-1.5 sm:px-2 py-1.5 sm:py-1 text-xs sm:text-sm"
          aria-label="打开设置"
        >
          设置
        </button>
      </div>
    </nav>
  );
}
