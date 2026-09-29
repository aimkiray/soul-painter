'use client';

/* eslint-disable @next/next/no-img-element */

import React, { useState } from 'react';
import { ImageHit } from '@/types';
import { writeClipboardText } from '@/lib/clipboard';
import MarkdownRenderer from './MarkdownRenderer';
import Modal from './Modal';

interface ChatBubbleProps {
  message: {
    id: string;
    role: 'user' | 'bot';
    prompt: string;
    images: ImageHit[];
    text: string;
    thinking?: string;
    thinkingDone?: boolean;
    code: string;
    extra: string;
    updatedAt?: number;
    editedAt?: number;
  };
  isPending?: boolean;
  isRegenerating?: boolean;
  disabled?: boolean;
  canRegenerate?: boolean;
  onDelete?: (messageId: string) => void;
  onEdit?: (messageId: string, prompt: string) => void;
  onRegenerate?: (messageId: string) => void;
  onUseAsReference?: (hit: ImageHit, index: number) => void;
}

function getExt(link: string, isData: boolean) {
  if (isData) {
    const m = link.match(/^data:image\/(\w+)/);
    return m ? (m[1] === 'jpeg' ? 'jpg' : m[1]) : 'png';
  }
  const m = link.match(/\.(png|jpe?g|webp|gif)(?:\?|$)/i);
  return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'png';
}

function EditIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 22 22" aria-hidden="true">
      <path d="M0 0h22v22H0z" fill="none" />
      <path fill="currentColor" d="M16 2h1v1h1v1h1v1h1v1h-1v1h-1v1h-1V7h-1V6h-1V5h-1V4h1V3h1m-4 3h2v1h1v1h1v2h-1v1h-1v1h-1v1h-1v1h-1v1h-1v1H9v1H8v1H7v1H6v1H2v-4h1v-1h1v-1h1v-1h1v-1h1v-1h1v-1h1V9h1V8h1V7h1" />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 22 22" aria-hidden="true">
      <path d="M0 0h22v22H0z" fill="none" />
      <path fill="currentColor" d="M10 7v9H8V7zm2 0h2v9h-2zM8 2h6v1h5v2h-1v14h-1v1H5v-1H4V5H3V3h5zM6 5v13h10V5z" />
    </svg>
  );
}

function RegenerateIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 22 22" aria-hidden="true">
      <path d="M0 0h22v22H0z" fill="none" />
      <path fill="currentColor" d="M22 11v1h-1v1h-1v1h-1v1h-1v1h-2v-1h-1v-1h-1v-1h-1v-1h3V9h-1V7h-1V6h-2V5H9v1H7v1H6v2H5v4h1v2h1v1h2v1h4v-1h3v2h-2v1H8v-1H6v-1H5v-1H4v-2H3V8h1V6h1V5h1V4h2V3h6v1h2v1h1v1h1v2h1v3z" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 22 22" aria-hidden="true">
      <path d="M0 0h22v22H0z" fill="none" />
      <path fill="currentColor" d="M2 5h1V4h4V2h2V1h4v1h2v2h4v1h1v15h-1v1H3v-1H2zm8-2v2h2V3zm8 3h-2v2H6V6H4v13h14z" />
    </svg>
  );
}

function CopiedIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 22 22" aria-hidden="true">
      <path d="M0 0h22v22H0z" fill="none" />
      <path fill="currentColor" d="M4 11h2v1h1v1h1v1h2v-1h1v-1h1v-1h1v-1h1V9h1V8h1V7h1V6h2v2h-1v1h-1v1h-1v1h-1v1h-1v1h-1v1h-1v1h-1v1h-1v1H8v-1H7v-1H6v-1H5v-1H4z" />
    </svg>
  );
}

function CopyFailedIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 22 22" aria-hidden="true">
      <path d="M0 0h22v22H0z" fill="none" />
      <path fill="currentColor" d="M16 17h-1v-1h-1v-1h-1v-1h-1v-1h-2v1H9v1H8v1H7v1H6v-1H5v-1h1v-1h1v-1h1v-1h1v-2H8V9H7V8H6V7H5V6h1V5h1v1h1v1h1v1h1v1h2V8h1V7h1V6h1V5h1v1h1v1h-1v1h-1v1h-1v1h-1v1h1v1h1v1h1v1h1v1h-1Z" />
    </svg>
  );
}

function imageKey(hit: ImageHit, index: number) {
  return `${index}:${(hit.dataUrl || hit.url || '').slice(0, 80)}`;
}

const EMPTY_IMG_ERRORS = new Set<string>();

function downloadHit(hit: ImageHit, i: number) {
  const link = hit.dataUrl || hit.url || '';
  const isData = !!hit.dataUrl;
  const ext = getExt(link, isData);
  if (link.startsWith('data:')) {
    const a = document.createElement('a');
    a.href = link;
    a.download = `micu-${Date.now()}-${i + 1}.${ext}`;
    a.click();
  } else {
    window.open(link, '_blank');
  }
}

const ChatBubble = React.memo(function ChatBubble({
  message,
  isPending = false,
  isRegenerating = false,
  disabled = false,
  canRegenerate = false,
  onDelete,
  onEdit,
  onRegenerate,
  onUseAsReference,
}: ChatBubbleProps) {
  const { role, prompt, images, extra } = message;
  const visibleImages = images.filter((hit) => hit.dataUrl || hit.url);
  const [lightbox, setLightbox] = useState<string | null>(null);
  // Error flags are keyed to the current images array — a new array identity
  // makes them stale, so they're derived (keyed clear) rather than reset in
  // an effect.
  const [imgErrorState, setImgErrorState] = useState<{ images: ImageHit[]; errors: Set<string> }>(
    () => ({ images: message.images, errors: new Set() }),
  );
  const imgErrors = imgErrorState.images === message.images ? imgErrorState.errors : EMPTY_IMG_ERRORS;
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(prompt);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [copyTextStatus, setCopyTextStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [thinkingOpen, setThinkingOpen] = useState(!message.thinkingDone);
  const copyTextFeedbackTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const deleteTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const thinkingTouchedRef = React.useRef(false);
  const thinkingEdgeRef = React.useRef({
    hasThinking: !!message.thinking,
    done: !!message.thinkingDone,
  });

  React.useEffect(() => {
    return () => {
      if (copyTextFeedbackTimerRef.current) clearTimeout(copyTextFeedbackTimerRef.current);
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
    };
  }, []);

  React.useEffect(() => {
    const hasThinking = !!message.thinking;
    const done = !!message.thinkingDone;
    const prev = thinkingEdgeRef.current;
    thinkingEdgeRef.current = { hasThinking, done };
    if (thinkingTouchedRef.current) return;
    // Only auto-open/close on the real edges: thinking appearing, or it
    // finishing — never mid-stream updates and never after the user toggled.
    if ((hasThinking && !prev.hasThinking) || (done && !prev.done)) {
      const timeoutId = setTimeout(() => setThinkingOpen(!done), 0);
      return () => clearTimeout(timeoutId);
    }
  }, [message.thinking, message.thinkingDone]);

  const handleCopyText = async () => {
    const text = role === 'user' ? prompt : message.text;
    if (!text.trim()) return;
    const ok = await writeClipboardText(text);
    if (copyTextFeedbackTimerRef.current) clearTimeout(copyTextFeedbackTimerRef.current);
    setCopyTextStatus(ok ? 'copied' : 'failed');
    copyTextFeedbackTimerRef.current = setTimeout(() => {
      setCopyTextStatus('idle');
    }, 1600);
  };

  const requestDelete = () => {
    if (disabled || !onDelete) return;
    if (confirmingDelete) {
      onDelete(message.id);
      setConfirmingDelete(false);
      return;
    }
    setConfirmingDelete(true);
    if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
    deleteTimerRef.current = setTimeout(() => setConfirmingDelete(false), 3000);
  };

  const saveEdit = () => {
    const nextPrompt = editDraft.trim();
    if (!nextPrompt || disabled || !onEdit) return;
    onEdit(message.id, nextPrompt);
    setEditing(false);
  };

  const actionButtonClass = 'hit-x-4 hit-y-4 flex size-32 items-center justify-center text-theme-dim ring-1 ring-theme-fg/30 cursor-pointer hover:bg-theme-fg hover:text-theme-bg hover:ring-theme-fg disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-theme-dim disabled:hover:ring-theme-fg/30';
  const copyButtonClass = `${actionButtonClass} ${copyTextStatus === 'copied' ? 'text-theme-fg ring-theme-fg hover:text-theme-bg' : copyTextStatus === 'failed' ? 'text-error ring-error/60 hover:bg-error hover:text-black hover:ring-error' : ''}`;
  const copyButtonContent = copyTextStatus === 'idle'
    ? <CopyIcon />
    : copyTextStatus === 'copied'
      ? <CopiedIcon />
      : <CopyFailedIcon />;
  const showEdited = !!message.editedAt && message.editedAt > 0;

  return (
    <>
      <div
        className={`group relative mb-12 flex flex-col gap-6 ${role === 'user' ? 'items-end text-right' : 'items-start'}`}
      >
        <div className={`relative flex w-full items-center gap-8 px-4 font-mono text-body-10 uppercase ${role === 'user' ? 'flex-row-reverse' : ''}`}>
          <span className="text-theme-muted">
            {role === 'user' ? '[You]' : '[Assistant]'}
          </span>
          {showEdited && <span className="text-theme-dim">已编辑</span>}
        </div>
        <div className={`w-full min-w-0 p-12 ring-1 ${role === 'user' ? 'bg-theme-fg text-theme-bg' : ''} ${extra === 'error' ? 'ring-error' : 'ring-theme-fg/30'}`}>
          {extra === 'error' ? (
            <span className="break-all">{prompt}</span>
          ) : (
            <>
              {role === 'user' && (
                editing ? (
                  <div className="flex flex-col gap-8 text-left" onClick={(event) => event.stopPropagation()}>
                    <textarea
                      value={editDraft}
                      onChange={(event) => setEditDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.nativeEvent.isComposing) return;
                        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                          event.preventDefault();
                          saveEdit();
                        } else if (event.key === 'Escape') {
                          setEditing(false);
                          setEditDraft(prompt);
                        }
                      }}
                      className="min-w-64 max-w-full resize-y bg-transparent p-8 font-mono text-body-14 text-theme-bg outline-none ring-1 ring-theme-bg/50"
                      rows={3}
                      autoFocus
                      aria-label="编辑消息"
                    />
                    <div className="flex justify-end gap-6">
                      <button
                        type="button"
                        onClick={saveEdit}
                        disabled={!editDraft.trim() || disabled}
                        className="cursor-pointer px-12 py-4 font-mono text-body-10 uppercase ring-1 ring-theme-bg/50 hover:bg-theme-bg hover:text-theme-fg disabled:opacity-40"
                      >
                        保存
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(false);
                          setEditDraft(prompt);
                        }}
                        className="cursor-pointer px-12 py-4 font-mono text-body-10 uppercase ring-1 ring-theme-bg/50 hover:bg-theme-bg hover:text-theme-fg"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="break-words">{prompt}</p>
                )
              )}
              {role === 'bot' && (
                <div>
                  {isPending && !message.text && !message.thinking && visibleImages.length === 0 && !message.code && !message.extra && (
                    <span className="text-theme-dim">
                      {isRegenerating ? '重新生成中' : '生成中'}
                      <span aria-hidden className="ml-4 inline-block h-12 w-6 animate-blink bg-theme-dim align-middle motion-reduce:hidden" />
                    </span>
                  )}
                  {message.thinking && (
                    <details
                      className="mb-8 font-mono text-body-10 ring-1 ring-theme-fg/30"
                      open={thinkingOpen}
                      onToggle={(event) => {
                        // Programmatic open changes echo back through toggle —
                        // only count it as a user toggle when it differs from
                        // the current state.
                        if (event.currentTarget.open !== thinkingOpen) {
                          thinkingTouchedRef.current = true;
                        }
                        setThinkingOpen(event.currentTarget.open);
                      }}
                    >
                      <summary className="cursor-pointer px-8 py-4 uppercase text-theme-muted underline decoration-dotted underline-offset-2 hover:text-theme-fg">
                        {message.thinkingDone ? '[ 思考过程 ]' : '[ 思考中... ]'}
                      </summary>
                      <div className="border-t border-theme-fg/30 px-8 py-8 text-theme-dim whitespace-pre-wrap break-words">
                        {message.thinking}
                      </div>
                    </details>
                  )}
                  {message.text && (
                    <div className="mb-8 break-words">
                      <MarkdownRenderer content={message.text} />
                    </div>
                  )}
                  {visibleImages.length > 0 && (
                    <div className={visibleImages.length > 1 ? 'mb-8 grid grid-cols-2 gap-8' : 'mb-8'}>
                      {visibleImages.map((hit, i) => {
                        const src = hit.dataUrl || hit.url || '';
                        const key = imageKey(hit, i);
                        return (
                          <div key={key} className="group relative">
                            {imgErrors.has(key) ? (
                              <div className="flex min-h-100 items-center justify-center p-8 text-body-10 uppercase text-error ring-1 ring-error/60">
                                图片加载失败
                              </div>
                            ) : (
                              <img
                                src={src}
                                alt={`生成的图片 ${i + 1}`}
                                draggable={false}
                                className="checkerboard max-h-300 max-w-full cursor-pointer object-contain"
                                loading="lazy" decoding="async"
                                onClick={() => setLightbox(src)}
                                onDragStart={(event) => event.preventDefault()}
                                onError={() => setImgErrorState((prev) => {
                                  const errors = prev.images === message.images ? prev.errors : new Set<string>();
                                  return { images: message.images, errors: new Set(errors).add(key) };
                                })}
                              />
                            )}
                            {visibleImages.length > 1 && (
                              <span className="pointer-events-none absolute left-4 top-4 bg-theme-bg/80 px-2 font-mono text-body-10 text-theme-fg ring-1 ring-theme-fg/30">
                                #{i + 1}/{visibleImages.length}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {message.code && (
                    <details className="mt-4 font-mono text-body-10 ring-1 ring-theme-fg/30">
                      <summary className="cursor-pointer px-8 py-4 uppercase text-theme-muted underline decoration-dotted underline-offset-2 hover:text-theme-fg">
                        [ 查看原始响应 ]
                      </summary>
                      <pre className="max-h-160 overflow-auto whitespace-pre-wrap break-all border-t border-theme-fg/30 bg-theme-fg/10 px-8 py-8 text-theme-dim">
                        {message.code}
                      </pre>
                    </details>
                  )}
                  {message.extra && message.extra !== 'error' && (
                    <p className="mt-4 break-all font-mono text-body-10 text-theme-dim">{message.extra}</p>
                  )}
                  {visibleImages.length > 0 && (
                    <div className="mt-8 flex flex-wrap gap-8">
                      {visibleImages.map((hit, i) => {
                        const link = hit.dataUrl || hit.url || '';
                        const isData = !!hit.dataUrl;
                        return (
                          <span key={imageKey(hit, i)} className="flex gap-6">
                            <button
                              onClick={() => setLightbox(link)}
                              className="cursor-pointer px-12 py-4 font-mono text-body-10 uppercase ring-1 ring-theme-fg/30 hover:bg-theme-fg/10"
                            >
                              放大
                            </button>
                            <button
                              onClick={() => downloadHit(hit, i)}
                              className="cursor-pointer px-12 py-4 font-mono text-body-10 uppercase ring-1 ring-theme-fg/30 hover:bg-theme-fg/10"
                            >
                              {isData ? '下载' : '打开'}
                            </button>
                            {onUseAsReference && (
                              <button
                                onClick={() => onUseAsReference(hit, i)}
                                className="cursor-pointer px-12 py-4 font-mono text-body-10 uppercase ring-1 ring-theme-fg/30 hover:bg-theme-fg/10"
                              >
                                参考
                              </button>
                            )}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
        {!editing && (
          <div
            className={`flex flex-wrap gap-6 font-mono text-body-14 ${role === 'user' ? 'justify-end' : 'justify-start'}`}
            onClick={(event) => event.stopPropagation()}
          >
            {role === 'user' ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    if (disabled) return;
                    setEditDraft(prompt);
                    setEditing(true);
                    setConfirmingDelete(false);
                  }}
                  disabled={disabled}
                  className={actionButtonClass}
                  aria-label="编辑并重发"
                  title="编辑并重发"
                >
                  <EditIcon />
                </button>
                <button
                  type="button"
                  onClick={() => { void handleCopyText(); }}
                  disabled={!prompt.trim()}
                  className={copyButtonClass}
                  aria-label={copyTextStatus === 'copied' ? '已复制消息' : copyTextStatus === 'failed' ? '复制失败' : '复制消息'}
                  title={copyTextStatus === 'copied' ? '已复制' : copyTextStatus === 'failed' ? '复制失败' : '复制'}
                >
                  {copyButtonContent}
                </button>
                <button
                  type="button"
                  onClick={requestDelete}
                  disabled={disabled || !onDelete}
                  className={`${actionButtonClass} ${confirmingDelete ? 'text-error ring-error/60' : ''}`}
                  aria-label={confirmingDelete ? '确认删除消息' : '删除消息'}
                  title={confirmingDelete ? '确认删除' : '删除'}
                >
                  <DeleteIcon />
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => onRegenerate?.(message.id)}
                  disabled={disabled || !canRegenerate || !onRegenerate}
                  className={actionButtonClass}
                  aria-label="重新生成"
                  title="重新生成"
                >
                  <RegenerateIcon />
                </button>
                <button
                  type="button"
                  onClick={() => { void handleCopyText(); }}
                  disabled={!message.text.trim()}
                  className={copyButtonClass}
                  aria-label={copyTextStatus === 'copied' ? '已复制消息' : copyTextStatus === 'failed' ? '复制失败' : '复制消息'}
                  title={copyTextStatus === 'copied' ? '已复制' : copyTextStatus === 'failed' ? '复制失败' : '复制'}
                >
                  {copyButtonContent}
                </button>
                <button
                  type="button"
                  onClick={requestDelete}
                  disabled={disabled || !onDelete}
                  className={`${actionButtonClass} ${confirmingDelete ? 'text-error ring-error/60' : ''}`}
                  aria-label={confirmingDelete ? '确认删除消息' : '删除消息'}
                  title={confirmingDelete ? '确认删除' : '删除'}
                >
                  <DeleteIcon />
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightbox && (
        <Modal
          id={`chat-lightbox-${message.id}`}
          onClose={() => setLightbox(null)}
          ariaLabel="查看大图"
          backdropClassName="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-16"
          panelClassName="flex items-center justify-center max-w-full max-h-[95vh]"
        >
          <button
            onClick={() => setLightbox(null)}
            className="fixed right-12 top-12 z-10 flex size-26 cursor-pointer items-center justify-center rounded-full border border-transparent bg-theme-fg text-theme-bg hover:border-theme-fg hover:bg-transparent hover:text-theme-fg"
            aria-label="关闭大图"
          >
            <svg viewBox="0 0 24 24" className="size-full shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
          <img
            src={lightbox}
            alt="大图预览"
            draggable={false}
            className="checkerboard max-h-[95vh] max-w-full object-contain"
            decoding="async"
            onDragStart={(event) => event.preventDefault()}
          />
        </Modal>
      )}
    </>
  );
});

export default ChatBubble;
