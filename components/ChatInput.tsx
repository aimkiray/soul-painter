'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useConfig } from '@/contexts/ConfigContext';
import { useImages } from '@/contexts/ImageContext';
import { IMAGE_MODEL_PRESETS, CHAT_MODEL_PRESETS, LAST_PROMPT_KEY, ORIGINAL_ASPECT_SIZE, SIZE_PRESETS } from '@/lib/constants';
import { formatSizeDisplay } from '@/lib/size';

interface ChatInputProps {
  onSend: (prompt: string) => void;
  isLoading: boolean;
initialPrompt?: string;
  onClearChat: () => void;
  onOpenSettings: () => void;
  onCancel?: () => void;
}

const sel = 'w-full cursor-pointer bg-[#AAA] text-black border border-[#999] text-xs sm:text-sm py-1 sm:py-1.5 px-2 font-mono';

export default function ChatInput({ onSend, isLoading, initialPrompt = '', onClearChat, onOpenSettings, onCancel }: ChatInputProps) {
  const { config, updateConfig, options } = useConfig();
  const { images, hasImages, selectedIndices, addFiles } = useImages();
  const [prompt, setPrompt] = useState(initialPrompt);
  const [customSize, setCustomSize] = useState(false);
  const [customModel, setCustomModel] = useState(false);
  const [customChatModel, setCustomChatModel] = useState(false);
  const [paramsOpen, setParamsOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-save prompt while typing (debounced, only if persistPrompt enabled)
  useEffect(() => {
    if (!options.persistPrompt) return;
    const timer = setTimeout(() => {
      try { localStorage.setItem(LAST_PROMPT_KEY, prompt); } catch { /* ignore */ }
    }, 500);
    return () => clearTimeout(timer);
  }, [prompt, options.persistPrompt]);

  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === 'F1') { e.preventDefault(); onOpenSettings(); } }; document.addEventListener('keydown', h); return () => document.removeEventListener('keydown', h); }, [onOpenSettings]);

  const send = () => { if (!prompt.trim() || isLoading) return; onSend(prompt.trim()); if (options.clearOnSubmit) setPrompt(''); };
  const kd = (e: React.KeyboardEvent) => { if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); send(); } else if (e.key === 'Enter' && !e.shiftKey && !e.repeat) { e.preventDefault(); send(); } };
  const imageModeActive = config.mode === 'image';
  const imageModelIsPreset = IMAGE_MODEL_PRESETS.some(m => m.value === config.model);
  const chatModelIsPreset = CHAT_MODEL_PRESETS.some(m => m.value === config.chatModel);
  const sizeIsPreset = SIZE_PRESETS.some(s => s.value === config.size);
  const activeImages = selectedIndices.size > 0
    ? images.filter((_, i) => selectedIndices.has(i))
    : [];
  const originalAspectLabel = formatSizeDisplay(ORIGINAL_ASPECT_SIZE, activeImages);

  return (
    <div className="shrink min-h-0 flex flex-col w-full max-w-3xl mx-auto px-2 sm:px-3 pb-3 border-t md:border-t-0 border-[#AAA]">
      <div className="flex items-center justify-between gap-2 py-1.5 mb-1">
        <span className="flex items-center gap-2">
          <button onClick={() => setParamsOpen(!paramsOpen)} className="text-xs sm:text-sm text-white cursor-pointer font-mono">{paramsOpen ? '模式 ▾' : '模式 ▸'}</button>
        </span>
        <button onClick={onClearChat} className="text-xs sm:text-sm text-[#ff5555] cursor-pointer font-mono">清空记录</button>
      </div>

      <div className={`${paramsOpen ? '' : 'hidden'} md:block w-full mb-1 space-y-1 overflow-y-auto max-h-[30vh]`}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-1 w-full">
            <select value={config.mode} onChange={e=>updateConfig('mode',e.target.value as 'image' | 'chat')} className={sel}>
              <option value="image">图片</option>
              <option value="chat">聊天</option>
            </select>
            {imageModeActive ? (
              <>
                <select value={(customModel || !imageModelIsPreset)?'__custom__':config.model} onChange={e=>{if(e.target.value==='__custom__')setCustomModel(true);else{setCustomModel(false);updateConfig('model',e.target.value)}}} className="col-span-1 md:col-span-1 w-full cursor-pointer bg-[#AAA] text-black border border-[#999] text-xs sm:text-sm py-1 sm:py-1.5 px-2 font-mono">
                  {IMAGE_MODEL_PRESETS.map(m=>(<option key={m.value} value={m.value}>{m.label}</option>))}<option value="__custom__">自定义...</option>
                </select>
                <select value={(customSize || !sizeIsPreset)?'__custom__':config.size} onChange={e=>{if(e.target.value==='__custom__')setCustomSize(true);else{setCustomSize(false);updateConfig('size',e.target.value)}}} className="col-span-2 md:col-span-2 w-full cursor-pointer bg-[#AAA] text-black border border-[#999] text-xs sm:text-sm py-1 sm:py-1.5 px-2 font-mono">
                  <optgroup label="AUTO">{SIZE_PRESETS.filter(s=>s.group==='AUTO').map(s=>(<option key={s.value} value={s.value}>{s.value === ORIGINAL_ASPECT_SIZE ? originalAspectLabel : s.label}</option>))}</optgroup>
                  <optgroup label="1K">{SIZE_PRESETS.filter(s=>s.group==='1K').map(s=>(<option key={s.value} value={s.value}>{s.label}</option>))}</optgroup>
                  <optgroup label="2K">{SIZE_PRESETS.filter(s=>s.group==='2K').map(s=>(<option key={s.value} value={s.value}>{s.label}</option>))}</optgroup>
                  <optgroup label="4K">{SIZE_PRESETS.filter(s=>s.group==='4K').map(s=>(<option key={s.value} value={s.value}>{s.label}</option>))}</optgroup>
                  <option value="__custom__">自定义...</option>
                </select>
              </>
            ) : (
              <select value={(customChatModel || !chatModelIsPreset)?'__custom__':config.chatModel} onChange={e=>{if(e.target.value==='__custom__')setCustomChatModel(true);else{setCustomChatModel(false);updateConfig('chatModel',e.target.value)}}} className="col-span-1 md:col-span-3 w-full cursor-pointer bg-[#AAA] text-black border border-[#999] text-xs sm:text-sm py-1 sm:py-1.5 px-2 font-mono">
                {CHAT_MODEL_PRESETS.map(m=>(<option key={m.value} value={m.value}>{m.label}</option>))}<option value="__custom__">自定义...</option>
              </select>
            )}
          </div>
          {(customSize || !sizeIsPreset) && imageModeActive && <input type="text" value={config.size} onChange={e=>updateConfig('size',e.target.value)} placeholder="WxH" className="w-full bg-black border border-[#00aaaa] text-[#CCC] text-xs sm:text-sm py-1 sm:py-1.5 px-2 font-mono outline-none" />}
          {(customModel || !imageModelIsPreset) && imageModeActive && <input type="text" value={config.model} onChange={e=>updateConfig('model',e.target.value)} className="w-full bg-black border border-[#00aaaa] text-[#CCC] text-xs sm:text-sm py-1 sm:py-1.5 px-2 font-mono outline-none" />}
          {(customChatModel || !chatModelIsPreset) && !imageModeActive && <input type="text" value={config.chatModel} onChange={e=>updateConfig('chatModel',e.target.value)} className="w-full bg-black border border-[#00aaaa] text-[#CCC] text-xs sm:text-sm py-1 sm:py-1.5 px-2 font-mono outline-none" />}

        </div>

      <div className="w-full flex items-stretch gap-2 shrink-0">
        <textarea value={prompt} onChange={e=>setPrompt(e.target.value)} onKeyDown={kd} rows={2} className="flex-1 min-w-0 bg-black border-2 border-[#AAA] focus:border-[#00aaaa] text-[#CCC] font-mono text-sm sm:text-base p-2 sm:p-3 resize-none outline-none min-h-[60px] sm:min-h-0" placeholder={config.mode === 'chat' ? '输入聊天内容...' : hasImages ? '描述如何使用/修改参考图...' : '描述你要生成的画面内容...'} />
        <div className="flex flex-col gap-2 w-10 sm:w-10 shrink-0">
          <button onClick={()=>fileInputRef.current?.click()} className="btn-retro bg-[#00aaaa] flex-1 flex items-center justify-center" aria-label="添加参考图"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" className="w-5 h-5"><path d="M0 0h24v24H0z" fill="none"/><path fill="none" stroke="currentColor" strokeLinecap="square" strokeWidth="2" d="m20.506 12.313l-7.778 7.778a6 6 0 0 1-8.485-8.485l7.778-7.778a4 4 0 1 1 5.657 5.657L9.9 17.263a2 2 0 1 1-2.829-2.829l7.071-7.07"/></svg></button>
          {isLoading && onCancel ? (
            <button onClick={onCancel} className="btn-retro bg-[#aa0000] flex-1 flex items-center justify-center font-bold text-white" aria-label="停止">■</button>
          ) : (
            <button onClick={send} disabled={isLoading||!prompt.trim()} className="btn-retro bg-[#00aaaa] disabled:opacity-50 disabled:cursor-not-allowed flex-1 flex items-center justify-center font-bold" aria-label="发送">{isLoading?<span className="animate-pulse">...</span>:'>'}</button>
          )}
        </div>
        <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={e=>{if(e.target.files?.length){addFiles(e.target.files).catch(()=>{});e.target.value=''}}} />
      </div>

    </div>
  );
}
