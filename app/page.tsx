'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ConfigProvider, useConfig } from '@/contexts/ConfigContext';
import { ChatProvider, useChat } from '@/contexts/ChatContext';
import { ImageProvider, useImages } from '@/contexts/ImageContext';
import StatusBar from '@/components/StatusBar';
import MenuBar from '@/components/MenuBar';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import TabDecode from '@/components/TabDecode';
import ChatArea from '@/components/ChatArea';
import ChatInput from '@/components/ChatInput';
import ImageGrid from '@/components/ImageGrid';
import ImageEditor from '@/components/ImageEditor';
import SettingsModal from '@/components/SettingsModal';
import DebugPanel from '@/components/DebugPanel';
import Footer from '@/components/Footer';
import { extractImage } from '@/lib/image-extract';
import { proxyRequest, proxyRequestStream, USER_ABORT_SENTINEL } from '@/lib/api';
import { AppConfig, AppOptions, ImageHit, ImageRef } from '@/types';
import type { ChatMessage, ChatReferenceImage, ChatTurnSnapshot } from '@/contexts/ChatContext';
import {
  HISTORY_STORAGE_KEY,
  HISTORY_MAX,
  chatSessionPromptStorageKey,
} from '@/lib/constants';
import { imageHitToStoredUrl, uploadChatImage } from '@/lib/chat-asset-client';
import { blobToEditBlob } from '@/lib/image-edit';
import { parseSize, resolveRequestSize } from '@/lib/size';

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

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read image'));
    reader.readAsDataURL(blob);
  });
}

async function canvasToImageHit(canvas: HTMLCanvasElement | null): Promise<ImageHit | undefined> {
  if (!canvas) return undefined;
  const dataUrl = canvas.toDataURL('image/png');
  const url = await uploadChatImage(dataUrl);
  return url ? { url } : { dataUrl };
}

async function imageRefToStoredHit(image: ImageRef): Promise<ImageHit | null> {
  try {
    const dataUrl = await blobToDataUrl(image.file);
    const url = await uploadChatImage(dataUrl);
    return url ? { url } : { dataUrl };
  } catch {
    return null;
  }
}

async function imageRefToReferenceImage(image: ImageRef): Promise<ChatReferenceImage | null> {
  const storedImage = await imageRefToStoredHit(image);
  if (!storedImage) return null;
  const mask = await canvasToImageHit(image.maskCanvas);
  return mask ? { image: storedImage, mask } : { image: storedImage };
}

async function imageHitToBlob(image: ImageHit): Promise<Blob | null> {
  const source = image.dataUrl || image.url;
  if (!source) return null;
  try {
    const response = await fetch(source);
    if (!response.ok) return null;
    return blobToEditBlob(await response.blob(), source);
  } catch {
    return null;
  }
}

function blobExt(blob: Blob) {
  if (blob.type === 'image/jpeg') return 'jpg';
  if (blob.type === 'image/webp') return 'webp';
  if (blob.type === 'image/gif') return 'gif';
  return 'png';
}

async function buildEditsFormFromReferences(
  references: ChatReferenceImage[],
  prompt: string,
  size: string | null,
  model: string,
): Promise<FormData> {
  const form = new FormData();
  form.append('model', model);
  form.append('prompt', prompt);
  if (size) form.append('size', size);

  const imageBlobs = await Promise.all(references.map((reference) => imageHitToBlob(reference.image)));
  imageBlobs.forEach((blob, i) => {
    if (!blob) return;
    form.append('image[]', blob, `image-${i + 1}.${blobExt(blob)}`);
  });

  const maskBlob = await imageHitToBlob(references[0]?.mask || {});
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
  return {
    mode,
    model: config.model,
    chatModel: config.chatModel,
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
        for (const line of block.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') return fullText;
          if (!data) continue;
          try {
            const evt = JSON.parse(data);
            if (evt.error) throw new Error(evt.message || `HTTP ${evt.status}`);
            const delta = evt.choices?.[0]?.delta?.content;
            if (delta) {
              fullText += delta;
              onDelta(fullText);
            }
          } catch (e) {
            if (e instanceof SyntaxError) continue;
            if (e instanceof Error && e.message) throw e;
          }
        }
      }
    }
  } finally {
    signal?.removeEventListener('abort', cancelReader);
  }
  return fullText;
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

async function ensureModelGateAccess(modelGateEnabled: boolean): Promise<void> {
  if (!modelGateEnabled) return;

  const response = await fetch('/api/model-gate');
  const data = await response.json().catch(() => null) as { unlocked?: boolean; message?: string } | null;
  if (data?.unlocked) return;

  throw new Error(`HTTP 418 ${data?.message || '模型访问未解锁'}`);
}

async function processSSEStream(
  stream: ReadableStream<Uint8Array>,
  onPartial: (img: ImageHit) => void,
  onComplete: (img: ImageHit) => void,
  signal?: AbortSignal,
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
            if (url) onPartial({ dataUrl: url.startsWith('data:') ? url : undefined, url: url.startsWith('data:') ? undefined : url } as ImageHit);
          } else if (eventType.includes('completed') || (evt.type && evt.type.includes('completed'))) {
            if (evt.b64_json) {
              onComplete({ dataUrl: `data:image/png;base64,${evt.b64_json}` });
            } else if (evt.url) {
              onComplete({ url: evt.url });
            } else if (evt.image_url) {
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

// ── Component ──

function HomeInner() {
  const [activeTab, setActiveTab] = useState<'generate' | 'decode'>('generate');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pendingRegenerateMessageId, setPendingRegenerateMessageId] = useState<string | null>(null);

  const { config, options, modelGateEnabled } = useConfig();
  const {
    sessions,
    activeSessionId,
    addBotMsg,
    addErrorMsg,
    addUserMsg,
    addTextBotMsg,
    updateLastBotMsg,
    updateLastBotText,
    updateBotMsg,
    updateBotText,
    replaceBotMessage,
    setLoading,
    setStatus,
    setDebugRaw,
    isLoading,
    clearChat,
  } = useChat();
  const { images, editingIndex, selectedIndices, clearAll: clearImages, buildEditsForm, addFiles, closeEditor } = useImages();

  const abortRef = useRef<AbortController | null>(null);
  const sessionsRef = useRef(sessions);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);

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
    const sessionId = activeSessionId;
    const targetBotMessageId = runOptions.targetBotMessageId;
    if (!prompt) return;

    if (targetBotMessageId) setPendingRegenerateMessageId(targetBotMessageId);
    const currentSessionMessages = sessionsRef.current.find((session) => session.id === sessionId)?.messages ?? [];
    const sessionMessages = runOptions.historyMessages
      ?? currentSessionMessages;
    const originalTargetMessage = targetBotMessageId
      ? currentSessionMessages.find((message) => message.id === targetBotMessageId && message.role === 'bot')
      : undefined;

    abortRef.current?.abort();
    const requestController = new AbortController();
    const requestSignal = requestController.signal;
    abortRef.current = requestController;

    // Save last prompt
    if (options.persistPrompt) {
      try { localStorage.setItem(chatSessionPromptStorageKey(sessionId), prompt); } catch { /* ignore */ }
    }

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
        ? (await Promise.all(selectedImagesForRun.map(imageRefToReferenceImage)))
            .filter((reference): reference is ChatReferenceImage => reference !== null)
        : []);
    const mode: RunMode = requestedMode;
    const turnSnapshot = runOptions.requestSnapshot
      ?? createTurnSnapshot(config, options, mode, resolvedSize, mode === 'edits' ? referenceImages : []);

    const model = turnSnapshot.model || config.model;
    const chatModel = turnSnapshot.chatModel || config.chatModel;
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

    if (!targetBotMessageId) {
      addUserMsg(prompt, sessionId, turnSnapshot);
    }

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

    const applyExtraParams = (target: RequestBody) => {
      if (quality && quality !== 'auto') setRequestParam(target, 'quality', quality);
      if (background && background !== 'auto') setRequestParam(target, 'background', background);
      setRequestParam(target, 'output_format', outFormat || 'png');
      if ((outFormat === 'jpeg' || outFormat === 'webp') && !isNaN(compression)) {
        setRequestParam(target, 'output_compression', compression);
      }
      if (moderation && moderation !== 'auto') setRequestParam(target, 'moderation', moderation);
    };

    const buildErrorHint = (msg: string): string => {
      if (msg.includes('413') || /too large|请求体|超过上限|Image is too large/i.test(msg)) {
        return '\n参考图总大小过大，请删除不必要的参考图或换用更小的图片后重试';
      }
      if (msg.includes('401')) return '\nAPI Key 无效或未配置，请在设置中填写或检查 .env';
      if (msg.includes('400')) return '\n请求参数有误，请检查 Base URL 格式';
      if (msg.includes('418')) return '';
      if (msg.includes('404') || msg.includes('405')) return '\n接口不存在，请确认 Base URL 是否支持 OpenAI 兼容 API';
      if (/5\d\d/.test(msg)) return '\n上游服务器错误，请稍后重试或检查服务状态';
      return '\n请检查 API Key 和 Base URL 配置';
    };

    const writeBotMsg = (botImages: ImageHit[], code: string, extra: string) => {
      if (targetBotMessageId && botImages.length === 0 && !code && !extra) return;
      if (targetBotMessageId) {
        replaceBotMessage(targetBotMessageId, { prompt: '', images: botImages, text: '', code, extra }, sessionId);
      } else {
        addBotMsg(botImages, code, extra, sessionId);
      }
    };

    const writeTextBot = (text: string, code: string) => {
      if (targetBotMessageId && !text && !code) return;
      if (targetBotMessageId) {
        replaceBotMessage(targetBotMessageId, { prompt: '', images: [], text, code, extra: '' }, sessionId);
      } else {
        addTextBotMsg(text, code, sessionId);
      }
    };

    const writeBotImages = (botImages: ImageHit[], code?: string) => {
      if (targetBotMessageId) {
        updateBotMsg(targetBotMessageId, botImages, code, sessionId);
      } else {
        updateLastBotMsg(botImages, code, sessionId);
      }
    };

    const writeBotText = (text: string) => {
      if (targetBotMessageId) {
        updateBotText(targetBotMessageId, text, sessionId);
      } else {
        updateLastBotText(text, sessionId);
      }
    };

    const writeBotError = (error: string) => {
      if (targetBotMessageId) {
        replaceBotMessage(targetBotMessageId, { prompt: error, images: [], text: '', code: '', extra: 'error' }, sessionId);
      } else {
        addErrorMsg(error, sessionId);
      }
    };

    const tryWithRetry = async (
      endpoint: string,
      body: unknown,
      retries = 0,
      kind: 'image' | 'chat' = 'image',
    ) => {
      throwIfAborted(requestSignal);
      let result = await proxyRequest(endpoint, config, body, options, kind, requestSignal)
        .catch((e) => ({
          ok: false as const,
          status: 0,
          statusText: e.message,
          text: '',
        }));
      throwIfAborted(requestSignal);

      if (!result.ok && [0, 429, 502, 503, 504].includes(result.status) && retries < 2) {
        const delay = retries === 0 ? 4000 : 8000;
        setStatus(`上游限流，${delay / 1000}s 后重试 (${retries + 1}/2)...`);
        await abortableDelay(delay, requestSignal);
        result = await proxyRequest(endpoint, config, body, options, kind, requestSignal)
          .catch((e) => ({
            ok: false as const,
            status: 0,
            statusText: e.message,
            text: '',
          }));
        throwIfAborted(requestSignal);
        return result;
      }

      return result;
    };

    try {
      throwIfAborted(requestSignal);
      await ensureModelGateAccess(modelGateEnabled);
      throwIfAborted(requestSignal);

      if (!isSnapshotRun && options.clearOnSubmit) {
        clearImages();
      }

      setLoading(true, sessionId);
      setStatus('请求发送中...');
      setDebugRaw('（尚未请求）');

      // ---- Image edits mode (single or multi) ----
      let requestMode = mode;
      if (requestMode === 'edits') {
        const body = isSnapshotRun
          ? await buildEditsFormFromReferences(referenceImages, prompt, sizeForBody, model)
          : await buildEditsForm(selectedImagesForRun, prompt, sizeForBody, model);

        const actualImageCount = getFormImageCount(body);
        if (actualImageCount === 0) {
          requestMode = 'images';
        } else {
          applyExtraParams(body);

          const editsStreaming = runStreaming && actualImageCount <= 1;
          if (editsStreaming) {
            setRequestParam(body, 'stream', true);
            setRequestParam(body, 'partial_images', 2);
            const { ok, stream } = await proxyRequestStream('/api/images/edits', config, body, options, requestSignal);
            if (!ok || !stream) {
              deleteRequestParam(body, 'stream');
              deleteRequestParam(body, 'partial_images');
              const probe = await tryWithRetry('/api/images/edits', body);
              if (!probe.ok) throw new Error(`HTTP ${probe.status} ${parseErrorDetail(probe.text)}`);
              const resp = parseResponseBody(probe.text);
              const hit = extractImage(resp);
              if (hit) {
                writeBotMsg([hit], JSON.stringify(resp, null, 2), '');
                setStatus('生成完成 1 张', 'ok');
                void saveHistoryEntry(prompt, mode, model, resolvedSize, [hit]);
              } else {
                writeBotMsg([], JSON.stringify(resp, null, 2), '响应中未找到图片');
                setStatus('未识别到图片内容', 'err');
              }
            } else {
              const hits: ImageHit[] = [];
              writeBotMsg([], '', '');
              let streamError: Error | null = null;
              let rawText = '';
              try {
                rawText = await processSSEStream(
                  stream,
                  (partial) => { hits[hits.length] = partial; writeBotImages([...hits], undefined); },
                  (final) => { hits[hits.length > 0 ? hits.length - 1 : 0] = final; writeBotImages([...hits], undefined); },
                  requestSignal,
                );
              } catch (e) {
                streamError = e as Error;
              }
              if (streamError?.message === USER_ABORT_SENTINEL || requestSignal.aborted) throw new Error(USER_ABORT_SENTINEL);
              if (hits.length === 0 && !streamError) {
                const fallback = extractImage(parseResponseBody(rawText));
                if (fallback) hits.push(fallback);
              }
              if (hits.length > 0) {
                writeBotImages(hits, JSON.stringify(hits[0], null, 2));
                setStatus(`生成完成 ${hits.length} 张`, 'ok');
                void saveHistoryEntry(prompt, mode, model, resolvedSize, hits);
              } else if (streamError) {
                deleteRequestParam(body, 'stream');
                deleteRequestParam(body, 'partial_images');
                const probe = await tryWithRetry('/api/images/edits', body);
                if (!probe.ok) throw new Error(`HTTP ${probe.status} ${parseErrorDetail(probe.text)}`);
                const resp = parseResponseBody(probe.text);
                const hit = extractImage(resp);
                if (hit) {
                  writeBotImages([hit], JSON.stringify(resp, null, 2));
                  setStatus('生成完成 1 张', 'ok');
                  void saveHistoryEntry(prompt, mode, model, resolvedSize, [hit]);
                } else {
                  writeBotImages([], JSON.stringify(resp, null, 2));
                  setStatus('未识别到图片内容', 'err');
                }
              } else {
                writeBotImages([], '流式响应未返回图片');
                setStatus('未识别到图片内容', 'err');
              }
            }
          } else {
            const probe = await tryWithRetry('/api/images/edits', body);

            if (!probe.ok) {
              throw new Error(`HTTP ${probe.status} ${parseErrorDetail(probe.text)}`);
            } else {
              const resp = parseResponseBody(probe.text);
              const hit = extractImage(resp);
              if (hit) {
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
                        const er = await tryWithRetry('/api/images/edits', body);
                        if (er.ok) {
                          const eh = extractImage(JSON.parse(er.text));
                          if (eh) hits.push(eh);
                        }
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
                void saveHistoryEntry(prompt, mode, model, resolvedSize, hits);
              } else {
                writeBotMsg([], JSON.stringify(resp, null, 2), '响应中未找到图片，请查看调试面板');
                setStatus('未识别到图片内容', 'err');
                setDebugRaw(JSON.stringify(resp, null, 2));
              }
            }
          }
        }
      }
      // ---- Chat completions mode (explicit chat mode, no images) ----
      if (requestMode === 'chat') {
          const chatBody = {
            model: chatModel,
            messages: buildChatMessages(sessionMessages, prompt, runSystemPrompt || '', runContextLimit),
            stream: runStreaming,
          };

        if (runStreaming) {
          const { ok, stream, text } = await proxyRequestStream('/api/chat/completions', config, chatBody, options, requestSignal, 'chat');
          if (!ok || !stream) {
            const errText = text || '';
            throw new Error(parseErrorDetail(errText) || `HTTP error`);
          }
          writeTextBot('', '');
          try {
            const fullText = await processChatStream(stream, (t) => writeBotText(t), requestSignal);
            setDebugRaw(fullText);
            setStatus('回复完成', 'ok');
          } catch (streamErr) {
            const errMsg = (streamErr as Error)?.message || '';
            if (errMsg === USER_ABORT_SENTINEL || requestSignal.aborted) {
              setStatus('已取消', 'warn');
              return;
            }
            throw streamErr;
          }
        } else {
          const result = await proxyRequest('/api/chat/completions', config, chatBody, options, 'chat', requestSignal);
          if (!result.ok) throw new Error(`HTTP ${result.status} ${parseErrorDetail(result.text)}`);
          const resp = JSON.parse(result.text);
          const content = resp.choices?.[0]?.message?.content || '';
          setDebugRaw(JSON.stringify(resp, null, 2));
          writeTextBot(content, JSON.stringify(resp, null, 2));
          setStatus('回复完成', 'ok');
        }
      }
      // ---- Text-to-image mode ----
      else if (requestMode === 'images') {
        const genBody: Record<string, unknown> = { model, prompt, n: 1, size: resolvedSize };
        applyExtraParams(genBody);

        if (runStreaming) {
          genBody.stream = true;
          genBody.partial_images = 2;
          const { ok, stream } = await proxyRequestStream('/api/images/generations', config, genBody, options, requestSignal);
          if (!ok || !stream) {
            delete genBody.stream;
            delete genBody.partial_images;
            const req = await tryWithRetry('/api/images/generations', genBody);
            if (!req.ok) throw new Error(`HTTP ${req.status} ${parseErrorDetail(req.text)}`);
            const resp = parseResponseBody(req.text);
            const hit = extractImage(resp);
            if (hit) {
              writeBotMsg([hit], JSON.stringify(resp, null, 2), '');
              setStatus('生成完成 1 张', 'ok');
              void saveHistoryEntry(prompt, mode, model, resolvedSize, [hit]);
            } else {
              writeBotMsg([], JSON.stringify(resp, null, 2), '响应中未找到图片');
              setStatus('未识别到图片内容', 'err');
            }
          } else {
            const hits: ImageHit[] = [];
            writeBotMsg([], '', '');
            let streamError: Error | null = null;
            let rawText = '';
            try {
              rawText = await processSSEStream(
                stream,
                (partial) => { hits[hits.length] = partial; writeBotImages([...hits], undefined); },
                (final) => { hits[hits.length > 0 ? hits.length - 1 : 0] = final; writeBotImages([...hits], undefined); },
                requestSignal,
              );
            } catch (e) {
              streamError = e as Error;
            }
            if (streamError?.message === USER_ABORT_SENTINEL || requestSignal.aborted) throw new Error(USER_ABORT_SENTINEL);
            if (hits.length === 0 && !streamError) {
              const fallback = extractImage(parseResponseBody(rawText));
              if (fallback) hits.push(fallback);
            }
            if (hits.length > 0) {
              writeBotImages(hits, JSON.stringify(hits[0], null, 2));
              setStatus(`生成完成 ${hits.length} 张`, 'ok');
              void saveHistoryEntry(prompt, mode, model, resolvedSize, hits);
            } else if (streamError) {
              delete genBody.stream;
              delete genBody.partial_images;
              const req = await tryWithRetry('/api/images/generations', genBody);
              if (!req.ok) throw new Error(`HTTP ${req.status} ${parseErrorDetail(req.text)}`);
              const resp = parseResponseBody(req.text);
              const hit = extractImage(resp);
              if (hit) {
                writeBotImages([hit], JSON.stringify(resp, null, 2));
                setStatus('生成完成 1 张', 'ok');
                void saveHistoryEntry(prompt, mode, model, resolvedSize, [hit]);
              } else {
                writeBotImages([], JSON.stringify(resp, null, 2));
                setStatus('未识别到图片内容', 'err');
              }
            } else {
              writeBotImages([], '流式响应未返回图片');
              setStatus('未识别到图片内容', 'err');
            }
          }
        } else {
          const hits: ImageHit[] = [];
          const errors: string[] = [];

          const limit = Math.min(5, Math.max(1, n));
          let cursor = 0;
          const worker = async () => {
            while (cursor < Math.max(1, n)) {
              const i = cursor++;
              if (i > 0) await abortableDelay(200, requestSignal);
              throwIfAborted(requestSignal);
              try {
                const req = await tryWithRetry('/api/images/generations', genBody);
                if (req.ok) {
                  const r = JSON.parse(req.text);
                  const hit = extractImage(r);
                  if (hit) hits.push(hit);
                } else {
                  errors.push(`HTTP ${req.status}: ${parseErrorDetail(req.text)}`);
                }
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
        restoreTargetMessage();
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
    }
  }, [
    activeSessionId,
    config,
    options,
    modelGateEnabled,
    images,
    selectedIndices,
    buildEditsForm,
    addBotMsg,
    addTextBotMsg,
    updateLastBotMsg,
    updateLastBotText,
    updateBotMsg,
    updateBotText,
    replaceBotMessage,
    addErrorMsg,
    addUserMsg,
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

  return (
    <ErrorBoundary>
    <div className="flex flex-col h-full overflow-hidden">
      <StatusBar />
      <MenuBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <main className="flex-1 flex flex-col overflow-hidden" role="main">
        {activeTab === 'decode' ? (
          <div id="tab-decode" role="tabpanel"><TabDecode /></div>
        ) : (
          <>
            <div id="tab-generate" role="tabpanel" className="flex-1 flex overflow-hidden">
              <div className="flex-1 flex flex-col overflow-hidden min-w-0">
                <ChatArea
                  onRegenerateMessage={handleRegenerateMessage}
                  pendingMessageId={pendingRegenerateMessageId}
                />
                {/* Mobile thumbnail strip rendered inline */}
                <div className="md:hidden"><ImageGrid /></div>
                <ChatInput
                  onSend={handleSend}
                  isLoading={isLoading}
                  onClearChat={clearChat}
                  onOpenSettings={() => setSettingsOpen(true)}
                  onCancel={handleCancel}
                />
              </div>
              <div className="hidden md:flex"><ImageGrid /></div>
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
    const storedHits = (await Promise.all(hits.map(imageHitToStoredUrl)))
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
