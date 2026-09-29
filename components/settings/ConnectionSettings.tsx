'use client';

import React, { useState } from 'react';
import { useConfig } from '@/contexts/ConfigContext';
import { useI18n } from '@/contexts/I18nContext';
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
  const { t } = useI18n();
  const [showKey, setShowKey] = useState(false);
  const [showChatKey, setShowChatKey] = useState(false);
  const [showClaudeKey, setShowClaudeKey] = useState(false);

  const keySourceLabel = t(({
    url: 'srcUrl',
    user: 'srcUser',
    server: 'srcServer',
    none: 'srcNone',
  } as const)[keySource]);

  const keySourceColor = {
    url: 'text-theme-dim',
    user: 'text-theme-dim',
    server: 'text-theme-fg',
    none: 'text-error',
  }[keySource];

  const chatKeySourceLabel = t(({
    user: 'srcUser',
    server: 'srcServer',
    inherit: 'srcInherit',
    none: 'srcNone',
  } as const)[chatKeySource]);

  const chatKeySourceColor = {
    user: 'text-theme-dim',
    server: 'text-theme-fg',
    inherit: 'text-theme-dim',
    none: 'text-error',
  }[chatKeySource];

  const claudeKeySourceLabel = t(({
    user: 'srcUser',
    server: 'srcServer',
    none: 'srcNone',
  } as const)[claudeKeySource]);

  const claudeKeySourceColor = {
    user: 'text-theme-dim',
    server: 'text-theme-fg',
    none: 'text-error',
  }[claudeKeySource];

  return (
    <fieldset className={fieldsetClass}>
              <legend className={legendClass}>{t('connConfig')}</legend>
              <div className="space-y-12">
                {(serverAccessRequired || serverAccessConfigured) && (
                  <div>
                    <label className={labelClass} htmlFor="cfg-server-access-token">{t('serverToken')}</label>
                    <input
                      id="cfg-server-access-token"
                      type="password"
                      value={config.serverAccessToken}
                      onChange={(e) => updateConfig('serverAccessToken', e.target.value)}
                      placeholder={t('serverTokenPh')}
                      className={inputClass}
                    />
                    <p className={hintClass}>
                      {serverAccessRequired ? t('serverTokenRequired') : t('serverTokenHint')}
                    </p>
                  </div>
                )}
                <div>
                  <div className={firstProviderHeadingClass}>
                    <span>{t('imageSection')}</span>
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
                          aria-label={t('imageApiKey')}
                          value={config.apiKey}
                          onChange={(e) => updateConfig('apiKey', e.target.value)}
                          placeholder={t('emptyUseDefault')}
                          className={addRowInputClass}
                        />
                        <button onClick={() => setShowKey(!showKey)} className={addRowButtonClass}>
                          {showKey ? t('hide') : t('show')}
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
                          placeholder={t('emptyUseDefault')}
                          className={addRowInputClass}
                        />
                        <button onClick={() => setShowChatKey(!showChatKey)} className={addRowButtonClass}>
                          {showChatKey ? t('hide') : t('show')}
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
                          placeholder={t('emptyUseDefault')}
                          className={addRowInputClass}
                        />
                        <button onClick={() => setShowClaudeKey(!showClaudeKey)} className={addRowButtonClass}>
                          {showClaudeKey ? t('hide') : t('show')}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <p className={hintClass}>
                  {t('autoConnHint')}
                </p>
              </div>
            </fieldset>
  );
}
