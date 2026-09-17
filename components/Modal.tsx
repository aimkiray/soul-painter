'use client';

import React, { useEffect, useRef } from 'react';
import { registerModalLayer, modalLayerCount, focusTopModalLayer } from '@/lib/modal-stack';

interface ModalProps {
  id: string;
  open?: boolean;
  onClose: () => void;
  ariaLabel: string;
  backdropClassName?: string;
  panelClassName?: string;
  closeOnBackdropClick?: boolean;
  children: React.ReactNode;
}

// Shared modal shell: registers with the modal stack (topmost layer handles
// Escape), moves focus into the panel on open, restores it on close, and only
// closes on backdrop clicks when both pointerdown and pointerup land on the
// backdrop itself.
export default function Modal({
  id,
  open = true,
  onClose,
  ariaLabel,
  backdropClassName = '',
  panelClassName = '',
  closeOnBackdropClick = true,
  children,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const pointerDownOnBackdropRef = useRef(false);
  const pointerUpOnBackdropRef = useRef(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const unregister = registerModalLayer(id, () => onCloseRef.current(), panelRef.current);
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) panel.focus();
    return () => {
      unregister();
      const target = restoreFocusRef.current;
      restoreFocusRef.current = null;
      // A lower modal layer is still open — hand focus to its panel; leaving
      // it on a detached node or <body> would strand it outside the trap.
      if (modalLayerCount() > 0) {
        focusTopModalLayer();
        return;
      }
      if (target && target.isConnected) target.focus({ preventScroll: true });
    };
  }, [open, id]);

  if (!open) return null;

  return (
    <div
      className={backdropClassName}
      onMouseDown={(event) => {
        // A backdrop press would otherwise move focus to <body>, where Tab
        // keydowns never reach the panel's focus trap. Guarded by target so
        // clicks on panel children (inputs, buttons) still focus normally.
        if (event.target === event.currentTarget) event.preventDefault();
      }}
      onPointerDown={(event) => {
        pointerDownOnBackdropRef.current = event.target === event.currentTarget;
      }}
      onPointerUp={(event) => {
        pointerUpOnBackdropRef.current = event.target === event.currentTarget;
      }}
      onClick={() => {
        const startedOnBackdrop = pointerDownOnBackdropRef.current;
        const endedOnBackdrop = pointerUpOnBackdropRef.current;
        pointerDownOnBackdropRef.current = false;
        pointerUpOnBackdropRef.current = false;
        if (closeOnBackdropClick && startedOnBackdrop && endedOnBackdrop) {
          onCloseRef.current();
        }
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        className={`focus:outline-none ${panelClassName}`}
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return;
          const panel = panelRef.current;
          if (!panel) return;
          const focusables = Array.from(
            panel.querySelectorAll<HTMLElement>(
              'button, [href], input, select, textarea, summary, iframe, [contenteditable="true"], audio[controls], video[controls], [tabindex]:not([tabindex="-1"])',
            ),
          ).filter((el) => !el.hasAttribute('disabled') && el.getClientRects().length > 0);
          if (focusables.length === 0) {
            event.preventDefault();
            return;
          }
          const first = focusables[0];
          const last = focusables[focusables.length - 1];
          const active = document.activeElement as HTMLElement | null;
          // The panel itself is focusable but excluded from `focusables` —
          // wrap explicitly or Tab would escape into the background page.
          if (active === panel) {
            (event.shiftKey ? last : first).focus();
            event.preventDefault();
          } else if (!panel.contains(active)) {
            first.focus();
            event.preventDefault();
          } else if (event.shiftKey && active === first) {
            last.focus();
            event.preventDefault();
          } else if (!event.shiftKey && active === last) {
            first.focus();
            event.preventDefault();
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
