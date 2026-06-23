'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ConfigProvider, useConfig } from '@/contexts/ConfigContext';
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
import { extractImage } from '@/lib/image-extract';
import { proxyRequest, proxyRequestStream, USER_ABORT_SENTINEL } from '@/lib/api';
import { AppConfig, AppOptions, ImageHit, ImageRef } from '@/types';
import type { ChatMessage, ChatReferenceImage, ChatTurnSnapshot } from '@/contexts/ChatContext';
import {
  HISTORY_STORAGE_KEY,
  HISTORY_MAX,
  CHAT_SIDEBAR_COLLAPSED_STORAGE_KEY,
  CHAT_SYNC_AUTH_STORAGE_KEY,
  chatSessionPromptStorageKey,
} from '@/lib/constants';
import { imageHitToStoredUrl, uploadChatImage } from '@/lib/chat-asset-client';
import { blobToEditBlob } from '@/lib/image-edit';
import { parseSize, resolveRequestSize } from '@/lib/size';
import { ChatApiFormat, getActiveChatModel, getChatProviderConfig } from '@/lib/chat-config';

// ── Pure helpers used by handleSend ──

function parseErrorDetail(probeText: string): string {
  try {
    const j = JSON.parse(probeText);
    return j?.error?.message || j?.message || JSON.stringify(j).slice(0, 300);
  } catch {
    return (probeText || '').slice(0, 300);
  }
}

function parseResponseBody(probeText: string): unknown {
  try { return JSON.parse(probeText); } catch { return probeText; }
}

function parseStreamResponseBody(probeText: string): unknown {
  const cleaned = probeText
    .split('\n')
    .filter((line) => !line.startsWith(':'))
    .join('\n')
    .trim();
  return parseResponseBody(cleaned || probeText);
}

function extractModelGateMessage(errorText: string): string | null {
  const match = /^HTTP 418:?\s*(.+)$/i.exec((errorText || '').trim());
  return match?.[1]?.trim() || null;
}

function buildRepeaterReply(prompt: string): string {
  return prompt || '...';
}

type RequestBody = Record<string, unknown> | FormData;

type RunMode = ChatTurnSnapshot['mode'];
interface PromptRunOptions {
  existingUserMessageId?: string;
  targetBotMessageId?: string;
  historyMessages?: ChatMessage[];
  requestSnapshot?: ChatTurnSnapshot;
}

function setRequestParam(target: RequestBody, key: string, value: unknown) {
  if (target instanceof FormData) {
    target.set(key, String(value));
    return;
  }
  target[key] = value;
}

function deleteRequestParam(target: RequestBody, key: string) {
  if (target instanceof FormData) {
    target.delete(key);
    return;
  }
  delete target[key];
}

function getFormImageCount(form: FormData) {
  return form.getAll('image[]').filter((value) => value instanceof Blob).length;
}

function blobToDataUrl(blob: Blob, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error(USER_ABORT_SENTINEL));
      return;
    }

    const reader = new FileReader();
    const handleAbort = () => {
      reader.abort();
      reject(new Error(USER_ABORT_SENTINEL));
    };

    signal?.addEventListener('abort', handleAbort, { once: true });
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read image'));
    reader.onabort = () => reject(new Error(USER_ABORT_SENTINEL));
    reader.onloadend = () => signal?.removeEventListener('abort', handleAbort);
    reader.readAsDataURL(blob);
  });
}

async function canvasToImageHit(canvas: HTMLCanvasElement | null, signal?: AbortSignal): Promise<ImageHit | undefined> {
  if (!canvas) return undefined;
  if (signal?.aborted) throw new Error(USER_ABORT_SENTINEL);
  const dataUrl = canvas.toDataURL('image/png');
  if (signal?.aborted) throw new Error(USER_ABORT_SENTINEL);
  const url = await uploadChatImage(dataUrl, signal);
  return url ? { url } : { dataUrl };
}

async function imageRefToStoredHit(image: ImageRef, signal?: AbortSignal): Promise<ImageHit | null> {
  try {
    if (signal?.aborted) throw new Error(USER_ABORT_SENTINEL);
    const dataUrl = await blobToDataUrl(image.file, signal);
    if (signal?.aborted) throw new Error(USER_ABORT_SENTINEL);
    const url = await uploadChatImage(dataUrl, signal);
    return url ? { url } : { dataUrl };
  } catch (error) {
    if ((error as Error).message === USER_ABORT_SENTINEL || signal?.aborted) throw error;
    return null;
  }
}

async function imageRefToReferenceImage(image: ImageRef, signal?: AbortSignal): Promise<ChatReferenceImage | null> {
  const storedImage = await imageRefToStoredHit(image, signal);
  if (!storedImage) return null;
  const mask = await canvasToImageHit(image.maskCanvas, signal);
  return mask ? { image: storedImage, mask } : { image: storedImage };
}

async function imageHitToBlob(image: ImageHit, signal?: AbortSignal): Promise<Blob | null> {
  const source = image.dataUrl || image.url;
  if (!source) return null;
  try {
    if (signal?.aborted) throw new Error(USER_ABORT_SENTINEL);
    const response = await fetch(source, { signal });
    if (!response.ok) return null;
    if (signal?.aborted) throw new Error(USER_ABORT_SENTINEL);
    return blobToEditBlob(await response.blob(), source, signal);
  } catch (error) {
    if ((error as Error).message === USER_ABORT_SENTINEL || signal?.aborted) throw error;
    return null;
  }
}

function blobExt(blob: Blob) {
  if (blob.type === 'image/jpeg') return 'jpg';
  if (blob.type === 'image/webp') return 'webp';
  if (blob.type === 'image/gif') return 'gif';
  return 'png';
}

const IMAGE_STREAM_CAPABILITY_STORAGE_KEY = 'imggen-image-stream-capability-v1';
const IMAGE_STREAM_FIRST_EVENT_TIMEOUT_MS = 60_000;
const IMAGE_STREAM_COMPLETE_TIMEOUT_MS = 90_000;
const IMAGE_STREAM_UNSUPPORTED_TTL_MS = 24 * 60 * 60 * 1000;
const IMAGE_STREAM_SUPPORTED_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type ImageStreamCapability = 'supported' | 'unsupported';

interface ImageStreamCapabilityRecord {
  state: ImageStreamCapability;
  updatedAt: number;
  expiresAt: number;
}

function getImageStreamCapabilityKey(endpoint: string, config: AppConfig, model: string, defaultBaseUrl: string) {
  const baseUrl = (config.baseUrl || defaultBaseUrl).trim().replace(/\/+$/, '') || 'server-default';
  return `${endpoint}|${baseUrl}|${model || 'default'}`;
}

function readImageStreamCapabilities(): Record<string, ImageStreamCapabilityRecord> {
  if (typeof window === 'undefined') return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(IMAGE_STREAM_CAPABILITY_STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed as Record<string, ImageStreamCapabilityRecord> : {};
  } catch {
    return {};
  }
}

function writeImageStreamCapabilities(records: Record<string, ImageStreamCapabilityRecord>) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(IMAGE_STREAM_CAPABILITY_STORAGE_KEY, JSON.stringify(records));
  } catch {
    // Capability caching is opportunistic.
  }
}

function getImageStreamCapability(key: string): ImageStreamCapability | 'unknown' {
  const records = readImageStreamCapabilities();
  const record = records[key];
  if (!record || (record.state !== 'supported' && record.state !== 'unsupported')) return 'unknown';
  if (record.expiresAt <= Date.now()) {
    delete records[key];
    writeImageStreamCapabilities(records);
    return 'unknown';
  }
  return record.state;
}

function setImageStreamCapability(key: string, state: ImageStreamCapability) {
  const now = Date.now();
  const ttl = state === 'unsupported' ? IMAGE_STREAM_UNSUPPORTED_TTL_MS : IMAGE_STREAM_SUPPORTED_TTL_MS;
  const records = readImageStreamCapabilities();
  records[key] = { state, updatedAt: now, expiresAt: now + ttl };
  writeImageStreamCapabilities(records);
}

function createImageStreamAttempt(parentSignal: AbortSignal) {
  const controller = new AbortController();
  let timedOut = false;
  let imageEventSeen = false;
  let completeSeen = false;
  let completeTimeoutId: number | null = null;

  const abortFromParent = () => controller.abort();
  if (parentSignal.aborted) {
    controller.abort();
  } else {
    parentSignal.addEventListener('abort', abortFromParent, { once: true });
  }

  const timeoutId = window.setTimeout(() => {
    if (imageEventSeen || parentSignal.aborted) return;
    timedOut = true;
    controller.abort();
  }, IMAGE_STREAM_FIRST_EVENT_TIMEOUT_MS);

  const scheduleCompleteTimeout = () => {
    if (completeTimeoutId) window.clearTimeout(completeTimeoutId);
    completeTimeoutId = window.setTimeout(() => {
      if (completeSeen || parentSignal.aborted) return;
      timedOut = true;
      controller.abort();
    }, IMAGE_STREAM_COMPLETE_TIMEOUT_MS);
  };

  return {
    signal: controller.signal,
    markPartial() {
      imageEventSeen = true;
      window.clearTimeout(timeoutId);
      scheduleCompleteTimeout();
    },
    markComplete() {
      imageEventSeen = true;
      completeSeen = true;
      window.clearTimeout(timeoutId);
      if (completeTimeoutId) window.clearTimeout(completeTimeoutId);
    },
    didTimeout() {
      return timedOut;
    },
    cleanup() {
      window.clearTimeout(timeoutId);
      if (completeTimeoutId) window.clearTimeout(completeTimeoutId);
      parentSignal.removeEventListener('abort', abortFromParent);
    },
  };
}

async function buildEditsFormFromReferences(
  references: ChatReferenceImage[],
  prompt: string,
  size: string | null,
  model: string,
  signal?: AbortSignal,
): Promise<FormData> {
  const form = new FormData();
  form.append('model', model);
  form.append('prompt', prompt);
  if (size) form.append('size', size);

  if (signal?.aborted) throw new Error(USER_ABORT_SENTINEL);
  const imageBlobs = await Promise.all(references.map((reference) => imageHitToBlob(reference.image, signal)));
  if (signal?.aborted) throw new Error(USER_ABORT_SENTINEL);
  imageBlobs.forEach((blob, i) => {
    if (!blob) return;
    form.append('image[]', blob, `image-${i + 1}.${blobExt(blob)}`);
  });

  const maskBlob = await imageHitToBlob(references[0]?.mask || {}, signal);
  if (maskBlob) form.append('mask', maskBlob, `mask.${blobExt(maskBlob)}`);
  return form;
}

function createTurnSnapshot(
  config: AppConfig,
  options: AppOptions,
  mode: RunMode,
  resolvedSize: string,
  referenceImages: ChatReferenceImage[],
): ChatTurnSnapshot {
  const chatProvider = getChatProviderConfig(config, getActiveChatModel(config));
  return {
    mode,
    model: config.model,
    chatModel: chatProvider.model,
    chatApiFormat: chatProvider.format,
    size: resolvedSize,
    n: config.n,
    quality: config.quality,
    format: config.format,
    background: config.background,
    moderation: config.moderation,
    compression: config.compression,
    systemPrompt: config.systemPrompt,
    streaming: options.streaming,
    contextLimit: options.contextLimit,
    referenceImages,
  };
}

async function processChatStream(
  stream: ReadableStream<Uint8Array>,
  onDelta: (text: string) => void,
  format: ChatApiFormat = 'openai',
  signal?: AbortSignal,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

  const cancelReader = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener('abort', cancelReader, { once: true });

  const processBlock = (block: string): boolean => {
    let eventType = 'message';
    const dataLines: string[] = [];

    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim());
      }
    }

    const data = dataLines.join('\n');
    if (data === '[DONE]' || eventType === 'message_stop') return true;
    if (!data) return false;

    try {
      const evt = JSON.parse(data);
      const eventError = getStreamEventError(evt, eventType);
      if (eventError) throw new Error(eventError);

      const delta = format === 'claude'
        ? extractClaudeStreamDelta(evt)
        : extractOpenAIStreamDelta(evt);
      if (delta) {
        fullText += delta;
        onDelta(fullText);
      }
    } catch (e) {
      if (e instanceof SyntaxError) return false;
      if (e instanceof Error && e.message) throw e;
    }

    return false;
  };

  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel().catch(() => {});
        throw new Error(USER_ABORT_SENTINEL);
      }
      const { done, value } = await reader.read();
      if (signal?.aborted) throw new Error(USER_ABORT_SENTINEL);
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() || '';

      for (const block of blocks) {
        if (processBlock(block)) return fullText;
      }
    }

    const tail = decoder.decode();
    if (tail) buffer += tail;
    if (buffer.trim() && processBlock(buffer)) return fullText;
  } finally {
    signal?.removeEventListener('abort', cancelReader);
  }
  return fullText;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function stringifyTextContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return value == null ? '' : String(value);

  return value
    .map((part) => {
      if (typeof part === 'string') return part;
      if (isRecord(part) && typeof part.text === 'string') return part.text;
      return '';
    })
    .join('');
}

function getStreamEventError(evt: unknown, eventType: string): string | null {
  if (!isRecord(evt)) return eventType === 'error' ? '流式响应返回错误事件' : null;
  if (!evt.error && eventType !== 'error') return null;

  if (typeof evt.message === 'string' && evt.message.trim()) return evt.message;
  if (typeof evt.error === 'string' && evt.error.trim()) return evt.error;
  if (isRecord(evt.error)) {
    const message = typeof evt.error.message === 'string' ? evt.error.message : '';
    const type = typeof evt.error.type === 'string' ? evt.error.type : '';
    return message || type || '流式响应返回错误事件';
  }
  if (typeof evt.status === 'number') return `HTTP ${evt.status}`;
  return '流式响应返回错误事件';
}

function extractOpenAIStreamDelta(evt: unknown): string {
  if (!isRecord(evt) || !Array.isArray(evt.choices)) return '';
  const choice = evt.choices[0];
  if (!isRecord(choice) || !isRecord(choice.delta)) return '';
  return stringifyTextContent(choice.delta.content);
}

function extractClaudeStreamDelta(evt: unknown): string {
  if (!isRecord(evt) || evt.type !== 'content_block_delta' || !isRecord(evt.delta)) return '';
  if (evt.delta.type !== 'text_delta') return '';
  return typeof evt.delta.text === 'string' ? evt.delta.text : '';
}

function extractChatResponseText(response: unknown, format: ChatApiFormat): string {
  if (!isRecord(response)) return '';

  if (format === 'claude') {
    if (typeof response.content === 'string') return response.content;
    if (!Array.isArray(response.content)) return '';
    return response.content
      .map((block) => {
        if (typeof block === 'string') return block;
        if (isRecord(block) && (block.type === 'text' || typeof block.text === 'string')) {
          return typeof block.text === 'string' ? block.text : '';
        }
        return '';
      })
      .join('');
  }

  if (!Array.isArray(response.choices)) return '';
  const choice = response.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message)) return '';
  return stringifyTextContent(choice.message.content);
}

const CHAT_HISTORY_BUDGET = 32 * 1024;

function buildChatMessages(
  history: ChatMessage[],
  prompt: string,
  systemPrompt: string,
  contextLimit: number,
): Array<{ role: string; content: string }> {
  const sys: Array<{ role: string; content: string }> = [];
  if (systemPrompt && systemPrompt.trim()) {
    sys.push({ role: 'system', content: systemPrompt.trim() });
  }

  const rounds: Array<Array<{ role: string; content: string }>> = [];
  for (const msg of history) {
    if (msg.extra === 'error') continue;
    if (msg.role === 'user') {
      if (msg.prompt) rounds.push([{ role: 'user', content: msg.prompt }]);
    } else if (msg.text) {
      const currentRound = rounds[rounds.length - 1];
      if (currentRound) currentRound.push({ role: 'assistant', content: msg.text });
    }
  }
  const clampedContextLimit = Math.max(0, Math.min(5, contextLimit));
  const keptTurns = clampedContextLimit === 0
    ? []
    : rounds.slice(-clampedContextLimit).flat();
  const turns = keptTurns.slice();
  turns.push({ role: 'user', content: prompt });

  let combined = [...sys, ...turns];
  while (turns.length > 1 && JSON.stringify(combined).length > CHAT_HISTORY_BUDGET) {
    turns.shift();
    while (turns.length > 1 && turns[0].role === 'assistant') turns.shift();
    combined = [...sys, ...turns];
  }
  return combined;
}

function normalizeGeneratedTitle(value: string): string {
  return value
    .replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24);
}

async function ensureModelGateAccess(modelGateEnabled: boolean, signal?: AbortSignal): Promise<void> {
  if (!modelGateEnabled) return;
  if (signal?.aborted) throw new Error(USER_ABORT_SENTINEL);

  let response: Response;
  try {
    response = await fetch('/api/model-gate', { signal });
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
      throw new Error(USER_ABORT_SENTINEL);
    }
    throw error;
  }
  const data = await response.json().catch(() => null) as { unlocked?: boolean; message?: string } | null;
  if (signal?.aborted) throw new Error(USER_ABORT_SENTINEL);
  if (data?.unlocked) return;

  throw new Error(`HTTP 418 ${data?.message || '模型访问未解锁'}`);
}

async function processSSEStream(
  stream: ReadableStream<Uint8Array>,
  onPartial: (img: ImageHit) => void,
  onComplete: (img: ImageHit) => void,
  signal?: AbortSignal,
  onImageEvent?: (type: 'partial' | 'complete') => void,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let rawText = '';

  const cancelReader = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener('abort', cancelReader, { once: true });

  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel().catch(() => {});
        throw new Error(USER_ABORT_SENTINEL);
      }
      const { done, value } = await reader.read();
      if (signal?.aborted) throw new Error(USER_ABORT_SENTINEL);
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      rawText += chunk;
      buffer += chunk;

      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() || '';

      for (const block of blocks) {
        if (!block.trim()) continue;
        let eventType = 'message';
        const dataLines: string[] = [];

        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) {
            eventType = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trim());
          }
        }

        const dataStr = dataLines.join('\n');
        if (dataStr === '[DONE]') return rawText;
        if (!dataStr) continue;

        try {
          const evt = JSON.parse(dataStr);
          if (evt.error) {
            throw new Error(evt.message || `HTTP ${evt.status}`);
          }
          if (eventType.includes('partial_image') || (evt.type && evt.type.includes('partial_image'))) {
            const url = evt.image_url || (evt.b64_json ? `data:image/png;base64,${evt.b64_json}` : null);
            if (url) {
              onImageEvent?.('partial');
              onPartial({ dataUrl: url.startsWith('data:') ? url : undefined, url: url.startsWith('data:') ? undefined : url } as ImageHit);
            }
          } else if (eventType.includes('completed') || (evt.type && evt.type.includes('completed'))) {
            if (evt.b64_json) {
              onImageEvent?.('complete');
              onComplete({ dataUrl: `data:image/png;base64,${evt.b64_json}` });
            } else if (evt.url) {
              onImageEvent?.('complete');
              onComplete({ url: evt.url });
            } else if (evt.image_url) {
              onImageEvent?.('complete');
              onComplete({ dataUrl: evt.image_url.startsWith('data:') ? evt.image_url : undefined, url: evt.image_url.startsWith('data:') ? undefined : evt.image_url } as ImageHit);
            }
          }
        } catch (e) {
          if (e instanceof Error && e.message) throw e;
        }
      }
    }
  } finally {
    signal?.removeEventListener('abort', cancelReader);
  }
  return rawText;
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw new Error(USER_ABORT_SENTINEL);
}

function abortableDelay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error(USER_ABORT_SENTINEL));
      return;
    }

    const timeoutId = setTimeout(() => {
      signal.removeEventListener('abort', handleAbort);
      resolve();
    }, ms);

    const handleAbort = () => {
      clearTimeout(timeoutId);
      reject(new Error(USER_ABORT_SENTINEL));
    };

    signal.addEventListener('abort', handleAbort, { once: true });
  });
}

const REQUEST_MAX_ATTEMPTS = 3;
const REQUEST_RETRY_DELAYS_MS = [4000, 8000] as const;

interface RequestFailureResult {
  status: number;
  statusText: string;
  text: string;
}

class RequestStatusError extends Error {
  status: number;

  constructor(result: RequestFailureResult) {
    const detail = parseErrorDetail(result.text) || result.statusText || '请求失败';
    super(result.status ? `HTTP ${result.status} ${detail}` : detail);
    this.name = 'RequestStatusError';
    this.status = result.status;
  }
}

class RequestAttemptsExhaustedError extends Error {
  constructor(error: unknown) {
    super(buildFinalFailureMessage(errorMessage(error)));
    this.name = 'RequestAttemptsExhaustedError';
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || '请求失败');
}

function errorStatus(error: unknown) {
  if (error instanceof RequestStatusError) return error.status;
  const match = /^HTTP\s+(\d+)/i.exec(errorMessage(error));
  return match ? Number(match[1]) : null;
}

function isRetryableRequestError(error: unknown) {
  const message = errorMessage(error);
  if (message === USER_ABORT_SENTINEL) return true;
  if (/no available channel for model/i.test(message)) return false;

  const status = errorStatus(error);
  if (status !== null) {
    return status === 0 || status === 408 || status === 429 || (status >= 500 && status < 600);
  }

  return /timeout|timed out|network|fetch|failed|超时|响应中未找到图片|响应为空|无响应/i.test(message);
}

function buildFinalFailureMessage(message: string) {
  return `请求失败，已自动重试 ${REQUEST_MAX_ATTEMPTS - 1} 次仍未成功。\n${message || '上游未返回有效结果'}`;
}

function readSyncUsername() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CHAT_SYNC_AUTH_STORAGE_KEY) || 'null');
    return typeof parsed?.username === 'string' ? parsed.username.trim() : '';
  } catch {
    return '';
  }
}

// ── Component ──

function HomeInner() {
  const [activeTab, setActiveTab] = useState<'generate' | 'decode'>('generate');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [syncUsername, setSyncUsername] = useState('');
  const [pendingRegenerateMessageId, setPendingRegenerateMessageId] = useState<string | null>(null);
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

  const { config, options, modelGateEnabled, defaultBaseUrl } = useConfig();
  const {
    sessions,
    activeSessionId,
    addBotMsg,
    addErrorMsg,
    addUserMsg,
    addTextBotMsg,
    updateLastBotMsg,
    updateBotMsg,
    updateBotText,
    replaceBotMessage,
    updateUserMessage,
    truncateChatAfterMessage,
    restoreSessionMessages,
    setGeneratedSessionTitle,
    setLoading,
    setStatus,
    setDebugRaw,
    isLoading,
  } = useChat();
  const { images, editingIndex, selectedIndices, clearAll: clearImages, buildEditsForm, addFiles, closeEditor } = useImages();

  const abortRef = useRef<AbortController | null>(null);
  const promptRunActiveRef = useRef(false);
  const sessionsRef = useRef(sessions);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);

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

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // Drag & drop / paste support
  useEffect(() => {
    const hasFiles = (e: DragEvent) =>
      e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');

    const handleDragOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const handleDrop = (e: DragEvent) => {
      if (!hasFiles(e) || !e.dataTransfer?.files?.length) return;
      const hasImage = Array.from(e.dataTransfer.files).some(
        (f: File) => f.type && f.type.startsWith('image/')
      );
      if (!hasImage) return;
      e.preventDefault();
      addFiles(e.dataTransfer.files).catch(() => {});
    };
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const picked: File[] = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type?.startsWith('image/')) {
          const f = items[i].getAsFile();
          if (f) picked.push(f);
        }
      }
      if (picked.length) {
        addFiles(picked).catch(() => {});
        e.preventDefault();
      }
    };

    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('drop', handleDrop);
    document.addEventListener('paste', handlePaste);
    return () => {
      document.removeEventListener('dragover', handleDragOver);
      document.removeEventListener('drop', handleDrop);
      document.removeEventListener('paste', handlePaste);
    };
  }, [addFiles]);

  // Send handler - core logic
  const runPrompt = useCallback(async (
    prompt: string,
    runOptions: PromptRunOptions = {},
  ) => {
    if (!prompt.trim() || promptRunActiveRef.current) return;
    promptRunActiveRef.current = true;

    const sessionId = activeSessionId;
    const existingUserMessageId = runOptions.existingUserMessageId;
    const targetBotMessageId = runOptions.targetBotMessageId;
    const currentSessionMessages = sessionsRef.current.find((session) => session.id === sessionId)?.messages ?? [];
    const sessionMessages = runOptions.historyMessages
      ?? currentSessionMessages;
    const isFirstUserTurn = !existingUserMessageId
      && !targetBotMessageId
      && currentSessionMessages.filter((message) => message.role === 'user').length === 0;
    const shouldRestoreSessionOnAbort = !!existingUserMessageId && !targetBotMessageId;
    const originalTargetMessage = targetBotMessageId
      ? currentSessionMessages.find((message) => message.id === targetBotMessageId && message.role === 'bot')
      : undefined;
    const restoreTargetMessage = () => {
      if (!targetBotMessageId || !originalTargetMessage) return;
      replaceBotMessage(targetBotMessageId, {
        prompt: originalTargetMessage.prompt,
        images: originalTargetMessage.images,
        text: originalTargetMessage.text,
        code: originalTargetMessage.code,
        extra: originalTargetMessage.extra,
      }, sessionId);
    };
    if (targetBotMessageId) {
      setPendingRegenerateMessageId(targetBotMessageId);
      replaceBotMessage(targetBotMessageId, {
        prompt: '',
        images: [],
        text: '',
        code: '',
        extra: '',
      }, sessionId);
    }

    abortRef.current?.abort();
    const requestController = new AbortController();
    const requestSignal = requestController.signal;
    abortRef.current = requestController;
    setLoading(true, sessionId);
    setStatus('请求准备中...');
    setDebugRaw('（尚未请求）');

    const optimisticUserMessageId = existingUserMessageId
      ?? (!targetBotMessageId ? addUserMsg(prompt, sessionId) : undefined);
    if (existingUserMessageId) {
      updateUserMessage(existingUserMessageId, prompt, sessionId, undefined, { markEdited: true });
    }

    const buildErrorHint = (msg: string): string => {
      if (msg.includes('413') || /too large|请求体|超过上限|Image is too large/i.test(msg)) {
        return '\n参考图总大小过大，请删除不必要的参考图或换用更小的图片后重试';
      }
      if (/no available channel for model/i.test(msg)) {
        return '\n当前 API 渠道没有这个模型的可用通道。请在设置中切换对应的 Base URL/API Key，或更换可用模型。';
      }
      if (msg.includes('401')) return '\nAPI Key 无效或未配置，请在设置中填写或检查 .env';
      if (msg.includes('400')) return '\n请求参数有误，请检查 Base URL 格式';
      if (msg.includes('418')) return '';
      if (msg.includes('404') || msg.includes('405')) return '\n接口不存在，请确认 Base URL 是否支持 OpenAI 兼容 API';
      if (/5\d\d/.test(msg)) return '\n上游服务器错误，请稍后重试或检查服务状态';
      return '\n请检查 API Key 和 Base URL 配置';
    };
    const writeTextBot = (text: string, code: string) => {
      if (targetBotMessageId && !text && !code) return;
      if (targetBotMessageId) {
        replaceBotMessage(targetBotMessageId, { prompt: '', images: [], text, code, extra: '' }, sessionId);
      } else {
        addTextBotMsg(text, code, sessionId);
      }
    };
    const writeBotError = (error: string) => {
      if (targetBotMessageId) {
        replaceBotMessage(targetBotMessageId, { prompt: error, images: [], text: '', code: '', extra: 'error' }, sessionId);
      } else {
        addErrorMsg(error, sessionId);
      }
    };
    const botPlaceholderIdRef = { current: targetBotMessageId || '' };
    const ensureBotPlaceholder = () => {
      if (botPlaceholderIdRef.current) {
        replaceBotMessage(botPlaceholderIdRef.current, { prompt: '', images: [], text: '', code: '', extra: '' }, sessionId);
        return;
      }
      botPlaceholderIdRef.current = addBotMsg([], '', '', sessionId);
    };
    const writePlaceholderImages = (botImages: ImageHit[], code?: string) => {
      ensureBotPlaceholder();
      if (botPlaceholderIdRef.current) {
        updateBotMsg(botPlaceholderIdRef.current, botImages, code, sessionId);
      }
    };
    const writePlaceholderText = (text: string) => {
      ensureBotPlaceholder();
      if (botPlaceholderIdRef.current) {
        updateBotText(botPlaceholderIdRef.current, text, sessionId);
      }
    };
    const writeCancelMessage = () => {
      const message = '用户已取消本次请求。';
      if (botPlaceholderIdRef.current) {
        replaceBotMessage(botPlaceholderIdRef.current, { prompt: message, images: [], text: '', code: '', extra: 'error' }, sessionId);
      } else if (!targetBotMessageId) {
        addErrorMsg(message, sessionId);
      }
    };
    try {
      // Save last prompt
      if (options.persistPrompt) {
        try { localStorage.setItem(chatSessionPromptStorageKey(sessionId), prompt); } catch { /* ignore */ }
      }

      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
      throwIfAborted(requestSignal);

      const isSnapshotRun = !!runOptions.requestSnapshot;
      const validSelectedIndices = [...selectedIndices].filter((index) => index >= 0 && index < images.length);
      const selectedImagesForRun = !isSnapshotRun && config.mode !== 'chat' && validSelectedIndices.length > 0
        ? validSelectedIndices.map((index) => images[index]).filter((image): image is ImageRef => !!image)
        : [];
      const requestedMode: RunMode = runOptions.requestSnapshot?.mode
        ?? (config.mode === 'chat' ? 'chat' : selectedImagesForRun.length > 0 ? 'edits' : 'images');
      const resolvedSize = runOptions.requestSnapshot?.size
        ?? resolveRequestSize(config.size, selectedImagesForRun);
      const referenceImages = runOptions.requestSnapshot?.referenceImages
        ?? (requestedMode === 'edits'
          ? (await Promise.all(selectedImagesForRun.map((image) => imageRefToReferenceImage(image, requestSignal))))
              .filter((reference): reference is ChatReferenceImage => reference !== null)
          : []);
      throwIfAborted(requestSignal);
      const mode: RunMode = requestedMode;
      const turnSnapshot = runOptions.requestSnapshot
        ?? createTurnSnapshot(config, options, mode, resolvedSize, mode === 'edits' ? referenceImages : []);

      const model = turnSnapshot.model || config.model;
      const fallbackChatProvider = turnSnapshot.chatApiFormat
        ? getChatProviderConfig(config, turnSnapshot.chatApiFormat)
        : getChatProviderConfig(config);
      const chatModel = turnSnapshot.chatModel || fallbackChatProvider.model;
      const chatProvider = getChatProviderConfig(config, chatModel, turnSnapshot.chatApiFormat);
      const chatApiFormat = chatProvider.format;
      const titleModel = chatProvider.titleModel || chatModel;
      const n = turnSnapshot.n;
      const quality = turnSnapshot.quality;
      const outFormat = turnSnapshot.format;
      const background = turnSnapshot.background;
      const moderation = turnSnapshot.moderation;
      const compression = turnSnapshot.compression;
      const runStreaming = turnSnapshot.streaming;
      const runSystemPrompt = turnSnapshot.systemPrompt;
      const runContextLimit = turnSnapshot.contextLimit;
      const sizeForBody = parseSize(resolvedSize) ? resolvedSize : null;

      if (existingUserMessageId) {
        updateUserMessage(existingUserMessageId, prompt, sessionId, turnSnapshot, { markEdited: true });
        truncateChatAfterMessage(existingUserMessageId, sessionId);
      } else if (optimisticUserMessageId) {
        updateUserMessage(optimisticUserMessageId, prompt, sessionId, turnSnapshot);
      }

      const applyExtraParams = (target: RequestBody) => {
      if (quality && quality !== 'auto') setRequestParam(target, 'quality', quality);
      if (background && background !== 'auto') setRequestParam(target, 'background', background);
      setRequestParam(target, 'output_format', outFormat || 'png');
      if ((outFormat === 'jpeg' || outFormat === 'webp') && !isNaN(compression)) {
        setRequestParam(target, 'output_compression', compression);
      }
      if (moderation && moderation !== 'auto') setRequestParam(target, 'moderation', moderation);
      };

      const writeBotMsg = (botImages: ImageHit[], code: string, extra: string) => {
      if (targetBotMessageId && botImages.length === 0 && !code && !extra) return;
      if (targetBotMessageId) {
        replaceBotMessage(targetBotMessageId, { prompt: '', images: botImages, text: '', code, extra }, sessionId);
      } else {
        addBotMsg(botImages, code, extra, sessionId);
      }
      };

      const writeBotImages = (botImages: ImageHit[], code?: string) => {
      if (targetBotMessageId) {
        updateBotMsg(targetBotMessageId, botImages, code, sessionId);
      } else {
        updateLastBotMsg(botImages, code, sessionId);
      }
      };

      const scheduleTitleGeneration = (assistantText: string) => {
      if (!isFirstUserTurn || targetBotMessageId || !assistantText.trim()) return;
      void (async () => {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 20_000);
        try {
          const titleBody = {
            model: titleModel,
            messages: [
              {
                role: 'system',
                content: 'Summarize this conversation into a concise Chinese chat title. Return only the title, no quotes, no punctuation at the end. Keep it under 12 Chinese characters or 6 English words.',
              },
              {
                role: 'user',
                content: `User: ${prompt}\nAssistant: ${assistantText.slice(0, 1200)}`,
              },
            ],
            stream: false,
          };
          const titleConfig = { ...config, chatModel: titleModel, chatApiFormat };
          const result = await proxyRequest('/api/chat/completions', titleConfig, titleBody, options, 'chat', controller.signal);
          if (!result.ok) return;
          const resp = JSON.parse(result.text);
          const title = normalizeGeneratedTitle(extractChatResponseText(resp, chatApiFormat));
          if (title) setGeneratedSessionTitle(sessionId, title);
        } catch {
          // Title generation is best-effort and should never affect the chat response.
        } finally {
          window.clearTimeout(timeoutId);
        }
      })();
      };

      const scheduleImageTitleGeneration = (imageCount: number) => {
        if (imageCount <= 0) return;
        scheduleTitleGeneration(`生成完成 ${imageCount} 张图片`);
      };

      const describeRetryFailure = (error: unknown) => {
        const status = errorStatus(error);
        if (status === 429) return '上游限流';
        if (status && status >= 500) return '上游服务器错误';
        if (status === 408 || /timeout|timed out|超时/i.test(errorMessage(error))) return '请求超时';
        return '请求失败';
      };

      const retryable = async <T,>(
        label: string,
        operation: () => Promise<T>,
        shouldRetry: (error: unknown) => boolean = isRetryableRequestError,
      ): Promise<T> => {
        let lastError: unknown;

        for (let attempt = 1; attempt <= REQUEST_MAX_ATTEMPTS; attempt += 1) {
          throwIfAborted(requestSignal);
          try {
            if (attempt > 1) {
              setStatus(`${label}重试中 (${attempt}/${REQUEST_MAX_ATTEMPTS})...`, 'warn');
            }
            return await operation();
          } catch (error) {
            if (errorMessage(error) === USER_ABORT_SENTINEL || requestSignal.aborted) {
              throw new Error(USER_ABORT_SENTINEL);
            }

            lastError = error;
            const retryableError = shouldRetry(error);
            const canRetry = attempt < REQUEST_MAX_ATTEMPTS && retryableError;
            if (!canRetry) {
              if (retryableError && attempt >= REQUEST_MAX_ATTEMPTS) {
                throw new RequestAttemptsExhaustedError(error);
              }
              throw error;
            }

            const delay = REQUEST_RETRY_DELAYS_MS[attempt - 1] ?? REQUEST_RETRY_DELAYS_MS[REQUEST_RETRY_DELAYS_MS.length - 1];
            setStatus(`${describeRetryFailure(error)}，${Math.round(delay / 1000)}s 后重试 (${attempt}/${REQUEST_MAX_ATTEMPTS - 1})...`, 'warn');
            await abortableDelay(delay, requestSignal);
          }
        }

        throw new RequestAttemptsExhaustedError(lastError);
      };

      const requestWithoutRetry = async (
        endpoint: string,
        body: unknown,
        kind: 'image' | 'chat' = 'image',
      ) => {
        const result = await proxyRequest(endpoint, config, body, options, kind, requestSignal);
        throwIfAborted(requestSignal);
        if (!result.ok) throw new RequestStatusError(result);
        return result;
      };

      const imageStreamAttemptWithRetry = async (
        endpoint: string,
        body: RequestBody,
      ) => retryable('流式图片请求', async () => {
        setRequestParam(body, 'stream', true);
        setRequestParam(body, 'partial_images', 2);

        const attempt = createImageStreamAttempt(requestSignal);
        const previewHits: ImageHit[] = [];
        const finalHits: ImageHit[] = [];
        let rawText = '';
        let streamError: Error | null = null;

        writePlaceholderImages([], undefined);

        try {
          const result = await proxyRequestStream(endpoint, config, body, options, attempt.signal);
          throwIfAborted(requestSignal);
          if (!result.ok || !result.stream) {
            throw new RequestStatusError({
              status: result.status,
              statusText: '',
              text: result.text || '流式请求失败',
            });
          }
          rawText = await processSSEStream(
            result.stream,
            (partial) => {
              previewHits[previewHits.length] = partial;
              writePlaceholderImages([...previewHits], undefined);
            },
            (final) => {
              finalHits[finalHits.length > 0 ? finalHits.length - 1 : 0] = final;
              previewHits[previewHits.length > 0 ? previewHits.length - 1 : 0] = final;
              writePlaceholderImages([...finalHits], undefined);
            },
            attempt.signal,
            (type) => {
              if (type === 'complete') attempt.markComplete();
              else attempt.markPartial();
            },
          );
        } catch (error) {
          streamError = error as Error;
        } finally {
          attempt.cleanup();
          deleteRequestParam(body, 'stream');
          deleteRequestParam(body, 'partial_images');
        }

        if (requestSignal.aborted) throw new Error(USER_ABORT_SENTINEL);
        if (streamError?.message === USER_ABORT_SENTINEL && !attempt.didTimeout()) {
          throw new Error(USER_ABORT_SENTINEL);
        }
        if (streamError?.message === USER_ABORT_SENTINEL && attempt.didTimeout()) {
          throw new Error('流式请求超时');
        }
        if (streamError) throw streamError;
        if (finalHits.length > 0) {
          return {
            finalHits,
            rawText,
          };
        }

        const resp = parseStreamResponseBody(rawText);
        const hit = extractImage(resp);
        if (hit) {
          return {
            finalHits: [hit],
            rawText: typeof resp === 'string' ? resp : JSON.stringify(resp, null, 2),
          };
        }

        throw new Error('响应中未找到图片');
      });

      const formatDebugBody = (value: unknown) => (
        typeof value === 'string' ? value : JSON.stringify(value, null, 2)
      );

      const requestSingleImage = async (endpoint: string, body: RequestBody) => {
        return retryable('图片请求', async () => {
          const result = await requestWithoutRetry(endpoint, body, 'image');
          const resp = parseResponseBody(result.text);
          const hit = extractImage(resp);
          if (!hit) throw new Error('响应中未找到图片');
          return {
            hit,
            debugText: formatDebugBody(resp),
          };
        });
      };

      const requestSingleImageOnce = async (endpoint: string, body: RequestBody) => {
        const result = await requestWithoutRetry(endpoint, body, 'image');
        const resp = parseResponseBody(result.text);
        const hit = extractImage(resp);
        if (!hit) throw new Error('响应中未找到图片');
        return {
          hit,
          debugText: formatDebugBody(resp),
        };
      };

      const requestSingleEditImage = async (body: RequestBody) => {
        return retryable('图片编辑请求', async () => {
          const result = await requestWithoutRetry('/api/images/edits', body, 'image');
          const resp = parseResponseBody(result.text);
          const hit = extractImage(resp);
          if (!hit) throw new Error('响应中未找到图片');
          return {
            hit,
            debugText: formatDebugBody(resp),
            resp,
          };
        });
      };

      const requestImageWithAutoFallback = async (
        endpoint: string,
        body: RequestBody,
        capabilityKey: string,
      ): Promise<{ hits: ImageHit[]; debugText: string; usedPlaceholder: boolean }> => {
        if (getImageStreamCapability(capabilityKey) === 'unsupported') {
          const fallback = await requestSingleImage(endpoint, body);
          return {
            hits: fallback.hit ? [fallback.hit] : [],
            debugText: fallback.debugText,
            usedPlaceholder: false,
          };
        }

        let streamError: Error | null = null;
        let usedPlaceholder = false;

        try {
          usedPlaceholder = true;
          ensureBotPlaceholder();
          const streamed = await imageStreamAttemptWithRetry(endpoint, body);
          setImageStreamCapability(capabilityKey, 'supported');
          return {
            hits: streamed.finalHits,
            debugText: streamed.rawText || JSON.stringify(streamed.finalHits[0], null, 2),
            usedPlaceholder,
          };
        } catch (e) {
          streamError = e as Error;
        }

        if (requestSignal.aborted) throw new Error(USER_ABORT_SENTINEL);

        if (streamError?.message === USER_ABORT_SENTINEL) {
          throw new Error(USER_ABORT_SENTINEL);
        }

        writePlaceholderImages([], undefined);
        const fallback = await requestSingleImageOnce(endpoint, body);
        if (fallback.hit) setImageStreamCapability(capabilityKey, 'unsupported');
        return {
          hits: fallback.hit ? [fallback.hit] : [],
          debugText: fallback.debugText,
          usedPlaceholder,
        };
      };

      throwIfAborted(requestSignal);
      await ensureModelGateAccess(modelGateEnabled, requestSignal);
      throwIfAborted(requestSignal);

      if (!isSnapshotRun && options.clearOnSubmit) {
        clearImages();
      }

      setStatus('请求发送中...');

      // ---- Image edits mode (single or multi) ----
      let requestMode = mode;
      if (requestMode === 'edits') {
        const body = isSnapshotRun
          ? await buildEditsFormFromReferences(referenceImages, prompt, sizeForBody, model, requestSignal)
          : await buildEditsForm(selectedImagesForRun, prompt, sizeForBody, model, requestSignal);

        throwIfAborted(requestSignal);
        const actualImageCount = getFormImageCount(body);
        if (actualImageCount === 0) {
          requestMode = 'images';
        } else {
          applyExtraParams(body);

          const requestedImageCount = Math.max(1, n);
          const editsStreaming = runStreaming && actualImageCount <= 1 && requestedImageCount === 1;
          if (editsStreaming) {
            const capabilityKey = getImageStreamCapabilityKey('/api/images/edits', config, model, defaultBaseUrl);
            const result = await requestImageWithAutoFallback('/api/images/edits', body, capabilityKey);
            if (result.hits.length > 0) {
              if (result.usedPlaceholder) {
                writeBotImages(result.hits, result.debugText);
              } else {
                writeBotMsg(result.hits, result.debugText, '');
              }
              setStatus(`生成完成 ${result.hits.length} 张`, 'ok');
              scheduleImageTitleGeneration(result.hits.length);
              void saveHistoryEntry(prompt, mode, model, resolvedSize, result.hits);
            } else {
              if (result.usedPlaceholder) {
                writeBotImages([], result.debugText);
              } else {
                writeBotMsg([], result.debugText, '响应中未找到图片');
              }
              setStatus('未识别到图片内容', 'err');
            }
          } else {
            {
              const { resp, hit } = await requestSingleEditImage(body);
              const hits: ImageHit[] = [hit];

              if (n > 1) {
                const limit = Math.min(5, n - 1);
                let cursor = 0;
                const worker = async () => {
                  while (cursor < n - 1) {
                    const i = cursor++;
                    if (i > 0) await abortableDelay(200, requestSignal);
                    throwIfAborted(requestSignal);
                    try {
                      const result = await requestSingleEditImage(body);
                      hits.push(result.hit);
                    } catch (e) {
                      if ((e as Error).message === USER_ABORT_SENTINEL || requestSignal.aborted) throw e;
                    }
                  }
                };
                await Promise.all(Array.from({ length: limit }, worker));
              }

              setDebugRaw(JSON.stringify(resp, null, 2));
              writeBotMsg(hits, JSON.stringify(resp, null, 2), '');
              setStatus(`生成完成 ${hits.length} 张`, 'ok');
              scheduleImageTitleGeneration(hits.length);
              void saveHistoryEntry(prompt, mode, model, resolvedSize, hits);
            }
          }
        }
      }
      // ---- Chat completions mode (explicit chat mode, no images) ----
      if (requestMode === 'chat') {
          const chatRequestConfig = { ...config, chatModel, chatApiFormat };
          const chatBody = {
            model: chatModel,
            messages: buildChatMessages(sessionMessages, prompt, runSystemPrompt || '', runContextLimit),
            stream: runStreaming,
          };

        if (runStreaming) {
          const fullText = await retryable('聊天请求', async () => {
            writePlaceholderText('');
            const result = await proxyRequestStream('/api/chat/completions', chatRequestConfig, chatBody, options, requestSignal, 'chat');
            throwIfAborted(requestSignal);
            if (!result.ok || !result.stream) {
              throw new RequestStatusError({
                status: result.status,
                statusText: '',
                text: result.text || '流式请求失败',
              });
            }
            const fullText = await processChatStream(result.stream, (t) => writePlaceholderText(t), chatApiFormat, requestSignal);
            if (!fullText.trim()) throw new Error('响应为空');
            return fullText;
          });
          setDebugRaw(fullText);
          setStatus('回复完成', 'ok');
          scheduleTitleGeneration(fullText);
        } else {
          const result = await retryable('聊天请求', async () => {
            const response = await proxyRequest('/api/chat/completions', chatRequestConfig, chatBody, options, 'chat', requestSignal);
            throwIfAborted(requestSignal);
            if (!response.ok) throw new RequestStatusError(response);
            return response;
          });
          const resp = JSON.parse(result.text);
          const content = extractChatResponseText(resp, chatApiFormat);
          if (!content.trim()) throw new Error('响应为空');
          setDebugRaw(JSON.stringify(resp, null, 2));
          writeTextBot(content, JSON.stringify(resp, null, 2));
          setStatus('回复完成', 'ok');
          scheduleTitleGeneration(content);
        }
      }
      // ---- Text-to-image mode ----
      else if (requestMode === 'images') {
        const requestedImageCount = Math.max(1, n);
        const imageStreaming = runStreaming && requestedImageCount === 1;
        const genBody: Record<string, unknown> = { model, prompt, n: 1, size: resolvedSize };
        applyExtraParams(genBody);

        if (imageStreaming) {
          const capabilityKey = getImageStreamCapabilityKey('/api/images/generations', config, model, defaultBaseUrl);
          const result = await requestImageWithAutoFallback('/api/images/generations', genBody, capabilityKey);
          if (result.hits.length > 0) {
            if (result.usedPlaceholder) {
              writeBotImages(result.hits, result.debugText);
            } else {
              writeBotMsg(result.hits, result.debugText, '');
            }
            setStatus(`生成完成 ${result.hits.length} 张`, 'ok');
            scheduleImageTitleGeneration(result.hits.length);
            void saveHistoryEntry(prompt, mode, model, resolvedSize, result.hits);
          } else {
            if (result.usedPlaceholder) {
              writeBotImages([], result.debugText);
            } else {
              writeBotMsg([], result.debugText, '响应中未找到图片');
            }
            setStatus('未识别到图片内容', 'err');
          }
        } else {
          const hits: ImageHit[] = [];
          const errors: string[] = [];

          const limit = Math.min(5, requestedImageCount);
          let cursor = 0;
          const worker = async () => {
            while (cursor < requestedImageCount) {
              const i = cursor++;
              if (i > 0) await abortableDelay(200, requestSignal);
              throwIfAborted(requestSignal);
              try {
                const result = await requestSingleImage('/api/images/generations', genBody);
                const hit = result.hit;
                if (hit) hits.push(hit);
              } catch (e) {
                if ((e as Error).message === USER_ABORT_SENTINEL || requestSignal.aborted) throw e;
                errors.push((e as Error).message);
              }
            }
          };
          await Promise.all(Array.from({ length: limit }, worker));

          if (hits.length > 0) {
            const debugResp = JSON.stringify(hits[0], null, 2);
            setDebugRaw(debugResp);
            writeBotMsg(hits, debugResp, '');
            setStatus(`生成完成 ${hits.length} 张`, 'ok');
            scheduleImageTitleGeneration(hits.length);
            void saveHistoryEntry(prompt, mode, model, resolvedSize, hits);
          } else {
            const debugResp = errors.join('\n') || '无响应';
            setDebugRaw(debugResp);
            const first = errors[0] || '';
            const gateMessage = extractModelGateMessage(first);
            if (gateMessage) {
              writeTextBot(buildRepeaterReply(prompt), '');
              setStatus('回复完成', 'ok');
            } else {
              writeBotError((first || '请求未返回图片') + buildErrorHint(first));
              setStatus('请求失败', 'err');
            }
          }
        }
      }
    } catch (e) {
      const msg = (e as Error).message || '请求失败';
      if (msg === USER_ABORT_SENTINEL) {
        if (shouldRestoreSessionOnAbort) {
          restoreSessionMessages(sessionId, currentSessionMessages);
        } else {
          restoreTargetMessage();
          writeCancelMessage();
        }
        setStatus('已取消', 'warn');
      } else if (extractModelGateMessage(msg)) {
        setDebugRaw(buildRepeaterReply(prompt));
        writeTextBot(buildRepeaterReply(prompt), '');
        setStatus('回复完成', 'ok');
      } else {
        restoreTargetMessage();
        setDebugRaw(msg);
        if (!targetBotMessageId) {
          writeBotError(msg + buildErrorHint(msg));
        }
        setStatus('请求失败', 'err');
      }
    } finally {
      if (abortRef.current === requestController) abortRef.current = null;
      if (targetBotMessageId) setPendingRegenerateMessageId((current) => (
        current === targetBotMessageId ? null : current
      ));
      setLoading(false, sessionId);
      promptRunActiveRef.current = false;
    }
  }, [
    activeSessionId,
    config,
    options,
    modelGateEnabled,
    defaultBaseUrl,
    images,
    selectedIndices,
    buildEditsForm,
    addBotMsg,
    addTextBotMsg,
    updateLastBotMsg,
    updateBotMsg,
    updateBotText,
    replaceBotMessage,
    truncateChatAfterMessage,
    restoreSessionMessages,
    setGeneratedSessionTitle,
    addErrorMsg,
    addUserMsg,
    updateUserMessage,
    setLoading,
    setStatus,
    setDebugRaw,
    clearImages,
  ]);

  const handleSend = useCallback((prompt: string) => {
    void runPrompt(prompt);
  }, [runPrompt]);

  const handleRegenerateMessage = useCallback((messageId: string) => {
    if (isLoading) return;
    const session = sessionsRef.current.find((item) => item.id === activeSessionId);
    if (!session) return;
    const botIndex = session.messages.findIndex((message) => message.id === messageId && message.role === 'bot');
    if (botIndex <= 0) return;
    const priorMessages = session.messages.slice(0, botIndex);
    const userMessage = [...priorMessages].reverse().find((message) => message.role === 'user' && message.prompt.trim());
    if (!userMessage) return;
    void runPrompt(userMessage.prompt, {
      targetBotMessageId: messageId,
      historyMessages: priorMessages.filter((message) => message.id !== userMessage.id),
      requestSnapshot: userMessage.request,
    });
  }, [activeSessionId, isLoading, runPrompt]);

  const handleEditMessage = useCallback((messageId: string, prompt: string) => {
    if (isLoading) return;
    const session = sessionsRef.current.find((item) => item.id === activeSessionId);
    if (!session) return;
    const messageIndex = session.messages.findIndex((message) => message.id === messageId && message.role === 'user');
    if (messageIndex < 0) return;
    const userMessage = session.messages[messageIndex];
    const historyMessages = session.messages.slice(0, messageIndex);
    void runPrompt(prompt, {
      existingUserMessageId: messageId,
      historyMessages,
      requestSnapshot: userMessage.request,
    });
  }, [activeSessionId, isLoading, runPrompt]);

  return (
    <ErrorBoundary>
    <div className="flex flex-col h-full overflow-hidden">
      <StatusBar />
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

// History helper
async function saveHistoryEntry(
  prompt: string,
  mode: string,
  model: string,
  size: string,
  hits: ImageHit[],
) {
  try {
    const storedHits = (await Promise.all(hits.map((hit) => imageHitToStoredUrl(hit))))
      .filter((url): url is string => !!url)
      .map((url) => ({ link: url, isData: false }));
    if (storedHits.length === 0) return;

    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    const entry = {
      prompt,
      mode,
      model,
      size,
      n: storedHits.length,
      hits: storedHits,
      id: Math.random().toString(36).slice(2, 10),
      ts: Date.now(),
    };
    list.unshift(entry);
    while (list.length > HISTORY_MAX) list.pop();
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(list));
  } catch { /* ignore */ }
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
