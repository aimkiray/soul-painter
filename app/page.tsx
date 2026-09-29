'use client';

import React, { useState, useEffect, useLayoutEffect } from 'react';
import { I18nProvider, useI18n } from '@/contexts/I18nContext';
import { ConfigProvider } from '@/contexts/ConfigContext';
import { ChatProvider, useChat } from '@/contexts/ChatContext';
import { ImageProvider, useImages } from '@/contexts/ImageContext';
import Toolbar from '@/components/Toolbar';
import ChatSidebar from '@/components/ChatSidebar';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import ChatArea from '@/components/ChatArea';
import ChatInput from '@/components/ChatInput';
import ImageGrid from '@/components/ImageGrid';
import ImageEditor from '@/components/ImageEditor';
import SettingsModal from '@/components/SettingsModal';
import LoginModal from '@/components/LoginModal';
import DebugPanel from '@/components/DebugPanel';
import Footer from '@/components/Footer';
import {
  CHAT_SIDEBAR_COLLAPSED_STORAGE_KEY,
} from '@/lib/constants';
import { isLocalDataCleared } from '@/lib/local-data-cleared';
import { readSyncUsername } from '@/lib/request-helpers';
import { cycleTheme } from '@/lib/theme';
import { modalLayerCount } from '@/lib/modal-stack';
import { useGlobalImageDrop } from '@/hooks/useGlobalImageDrop';
import { useRunPrompt } from '@/hooks/useRunPrompt';

// ── Component ──

function HomeInner() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [syncUsername, setSyncUsername] = useState('');
  const [chatSidebarCollapsed, setChatSidebarCollapsed] = useState(false);
  const [chatSidebarCollapsedReady, setChatSidebarCollapsedReady] = useState(false);
  const [chatSidebarOpen, setChatSidebarOpen] = useState(false);
  const [isDesktopMedia, setIsDesktopMedia] = useState(false);

  // Read persisted UI state in a layout effect so the sidebar never paints in
  // the wrong collapsed state (a setTimeout would flash after first paint).
  /* eslint-disable react-hooks/set-state-in-effect -- syncing from localStorage before paint */
  useLayoutEffect(() => {
    setSyncUsername(readSyncUsername());
    try {
      setChatSidebarCollapsed(localStorage.getItem(CHAT_SIDEBAR_COLLAPSED_STORAGE_KEY) === '1');
    } catch {
      // ignore
    } finally {
      setChatSidebarCollapsedReady(true);
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const { isLoading, toggleDebug } = useChat();
  const { editingIndex, closeEditor } = useImages();
  const { lang, setLang } = useI18n();

  // Contract: useGlobalImageDrop(enabled) — drop/paste only while no modal
  // layer is open.
  const imageDropEnabled = !settingsOpen
    && !loginOpen
    && editingIndex < 0
    && !chatSidebarOpen;
  useGlobalImageDrop(imageDropEnabled);

  // F1/S open settings, T cycles the terminal palette, D toggles ~/debug,
  // Y opens ~/sync, L switches the UI language.
  // event.code is layout-independent; hotkeys fire only with no modifiers, on
  // non-editable targets, and while no modal/menu layer is open.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      if (modalLayerCount() > 0) return;
      if (event.key === 'F1' || event.code === 'KeyS') {
        event.preventDefault();
        setSettingsOpen(true);
      } else if (event.code === 'KeyT') {
        cycleTheme();
      } else if (event.code === 'KeyD') {
        toggleDebug();
      } else if (event.code === 'KeyY') {
        setLoginOpen(true);
      } else if (event.code === 'KeyL') {
        setLang(lang === 'zh' ? 'en' : 'zh');
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [toggleDebug, lang, setLang]);

  // iOS zoom guard: focusing a field swaps maximum-scale=1 into the viewport
  // meta so Safari doesn't auto-zoom the fixed composer; restored on blur.
  useEffect(() => {
    const setMaxScale = (on: boolean) => {
      const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
      if (!meta) return;
      const parts = (meta.getAttribute('content') ?? '')
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part && !part.startsWith('maximum-scale'));
      if (on) parts.push('maximum-scale=1');
      meta.setAttribute('content', parts.join(', '));
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) setMaxScale(true);
    };
    const onFocusOut = () => setMaxScale(false);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      setMaxScale(false);
    };
  }, []);

  const {
    handleSend,
    handleRegenerateMessage,
    handleEditMessage,
    handleCancel,
    pendingRegenerateMessageId,
  } = useRunPrompt();

  // Edge-aware scroll fades: mark .scroll-fade-* containers with data-fade-*
  // only while content is hidden behind that edge, so the mask never greys
  // content already flush with the boundary.
  useEffect(() => {
    const update = (el: Element) => {
      el.setAttribute('data-fade-top', String(el.scrollTop > 2));
      el.setAttribute('data-fade-bottom', String(el.scrollTop + el.clientHeight < el.scrollHeight - 2));
      el.setAttribute('data-fade-left', String(el.scrollLeft > 2));
      el.setAttribute('data-fade-right', String(el.scrollLeft + el.clientWidth < el.scrollWidth - 2));
    };
    const isFadeTarget = (node: EventTarget | null): node is HTMLElement =>
      node instanceof HTMLElement
      && (node.classList.contains('scroll-fade-y') || node.classList.contains('scroll-fade-x'));
    const fadeTargets = () => document.querySelectorAll('.scroll-fade-y, .scroll-fade-x');
    const updateAll = () => fadeTargets().forEach(update);
    const onScroll = (event: Event) => {
      if (isFadeTarget(event.target)) update(event.target);
    };
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    const resizes = new ResizeObserver(updateAll);
    const mutations = new MutationObserver(() => {
      updateAll();
      // Newly mounted containers (menus, modals) must join the observation
      // set; scrollHeight changes without DOM edits (sidebar resizes, window
      // resizes) are caught by observing each target element itself.
      fadeTargets().forEach((el) => resizes.observe(el));
    });
    mutations.observe(document.body, { subtree: true, childList: true, characterData: true });
    window.addEventListener('resize', updateAll);
    updateAll();
    fadeTargets().forEach((el) => resizes.observe(el));
    return () => {
      document.removeEventListener('scroll', onScroll, { capture: true });
      mutations.disconnect();
      resizes.disconnect();
      window.removeEventListener('resize', updateAll);
    };
  }, []);

  useEffect(() => {
    if (!chatSidebarCollapsedReady || isLocalDataCleared()) return;
    try {
      localStorage.setItem(CHAT_SIDEBAR_COLLAPSED_STORAGE_KEY, chatSidebarCollapsed ? '1' : '0');
    } catch {
      // ignore
    }
  }, [chatSidebarCollapsed, chatSidebarCollapsedReady]);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)');
    const syncMedia = () => {
      setIsDesktopMedia(media.matches);
      if (media.matches) setChatSidebarOpen(false);
    };

    syncMedia();
    media.addEventListener('change', syncMedia);
    return () => media.removeEventListener('change', syncMedia);
  }, []);

  return (
    <ErrorBoundary>
    <div className="flex flex-col h-full overflow-hidden">
      <Toolbar
        onOpenLogin={() => setLoginOpen(true)}
        syncUsername={syncUsername}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenChatSidebar={() => {
          if (isDesktopMedia) setChatSidebarCollapsed((v) => !v);
          else setChatSidebarOpen((v) => !v);
        }}
        chatSidebarOpen={isDesktopMedia ? !chatSidebarCollapsed : chatSidebarOpen}
      />
      <div className="relative flex-1 flex flex-col overflow-hidden min-h-0">

      <main className="flex-1 flex flex-col overflow-hidden min-h-0" role="main">
        <div className="flex-1 flex overflow-hidden">
          <ChatSidebar
            open={chatSidebarOpen}
            collapsed={chatSidebarCollapsed}
            onClose={() => setChatSidebarOpen(false)}
          />
          {/* Fixed chat pane: default width = max width (48rem); auto margins
              center it, leftover space becomes gutters beside the windows.
              calc(100%-8px) + px-2 gives a uniform 6px inner boundary on
              narrow screens while keeping ring-1 hairlines unclipped. */}
          <div className="mx-auto flex w-[calc(100%-8px)] max-w-3xl min-w-0 flex-col overflow-hidden px-2">
            <ChatArea
              onRegenerateMessage={handleRegenerateMessage}
              onEditMessage={handleEditMessage}
              pendingMessageId={pendingRegenerateMessageId}
            />
            <div className="lg:hidden"><ImageGrid layout="strip" /></div>
            <ChatInput
              onSend={handleSend}
              isLoading={isLoading}
              onCancel={handleCancel}
            />
          </div>
          <div className="hidden lg:flex"><ImageGrid layout="sidebar" /></div>
        </div>
        {editingIndex >= 0 && (
          <ErrorBoundary compact><ImageEditor onClose={() => closeEditor()} /></ErrorBoundary>
        )}
      </main>

      <Footer />
      </div>

      <ErrorBoundary compact>
        <SettingsModal
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
        />
      </ErrorBoundary>
      {loginOpen && (
        <ErrorBoundary compact>
          <LoginModal
            open={loginOpen}
            onClose={() => setLoginOpen(false)}
            onAuthChange={setSyncUsername}
          />
        </ErrorBoundary>
      )}

      <DebugPanel />
    </div>
    </ErrorBoundary>
  );
}

export default function Home() {
  return (
    <ErrorBoundary>
      <I18nProvider>
        <ConfigProvider>
          <ChatProvider>
            <ImageProvider>
              <HomeInner />
            </ImageProvider>
          </ChatProvider>
        </ConfigProvider>
      </I18nProvider>
    </ErrorBoundary>
  );
}
