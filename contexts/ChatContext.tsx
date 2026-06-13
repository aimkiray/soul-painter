'use client';

import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { ImageHit } from '@/types';

export interface ChatMessage {
  role: 'user' | 'bot';
  prompt: string;
  images: ImageHit[];
  text: string;
  code: string;
  extra: string;
}

interface ChatContextValue {
  messages: ChatMessage[];
  isLoading: boolean;
  statusText: string;
  statusType: '' | 'ok' | 'err' | 'warn';
  debugRaw: string;
  debugVisible: boolean;
  addUserMsg: (prompt: string) => void;
  addBotMsg: (images: ImageHit[], code: string, extra: string) => void;
  addTextBotMsg: (text: string, code: string) => void;
  updateLastBotMsg: (images: ImageHit[], code?: string) => void;
  updateLastBotText: (text: string) => void;
  addErrorMsg: (error: string) => void;
  setLoading: (v: boolean) => void;
  setStatus: (text: string, type?: '' | 'ok' | 'err' | 'warn') => void;
  setDebugRaw: (text: string) => void;
  toggleDebug: () => void;
  showDebug: () => void;
  clearChat: () => void;
}

const ChatContext = createContext<ChatContextValue | undefined>(undefined);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [statusType, setStatusType] = useState<'' | 'ok' | 'err' | 'warn'>('');
  const [debugRaw, setDebugRaw] = useState('（尚未请求）');
  const [debugVisible, setDebugVisible] = useState(false);

  const addUserMsg = useCallback((prompt: string) => {
    setMessages((prev) => [...prev, { role: 'user', prompt, images: [], text: '', code: '', extra: '' }]);
  }, []);

  const addBotMsg = useCallback((images: ImageHit[], code: string, extra: string) => {
    setMessages((prev) => [...prev, { role: 'bot', prompt: '', images, text: '', code, extra }]);
  }, []);

  const addTextBotMsg = useCallback((text: string, code: string) => {
    setMessages((prev) => [...prev, { role: 'bot', prompt: '', images: [], text, code, extra: '' }]);
  }, []);

  const updateLastBotMsg = useCallback((images: ImageHit[], code?: string) => {
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (last.role !== 'bot') return prev;
      const updated = { ...last, images: [...images] };
      if (code !== undefined) updated.code = code;
      return [...prev.slice(0, -1), updated];
    });
  }, []);

  const updateLastBotText = useCallback((text: string) => {
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (last.role !== 'bot') return prev;
      return [...prev.slice(0, -1), { ...last, text }];
    });
  }, []);

  const addErrorMsg = useCallback((error: string) => {
    setMessages((prev) => [...prev, { role: 'bot', prompt: error, images: [], text: '', code: '', extra: 'error' }]);
  }, []);

  const setStatus = useCallback((text: string, type: '' | 'ok' | 'err' | 'warn' = '') => {
    setStatusText(text);
    setStatusType(type);
  }, []);

  const toggleDebug = useCallback(() => {
    setDebugVisible((prev) => !prev);
  }, []);

  const showDebug = useCallback(() => {
    setDebugVisible(true);
  }, []);

  const clearChat = useCallback(() => {
    setMessages([]);
    setStatusText('');
    setStatusType('');
    setDebugRaw('（尚未请求）');
    setDebugVisible(false);
  }, []);

  const value = useMemo(() => ({
    messages, isLoading, statusText, statusType, debugRaw, debugVisible,
    addUserMsg, addBotMsg, addTextBotMsg, updateLastBotMsg, updateLastBotText,
    addErrorMsg, setLoading, setStatus, setDebugRaw, toggleDebug, showDebug, clearChat,
  }), [messages, isLoading, statusText, statusType, debugRaw, debugVisible,
    addUserMsg, addBotMsg, addTextBotMsg, updateLastBotMsg, updateLastBotText,
    addErrorMsg, setLoading, setStatus, setDebugRaw, toggleDebug, showDebug, clearChat]);

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used within ChatProvider');
  return ctx;
}
