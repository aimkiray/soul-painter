'use client';

import React from 'react';
import { MENU_BAR_FRAME_CLASS } from '@/lib/layout';

interface MenuBarProps {
  activeTab: 'generate' | 'decode';
  onTabChange: (tab: 'generate' | 'decode') => void;
  onOpenLogin?: () => void;
  syncUsername?: string;
  onOpenSettings: () => void;
  onOpenChatSidebar?: () => void;
}

export default function MenuBar({ activeTab, onTabChange, onOpenLogin, syncUsername = '', onOpenSettings, onOpenChatSidebar }: MenuBarProps) {
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
          {onOpenLogin && (
            <button
              onClick={onOpenLogin}
              className={`flex h-8 max-w-[8rem] items-center justify-center truncate cursor-pointer whitespace-nowrap bg-transparent px-1 text-xs transition-colors hover:text-[#00aaaa] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00aaaa] ${syncUsername ? 'text-[#00aaaa]' : 'text-black'}`}
              aria-label={syncUsername ? `同步账号：${syncUsername}` : '打开同步登录'}
              title={syncUsername ? `同步账号：${syncUsername}` : '同步登录'}
            >
              {syncUsername || 'SYNC'}
            </button>
          )}
          <button
            onClick={onOpenSettings}
            className="flex h-8 items-center justify-center cursor-pointer whitespace-nowrap bg-transparent px-1 text-xs text-black transition-colors hover:text-[#00aaaa] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00aaaa]"
            aria-label="打开设置"
          >
            CONFIG
          </button>
        </div>
      </div>
    </nav>
  );
}
