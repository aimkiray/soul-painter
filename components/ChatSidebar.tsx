'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useChat } from '@/contexts/ChatContext';
import type { ChatMessage, ChatSession } from '@/contexts/ChatContext';
import { useI18n } from '@/contexts/I18nContext';
import { registerModalLayer } from '@/lib/modal-stack';
import { DEFAULT_CHAT_TITLE, LEGACY_CHAT_TITLE } from '@/lib/storage/chat-normalize';
import type { Lang, MsgKey } from '@/lib/i18n';
import Modal from './Modal';

interface ChatSidebarProps {
  open: boolean;
  collapsed: boolean;
  onClose: () => void;
}

interface MenuState {
  sessionId: string;
  left: number;
  top: number;
}

const SIDEBAR_MIN_W = 160;
const SIDEBAR_MAX_W = 480;
const SIDEBAR_DEFAULT_W = 256;
const MENU_WIDTH = 128;
const MENU_HEIGHT = 112;
const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE = 10;

function formatSessionTime(timestamp: number, lang: Lang) {
  if (!timestamp || !Number.isFinite(timestamp)) return '--:--';
  return new Date(timestamp).toLocaleTimeString(lang === 'zh' ? 'zh-CN' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

type TFunc = (key: MsgKey, vars?: Record<string, string | number>) => string;

// Auto-managed titles are stored as Chinese constants; render them localized.
// Manually renamed titles pass through untouched.
function sessionTitleText(title: string, t: TFunc) {
  return title === DEFAULT_CHAT_TITLE || title === LEGACY_CHAT_TITLE ? t('untitledChat') : title;
}

function messagePreview(message: ChatMessage | undefined, t: TFunc) {
  if (!message) return t('emptySession');
  if (message.role === 'user' && message.prompt.trim())
    return message.prompt.trim();
  if (message.role === 'bot') {
    if (message.extra === 'error') return t('requestFailed');
    if (message.text.trim()) return message.text.trim();
    if (message.images.length > 0)
      return t('generatedCount', { n: message.images.length });
  }
  return t('emptySession');
}

function latestPreview(messages: ChatMessage[], t: TFunc) {
  const latest = [...messages]
    .reverse()
    .find(
      (message) =>
        (message.role === 'user' && message.prompt.trim()) ||
        (message.role === 'bot' &&
          (message.text.trim() || message.images.length > 0 || message.extra)),
    );
  return messagePreview(latest, t);
}

export default function ChatSidebar({
  open,
  collapsed,
  onClose,
}: ChatSidebarProps) {
  const {
    sessions,
    activeSessionId,
    isSessionLoading,
    promptDrafts,
    createChatSession,
    switchChatSession,
    renameChatSession,
    clearChatSession,
    deleteChatSession,
  } = useChat();
  const { lang, t } = useI18n();

  const [menuState, setMenuState] = useState<MenuState | null>(null);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(
    null,
  );
  const [renameDraft, setRenameDraft] = useState('');
  const [confirmClearSessionId, setConfirmClearSessionId] = useState<
    string | null
  >(null);
  const [confirmDeleteSessionId, setConfirmDeleteSessionId] = useState<
    string | null
  >(null);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_W);

  // Scratch sessions (no messages and no prompt draft) stay out of the
  // listing — they materialise as a card once the user types or sends.
  const orderedSessions = sessions.filter(
    (session) => session.messages.length > 0 || Boolean(promptDrafts[session.id]?.trim()),
  );

  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressPosRef = useRef({ x: 0, y: 0 });
  const suppressRowClickRef = useRef(false);

  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  useEffect(() => cancelLongPress, [cancelLongPress]);

  const openMenuAt = useCallback((sessionId: string, x: number, y: number) => {
    const left = Math.min(Math.max(x, 8), Math.max(8, window.innerWidth - MENU_WIDTH - 8));
    const top = Math.min(Math.max(y, 8), Math.max(8, window.innerHeight - MENU_HEIGHT - 8));
    setMenuState({ sessionId, left, top });
    setConfirmClearSessionId(null);
    setConfirmDeleteSessionId(null);
  }, []);

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

  useEffect(() => {
    if (!menuState && !renamingSessionId) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      const inside = target instanceof Element
        ? {
            menu: !!target.closest('[data-chat-sidebar-menu]'),
            panel: !!target.closest('[data-chat-sidebar-panel]'),
            rename: !!target.closest('[data-chat-rename]'),
          }
        : { menu: false, panel: false, rename: false };
      // Presses on the menu itself keep it open; anywhere else dismisses it —
      // including blank space inside the panel. The rename editor survives
      // presses inside the panel but still closes on outside presses.
      if (inside.menu || inside.rename) return;
      setMenuState(null);
      setConfirmClearSessionId(null);
      setConfirmDeleteSessionId(null);
      if (!inside.panel) setRenamingSessionId(null);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [closeTools, menuState, renamingSessionId]);

  // Escape for open menus / rename flows through the modal stack so only the
  // topmost layer responds.
  useEffect(() => {
    if (!menuState && !renamingSessionId) return;
    return registerModalLayer('chat-sidebar-tools', closeTools);
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

  // Menu focus lifecycle: opening hands focus to the first item; closing
  // returns it to the kebab that opened the menu — unless a rename input or
  // the drawer teardown is about to claim it.
  useEffect(() => {
    if (menuState) {
      menuRef.current
        ?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')
        ?.focus();
      return;
    }
    if (!renamingSessionId) menuTriggerRef.current?.focus();
  }, [menuState, renamingSessionId]);

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

  const commitRename = () => {
    const nextTitle = renameDraft.trim();
    if (renamingSessionId && nextTitle)
      renameChatSession(renamingSessionId, nextTitle);
    setRenamingSessionId(null);
    setRenameDraft('');
  };

  const panel = () => (
    <div
      data-chat-sidebar-panel
      className="flex h-full min-h-0 w-full min-w-0 flex-col bg-theme-bg font-mono text-theme-fg"
    >
      {/* window title bar */}
      <div className="flex h-26 shrink-0 items-center justify-between gap-4 border-b border-theme-fg/30 px-8">
        <span className="truncate">~/sessions</span>
      </div>
      <div className="shrink-0 px-8 py-8 lg:pr-2">
        <button
          type="button"
          onClick={handleNewSession}
          className="h-28 w-full cursor-pointer border border-transparent bg-theme-fg px-8 text-left text-theme-bg hover:border-theme-fg hover:bg-transparent hover:text-theme-fg"
        >
          {t('newChat')}
        </button>
      </div>

      {/* ls -l listing: sessions as files */}
      <div className="@container scroll-fade-y flex-1 overflow-y-auto px-8 py-8 lg:pr-2">
        <div className="flex flex-col gap-6">
          {orderedSessions.map((session) => {
            const active = session.id === activeSessionId;
            const loading = isSessionLoading(session.id);

            return (
              <div key={session.id} className="group relative">
                {renamingSessionId === session.id ? (
                  <div data-chat-rename className="ring-1 ring-theme-fg/30 p-8">
                    <input
                      value={renameDraft}
                      onChange={(event) => setRenameDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.nativeEvent.isComposing) return;
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          commitRename();
                        } else if (event.key === 'Escape') {
                          setRenamingSessionId(null);
                        }
                      }}
                      className="mb-8 w-full bg-theme-bg px-8 py-4 font-mono text-body-14 text-theme-fg outline-none ring-1 ring-theme-fg"
                      autoFocus
                      maxLength={24}
                      aria-label={t('sessionName')}
                    />
                    <div className="flex justify-end gap-8">
                      <button
                        type="button"
                        onClick={commitRename}
                        disabled={!renameDraft.trim()}
                        className="cursor-pointer px-8 py-2 text-body-10 uppercase ring-1 ring-theme-fg/30 hover:bg-theme-fg hover:text-theme-bg disabled:opacity-40"
                      >
                        {t('save')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setRenamingSessionId(null)}
                        className="cursor-pointer px-8 py-2 text-body-10 uppercase text-theme-dim ring-1 ring-theme-fg/30 hover:bg-theme-fg/10"
                      >
                        {t('cancel')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        // Swallow the click that follows a long-press trigger —
                        // the gesture already opened the menu.
                        if (suppressRowClickRef.current) {
                          suppressRowClickRef.current = false;
                          return;
                        }
                        handleSwitchSession(session.id);
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        cancelLongPress();
                        // Only a touch long-press is followed by a click event
                        // that must be swallowed; a mouse right-click is not —
                        // arming the flag here would eat the next left click.
                        // (strict === 'touch': engines where contextmenu is a
                        // plain MouseEvent report pointerType as undefined.)
                        if ((event.nativeEvent as PointerEvent).pointerType === 'touch') {
                          suppressRowClickRef.current = true;
                        }
                        menuTriggerRef.current = event.currentTarget;
                        openMenuAt(session.id, event.clientX, event.clientY);
                      }}
                      onPointerDown={(event) => {
                        // A fresh tap disarms the suppress flag — if the
                        // long-press click never arrived (finger released
                        // over the menu), the flag would otherwise swallow
                        // this tap's click instead.
                        suppressRowClickRef.current = false;
                        if (event.pointerType === 'mouse') return;
                        const { clientX, clientY } = event;
                        cancelLongPress();
                        longPressPosRef.current = { x: clientX, y: clientY };
                        longPressTimerRef.current = setTimeout(() => {
                          longPressTimerRef.current = null;
                          suppressRowClickRef.current = true;
                          menuTriggerRef.current = event.currentTarget;
                          openMenuAt(session.id, clientX, clientY);
                        }, LONG_PRESS_MS);
                      }}
                      onPointerMove={(event) => {
                        if (!longPressTimerRef.current) return;
                        const dx = event.clientX - longPressPosRef.current.x;
                        const dy = event.clientY - longPressPosRef.current.y;
                        if (Math.hypot(dx, dy) > LONG_PRESS_MOVE) cancelLongPress();
                      }}
                      onPointerUp={cancelLongPress}
                      onPointerCancel={cancelLongPress}
                      onPointerLeave={cancelLongPress}
                      className={`grid min-h-28 w-full min-w-0 grid-cols-[minmax(0,1fr)] items-center gap-x-[2ch] px-8 py-4 text-left cursor-pointer ring-1 ${
                        active
                          ? 'bg-theme-fg text-theme-bg ring-theme-fg'
                          : 'ring-theme-fg/30 hover:bg-theme-fg/10 hover:ring-theme-fg/60'
                      } @min-[180px]:grid-cols-[minmax(0,1fr)_auto_auto]`}
                      aria-current={active ? 'true' : undefined}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">
                          {sessionTitleText(session.title, t)}
                        </span>
                        <span
                          className={`block truncate text-body-10 ${active ? 'opacity-80' : 'text-theme-muted'}`}
                        >
                          {latestPreview(session.messages, t)}
                          {loading ? t('generatingSuffix') : ''}
                        </span>
                      </span>
                      <span
                        aria-hidden
                        className={`hidden tabular-nums @min-[180px]:block ${active ? 'opacity-80' : 'text-theme-dim'}`}
                      >
                        {session.messages.length}m
                      </span>
                      <span
                        aria-hidden
                        className={`hidden tabular-nums @min-[180px]:block ${active ? 'opacity-80' : 'text-theme-dim'}`}
                      >
                        {formatSessionTime(session.updatedAt, lang)}
                      </span>
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  // The session menu is portaled once at component root — panel() renders in
  // both the desktop aside and the mobile drawer, so a portal inside it would
  // duplicate (and escape the hidden aside's display:none on mobile).
  const menuPortal =
    menuState &&
    typeof document !== 'undefined' &&
    createPortal(
      <div
        ref={menuRef}
        data-chat-sidebar-menu
        className="fixed z-[9998] flex w-128 flex-col gap-1 rounded-4 bg-theme-bg p-2 font-mono text-body-14 text-theme-fg ring-1 ring-theme-fg/30"
        style={{
          left: `${menuState.left}px`,
          top: `${menuState.top}px`,
        }}
        role="menu"
        aria-label={t('sessionMenu')}
        onKeyDown={(event) => {
          const items = Array.from(
            menuRef.current?.querySelectorAll<HTMLButtonElement>(
              '[role="menuitem"]:not(:disabled)',
            ) ?? [],
          );
          if (!items.length) return;
          const index = items.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            items[(index + 1) % items.length].focus();
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            items[(index - 1 + items.length) % items.length].focus();
          } else if (event.key === 'Home') {
            event.preventDefault();
            items[0].focus();
          } else if (event.key === 'End') {
            event.preventDefault();
            items[items.length - 1].focus();
          } else if (event.key === 'Tab') {
            event.preventDefault();
            closeTools();
          }
        }}
      >
        {(() => {
          const session = sessions.find(
            (item) => item.id === menuState.sessionId,
          );
          if (!session) return null;
          const loading = isSessionLoading(session.id);
          const canClear = session.messages.length > 0 && !loading;
          const canDelete = !loading;

          return (
            <>
              <button
                type="button"
                onClick={() => startRename(session)}
                className="block w-full cursor-pointer rounded-2 px-8 py-4 text-left hover:bg-theme-fg/10 focus:bg-theme-fg/10"
                role="menuitem"
              >
                {t('rename')}
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
                className="block w-full cursor-pointer rounded-2 px-8 py-4 text-left hover:bg-theme-fg/10 focus:bg-theme-fg/10 disabled:cursor-not-allowed disabled:opacity-40"
                role="menuitem"
              >
                {confirmClearSessionId === session.id ? t('confirmClear') : t('clear')}
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
                className="block w-full cursor-pointer rounded-2 px-8 py-4 text-left text-error hover:bg-theme-fg/10 focus:bg-theme-fg/10 disabled:cursor-not-allowed disabled:opacity-40"
                role="menuitem"
              >
                {confirmDeleteSessionId === session.id ? t('confirmDelete') : t('delete')}
              </button>
            </>
          );
        })()}
      </div>,
      document.body,
    );

  return (
    <>
      {menuPortal}
      {open && (
        <Modal
          id="chat-sidebar-drawer"
          onClose={closeSidebar}
          ariaLabel={t('chatList')}
          backdropClassName="absolute inset-0 z-40 bg-black/70 lg:hidden"
          panelClassName="absolute inset-y-0 left-0 z-50 w-[clamp(240px,72vw,280px)] overflow-hidden bg-theme-bg ring-1 ring-theme-fg/30 lg:hidden"
        >
          {panel()}
        </Modal>
      )}

      {!collapsed && (
        <aside
          className="hidden shrink-0 overflow-hidden lg:flex"
          style={{ width: `${sidebarWidth}px` }}
          aria-label={t('chatList')}
        >
          {panel()}
          {/* Split-pane separator — the design's one resizable control.
              Pointer-capture drag clamps the panel width; Arrow keys nudge,
              Home/End snap to bounds, Enter/Space/double-click reset. */}
          <div
            role="separator"
            tabIndex={0}
            aria-label={t('resizeSidebar')}
            aria-orientation="vertical"
            aria-valuenow={sidebarWidth}
            aria-valuemin={SIDEBAR_MIN_W}
            aria-valuemax={SIDEBAR_MAX_W}
            className="group relative flex h-full w-12 shrink-0 cursor-col-resize touch-none items-center justify-center px-5 outline-none"
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              const startX = event.clientX;
              const base = sidebarWidth;
              const onMove = (moveEvent: PointerEvent) => {
                setSidebarWidth(
                  Math.min(
                    SIDEBAR_MAX_W,
                    Math.max(SIDEBAR_MIN_W, base + moveEvent.clientX - startX),
                  ),
                );
              };
              const onEnd = () => {
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onEnd);
                window.removeEventListener('pointercancel', onEnd);
              };
              window.addEventListener('pointermove', onMove);
              window.addEventListener('pointerup', onEnd);
              window.addEventListener('pointercancel', onEnd);
            }}
            onDoubleClick={() => setSidebarWidth(SIDEBAR_DEFAULT_W)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                const step = event.key === 'ArrowLeft' ? -8 : 8;
                setSidebarWidth((w) =>
                  Math.min(SIDEBAR_MAX_W, Math.max(SIDEBAR_MIN_W, w + step)),
                );
              } else if (event.key === 'Home') {
                event.preventDefault();
                setSidebarWidth(SIDEBAR_MIN_W);
              } else if (event.key === 'End') {
                event.preventDefault();
                setSidebarWidth(SIDEBAR_MAX_W);
              } else if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setSidebarWidth(SIDEBAR_DEFAULT_W);
              }
            }}
          >
            {/* Continues the title bar's bottom hairline across the handle
                zone so it meets the divider — otherwise a 12px gap shows. */}
            <span aria-hidden className="absolute left-0 right-1/2 top-0 h-26 border-b border-theme-fg/30" />
            <span
              aria-hidden
              className="h-full w-1 bg-theme-fg/30 transition-colors group-hover:bg-theme-fg/60 group-focus-visible:bg-theme-fg/60"
            />
          </div>
        </aside>
      )}
    </>
  );
}
