'use client';

import React, { createContext, useContext, useState, useCallback, useMemo, useEffect, useSyncExternalStore } from 'react';
import { AppConfig, AppOptions } from '@/types';
import {
  CHAT_MODEL_PRESETS,
  DEFAULT_CONFIG,
  DEFAULT_OPTIONS,
  IMAGE_MODEL_PRESETS,
  LEGACY_CHAT_MODEL_VALUES,
  CFG_STORAGE_KEY,
  OPTS_STORAGE_KEY,
} from '@/lib/constants';

interface ConfigContextValue {
  config: AppConfig;
  options: AppOptions;
  updateConfig: <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => void;
  updateOption: <K extends keyof AppOptions>(key: K, value: AppOptions[K]) => void;
  saveConfig: () => void;
  saveOptions: () => void;
  clearAll: () => void;
  keySource: 'url' | 'user' | 'server' | 'none';
  hasDefaultKey: boolean;
  chatKeySource: 'user' | 'server' | 'inherit' | 'none';
  hasDefaultChatKey: boolean;
}

const ConfigContext = createContext<ConfigContextValue | undefined>(undefined);

const subscribeClientReady = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

function loadInitialConfig(): { config: AppConfig; options: AppOptions; hasUrlKey: boolean } {
  const urlConfig: Partial<AppConfig> = {};
  let hasUrlKey = false;
  if (typeof window !== 'undefined') {
    try {
      const sp = new URLSearchParams(window.location.search);
      if (sp.get('apiKey')) { urlConfig.apiKey = sp.get('apiKey')!; hasUrlKey = true; }
      if (sp.get('baseurl')) urlConfig.baseUrl = sp.get('baseurl')!;
      if (sp.get('mode') === 'image' || sp.get('mode') === 'chat') urlConfig.mode = sp.get('mode') as AppConfig['mode'];
      if (sp.get('model')) urlConfig.model = sp.get('model')!;
      if (sp.get('chatModel')) urlConfig.chatModel = sp.get('chatModel')!;
      if (sp.get('chatmodel')) urlConfig.chatModel = sp.get('chatmodel')!;
      if (sp.get('size')) urlConfig.size = sp.get('size')!;
      if (sp.get('n')) urlConfig.n = parseInt(sp.get('n')!, 10) || 1;
      if (sp.get('quality')) urlConfig.quality = sp.get('quality')!;
      if (sp.get('format')) urlConfig.format = sp.get('format')!;
      if (sp.get('background')) urlConfig.background = sp.get('background')!;
      if (sp.get('moderation')) urlConfig.moderation = sp.get('moderation')!;
      if (sp.get('compression')) urlConfig.compression = parseInt(sp.get('compression')!, 10) || 80;
    } catch { /* ignore */ }
  }

  let storedConfig: Partial<AppConfig> = {};
  try {
    storedConfig = JSON.parse(localStorage.getItem(CFG_STORAGE_KEY) || '{}');
  } catch { /* ignore */ }

  let storedOpts: Partial<AppOptions> = {};
  try {
    storedOpts = JSON.parse(localStorage.getItem(OPTS_STORAGE_KEY) || '{}');
  } catch { /* ignore */ }

  const config: AppConfig = {
    ...DEFAULT_CONFIG,
    ...storedConfig,
    ...urlConfig,
    n: urlConfig.n ?? storedConfig.n ?? (DEFAULT_CONFIG.n as number),
    compression: urlConfig.compression ?? storedConfig.compression ?? (DEFAULT_CONFIG.compression as number),
  };

  const hasExplicitChatModel = !!urlConfig.chatModel || !!storedConfig.chatModel;
  const modelIsImagePreset = IMAGE_MODEL_PRESETS.some((m) => m.value === config.model);
  const modelLooksLikeChat =
    CHAT_MODEL_PRESETS.some((m) => m.value === config.model) ||
    LEGACY_CHAT_MODEL_VALUES.some((value) => value === config.model) ||
    !modelIsImagePreset;
  if (modelLooksLikeChat) {
    if (!hasExplicitChatModel) config.chatModel = config.model;
    config.model = IMAGE_MODEL_PRESETS[0].value;
  }

  const options: AppOptions = {
    ...DEFAULT_OPTIONS,
    ...storedOpts,
    contextLimit: Math.max(0, Math.min(5, Number(storedOpts.contextLimit ?? DEFAULT_OPTIONS.contextLimit) || 0)),
    requireVersionUnlock: !!storedOpts.requireVersionUnlock,
  };

  return { config, options, hasUrlKey };
}

export function ConfigProvider({ children }: { children: React.ReactNode }) {
  const mounted = useSyncExternalStore(subscribeClientReady, getClientSnapshot, getServerSnapshot);
  const [initial] = useState(() => loadInitialConfig());
  const [config, setConfig] = useState<AppConfig>(initial.config);
  const [options, setOptions] = useState<AppOptions>(initial.options);
  const [hasDefaultKey, setHasDefaultKey] = useState(false);
  const [hasDefaultChatKey, setHasDefaultChatKey] = useState(false);

  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then((d) => {
        setHasDefaultKey(!!d.hasDefaultKey);
        setHasDefaultChatKey(!!d.hasDefaultChatKey);
      })
      .catch(() => { /* ignore */ });
  }, []);

  const updateConfig = useCallback(<K extends keyof AppConfig>(key: K, value: AppConfig[K]) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  }, []);

  const updateOption = useCallback(<K extends keyof AppOptions>(key: K, value: AppOptions[K]) => {
    setOptions((prev) => ({ ...prev, [key]: value }));
  }, []);

  const saveConfig = useCallback(() => {
    localStorage.setItem(CFG_STORAGE_KEY, JSON.stringify(config));
  }, [config]);

  const saveOptions = useCallback(() => {
    localStorage.setItem(OPTS_STORAGE_KEY, JSON.stringify(options));
  }, [options]);

  const clearAll = useCallback(() => {
    try { localStorage.clear(); } catch { /* ignore */ }
    fetch('/api/model-gate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    })
      .catch(() => undefined)
      .finally(() => window.location.reload());
  }, []);

  const keySource = useMemo<'url' | 'user' | 'server' | 'none'>(() => {
    if (initial.hasUrlKey) return 'url';
    if (config.apiKey) return 'user';
    if (hasDefaultKey) return 'server';
    return 'none';
  }, [initial.hasUrlKey, config.apiKey, hasDefaultKey]);

  const chatKeySource = useMemo<'user' | 'server' | 'inherit' | 'none'>(() => {
    if (config.chatApiKey) return 'user';
    if (hasDefaultChatKey) return 'server';
    if (config.apiKey || hasDefaultKey) return 'inherit';
    return 'none';
  }, [config.chatApiKey, config.apiKey, hasDefaultChatKey, hasDefaultKey]);

  const value = useMemo(() => ({
    config, options, updateConfig, updateOption,
    saveConfig, saveOptions, clearAll, keySource, hasDefaultKey, chatKeySource, hasDefaultChatKey,
  }), [config, options, updateConfig, updateOption, saveConfig, saveOptions, clearAll, keySource, hasDefaultKey, chatKeySource, hasDefaultChatKey]);

  // Auto-persist config & options on change (debounced)
  useEffect(() => {
    const timer = setTimeout(() => {
      localStorage.setItem(CFG_STORAGE_KEY, JSON.stringify(config));
      localStorage.setItem(OPTS_STORAGE_KEY, JSON.stringify(options));
    }, 500);
    return () => clearTimeout(timer);
  }, [config, options]);

  // Force-save on page unload (avoid losing last-second changes)
  useEffect(() => {
    const handleUnload = () => {
      localStorage.setItem(CFG_STORAGE_KEY, JSON.stringify(config));
      localStorage.setItem(OPTS_STORAGE_KEY, JSON.stringify(options));
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, [config, options]);

  useEffect(() => {
    fetch('/api/model-gate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: options.requireVersionUnlock }),
    }).catch(() => undefined);
  }, [options.requireVersionUnlock]);

  if (!mounted) return <div className="min-h-screen bg-black" />;
  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

export function useConfig() {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error('useConfig must be used within ConfigProvider');
  return ctx;
}
