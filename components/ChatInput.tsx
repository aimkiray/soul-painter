'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useConfig } from '@/contexts/ConfigContext';
import { useChat } from '@/contexts/ChatContext';
import { useI18n } from '@/contexts/I18nContext';
import { useImages } from '@/contexts/ImageContext';
import { localizeSizeLabel } from '@/lib/i18n';
import { IMAGE_MODEL_PRESETS, CHAT_EFFORT_OPTIONS, chatSessionPromptStorageKey, ORIGINAL_ASPECT_SIZE, REPEATER_MODEL_LABEL, SIZE_PRESETS } from '@/lib/constants';
import { COMPOSER_FRAME_CLASS } from '@/lib/layout';
import { isLocalDataCleared } from '@/lib/local-data-cleared';
import { mergeModelOptions } from '@/lib/model-options';
import { CUSTOM_SIZE_PATTERN, formatSizeDisplay } from '@/lib/size';
import MenuSelect, { type MenuSelectGroup } from '@/components/MenuSelect';
import {
  encodeChatModelChoice,
  getActiveChatModel,
  getAllChatModelOptions,
  getChatFormatForModel,
  getClaudeChatModelOptions,
  getOpenAIChatModelOptions,
  parseChatModelChoice,
} from '@/lib/chat-config';

interface ChatInputProps {
  onSend: (prompt: string) => Promise<void> | void;
  isLoading: boolean;
  onCancel?: () => void;
}

function readStoredPrompt(sessionId: string) {
  try {
    return localStorage.getItem(chatSessionPromptStorageKey(sessionId)) || '';
  } catch {
    return '';
  }
}

export default function ChatInput({ onSend, isLoading, onCancel }: ChatInputProps) {
  const { config, updateConfig, options, modelGateEnabled, modelGateUnlocked } = useConfig();
  const { lang, t } = useI18n();
  // Drafts live in ChatContext so they survive tab switches / remounts.
  const { activeSessionId, promptDrafts, setPromptDraft } = useChat();
  const { images, hasImages, selectedIndices, addFiles } = useImages();
  const [customSize, setCustomSize] = useState(false);
  const [sizeInvalid, setSizeInvalid] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const submitLockRef = useRef(false);
  const prompt = promptDrafts[activeSessionId] ?? '';
  const promptDraftsRef = useRef(promptDrafts);
  useEffect(() => { promptDraftsRef.current = promptDrafts; }, [promptDrafts]);
  const setPrompt = (nextPrompt: string) => setPromptDraft(activeSessionId, nextPrompt);

  useEffect(() => {
    if (!options.persistPrompt) return;
    const timeoutId = window.setTimeout(() => {
      if (promptDraftsRef.current[activeSessionId] !== undefined) return;
      const storedPrompt = readStoredPrompt(activeSessionId);
      if (storedPrompt) setPromptDraft(activeSessionId, storedPrompt);
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [activeSessionId, options.persistPrompt, setPromptDraft]);

  // Auto-save prompt while typing (debounced, only if persistPrompt enabled)
  useEffect(() => {
    if (!options.persistPrompt || isLocalDataCleared()) return;
    const timer = setTimeout(() => {
      if (isLocalDataCleared()) return;
      try { localStorage.setItem(chatSessionPromptStorageKey(activeSessionId), prompt); } catch { /* ignore */ }
    }, 500);
    return () => clearTimeout(timer);
  }, [prompt, options.persistPrompt, activeSessionId]);

  // F1 → settings is handled by a page-level listener (app/page.tsx) so it
  // keeps working even when this component is unmounted.
  const busy = isLoading;
  const send = () => {
    const nextPrompt = prompt.trim();
    if (!nextPrompt || busy || submitLockRef.current) return;
    submitLockRef.current = true;
    // Clear the draft + stored copy up front so a slow onSend can't resurrect it.
    setPrompt('');
    try { localStorage.removeItem(chatSessionPromptStorageKey(activeSessionId)); } catch { /* ignore */ }
    try {
      void Promise.resolve(onSend(nextPrompt))
        .catch(() => undefined)
        .finally(() => { submitLockRef.current = false; });
    } catch {
      submitLockRef.current = false;
    }
  };
  const kd = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      send();
    } else if (e.key === 'Enter' && !e.shiftKey && !e.repeat) {
      if (busy || submitLockRef.current) return;
      e.preventDefault();
      send();
    }
  };
  const imageModeActive = config.mode === 'image';
  const lockedRepeaterMode = modelGateEnabled && !modelGateUnlocked;
  const imageModelOptions = mergeModelOptions(IMAGE_MODEL_PRESETS, config.customImageModels);
  const openAIChatModelOptions = getOpenAIChatModelOptions(config);
  const claudeChatModelOptions = getClaudeChatModelOptions(config);
  const allChatModelOptions = getAllChatModelOptions(config);
  const imageModelIsOption = imageModelOptions.some(m => m.value === config.model);
  const activeChatModel = getActiveChatModel(config);
  const activeChatFormat = getChatFormatForModel(config, activeChatModel);
  const activeChatChoice = encodeChatModelChoice(activeChatFormat, activeChatModel);
  const chatModelIsOption = allChatModelOptions.some(m => m.format === activeChatFormat && m.value === activeChatModel);
  const sizeIsPreset = SIZE_PRESETS.some(s => s.value === config.size);
  const activeImages = selectedIndices.size > 0
    ? images.filter((_, i) => selectedIndices.has(i))
    : [];
  const originalAspectLabel = formatSizeDisplay(ORIGINAL_ASPECT_SIZE, activeImages);
  const imageModelGroups: MenuSelectGroup[] = [{
    options: [
      ...(imageModelIsOption ? [] : [{ value: config.model, label: config.model }]),
      ...imageModelOptions.map(m => ({ value: m.value, label: m.label })),
    ],
  }];
  const sizeGroups: MenuSelectGroup[] = [
    ...(['AUTO', '1K', '2K', '4K'] as const).map(group => ({
      label: group,
      options: SIZE_PRESETS.filter(s => s.group === group).map(s => ({
        value: s.value,
        label: s.value === ORIGINAL_ASPECT_SIZE ? localizeSizeLabel(lang, originalAspectLabel) : localizeSizeLabel(lang, s.label),
      })),
    })),
    { options: [{ value: '__custom__', label: t('customSize') }] },
  ];
  const chatModelGroups: MenuSelectGroup[] = [
    {
      options: chatModelIsOption ? [] : [{ value: activeChatChoice, label: activeChatModel }],
    },
    {
      label: 'OpenAI Compatible',
      options: openAIChatModelOptions.map(m => ({ value: encodeChatModelChoice('openai', m.value), label: m.label })),
    },
    {
      label: 'Claude Compatible',
      options: claudeChatModelOptions.map(m => ({ value: encodeChatModelChoice('claude', m.value), label: m.label })),
    },
  ].filter(group => group.options.length > 0);
  const gatedGroup: MenuSelectGroup[] = [{ options: [{ value: '__gated__', label: `${REPEATER_MODEL_LABEL} · gated` }] }];
  const effortGroups: MenuSelectGroup[] = [{
    options: CHAT_EFFORT_OPTIONS.map((effort) => ({ value: effort, label: effort })),
  }];
  const placeholderText = config.mode === 'chat'
    ? t('phChat')
    : hasImages ? t('phRefEdit') : t('phGenerate');
  const selectChatModel = (value: string) => {
    const choice = parseChatModelChoice(value);
    if (!choice) return;
    updateConfig('chatApiFormat', choice.format);
    updateConfig('chatModel', choice.model);
    if (choice.format === 'claude') updateConfig('claudeModel', choice.model);
  };

  return (
    <div className={`${COMPOSER_FRAME_CLASS} flex min-h-0 shrink flex-col pb-8`}>
      <div className="w-full py-6">
        {/* -mx-2 bleeds the scroller past its padding so the ring-1 hairlines
            have room to paint, while controls still land flush with the
            input row below (px-2 cancels the bleed). */}
        <div className="scroll-fade-x -mx-2 flex flex-wrap items-center gap-8 overflow-x-auto overflow-y-hidden px-2 py-2 sm:flex-nowrap">
            <div
              className="grid h-32 w-128 shrink-0 grid-cols-2 overflow-hidden bg-theme-bg ring-1 ring-theme-fg/30"
              role="radiogroup"
              aria-label={t('genMode')}
            >
              {([
                ['image', 'IMG'],
                ['chat', 'CHAT'],
              ] as const).map(([mode, label]) => {
                const active = config.mode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => updateConfig('mode', mode)}
                    className={[
                      'flex h-full min-w-0 cursor-pointer items-center justify-center gap-4 whitespace-nowrap px-4 font-mono text-body-10 uppercase',
                      active
                        ? 'bg-theme-fg text-theme-bg'
                        : 'text-theme-muted hover:bg-theme-fg/10 hover:text-theme-fg',
                    ].filter(Boolean).join(' ')}
                  >
                    <span className="w-20 shrink-0 whitespace-nowrap text-left tabular-nums" aria-hidden="true">
                      {active ? '[x]' : '[ ]'}
                    </span>
                    {label}
                  </button>
                );
              })}
            </div>
            {imageModeActive ? (
              <>
                <MenuSelect
                  ariaLabel={t('imageModel')}
                  value={lockedRepeaterMode ? '__gated__' : config.model}
                  groups={lockedRepeaterMode ? gatedGroup : imageModelGroups}
                  onSelect={(v) => updateConfig('model', v)}
                  disabled={lockedRepeaterMode}
                  openUp
                  className="min-w-100 flex-1 sm:flex-[0.7]"
                />
                <MenuSelect
                  ariaLabel={t('imageSize')}
                  value={(customSize || !sizeIsPreset) ? '__custom__' : config.size}
                  groups={sizeGroups}
                  onSelect={(v) => {
                    if (v === '__custom__') setCustomSize(true);
                    else { setCustomSize(false); setSizeInvalid(false); updateConfig('size', v); }
                  }}
                  openUp
                  className="min-w-[calc(50%-4px)] flex-1 sm:min-w-120"
                />
                {(customSize || !sizeIsPreset) && (
                  // Wrap in a MenuSelect-shaped flex item so the input sizes
                  // exactly like the selects beside it (bare inputs grow wider).
                  <div className="relative min-w-[calc(50%-4px)] flex-1 sm:min-w-120">
                    <input
                      type="text"
                      value={config.size}
                      onChange={e=>{updateConfig('size',e.target.value);setSizeInvalid(false)}}
                      onBlur={e=>setSizeInvalid(!CUSTOM_SIZE_PATTERN.test(e.target.value.trim()))}
                      onKeyDown={e=>{if(e.nativeEvent.isComposing)return;if(e.key==='Enter'){e.preventDefault();setSizeInvalid(!CUSTOM_SIZE_PATTERN.test(e.currentTarget.value.trim()));e.currentTarget.blur()}}}
                      placeholder="WxH"
                      aria-label={t('customSizeAria')}
                      title={sizeInvalid ? t('sizeFormatHint') : undefined}
                      aria-invalid={sizeInvalid || undefined}
                      className={`h-32 w-full bg-theme-bg px-8 font-mono text-body-14 text-theme-fg outline-none ring-1 ${sizeInvalid ? 'ring-error' : 'ring-theme-fg/30 focus:ring-theme-fg'}`}
                    />
                  </div>
                )}
              </>
            ) : (
              <>
                <MenuSelect
                  ariaLabel={t('chatModel')}
                  value={lockedRepeaterMode ? '__gated__' : activeChatChoice}
                  groups={lockedRepeaterMode ? gatedGroup : chatModelGroups}
                  onSelect={selectChatModel}
                  disabled={lockedRepeaterMode}
                  openUp
                  className="min-w-160 flex-1"
                />
                <MenuSelect
                  ariaLabel={t('effortLevel')}
                  value={config.chatEffort}
                  groups={effortGroups}
                  onSelect={(v) => updateConfig('chatEffort', v)}
                  disabled={lockedRepeaterMode || activeChatFormat === 'claude'}
                  openUp
                  className="min-w-[calc(50%-4px)] flex-1 sm:min-w-100 sm:flex-[0.5]"
                />
              </>
            )}
        </div>
      </div>

      <div className="flex w-full shrink-0 items-stretch gap-8">
        {/* Auto-growing field: the invisible sizer span drives the grid row
            height; the textarea overlays it and scrolls past the ~10-line cap. */}
        <div className="grid min-w-0 flex-1 bg-theme-bg ring-1 ring-theme-fg/30 focus-within:ring-theme-fg">
          <span
            aria-hidden
            className="invisible col-start-1 row-start-1 max-h-192 min-h-56 overflow-hidden whitespace-pre-wrap wrap-anywhere p-8 font-mono text-body-14"
          >
            {`${prompt || placeholderText} `}
          </span>
          <textarea
            value={prompt}
            onChange={e=>setPrompt(e.target.value)}
            onKeyDown={kd}
            rows={1}
            aria-label={t('promptLabel')}
            className="col-start-1 row-start-1 h-full w-0 min-w-full resize-none overflow-y-auto wrap-anywhere bg-transparent p-8 font-mono text-body-14 text-theme-fg outline-none [scrollbar-width:none]"
            placeholder={placeholderText}
          />
        </div>
        <div className="flex w-40 shrink-0 flex-col gap-8">
          <button onClick={()=>fileInputRef.current?.click()} className="flex flex-1 cursor-pointer items-center justify-center text-theme-dim ring-1 ring-theme-fg/30 hover:bg-theme-fg/10 hover:text-theme-fg" aria-label={t('addRef')}><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" className="size-16"><path d="M0 0h24v24H0z" fill="none"/><path fill="none" stroke="currentColor" strokeLinecap="square" strokeWidth="2" d="m20.506 12.313l-7.778 7.778a6 6 0 0 1-8.485-8.485l7.778-7.778a4 4 0 1 1 5.657 5.657L9.9 17.263a2 2 0 1 1-2.829-2.829l7.071-7.07"/></svg></button>
          {busy && onCancel ? (
            <button onClick={onCancel} className="flex flex-1 cursor-pointer items-center justify-center bg-error font-semibold text-black hover:bg-transparent hover:text-error ring-1 ring-transparent hover:ring-error" aria-label={t('stop')}><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" className="size-12" aria-hidden="true"><rect width="12" height="12" fill="currentColor" /></svg></button>
          ) : (
            <button onClick={send} disabled={busy||!prompt.trim()} className="flex flex-1 cursor-pointer items-center justify-center bg-theme-fg font-semibold text-theme-bg ring-1 ring-theme-fg/30 hover:bg-transparent hover:text-theme-fg hover:ring-theme-fg disabled:cursor-not-allowed disabled:opacity-40" aria-label={t('send')}>{busy?<span className="animate-pulse motion-reduce:animate-none">...</span>:'>'}</button>
          )}
        </div>
        <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={e=>{if(e.target.files?.length){addFiles(e.target.files).catch(()=>{});e.target.value=''}}} />
      </div>

    </div>
  );
}
