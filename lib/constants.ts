export const SIZE_PRESETS = [
  { label: '1024×1024 · 1:1', value: '1024x1024', group: '1K' },
  { label: '1024×1536 · 2:3 竖', value: '1024x1536', group: '1K' },
  { label: '1536×1024 · 3:2 横', value: '1536x1024', group: '1K' },
  { label: '2048×2048 · 1:1', value: '2048x2048', group: '2K' },
  { label: '2048×1152 · 16:9 横', value: '2048x1152', group: '2K' },
  { label: '1152×2048 · 9:16 竖', value: '1152x2048', group: '2K' },
  { label: '3840×2160 · 16:9 横', value: '3840x2160', group: '4K' },
  { label: '2160×3840 · 9:16 竖', value: '2160x3840', group: '4K' },
] as const;

export const IMAGE_MODEL_PRESETS = [
  { label: 'gpt-image-2', value: 'gpt-image-2' },
] as const;

export const CHAT_MODEL_PRESETS = [
  { label: 'gpt-5.5', value: 'gpt-5.5' },
  { label: 'gpt-5.4', value: 'gpt-5.4' },
] as const;

export const LEGACY_CHAT_MODEL_VALUES = ['gpt-4o', 'gpt-4o-mini'] as const;

export const QUALITY_OPTIONS = ['auto', 'high', 'medium', 'low'] as const;
export const FORMAT_OPTIONS = ['png', 'jpeg', 'webp'] as const;
export const BACKGROUND_OPTIONS = ['auto', 'transparent', 'opaque'] as const;
export const MODERATION_OPTIONS = ['auto', 'low'] as const;

export const DEFAULT_CONFIG = {
  baseUrl: '',
  apiKey: '',
  mode: 'image',
  model: 'gpt-image-2',
  chatModel: 'gpt-5.5',
  size: '3840x2160',
  n: 1,
  quality: 'high',
  format: 'png',
  background: 'auto',
  moderation: 'auto',
  compression: 80,
  systemPrompt: '',
  chatBaseUrl: '',
  chatApiKey: '',
} as const;

export const DEFAULT_OPTIONS = {
  clearOnSubmit: false,
  persistPrompt: true,
  timeout: 600,
  streaming: true,
} as const;

export const CFG_STORAGE_KEY = 'imggen-cfg-v1';
export const OPTS_STORAGE_KEY = 'imggen-opts-v1';
export const HISTORY_STORAGE_KEY = 'imggen-history-v1';
export const LAST_PROMPT_KEY = 'imggen-last-prompt-v1';
export const HISTORY_MAX = 20;
export const COMPRESS_THRESHOLD = 1.5 * 1024 * 1024;
export const MAX_EDGE = 2048;
