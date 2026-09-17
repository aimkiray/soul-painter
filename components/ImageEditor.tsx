'use client';

/* eslint-disable @next/next/no-img-element */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useImages } from '@/contexts/ImageContext';
import Modal from './Modal';

interface ImageEditorProps {
  onClose: () => void;
}

export default function ImageEditor({ onClose }: ImageEditorProps) {
  const { images, editingIndex, persistMask, closeEditor } = useImages();
  const [tool, setTool] = useState<'brush' | 'eraser'>('brush');
  const [brushSize, setBrushSize] = useState(32);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const initializedRef = useRef(false);
  const isDrawing = useRef(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const toolRef = useRef<'brush' | 'eraser'>('brush');
  const brushSizeRef = useRef(32);

  useEffect(() => {
    toolRef.current = tool;
  }, [tool]);

  useEffect(() => {
    brushSizeRef.current = brushSize;
  }, [brushSize]);

  const image = editingIndex >= 0 ? images[editingIndex] : null;

  // The canvas element survives an image switch — drop the initialized flag
  // so the next setup doesn't snapshot the previous image's strokes.
  useEffect(() => {
    initializedRef.current = false;
  }, [image]);

  const setupCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !image) return false;

    const w = img.clientWidth;
    const h = img.clientHeight;
    if (w === 0 || h === 0) return false;

    const dpr = window.devicePixelRatio || 1;
    const targetW = Math.round(w * dpr);
    const targetH = Math.round(h * dpr);

    // Re-assigning width/height resets the bitmap — when the size didn't
    // actually change that would just wipe in-progress strokes.
    if (initializedRef.current && canvas.width === targetW && canvas.height === targetH) {
      return true;
    }

    // Preserve in-progress strokes when the canvas is re-created (resize).
    // Only snapshot once the canvas was initialized — before that it holds
    // the blank 300×150 default, which would shadow image.maskCanvas.
    let snapshot: HTMLCanvasElement | null = null;
    if (initializedRef.current && canvas.width > 0 && canvas.height > 0) {
      snapshot = document.createElement('canvas');
      snapshot.width = canvas.width;
      snapshot.height = canvas.height;
      snapshot.getContext('2d')?.drawImage(canvas, 0, 0);
    }

    canvas.width = targetW;
    canvas.height = targetH;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    if (snapshot) {
      ctx.drawImage(snapshot, 0, 0, w, h);
    } else if (image.maskCanvas) {
      ctx.drawImage(image.maskCanvas, 0, 0, w, h);
    }

    ctxRef.current = ctx;
    initializedRef.current = true;
    return true;
  }, [image]);

  useEffect(() => {
    if (!image) return;
    const img = imgRef.current;
    if (!img) return;

    const handleLoad = () => {
      requestAnimationFrame(() => {
        setupCanvas();
      });
    };

    if (img.complete) {
      handleLoad();
    } else {
      img.addEventListener('load', handleLoad);
      return () => img.removeEventListener('load', handleLoad);
    }
  }, [image, setupCanvas]);

  // Keep the overlay canvas aligned with the image across resizes/zoom.
  useEffect(() => {
    const img = imgRef.current;
    if (!img || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => setupCanvas());
    });
    observer.observe(img);
    return () => observer.disconnect();
  }, [image, setupCanvas]);

  const getPos = useCallback((e: MouseEvent | TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const p = 'touches' in e ? e.touches[0] : e;
    return { x: p.clientX - rect.left, y: p.clientY - rect.top };
  }, []);

  const drawStroke = useCallback((x: number, y: number) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    ctx.globalCompositeOperation = toolRef.current === 'eraser' ? 'destination-out' : 'source-over';
    ctx.fillStyle = 'rgba(255, 85, 85, 0.55)';
    ctx.beginPath();
    ctx.arc(x, y, brushSizeRef.current / 2, 0, Math.PI * 2);
    ctx.fill();
  }, []);

  const drawLine = useCallback((x0: number, y0: number, x1: number, y1: number) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    ctx.globalCompositeOperation = toolRef.current === 'eraser' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = 'rgba(255, 85, 85, 0.55)';
    ctx.lineWidth = brushSizeRef.current;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const startDraw = (e: MouseEvent | TouchEvent) => {
      if (e instanceof MouseEvent && e.button !== 0) return;
      e.preventDefault();
      isDrawing.current = true;
      const pos = getPos(e);
      lastPoint.current = pos;
      drawStroke(pos.x, pos.y);
    };

    const moveDraw = (e: MouseEvent | TouchEvent) => {
      if (!isDrawing.current) return;
      // mouseup outside the window never reaches us — if the primary button
      // is already up on the next mousemove, end the stroke instead of
      // painting without a pressed button.
      if ('buttons' in e && (e.buttons & 1) === 0) {
        endDraw();
        return;
      }
      e.preventDefault();
      const pos = getPos(e);
      const last = lastPoint.current!;
      drawLine(last.x, last.y, pos.x, pos.y);
      drawStroke(pos.x, pos.y);
      lastPoint.current = pos;
    };

    const endDraw = () => {
      isDrawing.current = false;
      lastPoint.current = null;
    };

    const blockContextMenu = (e: Event) => e.preventDefault();

    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('contextmenu', blockContextMenu);
    window.addEventListener('mousemove', moveDraw);
    window.addEventListener('mouseup', endDraw);
    canvas.addEventListener('touchstart', startDraw, { passive: false });
    window.addEventListener('touchmove', moveDraw, { passive: false });
    window.addEventListener('touchend', endDraw);
    window.addEventListener('touchcancel', endDraw);
    window.addEventListener('blur', endDraw);

    return () => {
      canvas.removeEventListener('mousedown', startDraw);
      canvas.removeEventListener('contextmenu', blockContextMenu);
      window.removeEventListener('mousemove', moveDraw);
      window.removeEventListener('mouseup', endDraw);
      canvas.removeEventListener('touchstart', startDraw);
      window.removeEventListener('touchmove', moveDraw);
      window.removeEventListener('touchend', endDraw);
      window.removeEventListener('touchcancel', endDraw);
      window.removeEventListener('blur', endDraw);
    };
  }, [getPos, drawStroke, drawLine]);

  const handleClear = () => {
    const ctx = ctxRef.current;
    const canvas = canvasRef.current;
    if (!ctx || !canvas) return;
    // ctx carries a scale(dpr) transform — clear in raw device pixels or the
    // clear region would overshoot by the dpr factor.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  };

  const handleDone = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      persistMask(canvas);
    }
    closeEditor();
    onClose();
  };

  const handleCancel = () => {
    closeEditor();
    onClose();
  };

  if (!image) return null;

  const imageSizeLabel = image.naturalWidth && image.naturalHeight
    ? ` · ${image.naturalWidth}×${image.naturalHeight}`
    : '';

  return (
    <Modal
      id={`image-editor-${editingIndex}`}
      onClose={handleCancel}
      ariaLabel={`编辑第 ${editingIndex + 1} 张图片`}
      backdropClassName="fixed inset-0 z-50 flex items-center justify-center p-2 bg-black/60"
      panelClassName="relative bg-black w-full max-w-lg border-2 border-[#AAA] font-mono text-sm"
      closeOnBackdropClick={false}
    >
        <div className="bg-[#0A0] text-white px-2 py-1 flex items-center justify-between">
          <span>编辑第 {editingIndex + 1} 张{imageSizeLabel}</span>
          <button onClick={handleCancel} className="text-white hover:text-[#ff5555] cursor-pointer" aria-label="取消编辑">
            [X]
          </button>
        </div>

        <div className="p-2">
          <div className="flex justify-center bg-black p-1">
            <div className="relative inline-block">
              <img
                ref={imgRef}
                src={image.objectUrl}
                alt="editing"
                className="max-w-full max-h-[340px] block select-none"
                loading="lazy" decoding="async"
                draggable={false}
              />
              <canvas
                ref={canvasRef}
                className="absolute top-0 left-0 touch-none cursor-crosshair"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 mt-3 flex-wrap">
            {/* Segmented tool toggle */}
            <div className="flex shrink-0">
              <button
                onClick={() => setTool('brush')}
                className={`px-2.5 py-1 text-xs border-2 border-[#AAA] font-mono cursor-pointer ${tool === 'brush' ? 'bg-[#00aaaa] text-black border-[#00aaaa]' : 'bg-black text-[#CCC]'}`}
              >笔刷</button>
              <button
                onClick={() => setTool('eraser')}
                className={`px-2.5 py-1 text-xs border-2 border-[#AAA] font-mono cursor-pointer -ml-[2px] ${tool === 'eraser' ? 'bg-[#00aaaa] text-black border-[#00aaaa]' : 'bg-black text-[#CCC]'}`}
              >擦除</button>
            </div>

            {/* Brush size slider */}
            <div className="flex items-center gap-0 text-xs text-[#CCC] flex-1 min-w-0">
              <input
                type="range"
                min={8}
                max={100}
                value={brushSize}
                onChange={(e) => setBrushSize(parseInt(e.target.value, 10))}
                className="flex-1 min-w-[60px] accent-[#00aaaa]"
              />
              <span className="w-6 text-right font-mono shrink-0">{brushSize}</span>
            </div>

            {/* Actions */}
            <button onClick={handleClear} className="btn-retro px-2.5 py-1 text-xs shrink-0">
              清除
            </button>
            <button onClick={handleCancel} className="btn-retro px-2.5 py-1 text-xs shrink-0">
              取消
            </button>
            <button onClick={handleDone} className="btn-retro bg-[#00aaaa] text-xs px-3 py-1 shrink-0">
              保存
            </button>
          </div>
        </div>
    </Modal>
  );
}
