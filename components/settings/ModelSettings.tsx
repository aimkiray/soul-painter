'use client';

import React, { useState } from 'react';
import { useConfig } from '@/contexts/ConfigContext';
import {
  IMAGE_MODEL_PRESETS,
} from '@/lib/constants';
import { addModelToList, getModelFallback, mergeModelOptions, removeModelFromList } from '@/lib/model-options';
import {
  encodeChatModelChoice,
  getActiveChatModel,
  getAllChatModelOptions,
  getChatFormatForModel,
  getClaudeChatModelOptions,
  getOpenAIChatModelOptions,
  parseChatModelChoice,
} from '@/lib/chat-config';

import MenuSelect, { type MenuSelectGroup } from '@/components/MenuSelect';
import {
  fieldsetClass,
  legendClass,
  labelClass,
  inputClass,
  hintClass,
  providerHeadingClass,
  addRowInputClass,
  addRowButtonClass,
} from './styles';

export default function ModelSettings() {
  const { config, updateConfig, modelDefaults } = useConfig();
  const [newImageModel, setNewImageModel] = useState('');
  const [newChatModel, setNewChatModel] = useState('');
  const [newClaudeModel, setNewClaudeModel] = useState('');

  const imageModelOptions = mergeModelOptions(IMAGE_MODEL_PRESETS, config.customImageModels);
  const openAIChatModelOptions = getOpenAIChatModelOptions(config);
  const claudeModelOptions = getClaudeChatModelOptions(config);
  const allChatModelOptions = getAllChatModelOptions(config);
  const imageModelIsOption = imageModelOptions.some(m => m.value === config.model);
  const activeChatModel = getActiveChatModel(config);
  const activeChatApiFormat = getChatFormatForModel(config, activeChatModel);
  const activeChatChoice = encodeChatModelChoice(activeChatApiFormat, activeChatModel);
  const activeChatProviderLabel = activeChatApiFormat === 'claude' ? 'Claude Compatible' : 'OpenAI Compatible';
  const chatModelIsOption = allChatModelOptions.some(m => m.format === activeChatApiFormat && m.value === activeChatModel);
  const titleModelIsOption = openAIChatModelOptions.some(m => m.value === config.titleModel);
  const claudeTitleModelIsOption = claudeModelOptions.some(m => m.value === config.claudeTitleModel);
  const imageModelGroups: MenuSelectGroup[] = [{
    options: [
      ...(imageModelIsOption ? [] : [{ value: config.model, label: config.model }]),
      ...imageModelOptions.map(m => ({ value: m.value, label: m.label })),
    ],
  }];
  const chatModelGroups: MenuSelectGroup[] = [
    { options: chatModelIsOption ? [] : [{ value: activeChatChoice, label: activeChatModel }] },
    {
      label: 'OpenAI Compatible',
      options: openAIChatModelOptions.map(m => ({ value: encodeChatModelChoice('openai', m.value), label: m.label })),
    },
    {
      label: 'Claude Compatible',
      options: claudeModelOptions.map(m => ({ value: encodeChatModelChoice('claude', m.value), label: m.label })),
    },
  ].filter(group => group.options.length > 0);
  const titleModelGroups: MenuSelectGroup[] = [{
    options: [
      ...(titleModelIsOption ? [] : [{ value: config.titleModel, label: config.titleModel }]),
      ...openAIChatModelOptions.map(m => ({ value: m.value, label: m.label })),
    ],
  }];
  const claudeTitleModelGroups: MenuSelectGroup[] = [{
    options: [
      ...(claudeTitleModelIsOption ? [] : [{ value: config.claudeTitleModel, label: config.claudeTitleModel }]),
      ...claudeModelOptions.map(m => ({ value: m.value, label: m.label })),
    ],
  }];
  const selectChatModel = (value: string) => {
    const choice = parseChatModelChoice(value);
    if (!choice) return;
    updateConfig('chatApiFormat', choice.format);
    updateConfig('chatModel', choice.model);
    if (choice.format === 'claude') updateConfig('claudeModel', choice.model);
  };

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
    const exists = openAIChatModelOptions.some((option) => option.value === model);
    if (!exists) {
      updateConfig('customChatModels', addModelToList(config.customChatModels, model));
    }
    updateConfig('chatApiFormat', 'openai');
    updateConfig('chatModel', model);
    setNewChatModel('');
  };

  const addClaudeModel = () => {
    const model = newClaudeModel.trim();
    if (!model) return;
    const exists = claudeModelOptions.some((option) => option.value === model);
    if (!exists) {
      updateConfig('customClaudeModels', addModelToList(config.customClaudeModels, model));
    }
    updateConfig('chatApiFormat', 'claude');
    updateConfig('chatModel', model);
    updateConfig('claudeModel', model);
    setNewClaudeModel('');
  };

  const deleteImageModel = (model: string) => {
    updateConfig('customImageModels', removeModelFromList(config.customImageModels, model));
    if (config.model === model) updateConfig('model', IMAGE_MODEL_PRESETS[0].value);
  };

  const deleteChatModel = (model: string) => {
    updateConfig('customChatModels', removeModelFromList(config.customChatModels, model));
    const fallbackModel = getModelFallback(openAIChatModelOptions, modelDefaults.openAIChatModel, model);
    if (activeChatApiFormat === 'openai' && config.chatModel === model) {
      updateConfig('chatApiFormat', 'openai');
      updateConfig('chatModel', fallbackModel);
    }
    if (config.titleModel === model) {
      updateConfig('titleModel', getModelFallback(openAIChatModelOptions, modelDefaults.openAITitleModel, model));
    }
  };

  const deleteClaudeModel = (model: string) => {
    updateConfig('customClaudeModels', removeModelFromList(config.customClaudeModels, model));
    const fallbackModel = getModelFallback(claudeModelOptions, modelDefaults.claudeChatModel, model);
    const fallbackTitleModel = getModelFallback(claudeModelOptions, modelDefaults.claudeTitleModel, model);
    if (config.claudeModel === model) updateConfig('claudeModel', fallbackModel);
    if (activeChatApiFormat === 'claude' && config.chatModel === model) {
      updateConfig('chatApiFormat', 'claude');
      updateConfig('chatModel', fallbackModel);
    }
    if (config.claudeTitleModel === model) updateConfig('claudeTitleModel', fallbackTitleModel);
  };
  return (
    <fieldset className={fieldsetClass}>
              <legend className={legendClass}>模型</legend>
              <div className="space-y-8">
                <div>
                  <span className={labelClass}>图片模型</span>
                  <div className="space-y-4">
                    <MenuSelect
                      ariaLabel="图片模型"
                      value={config.model}
                      groups={imageModelGroups}
                      onSelect={(v) => updateConfig('model', v)}
                    />
                    <div className="flex min-w-0 gap-4">
                      <input
                        type="text"
                        value={newImageModel}
                        onChange={(e) => setNewImageModel(e.target.value)}
                        onKeyDown={(e) => { if (e.nativeEvent.isComposing) return; if (e.key === 'Enter') { e.preventDefault(); addImageModel(); } }}
                        aria-label="添加图片模型"
                        placeholder="添加图片模型"
                        className={addRowInputClass}
                      />
                      <button onClick={addImageModel} className={addRowButtonClass}>
                        添加
                      </button>
                    </div>
                    {config.customImageModels.length > 0 && (
                      <div className="space-y-4">
                        {config.customImageModels.map((model) => (
                          <div key={model} className="flex min-w-0 items-center gap-8 px-8 py-4 ring-1 ring-theme-fg/30">
                            <span className="min-w-0 flex-1 truncate font-mono text-body-10 text-theme-fg">{model}</span>
                            <button onClick={() => deleteImageModel(model)} className="cursor-pointer font-mono text-body-10 uppercase text-error hover:text-theme-fg">
                              删除
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <span className={labelClass}>聊天模型</span>
                  <div className="space-y-4">
                    <MenuSelect
                      ariaLabel="聊天模型"
                      value={activeChatChoice}
                      groups={chatModelGroups}
                      onSelect={selectChatModel}
                    />
                    <p className={hintClass}>当前会使用 {activeChatProviderLabel} 连接配置</p>
                  </div>
                </div>

                <div>
                  <div className={providerHeadingClass}>
                    <span>OpenAI Compatible</span>
                  </div>
                  <div className="space-y-4">
                    <span className={labelClass}>标题模型</span>
                    <MenuSelect
                      ariaLabel="标题模型（OpenAI）"
                      value={config.titleModel}
                      groups={titleModelGroups}
                      onSelect={(v) => updateConfig('titleModel', v)}
                    />
                    <p className={hintClass}>用于第一轮回复后自动总结聊天标题</p>
                    <div className="flex min-w-0 gap-4">
                      <input
                        type="text"
                        value={newChatModel}
                        onChange={(e) => setNewChatModel(e.target.value)}
                        onKeyDown={(e) => { if (e.nativeEvent.isComposing) return; if (e.key === 'Enter') { e.preventDefault(); addChatModel(); } }}
                        aria-label="添加 OpenAI Compatible 模型"
                        placeholder="添加 OpenAI Compatible 模型"
                        className={addRowInputClass}
                      />
                      <button onClick={addChatModel} className={addRowButtonClass}>
                        添加
                      </button>
                    </div>
                    {config.customChatModels.length > 0 && (
                      <div className="space-y-4">
                        {config.customChatModels.map((model) => (
                          <div key={model} className="flex min-w-0 items-center gap-8 px-8 py-4 ring-1 ring-theme-fg/30">
                            <span className="min-w-0 flex-1 truncate font-mono text-body-10 text-theme-fg">{model}</span>
                            <button onClick={() => deleteChatModel(model)} className="cursor-pointer font-mono text-body-10 uppercase text-error hover:text-theme-fg">
                              删除
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <div className={providerHeadingClass}>
                    <span>Claude Compatible</span>
                  </div>
                  <div className="space-y-4">
                    <span className={labelClass}>标题模型</span>
                    <MenuSelect
                      ariaLabel="标题模型（Claude）"
                      value={config.claudeTitleModel}
                      groups={claudeTitleModelGroups}
                      onSelect={(v) => updateConfig('claudeTitleModel', v)}
                    />
                    <p className={hintClass}>Claude 格式下用于第一轮回复后自动总结聊天标题</p>
                    <div className="flex min-w-0 gap-4">
                      <input
                        type="text"
                        value={newClaudeModel}
                        onChange={(e) => setNewClaudeModel(e.target.value)}
                        onKeyDown={(e) => { if (e.nativeEvent.isComposing) return; if (e.key === 'Enter') { e.preventDefault(); addClaudeModel(); } }}
                        aria-label="添加 Claude 模型"
                        placeholder="添加 Claude 模型"
                        className={addRowInputClass}
                      />
                      <button onClick={addClaudeModel} className={addRowButtonClass}>
                        添加
                      </button>
                    </div>
                    {config.customClaudeModels.length > 0 && (
                      <div className="space-y-4">
                        {config.customClaudeModels.map((model) => (
                          <div key={model} className="flex min-w-0 items-center gap-8 px-8 py-4 ring-1 ring-theme-fg/30">
                            <span className="min-w-0 flex-1 truncate font-mono text-body-10 text-theme-fg">{model}</span>
                            <button onClick={() => deleteClaudeModel(model)} className="cursor-pointer font-mono text-body-10 uppercase text-error hover:text-theme-fg">
                              删除
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <span className={labelClass}>系统提示词</span>
                  <textarea
                    aria-label="系统提示词"
                    value={config.systemPrompt}
                    onChange={(e) => updateConfig('systemPrompt', e.target.value)}
                    rows={4}
                    placeholder="仅聊天模式使用"
                    className={`${inputClass} resize-y min-h-24`}
                  />
                </div>
              </div>
            </fieldset>
  );
}
