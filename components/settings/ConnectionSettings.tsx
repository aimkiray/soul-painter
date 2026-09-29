'use client';

import React, { useState } from 'react';
import { useConfig } from '@/contexts/ConfigContext';
import {
  fieldsetClass,
  legendClass,
  labelClass,
  inputClass,
  hintClass,
  firstProviderHeadingClass,
  providerHeadingClass,
  addRowInputClass,
  addRowButtonClass,
} from './styles';

export default function ConnectionSettings() {
  const {
    config,
    updateConfig,
    keySource,
    chatKeySource,
    claudeKeySource,
    serverAccessRequired,
    serverAccessConfigured,
  } = useConfig();
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
    url: 'text-theme-dim',
    user: 'text-theme-dim',
    server: 'text-theme-fg',
    none: 'text-error',
  }[keySource];

  const chatKeySourceLabel = {
    user: '自定义',
    server: '服务端默认',
    inherit: '继承图像配置',
    none: '未配置',
  }[chatKeySource];

  const chatKeySourceColor = {
    user: 'text-theme-dim',
    server: 'text-theme-fg',
    inherit: 'text-theme-dim',
    none: 'text-error',
  }[chatKeySource];

  const claudeKeySourceLabel = {
    user: '自定义',
    server: '服务端默认',
    none: '未配置',
  }[claudeKeySource];

  const claudeKeySourceColor = {
    user: 'text-theme-dim',
    server: 'text-theme-fg',
    none: 'text-error',
  }[claudeKeySource];

  return (
    <fieldset className={fieldsetClass}>
              <legend className={legendClass}>连接配置</legend>
              <div className="space-y-12">
                {(serverAccessRequired || serverAccessConfigured) && (
                  <div>
                    <label className={labelClass} htmlFor="cfg-server-access-token">服务端访问令牌</label>
                    <input
                      id="cfg-server-access-token"
                      type="password"
                      value={config.serverAccessToken}
                      onChange={(e) => updateConfig('serverAccessToken', e.target.value)}
                      placeholder="由部署者提供的 SERVER_ACCESS_TOKEN"
                      className={inputClass}
                    />
                    <p className={hintClass}>
                      {serverAccessRequired ? '使用服务端默认 API Key 时必须填写。' : '仅在服务端启用访问令牌时需要。'}
                    </p>
                  </div>
                )}
                <div>
                  <div className={firstProviderHeadingClass}>
                    <span>图像</span>
                  </div>

                  <div className="space-y-8">
                    <div>
                      <label className={labelClass} htmlFor="cfg-baseurl">Base URL</label>
                      <input
                        id="cfg-baseurl"
                        type="text"
                        value={config.baseUrl}
                        onChange={(e) => updateConfig('baseUrl', e.target.value)}
                        placeholder="https://api.openai.com/v1"
                        className={inputClass}
                      />
                    </div>

                    <div>
                      <label className={`${labelClass} flex items-center gap-2`}>
                        API Key
                        <span className={`${keySourceColor} font-mono text-body-10`}>● {keySourceLabel}</span>
                      </label>
                      <div className="flex min-w-0 gap-4">
                        <input
                          type={showKey ? 'text' : 'password'}
                          aria-label="图像 API Key"
                          value={config.apiKey}
                          onChange={(e) => updateConfig('apiKey', e.target.value)}
                          placeholder="留空使用默认 Key"
                          className={addRowInputClass}
                        />
                        <button onClick={() => setShowKey(!showKey)} className={addRowButtonClass}>
                          {showKey ? '隐藏' : '显示'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <div className={providerHeadingClass}>
                    <span>OpenAI Compatible</span>
                  </div>

                  <div className="space-y-8">
                    <div>
                      <label className={labelClass} htmlFor="cfg-chat-baseurl">Base URL</label>
                      <input
                        id="cfg-chat-baseurl"
                        type="text"
                        value={config.chatBaseUrl}
                        onChange={(e) => updateConfig('chatBaseUrl', e.target.value)}
                        placeholder="https://api.openai.com/v1"
                        className={inputClass}
                      />
                    </div>

                    <div>
                      <label className={`${labelClass} flex items-center gap-2`}>
                        API Key
                        <span className={`${chatKeySourceColor} font-mono text-body-10`}>● {chatKeySourceLabel}</span>
                      </label>
                      <div className="flex min-w-0 gap-4">
                        <input
                          type={showChatKey ? 'text' : 'password'}
                          aria-label="OpenAI API Key"
                          value={config.chatApiKey}
                          onChange={(e) => updateConfig('chatApiKey', e.target.value)}
                          placeholder="留空使用默认 Key"
                          className={addRowInputClass}
                        />
                        <button onClick={() => setShowChatKey(!showChatKey)} className={addRowButtonClass}>
                          {showChatKey ? '隐藏' : '显示'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <div className={providerHeadingClass}>
                    <span>Claude Compatible</span>
                  </div>

                  <div className="space-y-8">
                    <div>
                      <label className={labelClass} htmlFor="cfg-claude-baseurl">Base URL</label>
                      <input
                        id="cfg-claude-baseurl"
                        type="text"
                        value={config.claudeBaseUrl}
                        onChange={(e) => updateConfig('claudeBaseUrl', e.target.value)}
                        placeholder="https://api.anthropic.com/v1"
                        className={inputClass}
                      />
                    </div>

                    <div>
                      <label className={`${labelClass} flex items-center gap-2`}>
                        API Key
                        <span className={`${claudeKeySourceColor} font-mono text-body-10`}>● {claudeKeySourceLabel}</span>
                      </label>
                      <div className="flex min-w-0 gap-4">
                        <input
                          type={showClaudeKey ? 'text' : 'password'}
                          aria-label="Claude API Key"
                          value={config.claudeApiKey}
                          onChange={(e) => updateConfig('claudeApiKey', e.target.value)}
                          placeholder="留空使用默认 Key"
                          className={addRowInputClass}
                        />
                        <button onClick={() => setShowClaudeKey(!showClaudeKey)} className={addRowButtonClass}>
                          {showClaudeKey ? '隐藏' : '显示'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <p className={hintClass}>
                  聊天会按所选模型自动使用对应连接配置。
                </p>
              </div>
            </fieldset>
  );
}
