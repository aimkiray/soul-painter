'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useChat } from '@/contexts/ChatContext';
import type { ChatMessage, ChatSession } from '@/contexts/ChatContext';

interface ChatSidebarProps {
  open: boolean;
  collapsed: boolean;
  onClose: () => void;
  onToggleCollapse: () => void;
}

interface MenuState {
  sessionId: string;
  left: number;
  top: number;
}

const MENU_WIDTH = 128;
const MENU_HEIGHT = 114;

function formatSessionTime(timestamp: number) {
  if (!timestamp || !Number.isFinite(timestamp)) return '--:--';
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function messagePreview(message: ChatMessage | undefined) {
  if (!message) return '空会话';
  if (message.role === 'user' && message.prompt.trim()) return message.prompt.trim();
  if (message.role === 'bot') {
    if (message.extra === 'error') return '请求失败';
    if (message.text.trim()) return message.text.trim();
    if (message.images.length > 0) return `生成 ${message.images.length} 张图片`;
  }
  return '空会话';
}

function latestPreview(messages: ChatMessage[]) {
  const latest = [...messages].reverse().find((message) => (
    (message.role === 'user' && message.prompt.trim())
    || (message.role === 'bot' && (message.text.trim() || message.images.length > 0 || message.extra))
  ));
  return messagePreview(latest);
}

export default function ChatSidebar({
  open,
  collapsed,
  onClose,
  onToggleCollapse,
}: ChatSidebarProps) {
  const {
    sessions,
    activeSessionId,
    isSessionLoading,
    createChatSession,
    switchChatSession,
    renameChatSession,
    clearChatSession,
    deleteChatSession,
  } = useChat();

  const [menuState, setMenuState] = useState<MenuState | null>(null);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [confirmClearSessionId, setConfirmClearSessionId] = useState<string | null>(null);
  const [confirmDeleteSessionId, setConfirmDeleteSessionId] = useState<string | null>(null);

  const orderedSessions = sessions;

  const closeTools = useCallback(() => {
    setMenuState(null);
    setRenamingSessionId(null);
    setConfirmClearSessionId(null);
    setConfirmDeleteSessionId(null);
  }, []);

  const closeSidebar = useCallback(() => {
    closeTools();
    onClose();
  }, [closeTools, onClose]);

  const toggleCollapse = useCallback(() => {
    closeTools();
    onToggleCollapse();
  }, [closeTools, onToggleCollapse]);

  useEffect(() => {
    if (!menuState && !renamingSessionId) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('[data-chat-sidebar-panel], [data-chat-sidebar-menu]')) return;
      closeTools();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeTools();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeTools, menuState, renamingSessionId]);

  useEffect(() => {
    if (!menuState) return;
    const handleViewportChange = () => closeTools();

    window.addEventListener('resize', handleViewportChange);
    document.addEventListener('scroll', handleViewportChange, true);
    return () => {
      window.removeEventListener('resize', handleViewportChange);
      document.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [closeTools, menuState]);

  const handleNewSession = () => {
    closeTools();
    createChatSession();
    onClose();
  };

  const handleSwitchSession = (sessionId: string) => {
    closeTools();
    switchChatSession(sessionId);
    onClose();
  };

  const startRename = (session: ChatSession) => {
    setRenameDraft(session.title);
    setRenamingSessionId(session.id);
    setMenuState(null);
    setConfirmClearSessionId(null);
    setConfirmDeleteSessionId(null);
  };

  const openMenu = useCallback((sessionId: string, button: HTMLButtonElement) => {
    const rect = button.getBoundingClientRect();
    const maxLeft = Math.max(8, window.innerWidth - MENU_WIDTH - 8);
    const iconLeft = rect.left + rect.width / 2 - 11;
    const left = Math.min(Math.max(iconLeft, 8), maxLeft);
    const belowTop = rect.bottom + 4;
    const aboveTop = rect.top - MENU_HEIGHT - 4;
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const spaceAbove = rect.top - 8;
    const above = spaceBelow < MENU_HEIGHT && spaceAbove > spaceBelow;
    const top = Math.max(8, Math.min(above ? aboveTop : belowTop, window.innerHeight - MENU_HEIGHT - 8));

    setMenuState((current) => current?.sessionId === sessionId ? null : { sessionId, left, top });
    setConfirmClearSessionId(null);
    setConfirmDeleteSessionId(null);
  }, []);

  const commitRename = () => {
    const nextTitle = renameDraft.trim();
    if (renamingSessionId && nextTitle) renameChatSession(renamingSessionId, nextTitle);
    setRenamingSessionId(null);
    setRenameDraft('');
  };

  const panel = (mobile: boolean) => (
    <div data-chat-sidebar-panel className="flex h-full min-h-0 w-full min-w-0 flex-col bg-black text-[#CCC] font-mono">
      <div className="shrink-0 border-b-2 border-[#AAA] px-2 pb-2 pt-0 lg:pt-1">
        <div className="flex items-center justify-between gap-2 lg:mb-1">
          <span className="text-sm text-[#00aaaa]">聊天</span>
          <button
            type="button"
            onClick={mobile ? closeSidebar : toggleCollapse}
            className="flex h-8 items-center justify-center bg-transparent p-0 text-[#CCC] cursor-pointer hover:text-[#00aaaa] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00aaaa]"
            aria-label={mobile ? '关闭聊天列表' : '收起聊天列表'}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="2 2 18 18" aria-hidden="true" className="block h-5 w-5">
              <path fill="currentColor" d="M12 16h-2v-1H9v-1H8v-1H7v-1H6v-2h1V9h1V8h1V7h1V6h2v2h-1v1h-1v1h6v2h-6v1h1v1h1m6 6H4v-1H3v-1H2V4h1V3h1V2h14v1h1v1h1v14h-1v1h-1m-1-1v-1h1V5h-1V4H5v1H4v12h1v1Z" />
            </svg>
          </button>
        </div>
        <button
          type="button"
          onClick={handleNewSession}
          className="h-9 w-full border-2 border-[#00aaaa] bg-[#00aaaa] px-3 text-left text-sm text-black cursor-pointer"
        >
          + 新建聊天
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        <div className="space-y-1">
          {orderedSessions.map((session) => {
            const active = session.id === activeSessionId;
            const loading = isSessionLoading(session.id);

            return (
              <div
                key={session.id}
                className={`group relative border-2 ${active ? 'border-[#00aaaa] bg-[#061616]' : 'border-[#555] bg-black hover:border-[#AAA]'}`}
              >
                {renamingSessionId === session.id ? (
                  <div className="p-2">
                    <input
                      value={renameDraft}
                      onChange={(event) => setRenameDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          commitRename();
                        } else if (event.key === 'Escape') {
                          setRenamingSessionId(null);
                        }
                      }}
                      className="mb-2 w-full bg-black border-2 border-[#00aaaa] px-2 py-1 text-sm text-[#CCC] outline-none"
                      autoFocus
                      maxLength={24}
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={commitRename}
                        disabled={!renameDraft.trim()}
                        className="border-2 border-[#00aaaa] px-2 py-0.5 text-xs text-[#00aaaa] cursor-pointer disabled:opacity-40"
                      >
                        保存
                      </button>
                      <button
                        type="button"
                        onClick={() => setRenamingSessionId(null)}
                        className="border-2 border-[#AAA] px-2 py-0.5 text-xs text-[#CCC] cursor-pointer"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => handleSwitchSession(session.id)}
                      className="block w-full min-w-0 px-2 py-2 pr-11 text-left cursor-pointer"
                      aria-current={active ? 'true' : undefined}
                    >
                      <span className="block truncate text-sm text-[#EEE]">{session.title}</span>
                      <span className="mt-0.5 block truncate text-xs text-[#888]">
                        消息 {session.messages.length} · {formatSessionTime(session.updatedAt)}
                        {loading ? ' · 生成中' : ''}
                      </span>
                      <span className="mt-1 block truncate text-xs text-[#AAA]">{latestPreview(session.messages)}</span>
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        openMenu(session.id, event.currentTarget);
                      }}
                      className={`absolute right-0 top-0.5 flex h-7 w-7 items-center justify-center bg-transparent text-lg leading-none text-[#CCC] cursor-pointer transition-colors hover:text-[#00aaaa] focus-visible:text-[#00aaaa] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00aaaa] lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100 ${menuState?.sessionId === session.id ? 'lg:opacity-100 text-[#00aaaa]' : ''}`}
                      aria-label="会话菜单"
                      aria-expanded={menuState?.sessionId === session.id}
                      aria-haspopup="menu"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 22 22" aria-hidden="true" className="block">
                        <path d="M0 0h22v22H0z" fill="none" />
                        <path fill="currentColor" d="M14 19h-2v-4H8v4H6v-4H3v-2h4V9H4V7h4V3h2v4h4V3h2v4h3v2h-4v4h3v2h-4m-1-2V9H9v4Z" />
                      </svg>
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>

        {menuState && (
          <div
            data-chat-sidebar-menu
            className="fixed z-[60] w-32 border-2 border-[#AAA] bg-black text-[#CCC]"
            style={{
              left: `${menuState.left}px`,
              top: `${menuState.top}px`,
            }}
            role="menu"
            aria-label="会话菜单"
          >
            {(() => {
              const session = sessions.find((item) => item.id === menuState.sessionId);
              if (!session) return null;
              const loading = isSessionLoading(session.id);
              const canClear = session.messages.length > 0 && !loading;
              const canDelete = !loading;

              return (
                <>
                  <button
                    type="button"
                    onClick={() => startRename(session)}
                    className="block w-full px-3 py-2 text-left text-xs hover:bg-[#111] hover:text-[#00aaaa] cursor-pointer"
                    role="menuitem"
                  >
                    改名
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirmClearSessionId === session.id) {
                        clearChatSession(session.id);
                        closeTools();
                      } else {
                        setConfirmClearSessionId(session.id);
                        setConfirmDeleteSessionId(null);
                      }
                    }}
                    disabled={!canClear}
                    className="block w-full px-3 py-2 text-left text-xs hover:bg-[#111] hover:text-[#00aaaa] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    role="menuitem"
                  >
                    {confirmClearSessionId === session.id ? '确认清空' : '清空'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirmDeleteSessionId === session.id) {
                        deleteChatSession(session.id);
                        closeTools();
                      } else {
                        setConfirmDeleteSessionId(session.id);
                        setConfirmClearSessionId(null);
                      }
                    }}
                    disabled={!canDelete}
                    className="block w-full px-3 py-2 text-left text-xs text-[#ff5555] hover:bg-[#111] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    role="menuitem"
                  >
                    {confirmDeleteSessionId === session.id ? '确认删除' : '删除'}
                  </button>
                </>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {open && (
        <>
          <div className="absolute inset-0 z-40 bg-black/70 lg:hidden" onClick={closeSidebar} />
          <aside
            className="absolute inset-y-0 left-0 z-50 overflow-hidden border-r-2 border-[#AAA] lg:hidden"
            style={{ width: 'clamp(240px, 72vw, 280px)' }}
            aria-label="聊天列表"
          >
            {panel(true)}
          </aside>
        </>
      )}

      {collapsed ? (
        <aside className="hidden w-[48px] shrink-0 bg-black lg:flex lg:flex-col lg:items-center" aria-label="聊天列表已收起">
          <div className="shrink-0 w-full px-2 pb-2 pt-0 lg:pt-1">
            <div className="flex items-center justify-center lg:mb-1">
              <button
                type="button"
                onClick={toggleCollapse}
                className="flex h-8 w-8 items-center justify-center bg-transparent p-0 text-[#CCC] cursor-pointer hover:text-[#00aaaa] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00aaaa]"
                aria-label="展开聊天列表"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="2 2 18 18" aria-hidden="true" className="block h-5 w-5">
                  <path fill="currentColor" d="M12 16h-2v-2h1v-1h1v-1H6v-2h6V9h-1V8h-1V6h2v1h1v1h1v1h1v1h1v2h-1v1h-1v1h-1v1h-1m6 5H4v-1H3v-1H2V4h1V3h1V2h14v1h1v1h1v14h-1v1h-1m-1-1v-1h1V5h-1V4H5v1H4v12h1v1Z" />
                </svg>
              </button>
            </div>
          </div>
        </aside>
      ) : (
        <aside className="hidden w-[256px] shrink-0 overflow-hidden border-r-2 border-[#AAA] bg-black lg:flex" aria-label="聊天列表">
          {panel(false)}
        </aside>
      )}
    </>
  );
}
