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
  model: string;
  size: string;
  n: number;
  quality: string;
  format: string;
  background: string;
  moderation: string;
  compression: number;
}

export interface AppOptions {
  clearOnSubmit: boolean;
  persistPrompt: boolean;
  timeout: number;
  streaming: boolean;
}
