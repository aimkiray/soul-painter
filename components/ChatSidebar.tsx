'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useChat } from '@/contexts/ChatContext';
import type { ChatMessage, ChatSession } from '@/contexts/ChatContext';

interface ChatSidebarProps {
  open: boolean;
  collapsed: boolean;
  onClose: () => void;
  onToggleCollapse: () => void;
}

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
    loadingSessionId,
    isLoading,
    createChatSession,
    switchChatSession,
    renameChatSession,
    clearChatSession,
    deleteChatSession,
  } = useChat();

  const [menuSessionId, setMenuSessionId] = useState<string | null>(null);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [confirmClearSessionId, setConfirmClearSessionId] = useState<string | null>(null);
  const [confirmDeleteSessionId, setConfirmDeleteSessionId] = useState<string | null>(null);

  const orderedSessions = useMemo(() => (
    [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)
  ), [sessions]);

  const closeTools = useCallback(() => {
    setMenuSessionId(null);
    setRenamingSessionId(null);
    setConfirmClearSessionId(null);
    setConfirmDeleteSessionId(null);
  }, []);

  useEffect(() => {
    if (!menuSessionId && !renamingSessionId) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('[data-chat-sidebar-panel]')) return;
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
  }, [closeTools, menuSessionId, renamingSessionId]);

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
    setMenuSessionId(null);
    setConfirmClearSessionId(null);
    setConfirmDeleteSessionId(null);
  };

  const commitRename = () => {
    const nextTitle = renameDraft.trim();
    if (renamingSessionId && nextTitle) renameChatSession(renamingSessionId, nextTitle);
    setRenamingSessionId(null);
    setRenameDraft('');
  };

  const panel = (mobile: boolean) => (
    <div data-chat-sidebar-panel className="flex h-full min-h-0 flex-col bg-black text-[#CCC] font-mono">
      <div className="shrink-0 border-b-2 border-[#AAA] p-2">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-sm text-[#00aaaa]">聊天</span>
          <button
            type="button"
            onClick={mobile ? onClose : onToggleCollapse}
            className="h-8 w-8 border-2 border-[#AAA] bg-black text-[#CCC] text-sm cursor-pointer hover:border-[#00aaaa] hover:text-[#00aaaa]"
            aria-label={mobile ? '关闭聊天列表' : '收起聊天列表'}
          >
            {mobile ? 'X' : '<'}
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
            const loading = isLoading && loadingSessionId === session.id;
            const canClear = session.messages.length > 0;
            const canDelete = !loading;

            return (
              <div
                key={session.id}
                className={`relative border-2 ${active ? 'border-[#00aaaa] bg-[#061616]' : 'border-[#555] bg-black hover:border-[#AAA]'}`}
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
                      className="block w-full min-w-0 px-2 py-2 pr-9 text-left cursor-pointer"
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
                      onClick={() => {
                        setMenuSessionId((current) => current === session.id ? null : session.id);
                        setConfirmClearSessionId(null);
                        setConfirmDeleteSessionId(null);
                      }}
                      className="absolute right-1 top-1 h-7 w-7 border-2 border-[#AAA] bg-black text-[#CCC] text-base leading-none cursor-pointer hover:border-[#00aaaa] hover:text-[#00aaaa]"
                      aria-label="聊天操作"
                      aria-expanded={menuSessionId === session.id}
                    >
                      ...
                    </button>

                    {menuSessionId === session.id && (
                      <div className="absolute right-1 top-9 z-20 w-28 border-2 border-[#AAA] bg-black text-[#CCC]" role="menu">
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
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  return (
    <>
      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/70 md:hidden" onClick={onClose} />
          <aside
            className="fixed inset-y-0 left-0 z-50 border-r-2 border-[#AAA] md:hidden"
            style={{ width: 'min(20rem, calc(100vw - 2rem))' }}
            aria-label="聊天列表"
          >
            {panel(true)}
          </aside>
        </>
      )}

      {collapsed ? (
        <aside className="hidden w-10 shrink-0 border-r-2 border-[#AAA] bg-black md:flex md:flex-col md:items-center md:py-2" aria-label="聊天列表已收起">
          <button
            type="button"
            onClick={onToggleCollapse}
            className="h-8 w-8 border-2 border-[#AAA] bg-black text-[#CCC] text-sm cursor-pointer hover:border-[#00aaaa] hover:text-[#00aaaa]"
            aria-label="展开聊天列表"
          >
            &gt;
          </button>
        </aside>
      ) : (
        <aside className="hidden w-72 shrink-0 border-r-2 border-[#AAA] bg-black md:flex lg:w-80" aria-label="聊天列表">
          {panel(false)}
        </aside>
      )}
    </>
  );
}
