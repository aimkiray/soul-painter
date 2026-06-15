'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useConfig } from '@/contexts/ConfigContext';
import { useChat } from '@/contexts/ChatContext';
import { useImages } from '@/contexts/ImageContext';
import { IMAGE_MODEL_PRESETS, CHAT_MODEL_PRESETS, PARAMS_OPEN_STORAGE_KEY, chatSessionPromptStorageKey, ORIGINAL_ASPECT_SIZE, REPEATER_MODEL_LABEL, SIZE_PRESETS } from '@/lib/constants';
import { formatSizeDisplay } from '@/lib/size';

interface ChatInputProps {
  onSend: (prompt: string) => void;
  isLoading: boolean;
  onClearChat: () => void;
  onOpenSettings: () => void;
  onCancel?: () => void;
}

const sel = 'w-full cursor-pointer bg-[#AAA] text-black border-2 border-[#999] text-xs sm:text-sm py-1 sm:py-1.5 px-2 font-mono';

function readStoredPrompt(sessionId: string) {
  try {
    return localStorage.getItem(chatSessionPromptStorageKey(sessionId)) || '';
  } catch {
    return '';
  }
}

function readStoredParamsOpen() {
  try {
    return localStorage.getItem(PARAMS_OPEN_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export default function ChatInput({ onSend, isLoading, onClearChat, onOpenSettings, onCancel }: ChatInputProps) {
  const { config, updateConfig, options, modelGateEnabled, modelGateUnlocked } = useConfig();
  const {
    sessions,
    activeSessionId,
    loadingSessionId,
    createChatSession,
    switchChatSession,
    renameChatSession,
    deleteChatSession,
  } = useChat();
  const { images, hasImages, selectedIndices, addFiles } = useImages();
  const [promptDrafts, setPromptDrafts] = useState<Record<string, string>>({});
  const [customSize, setCustomSize] = useState(false);
  const [customModel, setCustomModel] = useState(false);
  const [customChatModel, setCustomChatModel] = useState(false);
  const [paramsOpen, setParamsOpen] = useState(readStoredParamsOpen);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sessionMenuRef = useRef<HTMLDivElement>(null);
  const activeSession = sessions.find((session) => session.id === activeSessionId);
  const isActiveSessionLoading = isLoading && loadingSessionId === activeSessionId;
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
    try {
      localStorage.setItem(PARAMS_OPEN_STORAGE_KEY, paramsOpen ? '1' : '0');
    } catch { /* ignore */ }
  }, [paramsOpen]);

  useEffect(() => {
    if (!sessionMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (sessionMenuRef.current?.contains(event.target as Node)) return;
      setSessionMenuOpen(false);
      setConfirmingDelete(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setSessionMenuOpen(false);
      setConfirmingDelete(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [sessionMenuOpen]);

  const send = () => { if (!prompt.trim() || isLoading) return; onSend(prompt.trim()); if (options.clearOnSubmit) setPrompt(''); };
  const kd = (e: React.KeyboardEvent) => { if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); send(); } else if (e.key === 'Enter' && !e.shiftKey && !e.repeat) { e.preventDefault(); send(); } };
  const commitRename = () => {
    const nextTitle = renameDraft.trim();
    if (nextTitle) renameChatSession(activeSessionId, nextTitle);
    setRenaming(false);
  };
  const closeSessionTools = () => {
    setRenaming(false);
    setConfirmingDelete(false);
    setSessionMenuOpen(false);
  };
  const imageModeActive = config.mode === 'image';
  const lockedRepeaterMode = modelGateEnabled && !modelGateUnlocked;
  const imageModelIsPreset = IMAGE_MODEL_PRESETS.some(m => m.value === config.model);
  const chatModelIsPreset = CHAT_MODEL_PRESETS.some(m => m.value === config.chatModel);
  const sizeIsPreset = SIZE_PRESETS.some(s => s.value === config.size);
  const activeImages = selectedIndices.size > 0
    ? images.filter((_, i) => selectedIndices.has(i))
    : [];
  const originalAspectLabel = formatSizeDisplay(ORIGINAL_ASPECT_SIZE, activeImages);

  return (
    <div className="shrink min-h-0 flex flex-col w-[calc(100%-12px)] md:w-full max-w-3xl mx-[6px] md:mx-auto px-2 sm:px-3 pb-3 border-t md:border-t-0 border-[#AAA]">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 py-1.5 mb-1">
        <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-1">
          <button
            onClick={() => {
              closeSessionTools();
              createChatSession();
            }}
            className="min-h-8 sm:min-h-9 bg-[#00aaaa] text-black border-2 border-[#00aaaa] px-2.5 sm:px-3 text-xs sm:text-sm cursor-pointer font-mono shrink-0"
          >
            新建
          </button>
          <select
            value={activeSessionId}
            onChange={(event) => {
              closeSessionTools();
              switchChatSession(event.target.value);
            }}
            className="min-w-0 flex-1 min-h-8 sm:min-h-9 cursor-pointer bg-black text-[#CCC] border-2 border-[#AAA] text-xs sm:text-sm px-2 font-mono"
            aria-label="切换聊天"
          >
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>{session.title}</option>
            ))}
          </select>
          <div className="relative shrink-0" ref={sessionMenuRef}>
            <button
              onClick={() => {
                setRenaming(false);
                setConfirmingDelete(false);
                setSessionMenuOpen((open) => !open);
              }}
              className="h-8 sm:h-9 w-10 sm:w-10 border-2 border-[#AAA] text-[#CCC] bg-black text-base sm:text-lg leading-none cursor-pointer font-mono shrink-0 flex items-center justify-center"
              aria-label="会话操作"
              aria-expanded={sessionMenuOpen}
              aria-haspopup="menu"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 22" className="block h-5 w-5 sm:h-[22px] sm:w-[22px]" aria-hidden="true">
                <path d="M0 0h22v22H0z" fill="none" />
                <path fill="currentColor" d="M16 2h1v1h1v1h1v1h1v1h-1v1h-1v1h-1V7h-1V6h-1V5h-1V4h1V3h1Z" />
                <path fill="currentColor" d="M12 6h2v1h1v1h1v2h-1v1h-1v1h-1v1h-1v1h-1v1h-1v1H9v1H8v1H7v1H6v1H2v-4h1v-1h1v-1h1v-1h1v-1h1v-1h1v-1h1V9h1V8h1V7h1Z" />
              </svg>
            </button>
            {sessionMenuOpen && (
              <div className="absolute right-0 bottom-full mb-1 z-20 w-36 border-2 border-[#AAA] bg-black text-[#CCC]" role="menu">
                <button
                  onClick={() => {
                    setConfirmingDelete(false);
                    setRenameDraft(activeSession?.title || '');
                    setRenaming(true);
                    setSessionMenuOpen(false);
                  }}
                  role="menuitem"
                  className="block w-full text-left px-3 py-2 text-xs sm:text-sm hover:bg-[#111] cursor-pointer"
                >
                  改名
                </button>
                <button
                  onClick={() => {
                    onClearChat();
                    closeSessionTools();
                  }}
                  role="menuitem"
                  className="block w-full text-left px-3 py-2 text-xs sm:text-sm hover:bg-[#111] cursor-pointer"
                >
                  清空当前
                </button>
                <button
                  onClick={() => {
                    if (confirmingDelete) {
                      deleteChatSession(activeSessionId);
                      closeSessionTools();
                    } else {
                      setConfirmingDelete(true);
                    }
                  }}
                  disabled={isActiveSessionLoading}
                  role="menuitem"
                  className="block w-full text-left px-3 py-2 text-xs sm:text-sm text-[#ff5555] hover:bg-[#111] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {confirmingDelete ? '确认删除' : '删除会话'}
                </button>
              </div>
            )}
          </div>
        </div>
        <button
          onClick={() => {
            closeSessionTools();
            setParamsOpen((open) => !open);
          }}
          className="min-h-8 sm:min-h-9 w-10 sm:w-10 border-2 border-[#AAA] text-white bg-black px-2 text-base sm:text-lg leading-none cursor-pointer font-mono shrink-0"
          aria-label={paramsOpen ? '收起参数' : '展开参数'}
          aria-expanded={paramsOpen}
        >
          {paramsOpen ? (
            <svg xmlns="http://www.w3.org/2000/svg" width="1.15em" height="1.15em" viewBox="0 0 22 22" aria-hidden="true">
              <path d="M0 0h22v22H0z" fill="none" />
              <path fill="currentColor" d="M17 9V8H5v1h1v1h1v1h1v1h1v1h1v1h2v-1h1v-1h1v-1h1v-1h1V9" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="1.15em" height="1.15em" viewBox="0 0 22 22" aria-hidden="true">
              <path d="M0 0h22v22H0z" fill="none" />
              <path fill="currentColor" d="M9 5H8v12h1v-1h1v-1h1v-1h1v-1h1v-1h1v-2h-1V9h-1V8h-1V7h-1V6H9" />
            </svg>
          )}
        </button>
      </div>

      {renaming && (
        <div className="flex items-center gap-2 mb-1">
          <input
            value={renameDraft}
            onChange={(event) => setRenameDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commitRename();
              } else if (event.key === 'Escape') {
                setRenaming(false);
              }
            }}
            className="flex-1 min-w-0 bg-black border-2 border-[#00aaaa] text-[#CCC] text-xs sm:text-sm py-1 px-2 font-mono outline-none"
            autoFocus
            maxLength={24}
          />
          <button onClick={commitRename} className="text-xs sm:text-sm text-[#00aaaa] cursor-pointer font-mono">保存</button>
          <button onClick={() => setRenaming(false)} className="text-xs sm:text-sm text-[#CCC] cursor-pointer font-mono">取消</button>
        </div>
      )}

      <div className={`${paramsOpen ? '' : 'hidden'} w-full mb-1 space-y-1 overflow-y-auto max-h-[30vh]`}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-1 w-full">
            <select value={config.mode} onChange={e=>updateConfig('mode',e.target.value as 'image' | 'chat')} className={sel}>
              <option value="image">图片</option>
              <option value="chat">聊天</option>
            </select>
            {imageModeActive ? (
              <>
                <select value={lockedRepeaterMode ? REPEATER_MODEL_LABEL : (customModel || !imageModelIsPreset) ? '__custom__' : config.model} disabled={lockedRepeaterMode} onChange={e=>{if(e.target.value==='__custom__')setCustomModel(true);else{setCustomModel(false);updateConfig('model',e.target.value)}}} className="col-span-1 md:col-span-1 w-full cursor-pointer bg-[#AAA] text-black border-2 border-[#999] text-xs sm:text-sm py-1 sm:py-1.5 px-2 font-mono disabled:opacity-100 disabled:cursor-default">
                  {lockedRepeaterMode ? <option value={REPEATER_MODEL_LABEL}>{REPEATER_MODEL_LABEL}</option> : IMAGE_MODEL_PRESETS.map(m=>(<option key={m.value} value={m.value}>{m.label}</option>))}
                  {!lockedRepeaterMode && <option value="__custom__">自定义...</option>}
                </select>
                <select value={(customSize || !sizeIsPreset)?'__custom__':config.size} onChange={e=>{if(e.target.value==='__custom__')setCustomSize(true);else{setCustomSize(false);updateConfig('size',e.target.value)}}} className="col-span-2 md:col-span-2 w-full cursor-pointer bg-[#AAA] text-black border-2 border-[#999] text-xs sm:text-sm py-1 sm:py-1.5 px-2 font-mono">
                  <optgroup label="AUTO">{SIZE_PRESETS.filter(s=>s.group==='AUTO').map(s=>(<option key={s.value} value={s.value}>{s.value === ORIGINAL_ASPECT_SIZE ? originalAspectLabel : s.label}</option>))}</optgroup>
                  <optgroup label="1K">{SIZE_PRESETS.filter(s=>s.group==='1K').map(s=>(<option key={s.value} value={s.value}>{s.label}</option>))}</optgroup>
                  <optgroup label="2K">{SIZE_PRESETS.filter(s=>s.group==='2K').map(s=>(<option key={s.value} value={s.value}>{s.label}</option>))}</optgroup>
                  <optgroup label="4K">{SIZE_PRESETS.filter(s=>s.group==='4K').map(s=>(<option key={s.value} value={s.value}>{s.label}</option>))}</optgroup>
                  <option value="__custom__">自定义...</option>
                </select>
              </>
            ) : (
              <select value={lockedRepeaterMode ? REPEATER_MODEL_LABEL : (customChatModel || !chatModelIsPreset) ? '__custom__' : config.chatModel} disabled={lockedRepeaterMode} onChange={e=>{if(e.target.value==='__custom__')setCustomChatModel(true);else{setCustomChatModel(false);updateConfig('chatModel',e.target.value)}}} className="col-span-1 md:col-span-3 w-full cursor-pointer bg-[#AAA] text-black border-2 border-[#999] text-xs sm:text-sm py-1 sm:py-1.5 px-2 font-mono disabled:opacity-100 disabled:cursor-default">
                {lockedRepeaterMode ? <option value={REPEATER_MODEL_LABEL}>{REPEATER_MODEL_LABEL}</option> : CHAT_MODEL_PRESETS.map(m=>(<option key={m.value} value={m.value}>{m.label}</option>))}
                {!lockedRepeaterMode && <option value="__custom__">自定义...</option>}
              </select>
            )}
          </div>
          {(customSize || !sizeIsPreset) && imageModeActive && <input type="text" value={config.size} onChange={e=>updateConfig('size',e.target.value)} placeholder="WxH" className="w-full bg-black border-2 border-[#00aaaa] text-[#CCC] text-xs sm:text-sm py-1 sm:py-1.5 px-2 font-mono outline-none" />}
          {!lockedRepeaterMode && (customModel || !imageModelIsPreset) && imageModeActive && <input type="text" value={config.model} onChange={e=>updateConfig('model',e.target.value)} className="w-full bg-black border-2 border-[#00aaaa] text-[#CCC] text-xs sm:text-sm py-1 sm:py-1.5 px-2 font-mono outline-none" />}
          {!lockedRepeaterMode && (customChatModel || !chatModelIsPreset) && !imageModeActive && <input type="text" value={config.chatModel} onChange={e=>updateConfig('chatModel',e.target.value)} className="w-full bg-black border-2 border-[#00aaaa] text-[#CCC] text-xs sm:text-sm py-1 sm:py-1.5 px-2 font-mono outline-none" />}

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
