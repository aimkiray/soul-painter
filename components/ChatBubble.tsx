'use client';

/* eslint-disable @next/next/no-img-element */

import React, { useState } from 'react';
import { ImageHit } from '@/types';
import MarkdownRenderer from './MarkdownRenderer';

interface ChatBubbleProps {
  message: {
    id: string;
    role: 'user' | 'bot';
    prompt: string;
    images: ImageHit[];
    text: string;
    code: string;
    extra: string;
    updatedAt?: number;
  };
  isPending?: boolean;
  isRegenerating?: boolean;
  messageIndex: number;
  disabled?: boolean;
  canRegenerate?: boolean;
  onDelete?: (messageId: string) => void;
  onEdit?: (messageId: string, prompt: string) => void;
  onRegenerate?: (messageId: string) => void;
}

function getExt(link: string, isData: boolean) {
  if (isData) {
    const m = link.match(/^data:image\/(\w+)/);
    return m ? (m[1] === 'jpeg' ? 'jpg' : m[1]) : 'png';
  }
  const m = link.match(/\.(png|jpe?g|webp|gif)(?:\?|$)/i);
  return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'png';
}

function toCopyableUrl(url: string) {
  try {
    return new URL(url, window.location.origin).toString();
  } catch {
    return url;
  }
}

async function writeClipboardText(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the selection-based fallback for non-secure contexts.
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);

  try {
    textarea.focus({ preventScroll: true });
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
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
      <path fill="currentColor" d="M22 11v1h-1v1h-1v1h-1v1h-2v-1h-1v-1h-1v-1h-1v-1h3V9h-1V7h-1V6h-2V5H9v1H7v1H6v2H5v4h1v2h1v1h2v1h4v-1h3v2h-2v1H8v-1H6v-1H5v-1H4v-2H3V8h1V6h1V5h1V4h2V3h6v1h2v1h1v1h1v2h1v3z" />
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

export default function ChatBubble({
  message,
  isPending = false,
  isRegenerating = false,
  messageIndex,
  disabled = false,
  canRegenerate = false,
  onDelete,
  onEdit,
  onRegenerate,
}: ChatBubbleProps) {
  const { role, prompt, images, extra } = message;
  const visibleImages = images.filter((hit) => hit.dataUrl || hit.url);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [imgErrors, setImgErrors] = useState<Set<number>>(new Set());
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [copyFailedUrl, setCopyFailedUrl] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(prompt);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const copyFeedbackTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const deleteTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    if (!lightbox) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightbox(null); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [lightbox]);

  React.useEffect(() => {
    return () => {
      if (copyFeedbackTimerRef.current) clearTimeout(copyFeedbackTimerRef.current);
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
    };
  }, []);

  const handleDownload = (hit: ImageHit, i: number, timestamp: number) => {
    const link = hit.dataUrl || hit.url || '';
    const isData = !!hit.dataUrl;
    const ext = getExt(link, isData);
    if (link.startsWith('data:')) {
      const a = document.createElement('a');
      a.href = link;
      a.download = `micu-${Math.round(timestamp)}-${i + 1}.${ext}`;
      a.click();
    } else {
      window.open(link, '_blank');
    }
  };

  const handleCopyUrl = async (url: string) => {
    const ok = await writeClipboardText(toCopyableUrl(url));
    if (copyFeedbackTimerRef.current) clearTimeout(copyFeedbackTimerRef.current);

    setCopiedUrl(ok ? url : null);
    setCopyFailedUrl(ok ? null : url);
    copyFeedbackTimerRef.current = setTimeout(() => {
      setCopiedUrl(null);
      setCopyFailedUrl(null);
    }, 1600);
  };

  const handleCopyText = async () => {
    const text = role === 'user' ? prompt : message.text || message.prompt || message.extra || '';
    if (!text) return;
    await writeClipboardText(text);
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

  const actionButtonClass = 'flex h-7 w-7 items-center justify-center border-2 border-[#555] bg-black text-base leading-none text-[#AAA] cursor-pointer hover:border-[#00aaaa] hover:text-[#00aaaa] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-[#555] disabled:hover:text-[#AAA]';
  const showEdited = !!message.updatedAt && message.updatedAt > 0;

  return (
    <>
      <div
        className={`group relative flex flex-col gap-1 mb-3 ${role === 'user' ? 'items-end text-right' : 'items-start'}`}
      >
        <div className={`flex items-center gap-2 px-1 ${role === 'user' ? 'flex-row-reverse' : ''}`}>
          <span className={`text-xs ${role === 'user' ? 'text-[#00aaaa]' : 'text-[#CCC]'}`}>
            {role === 'user' ? 'You' : 'Assistant'}
          </span>
          <span className="text-[0.65rem] text-[#666]">#{messageIndex + 1}</span>
          {showEdited && <span className="text-[0.65rem] text-[#888]">已编辑</span>}
        </div>
        <div className={`w-fit max-w-full min-w-0 ${role === 'user' ? 'bg-[#00aaaa] text-white border-2 border-[#00aaaa] p-3' : 'bg-[#111] text-[#CCC] border-2 border-[#AAA] p-3'}`}>
          {extra === 'error' ? (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-[#ff5555] uppercase font-bold">[ 错误 ]</span>
              <span className="text-sm break-all">{prompt}</span>
            </div>
          ) : (
            <>
              {role === 'user' && (
                editing ? (
                  <div className="flex flex-col gap-2 text-left" onClick={(event) => event.stopPropagation()}>
                    <textarea
                      value={editDraft}
                      onChange={(event) => setEditDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                          event.preventDefault();
                          saveEdit();
                        } else if (event.key === 'Escape') {
                          setEditing(false);
                          setEditDraft(prompt);
                        }
                      }}
                      className="min-w-[16rem] max-w-full bg-black/20 border-2 border-white/70 text-white text-sm font-mono p-2 outline-none resize-y"
                      rows={3}
                      autoFocus
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={saveEdit}
                        disabled={!editDraft.trim() || disabled}
                        className="border-2 border-white/70 text-white px-2 py-0.5 text-xs font-mono cursor-pointer disabled:opacity-40"
                      >
                        保存
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(false);
                          setEditDraft(prompt);
                        }}
                        className="border-2 border-white/70 text-white px-2 py-0.5 text-xs font-mono cursor-pointer"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm break-words">{prompt}</p>
                )
              )}
              {role === 'bot' && (
                <div>
                  {isPending && !message.text && visibleImages.length === 0 && !message.code && !message.extra && (
                    <span className="animate-pulse text-sm">{isRegenerating ? '重新生成中...' : '生成中...'}</span>
                  )}
                  {message.text && (
                    <div className="text-sm break-words mb-2">
                      <MarkdownRenderer content={message.text} />
                    </div>
                  )}
                  {visibleImages.length > 0 && (
                    <div className={visibleImages.length > 1 ? 'grid grid-cols-2 gap-2 mb-2' : 'mb-2'}>
                      {visibleImages.map((hit, i) => {
                        const src = hit.dataUrl || hit.url || '';
                        return (
                          <div key={i} className="relative group">
                            {imgErrors.has(i) ? (
                              <div className="flex items-center justify-center min-h-[100px] bg-black text-[#ff5555] text-xs p-2">
                                图片加载失败
                              </div>
                            ) : (
                              <img
                                src={src}
                                alt={`Generated ${i + 1}`}
                                draggable={false}
                                className="max-w-full cursor-pointer object-contain checkerboard max-h-[300px]"
                                loading="lazy" decoding="async"
                                onClick={() => setLightbox(src)}
                                onDragStart={(event) => event.preventDefault()}
                                onError={() => setImgErrors((prev) => new Set(prev).add(i))}
                              />
                            )}
                            {visibleImages.length > 1 && (
                              <span className="absolute top-1 left-1 bg-black/70 text-white text-xs px-1 pointer-events-none">
                                #{i + 1}/{visibleImages.length}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {message.code && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs text-[#CCC] hover:text-[#00aaaa] select-none">
                        [ 查看原始响应 ]
                      </summary>
                      <pre className="mt-1 p-2 bg-black border border-[#AAA] text-xs text-[#CCC] max-h-40 overflow-auto whitespace-pre-wrap break-all">
                        {message.code}
                      </pre>
                    </details>
                  )}
                  {message.extra && message.extra !== 'error' && (
                    <p className="text-xs text-[#CCC] mt-1 break-all">{message.extra}</p>
                  )}
                  {visibleImages.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {visibleImages.map((hit, i) => {
                        const link = hit.dataUrl || hit.url || '';
                        const isData = !!hit.dataUrl;
                        return (
                          <span key={i} className="flex gap-2">
                            <button
                              onClick={() => setLightbox(link)}
                              className="btn-retro text-xs px-2 py-0.5"
                            >
                              放大
                            </button>
                            <button
                              onClick={(e) => handleDownload(hit, i, e.timeStamp)}
                              className="btn-retro text-xs px-2 py-0.5"
                            >
                              {isData ? '下载' : '打开'}
                            </button>
                            {!isData && (
                              <button
                                onClick={() => { void handleCopyUrl(link); }}
                                className="btn-retro text-xs px-2 py-0.5"
                              >
                                {copyFailedUrl === link ? '复制失败' : copiedUrl === link ? '已复制' : '复制URL'}
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
            className={`flex flex-wrap gap-1 ${role === 'user' ? 'justify-end' : 'justify-start'}`}
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
                  onClick={requestDelete}
                  disabled={disabled || !onDelete}
                  className={`${actionButtonClass} ${confirmingDelete ? 'text-[#ff5555]' : ''}`}
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
                  disabled={disabled || !(message.text || message.prompt || message.extra)}
                  className={actionButtonClass}
                  aria-label="复制消息"
                  title="复制"
                >
                  <CopyIcon />
                </button>
                <button
                  type="button"
                  onClick={requestDelete}
                  disabled={disabled || !onDelete}
                  className={`${actionButtonClass} ${confirmingDelete ? 'text-[#ff5555]' : ''}`}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4" onClick={() => setLightbox(null)}>
          <button
            onClick={() => setLightbox(null)}
            className="absolute top-3 right-3 text-white text-2xl hover:text-[#ff5555] cursor-pointer font-mono z-10"
          >
            [X]
          </button>
          <img
            src={lightbox}
            alt="Full size"
            draggable={false}
            className="max-w-full max-h-[95vh] object-contain checkerboard"
            loading="lazy" decoding="async"
            onClick={(e) => e.stopPropagation()}
            onDragStart={(event) => event.preventDefault()}
          />
        </div>
      )}
    </>
  );
}
