'use client';

import React, { useState, useEffect, useLayoutEffect } from 'react';
import { ConfigProvider } from '@/contexts/ConfigContext';
import { ChatProvider, useChat } from '@/contexts/ChatContext';
import { ImageProvider, useImages } from '@/contexts/ImageContext';
import StatusBar from '@/components/StatusBar';
import MenuBar from '@/components/MenuBar';
import ChatSidebar from '@/components/ChatSidebar';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import TabDecode from '@/components/TabDecode';
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
import { useGlobalImageDrop } from '@/hooks/useGlobalImageDrop';
import { useRunPrompt } from '@/hooks/useRunPrompt';

// ── Component ──

function HomeInner() {
  const [activeTab, setActiveTab] = useState<'generate' | 'decode'>('generate');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [syncUsername, setSyncUsername] = useState('');
  const [chatSidebarCollapsed, setChatSidebarCollapsed] = useState(false);
  const [chatSidebarCollapsedReady, setChatSidebarCollapsedReady] = useState(false);
  const [chatSidebarOpen, setChatSidebarOpen] = useState(false);

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

  const { isLoading } = useChat();
  const { editingIndex, closeEditor } = useImages();

  // Contract: useGlobalImageDrop(enabled) — drop/paste only on the generate
  // tab while no modal layer is open.
  const imageDropEnabled = activeTab === 'generate'
    && !settingsOpen
    && !loginOpen
    && editingIndex < 0
    && !chatSidebarOpen;
  useGlobalImageDrop(imageDropEnabled);

  // F1 opens settings from anywhere — ChatInput unmounts on the Base64 tab,
  // so this listener has to live at page level. Skipped when the event target
  // is editable so F1 keeps any field-level meaning there.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'F1') return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      event.preventDefault();
      setSettingsOpen(true);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const {
    handleSend,
    handleRegenerateMessage,
    handleEditMessage,
    handleCancel,
    pendingRegenerateMessageId,
  } = useRunPrompt();

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
    const closeMobileSidebar = () => {
      if (media.matches) setChatSidebarOpen(false);
    };

    closeMobileSidebar();
    media.addEventListener('change', closeMobileSidebar);
    return () => media.removeEventListener('change', closeMobileSidebar);
  }, []);

  return (
    <ErrorBoundary>
    <div className="flex flex-col h-full overflow-hidden">
      <StatusBar />
      <div className="relative flex-1 flex flex-col overflow-hidden">
      <MenuBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onOpenLogin={() => setLoginOpen(true)}
        syncUsername={syncUsername}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenChatSidebar={() => setChatSidebarOpen(true)}
      />

      <main className="flex-1 flex flex-col overflow-hidden" role="main">
        {activeTab === 'decode' ? (
          <div id="tab-decode" role="tabpanel"><TabDecode /></div>
        ) : (
          <>
            <div id="tab-generate" role="tabpanel" className="flex-1 flex overflow-hidden">
              <ChatSidebar
                open={chatSidebarOpen}
                collapsed={chatSidebarCollapsed}
                onClose={() => setChatSidebarOpen(false)}
                onToggleCollapse={() => setChatSidebarCollapsed((value) => !value)}
              />
              <div className="flex-1 flex flex-col overflow-hidden min-w-0">
                <ChatArea
                  onRegenerateMessage={handleRegenerateMessage}
                  onEditMessage={handleEditMessage}
                  pendingMessageId={pendingRegenerateMessageId}
                />
                <div className="lg:hidden"><ImageGrid layout="strip" /></div>
                <ChatInput
                  onSend={handleSend}
                  isLoading={isLoading}
                  onOpenSettings={() => setSettingsOpen(true)}
                  onCancel={handleCancel}
                />
              </div>
              <div className="hidden lg:flex"><ImageGrid layout="sidebar" /></div>
            </div>
            {editingIndex >= 0 && (
              <ErrorBoundary><ImageEditor onClose={() => closeEditor()} /></ErrorBoundary>
            )}
          </>
        )}
      </main>

      <Footer />
      </div>

      <ErrorBoundary>
        <SettingsModal
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
        />
      </ErrorBoundary>
      {loginOpen && (
        <ErrorBoundary>
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
      <ConfigProvider>
        <ChatProvider>
          <ImageProvider>
            <HomeInner />
          </ImageProvider>
        </ChatProvider>
      </ConfigProvider>
    </ErrorBoundary>
  );
}
