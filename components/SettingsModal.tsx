'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useConfig } from '@/contexts/ConfigContext';
import { useImages } from '@/contexts/ImageContext';
import {
  BACKGROUND_OPTIONS,
  CHAT_MODEL_PRESETS,
  FORMAT_OPTIONS,
  IMAGE_MODEL_PRESETS,
  MODERATION_OPTIONS,
  ORIGINAL_ASPECT_SIZE,
  QUALITY_OPTIONS,
  SIZE_PRESETS,
} from '@/lib/constants';
import { addModelToList, mergeModelOptions, removeModelFromList } from '@/lib/model-options';
import { formatSizeDisplay } from '@/lib/size';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

const fieldsetClass = 'tui-fieldset border-[#AAA] min-w-0';
const labelClass = 'block text-xs text-[#CCC] mb-0.5';
const inputClass = 'w-full bg-black border-2 border-[#AAA] focus:border-[#00aaaa] text-[#CCC] text-sm py-1 px-2 outline-none font-mono';
const selectClass = 'w-full bg-[#AAA] text-black border-2 border-[#999] text-sm py-1 px-1 cursor-pointer font-mono';
const hintClass = 'text-xs text-[#888] mt-1';
const toggleClass = 'shrink-0 w-5 h-5 appearance-none border-2 border-[#AAA] bg-black checked:bg-[#00aaaa] checked:border-[#00aaaa] cursor-pointer';
const optionRowClass = 'flex items-center justify-between gap-3 bg-black cursor-pointer select-none';

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { config, options, updateConfig, updateOption, saveConfig, saveOptions, clearAll, keySource, chatKeySource } = useConfig();
  const { images, selectedIndices } = useImages();
  const [showKey, setShowKey] = useState(false);
  const [showChatKey, setShowChatKey] = useState(false);
  const [newImageModel, setNewImageModel] = useState('');
  const [newChatModel, setNewChatModel] = useState('');
  const [customSize, setCustomSize] = useState(false);

  const imageModelOptions = mergeModelOptions(IMAGE_MODEL_PRESETS, config.customImageModels);
  const chatModelOptions = mergeModelOptions(CHAT_MODEL_PRESETS, config.customChatModels);
  const imageModelIsOption = imageModelOptions.some(m => m.value === config.model);
  const chatModelIsOption = chatModelOptions.some(m => m.value === config.chatModel);
  const titleModelIsOption = chatModelOptions.some(m => m.value === config.titleModel);
  const sizeIsPreset = SIZE_PRESETS.some(s => s.value === config.size);
  const activeImages = selectedIndices.size > 0
    ? images.filter((_, i) => selectedIndices.has(i))
    : [];
  const originalAspectLabel = formatSizeDisplay(ORIGINAL_ASPECT_SIZE, activeImages);

  const prevOpen = useRef(open);
  useEffect(() => {
    if (prevOpen.current && !open) {
      saveConfig();
      saveOptions();
    }
    prevOpen.current = open;
  }, [open, saveConfig, saveOptions]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const keySourceLabel = {
    url: 'URL 预填',
    user: '自定义',
    server: '服务端默认',
    none: '未配置',
  }[keySource];

  const keySourceColor = {
    url: 'text-[#ffff55]',
    user: 'text-[#00aaaa]',
    server: 'text-[#00ff00]',
    none: 'text-[#ff5555]',
  }[keySource];

  const chatKeySourceLabel = {
    user: '自定义',
    server: '服务端默认',
    inherit: '继承图像配置',
    none: '未配置',
  }[chatKeySource];

  const chatKeySourceColor = {
    user: 'text-[#00aaaa]',
    server: 'text-[#00ff00]',
    inherit: 'text-[#ffff55]',
    none: 'text-[#ff5555]',
  }[chatKeySource];

  const addImageModel = () => {
    const model = newImageModel.trim();
    if (!model) return;
    const exists = imageModelOptions.some((option) => option.value === model);
    if (!exists) {
      updateConfig('customImageModels', addModelToList(config.customImageModels, model));
    }
    updateConfig('model', model);
    setNewImageModel('');
  };

  const addChatModel = () => {
    const model = newChatModel.trim();
    if (!model) return;
    const exists = chatModelOptions.some((option) => option.value === model);
    if (!exists) {
      updateConfig('customChatModels', addModelToList(config.customChatModels, model));
    }
    updateConfig('chatModel', model);
    setNewChatModel('');
  };

  const deleteImageModel = (model: string) => {
    updateConfig('customImageModels', removeModelFromList(config.customImageModels, model));
    if (config.model === model) updateConfig('model', IMAGE_MODEL_PRESETS[0].value);
  };

  const deleteChatModel = (model: string) => {
    updateConfig('customChatModels', removeModelFromList(config.customChatModels, model));
    if (config.chatModel === model) updateConfig('chatModel', CHAT_MODEL_PRESETS[0].value);
    if (config.titleModel === model) updateConfig('titleModel', CHAT_MODEL_PRESETS[0].value);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-black w-full max-w-3xl max-h-[88vh] flex flex-col border-2 border-[#AAA] font-mono text-sm">
        <div className="bg-[#0A0] text-white px-2 py-1 flex items-center justify-between gap-2 shrink-0">
          <span>设置</span>
          <button onClick={onClose} className="text-white hover:text-[#ff5555] cursor-pointer">
            [X]
          </button>
        </div>

        <div className="p-3 overflow-y-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <fieldset className={fieldsetClass}>
              <legend className="text-[#00aaaa] px-2">连接配置</legend>
              <div className="space-y-3">
                <div>
                  <label className={labelClass} htmlFor="cfg-baseurl">Image Base URL</label>
                  <input
                    id="cfg-baseurl"
                    type="text"
                    value={config.baseUrl}
                    onChange={(e) => updateConfig('baseUrl', e.target.value)}
                    placeholder="留空使用服务端默认"
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className={`${labelClass} flex items-center gap-2`}>
                    Image API Key
                    <span className={`${keySourceColor} text-xs`}>● {keySourceLabel}</span>
                  </label>
                  <div className="flex min-w-0">
                    <input
                      type={showKey ? 'text' : 'password'}
                      value={config.apiKey}
                      onChange={(e) => updateConfig('apiKey', e.target.value)}
                      placeholder="留空使用服务端默认 Key"
                      className="flex-1 min-w-0 bg-black border-2 border-[#AAA] focus:border-[#00aaaa] text-[#CCC] text-sm py-1 px-2 outline-none font-mono"
                    />
                    <button onClick={() => setShowKey(!showKey)} className="btn-retro px-2 text-xs shrink-0">
                      {showKey ? '隐藏' : '显示'}
                    </button>
                  </div>
                </div>

                <div className="pt-2 border-t border-[#444]">
                  <label className={labelClass} htmlFor="cfg-chat-baseurl">Chat Base URL</label>
                  <input
                    id="cfg-chat-baseurl"
                    type="text"
                    value={config.chatBaseUrl}
                    onChange={(e) => updateConfig('chatBaseUrl', e.target.value)}
                    placeholder="留空时回落到 Image Base URL"
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className={`${labelClass} flex items-center gap-2`}>
                    Chat API Key
                    <span className={`${chatKeySourceColor} text-xs`}>● {chatKeySourceLabel}</span>
                  </label>
                  <div className="flex min-w-0">
                    <input
                      type={showChatKey ? 'text' : 'password'}
                      value={config.chatApiKey}
                      onChange={(e) => updateConfig('chatApiKey', e.target.value)}
                      placeholder="留空时回落到 Image API Key"
                      className="flex-1 min-w-0 bg-black border-2 border-[#AAA] focus:border-[#00aaaa] text-[#CCC] text-sm py-1 px-2 outline-none font-mono"
                    />
                    <button onClick={() => setShowChatKey(!showChatKey)} className="btn-retro px-2 text-xs shrink-0">
                      {showChatKey ? '隐藏' : '显示'}
                    </button>
                  </div>
                </div>
              </div>
            </fieldset>

            <fieldset className={fieldsetClass}>
              <legend className="text-[#00aaaa] px-2">模型</legend>
              <div className="space-y-3">
                <div>
                  <label className={labelClass}>Image Model</label>
                  <div className="space-y-1">
                    <select
                      value={imageModelIsOption ? config.model : '__current__'}
                      onChange={(e) => {
                        if (e.target.value !== '__current__') updateConfig('model', e.target.value);
                      }}
                      className={selectClass}
                    >
                      {!imageModelIsOption && <option value="__current__">{config.model}</option>}
                      {imageModelOptions.map(m => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </select>
                    <div className="flex min-w-0">
                      <input
                        type="text"
                        value={newImageModel}
                        onChange={(e) => setNewImageModel(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addImageModel(); } }}
                        placeholder="添加图片模型"
                        className="flex-1 min-w-0 bg-black border-2 border-[#AAA] focus:border-[#00aaaa] text-[#CCC] text-sm py-1 px-2 outline-none font-mono"
                      />
                      <button onClick={addImageModel} className="btn-retro px-2 text-xs shrink-0">
                        添加
                      </button>
                    </div>
                    {config.customImageModels.length > 0 && (
                      <div className="space-y-1">
                        {config.customImageModels.map((model) => (
                          <div key={model} className="flex min-w-0 items-center gap-2 border-2 border-[#444] bg-black px-2 py-1">
                            <span className="min-w-0 flex-1 truncate text-xs text-[#CCC]">{model}</span>
                            <button onClick={() => deleteImageModel(model)} className="text-xs text-[#ff5555] hover:text-white cursor-pointer">
                              删除
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <label className={labelClass}>Chat Model</label>
                  <div className="space-y-1">
                    <select
                      value={chatModelIsOption ? config.chatModel : '__current__'}
                      onChange={(e) => {
                        if (e.target.value !== '__current__') updateConfig('chatModel', e.target.value);
                      }}
                      className={selectClass}
                    >
                      {!chatModelIsOption && <option value="__current__">{config.chatModel}</option>}
                      {chatModelOptions.map(m => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </select>
                    <div className="flex min-w-0">
                      <input
                        type="text"
                        value={newChatModel}
                        onChange={(e) => setNewChatModel(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addChatModel(); } }}
                        placeholder="添加聊天模型"
                        className="flex-1 min-w-0 bg-black border-2 border-[#AAA] focus:border-[#00aaaa] text-[#CCC] text-sm py-1 px-2 outline-none font-mono"
                      />
                      <button onClick={addChatModel} className="btn-retro px-2 text-xs shrink-0">
                        添加
                      </button>
                    </div>
                    {config.customChatModels.length > 0 && (
                      <div className="space-y-1">
                        {config.customChatModels.map((model) => (
                          <div key={model} className="flex min-w-0 items-center gap-2 border-2 border-[#444] bg-black px-2 py-1">
                            <span className="min-w-0 flex-1 truncate text-xs text-[#CCC]">{model}</span>
                            <button onClick={() => deleteChatModel(model)} className="text-xs text-[#ff5555] hover:text-white cursor-pointer">
                              删除
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <label className={labelClass}>Title Model</label>
                  <div className="space-y-1">
                    <select
                      value={titleModelIsOption ? config.titleModel : '__current__'}
                      onChange={(e) => {
                        if (e.target.value !== '__current__') updateConfig('titleModel', e.target.value);
                      }}
                      className={selectClass}
                    >
                      {!titleModelIsOption && <option value="__current__">{config.titleModel}</option>}
                      {chatModelOptions.map(m => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </select>
                    <p className={hintClass}>用于第一轮回复后自动总结聊天标题</p>
                  </div>
                </div>

                <div>
                  <label className={labelClass}>System Prompt</label>
                  <textarea
                    value={config.systemPrompt}
                    onChange={(e) => updateConfig('systemPrompt', e.target.value)}
                    rows={4}
                    placeholder="仅聊天模式使用"
                    className={`${inputClass} resize-y min-h-24`}
                  />
                </div>
              </div>
            </fieldset>

            <fieldset className={`${fieldsetClass} lg:col-span-2`}>
              <legend className="text-[#00aaaa] px-2">图像参数</legend>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                <div className="sm:col-span-2 lg:col-span-1">
                  <label className={labelClass}>Size</label>
                  <select
                    value={(customSize || !sizeIsPreset) ? '__custom__' : config.size}
                    onChange={(e) => {
                      if (e.target.value === '__custom__') {
                        setCustomSize(true);
                      } else {
                        setCustomSize(false);
                        updateConfig('size', e.target.value);
                      }
                    }}
                    className={selectClass}
                  >
                    <optgroup label="AUTO">
                      {SIZE_PRESETS.filter(s => s.group === 'AUTO').map(s => (
                        <option key={s.value} value={s.value}>{s.value === ORIGINAL_ASPECT_SIZE ? originalAspectLabel : s.label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="1K">
                      {SIZE_PRESETS.filter(s => s.group === '1K').map(s => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="2K">
                      {SIZE_PRESETS.filter(s => s.group === '2K').map(s => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="4K">
                      {SIZE_PRESETS.filter(s => s.group === '4K').map(s => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </optgroup>
                    <option value="__custom__">自定义...</option>
                  </select>
                  {(customSize || !sizeIsPreset) && (
                    <input
                      type="text"
                      value={config.size}
                      onChange={(e) => updateConfig('size', e.target.value)}
                      placeholder="WxH"
                      className={`${inputClass} mt-1`}
                    />
                  )}
                </div>

                <div>
                  <label className={labelClass}>N</label>
                  <select
                    value={config.n}
                    onChange={(e) => updateConfig('n', parseInt(e.target.value, 10))}
                    className={selectClass}
                  >
                    {[1, 2, 3, 4, 5, 10, 20].map(v => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={labelClass}>Quality</label>
                  <select value={config.quality} onChange={(e) => updateConfig('quality', e.target.value)} className={selectClass}>
                    {QUALITY_OPTIONS.map(q => (
                      <option key={q} value={q}>{q}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={labelClass}>Format</label>
                  <select value={config.format} onChange={(e) => updateConfig('format', e.target.value)} className={selectClass}>
                    {FORMAT_OPTIONS.map(f => (
                      <option key={f} value={f}>{f.toUpperCase()}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={labelClass}>Background</label>
                  <select value={config.background} onChange={(e) => updateConfig('background', e.target.value)} className={selectClass}>
                    {BACKGROUND_OPTIONS.map(b => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={labelClass}>Moderation</label>
                  <select value={config.moderation} onChange={(e) => updateConfig('moderation', e.target.value)} className={selectClass}>
                    {MODERATION_OPTIONS.map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>

                {(config.format === 'jpeg' || config.format === 'webp') && (
                  <div>
                    <label className={labelClass}>Compression</label>
                    <label className="flex items-center gap-2 bg-[#AAA] text-black border-2 border-[#999] text-sm py-1 px-2 font-mono">
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={config.compression}
                        onChange={(e) => updateConfig('compression', parseInt(e.target.value, 10))}
                        className="flex-1 accent-[#00aaaa]"
                      />
                      <span className="w-7 text-right">{config.compression}</span>
                    </label>
                  </div>
                )}
              </div>
            </fieldset>

            <fieldset className={`${fieldsetClass} lg:col-span-2`}>
              <legend className="text-[#00aaaa] px-2">运行设置</legend>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
                <div className="bg-black px-2 py-2 space-y-3">
                  <div className="min-h-[58px]">
                    <label className={labelClass}>请求超时（秒）</label>
                    <input
                      type="number"
                      value={options.timeout}
                      onChange={(e) => updateOption('timeout', Math.max(10, Math.min(3600, parseInt(e.target.value, 10) || 600)))}
                      className={inputClass}
                    />
                    <p className={hintClass}>10-3600</p>
                  </div>

                  <div className="min-h-[58px]">
                    <label className={labelClass}>上下文数量限制</label>
                    <select
                      value={options.contextLimit}
                      onChange={(e) => updateOption('contextLimit', Math.max(0, Math.min(5, parseInt(e.target.value, 10) || 0)))}
                      className={selectClass}
                    >
                      {[0, 1, 2, 3, 4, 5].map(v => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                    </select>
                    <p className={hintClass}>0 表示不带上下文，最多保留最近 5 轮对话</p>
                  </div>
                </div>

                <div className="bg-black px-2 py-2 space-y-3">
                  <label className={optionRowClass}>
                    <span className="text-xs text-[#CCC]">渐进加载</span>
                    <input
                      type="checkbox"
                      checked={options.streaming}
                      onChange={(e) => updateOption('streaming', e.target.checked)}
                      className={toggleClass}
                    />
                  </label>

                  <label className={optionRowClass}>
                    <span className="text-xs text-[#CCC]">提交后清空参考图</span>
                    <input
                      type="checkbox"
                      checked={options.clearOnSubmit}
                      onChange={(e) => updateOption('clearOnSubmit', e.target.checked)}
                      className={toggleClass}
                    />
                  </label>

                  <label className={optionRowClass}>
                    <span className="text-xs text-[#CCC]">重启后加载上次 Prompt</span>
                    <input
                      type="checkbox"
                      checked={options.persistPrompt}
                      onChange={(e) => updateOption('persistPrompt', e.target.checked)}
                      className={toggleClass}
                    />
                  </label>
                </div>
              </div>
            </fieldset>

            <fieldset className="tui-fieldset border-[#aa0000] lg:col-span-2">
              <legend className="text-[#ff5555] px-2">数据管理</legend>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <p className="text-xs text-[#ff5555] flex-1">
                  清除 localStorage 中保存的配置、设置项和历史记录，并刷新页面。
                </p>
                <button
                  onClick={() => {
                    if (confirm('确认清除所有本地数据？这会删除 API URL / Key / 模型 / 设置项 / 历史记录，并刷新页面。')) {
                      clearAll();
                    }
                  }}
                  className="w-full sm:w-auto py-1 px-3 bg-[#aa0000] hover:bg-[#aa0000] text-white text-xs cursor-pointer border-2 border-[#aaaaaa] shadow-[4px_4px_0_#aaaaaa] active:shadow-none active:bg-[#880000]"
                >
                  清除并刷新
                </button>
              </div>
            </fieldset>
          </div>
        </div>
      </div>
    </div>
  );
}
