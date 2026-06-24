'use client';

import React, { useState } from 'react';
import { useConfig } from '@/contexts/ConfigContext';
import {
  CHAT_MODEL_PRESETS,
  CLAUDE_MODEL_PRESETS,
  IMAGE_MODEL_PRESETS,
} from '@/lib/constants';
import { addModelToList, mergeModelOptions, removeModelFromList } from '@/lib/model-options';
import {
  encodeChatModelChoice,
  getActiveChatModel,
  getAllChatModelOptions,
  getChatFormatForModel,
  getClaudeChatModelOptions,
  getOpenAIChatModelOptions,
  parseChatModelChoice,
} from '@/lib/chat-config';

export const fieldsetClass = 'tui-fieldset border-[#AAA] min-w-0';
export const labelClass = 'block text-xs text-[#CCC] mb-0.5';
export const inputClass = 'w-full bg-black border-2 border-[#AAA] focus:border-[#00aaaa] text-[#CCC] text-sm py-1 px-2 outline-none font-mono';
export const selectClass = 'w-full bg-[#AAA] text-black border-2 border-[#999] text-sm py-1 px-1 cursor-pointer font-mono';
export const hintClass = 'text-xs text-[#888] mt-1';
export const providerHeadingClass = 'flex items-center justify-between gap-2 pt-2 border-t border-[#444] text-xs text-[#00aaaa]';
export const toggleClass = 'shrink-0 w-5 h-5 appearance-none border-2 border-[#AAA] bg-black checked:bg-[#00aaaa] checked:border-[#00aaaa] cursor-pointer';
export const optionRowClass = 'flex items-center justify-between gap-3 bg-black cursor-pointer select-none';

export default function ModelSettings() {
  const { config, updateConfig } = useConfig();
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
  const activeChatProviderLabel = activeChatApiFormat === 'claude' ? 'Claude Messages' : 'OpenAI-compatible';
  const chatModelIsOption = allChatModelOptions.some(m => m.format === activeChatApiFormat && m.value === activeChatModel);
  const titleModelIsOption = openAIChatModelOptions.some(m => m.value === config.titleModel);
  const claudeTitleModelIsOption = claudeModelOptions.some(m => m.value === config.claudeTitleModel);
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
    if (activeChatApiFormat === 'openai' && config.chatModel === model) {
      updateConfig('chatApiFormat', 'openai');
      updateConfig('chatModel', CHAT_MODEL_PRESETS[0].value);
    }
    if (config.titleModel === model) updateConfig('titleModel', CHAT_MODEL_PRESETS[0].value);
  };

  const deleteClaudeModel = (model: string) => {
    updateConfig('customClaudeModels', removeModelFromList(config.customClaudeModels, model));
    if (config.claudeModel === model) updateConfig('claudeModel', CLAUDE_MODEL_PRESETS[0].value);
    if (activeChatApiFormat === 'claude' && config.chatModel === model) {
      updateConfig('chatApiFormat', 'claude');
      updateConfig('chatModel', CLAUDE_MODEL_PRESETS[0].value);
    }
    if (config.claudeTitleModel === model) updateConfig('claudeTitleModel', CLAUDE_MODEL_PRESETS[CLAUDE_MODEL_PRESETS.length - 1].value);
  };
  return (
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
                      value={activeChatChoice}
                      onChange={(e) => selectChatModel(e.target.value)}
                      className={selectClass}
                    >
                      {!chatModelIsOption && <option value={activeChatChoice}>{activeChatModel}</option>}
                      <optgroup label="OpenAI-compatible">
                        {openAIChatModelOptions.map(m => (
                          <option key={`openai:${m.value}`} value={encodeChatModelChoice('openai', m.value)}>{m.label}</option>
                        ))}
                      </optgroup>
                      <optgroup label="Claude Messages">
                        {claudeModelOptions.map(m => (
                          <option key={`claude:${m.value}`} value={encodeChatModelChoice('claude', m.value)}>{m.label}</option>
                        ))}
                      </optgroup>
                    </select>
                    <p className={hintClass}>当前会使用 {activeChatProviderLabel} 连接配置</p>
                  </div>
                </div>

                <div>
                  <div className={providerHeadingClass}>
                    <span>OpenAI-compatible</span>
                  </div>
                  <div className="space-y-1">
                    <label className={labelClass}>Title Model</label>
                    <select
                      value={titleModelIsOption ? config.titleModel : '__current__'}
                      onChange={(e) => {
                        if (e.target.value !== '__current__') updateConfig('titleModel', e.target.value);
                      }}
                      className={selectClass}
                    >
                      {!titleModelIsOption && <option value="__current__">{config.titleModel}</option>}
                      {openAIChatModelOptions.map(m => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </select>
                    <p className={hintClass}>用于第一轮回复后自动总结聊天标题</p>
                    <div className="flex min-w-0">
                      <input
                        type="text"
                        value={newChatModel}
                        onChange={(e) => setNewChatModel(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addChatModel(); } }}
                        placeholder="添加 OpenAI-compatible 模型"
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
                  <div className={providerHeadingClass}>
                    <span>Claude Messages</span>
                  </div>
                  <div className="space-y-1">
                    <label className={labelClass}>Title Model</label>
                    <select
                      value={claudeTitleModelIsOption ? config.claudeTitleModel : '__current__'}
                      onChange={(e) => {
                        if (e.target.value !== '__current__') updateConfig('claudeTitleModel', e.target.value);
                      }}
                      className={selectClass}
                    >
                      {!claudeTitleModelIsOption && <option value="__current__">{config.claudeTitleModel}</option>}
                      {claudeModelOptions.map(m => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </select>
                    <p className={hintClass}>Claude 格式下用于第一轮回复后自动总结聊天标题</p>
                    <div className="flex min-w-0">
                      <input
                        type="text"
                        value={newClaudeModel}
                        onChange={(e) => setNewClaudeModel(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addClaudeModel(); } }}
                        placeholder="添加 Claude 模型"
                        className="flex-1 min-w-0 bg-black border-2 border-[#AAA] focus:border-[#00aaaa] text-[#CCC] text-sm py-1 px-2 outline-none font-mono"
                      />
                      <button onClick={addClaudeModel} className="btn-retro px-2 text-xs shrink-0">
                        添加
                      </button>
                    </div>
                    {config.customClaudeModels.length > 0 && (
                      <div className="space-y-1">
                        {config.customClaudeModels.map((model) => (
                          <div key={model} className="flex min-w-0 items-center gap-2 border-2 border-[#444] bg-black px-2 py-1">
                            <span className="min-w-0 flex-1 truncate text-xs text-[#CCC]">{model}</span>
                            <button onClick={() => deleteClaudeModel(model)} className="text-xs text-[#ff5555] hover:text-white cursor-pointer">
                              删除
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
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
  );
}
