'use client';

import React, { useState, useEffect, useCallback } from 'react';
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
import SizeWarnModal from '@/components/SizeWarnModal';
import DebugPanel from '@/components/DebugPanel';
import Footer from '@/components/Footer';
import { extractImage } from '@/lib/image-extract';
import { proxyRequest } from '@/lib/api';
import { fileToDataUrl } from '@/lib/compress';
import { canvasHasStrokes, buildAlphaMaskBlob, buildMaskedComposite } from '@/lib/mask';
import { ImageHit } from '@/types';
import {
  HISTORY_STORAGE_KEY,
  HISTORY_MAX,
  LAST_PROMPT_KEY,
  MODEL_PRESETS,
} from '@/lib/constants';

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

function buildChatExtraInstr(quality: string, outFormat: string, compression: number, background: string, moderation: string): string {
  const parts: string[] = [];
  if (quality && quality !== 'auto') parts.push(`quality: ${quality}`);
  if (outFormat && outFormat !== 'png') parts.push(`output format: ${outFormat}`);
  if ((outFormat === 'jpeg' || outFormat === 'webp') && !isNaN(compression)) parts.push(`output compression: ${compression}`);
  if (background && background !== 'auto') parts.push(`background: ${background}`);
  if (moderation && moderation !== 'auto') parts.push(`moderation: ${moderation}`);
  return parts.length ? '\nImage generation parameters: ' + parts.join(', ') + '.' : '';
}

// ── Component ──

function HomeInner() {
  const [activeTab, setActiveTab] = useState<'generate' | 'decode'>('generate');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sizeWarnOpen, setSizeWarnOpen] = useState(false);
  const [warnSize, setWarnSize] = useState('');

  const { config, options, updateConfig } = useConfig();
  const { addBotMsg, addErrorMsg, addUserMsg, setLoading, setStatus, setDebugRaw, isLoading, clearChat, toggleDebug } = useChat();
  const { images, editingIndex, batchMode, selectedIndex, clearAll: clearImages, buildEditsForm, addFiles, closeEditor } = useImages();

  const [lastPrompt] = useState(() => {
    try { return localStorage.getItem(LAST_PROMPT_KEY) || ''; } catch { return ''; }
  });

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

  // Check size/model compatibility
  const checkSizeModel = useCallback((size: string, model: string) => {
    const m = /^(\d+)x(\d+)$/i.exec(size);
    if (!m) return false;
    const maxEdge = Math.max(+m[1], +m[2]);
    const tier = maxEdge >= 3000 ? '4k' : maxEdge >= 1600 ? '2k' : '1k';
    const needsPro = tier === '2k' || tier === '4k';
    if (needsPro && !/pro/i.test(model)) {
      setWarnSize(size);
      setSizeWarnOpen(true);
      return true;
    }
    return false;
  }, []);

  // Send handler - core logic
  const handleSend = useCallback(async (prompt: string) => {
    const baseUrl = config.baseUrl || '';
    const apiKey = config.apiKey || '';
    const model = config.model;
    const size = config.size;
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

    // When a specific image is selected, only process that one
    const activeImages = selectedIndex >= 0 && selectedIndex < images.length ? [images[selectedIndex]] : images;
    const mode = activeImages.length > 0 ? 'edits' : 'images';
    const sizeMatch = /^(\d+)x(\d+)$/i.exec(size);
    const sizeDirective = sizeMatch
      ? `Output the full edited image at exactly ${sizeMatch[1]}x${sizeMatch[2]} pixels.`
      : 'Output the full edited image, same dimensions as the input.';
    const sizeSuffix = sizeMatch ? ` At exactly ${sizeMatch[1]}x${sizeMatch[2]} pixels.` : '';
    const sizeForBody = sizeMatch ? size : null;
    const bypassEdits = /pro/i.test(model) && !!sizeMatch && Math.max(+sizeMatch[1], +sizeMatch[2]) >= 1600;

    // Warn on size/model mismatch
    if (checkSizeModel(size, model)) return;

    addUserMsg(prompt);

    // Snapshot images before clearOnSubmit revokes objectUrls
    const imagesSnap = [...activeImages];

    if (options.clearOnSubmit) {
      clearImages();
    }

    setLoading(true);
    setStatus('请求发送中...');
    setDebugRaw('（尚未请求）');

    const applyExtraParams = (target: Record<string, unknown>, isFormData: boolean) => {
      const add = (k: string, v: unknown) => {
        if (isFormData && target instanceof FormData) {
          (target as FormData).append(k, String(v));
        } else {
          target[k] = v;
        }
      };
      if (quality && quality !== 'auto') add('quality', quality);
      if (background && background !== 'auto') add('background', background);
      if (outFormat && outFormat !== 'png') add('output_format', outFormat);
      if ((outFormat === 'jpeg' || outFormat === 'webp') && !isNaN(compression)) add('output_compression', compression);
      if (moderation && moderation !== 'auto') add('moderation', moderation);
    };

    const tryWithRetry = async (
      endpoint: string,
      body: unknown,
      multipart: boolean,
      retries = 0,
    ) => {
      const isPro = /pro/i.test(model) || bypassEdits;

      let result = await proxyRequest(endpoint, config, body, options, multipart)
        .catch((e) => ({
          ok: false as const,
          status: 0,
          statusText: e.message,
          text: '',
        }));

      if (isPro && !result.ok && [0, 429, 502, 503, 504].includes(result.status) && retries < 2) {
        const delay = retries === 0 ? 4000 : 8000;
        setStatus(`上游限流，${delay / 1000}s 后重试 (${retries + 1}/2)...`);
        await new Promise((r) => setTimeout(r, delay));
        result = await proxyRequest(endpoint, config, body, options, multipart)
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
      // ---- Single image edits mode ----
      if (mode === 'edits' && imagesSnap.length === 1 && !batchMode) {
        const im = imagesSnap[0];
        const masked = im.maskCanvas ? canvasHasStrokes(im.maskCanvas) : false;

        // Build edits form
        const fd = await buildEditsForm(im, prompt, sizeForBody, model);
        applyExtraParams(fd as unknown as Record<string, unknown>, true);

        // Build fallback chat content
        const dataUrl = await fileToDataUrl(im.file);
        const chatInstr = buildChatExtraInstr(quality, outFormat, compression, background, moderation);
        const header = masked
          ? `You are given two attached images: the FIRST is the original; the SECOND is the same image with a semi-transparent red overlay marking the ONLY region you may modify. Treat the red overlay as an instruction, NOT as image content. Modify ONLY pixels inside the red region; every pixel outside must remain pixel-identical to the original. ${sizeDirective}${chatInstr}\n\nInstruction:\n${prompt}`
          : `Edit the attached image as described. ${sizeDirective}${chatInstr}\n\nInstruction:\n${prompt}`;
        const chatContent: { type: string; text?: string; image_url?: { url: string } }[] = [
          { type: 'text', text: header },
          { type: 'image_url', image_url: { url: dataUrl } },
        ];
        if (masked && im.maskCanvas) {
          const maskedUrl = await buildMaskedComposite({
            objectUrl: im.objectUrl,
            naturalWidth: im.naturalWidth,
            naturalHeight: im.naturalHeight,
            mask: im.maskCanvas,
          });
          chatContent.push({ type: 'image_url', image_url: { url: maskedUrl } });
        }

        const editsEp = { endpoint: '/api/images/edits', body: fd, multipart: true };
        const chatEp = {
          endpoint: '/api/chat/completions',
          body: { model, messages: [{ role: 'user', content: chatContent }] },
          multipart: false,
        };

        const primary = bypassEdits ? chatEp : editsEp;
        const fallback = bypassEdits ? null : chatEp;

        let probe = await tryWithRetry(primary.endpoint, primary.body, primary.multipart);
        let usedFallback = false;

        if (!probe.ok && fallback && [0, 404, 405, 501, 503].includes(probe.status)) {
          usedFallback = true;
          probe = await tryWithRetry(fallback.endpoint, fallback.body, fallback.multipart);
        }

        if (!probe.ok) {
          throw new Error(`HTTP ${probe.status} ${parseErrorDetail(probe.text)}`);
        }

        const resp = parseResponseBody(probe.text);
        const hit = extractImage(resp);
        if (hit) {
          const hits: ImageHit[] = [hit];
          const extra = usedFallback ? '已切换到 chat/completions 路径' : '';

          // Fan out N-1 more requests (concurrency limited)
          if (n > 1 && !batchMode) {
            const chosenEp = usedFallback ? fallback! : primary;
            const limit = Math.min(5, n - 1);
            let cursor = 0;
            const worker = async () => {
              while (cursor < n - 1) {
                const i = cursor++;
                if (i > 0) await new Promise((r) => setTimeout(r, 200));
                try {
                  const er = await tryWithRetry(chosenEp.endpoint, chosenEp.body, chosenEp.multipart);
                  if (er.ok) {
                    const erps = JSON.parse(er.text);
                    const eh = extractImage(erps);
                    if (eh) hits.push(eh);
                  }
                } catch { /* ignore */ }
              }
            };
            await Promise.all(Array.from({ length: limit }, worker));
          }

          setDebugRaw(JSON.stringify(resp, null, 2));
          addBotMsg(hits, JSON.stringify(resp, null, 2), extra);
          setStatus(`生成完成 ${hits.length} 张`, 'ok');
          saveHistoryEntry(prompt, mode, model, size, hits);
        } else {
          addBotMsg([], JSON.stringify(resp, null, 2), '响应中未找到图片，请查看调试面板');
          setStatus('未识别到图片内容', 'err');
          setDebugRaw(JSON.stringify(resp, null, 2));
        }
      }
      // ---- Multi-image or batch mode ----
      else if (mode === 'edits' && imagesSnap.length >= 2 && batchMode) {
        // Batch mode: each image = independent request
        const total = imagesSnap.length;
        const hits: ImageHit[] = [];
        const results: { hit: ImageHit | null; resp: unknown; err: string | null }[] = [];
        let done = 0;
        let failed = 0;

        const CONCURRENCY = Math.min(5, total);

        const runOne = async (idx: number) => {
          const im = imagesSnap[idx];
          try {
            const masked = im.maskCanvas ? canvasHasStrokes(im.maskCanvas) : false;
            const fd = await buildEditsForm(im, prompt, sizeForBody, model);
            applyExtraParams(fd as unknown as Record<string, unknown>, true);

            const dataUrl = await fileToDataUrl(im.file);
            const chatInstr = buildChatExtraInstr(quality, outFormat, compression, background, moderation);
            const header = masked
              ? `You are given two attached images: the FIRST is the original; the SECOND is the same image with a semi-transparent red overlay marking the ONLY region you may modify. Treat the red overlay as an instruction, NOT as image content. Modify ONLY pixels inside the red region; every pixel outside must remain pixel-identical to the original. ${sizeDirective}${chatInstr}\n\nInstruction:\n${prompt}`
              : `Edit the attached image as described. ${sizeDirective}${chatInstr}\n\nInstruction:\n${prompt}`;
            const chatContent: { type: string; text?: string; image_url?: { url: string } }[] = [
              { type: 'text', text: header },
              { type: 'image_url', image_url: { url: dataUrl } },
            ];
            if (masked && im.maskCanvas) {
              const maskedUrl = await buildMaskedComposite({
                objectUrl: im.objectUrl,
                naturalWidth: im.naturalWidth,
                naturalHeight: im.naturalHeight,
                mask: im.maskCanvas,
              });
              chatContent.push({ type: 'image_url', image_url: { url: maskedUrl } });
            }

            const editsEp = { endpoint: '/api/images/edits', body: fd, multipart: true };
            const chatEp = {
              endpoint: '/api/chat/completions',
              body: { model, messages: [{ role: 'user', content: chatContent }] },
              multipart: false,
            };

            const effBypass = /pro/i.test(model) && !!sizeMatch && Math.max(+sizeMatch[1], +sizeMatch[2]) >= 1600;
            const primary = effBypass ? chatEp : editsEp;
            const fallback = effBypass ? null : chatEp;

            let probe = await tryWithRetry(primary.endpoint, primary.body, primary.multipart);

            if (!probe.ok && fallback && [0, 404, 405, 501, 503].includes(probe.status)) {
              probe = await tryWithRetry(fallback.endpoint, fallback.body, fallback.multipart);
            }

            if (!probe.ok) {
              results[idx] = { hit: null, resp: null, err: `#${idx + 1}: HTTP ${probe.status} ${parseErrorDetail(probe.text)}` };
              failed++;
            } else {
              const resp = parseResponseBody(probe.text);
              const hit = extractImage(resp);
              if (hit) {
                hits.push(hit);
                results[idx] = { hit, resp, err: null };
              } else {
                results[idx] = { hit: null, resp, err: `#${idx + 1}: 未识别到图片` };
                failed++;
              }
            }
          } catch (e) {
            results[idx] = { hit: null, resp: null, err: `#${idx + 1}: ${(e as Error).message}` };
            failed++;
          } finally {
            done++;
            setStatus(`批处理 ${done}/${total}` + (failed ? ` · 失败 ${failed}` : ''));
          }
        };

        // Execute with concurrency limit
        let cursor = 0;
        const worker = async () => {
          while (cursor < total) {
            const i = cursor++;
            await runOne(i);
          }
        };
        await Promise.all(Array.from({ length: CONCURRENCY }, worker));

        const allResps = results.map((r) => r.resp).filter(Boolean);
        setDebugRaw(allResps.length > 0 ? JSON.stringify(allResps[0], null, 2) : '无响应');

        if (hits.length > 0) {
          addBotMsg(hits, allResps.length > 0 ? JSON.stringify(allResps[0], null, 2) : '', `批处理完成 ${hits.length}/${total} · 失败 ${failed}`);
          setStatus(`批处理 ${hits.length}/${total} 完成`, failed > 0 ? 'err' : 'ok');
          saveHistoryEntry(prompt, mode, model, size, hits);
        } else {
          const errStr = results.map((r) => r.err).filter(Boolean).join('\n');
          addErrorMsg(errStr || '所有请求均失败');
          setStatus('批处理全部失败', 'err');
        }
      }
      // ---- Multi-image chat mode (no batch) ----
      else if (mode === 'edits' && imagesSnap.length >= 2) {
        const anyMasked = imagesSnap.some((im) => im.maskCanvas && canvasHasStrokes(im.maskCanvas));
        const chatInstr = buildChatExtraInstr(quality, outFormat, compression, background, moderation);
        const header = anyMasked
          ? `Attached are ${imagesSnap.length} reference image(s). For any image IMMEDIATELY FOLLOWED BY a duplicate with a semi-transparent red overlay, the red overlay marks the ONLY region to edit. Modify ONLY pixels inside the red region. ${sizeSuffix}${chatInstr}\n\nInstruction:\n${prompt}`
          : `Attached are ${imagesSnap.length} reference images. Output ONE image per the instruction. ${sizeSuffix}${chatInstr}\n\nInstruction:\n${prompt}`;

        const chatContent: { type: string; text?: string; image_url?: { url: string } }[] = [
          { type: 'text', text: header },
        ];
        for (const im of imagesSnap) {
          const dataUrl = await fileToDataUrl(im.file);
          chatContent.push({ type: 'image_url', image_url: { url: dataUrl } });
          if (im.maskCanvas && canvasHasStrokes(im.maskCanvas)) {
            const maskedUrl = await buildMaskedComposite({
              objectUrl: im.objectUrl,
              naturalWidth: im.naturalWidth,
              naturalHeight: im.naturalHeight,
              mask: im.maskCanvas,
            });
            chatContent.push({ type: 'image_url', image_url: { url: maskedUrl } });
          }
        }

        const probe = await tryWithRetry(
          '/api/chat/completions',
          { model, messages: [{ role: 'user', content: chatContent }] },
          false,
        );

        if (!probe.ok) {
          throw new Error(`HTTP ${probe.status} ${parseErrorDetail(probe.text)}`);
        }

        const resp = parseResponseBody(probe.text);
        const hit = extractImage(resp);
        setDebugRaw(JSON.stringify(resp, null, 2));

        if (hit) {
          addBotMsg([hit], JSON.stringify(resp, null, 2), '');
          setStatus('生成完成', 'ok');
          saveHistoryEntry(prompt, mode, model, size, [hit]);
        } else {
          addBotMsg([], JSON.stringify(resp, null, 2), '响应中未找到图片');
          setStatus('未识别到图片内容', 'err');
        }
      }
      // ---- Text-to-image mode ----
      else {
        const genBody: Record<string, unknown> = { model, prompt, n: 1, size, response_format: 'url' };
        applyExtraParams(genBody, false);

        const hits: ImageHit[] = [];
        const errors: string[] = [];

        const limit = Math.min(5, Math.max(1, n));
        let cursor = 0;
        const worker = async () => {
          while (cursor < Math.max(1, n)) {
            const i = cursor++;
            if (i > 0) await new Promise((r) => setTimeout(r, 200));
            try {
              const req = await tryWithRetry('/api/images/generations', genBody, false);
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
          saveHistoryEntry(prompt, mode, model, size, hits);
        } else {
          const debugResp = errors.join('\n') || '无响应';
          setDebugRaw(debugResp);
          const first = errors[0] || '';
          let hint = '';
          if (first.includes('401')) hint = '\nAPI Key 无效或未配置，请在设置中填写或检查 .env';
          else if (first.includes('400')) hint = '\n请求参数有误，请检查 Base URL 格式';
          else if (first.includes('404') || first.includes('405')) hint = '\n接口不存在，请确认 Base URL 是否支持 OpenAI 兼容 API';
          else if (/5\d\d/.test(first)) hint = '\n上游服务器错误，请稍后重试或检查服务状态';
          else hint = '\n请检查 API Key 和 Base URL 配置';
          addErrorMsg((first || '请求未返回图片') + hint);
          setStatus('请求失败', 'err');
        }
        }
      } catch (e) {
      const msg = (e as Error).message || '请求失败';
      setDebugRaw(msg);
      let hint = '';
      if (msg.includes('401')) hint = '\nAPI Key 无效或未配置，请在设置中填写或检查 .env';
      else if (msg.includes('400')) hint = '\n请求参数有误，请检查 Base URL 格式';
      else if (msg.includes('404') || msg.includes('405')) hint = '\n接口不存在，请确认 Base URL 是否支持 OpenAI 兼容 API';
      else if (/5\d\d/.test(msg)) hint = '\n上游服务器错误，请稍后重试或检查服务状态';
      else hint = '\n请检查 API Key 和 Base URL 配置';
      addErrorMsg(msg + hint);
      setStatus('请求失败', 'err');
    } finally {
      setLoading(false);
    }
  }, [config, options, images, batchMode, buildEditsForm, addBotMsg, addErrorMsg, addUserMsg, setLoading, setStatus, setDebugRaw, checkSizeModel, clearImages]);

  return (
    <ErrorBoundary>
    <div className="flex flex-col h-full overflow-hidden">
      <StatusBar />
      <MenuBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onOpenSettings={() => setSettingsOpen(true)}
        onToggleDebug={toggleDebug}
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

      <SizeWarnModal
        open={sizeWarnOpen}
        size={warnSize}
        onClose={() => setSizeWarnOpen(false)}
        onSwitch={() => {
          setSizeWarnOpen(false);
          updateConfig('model', MODEL_PRESETS.find(m => /pro/i.test(m.value))?.value || 'gpt-image-2-pro');
        }}
      />

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
