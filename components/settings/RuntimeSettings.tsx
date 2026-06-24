'use client';

import React from 'react';
import { useConfig } from '@/contexts/ConfigContext';


export const fieldsetClass = 'tui-fieldset border-[#AAA] min-w-0';
export const labelClass = 'block text-xs text-[#CCC] mb-0.5';
export const inputClass = 'w-full bg-black border-2 border-[#AAA] focus:border-[#00aaaa] text-[#CCC] text-sm py-1 px-2 outline-none font-mono';
export const selectClass = 'w-full bg-[#AAA] text-black border-2 border-[#999] text-sm py-1 px-1 cursor-pointer font-mono';
export const hintClass = 'text-xs text-[#888] mt-1';
export const providerHeadingClass = 'flex items-center justify-between gap-2 pt-2 border-t border-[#444] text-xs text-[#00aaaa]';
export const toggleClass = 'shrink-0 w-5 h-5 appearance-none border-2 border-[#AAA] bg-black checked:bg-[#00aaaa] checked:border-[#00aaaa] cursor-pointer';
export const optionRowClass = 'flex items-center justify-between gap-3 bg-black cursor-pointer select-none';

export default function RuntimeSettings() {
  const { options, updateOption } = useConfig();


  return (
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
  );
}
