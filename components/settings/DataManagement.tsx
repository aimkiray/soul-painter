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

export default function DataManagement() {
  const { clearAll } = useConfig();
  const [confirmClearLocalData, setConfirmClearLocalData] = useState(false);
  const [clearingLocalData, setClearingLocalData] = useState(false);
  const handleClearLocalData = () => {
    if (!confirmClearLocalData) {
      setConfirmClearLocalData(true);
      return;
    }
    setClearingLocalData(true);
    setTimeout(() => {
      clearAll();
      setClearingLocalData(false);
      setConfirmClearLocalData(false);
    }, 100);
  };
  return (
    <fieldset className="tui-fieldset border-[#aa0000] lg:col-span-2">
              <legend className="text-[#ff5555] px-2">数据管理</legend>
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <p className="text-xs text-[#ff5555] flex-1">
                  {confirmClearLocalData
                    ? '再次确认会清除本机保存的设置、聊天记录、草稿、历史、能力缓存和浏览器本地缓存，然后刷新页面。服务端 .env 不会受影响。'
                    : '清除本机保存的设置、聊天记录、草稿、历史、能力缓存和浏览器本地缓存。用于开发期处理不兼容更新。'}
                </p>
                <div className="flex w-full sm:w-auto gap-2">
                  {confirmClearLocalData && (
                    <button
                      type="button"
                      onClick={() => setConfirmClearLocalData(false)}
                      disabled={clearingLocalData}
                      className="flex-1 sm:flex-none py-1 px-3 bg-black text-[#CCC] text-xs cursor-pointer border-2 border-[#777] disabled:opacity-60"
                    >
                      取消
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleClearLocalData}
                    disabled={clearingLocalData}
                    className="flex-1 sm:flex-none py-1 px-3 bg-[#aa0000] hover:bg-[#aa0000] text-white text-xs cursor-pointer border-2 border-[#aaaaaa] shadow-[4px_4px_0_#aaaaaa] active:shadow-none active:bg-[#880000] disabled:opacity-60 disabled:cursor-wait"
                  >
                    {clearingLocalData ? '清除中...' : confirmClearLocalData ? '确认清除' : '清除本地数据'}
                  </button>
                </div>
              </div>
            </fieldset>
  );
}
