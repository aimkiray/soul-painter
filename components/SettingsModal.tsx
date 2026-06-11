'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useConfig } from '@/contexts/ConfigContext';
import { MODEL_PRESETS, BACKGROUND_OPTIONS, MODERATION_OPTIONS } from '@/lib/constants';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { config, options, updateConfig, updateOption, saveConfig, saveOptions, clearAll, keySource, hasDefaultKey } = useConfig();
  const [showKey, setShowKey] = useState(false);
  const [customModel, setCustomModel] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');

  useEffect(() => {
    if (open) {
      setCustomModel(!MODEL_PRESETS.some(m => m.value === config.model));
    }
  }, [open, config.model]);

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

  const handleSave = () => {
    saveConfig();
    saveOptions();
    setSavedMsg('配置已保存');
    setTimeout(() => setSavedMsg(''), 2000);
  };

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-black w-full max-w-lg max-h-[85vh] flex flex-col border-2 border-[#AAA] font-mono text-sm">
        <div className="bg-[#0A0] text-white px-2 py-1 flex items-center justify-between shrink-0">
          <span>设置</span>
          <button onClick={onClose} className="text-white hover:text-[#ff5555] cursor-pointer">
            [X]
          </button>
        </div>

        <div className="p-3 space-y-3 overflow-y-auto">
          {/* API Config */}
          <fieldset className="tui-fieldset border-[#AAA]">
            <legend className="text-[#00aaaa] px-2">API 配置</legend>

            <div className="space-y-2">
              {/* Base URL */}
              <div>
                <label className="block text-xs text-[#CCC] mb-0.5" htmlFor="cfg-baseurl">Base URL</label>
                <input
                  id="cfg-baseurl"
                  type="text"
                  value={config.baseUrl}
                  onChange={(e) => updateConfig('baseUrl', e.target.value)}
                  placeholder="留空使用服务端默认"
                  className="w-full bg-black border border-[#AAA] focus:border-[#00aaaa] text-[#CCC] text-sm py-1 px-2 outline-none font-mono"
                />
              </div>

              {/* API Key */}
              <div>
                <label className="block text-xs text-[#CCC] mb-0.5 flex items-center gap-2">
                  API Key
                  <span className={`${keySourceColor} text-xs`}>
                    ● {keySourceLabel}
                  </span>
                </label>
                <div className="flex">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={config.apiKey}
                    onChange={(e) => updateConfig('apiKey', e.target.value)}
                    placeholder="留空使用服务端默认 Key"
                    className="flex-1 bg-black border border-[#AAA] focus:border-[#00aaaa] text-[#CCC] text-sm py-1 px-2 outline-none font-mono"
                  />
                  <button
                    onClick={() => setShowKey(!showKey)}
                    className="btn-retro px-2 text-xs"
                  >
                    {showKey ? '隐藏' : '显示'}
                  </button>
                </div>
              </div>

              {/* Model */}
              <div>
                <label className="block text-xs text-[#CCC] mb-0.5">Model</label>
                <div className="space-y-1">
                  <select
                    value={customModel ? '__custom__' : config.model}
                    onChange={(e) => {
                      if (e.target.value === '__custom__') {
                        setCustomModel(true);
                      } else {
                        setCustomModel(false);
                        updateConfig('model', e.target.value);
                      }
                    }}
                    className="w-full bg-[#AAA] text-black border border-[#999] text-sm py-1 px-1 cursor-pointer font-mono"
                  >
                    {MODEL_PRESETS.map(m => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                    <option value="__custom__">自定义...</option>
                  </select>
                  {customModel && (
                    <input
                      type="text"
                      value={config.model}
                      onChange={(e) => updateConfig('model', e.target.value)}
                      className="w-full bg-black border border-[#AAA] focus:border-[#00aaaa] text-[#CCC] text-sm py-1 px-2 outline-none font-mono"
                    />
                  )}
                </div>
                <p className="text-xs text-[#888] mt-1">
                  添加附件自动走图生图，无附件走文生图。
                </p>
              </div>

              {/* Background + Moderation */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-[#CCC] mb-0.5">Background</label>
                  <select
                    value={config.background}
                    onChange={(e) => updateConfig('background', e.target.value)}
                    className="w-full bg-[#AAA] text-black border border-[#999] text-sm py-1 px-1 cursor-pointer font-mono"
                  >
                    {BACKGROUND_OPTIONS.map(b => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-[#CCC] mb-0.5">Moderation</label>
                  <select
                    value={config.moderation}
                    onChange={(e) => updateConfig('moderation', e.target.value)}
                    className="w-full bg-[#AAA] text-black border border-[#999] text-sm py-1 px-1 cursor-pointer font-mono"
                  >
                    {MODERATION_OPTIONS.map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                {savedMsg && <span className="text-xs text-[#0a0]">{savedMsg}</span>}
                <button onClick={handleSave} className="ml-auto btn-retro px-3 py-1 text-xs">
                  保存到本地
                </button>
              </div>
            </div>
          </fieldset>

          {/* Options */}
          <fieldset className="tui-fieldset border-[#AAA] w-full min-w-0">
            <legend className="text-[#00aaaa] px-2">习惯配置</legend>
            <div className="space-y-2">
              <label className="flex items-center justify-between gap-3 p-1.5 bg-black cursor-pointer select-none">
                <div>
                  <span className="block text-xs text-[#CCC]">提交后清空输入框</span>
                  <span className="block text-xs text-[#888]">提交成功后会清空 Prompt 和参考图。</span>
                </div>
                <input
                  type="checkbox"
                  checked={options.clearOnSubmit}
                  onChange={(e) => updateOption('clearOnSubmit', e.target.checked)}
                  className="shrink-0 w-5 h-5 appearance-none border-2 border-[#AAA] bg-black checked:bg-[#00aaaa] checked:border-[#00aaaa] cursor-pointer"
                />
              </label>
              <label className="flex items-center justify-between gap-3 p-1.5 bg-black cursor-pointer select-none">
                <div>
                  <span className="block text-xs text-[#CCC]">重启后加载上次 Prompt</span>
                  <span className="block text-xs text-[#888]">关闭后下次启动 Prompt 输入框为空。</span>
                </div>
                <input
                  type="checkbox"
                  checked={options.persistPrompt}
                  onChange={(e) => updateOption('persistPrompt', e.target.checked)}
                  className="shrink-0 w-5 h-5 appearance-none border-2 border-[#AAA] bg-black checked:bg-[#00aaaa] checked:border-[#00aaaa] cursor-pointer"
                />
              </label>
            </div>
          </fieldset>

          {/* Timeout */}
          <fieldset className="tui-fieldset border-[#AAA]">
            <legend className="text-[#00aaaa] px-2">请求设置</legend>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-[#CCC] mb-1">请求超时（秒）</label>
                <input
                  type="number"
                  value={options.timeout}
                  onChange={(e) => updateOption('timeout', Math.max(10, Math.min(3600, parseInt(e.target.value, 10) || 600)))}
                  className="w-full bg-black border border-[#AAA] focus:border-[#00aaaa] text-[#CCC] text-sm py-1 px-2 outline-none font-mono"
                />
                <p className="text-xs text-[#888] mt-1">
                  单个请求最长等待时间。4K / pro 模型建议 ≥ 120s。
                </p>
              </div>
              <label className="flex items-center justify-between gap-3 p-1.5 bg-black cursor-pointer select-none">
                <div>
                  <span className="block text-xs text-[#CCC]">渐进加载</span>
                  <span className="block text-xs text-[#888]">启用后生成过程中会显示中间预览图。</span>
                </div>
                <input
                  type="checkbox"
                  checked={options.streaming}
                  onChange={(e) => updateOption('streaming', e.target.checked)}
                  className="shrink-0 w-5 h-5 appearance-none border-2 border-[#AAA] bg-black checked:bg-[#00aaaa] checked:border-[#00aaaa] cursor-pointer"
                />
              </label>
            </div>
          </fieldset>

          {/* Data management */}
          <fieldset className="tui-fieldset border-[#aa0000]">
            <legend className="text-[#ff5555] px-2">数据管理</legend>
            <p className="text-sm text-[#ff5555] font-bold mb-1">清除所有本地数据</p>
            <p className="text-xs text-[#ff5555] mb-2">
              清除 localStorage 中保存的全部配置，并刷新页面恢复初始状态。
            </p>
            <button
              onClick={() => {
                if (confirm('确认清除所有本地数据？这会删除 API URL / Key / 模型 / 设置项 / 历史记录，并刷新页面。')) {
                  clearAll();
                }
              }}
              className="w-full py-1 bg-[#aa0000] hover:bg-[#aa0000] text-white text-xs cursor-pointer shadow-[4px_4px_0_#aaaaaa] active:shadow-none active:bg-[#880000]"
            >
              清除并刷新
            </button>
          </fieldset>
        </div>
      </div>
    </div>
  );
}
