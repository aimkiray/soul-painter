export interface ImageRef {
  file: File;
  objectUrl: string;
  naturalWidth: number;
  naturalHeight: number;
  maskCanvas: HTMLCanvasElement | null;
  compressed: boolean;
  originalSize: number;
}

export interface ImageHit {
  dataUrl?: string;
  url?: string;
}

export interface AppConfig {
  baseUrl: string;
  apiKey: string;
  serverAccessToken: string;
  mode: 'image' | 'chat';
  model: string;
  chatModel: string;
  titleModel: string;
  chatApiFormat: 'openai' | 'claude';
  openAIChatModels?: string[];
  customImageModels: string[];
  customChatModels: string[];
  claudeModel: string;
  claudeTitleModel: string;
  claudeChatModels?: string[];
  customClaudeModels: string[];
  size: string;
  n: number;
  quality: string;
  format: string;
  background: string;
  moderation: string;
  compression: number;
  systemPrompt: string;
  chatBaseUrl: string;
  chatApiKey: string;
  claudeBaseUrl: string;
  claudeApiKey: string;
}

export interface AppOptions {
  clearOnSubmit: boolean;
  contextLimit: number;
  persistPrompt: boolean;
  timeout: number;
  streaming: boolean;
}
