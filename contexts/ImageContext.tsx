'use client';

import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { ImageRef } from '@/types';
import { compressIfNeeded } from '@/lib/compress';
import { imageRefToEditBlob } from '@/lib/image-edit';
import { canvasHasStrokes } from '@/lib/mask';

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

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
  selectAll: () => void;
  deselectAll: () => void;
  hasImages: boolean;
  anyMasked: boolean;
  persistMask: (canvas: HTMLCanvasElement) => void;
  buildEditsForm: (imgs: ImageRef[], prompt: string, size: string | null, model: string) => Promise<FormData>;
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
  const [compressing, setCompressing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const safeSelectedIndices = useMemo(
    () => pruneSelectedIndices(selectedIndices, images.length),
    [selectedIndices, images.length],
  );
  const safeEditingIndex = editingIndex >= 0 && editingIndex < images.length ? editingIndex : -1;

  const addFiles = useCallback(async (fileList: FileList | File[]) => {
    const candidates = Array.from(fileList).filter(
      (f: File) => f && f.type && f.type.startsWith('image/')
    );
    if (candidates.length === 0) return;

    setPendingCount(candidates.length);
    setCompressing(true);
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

    setImages((prev) => {
      const updated = [...prev, ...newImages];
      const newIndices = new Set<number>();
      for (let i = prev.length; i < updated.length; i++) newIndices.add(i);
      setSelectedIndices((prevSel) => {
        const merged = new Set(pruneSelectedIndices(prevSel, prev.length));
        newIndices.forEach((idx) => merged.add(idx));
        return merged;
      });
      return updated;
    });
    setPendingCount(0);
    setCompressing(false);
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

  const selectAll = useCallback(() => {
    setSelectedIndices(new Set(images.map((_, i) => i)));
  }, [images]);

  const deselectAll = useCallback(() => {
    setSelectedIndices(new Set());
  }, []);

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
    setImages((prev) => {
      const updated = [...prev];
      const img = updated[editingIndex];
      if (!img || !img.naturalWidth) return prev;
      const out = document.createElement('canvas');
      out.width = img.naturalWidth;
      out.height = img.naturalHeight;
      out.getContext('2d')!.drawImage(canvas, 0, 0, out.width, out.height);
      updated[editingIndex] = { ...img, maskCanvas: canvasHasStrokes(out) ? out : null };
      return updated;
    });
  }, [editingIndex]);

  const buildEditsForm = useCallback(async (
    imgs: ImageRef[], prompt: string, size: string | null, model: string
  ): Promise<FormData> => {
    const form = new FormData();
    form.append('model', model);
    form.append('prompt', prompt);
    if (size) form.append('size', size);

    const imageBlobs = await Promise.all(imgs.map(imageRefToEditBlob));
    imageBlobs.forEach((blob, i) => {
      if (!blob) return;
      const ext = blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png';
      form.append('image[]', blob, `image-${i + 1}.${ext}`);
    });

    const first = imgs[0];
    if (first?.maskCanvas && first.naturalWidth && canvasHasStrokes(first.maskCanvas)) {
      const mask = await canvasToBlob(first.maskCanvas);
      if (mask) form.append('mask', mask, 'mask.png');
    }
    return form;
  }, []);

  const hasImages = images.length > 0 || pendingCount > 0;
  const anyMasked = images.some((im) => im.maskCanvas && canvasHasStrokes(im.maskCanvas));

  const value = useMemo(() => ({
    images, editingIndex: safeEditingIndex, selectedIndices: safeSelectedIndices, compressing, pendingCount,
    addFiles, removeImage, openEditor, closeEditor, clearAll, toggleSelect, selectAll, deselectAll,
    hasImages, anyMasked, persistMask,
    buildEditsForm,
  }), [images, safeEditingIndex, safeSelectedIndices, compressing, pendingCount,
    addFiles, removeImage, openEditor, closeEditor, clearAll, toggleSelect, selectAll, deselectAll,
    hasImages, anyMasked, persistMask,
    buildEditsForm]);

  return <ImageContext.Provider value={value}>{children}</ImageContext.Provider>;
}

export function useImages() {
  const ctx = useContext(ImageContext);
  if (!ctx) throw new Error('useImages must be used within ImageProvider');
  return ctx;
}
