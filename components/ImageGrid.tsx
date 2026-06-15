'use client';

/* eslint-disable @next/next/no-img-element */

import React, { useEffect, useRef, useState } from 'react';
import { useImages } from '@/contexts/ImageContext';
import { canvasHasStrokes } from '@/lib/mask';

const Placeholder = ({ className }: { className?: string }) => (
  <div className={`bg-black border-2 border-dashed border-[#555] flex items-center justify-center ${className || ''}`}>
    <svg viewBox="0 0 100 100" className="w-3/4 h-3/4 animate-pulse">
      <text x="50" y="54" textAnchor="middle" fontSize="14" fill="#888">处理中</text>
    </svg>
  </div>
);

const COMPRESSED_BADGE_MS = 3000;

function ThumbnailEditButton({ index, onEdit }: { index: number; onEdit: (index: number) => void }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onEdit(index);
      }}
      className="absolute inset-x-0 bottom-0 h-7 bg-black/70 border-x-2 border-b-2 border-[#00aaaa] text-[#00aaaa] text-xs font-mono flex items-center justify-center cursor-pointer hover:bg-[#111] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00aaaa] focus-visible:ring-inset"
      aria-label={`编辑第 ${index + 1} 张图片`}
    >
      编辑
    </button>
  );
}

export default function ImageGrid() {
  const { images, openEditor, removeImage, selectedIndices, toggleSelect, pendingCount } = useImages();
  const [collapsed, setCollapsed] = useState(false);
  const [compressedBadgeUrls, setCompressedBadgeUrls] = useState<Set<string>>(new Set());
  const seenCompressedUrlsRef = useRef<Set<string>>(new Set());
  const compressedBadgeTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const activeUrls = new Set(images.map((img) => img.objectUrl));

    for (const [url, timer] of compressedBadgeTimersRef.current) {
      if (!activeUrls.has(url)) {
        clearTimeout(timer);
        compressedBadgeTimersRef.current.delete(url);
      }
    }

    for (const url of seenCompressedUrlsRef.current) {
      if (!activeUrls.has(url)) seenCompressedUrlsRef.current.delete(url);
    }

    const newBadgeUrls: string[] = [];
    images.forEach((img) => {
      if (!img.compressed || !img.objectUrl || seenCompressedUrlsRef.current.has(img.objectUrl)) return;
      seenCompressedUrlsRef.current.add(img.objectUrl);
      newBadgeUrls.push(img.objectUrl);

      const timer = setTimeout(() => {
        setCompressedBadgeUrls((prev) => {
          if (!prev.has(img.objectUrl)) return prev;
          const next = new Set(prev);
          next.delete(img.objectUrl);
          return next;
        });
        compressedBadgeTimersRef.current.delete(img.objectUrl);
      }, COMPRESSED_BADGE_MS);

      compressedBadgeTimersRef.current.set(img.objectUrl, timer);
    });

    setCompressedBadgeUrls((prev) => {
      let changed = false;
      const next = new Set(prev);

      for (const url of next) {
        if (!activeUrls.has(url)) {
          next.delete(url);
          changed = true;
        }
      }

      newBadgeUrls.forEach((url) => {
        if (!next.has(url)) {
          next.add(url);
          changed = true;
        }
      });

      return changed ? next : prev;
    });
  }, [images]);

  useEffect(() => {
    const badgeTimers = compressedBadgeTimersRef.current;
    return () => {
      badgeTimers.forEach((timer) => clearTimeout(timer));
      badgeTimers.clear();
    };
  }, []);

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
            const showCompressedBadge = compressedBadgeUrls.has(img.objectUrl);
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
                {showCompressedBadge && <span className="absolute top-4 right-0.5 bg-[#A40] text-white text-[0.7rem] px-0.5 leading-none h-3 flex items-center">已缩小</span>}
                {hasMask && <span className={`absolute left-0.5 bg-[#ff5555] text-white text-[0.7rem] px-0.5 py-0.5 leading-none ${isSelected ? 'bottom-7' : 'bottom-0.5'}`}>涂抹</span>}
                {isSelected && <ThumbnailEditButton index={i} onEdit={openEditor} />}
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
    <div className="w-[calc(100%-12px)] md:w-full max-w-3xl mx-[6px] md:mx-auto bg-black border-t border-[#AAA] pb-2">
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
              const showCompressedBadge = compressedBadgeUrls.has(img.objectUrl);
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
                  {showCompressedBadge && <span className="absolute top-4 right-0.5 bg-[#A40] text-white text-[0.7rem] px-0.5 leading-none h-3 flex items-center">已缩小</span>}
                  {isSelected && <ThumbnailEditButton index={i} onEdit={openEditor} />}
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
