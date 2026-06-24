'use client';

import React, { useEffect, useRef } from 'react';
import { useConfig } from '@/contexts/ConfigContext';

import ConnectionSettings from './settings/ConnectionSettings';
import ModelSettings from './settings/ModelSettings';
import ImageParamSettings from './settings/ImageParamSettings';
import RuntimeSettings from './settings/RuntimeSettings';
import DataManagement from './settings/DataManagement';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { saveConfig, saveOptions } = useConfig();
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div 
        className="w-full max-w-2xl max-h-full flex flex-col border-2 border-[#00aaaa] bg-black font-mono text-[#CCC] shadow-[8px_8px_0_#001f1f]"
        onClick={e => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-center justify-between border-b-2 border-[#00aaaa] bg-[#0000aa] px-2 py-1 text-white">
          <span>SETTINGS</span>
          <button 
            type="button"
            onClick={onClose}
            className="cursor-pointer text-white hover:text-[#ffff55]"
            aria-label="关闭配置"
          >
            [X]
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="flex flex-col gap-4">
            <ConnectionSettings />
            <ModelSettings />
            <ImageParamSettings />
            <RuntimeSettings />
            <DataManagement />
          </div>
        </div>
      </div>
    </div>
  );
}
