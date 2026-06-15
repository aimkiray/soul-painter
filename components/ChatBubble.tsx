'use client';

/* eslint-disable @next/next/no-img-element */

import React, { useState } from 'react';
import { ImageHit } from '@/types';
import MarkdownRenderer from './MarkdownRenderer';

interface ChatBubbleProps {
  message: {
    role: 'user' | 'bot';
    prompt: string;
    images: ImageHit[];
    text: string;
    code: string;
    extra: string;
  };
  isPending?: boolean;
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

export default function ChatBubble({ message, isPending = false }: ChatBubbleProps) {
  const { role, prompt, images, extra } = message;
  const visibleImages = images.filter((hit) => hit.dataUrl || hit.url);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [imgErrors, setImgErrors] = useState<Set<number>>(new Set());
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [copyFailedUrl, setCopyFailedUrl] = useState<string | null>(null);
  const copyFeedbackTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    if (!lightbox) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightbox(null); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [lightbox]);

  React.useEffect(() => {
    return () => {
      if (copyFeedbackTimerRef.current) clearTimeout(copyFeedbackTimerRef.current);
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

  return (
    <>
      <div className={`flex flex-col gap-1 mb-3 ${role === 'user' ? 'items-end text-right' : 'items-start'}`}>
        <span className={`text-xs px-1 ${role === 'user' ? 'text-[#00aaaa]' : 'text-[#CCC]'}`}>
          {role === 'user' ? 'You' : 'Assistant'}
        </span>
        <div className={`w-fit max-w-full min-w-0 ${role === 'user' ? 'bg-[#00aaaa] text-white border-2 border-[#00aaaa] p-3' : 'bg-[#111] text-[#CCC] border-2 border-[#AAA] p-3'}`}>
          {extra === 'error' ? (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-[#ff5555] uppercase font-bold">[ 错误 ]</span>
              <span className="text-sm break-all">{prompt}</span>
            </div>
          ) : (
            <>
              {role === 'user' && <p className="text-sm break-words">{prompt}</p>}
              {role === 'bot' && (
                <div>
                  {isPending && (
                    <span className="animate-pulse text-sm">生成中...</span>
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
                                className="max-w-full cursor-pointer object-contain checkerboard max-h-[300px]"
                                loading="lazy" decoding="async"
                                onClick={() => setLightbox(src)}
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
            className="max-w-full max-h-[95vh] object-contain checkerboard"
            loading="lazy" decoding="async"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
