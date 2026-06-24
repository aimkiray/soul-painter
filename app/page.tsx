'use client';

import React, { useState, useEffect } from 'react';
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

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setSyncUsername(readSyncUsername());
      try {
        setChatSidebarCollapsed(localStorage.getItem(CHAT_SIDEBAR_COLLAPSED_STORAGE_KEY) === '1');
      } catch {
        // ignore
      } finally {
        setChatSidebarCollapsedReady(true);
      }
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, []);

  const { isLoading } = useChat();
  const { editingIndex, addFiles, closeEditor } = useImages();

  useGlobalImageDrop(addFiles);
  const {
    handleSend,
    handleRegenerateMessage,
    handleEditMessage,
    handleCancel,
    pendingRegenerateMessageId,
  } = useRunPrompt();

  useEffect(() => {
    if (!chatSidebarCollapsedReady) return;
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
