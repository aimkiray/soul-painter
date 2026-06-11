'use client';

import React, { useState } from 'react';
import { useImages } from '@/contexts/ImageContext';
import { canvasHasStrokes } from '@/lib/mask';

const Placeholder = ({ className }: { className?: string }) => (
  <div className={`bg-black border-2 border-dashed border-[#555] flex items-center justify-center ${className || ''}`}>
    <svg viewBox="0 0 100 100" className="w-3/4 h-3/4 animate-pulse">
      <text x="50" y="54" textAnchor="middle" fontSize="14" fill="#888">处理中</text>
    </svg>
  </div>
);

export default function ImageGrid() {
  const { images, openEditor, removeImage, batchMode, setBatchMode, clearAll, selectedIndex, selectImage, compressing, pendingCount } = useImages();
  const [collapsed, setCollapsed] = useState(false);

  if (images.length === 0 && pendingCount === 0) return null;

  // ── Desktop sidebar ──
  const sidebar = (
    <div className="bg-black border-[#AAA] font-mono text-xs flex flex-col h-full">
      <div className="flex items-center justify-between px-2 py-1 border-b border-[#AAA] shrink-0">
        <span className="text-[#00aaaa] font-bold">图片</span>
        <button onClick={() => clearAll()} className="text-[#ff5555] hover:text-[#ff5555] text-xs">清空图片</button>
      </div>

      {/* Action bar — shows when an image is selected */}
      {selectedIndex >= 0 && (
        <div className="flex flex-wrap items-center gap-2 px-2 py-1.5 shrink-0">
          <button onClick={() => openEditor(selectedIndex)} className="btn-retro text-xs px-3 py-1 md:flex-1 lg:flex-none text-center">
            编辑
          </button>
          <button onClick={() => removeImage(selectedIndex)} className="btn-retro bg-[#aa0000] text-white text-xs px-3 py-1 md:flex-1 lg:flex-none text-center hover:bg-[#880000]">移除</button>
          <button onClick={() => selectImage(selectedIndex)} className="btn-retro text-xs px-3 py-1 md:w-full lg:w-auto lg:ml-auto">取消选择</button>
        </div>
      )}

      <div className="overflow-y-auto flex-1 p-2 space-y-1">
        <div className="grid grid-cols-2 gap-1">
          {images.map((img, i) => {
            const isSelected = selectedIndex === i;
            return (
              <div
                key={i}
                onClick={() => selectImage(i)}
                className={`relative aspect-square overflow-hidden bg-black cursor-pointer border-2 ${isSelected ? 'border-[#00aaaa]' : 'border-[#CCC]'}`}
              >
                <img src={img.objectUrl} alt={`ref ${i + 1}`} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                {img.maskCanvas && canvasHasStrokes(img.maskCanvas) && (
                  <canvas
                    ref={(el) => { if (!el || !img.maskCanvas) return; el.width = img.maskCanvas.width; el.height = img.maskCanvas.height; el.getContext('2d')!.drawImage(img.maskCanvas, 0, 0, img.maskCanvas.width, img.maskCanvas.height); }}
                    className="absolute inset-0 w-full h-full object-cover opacity-50 pointer-events-none"
                  />
                )}
                <span className="absolute top-0.5 left-0.5 bg-black/80 text-white text-[10px] px-1">#{i + 1}</span>
                <span className="absolute top-0.5 right-0.5 flex flex-col gap-0.5 items-end">
                  {isSelected && <span className="bg-[#00aaaa] text-black text-[10px] px-1 py-0.5 leading-none">已选中</span>}
                  {img.maskCanvas && canvasHasStrokes(img.maskCanvas) && <span className="bg-[#ff5555] text-white text-[10px] px-1 py-0.5 leading-none">已涂抹</span>}
                </span>
                <span className="absolute bottom-0.5 right-0.5 bg-black/70 text-white text-[10px] px-1 leading-none">
                  {(img.file.size / 1024 / 1024).toFixed(1)}M
                </span>
              </div>
            );
          })}
          {pendingCount > 0 && Array.from({ length: pendingCount }).map((_, i) => (
            <Placeholder key={`ph-${i}`} className="aspect-square" />
          ))}
        </div>

        {images.length >= 2 && (
          <label className="flex items-center gap-2 py-1 cursor-pointer select-none">
            <input type="checkbox" checked={batchMode} onChange={(e) => setBatchMode(e.target.checked)}
              className="shrink-0 w-3.5 h-3.5 appearance-none border-2 border-[#AAA] bg-black checked:bg-[#00aaaa] checked:border-[#00aaaa] cursor-pointer" />
            <span className="text-[#888] text-xs mt-0.5">批量处理（每张图片独立请求）</span>
          </label>
        )}
      </div>
    </div>
  );

  // ── Mobile horizontal scroll strip ──
  const mobileStrip = (
    <div className="bg-black border-t border-[#AAA] pb-2">
      {/* Header bar */}
      <div className="flex items-center justify-between gap-2 px-2 sm:px-3 py-1.5">
        <span className="flex items-center gap-2">
          <button onClick={() => setCollapsed(!collapsed)} className="text-xs sm:text-sm text-white font-mono cursor-pointer">
            {collapsed ? '图片 ▸' : '图片 ▾'}
          </button>
          {selectedIndex >= 0 && (
            <span className="text-[#00aaaa] text-xs sm:text-sm font-mono">已选中 #{selectedIndex + 1}</span>
          )}
        </span>
        <button onClick={() => clearAll()} className="text-xs sm:text-sm text-[#ff5555] font-mono cursor-pointer">清空图片</button>
      </div>

      {!collapsed && (
        <>
          {/* Action bar — always visible when an image is selected */}
          {selectedIndex >= 0 && (
            <div className="flex items-center gap-2 px-2 sm:px-3 py-1.5 bg-[#111] border-t border-[#333]">
              <button
                onClick={() => { openEditor(selectedIndex); }}
                className="bg-[#00aaaa] text-black text-xs px-3 py-1 cursor-pointer font-mono"
              >
                编辑
              </button>
              <button
                onClick={() => { removeImage(selectedIndex); }}
                className="bg-[#aa0000] text-white text-xs px-3 py-1 cursor-pointer font-mono"
              >
                移除
              </button>
              <button
                onClick={() => { selectImage(selectedIndex); }}
                className="bg-[#AAA] text-black text-xs px-3 py-1 cursor-pointer font-mono"
              >
                取消选择
              </button>
            </div>
          )}

          {/* Thumbnail row */}
          <div className="flex items-center gap-1.5 px-2 sm:px-3 py-1 overflow-x-auto">
            {images.map((img, i) => {
              const isSelected = selectedIndex === i;
              return (
                <div key={i} className="relative shrink-0">
                  <img
                    src={img.objectUrl}
                    alt={`ref ${i + 1}`}
                    onClick={() => selectImage(i)}
                    className={`w-12 h-12 object-cover cursor-pointer border-2 ${isSelected ? 'border-[#00aaaa]' : 'border-[#AAA]'}`}
                    loading="lazy" decoding="async"
                  />
                  {img.maskCanvas && canvasHasStrokes(img.maskCanvas) && (
                    <canvas
                      ref={(el) => { if (!el || !img.maskCanvas) return; el.width = img.maskCanvas.width; el.height = img.maskCanvas.height; el.getContext('2d')!.drawImage(img.maskCanvas, 0, 0, img.maskCanvas.width, img.maskCanvas.height); }}
                      className="absolute inset-0 w-full h-full object-cover opacity-50 pointer-events-none"
                    />
                  )}
                  {isSelected && (
                    <span className="absolute top-0 right-0 bg-[#00aaaa] text-black text-[8px] w-3 h-3 flex items-center justify-center leading-none">✓</span>
                  )}
                </div>
              );
            })}
            {pendingCount > 0 && Array.from({ length: pendingCount }).map((_, i) => (
              <Placeholder key={`mph-${i}`} className="w-12 h-12 shrink-0" />
            ))}
          </div>

          {/* Batch toggle */}
          {images.length >= 2 && (
            <label className="flex items-center gap-1.5 px-2 sm:px-3 pb-1.5 cursor-pointer select-none">
              <input type="checkbox" checked={batchMode} onChange={(e) => setBatchMode(e.target.checked)}
                className="shrink-0 w-3.5 h-3.5 appearance-none border-2 border-[#AAA] bg-black checked:bg-[#00aaaa] checked:border-[#00aaaa] cursor-pointer" />
              <span className="text-[#888] text-xs font-mono mt-0.5">批量处理（每张图片独立请求）</span>
            </label>
          )}
        </>
      )}
    </div>
  );

  return (
    <>
      {/* Desktop */}
      <div className="hidden md:flex md:w-40 lg:w-56 border-l-2 border-[#AAA] shrink-0">{sidebar}</div>
      {/* Mobile */}
      <div className="md:hidden">{mobileStrip}</div>
    </>
  );
}
