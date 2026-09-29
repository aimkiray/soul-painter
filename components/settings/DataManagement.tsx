'use client';

import React, { useState } from 'react';
import { useConfig } from '@/contexts/ConfigContext';

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
    <fieldset className="min-w-0 rounded-2 px-12 pb-12 pt-8 ring-1 ring-error/60 lg:col-span-2">
              <legend className="-ml-2 bg-theme-bg px-4 font-mono text-body-10 uppercase text-error">数据管理</legend>
              <div className="flex flex-col gap-12 sm:flex-row sm:items-center">
                <p className="flex-1 text-body-10 text-error">
                  {confirmClearLocalData
                    ? '再次确认会清除本机保存的设置、聊天记录、草稿、历史、能力缓存和浏览器本地缓存，然后刷新页面。服务端 .env 不会受影响。'
                    : '清除本机保存的设置、聊天记录、草稿、历史、能力缓存和浏览器本地缓存。用于开发期处理不兼容更新。'}
                </p>
                <div className="flex w-full gap-8 sm:w-auto">
                  {confirmClearLocalData && (
                    <button
                      type="button"
                      onClick={() => setConfirmClearLocalData(false)}
                      disabled={clearingLocalData}
                      className="flex-1 cursor-pointer px-12 py-6 font-mono text-body-10 uppercase text-theme-dim ring-1 ring-theme-fg/30 hover:bg-theme-fg/10 disabled:opacity-60 sm:flex-none"
                    >
                      取消
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleClearLocalData}
                    disabled={clearingLocalData}
                    className="flex-1 cursor-pointer border border-transparent bg-error px-12 py-6 font-mono text-body-10 uppercase text-black hover:border-error hover:bg-transparent hover:text-error disabled:cursor-wait disabled:opacity-60 sm:flex-none"
                  >
                    {clearingLocalData ? '清除中...' : confirmClearLocalData ? '确认清除' : '清除本地数据'}
                  </button>
                </div>
              </div>
            </fieldset>
  );
}
