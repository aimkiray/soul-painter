'use client';

import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { ImageRef } from '@/types';
import { compressIfNeeded } from '@/lib/compress';
import { canvasHasStrokes, buildAlphaMaskBlob, buildMaskedComposite } from '@/lib/mask';

interface ImageContextValue {
  images: ImageRef[];
  editingIndex: number;
  selectedIndex: number;
  batchMode: boolean;
  compressing: boolean;
  pendingCount: number;
  setBatchMode: (v: boolean) => void;
  addFiles: (fileList: FileList | File[]) => Promise<void>;
  removeImage: (i: number) => void;
  openEditor: (i: number) => void;
  closeEditor: () => void;
  clearAll: () => void;
  selectImage: (i: number) => void;
  hasImages: boolean;
  anyMasked: boolean;
  persistMask: (canvas: HTMLCanvasElement) => void;
  buildEditsForm: (im: ImageRef, prompt: string, size: string | null, model: string) => Promise<FormData>;
}

const ImageContext = createContext<ImageContextValue | undefined>(undefined);

export function ImageProvider({ children }: { children: React.ReactNode }) {
  const [images, setImages] = useState<ImageRef[]>([]);
  const [editingIndex, setEditingIndex] = useState(-1);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [batchMode, setBatchMode] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

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
      return updated;
    });
    setPendingCount(0);
    setCompressing(false);
  }, []);

  const selectImage = useCallback((i: number) => {
    setSelectedIndex((prev) => prev === i ? -1 : i);
  }, []);

  const removeImage = useCallback((i: number) => {
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
    setSelectedIndex((prev) => {
      if (prev === i) return -1;
      if (prev > i) return prev - 1;
      return prev;
    });
  }, []);

  const openEditor = useCallback((i: number) => {
    setEditingIndex(i);
  }, []);

  const closeEditor = useCallback(() => {
    setEditingIndex(-1);
  }, []);

  const clearAll = useCallback(() => {
    images.forEach((img) => { if (img.objectUrl) URL.revokeObjectURL(img.objectUrl); });
    setImages([]);
    setEditingIndex(-1);
    setSelectedIndex(-1);
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
    im: ImageRef, prompt: string, size: string | null, model: string
  ): Promise<FormData> => {
    const fd = new FormData();
    fd.append('model', model);
    fd.append('prompt', prompt);
    if (size) fd.append('size', size);
    fd.append('response_format', 'b64_json');
    // image as PNG blob (matching reference)
    const pngBlob = im.file.type === 'image/png'
      ? im.file
      : new Blob([await im.file.arrayBuffer()], { type: 'image/png' });
    fd.append('image[]', pngBlob, (im.file.name || 'image').replace(/\.[^.]+$/, '.png'));
    // mask at exact image dimensions
    if (im.maskCanvas && im.naturalWidth && canvasHasStrokes(im.maskCanvas)) {
      const maskBlob = await buildAlphaMaskBlob({
        naturalWidth: im.naturalWidth,
        naturalHeight: im.naturalHeight,
        mask: im.maskCanvas,
      });
      if (maskBlob) fd.append('mask', maskBlob, 'mask.png');
    }
    return fd;
  }, []);

  const hasImages = images.length > 0 || pendingCount > 0;
  const anyMasked = images.some((im) => im.maskCanvas && canvasHasStrokes(im.maskCanvas));

  const value = useMemo(() => ({
    images, editingIndex, selectedIndex, batchMode, compressing, pendingCount, setBatchMode,
    addFiles, removeImage, openEditor, closeEditor, clearAll, selectImage,
    hasImages, anyMasked, persistMask,
    buildEditsForm,
  }), [images, editingIndex, selectedIndex, batchMode, compressing, pendingCount,
    addFiles, removeImage, openEditor, closeEditor, clearAll, selectImage,
    hasImages, anyMasked, persistMask,
    buildEditsForm]);

  return <ImageContext.Provider value={value}>{children}</ImageContext.Provider>;
}

export function useImages() {
  const ctx = useContext(ImageContext);
  if (!ctx) throw new Error('useImages must be used within ImageProvider');
  return ctx;
}
