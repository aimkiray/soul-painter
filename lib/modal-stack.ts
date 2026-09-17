'use client';

interface ModalLayer {
  id: string;
  close: () => void;
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
// Only the topmost layer receives Escape.
export function registerModalLayer(id: string, close: () => void): () => void {
  ensureEscListener();
  const layer: ModalLayer = { id, close };
  modalStack.push(layer);
  return () => {
    const index = modalStack.indexOf(layer);
    if (index >= 0) modalStack.splice(index, 1);
  };
}

export function modalLayerCount(): number {
  return modalStack.length;
}
