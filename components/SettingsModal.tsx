'use client';

import React, { useEffect, useRef } from 'react';
import { useConfig } from '@/contexts/ConfigContext';
import { useWindowDrag } from '@/hooks/useWindowDrag';
import Modal from './Modal';

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
  const { dragStyle, onTitlePointerDown } = useWindowDrag();

  useEffect(() => {
    if (prevOpen.current && !open) {
      saveConfig();
      saveOptions();
    }
    prevOpen.current = open;
  }, [open, saveConfig, saveOptions]);

  if (!open) return null;

  return (
    <Modal
      id="settings"
      onClose={onClose}
      ariaLabel="设置"
      backdropClassName="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-16 backdrop-blur-xs"
      panelClassName="flex max-h-full w-full max-w-2xl flex-col bg-theme-bg font-mono text-body-14 text-theme-fg ring-1 ring-theme-fg/30"
      panelStyle={dragStyle}
    >
      {/* window title bar — drag handle */}
      <div
        className="flex h-26 shrink-0 cursor-grab touch-none items-center justify-between gap-4 border-b border-theme-fg/30 px-8"
        onPointerDown={onTitlePointerDown}
            title="拖拽移动 · 双击复位"
      >
        <span className="truncate">~/config</span>
        <button
          type="button"
          onClick={onClose}
          onPointerDown={(event) => event.stopPropagation()}
          className="hit-x-4 hit-y-4 flex size-16 shrink-0 cursor-pointer items-center justify-center rounded-full border border-transparent bg-theme-fg text-theme-bg hover:border-theme-fg hover:bg-transparent hover:text-theme-fg"
          aria-label="关闭配置"
        >
          <svg viewBox="0 0 24 24" className="size-full shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>

      <div className="scroll-fade-y min-h-0 flex-1 overflow-y-auto p-12">
        <div className="flex flex-col gap-12">
          <ConnectionSettings />
          <ModelSettings />
          <ImageParamSettings />
          <RuntimeSettings />
          <DataManagement />
        </div>
      </div>
    </Modal>
  );
}
