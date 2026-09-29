'use client';

/* eslint-disable @next/next/no-img-element */

import React, { useEffect, useRef, useState } from 'react';
import { useImages } from '@/contexts/ImageContext';
import type { ImageRef } from '@/types';
import { COMPOSER_FRAME_CLASS } from '@/lib/layout';
import { canvasHasStrokes } from '@/lib/mask';

interface ImageGridProps {
  layout: 'strip' | 'sidebar';
}

// maskHasStrokes is persisted by persistMask; for refs written before that
// field existed, fall back to a single canvas scan. canvasHasStrokes walks
// every pixel, so the legacy-ref result is cached per objectUrl.
const maskScanCache = new Map<string, boolean>();

function imageHasMaskStrokes(img: ImageRef): boolean {
  if (!img.maskCanvas) return false;
  if (img.maskHasStrokes !== undefined) return img.maskHasStrokes;
  const key = img.objectUrl || '';
  const cached = maskScanCache.get(key);
  if (cached !== undefined) return cached;
  const result = canvasHasStrokes(img.maskCanvas);
  maskScanCache.set(key, result);
  return result;
}

const Placeholder = ({ className }: { className?: string }) => (
  <div className={`flex items-center justify-center border border-dashed border-theme-fg/30 ${className || ''}`}>
    <span className="animate-pulse font-mono text-body-10 uppercase text-theme-muted motion-reduce:animate-none">处理中</span>
  </div>
);

const COMPRESSED_BADGE_MS = 3000;

function ThumbnailEditButton({
  index,
  onEdit,
}: {
  index: number;
  onEdit: (index: number) => void;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onEdit(index);
      }}
      className="absolute inset-x-0 bottom-0 flex h-22 cursor-pointer items-center justify-center border-t border-theme-fg/30 bg-theme-bg/80 font-mono text-body-10 uppercase text-theme-fg hover:bg-theme-fg hover:text-theme-bg"
      aria-label={`编辑第 ${index + 1} 张图片`}
    >
      编辑
    </button>
  );
}

export default function ImageGrid({ layout }: ImageGridProps) {
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
  if (layout === 'sidebar') {
    return (
      <div className="flex h-full w-256 shrink-0 flex-col border-l border-theme-fg/30 bg-theme-bg font-mono">
        {/* window title bar */}
        <div className="flex h-26 shrink-0 items-center justify-between gap-4 border-b border-theme-fg/30 px-8">
          <span className="truncate">
            ~/refs
            {selectedCount > 0 && <span className="ml-4 text-theme-muted">已选 {selectedCount}</span>}
          </span>
          <button
            onClick={() => { const indices = [...selectedIndices].sort((a, b) => b - a); indices.forEach((idx) => removeImage(idx)); }}
            className="hit-y-4 cursor-pointer text-body-10 uppercase text-error disabled:cursor-not-allowed disabled:opacity-40"
            disabled={selectedCount === 0}
          >
            删除选中
          </button>
        </div>

        <div className="scroll-fade-y flex-1 overflow-y-auto p-8">
          <div className="grid grid-cols-2 gap-4">
            {images.map((img, i) => {
              const isSelected = selectedIndices.has(i);
              const hasMask = imageHasMaskStrokes(img);
              const showCompressedBadge = compressedBadgeUrls.has(img.objectUrl);
              return (
                <button
                  key={img.objectUrl || `image-${i}`}
                  type="button"
                  onClick={() => toggleSelect(i)}
                  aria-pressed={isSelected}
                  aria-label={`参考图 ${i + 1}`}
                  className={`relative aspect-square w-full cursor-pointer overflow-hidden bg-theme-bg ring-1 ${isSelected ? 'ring-theme-fg' : 'ring-theme-fg/30'}`}
                >
                  <img
                    src={img.objectUrl} alt=""
                    className="h-full w-full object-cover"
                    loading="lazy" decoding="async"
                  />
                  {hasMask && (
                    <canvas
                      ref={(el) => { if (!el || !img.maskCanvas) return; el.width = img.maskCanvas.width; el.height = img.maskCanvas.height; el.getContext('2d')!.drawImage(img.maskCanvas, 0, 0, img.maskCanvas.width, img.maskCanvas.height); }}
                      className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-50"
                    />
                  )}
                  <span className="absolute left-2 top-2 flex h-12 items-center bg-theme-bg/80 px-2 text-body-10 text-theme-fg ring-1 ring-theme-fg/30">#{i + 1}</span>
                  {isSelected && <span className="absolute right-2 top-2 size-10 bg-theme-fg"></span>}
                  {showCompressedBadge && <span className="absolute right-2 top-16 flex h-12 items-center bg-theme-bg/80 px-2 text-body-10 text-theme-dim ring-1 ring-theme-fg/30">已缩小</span>}
                  {hasMask && <span className={`absolute left-2 flex items-center bg-theme-fg px-2 py-2 text-body-10 leading-none text-theme-bg ${isSelected ? 'bottom-24' : 'bottom-2'}`}>mask</span>}
                  {isSelected && <ThumbnailEditButton index={i} onEdit={openEditor} />}
                </button>
              );
            })}
            {pendingCount > 0 && Array.from({ length: pendingCount }).map((_, i) => (
              <Placeholder key={`ph-${i}`} className="aspect-square" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`${COMPOSER_FRAME_CLASS} border-t border-theme-fg/30 pb-8 font-mono`}>
      <div className="flex items-center justify-between gap-8 py-6">
        <span className="flex items-center gap-8">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="hit-y-4 cursor-pointer text-body-10 uppercase text-theme-fg"
            aria-expanded={!collapsed}
          >
            {collapsed ? '~/refs ▸' : '~/refs ▾'}
          </button>
          {selectedCount > 0 && (
            <span className="text-body-10 uppercase text-theme-muted">已选 {selectedCount}</span>
          )}
        </span>
        <span className="flex items-center gap-8">
          <button onClick={() => { const indices = [...selectedIndices].sort((a, b) => b - a); indices.forEach((idx) => removeImage(idx)); }} className="hit-y-4 cursor-pointer text-body-10 uppercase text-error disabled:cursor-not-allowed disabled:opacity-40" disabled={selectedCount === 0}>删除选中</button>
        </span>
      </div>

      {!collapsed && (
        <div className="scroll-fade-x -mx-2 flex items-center gap-6 overflow-x-auto px-2 py-4">
          {images.map((img, i) => {
            const isSelected = selectedIndices.has(i);
            const showCompressedBadge = compressedBadgeUrls.has(img.objectUrl);
            return (
              <button
                key={img.objectUrl || `image-${i}`}
                type="button"
                onClick={() => toggleSelect(i)}
                aria-pressed={isSelected}
                aria-label={`参考图 ${i + 1}`}
                className="relative shrink-0"
              >
                <img
                  src={img.objectUrl}
                  alt=""
                  className={`size-64 cursor-pointer object-cover ring-1 ${isSelected ? 'ring-theme-fg' : 'ring-theme-fg/30'}`}
                  loading="lazy" decoding="async"
                />
                {img.maskCanvas && imageHasMaskStrokes(img) && (
                  <canvas
                    ref={(el) => { if (!el || !img.maskCanvas) return; el.width = img.maskCanvas.width; el.height = img.maskCanvas.height; el.getContext('2d')!.drawImage(img.maskCanvas, 0, 0, img.maskCanvas.width, img.maskCanvas.height); }}
                    className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-50"
                  />
                )}
                <span className="absolute left-2 top-2 flex h-12 items-center bg-theme-bg/80 px-2 text-body-10 text-theme-fg ring-1 ring-theme-fg/30">#{i + 1}</span>
                {isSelected && <span className="absolute right-2 top-2 size-10 bg-theme-fg"></span>}
                {showCompressedBadge && <span className="absolute right-2 top-16 flex h-12 items-center bg-theme-bg/80 px-2 text-body-10 text-theme-dim ring-1 ring-theme-fg/30">已缩小</span>}
                {isSelected && <ThumbnailEditButton index={i} onEdit={openEditor} />}
              </button>
            );
          })}
          {pendingCount > 0 && Array.from({ length: pendingCount }).map((_, i) => (
            <Placeholder key={`mph-${i}`} className="size-64 shrink-0" />
          ))}
        </div>
      )}
    </div>
  );
}
