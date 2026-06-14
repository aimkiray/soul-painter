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
import { ImageHit } from '@/types';
import type { ChatMessage } from '@/contexts/ChatContext';
import {
  HISTORY_STORAGE_KEY,
  HISTORY_MAX,
  LAST_PROMPT_KEY,
} from '@/lib/constants';
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

type RequestBody = Record<string, unknown> | FormData;

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

async function processChatStream(
  stream: ReadableStream<Uint8Array>,
  onDelta: (text: string) => void,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

  while (true) {
    const { done, value } = await reader.read();
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

async function ensureModelGateAccess(requireVersionUnlock: boolean): Promise<void> {
  if (!requireVersionUnlock) return;

  const response = await fetch('/api/model-gate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: true }),
  });
  const data = await response.json().catch(() => null) as { unlocked?: boolean; message?: string } | null;
  if (data?.unlocked) return;

  throw new Error(`HTTP 418 ${data?.message || '模型访问未解锁'}`);
}

async function processSSEStream(
  stream: ReadableStream<Uint8Array>,
  onPartial: (img: ImageHit) => void,
  onComplete: (img: ImageHit) => void,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let rawText = '';

  while (true) {
    const { done, value } = await reader.read();
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
  return rawText;
}

// ── Component ──

function HomeInner() {
  const [activeTab, setActiveTab] = useState<'generate' | 'decode'>('generate');
  const [settingsOpen, setSettingsOpen] = useState(false);

  const { config, options } = useConfig();
  const { messages, addBotMsg, addErrorMsg, addUserMsg, addTextBotMsg, updateLastBotMsg, updateLastBotText, setLoading, setStatus, setDebugRaw, isLoading, clearChat } = useChat();
  const { images, editingIndex, selectedIndices, clearAll: clearImages, buildEditsForm, addFiles, closeEditor } = useImages();

  const [lastPrompt] = useState(() => {
    try { return localStorage.getItem(LAST_PROMPT_KEY) || ''; } catch { return ''; }
  });

  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

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
  const handleSend = useCallback(async (prompt: string) => {
    const model = config.model;
    const chatModel = config.chatModel;
    const requestedSize = config.size;
    const n = config.n;
    const quality = config.quality;
    const outFormat = config.format;
    const background = config.background;
    const moderation = config.moderation;
    const compression = config.compression;

    if (!prompt) return;

    // Save last prompt
    if (options.persistPrompt) {
      try { localStorage.setItem(LAST_PROMPT_KEY, prompt); } catch { /* ignore */ }
    }

    await ensureModelGateAccess(options.requireVersionUnlock);

    const isChatMode = config.mode === 'chat';
    // Only image mode may consume selected images; chat mode must stay text-only.
    const activeImages = !isChatMode && selectedIndices.size > 0
      ? images.filter((_, i) => selectedIndices.has(i))
      : [];
    const mode = isChatMode ? 'chat' : activeImages.length > 0 ? 'edits' : 'images';
    const resolvedSize = resolveRequestSize(requestedSize, activeImages);
    const sizeForBody = parseSize(resolvedSize) ? resolvedSize : null;

    addUserMsg(prompt);

    // Snapshot images before clearOnSubmit revokes objectUrls
    const imagesSnap = [...activeImages];

    if (options.clearOnSubmit) {
      clearImages();
    }

    setLoading(true);
    setStatus('请求发送中...');
    setDebugRaw('（尚未请求）');

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
      if (msg.includes('401')) return '\nAPI Key 无效或未配置，请在设置中填写或检查 .env';
      if (msg.includes('400')) return '\n请求参数有误，请检查 Base URL 格式';
      if (msg.includes('418')) return '';
      if (msg.includes('404') || msg.includes('405')) return '\n接口不存在，请确认 Base URL 是否支持 OpenAI 兼容 API';
      if (/5\d\d/.test(msg)) return '\n上游服务器错误，请稍后重试或检查服务状态';
      return '\n请检查 API Key 和 Base URL 配置';
    };

    const tryWithRetry = async (
      endpoint: string,
      body: unknown,
      retries = 0,
    ) => {
      let result = await proxyRequest(endpoint, config, body, options)
        .catch((e) => ({
          ok: false as const,
          status: 0,
          statusText: e.message,
          text: '',
        }));

      if (!result.ok && [0, 429, 502, 503, 504].includes(result.status) && retries < 2) {
        const delay = retries === 0 ? 4000 : 8000;
        setStatus(`上游限流，${delay / 1000}s 后重试 (${retries + 1}/2)...`);
        await new Promise((r) => setTimeout(r, delay));
        result = await proxyRequest(endpoint, config, body, options)
          .catch((e) => ({
            ok: false as const,
            status: 0,
            statusText: e.message,
            text: '',
          }));
        return result;
      }

      return result;
    };

    try {
      // ---- Image edits mode (single or multi) ----
      if (mode === 'edits') {
        const body = await buildEditsForm(imagesSnap, prompt, sizeForBody, model);
        applyExtraParams(body);

        if (options.streaming) {
          setRequestParam(body, 'stream', true);
          setRequestParam(body, 'partial_images', 2);
          const { ok, stream } = await proxyRequestStream('/api/images/edits', config, body, options);
          if (!ok || !stream) {
            deleteRequestParam(body, 'stream');
            deleteRequestParam(body, 'partial_images');
            const probe = await tryWithRetry('/api/images/edits', body);
            if (!probe.ok) throw new Error(`HTTP ${probe.status} ${parseErrorDetail(probe.text)}`);
            const resp = parseResponseBody(probe.text);
            const hit = extractImage(resp);
            if (hit) {
              addBotMsg([hit], JSON.stringify(resp, null, 2), '');
              setStatus('生成完成 1 张', 'ok');
              saveHistoryEntry(prompt, mode, model, resolvedSize, [hit]);
            } else {
              addBotMsg([], JSON.stringify(resp, null, 2), '响应中未找到图片');
              setStatus('未识别到图片内容', 'err');
            }
          } else {
            const hits: ImageHit[] = [];
            addBotMsg([], '', '');
            let streamError: Error | null = null;
            let rawText = '';
            try {
              rawText = await processSSEStream(
                stream,
                (partial) => { hits[hits.length] = partial; updateLastBotMsg([...hits]); },
                (final) => { hits[hits.length > 0 ? hits.length - 1 : 0] = final; updateLastBotMsg([...hits]); },
              );
            } catch (e) {
              streamError = e as Error;
            }
            if (hits.length === 0 && !streamError) {
              const fallback = extractImage(parseResponseBody(rawText));
              if (fallback) hits.push(fallback);
            }
            if (hits.length > 0) {
              updateLastBotMsg(hits, JSON.stringify(hits[0], null, 2));
              setStatus(`生成完成 ${hits.length} 张`, 'ok');
              saveHistoryEntry(prompt, mode, model, resolvedSize, hits);
            } else if (streamError) {
              deleteRequestParam(body, 'stream');
              deleteRequestParam(body, 'partial_images');
              const probe = await tryWithRetry('/api/images/edits', body);
              if (!probe.ok) throw new Error(`HTTP ${probe.status} ${parseErrorDetail(probe.text)}`);
              const resp = parseResponseBody(probe.text);
              const hit = extractImage(resp);
              if (hit) {
                updateLastBotMsg([hit], JSON.stringify(resp, null, 2));
                setStatus('生成完成 1 张', 'ok');
                saveHistoryEntry(prompt, mode, model, resolvedSize, [hit]);
              } else {
                updateLastBotMsg([], JSON.stringify(resp, null, 2));
                setStatus('未识别到图片内容', 'err');
              }
            } else {
              updateLastBotMsg([], '流式响应未返回图片');
              setStatus('未识别到图片内容', 'err');
            }
          }
        } else {
          const probe = await tryWithRetry('/api/images/edits', body);

          if (!probe.ok) {
            if ([404, 405, 501, 503].includes(probe.status)) {
              const chatBody = {
                model: chatModel,
                messages: [
                  ...(config.systemPrompt?.trim() ? [{ role: 'system' as const, content: config.systemPrompt.trim() }] : []),
                  ...imagesSnap.map(img => ({
                    role: 'user' as const,
                    content: [
                      { type: 'image_url' as const, image_url: img.objectUrl || '' },
                      { type: 'text' as const, text: prompt },
                    ],
                  })),
                ],
                stream: false,
              };
              const cr = await proxyRequest('/api/chat/completions', config, chatBody, options, 'chat');
              if (!cr.ok) throw new Error(`HTTP ${cr.status} ${parseErrorDetail(cr.text)}`);
              const resp = JSON.parse(cr.text);
              const content = resp.choices?.[0]?.message?.content || '';
              setDebugRaw(JSON.stringify(resp, null, 2));
              addTextBotMsg(content, JSON.stringify(resp, null, 2));
              setStatus('回复完成', 'ok');
            } else {
              throw new Error(`HTTP ${probe.status} ${parseErrorDetail(probe.text)}`);
            }
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
                    if (i > 0) await new Promise((r) => setTimeout(r, 200));
                    try {
                      const er = await tryWithRetry('/api/images/edits', body);
                      if (er.ok) {
                        const eh = extractImage(JSON.parse(er.text));
                        if (eh) hits.push(eh);
                      }
                    } catch { /* ignore */ }
                  }
                };
                await Promise.all(Array.from({ length: limit }, worker));
              }

              setDebugRaw(JSON.stringify(resp, null, 2));
              addBotMsg(hits, JSON.stringify(resp, null, 2), '');
              setStatus(`生成完成 ${hits.length} 张`, 'ok');
              saveHistoryEntry(prompt, mode, model, resolvedSize, hits);
            } else {
              addBotMsg([], JSON.stringify(resp, null, 2), '响应中未找到图片，请查看调试面板');
              setStatus('未识别到图片内容', 'err');
              setDebugRaw(JSON.stringify(resp, null, 2));
            }
          }
        }
      }
      // ---- Chat completions mode (explicit chat mode, no images) ----
      else if (config.mode === 'chat') {
          const chatBody = {
            model: chatModel,
            messages: buildChatMessages(messagesRef.current, prompt, config.systemPrompt || '', options.contextLimit),
            stream: options.streaming,
          };

        if (options.streaming) {
          abortRef.current = new AbortController();
          const { ok, stream, text } = await proxyRequestStream('/api/chat/completions', config, chatBody, options, abortRef.current.signal, 'chat');
          if (!ok || !stream) {
            const errText = text || '';
            throw new Error(parseErrorDetail(errText) || `HTTP error`);
          }
          addTextBotMsg('', '');
          try {
            const fullText = await processChatStream(stream, (t) => updateLastBotText(t));
            setDebugRaw(fullText);
            setStatus('回复完成', 'ok');
          } catch (streamErr) {
            const errMsg = (streamErr as Error)?.message || '';
            if (errMsg === USER_ABORT_SENTINEL || abortRef.current?.signal.aborted) {
              setStatus('已取消', 'warn');
              return;
            }
            throw streamErr;
          } finally {
            abortRef.current = null;
          }
        } else {
          const result = await proxyRequest('/api/chat/completions', config, chatBody, options, 'chat');
          if (!result.ok) throw new Error(`HTTP ${result.status} ${parseErrorDetail(result.text)}`);
          const resp = JSON.parse(result.text);
          const content = resp.choices?.[0]?.message?.content || '';
          setDebugRaw(JSON.stringify(resp, null, 2));
          addTextBotMsg(content, JSON.stringify(resp, null, 2));
          setStatus('回复完成', 'ok');
        }
      }
      // ---- Text-to-image mode ----
      else {
        const genBody: Record<string, unknown> = { model, prompt, n: 1, size: resolvedSize };
        applyExtraParams(genBody);

        if (options.streaming) {
          genBody.stream = true;
          genBody.partial_images = 2;
          const { ok, stream } = await proxyRequestStream('/api/images/generations', config, genBody, options);
          if (!ok || !stream) {
            delete genBody.stream;
            delete genBody.partial_images;
            const req = await tryWithRetry('/api/images/generations', genBody);
            if (!req.ok) throw new Error(`HTTP ${req.status} ${parseErrorDetail(req.text)}`);
            const resp = parseResponseBody(req.text);
            const hit = extractImage(resp);
            if (hit) {
              addBotMsg([hit], JSON.stringify(resp, null, 2), '');
              setStatus('生成完成 1 张', 'ok');
              saveHistoryEntry(prompt, mode, model, resolvedSize, [hit]);
            } else {
              addBotMsg([], JSON.stringify(resp, null, 2), '响应中未找到图片');
              setStatus('未识别到图片内容', 'err');
            }
          } else {
            const hits: ImageHit[] = [];
            addBotMsg([], '', '');
            let streamError: Error | null = null;
            let rawText = '';
            try {
              rawText = await processSSEStream(
                stream,
                (partial) => { hits[hits.length] = partial; updateLastBotMsg([...hits]); },
                (final) => { hits[hits.length > 0 ? hits.length - 1 : 0] = final; updateLastBotMsg([...hits]); },
              );
            } catch (e) {
              streamError = e as Error;
            }
            if (hits.length === 0 && !streamError) {
              const fallback = extractImage(parseResponseBody(rawText));
              if (fallback) hits.push(fallback);
            }
            if (hits.length > 0) {
              updateLastBotMsg(hits, JSON.stringify(hits[0], null, 2));
              setStatus(`生成完成 ${hits.length} 张`, 'ok');
              saveHistoryEntry(prompt, mode, model, resolvedSize, hits);
            } else if (streamError) {
              delete genBody.stream;
              delete genBody.partial_images;
              const req = await tryWithRetry('/api/images/generations', genBody);
              if (!req.ok) throw new Error(`HTTP ${req.status} ${parseErrorDetail(req.text)}`);
              const resp = parseResponseBody(req.text);
              const hit = extractImage(resp);
              if (hit) {
                updateLastBotMsg([hit], JSON.stringify(resp, null, 2));
                setStatus('生成完成 1 张', 'ok');
                saveHistoryEntry(prompt, mode, model, resolvedSize, [hit]);
              } else {
                updateLastBotMsg([], JSON.stringify(resp, null, 2));
                setStatus('未识别到图片内容', 'err');
              }
            } else {
              updateLastBotMsg([], '流式响应未返回图片');
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
              if (i > 0) await new Promise((r) => setTimeout(r, 200));
              try {
                const req = await tryWithRetry('/api/images/generations', genBody);
                if (req.ok) {
                  const r = JSON.parse(req.text);
                  const hit = extractImage(r);
                  if (hit) hits.push(hit);
                } else {
                  errors.push(`HTTP ${req.status}: ${parseErrorDetail(req.text)}`);
                }
              } catch (e) { errors.push((e as Error).message); }
            }
          };
          await Promise.all(Array.from({ length: limit }, worker));

          if (hits.length > 0) {
            const debugResp = JSON.stringify(hits[0], null, 2);
            setDebugRaw(debugResp);
            addBotMsg(hits, debugResp, '');
            setStatus(`生成完成 ${hits.length} 张`, 'ok');
            saveHistoryEntry(prompt, mode, model, resolvedSize, hits);
          } else {
            const debugResp = errors.join('\n') || '无响应';
            setDebugRaw(debugResp);
            const first = errors[0] || '';
            const gateMessage = extractModelGateMessage(first);
            if (gateMessage) {
              if (typeof window !== 'undefined') window.alert(gateMessage);
              addErrorMsg(gateMessage);
              setStatus('模型访问未解锁', 'warn');
            } else {
              addErrorMsg((first || '请求未返回图片') + buildErrorHint(first));
              setStatus('请求失败', 'err');
            }
          }
        }
      }
    } catch (e) {
      const msg = (e as Error).message || '请求失败';
      if (msg === USER_ABORT_SENTINEL) {
        setStatus('已取消', 'warn');
      } else if (extractModelGateMessage(msg)) {
        const gateMessage = extractModelGateMessage(msg)!;
        setDebugRaw(gateMessage);
        if (typeof window !== 'undefined') window.alert(gateMessage);
        addErrorMsg(gateMessage);
        setStatus('模型访问未解锁', 'warn');
      } else {
        setDebugRaw(msg);
        addErrorMsg(msg + buildErrorHint(msg));
        setStatus('请求失败', 'err');
      }
    } finally {
      abortRef.current = null;
      setLoading(false);
    }
  }, [config, options, images, selectedIndices, buildEditsForm, addBotMsg, addTextBotMsg, updateLastBotMsg, updateLastBotText, addErrorMsg, addUserMsg, setLoading, setStatus, setDebugRaw, clearImages]);

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
                <ChatArea />
                {/* Mobile thumbnail strip rendered inline */}
                <div className="md:hidden"><ImageGrid /></div>
                <ChatInput
                  onSend={handleSend}
                  isLoading={isLoading}
                  initialPrompt={lastPrompt}
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
function saveHistoryEntry(
  prompt: string,
  mode: string,
  model: string,
  size: string,
  hits: ImageHit[],
) {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    const entry = {
      prompt,
      mode,
      model,
      size,
      n: hits.length,
      hits: hits.map((h) => ({
        link: h.dataUrl || h.url || '',
        isData: !!(h.dataUrl),
      })),
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
