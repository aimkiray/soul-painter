'use client';

import React from 'react';
import { MENU_BAR_FRAME_CLASS } from '@/lib/layout';

interface MenuBarProps {
  activeTab: 'generate' | 'decode';
  onTabChange: (tab: 'generate' | 'decode') => void;
  onOpenSettings: () => void;
  onOpenChatSidebar?: () => void;
}

export default function MenuBar({ activeTab, onTabChange, onOpenSettings, onOpenChatSidebar }: MenuBarProps) {
  const tabBase = 'h-8 px-2 sm:px-3 py-1.5 sm:py-1 cursor-pointer whitespace-nowrap transition-colors flex items-center text-xs sm:text-sm';
  const tabActive = 'bg-black text-[#00aaaa]';
  const tabInactive = 'text-black hover:text-[#00aaaa]';

  return (
    <nav className="flex-shrink-0 bg-[#AAA] text-black font-mono text-sm" role="tablist" aria-label="功能标签">
      <div className={`${MENU_BAR_FRAME_CLASS} flex items-stretch justify-between`}>
        <div className="flex items-center gap-1.5">
          {onOpenChatSidebar && (
            <button
              onClick={onOpenChatSidebar}
              className="mr-1.5 flex h-8 items-center justify-center cursor-pointer whitespace-nowrap bg-transparent p-0 text-black transition-colors hover:text-[#00aaaa] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00aaaa] lg:hidden"
              aria-label="打开聊天列表"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="2 2 18 18" aria-hidden="true" className="block h-5 w-5">
                <path fill="currentColor" d="M12 16h-2v-2h1v-1h1v-1H6v-2h6V9h-1V8h-1V6h2v1h1v1h1v1h1v1h1v2h-1v1h-1v1h-1v1h-1m6 5H4v-1H3v-1H2V4h1V3h1V2h14v1h1v1h1v14h-1v1h-1m-1-1v-1h1V5h-1V4H5v1H4v12h1v1Z" />
              </svg>
            </button>
          )}
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
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={onOpenSettings}
            className="flex h-8 items-center justify-center cursor-pointer whitespace-nowrap bg-transparent p-0 text-black transition-colors hover:text-[#00aaaa] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00aaaa]"
            aria-label="打开设置"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 22 22" aria-hidden="true" className="block h-6 w-6">
              <path d="M0 0h22v22H0z" fill="none" />
              <path fill="currentColor" d="M2 6h5V3h1V2h6v1h1v3h5v1h1v12h-1v1H2v-1H1V7h1zm7 0h4V4H9zm10 2H3v4h3v-2h3v2h4v-2h3v2h3zM3 18h16v-4h-3v2h-3v-2H9v2H6v-2H3z" />
            </svg>
          </button>
        </div>
      </div>
    </nav>
  );
}
