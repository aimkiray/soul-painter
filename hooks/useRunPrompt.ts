import { useState, useCallback, useRef, useEffect } from 'react';
import { useConfig } from '@/contexts/ConfigContext';
import { useChat } from '@/contexts/ChatContext';
import { useImages } from '@/contexts/ImageContext';
import { extractImage } from '@/lib/image-extract';
import { proxyRequest, proxyRequestStream, USER_ABORT_SENTINEL } from '@/lib/api';
import { ImageHit, ImageRef } from '@/types';
import type { ChatMessage, ChatReferenceImage, ChatTurnSnapshot } from '@/contexts/ChatContext';
import { chatSessionPromptStorageKey } from '@/lib/constants';
import { parseSize, resolveRequestSize } from '@/lib/size';
import { getChatProviderConfig } from '@/lib/chat-config';
import type { ChatContentParts } from '@/lib/chat-thinking';
import {
  parseResponseBody,
  parseStreamResponseBody,
  extractModelGateMessage,
  buildRepeaterReply,
  extractChatResponseParts,
  extractChatResponseText,
  buildChatMessages,
  normalizeGeneratedTitle,
} from '@/lib/api-parsers';
import { processChatStream, processSSEStream } from '@/lib/stream-utils';
import {
  getImageStreamCapabilityKey,
  getImageStreamCapability,
  setImageStreamCapability,
  createImageStreamAttempt,
} from '@/lib/image-stream-capability';
import {
  type RequestBody,
  setRequestParam,
  deleteRequestParam,
  getFormImageCount,
  throwIfAborted,
  abortableDelay,
  REQUEST_MAX_ATTEMPTS,
  REQUEST_RETRY_DELAYS_MS,
  RequestStatusError,
  RequestAttemptsExhaustedError,
  errorMessage,
  errorStatus,
  isRetryableRequestError,
} from '@/lib/request-helpers';
import {
  type RunMode,
  imageRefToReferenceImage,
  buildEditsFormFromReferences,
  createTurnSnapshot,
  ensureModelGateAccess,
} from '@/lib/image-ref-utils';
import { saveHistoryEntry } from '@/lib/storage/history';

export interface PromptRunOptions {
  existingUserMessageId?: string;
  targetBotMessageId?: string;
  historyMessages?: ChatMessage[];
  requestSnapshot?: ChatTurnSnapshot;
}

export function useRunPrompt() {
  const [pendingRegenerateMessageId, setPendingRegenerateMessageId] = useState<string | null>(null);

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
  const { images, selectedIndices, clearAll: clearImages, buildEditsForm } = useImages();

  const abortRef = useRef<AbortController | null>(null);
  const promptRunActiveRef = useRef(false);
  const sessionsRef = useRef(sessions);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);

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
    const writeTextBot = (text: string, code: string, thinking?: string, thinkingDone?: boolean) => {
      if (targetBotMessageId && !text && !code && !thinking) return;
      if (targetBotMessageId) {
        replaceBotMessage(targetBotMessageId, { prompt: '', images: [], text, thinking, thinkingDone, code, extra: '' }, sessionId);
      } else {
        addTextBotMsg(text, code, sessionId, thinking, thinkingDone);
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
    const writePlaceholderText = (parts: ChatContentParts) => {
      ensureBotPlaceholder();
      if (botPlaceholderIdRef.current) {
        updateBotText(botPlaceholderIdRef.current, parts.text, sessionId, parts.thinking, parts.thinkingDone);
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
                content: 'Summarize this conversation into a concise Chinese chat title. Return only the final title text. Do not include quotes, punctuation at the end, explanations, markdown, XML tags, or thinking/reasoning content. Keep it under 12 Chinese characters or 6 English words.',
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
        if ((await getImageStreamCapability(capabilityKey)) === 'unsupported') {
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
          await setImageStreamCapability(capabilityKey, 'supported');
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
        if (fallback.hit) await setImageStreamCapability(capabilityKey, 'unsupported');
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
          const responseParts = await retryable('聊天请求', async () => {
            writePlaceholderText({ text: '', thinking: '', thinkingDone: true });
            const result = await proxyRequestStream('/api/chat/completions', chatRequestConfig, chatBody, options, requestSignal, 'chat');
            throwIfAborted(requestSignal);
            if (!result.ok || !result.stream) {
              throw new RequestStatusError({
                status: result.status,
                statusText: '',
                text: result.text || '流式请求失败',
              });
            }
            const parts = await processChatStream(result.stream, (nextParts) => writePlaceholderText(nextParts), chatApiFormat, requestSignal);
            if (!parts.text.trim() && !parts.thinking.trim()) throw new Error('响应为空');
            writePlaceholderText({ ...parts, thinkingDone: true });
            return { ...parts, thinkingDone: true };
          });
          setStatus('回复完成', 'ok');
          scheduleTitleGeneration(responseParts.text || responseParts.thinking);
        } else {
          const result = await retryable('聊天请求', async () => {
            const response = await proxyRequest('/api/chat/completions', chatRequestConfig, chatBody, options, 'chat', requestSignal);
            throwIfAborted(requestSignal);
            if (!response.ok) throw new RequestStatusError(response);
            return response;
          });
          const resp = JSON.parse(result.text);
          const parts = extractChatResponseParts(resp, chatApiFormat);
          if (!parts.text.trim() && !parts.thinking.trim()) throw new Error('响应为空');
          writeTextBot(parts.text, '', parts.thinking, true);
          setStatus('回复完成', 'ok');
          scheduleTitleGeneration(parts.text || parts.thinking);
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

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

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

  return {
    handleSend,
    handleRegenerateMessage,
    handleEditMessage,
    handleCancel,
    pendingRegenerateMessageId,
  };
}
