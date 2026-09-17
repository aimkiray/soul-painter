'use client';

import React, { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { ImageRef } from '@/types';
import { compressIfNeeded } from '@/lib/compress';
import { canvasHasStrokes } from '@/lib/mask';

interface ImageContextValue {
  images: ImageRef[];
  editingIndex: number;
  selectedIndices: Set<number>;
  compressing: boolean;
  pendingCount: number;
  addFiles: (fileList: FileList | File[]) => Promise<void>;
  removeImage: (i: number) => void;
  openEditor: (i: number) => void;
  closeEditor: () => void;
  clearAll: () => void;
  toggleSelect: (i: number) => void;
  hasImages: boolean;
  persistMask: (canvas: HTMLCanvasElement) => void;
}

const ImageContext = createContext<ImageContextValue | undefined>(undefined);

function pruneSelectedIndices(indices: Set<number>, imageCount: number) {
  let changed = false;
  const next = new Set<number>();
  for (const index of indices) {
    if (index >= 0 && index < imageCount) {
      next.add(index);
    } else {
      changed = true;
    }
  }
  return changed ? next : indices;
}

export function ImageProvider({ children }: { children: React.ReactNode }) {
  const [images, setImages] = useState<ImageRef[]>([]);
  const [editingIndex, setEditingIndex] = useState(-1);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [pendingCount, setPendingCount] = useState(0);
  const [compressingCount, setCompressingCount] = useState(0);
  const imagesRef = useRef<ImageRef[]>(images);
  const pendingAppendedRef = useRef(0);
  const safeSelectedIndices = useMemo(
    () => pruneSelectedIndices(selectedIndices, images.length),
    [selectedIndices, images.length],
  );
  const safeEditingIndex = editingIndex >= 0 && editingIndex < images.length ? editingIndex : -1;
  const compressing = compressingCount > 0;

  useEffect(() => {
    imagesRef.current = images;
    pendingAppendedRef.current = 0;
  }, [images]);

  const addFiles = useCallback(async (fileList: FileList | File[]) => {
    const candidates = Array.from(fileList).filter(
      (f: File) => f && f.type && f.type.startsWith('image/')
    );
    if (candidates.length === 0) return;

    setPendingCount((count) => count + candidates.length);
    setCompressingCount((count) => count + 1);
    try {
      const results = await Promise.all(candidates.map(compressIfNeeded));
      const newImages: ImageRef[] = results.map(({ file, originalSize, compressed, naturalWidth, naturalHeight }) => ({
        file,
        objectUrl: URL.createObjectURL(file),
        naturalWidth,
        naturalHeight,
        maskCanvas: null,
        compressed,
        originalSize,
      }));

      const startIndex = imagesRef.current.length + pendingAppendedRef.current;
      pendingAppendedRef.current += newImages.length;
      setImages((prev) => [...prev, ...newImages]);
      setSelectedIndices((prevSel) => {
        const merged = new Set(pruneSelectedIndices(prevSel, startIndex));
        for (let i = startIndex; i < startIndex + newImages.length; i++) merged.add(i);
        return merged;
      });
    } catch (error) {
      console.warn('图片处理失败，已丢弃本批次文件', error);
    } finally {
      setPendingCount((count) => Math.max(0, count - candidates.length));
      setCompressingCount((count) => Math.max(0, count - 1));
    }
  }, []);

  const toggleSelect = useCallback((i: number) => {
    if (i < 0 || i >= images.length) return;
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }, [images.length]);

  const removeImage = useCallback((i: number) => {
    if (i < 0 || i >= images.length) return;
    setImages((prev) => {
      const img = prev[i];
      if (img?.objectUrl) URL.revokeObjectURL(img.objectUrl);
      const updated = [...prev];
      updated.splice(i, 1);
      return updated;
    });
    setEditingIndex((prev) => {
      if (prev === i) return -1;
      if (prev > i) return prev - 1;
      return prev;
    });
    setSelectedIndices((prev) => {
      const next = new Set<number>();
      for (const idx of prev) {
        if (idx === i) continue;
        next.add(idx > i ? idx - 1 : idx);
      }
      return next;
    });
  }, [images.length]);

  const openEditor = useCallback((i: number) => {
    if (i < 0 || i >= images.length) return;
    setEditingIndex(i);
  }, [images.length]);

  const closeEditor = useCallback(() => {
    setEditingIndex(-1);
  }, []);

  const clearAll = useCallback(() => {
    images.forEach((img) => { if (img.objectUrl) URL.revokeObjectURL(img.objectUrl); });
    setImages([]);
    setEditingIndex(-1);
    setSelectedIndices(new Set());
  }, [images]);

  const persistMask = useCallback((canvas: HTMLCanvasElement) => {
    if (editingIndex < 0) return;
    const img = imagesRef.current[editingIndex];
    if (!img) return;
    if (!img.naturalWidth) {
      console.warn('persistMask: 图片缺少 naturalWidth，已丢弃本次蒙版');
      return;
    }
    const out = document.createElement('canvas');
    out.width = img.naturalWidth;
    out.height = img.naturalHeight;
    out.getContext('2d')!.drawImage(canvas, 0, 0, out.width, out.height);
    const hasStrokes = canvasHasStrokes(out);
    setImages((prev) => {
      const updated = [...prev];
      const target = updated[editingIndex];
      if (!target) return prev;
      updated[editingIndex] = { ...target, maskCanvas: hasStrokes ? out : null, maskHasStrokes: hasStrokes };
      return updated;
    });
  }, [editingIndex]);

  const hasImages = images.length > 0 || pendingCount > 0;

  const value = useMemo(() => ({
    images, editingIndex: safeEditingIndex, selectedIndices: safeSelectedIndices, compressing, pendingCount,
    addFiles, removeImage, openEditor, closeEditor, clearAll, toggleSelect,
    hasImages, persistMask,
  }), [images, safeEditingIndex, safeSelectedIndices, compressing, pendingCount,
    addFiles, removeImage, openEditor, closeEditor, clearAll, toggleSelect,
    hasImages, persistMask]);

  return <ImageContext.Provider value={value}>{children}</ImageContext.Provider>;
}

export function useImages() {
  const ctx = useContext(ImageContext);
  if (!ctx) throw new Error('useImages must be used within ImageProvider');
  return ctx;
}
