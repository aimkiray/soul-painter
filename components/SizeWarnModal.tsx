'use client';

import React, { useEffect } from 'react';

interface SizeWarnModalProps {
  open: boolean;
  size: string;
  onClose: () => void;
  onSwitch: () => void;
}

export default function SizeWarnModal({ open, size, onClose, onSwitch }: SizeWarnModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-black w-full max-w-md border-2 border-[#aa8800] font-mono text-sm">
        <div className="bg-[#A40] text-white px-2 py-1">
          警告
        </div>
        <div className="p-3">
          <h3 className="text-[#ffff55] font-bold">尺寸需要 gpt-image-2-pro</h3>
          <p className="text-[#CCC] text-xs mt-1">
            你当前选择 <code className="bg-black px-1 text-[#00aaaa]">gpt-image-2</code>，
            但请求尺寸 <span className="text-[#ffff55] font-mono">{size}</span> 仅
            <code className="bg-black px-1 text-[#00aaaa]">gpt-image-2-pro</code> 支持。
          </p>
          <p className="text-[#CCC] text-xs mt-1">
            继续生成会被后端压回 1024 等小尺寸。
          </p>
          <div className="flex justify-end gap-2 mt-3">
            <button onClick={onClose} className="btn-retro px-3 py-1 text-xs">
              保持 image-2
            </button>
            <button onClick={onSwitch} className="btn-retro bg-[#00aaaa] text-xs px-3 py-1">
              切到 image-2-pro
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
