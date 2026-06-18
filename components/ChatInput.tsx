'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useConfig } from '@/contexts/ConfigContext';
import { useChat } from '@/contexts/ChatContext';
import { useImages } from '@/contexts/ImageContext';
import { IMAGE_MODEL_PRESETS, CHAT_MODEL_PRESETS, chatSessionPromptStorageKey, ORIGINAL_ASPECT_SIZE, REPEATER_MODEL_LABEL, SIZE_PRESETS } from '@/lib/constants';
import { COMPOSER_FRAME_CLASS } from '@/lib/layout';
import { mergeModelOptions } from '@/lib/model-options';
import { formatSizeDisplay } from '@/lib/size';

interface ChatInputProps {
  onSend: (prompt: string) => void;
  isLoading: boolean;
  onOpenSettings: () => void;
  onCancel?: () => void;
}

const composerSelectClass = 'composer-select h-8 cursor-pointer bg-black text-[#CCC] border-2 border-[#AAA] focus:border-[#00aaaa] text-xs sm:text-sm pl-2 pr-7 font-mono outline-none disabled:opacity-100 disabled:cursor-default';

function readStoredPrompt(sessionId: string) {
  try {
    return localStorage.getItem(chatSessionPromptStorageKey(sessionId)) || '';
  } catch {
    return '';
  }
}

export default function ChatInput({ onSend, isLoading, onOpenSettings, onCancel }: ChatInputProps) {
  const { config, updateConfig, options, modelGateEnabled, modelGateUnlocked } = useConfig();
  const { activeSessionId } = useChat();
  const { images, hasImages, selectedIndices, addFiles } = useImages();
  const [promptDrafts, setPromptDrafts] = useState<Record<string, string>>({});
  const [customSize, setCustomSize] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const submitLockRef = useRef(false);
  const prompt = promptDrafts[activeSessionId] ?? readStoredPrompt(activeSessionId);
  const setPrompt = (nextPrompt: string) => {
    setPromptDrafts((prev) => (
      prev[activeSessionId] === nextPrompt
        ? prev
        : { ...prev, [activeSessionId]: nextPrompt }
    ));
  };

  // Auto-save prompt while typing (debounced, only if persistPrompt enabled)
  useEffect(() => {
    if (!options.persistPrompt) return;
    const timer = setTimeout(() => {
      try { localStorage.setItem(chatSessionPromptStorageKey(activeSessionId), prompt); } catch { /* ignore */ }
    }, 500);
    return () => clearTimeout(timer);
  }, [prompt, options.persistPrompt, activeSessionId]);

  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === 'F1') { e.preventDefault(); onOpenSettings(); } }; document.addEventListener('keydown', h); return () => document.removeEventListener('keydown', h); }, [onOpenSettings]);

  useEffect(() => {
    if (!isLoading) submitLockRef.current = false;
  }, [isLoading]);

  const busy = isLoading;
  const send = () => {
    const nextPrompt = prompt.trim();
    if (!nextPrompt || busy || submitLockRef.current) return;
    submitLockRef.current = true;
    onSend(nextPrompt);
    setPrompt('');
  };
  const kd = (e: React.KeyboardEvent) => { if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); send(); } else if (e.key === 'Enter' && !e.shiftKey && !e.repeat) { e.preventDefault(); send(); } };
  const imageModeActive = config.mode === 'image';
  const lockedRepeaterMode = modelGateEnabled && !modelGateUnlocked;
  const imageModelOptions = mergeModelOptions(IMAGE_MODEL_PRESETS, config.customImageModels);
  const chatModelOptions = mergeModelOptions(CHAT_MODEL_PRESETS, config.customChatModels);
  const imageModelIsOption = imageModelOptions.some(m => m.value === config.model);
  const chatModelIsOption = chatModelOptions.some(m => m.value === config.chatModel);
  const sizeIsPreset = SIZE_PRESETS.some(s => s.value === config.size);
  const activeImages = selectedIndices.size > 0
    ? images.filter((_, i) => selectedIndices.has(i))
    : [];
  const originalAspectLabel = formatSizeDisplay(ORIGINAL_ASPECT_SIZE, activeImages);

  return (
    <div className={`${COMPOSER_FRAME_CLASS} shrink min-h-0 flex flex-col pb-3 border-t md:border-t-0 border-[#AAA]`}>
      <div className="w-full py-1.5 mb-1">
        <div className="flex w-full items-center gap-1 overflow-x-auto overflow-y-hidden pb-0.5">
            <div
              className="grid h-8 w-32 shrink-0 grid-cols-2 overflow-hidden border-2 border-[#AAA] bg-black p-0.5"
              role="tablist"
              aria-label="生成模式"
            >
              {([
                ['image', 'IMG'],
                ['chat', 'CHAT'],
              ] as const).map(([mode, label], index) => {
                const active = config.mode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => updateConfig('mode', mode)}
                    className={[
                      'flex h-full min-w-0 cursor-pointer items-center justify-center gap-1 whitespace-nowrap px-1 text-xs font-mono transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-white',
                      index > 0 ? 'border-l border-[#555]' : '',
                      active
                        ? 'bg-[#00aaaa] text-black shadow-[inset_0_-3px_0_#00aaaa]'
                        : 'bg-black text-[#CCC] hover:bg-[#111] hover:text-[#00aaaa]',
                    ].filter(Boolean).join(' ')}
                  >
                    <span className="w-5 shrink-0 whitespace-nowrap text-left tabular-nums" aria-hidden="true">
                      {active ? '[x]' : '[ ]'}
                    </span>
                    {label}
                  </button>
                );
              })}
            </div>
            {imageModeActive ? (
              <>
                <select value={lockedRepeaterMode ? REPEATER_MODEL_LABEL : config.model} disabled={lockedRepeaterMode} onChange={e=>updateConfig('model',e.target.value)} className={`${composerSelectClass} min-w-[7.5rem] flex-[0.7]`}>
                  {lockedRepeaterMode ? <option value={REPEATER_MODEL_LABEL}>{REPEATER_MODEL_LABEL}</option> : (
                    <>
                      {!imageModelIsOption && <option value={config.model}>{config.model}</option>}
                      {imageModelOptions.map(m=>(<option key={m.value} value={m.value}>{m.label}</option>))}
                    </>
                  )}
                </select>
                <select value={(customSize || !sizeIsPreset)?'__custom__':config.size} onChange={e=>{if(e.target.value==='__custom__')setCustomSize(true);else{setCustomSize(false);updateConfig('size',e.target.value)}}} className={`${composerSelectClass} min-w-[10rem] flex-[1.4]`}>
                  <optgroup label="AUTO">{SIZE_PRESETS.filter(s=>s.group==='AUTO').map(s=>(<option key={s.value} value={s.value}>{s.value === ORIGINAL_ASPECT_SIZE ? originalAspectLabel : s.label}</option>))}</optgroup>
                  <optgroup label="1K">{SIZE_PRESETS.filter(s=>s.group==='1K').map(s=>(<option key={s.value} value={s.value}>{s.label}</option>))}</optgroup>
                  <optgroup label="2K">{SIZE_PRESETS.filter(s=>s.group==='2K').map(s=>(<option key={s.value} value={s.value}>{s.label}</option>))}</optgroup>
                  <optgroup label="4K">{SIZE_PRESETS.filter(s=>s.group==='4K').map(s=>(<option key={s.value} value={s.value}>{s.label}</option>))}</optgroup>
                  <option value="__custom__">自定义...</option>
                </select>
                {(customSize || !sizeIsPreset) && <input type="text" value={config.size} onChange={e=>updateConfig('size',e.target.value)} placeholder="WxH" className="h-8 min-w-[5.5rem] w-24 shrink-0 bg-black border-2 border-[#00aaaa] text-[#CCC] text-xs sm:text-sm px-2 font-mono outline-none" />}
              </>
            ) : (
              <>
                <select value={lockedRepeaterMode ? REPEATER_MODEL_LABEL : config.chatModel} disabled={lockedRepeaterMode} onChange={e=>updateConfig('chatModel',e.target.value)} className={`${composerSelectClass} min-w-[12rem] flex-1`}>
                  {lockedRepeaterMode ? <option value={REPEATER_MODEL_LABEL}>{REPEATER_MODEL_LABEL}</option> : (
                    <>
                      {!chatModelIsOption && <option value={config.chatModel}>{config.chatModel}</option>}
                      {chatModelOptions.map(m=>(<option key={m.value} value={m.value}>{m.label}</option>))}
                    </>
                  )}
                </select>
              </>
            )}
        </div>
      </div>

      <div className="w-full flex items-stretch gap-2 shrink-0">
        <textarea value={prompt} onChange={e=>setPrompt(e.target.value)} onKeyDown={kd} rows={2} className="flex-1 min-w-0 bg-black border-2 border-[#AAA] focus:border-[#00aaaa] text-[#CCC] font-mono text-sm sm:text-base p-2 sm:p-3 resize-none outline-none min-h-[60px] sm:min-h-0" placeholder={config.mode === 'chat' ? '输入聊天内容...' : hasImages ? '描述如何使用/修改参考图...' : '描述你要生成的画面内容...'} />
        <div className="flex flex-col gap-2 w-10 sm:w-10 shrink-0">
          <button onClick={()=>fileInputRef.current?.click()} className="btn-retro bg-[#00aaaa] flex-1 flex items-center justify-center" aria-label="添加参考图"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" className="w-5 h-5"><path d="M0 0h24v24H0z" fill="none"/><path fill="none" stroke="currentColor" strokeLinecap="square" strokeWidth="2" d="m20.506 12.313l-7.778 7.778a6 6 0 0 1-8.485-8.485l7.778-7.778a4 4 0 1 1 5.657 5.657L9.9 17.263a2 2 0 1 1-2.829-2.829l7.071-7.07"/></svg></button>
          {busy && onCancel ? (
            <button onClick={onCancel} className="btn-retro bg-[#aa0000] flex-1 flex items-center justify-center font-bold text-white" aria-label="停止">■</button>
          ) : (
            <button onClick={send} disabled={busy||!prompt.trim()} className="btn-retro bg-[#00aaaa] disabled:opacity-50 disabled:cursor-not-allowed flex-1 flex items-center justify-center font-bold" aria-label="发送">{busy?<span className="animate-pulse">...</span>:'>'}</button>
          )}
        </div>
        <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={e=>{if(e.target.files?.length){addFiles(e.target.files).catch(()=>{});e.target.value=''}}} />
      </div>

    </div>
  );
}
