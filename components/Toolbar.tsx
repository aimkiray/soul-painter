'use client';

import React, { useSyncExternalStore } from 'react';
import { useConfig } from '@/contexts/ConfigContext';
import { cycleTheme, readTheme, THEME_EVENT } from '@/lib/theme';
import type { ThemeName } from '@/lib/theme';

interface ToolbarProps {
  onOpenLogin?: () => void;
  syncUsername?: string;
  onOpenSettings: () => void;
  onOpenChatSidebar?: () => void;
  chatSidebarOpen?: boolean;
}

function Kbd({ letter }: { letter: string }) {
  return (
    <kbd className="hidden h-18 items-center rounded-4 border border-theme-fg/30 px-4 font-mono text-body-10 xl:keyboard:flex">
      {letter}
    </kbd>
  );
}

const SIDEBAR_ICON_PATH =
  'M22 5V3h-2V2H4v1H2v2H1v14h1v2h2v1h16v-1h2v-2h1V5Zm-2 13h-1v1h-9V5h9v1h1Z';
const SIDEBAR_OPEN_GLYPH =
  'M18 11v2h-1v1h-1v1h-1v1h-1v1h-2v-2h1v-1h1v-1h1v-2h-1v-1h-1V9h-1V7h2v1h1v1h1v1h1v1z';
const SIDEBAR_CLOSED_GLYPH =
  'M18 7v2h-1v1h-1v1h-1v2h1v1h1v1h1v2h-2v-1h-1v-1h-1v-1h-1v-1h-1v-2h1v-1h1V9h1V8h1V7z';

function SidebarIcon({ open }: { open: boolean }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="size-18" aria-hidden="true">
      <path fill="currentColor" d={SIDEBAR_ICON_PATH} />
      <path fill="currentColor" d={open ? SIDEBAR_OPEN_GLYPH : SIDEBAR_CLOSED_GLYPH} />
    </svg>
  );
}

export default function Toolbar({ onOpenLogin, syncUsername = '', onOpenSettings, onOpenChatSidebar, chatSidebarOpen = false }: ToolbarProps) {
  const { modelGateEnabled, modelGateUnlocked } = useConfig();
  const theme = useSyncExternalStore<ThemeName>(
    (onChange) => {
      window.addEventListener(THEME_EVENT, onChange);
      return () => window.removeEventListener(THEME_EVENT, onChange);
    },
    readTheme,
    () => 'default',
  );
  const titleUnlocked = modelGateUnlocked;
  const lockedRepeaterMode = modelGateEnabled && !titleUnlocked;

  const actionClass = 'hit-y-8 flex h-full cursor-pointer items-center gap-4 px-4 font-mono text-body-14 uppercase text-theme-muted hover:text-theme-fg';

  // Three-zone grid keeps the model segment dead-center regardless of
  // wordmark/actions width asymmetry.
  return (
    <header className="grid h-34 shrink-0 grid-cols-[1fr_auto_1fr] items-stretch gap-8 overflow-hidden border-b border-theme-fg/30 px-8 lg:px-16">
      {/* wordmark */}
      <div className="flex items-center gap-8 whitespace-nowrap font-mono">
        {onOpenChatSidebar && (
          <button
            type="button"
            onClick={onOpenChatSidebar}
            className="hit-y-8 flex items-center px-4 text-body-14 text-theme-muted hover:text-theme-fg lg:-ml-8"
            aria-label={chatSidebarOpen ? '关闭聊天列表' : '打开聊天列表'}
            aria-expanded={chatSidebarOpen}
          >
            <SidebarIcon open={chatSidebarOpen} />
          </button>
        )}
        <h1 className="whitespace-nowrap font-semibold">{lockedRepeaterMode ? '复读机' : '灵魂画师'}</h1>
        <span className="hidden text-theme-muted lg:block">~/soul-painter</span>
      </div>

      {/* center slot intentionally empty — keeps the wordmark/actions split
          symmetrical via the three-zone grid */}
      <div />

      {/* actions — -mr-8 mirrors the menu button's -ml-8 so the outermost
          boxes sit the same 8px from each viewport edge */}
      <div className="flex min-w-0 items-center justify-end lg:-mr-8">
        <div className="flex h-full min-w-0 items-center">
          {onOpenLogin && (
            <button
              type="button"
              onClick={onOpenLogin}
              className={actionClass}
              aria-label={syncUsername ? `同步账号：${syncUsername}` : '打开同步登录'}
              title={syncUsername ? `同步账号：${syncUsername} (press Y)` : '同步登录 (press Y)'}
            >
              <Kbd letter="Y" />
              <span className={`max-w-32 truncate ${syncUsername ? 'text-theme-fg' : ''}`}>
                {syncUsername || '同步'}
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={() => cycleTheme()}
            className={actionClass}
            aria-label="切换主题"
            title="切换主题 (press T)"
          >
            <Kbd letter="T" />
            <span>{theme}</span>
          </button>

          <button
            type="button"
            onClick={onOpenSettings}
            className={actionClass}
            aria-label="打开设置"
            title="打开设置 (press S)"
          >
            <Kbd letter="S" />
            <span>设置</span>
          </button>

        </div>
      </div>
    </header>
  );
}
