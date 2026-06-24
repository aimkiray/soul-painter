'use client';

import React, { useState } from 'react';
import { useConfig } from '@/contexts/ConfigContext';


export const fieldsetClass = 'tui-fieldset border-[#AAA] min-w-0';
export const labelClass = 'block text-xs text-[#CCC] mb-0.5';
export const inputClass = 'w-full bg-black border-2 border-[#AAA] focus:border-[#00aaaa] text-[#CCC] text-sm py-1 px-2 outline-none font-mono';
export const selectClass = 'w-full bg-[#AAA] text-black border-2 border-[#999] text-sm py-1 px-1 cursor-pointer font-mono';
export const hintClass = 'text-xs text-[#888] mt-1';
export const providerHeadingClass = 'flex items-center justify-between gap-2 pt-2 border-t border-[#444] text-xs text-[#00aaaa]';
export const toggleClass = 'shrink-0 w-5 h-5 appearance-none border-2 border-[#AAA] bg-black checked:bg-[#00aaaa] checked:border-[#00aaaa] cursor-pointer';
export const optionRowClass = 'flex items-center justify-between gap-3 bg-black cursor-pointer select-none';

export default function ConnectionSettings() {
  const { config, updateConfig, keySource, chatKeySource, claudeKeySource } = useConfig();
  const [showKey, setShowKey] = useState(false);
  const [showChatKey, setShowChatKey] = useState(false);
  const [showClaudeKey, setShowClaudeKey] = useState(false);

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

  const claudeKeySourceLabel = {
    user: '自定义',
    server: '服务端默认',
    none: '未配置',
  }[claudeKeySource];

  const claudeKeySourceColor = {
    user: 'text-[#00aaaa]',
    server: 'text-[#00ff00]',
    none: 'text-[#ff5555]',
  }[claudeKeySource];

  return (
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

                <p className={`${hintClass} pt-2 border-t border-[#444]`}>
                  聊天会按所选模型自动使用对应连接配置；两套服务商信息会分别保存。
                </p>

                <div className={providerHeadingClass}>
                  <span>OpenAI-compatible</span>
                </div>

                <div>
                  <label className={labelClass} htmlFor="cfg-chat-baseurl">Base URL</label>
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
                    API Key
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

                <div className={providerHeadingClass}>
                  <span>Claude Messages</span>
                </div>

                <div>
                  <label className={labelClass} htmlFor="cfg-claude-baseurl">Base URL</label>
                  <input
                    id="cfg-claude-baseurl"
                    type="text"
                    value={config.claudeBaseUrl}
                    onChange={(e) => updateConfig('claudeBaseUrl', e.target.value)}
                    placeholder="留空使用服务端 Claude 默认"
                    className={inputClass}
                  />
                  <p className={hintClass}>Anthropic 官方接口通常填 https://api.anthropic.com</p>
                </div>

                <div>
                  <label className={`${labelClass} flex items-center gap-2`}>
                    API Key
                    <span className={`${claudeKeySourceColor} text-xs`}>● {claudeKeySourceLabel}</span>
                  </label>
                  <div className="flex min-w-0">
                    <input
                      type={showClaudeKey ? 'text' : 'password'}
                      value={config.claudeApiKey}
                      onChange={(e) => updateConfig('claudeApiKey', e.target.value)}
                      placeholder="留空使用服务端 Claude 默认 Key"
                      className="flex-1 min-w-0 bg-black border-2 border-[#AAA] focus:border-[#00aaaa] text-[#CCC] text-sm py-1 px-2 outline-none font-mono"
                    />
                    <button onClick={() => setShowClaudeKey(!showClaudeKey)} className="btn-retro px-2 text-xs shrink-0">
                      {showClaudeKey ? '隐藏' : '显示'}
                    </button>
                  </div>
                </div>
              </div>
            </fieldset>
  );
}
