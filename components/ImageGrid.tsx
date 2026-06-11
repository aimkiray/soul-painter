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
  const { images, openEditor, removeImage, selectedIndices, toggleSelect, pendingCount } = useImages();
  const [collapsed, setCollapsed] = useState(false);

  if (images.length === 0 && pendingCount === 0) return null;

  const selectedCount = selectedIndices.size;

  // ── Desktop sidebar ──
  const sidebar = (
    <div className="bg-black border-[#AAA] font-mono text-xs flex flex-col h-full">
      <div className="flex items-center justify-between px-2 py-1 border-b border-[#AAA] shrink-0">
        <span className="text-[#00aaaa] font-bold">
          图片{selectedCount > 0 && <span className="text-[#888] font-normal ml-1">已选 {selectedCount}</span>}
        </span>
        <button onClick={() => { const indices = [...selectedIndices].sort((a, b) => b - a); indices.forEach((idx) => removeImage(idx)); }} className="text-[#ff5555] hover:text-[#ff5555] text-xs cursor-pointer" disabled={selectedCount === 0}>删除选中</button>
      </div>

      <div className="overflow-y-auto flex-1 p-2 space-y-1">
        <div className="grid grid-cols-2 gap-1">
          {images.map((img, i) => {
            const isSelected = selectedIndices.has(i);
            const hasMask = img.maskCanvas && canvasHasStrokes(img.maskCanvas);
            return (
              <div
                key={i}
                onClick={() => toggleSelect(i)}
                className={`relative aspect-square overflow-hidden bg-black cursor-pointer border-2 ${isSelected ? 'border-[#00aaaa]' : 'border-[#555]'}`}
              >
                <img
                  src={img.objectUrl} alt={`ref ${i + 1}`}
                  className="w-full h-full object-cover"
                  loading="lazy" decoding="async"
                />
                {hasMask && (
                  <canvas
                    ref={(el) => { if (!el || !img.maskCanvas) return; el.width = img.maskCanvas.width; el.height = img.maskCanvas.height; el.getContext('2d')!.drawImage(img.maskCanvas, 0, 0, img.maskCanvas.width, img.maskCanvas.height); }}
                    className="absolute inset-0 w-full h-full object-cover opacity-50 pointer-events-none"
                  />
                )}
                <span className="absolute top-0.5 left-0.5 bg-black/80 text-white text-[0.7rem] px-0.5 leading-none h-3 flex items-center">#{i + 1}</span>
                {isSelected && <span className="absolute top-0.5 right-0.5 w-3 h-3 bg-[#00aaaa]"></span>}
                {hasMask && <span className="absolute bottom-0.5 left-0.5 bg-[#ff5555] text-white text-[0.7rem] px-0.5 py-0.5 leading-none">涂抹</span>}
                {isSelected && (
                    <button
                      onClick={(e) => { e.stopPropagation(); openEditor(i); }}
                      className="absolute bottom-0.5 left-0.5 bg-black/80 text-[#00aaaa] text-[0.7rem] px-0.5 py-0.5 leading-none cursor-pointer hover:text-white"
                    >edit</button>
                )}
              </div>
            );
          })}
          {pendingCount > 0 && Array.from({ length: pendingCount }).map((_, i) => (
            <Placeholder key={`ph-${i}`} className="aspect-square" />
          ))}
        </div>
      </div>
    </div>
  );

  // ── Mobile horizontal scroll strip ──
  const mobileStrip = (
    <div className="bg-black border-t border-[#AAA] pb-2">
      <div className="flex items-center justify-between gap-2 px-2 sm:px-3 py-1.5">
        <span className="flex items-center gap-2">
          <button onClick={() => setCollapsed(!collapsed)} className="text-xs sm:text-sm text-white font-mono cursor-pointer">
            {collapsed ? '图片 ▸' : '图片 ▾'}
          </button>
          {selectedCount > 0 && (
            <span className="text-[#00aaaa] text-xs sm:text-sm font-mono">已选 {selectedCount}</span>
          )}
        </span>
        <span className="flex items-center gap-2">
          <button onClick={() => { const indices = [...selectedIndices].sort((a, b) => b - a); indices.forEach((idx) => removeImage(idx)); }} className="text-xs sm:text-sm text-[#ff5555] font-mono cursor-pointer" disabled={selectedCount === 0}>删除选中</button>
        </span>
      </div>

      {!collapsed && (
          <div className="flex items-center gap-1.5 px-2 sm:px-3 py-1 overflow-x-auto">
            {images.map((img, i) => {
              const isSelected = selectedIndices.has(i);
              return (
                <div key={i} className="relative shrink-0">
                  <img
                    src={img.objectUrl}
                    alt={`ref ${i + 1}`}
                    onClick={() => toggleSelect(i)}
                    className={`w-16 h-16 object-cover cursor-pointer border-2 ${isSelected ? 'border-[#00aaaa]' : 'border-[#AAA]'}`}
                    loading="lazy" decoding="async"
                  />
                  {img.maskCanvas && canvasHasStrokes(img.maskCanvas) && (
                    <canvas
                      ref={(el) => { if (!el || !img.maskCanvas) return; el.width = img.maskCanvas.width; el.height = img.maskCanvas.height; el.getContext('2d')!.drawImage(img.maskCanvas, 0, 0, img.maskCanvas.width, img.maskCanvas.height); }}
                      className="absolute inset-0 w-full h-full object-cover opacity-50 pointer-events-none"
                    />
                  )}
                  <span className="absolute top-0.5 left-0.5 bg-black/80 text-white text-[0.7rem] px-0.5 leading-none h-3 flex items-center">#{i + 1}</span>
                  {isSelected && <span className="absolute top-0.5 right-0.5 w-3 h-3 bg-[#00aaaa]"></span>}
                  {isSelected && (
                    <button
                      onClick={(e) => { e.stopPropagation(); openEditor(i); }}
                      className="absolute bottom-0.5 left-0.5 bg-black/80 text-[#00aaaa] text-[0.7rem] px-0.5 py-0.5 leading-none cursor-pointer hover:text-white"
                    >edit</button>
                  )}
                </div>
              );
            })}
            {pendingCount > 0 && Array.from({ length: pendingCount }).map((_, i) => (
              <Placeholder key={`mph-${i}`} className="w-16 h-16 shrink-0" />
            ))}
          </div>
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
