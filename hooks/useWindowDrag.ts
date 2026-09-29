'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

// Draggable floating windows: pointer-down on the title bar moves the dialog
// panel via a translate offset, clamped so at least an edge stays on screen.
export function useWindowDrag() {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; baseX: number; baseY: number; moved: boolean } | null>(null);
  // pointerdown is preventDefaulted below, which suppresses the browser's
  // dblclick synthesis — detect the double-tap ourselves instead.
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null);
  // A window unmounting mid-drag (e.g. Escape closing the modal) must not
  // strand the pointer listeners or the grabbing cursor.
  const cleanupRef = useRef<(() => void) | null>(null);
  // Mirror of offset state for event handlers — reading live offset inside a
  // setState updater would be an impure render-phase side effect.
  const offsetRef = useRef({ x: 0, y: 0 });

  useEffect(() => () => cleanupRef.current?.(), []);

  const onTitlePointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const handle = event.currentTarget;
    // Controls inside the title bar (close, etc.) must not start a drag.
    if ((event.target as HTMLElement).closest('button, a, input, textarea, select, summary, label, [role="button"], [contenteditable]')) return;
    const panel = handle.closest('[role="dialog"], [data-window]') as HTMLElement | null;
    if (!panel) return;
    event.preventDefault();

    const now = performance.now();
    const lastTap = lastTapRef.current;
    lastTapRef.current = { time: now, x: event.clientX, y: event.clientY };
    if (lastTap && now - lastTap.time < 400 && Math.hypot(lastTap.x - event.clientX, lastTap.y - event.clientY) < 12) {
      // Double-tap on the title bar resets the window to its anchored spot.
      delete panel.dataset.dragX;
      delete panel.dataset.dragY;
      offsetRef.current = { x: 0, y: 0 };
      setOffset({ x: 0, y: 0 });
      lastTapRef.current = null;
      return;
    }

    handle.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      baseX: offsetRef.current.x,
      baseY: offsetRef.current.y,
      moved: false,
    };
    document.body.style.cursor = 'grabbing';

    let rafId = 0;
    let pendingX = 0;
    let pendingY = 0;
    const handleMove = (moveEvent: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || moveEvent.pointerId !== drag.pointerId) return;
      const rect = panel.getBoundingClientRect();
      const currentX = rect.left - parseFloat(panel.dataset.dragX || '0');
      const currentY = rect.top - parseFloat(panel.dataset.dragY || '0');
      let nextX = drag.baseX + moveEvent.clientX - drag.startX;
      let nextY = drag.baseY + moveEvent.clientY - drag.startY;
      // Keep at least 32px of the panel inside the viewport.
      const margin = 32;
      nextX = Math.min(Math.max(nextX, margin - currentX - rect.width), window.innerWidth - currentX - margin);
      nextY = Math.min(Math.max(nextY, -currentY), window.innerHeight - currentY - margin);
      pendingX = nextX;
      pendingY = nextY;
      if (Math.abs(nextX - drag.baseX) > 2 || Math.abs(nextY - drag.baseY) > 2) drag.moved = true;
      if (!rafId) {
        rafId = requestAnimationFrame(() => {
          rafId = 0;
          panel.dataset.dragX = String(pendingX);
          panel.dataset.dragY = String(pendingY);
          offsetRef.current = { x: pendingX, y: pendingY };
          setOffset({ x: pendingX, y: pendingY });
        });
      }
    };

    const handleEnd = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== dragRef.current?.pointerId) return;
      // A press that moved was a drag, not a tap — don't let a fast second
      // drag count as a double-tap reset.
      if (dragRef.current.moved) lastTapRef.current = null;
      dragRef.current = null;
      document.body.style.cursor = '';
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleEnd);
      window.removeEventListener('pointercancel', handleEnd);
      cleanupRef.current = null;
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleEnd);
    window.addEventListener('pointercancel', handleEnd);
    cleanupRef.current?.();
    cleanupRef.current = () => {
      dragRef.current = null;
      document.body.style.cursor = '';
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleEnd);
      window.removeEventListener('pointercancel', handleEnd);
    };
  }, []);

  const style: React.CSSProperties | undefined =
    offset.x || offset.y ? { transform: `translate(${offset.x}px, ${offset.y}px)` } : undefined;

  return { dragStyle: style, onTitlePointerDown };
}
