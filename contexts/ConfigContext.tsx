'use client';

import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import { AppConfig, AppOptions } from '@/types';
import {
  CHAT_API_FORMAT_OPTIONS,
  DEFAULT_CONFIG,
  DEFAULT_OPTIONS,
  IMAGE_MODEL_PRESETS,
  LEGACY_CHAT_MODEL_VALUES,
  CFG_STORAGE_KEY,
  OPTS_STORAGE_KEY,
  LOCAL_DATA_CLEARED_STORAGE_KEY,
} from '@/lib/constants';
import { getClaudeChatModelOptions, getOpenAIChatModelOptions, normalizeChatEffort } from '@/lib/chat-config';
import { mergeModelOptions, normalizeModelList } from '@/lib/model-options';
import { isLocalDataCleared, markLocalDataCleared, clearLocalDataClearedMarker } from '@/lib/local-data-cleared';
import { clear } from 'idb-keyval';

interface PublicServerConfig {
  defaultBaseUrl: string;
  hasDefaultKey: boolean;
  hasDefaultChatKey: boolean;
  hasDefaultClaudeKey: boolean;
  serverAccessRequired: boolean;
  serverAccessConfigured: boolean;
  modelGateEnabled: boolean;
  openAIChatModels: string[];
  defaultOpenAIChatModel: string;
  defaultOpenAITitleModel: string;
  claudeChatModels: string[];
  defaultClaudeChatModel: string;
  defaultClaudeTitleModel: string;
}

interface InitialConfigResult {
  config: AppConfig;
  options: AppOptions;
  hasUrlKey: boolean;
}

interface ChatModelDefaults {
  openAIChatModel: string;
  openAITitleModel: string;
  claudeChatModel: string;
  claudeTitleModel: string;
}

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
  serverAccessRequired: boolean;
  serverAccessConfigured: boolean;
  modelGateEnabled: boolean;
  modelGateUnlocked: boolean;
  setModelGateUnlocked: (unlocked: boolean) => void;
  modelDefaults: ChatModelDefaults;
}

const ConfigContext = createContext<ConfigContextValue | undefined>(undefined);

const FALLBACK_MODEL_DEFAULTS: ChatModelDefaults = {
  openAIChatModel: DEFAULT_CONFIG.chatModel,
  openAITitleModel: DEFAULT_CONFIG.titleModel,
  claudeChatModel: DEFAULT_CONFIG.claudeModel,
  claudeTitleModel: DEFAULT_CONFIG.claudeTitleModel,
};

const FALLBACK_SERVER_CONFIG: PublicServerConfig = {
  defaultBaseUrl: '',
  hasDefaultKey: false,
  hasDefaultChatKey: false,
  hasDefaultClaudeKey: false,
  serverAccessRequired: false,
  serverAccessConfigured: false,
  modelGateEnabled: false,
  openAIChatModels: [...DEFAULT_CONFIG.openAIChatModels],
  defaultOpenAIChatModel: FALLBACK_MODEL_DEFAULTS.openAIChatModel,
  defaultOpenAITitleModel: FALLBACK_MODEL_DEFAULTS.openAITitleModel,
  claudeChatModels: [...DEFAULT_CONFIG.claudeChatModels],
  defaultClaudeChatModel: FALLBACK_MODEL_DEFAULTS.claudeChatModel,
  defaultClaudeTitleModel: FALLBACK_MODEL_DEFAULTS.claudeTitleModel,
};

function normalizedString(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normalizeServerConfig(value: unknown): PublicServerConfig {
  if (!value || typeof value !== 'object') return FALLBACK_SERVER_CONFIG;
  const raw = value as Record<string, unknown>;
  const configuredOpenAIModels = normalizeModelList(raw.openAIChatModels);
  const configuredClaudeModels = normalizeModelList(raw.claudeChatModels);
  const defaultOpenAIChatModel = normalizedString(raw.defaultOpenAIChatModel, FALLBACK_SERVER_CONFIG.defaultOpenAIChatModel);
  const defaultOpenAITitleModel = normalizedString(raw.defaultOpenAITitleModel, FALLBACK_SERVER_CONFIG.defaultOpenAITitleModel);
  const defaultClaudeChatModel = normalizedString(raw.defaultClaudeChatModel, FALLBACK_SERVER_CONFIG.defaultClaudeChatModel);
  const defaultClaudeTitleModel = normalizedString(raw.defaultClaudeTitleModel, FALLBACK_SERVER_CONFIG.defaultClaudeTitleModel);

  return {
    defaultBaseUrl: typeof raw.defaultBaseUrl === 'string' ? raw.defaultBaseUrl : '',
    hasDefaultKey: !!raw.hasDefaultKey,
    hasDefaultChatKey: !!raw.hasDefaultChatKey,
    hasDefaultClaudeKey: !!raw.hasDefaultClaudeKey,
    serverAccessRequired: !!raw.serverAccessRequired,
    serverAccessConfigured: !!raw.serverAccessConfigured,
    modelGateEnabled: !!raw.modelGateEnabled,
    openAIChatModels: normalizeModelList([
      ...(configuredOpenAIModels.length > 0 ? configuredOpenAIModels : FALLBACK_SERVER_CONFIG.openAIChatModels),
      defaultOpenAIChatModel,
      defaultOpenAITitleModel,
    ]),
    defaultOpenAIChatModel,
    defaultOpenAITitleModel,
    claudeChatModels: normalizeModelList([
      ...(configuredClaudeModels.length > 0 ? configuredClaudeModels : FALLBACK_SERVER_CONFIG.claudeChatModels),
      defaultClaudeChatModel,
      defaultClaudeTitleModel,
    ]),
    defaultClaudeChatModel,
    defaultClaudeTitleModel,
  };
}

async function fetchServerConfig(): Promise<PublicServerConfig> {
  try {
    const response = await fetch('/api/config', { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return FALLBACK_SERVER_CONFIG;
    return normalizeServerConfig(await response.json());
  } catch {
    return FALLBACK_SERVER_CONFIG;
  }
}

function normalizeChatApiFormat(value: unknown): AppConfig['chatApiFormat'] {
  return CHAT_API_FORMAT_OPTIONS.some((option) => option.value === value)
    ? value as AppConfig['chatApiFormat']
    : DEFAULT_CONFIG.chatApiFormat;
}

function loadInitialConfig(serverConfig: PublicServerConfig): InitialConfigResult {
  const urlConfig: Partial<AppConfig> = {};
  let hasUrlKey = false;
  if (typeof window !== 'undefined') {
    try {
      const sp = new URLSearchParams(window.location.search);
      // Credential params strip from history regardless of their value —
      // even an empty ?apiKey= shouldn't linger in a shared-tab URL.
      const sawCredentialParam = Array.from(sp.keys()).some((rawKey) => {
        const key = rawKey.toLowerCase();
        return key === 'apikey' || key === 'claudeapikey';
      });
      // One case-insensitive pass — camelCase and lowercase aliases share a
      // handler, and empty/invalid values never override stored config.
      for (const [rawKey, value] of sp.entries()) {
        if (!value) continue;
        switch (rawKey.toLowerCase()) {
          case 'apikey':
            urlConfig.apiKey = value;
            hasUrlKey = true;
            break;
          case 'claudeapikey':
            urlConfig.claudeApiKey = value;
            break;
          case 'baseurl': urlConfig.baseUrl = value; break;
          case 'mode':
            if (value === 'image' || value === 'chat') urlConfig.mode = value;
            break;
          case 'model': urlConfig.model = value; break;
          case 'chatmodel': urlConfig.chatModel = value; break;
          case 'titlemodel': urlConfig.titleModel = value; break;
          // Enum params apply only when VALID — ?chatApiFormat=junk must not
          // stomp a stored valid value.
          case 'chatapiformat':
          case 'chatformat':
            if (CHAT_API_FORMAT_OPTIONS.some((option) => option.value === value)) {
              urlConfig.chatApiFormat = value as AppConfig['chatApiFormat'];
            }
            break;
          case 'chateffort': {
            const effort = normalizeChatEffort(value);
            if (effort) urlConfig.chatEffort = effort;
            break;
          }
          case 'claudebaseurl': urlConfig.claudeBaseUrl = value; break;
          case 'claudemodel': urlConfig.claudeModel = value; break;
          case 'claudetitlemodel': urlConfig.claudeTitleModel = value; break;
          case 'size': urlConfig.size = value; break;
          case 'n': {
            const n = parseInt(value, 10);
            if (Number.isFinite(n)) urlConfig.n = Math.min(20, Math.max(1, n));
            break;
          }
          case 'quality': urlConfig.quality = value; break;
          case 'format': urlConfig.format = value; break;
          case 'background': urlConfig.background = value; break;
          case 'moderation': urlConfig.moderation = value; break;
          case 'compression': {
            const compression = parseInt(value, 10);
            if (Number.isFinite(compression)) urlConfig.compression = Math.min(100, Math.max(0, compression));
            break;
          }
        }
      }
      // Credentials captured from the URL must not linger in history —
      // every Back/Forward and shared-tab URL would keep re-granting them.
      if (sawCredentialParam) {
        for (const rawKey of Array.from(sp.keys())) {
          const key = rawKey.toLowerCase();
          if (key === 'apikey' || key === 'claudeapikey') sp.delete(rawKey);
        }
        const query = sp.toString();
        window.history.replaceState(
          null,
          '',
          `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`,
        );
      }
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

  const runtimeDefaults = {
    ...DEFAULT_CONFIG,
    chatModel: serverConfig.defaultOpenAIChatModel,
    titleModel: serverConfig.defaultOpenAITitleModel,
    openAIChatModels: serverConfig.openAIChatModels,
    claudeModel: serverConfig.defaultClaudeChatModel,
    claudeTitleModel: serverConfig.defaultClaudeTitleModel,
    claudeChatModels: serverConfig.claudeChatModels,
  };

  const config: AppConfig = {
    ...runtimeDefaults,
    ...storedConfig,
    ...urlConfig,
    openAIChatModels: [...serverConfig.openAIChatModels],
    claudeChatModels: [...serverConfig.claudeChatModels],
    customImageModels: normalizeModelList(storedConfig.customImageModels),
    customChatModels: normalizeModelList(storedConfig.customChatModels),
    chatApiFormat: normalizeChatApiFormat(urlConfig.chatApiFormat ?? storedConfig.chatApiFormat),
    chatEffort: normalizeChatEffort(urlConfig.chatEffort ?? storedConfig.chatEffort) ?? runtimeDefaults.chatEffort,
    claudeBaseUrl: urlConfig.claudeBaseUrl ?? storedConfig.claudeBaseUrl ?? (
      storedConfig.chatApiFormat === 'claude' ? storedConfig.chatBaseUrl || '' : runtimeDefaults.claudeBaseUrl
    ),
    claudeApiKey: urlConfig.claudeApiKey ?? storedConfig.claudeApiKey ?? (
      storedConfig.chatApiFormat === 'claude' ? storedConfig.chatApiKey || '' : runtimeDefaults.claudeApiKey
    ),
    claudeModel: urlConfig.claudeModel ?? storedConfig.claudeModel ?? (
      storedConfig.chatApiFormat === 'claude' && storedConfig.chatModel ? storedConfig.chatModel : runtimeDefaults.claudeModel
    ),
    claudeTitleModel: urlConfig.claudeTitleModel ?? storedConfig.claudeTitleModel ?? (
      storedConfig.chatApiFormat === 'claude' && storedConfig.titleModel ? storedConfig.titleModel : runtimeDefaults.claudeTitleModel
    ),
    customClaudeModels: normalizeModelList(storedConfig.customClaudeModels),
    // Normalize stored numerics the same way URL params are — a hand-edited
    // or schema-drifted localStorage blob must not carry e.g. n=999 through.
    n: urlConfig.n ?? (Number.isFinite(storedConfig.n)
      ? Math.min(20, Math.max(1, Math.floor(storedConfig.n as number)))
      : (DEFAULT_CONFIG.n as number)),
    compression: urlConfig.compression ?? (Number.isFinite(storedConfig.compression)
      ? Math.min(100, Math.max(0, Math.floor(storedConfig.compression as number)))
      : (DEFAULT_CONFIG.compression as number)),
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
  const chatModelOptions = getOpenAIChatModelOptions(config);
  const claudeModelOptions = getClaudeChatModelOptions(config);
  const modelIsImageOption = imageModelOptions.some((m) => m.value === config.model);
  const modelIsKnownClaudeModel = claudeModelOptions.some((m) => m.value === config.model);
  const modelIsKnownChatModel =
    chatModelOptions.some((m) => m.value === config.model) ||
    modelIsKnownClaudeModel ||
    LEGACY_CHAT_MODEL_VALUES.some((value) => value === config.model);
  if (!modelIsImageOption && config.model.trim() && config.mode === 'image' && !modelIsKnownChatModel) {
    // Unknown STORED models are preserved into the custom list; a URL-provided
    // one stays active for the session only — a typo'd ?model= must not
    // permanently pollute the user's custom list.
    if (!urlConfig.model) {
      config.customImageModels = normalizeModelList([...config.customImageModels, config.model]);
    }
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
    // Same clamp the runner applies — a drifted stored timeout must not
    // survive as e.g. 0 (instant abort) or a multi-hour hang.
    timeout: Math.min(3600, Math.max(1,
      Math.floor(Number(storedOpts.timeout ?? DEFAULT_OPTIONS.timeout) || DEFAULT_OPTIONS.timeout as number),
    )),
  };

  return { config, options, hasUrlKey };
}

function createFallbackInitialConfig(): InitialConfigResult {
  return {
    config: {
      ...DEFAULT_CONFIG,
      openAIChatModels: [...DEFAULT_CONFIG.openAIChatModels],
      claudeChatModels: [...DEFAULT_CONFIG.claudeChatModels],
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
  const [serverAccessRequired, setServerAccessRequired] = useState(false);
  const [serverAccessConfigured, setServerAccessConfigured] = useState(false);
  const [modelGateEnabled, setModelGateEnabled] = useState(false);
  const [modelGateUnlocked, setModelGateUnlocked] = useState(false);
  const [modelDefaults, setModelDefaults] = useState(FALLBACK_MODEL_DEFAULTS);
  const [ready, setReady] = useState(false);
  const [modelGateReady, setModelGateReady] = useState(false);

  const serverConfigRef = React.useRef<PublicServerConfig | null>(null);

  useEffect(() => {
    let cancelled = false;
    try { sessionStorage.removeItem('sp-cleared'); } catch { /* ignore */ }
    void fetchServerConfig()
      .then((serverConfig) => {
        if (cancelled) return;
        serverConfigRef.current = serverConfig;
        setHasDefaultKey(serverConfig.hasDefaultKey);
        setDefaultBaseUrl(serverConfig.defaultBaseUrl);
        setHasDefaultChatKey(serverConfig.hasDefaultChatKey);
        setHasDefaultClaudeKey(serverConfig.hasDefaultClaudeKey);
        setServerAccessRequired(serverConfig.serverAccessRequired);
        setServerAccessConfigured(serverConfig.serverAccessConfigured);
        setModelGateEnabled(serverConfig.modelGateEnabled);
        setModelDefaults({
          openAIChatModel: serverConfig.defaultOpenAIChatModel,
          openAITitleModel: serverConfig.defaultOpenAITitleModel,
          claudeChatModel: serverConfig.defaultClaudeChatModel,
          claudeTitleModel: serverConfig.defaultClaudeTitleModel,
        });

        const loaded = loadInitialConfig(serverConfig);
        setInitial(loaded);
        setConfig(loaded.config);
        setOptions(loaded.options);
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Cross-tab convergence: config/options are saved whole-key, so two tabs
  // otherwise diverge — the last save wins silently and the losing tab keeps
  // writing its stale snapshot on every later close. Adopt another tab's
  // save while THIS tab is hidden (nobody is editing a hidden tab); the
  // visible tab keeps its in-flight edits and becomes the next writer.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== CFG_STORAGE_KEY && event.key !== OPTS_STORAGE_KEY) return;
      if (document.visibilityState === 'visible') return;
      if (isLocalDataCleared()) return;
      const serverConfig = serverConfigRef.current;
      if (!serverConfig) return;
      const loaded = loadInitialConfig(serverConfig);
      setConfig(loaded.config);
      setOptions(loaded.options);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    fetch('/api/model-gate', { signal: AbortSignal.timeout(8000) })
      .then((r) => r.json())
      .then((d) => {
        setModelGateUnlocked((prev) => prev || !!d.unlocked);
      })
      .catch(() => { /* ignore */ })
      .finally(() => setModelGateReady(true));
  }, []);

  const updateConfig = useCallback(<K extends keyof AppConfig>(key: K, value: AppConfig[K]) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  }, []);

  const updateOption = useCallback(<K extends keyof AppOptions>(key: K, value: AppOptions[K]) => {
    setOptions((prev) => ({ ...prev, [key]: value }));
  }, []);

  const saveConfig = useCallback(() => {
    // A manual save is an explicit user action — it re-consents to local
    // persistence after a wipe, so lift the cleared marker before writing.
    clearLocalDataClearedMarker();
    if (isLocalDataCleared()) return;
    localStorage.setItem(CFG_STORAGE_KEY, JSON.stringify(config));
  }, [config]);

  const saveOptions = useCallback(() => {
    clearLocalDataClearedMarker();
    if (isLocalDataCleared()) return;
    localStorage.setItem(OPTS_STORAGE_KEY, JSON.stringify(options));
  }, [options]);

  const clearAll = useCallback(() => {
    markLocalDataCleared();
    // Hard upper bound: no cleanup step below may delay the reload past this.
    const reloadTimer = window.setTimeout(() => { window.location.reload(); }, 10_000);
    void (async () => {
      try {
        try { await clear(); } catch { /* ignore */ }
        try { localStorage.clear(); } catch { /* ignore */ }
        // Persistent cleared marker — written after the wipe so it survives:
        // it keeps this tab (post-reload) and every other tab in the cleared
        // state until the user explicitly re-auths or saves config.
        try { localStorage.setItem(LOCAL_DATA_CLEARED_STORAGE_KEY, String(Date.now())); } catch { /* ignore */ }
        try { sessionStorage.clear(); } catch { /* ignore */ }

        const cacheDeletes = 'caches' in window
          ? window.caches.keys()
              .then((keys) => Promise.allSettled(keys.map((key) => window.caches.delete(key))))
          : Promise.resolve();
        const workerDeletes = 'serviceWorker' in navigator
          ? navigator.serviceWorker.getRegistrations()
              .then((registrations) => Promise.allSettled(registrations.map((registration) => registration.unregister())))
          : Promise.resolve();

        // Cleanup fetches get their own timeout and the whole batch is
        // capped — a stalled socket must not leave the app in cleared limbo.
        await Promise.race([
          Promise.allSettled([
            cacheDeletes,
            workerDeletes,
            fetch('/api/chat-assets', { method: 'DELETE', signal: AbortSignal.timeout(5000) }),
            fetch('/api/model-gate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'clear' }),
              signal: AbortSignal.timeout(5000),
            }),
          ]),
          new Promise((resolve) => { window.setTimeout(resolve, 8000); }),
        ]);
      } finally {
        window.clearTimeout(reloadTimer);
        window.location.reload();
      }
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
    saveConfig, saveOptions, clearAll, keySource, hasDefaultKey, defaultBaseUrl, chatKeySource, hasDefaultChatKey, claudeKeySource, hasDefaultClaudeKey, serverAccessRequired, serverAccessConfigured, modelGateEnabled, modelGateUnlocked, setModelGateUnlocked, modelDefaults,
  }), [config, options, updateConfig, updateOption, saveConfig, saveOptions, clearAll, keySource, hasDefaultKey, defaultBaseUrl, chatKeySource, hasDefaultChatKey, claudeKeySource, hasDefaultClaudeKey, serverAccessRequired, serverAccessConfigured, modelGateEnabled, modelGateUnlocked, modelDefaults]);

  // Auto-persist config & options on change (debounced)
  useEffect(() => {
    if (!ready || isLocalDataCleared()) return;
    const timer = setTimeout(() => {
      if (isLocalDataCleared()) return;
      localStorage.setItem(CFG_STORAGE_KEY, JSON.stringify(config));
      localStorage.setItem(OPTS_STORAGE_KEY, JSON.stringify(options));
    }, 500);
    return () => clearTimeout(timer);
  }, [config, options, ready]);

  // Force-save on page unload (avoid losing last-second changes)
  useEffect(() => {
    if (!ready) return;
    const handleUnload = () => {
      if (isLocalDataCleared()) return;
      localStorage.setItem(CFG_STORAGE_KEY, JSON.stringify(config));
      localStorage.setItem(OPTS_STORAGE_KEY, JSON.stringify(options));
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, [config, options, ready]);

  const hydrationReady = ready && modelGateReady;
  return <ConfigContext.Provider value={value}>{hydrationReady ? children : null}</ConfigContext.Provider>;
}

export function useConfig() {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error('useConfig must be used within ConfigProvider');
  return ctx;
}
