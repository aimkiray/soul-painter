'use client';

interface ModalLayer {
  id: string;
  close: () => void;
  panel?: HTMLElement | null;
}

const modalStack: ModalLayer[] = [];
let escListenerAttached = false;

function handleKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || event.isComposing) return;
  const top = modalStack[modalStack.length - 1];
  if (!top) return;
  event.preventDefault();
  top.close();
}

function ensureEscListener() {
  if (escListenerAttached || typeof document === 'undefined') return;
  document.addEventListener('keydown', handleKeyDown);
  escListenerAttached = true;
}

// Push a layer onto the stack; returns the unregister function.
// Only the topmost layer receives Escape. `panel` lets a closing layer hand
// focus back to the layer underneath instead of dropping it on <body>.
export function registerModalLayer(id: string, close: () => void, panel?: HTMLElement | null): () => void {
  ensureEscListener();
  const layer: ModalLayer = { id, close, panel };
  modalStack.push(layer);
  return () => {
    const index = modalStack.indexOf(layer);
    if (index >= 0) modalStack.splice(index, 1);
  };
}

// Move focus to the panel of the topmost open layer (used when a nested
// modal closes while a lower modal is still open).
export function focusTopModalLayer() {
  const panel = modalStack[modalStack.length - 1]?.panel;
  if (panel && panel.isConnected && !panel.contains(document.activeElement)) {
    panel.focus({ preventScroll: true });
  }
}

export function modalLayerCount(): number {
  return modalStack.length;
}
