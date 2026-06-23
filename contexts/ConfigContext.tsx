'use client';

import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import { AppConfig, AppOptions } from '@/types';
import {
  CHAT_API_FORMAT_OPTIONS,
  CHAT_MODEL_PRESETS,
  CLAUDE_MODEL_PRESETS,
  DEFAULT_CONFIG,
  DEFAULT_OPTIONS,
  IMAGE_MODEL_PRESETS,
  LEGACY_CHAT_MODEL_VALUES,
  CFG_STORAGE_KEY,
  OPTS_STORAGE_KEY,
} from '@/lib/constants';
import { mergeModelOptions, normalizeModelList } from '@/lib/model-options';

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
  defaultBaseUrl: string;
  chatKeySource: 'user' | 'server' | 'inherit' | 'none';
  hasDefaultChatKey: boolean;
  claudeKeySource: 'user' | 'server' | 'none';
  hasDefaultClaudeKey: boolean;
  modelGateEnabled: boolean;
  modelGateUnlocked: boolean;
  setModelGateUnlocked: (unlocked: boolean) => void;
}

const ConfigContext = createContext<ConfigContextValue | undefined>(undefined);

function normalizeChatApiFormat(value: unknown): AppConfig['chatApiFormat'] {
  return CHAT_API_FORMAT_OPTIONS.some((option) => option.value === value)
    ? value as AppConfig['chatApiFormat']
    : DEFAULT_CONFIG.chatApiFormat;
}

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
      if (sp.get('titleModel')) urlConfig.titleModel = sp.get('titleModel')!;
      if (sp.get('titlemodel')) urlConfig.titleModel = sp.get('titlemodel')!;
      if (sp.get('chatApiFormat')) urlConfig.chatApiFormat = normalizeChatApiFormat(sp.get('chatApiFormat'));
      if (sp.get('chatformat')) urlConfig.chatApiFormat = normalizeChatApiFormat(sp.get('chatformat'));
      if (sp.get('claudeBaseUrl')) urlConfig.claudeBaseUrl = sp.get('claudeBaseUrl')!;
      if (sp.get('claudebaseurl')) urlConfig.claudeBaseUrl = sp.get('claudebaseurl')!;
      if (sp.get('claudeApiKey')) urlConfig.claudeApiKey = sp.get('claudeApiKey')!;
      if (sp.get('claudeModel')) urlConfig.claudeModel = sp.get('claudeModel')!;
      if (sp.get('claudemodel')) urlConfig.claudeModel = sp.get('claudemodel')!;
      if (sp.get('claudeTitleModel')) urlConfig.claudeTitleModel = sp.get('claudeTitleModel')!;
      if (sp.get('claudetitlemodel')) urlConfig.claudeTitleModel = sp.get('claudetitlemodel')!;
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
    customImageModels: normalizeModelList(storedConfig.customImageModels),
    customChatModels: normalizeModelList(storedConfig.customChatModels),
    chatApiFormat: normalizeChatApiFormat(urlConfig.chatApiFormat ?? storedConfig.chatApiFormat),
    claudeBaseUrl: urlConfig.claudeBaseUrl ?? storedConfig.claudeBaseUrl ?? (
      storedConfig.chatApiFormat === 'claude' ? storedConfig.chatBaseUrl || '' : DEFAULT_CONFIG.claudeBaseUrl
    ),
    claudeApiKey: urlConfig.claudeApiKey ?? storedConfig.claudeApiKey ?? (
      storedConfig.chatApiFormat === 'claude' ? storedConfig.chatApiKey || '' : DEFAULT_CONFIG.claudeApiKey
    ),
    claudeModel: urlConfig.claudeModel ?? storedConfig.claudeModel ?? (
      storedConfig.chatApiFormat === 'claude' && storedConfig.chatModel ? storedConfig.chatModel : DEFAULT_CONFIG.claudeModel
    ),
    claudeTitleModel: urlConfig.claudeTitleModel ?? storedConfig.claudeTitleModel ?? (
      storedConfig.chatApiFormat === 'claude' && storedConfig.titleModel ? storedConfig.titleModel : DEFAULT_CONFIG.claudeTitleModel
    ),
    customClaudeModels: normalizeModelList(storedConfig.customClaudeModels),
    n: urlConfig.n ?? storedConfig.n ?? (DEFAULT_CONFIG.n as number),
    compression: urlConfig.compression ?? storedConfig.compression ?? (DEFAULT_CONFIG.compression as number),
  };

  const hasExplicitChatModel = !!urlConfig.chatModel || !!storedConfig.chatModel;
  const hasExplicitClaudeModel = !!urlConfig.claudeModel || !!storedConfig.claudeModel;
  if (config.chatApiFormat === 'claude') {
    const activeClaudeModel = urlConfig.chatModel
      ? config.chatModel
      : config.claudeModel || config.chatModel;
    if (activeClaudeModel) config.chatModel = activeClaudeModel;
    if (!hasExplicitClaudeModel && config.chatModel) config.claudeModel = config.chatModel;
  }

  const imageModelOptions = mergeModelOptions(IMAGE_MODEL_PRESETS, config.customImageModels);
  const chatModelOptions = mergeModelOptions(CHAT_MODEL_PRESETS, config.customChatModels);
  const claudeModelOptions = mergeModelOptions(CLAUDE_MODEL_PRESETS, config.customClaudeModels);
  const modelIsImageOption = imageModelOptions.some((m) => m.value === config.model);
  const modelIsKnownClaudeModel = claudeModelOptions.some((m) => m.value === config.model);
  const modelIsKnownChatModel =
    chatModelOptions.some((m) => m.value === config.model) ||
    modelIsKnownClaudeModel ||
    LEGACY_CHAT_MODEL_VALUES.some((value) => value === config.model);
  if (!modelIsImageOption && config.model.trim() && config.mode === 'image' && !modelIsKnownChatModel) {
    config.customImageModels = normalizeModelList([...config.customImageModels, config.model]);
  } else if (!modelIsImageOption && (modelIsKnownChatModel || config.mode === 'chat')) {
    if (config.chatApiFormat === 'claude' || modelIsKnownClaudeModel) {
      if (!hasExplicitClaudeModel) config.claudeModel = config.model;
      if (!hasExplicitChatModel || modelIsKnownClaudeModel || config.chatApiFormat === 'claude') config.chatModel = config.model;
      config.chatApiFormat = 'claude';
    } else if (!hasExplicitChatModel) {
      config.chatModel = config.model;
      config.chatApiFormat = 'openai';
    }
    config.model = IMAGE_MODEL_PRESETS[0].value;
  }

  const options: AppOptions = {
    ...DEFAULT_OPTIONS,
    ...storedOpts,
    contextLimit: Math.max(0, Math.min(5, Number(storedOpts.contextLimit ?? DEFAULT_OPTIONS.contextLimit) || 0)),
  };

  return { config, options, hasUrlKey };
}

function createFallbackInitialConfig(): { config: AppConfig; options: AppOptions; hasUrlKey: boolean } {
  return {
    config: {
      ...DEFAULT_CONFIG,
      customImageModels: [],
      customChatModels: [],
      customClaudeModels: [],
      n: DEFAULT_CONFIG.n as number,
      compression: DEFAULT_CONFIG.compression as number,
    },
    options: {
      ...DEFAULT_OPTIONS,
      contextLimit: DEFAULT_OPTIONS.contextLimit as number,
    },
    hasUrlKey: false,
  };
}

export function ConfigProvider({ children }: { children: React.ReactNode }) {
  const [initial, setInitial] = useState(createFallbackInitialConfig);
  const [config, setConfig] = useState<AppConfig>(initial.config);
  const [options, setOptions] = useState<AppOptions>(initial.options);
  const [hasDefaultKey, setHasDefaultKey] = useState(false);
  const [defaultBaseUrl, setDefaultBaseUrl] = useState('');
  const [hasDefaultChatKey, setHasDefaultChatKey] = useState(false);
  const [hasDefaultClaudeKey, setHasDefaultClaudeKey] = useState(false);
  const [modelGateEnabled, setModelGateEnabled] = useState(false);
  const [modelGateUnlocked, setModelGateUnlocked] = useState(false);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const loaded = loadInitialConfig();
      setInitial(loaded);
      setConfig(loaded.config);
      setOptions(loaded.options);
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then((d) => {
        setHasDefaultKey(!!d.hasDefaultKey);
        setDefaultBaseUrl(typeof d.defaultBaseUrl === 'string' ? d.defaultBaseUrl : '');
        setHasDefaultChatKey(!!d.hasDefaultChatKey);
        setHasDefaultClaudeKey(!!d.hasDefaultClaudeKey);
        setModelGateEnabled(!!d.modelGateEnabled);
      })
      .catch(() => { /* ignore */ });
  }, []);

  useEffect(() => {
    fetch('/api/model-gate')
      .then((r) => r.json())
      .then((d) => {
        setModelGateUnlocked((prev) => prev || !!d.unlocked);
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
    void (async () => {
      try { localStorage.clear(); } catch { /* ignore */ }
      try { sessionStorage.clear(); } catch { /* ignore */ }

      const cacheDeletes = 'caches' in window
        ? window.caches.keys()
            .then((keys) => Promise.allSettled(keys.map((key) => window.caches.delete(key))))
        : Promise.resolve();
      const workerDeletes = 'serviceWorker' in navigator
        ? navigator.serviceWorker.getRegistrations()
            .then((registrations) => Promise.allSettled(registrations.map((registration) => registration.unregister())))
        : Promise.resolve();

      await Promise.allSettled([
        cacheDeletes,
        workerDeletes,
        fetch('/api/chat-assets', { method: 'DELETE' }),
        fetch('/api/model-gate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'clear' }),
        }),
      ]);
      window.location.reload();
    })();
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

  const claudeKeySource = useMemo<'user' | 'server' | 'none'>(() => {
    if (config.claudeApiKey) return 'user';
    if (hasDefaultClaudeKey) return 'server';
    return 'none';
  }, [config.claudeApiKey, hasDefaultClaudeKey]);

  const value = useMemo(() => ({
    config, options, updateConfig, updateOption,
    saveConfig, saveOptions, clearAll, keySource, hasDefaultKey, defaultBaseUrl, chatKeySource, hasDefaultChatKey, claudeKeySource, hasDefaultClaudeKey, modelGateEnabled, modelGateUnlocked, setModelGateUnlocked,
  }), [config, options, updateConfig, updateOption, saveConfig, saveOptions, clearAll, keySource, hasDefaultKey, defaultBaseUrl, chatKeySource, hasDefaultChatKey, claudeKeySource, hasDefaultClaudeKey, modelGateEnabled, modelGateUnlocked]);

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

  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

export function useConfig() {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error('useConfig must be used within ConfigProvider');
  return ctx;
}
