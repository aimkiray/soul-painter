'use client';

import React, { useState } from 'react';
import { ImageHit } from '@/types';

interface ChatBubbleProps {
  message: {
    role: 'user' | 'bot';
    prompt: string;
    images: ImageHit[];
    code: string;
    extra: string;
  };
}

function getExt(link: string, isData: boolean) {
  if (isData) {
    const m = link.match(/^data:image\/(\w+)/);
    return m ? (m[1] === 'jpeg' ? 'jpg' : m[1]) : 'png';
  }
  const m = link.match(/\.(png|jpe?g|webp|gif)(?:\?|$)/i);
  return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'png';
}

export default function ChatBubble({ message }: ChatBubbleProps) {
  const { role, prompt, images, extra } = message;
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [imgErrors, setImgErrors] = useState<Set<number>>(new Set());

  React.useEffect(() => {
    if (!lightbox) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightbox(null); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [lightbox]);

  const handleDownload = (hit: ImageHit, i: number) => {
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
  };

  const handleCopyUrl = (url: string) => {
    navigator.clipboard.writeText(url).catch(() => {});
  };

  return (
    <>
      <div className={`flex flex-col gap-1 mb-3 ${role === 'user' ? 'items-end' : 'items-start'}`}>
        <span className={`text-xs px-1 ${role === 'user' ? 'text-[#00aaaa]' : 'text-[#CCC]'}`}>
          {role === 'user' ? 'You' : 'Assistant'}
        </span>
        <div className={`max-w-[90%] sm:max-w-[80%] ${role === 'user' ? 'bg-[#00aaaa] text-white border border-[#00aaaa] p-3' : 'bg-[#111] text-[#CCC] border border-[#AAA] p-3'}`}>
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
                  {images.length > 0 && (
                    <div className={images.length > 1 ? 'grid grid-cols-2 gap-2 mb-2' : 'mb-2'}>
                      {images.map((hit, i) => {
                        const src = hit.dataUrl || hit.url || '';
                        const isData = !!hit.dataUrl;
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
                            {images.length > 1 && (
                              <span className="absolute top-1 left-1 bg-black/70 text-white text-xs px-1 pointer-events-none">
                                #{i + 1}/{images.length}
                              </span>
                            )}
                            <div className="absolute bottom-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              {(!isData) && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleCopyUrl(hit.url!); }}
                                  className="text-xs bg-black/70 hover:bg-black/90 text-white px-1.5 py-0.5 cursor-pointer"
                                >
                                  复制
                                </button>
                              )}
                              <button
                                onClick={(e) => { e.stopPropagation(); handleDownload(hit, i); }}
                                className="text-xs bg-black/70 hover:bg-black/90 text-white px-1.5 py-0.5 cursor-pointer"
                              >
                                {isData ? '下载' : '打开'}
                              </button>
                            </div>
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
                  {images.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {images.map((hit, i) => {
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
                              onClick={() => handleDownload(hit, i)}
                              className="btn-retro text-xs px-2 py-0.5"
                            >
                              {isData ? '下载' : '打开'}
                            </button>
                            {!isData && (
                              <button
                                onClick={() => handleCopyUrl(link)}
                                className="btn-retro text-xs px-2 py-0.5"
                              >
                                复制URL
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
