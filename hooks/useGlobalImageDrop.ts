import { useEffect } from 'react';
import { useImages } from '@/contexts/ImageContext';
import { modalLayerCount } from '@/lib/modal-stack';

function isEditableTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

export function useGlobalImageDrop(enabled: boolean) {
  const { addFiles } = useImages();

  useEffect(() => {
    if (!enabled) return;
    const hasFiles = (e: DragEvent) =>
      e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');

    const handleDragOver = (e: DragEvent) => {
      if (modalLayerCount() > 0) return;
      if (hasFiles(e)) e.preventDefault();
    };
    const handleDrop = (e: DragEvent) => {
      if (modalLayerCount() > 0) return;
      if (!hasFiles(e)) return;
      e.preventDefault();
      const files = e.dataTransfer?.files;
      if (!files?.length) return;
      const hasImage = Array.from(files).some(
        (f: File) => f.type && f.type.startsWith('image/')
      );
      if (!hasImage) return;
      addFiles(files).catch(() => {});
    };
    const handlePaste = (e: ClipboardEvent) => {
      if (modalLayerCount() > 0) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      const hasText = Array.from(items).some((item) => item.kind === 'string');
      if (hasText && isEditableTarget(e.target)) return;
      const picked: File[] = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type?.startsWith('image/')) {
          const f = items[i].getAsFile();
          if (f) picked.push(f);
        }
      }
      if (picked.length) {
        addFiles(picked).catch(() => {});
        e.preventDefault();
      }
    };

    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('drop', handleDrop);
    document.addEventListener('paste', handlePaste);
    return () => {
      document.removeEventListener('dragover', handleDragOver);
      document.removeEventListener('drop', handleDrop);
      document.removeEventListener('paste', handlePaste);
    };
  }, [addFiles, enabled]);
}
