'use client';

import React, { useState } from 'react';
import { normalizeToDataUrl } from '@/lib/base64';

export default function TabDecode() {
  const [input, setInput] = useState('');
  const [preview, setPreview] = useState(false);
  const [imgSrc, setImgSrc] = useState('');
  const [meta, setMeta] = useState<{ mime: string; sizeKB: number; charLen: number } | null>(null);
  const [status, setStatus] = useState('');
  const [statusType, setStatusType] = useState<'ok' | 'err' | ''>('');

  const handleDecode = () => {
    setStatus(''); setStatusType('');
    try {
      const { dataUrl, mime, b64 } = normalizeToDataUrl(input);
      setImgSrc(dataUrl);
      const sizeKB = Math.round(b64.length * 0.75 / 1024);
      setMeta({ mime, sizeKB, charLen: b64.length });
      setPreview(true);
      setStatus('解析成功');
      setStatusType('ok');
    } catch (e) {
      setPreview(false);
      setStatus((e as Error).message);
      setStatusType('err');
    }
  };

  const handleClear = () => {
    setInput(''); setPreview(false); setStatus(''); setStatusType('');
  };

  const handleOpen = () => {
    if (imgSrc) window.open(imgSrc, '_blank');
  };

  const ext = meta?.mime ? meta.mime.split('/')[1] : 'png';

  return (
    <div className="flex-1 p-2 sm:p-4">
      <fieldset className="tui-fieldset border-[#AAA]">
        <legend className="text-center text-[#00aaaa] px-2">Base64 图像解码器</legend>

        <div className="mb-2">
          <label className="block text-sm text-[#CCC] mb-1">
            粘贴 Base64 编码 或 Data URL
          </label>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="w-full bg-black border-2 border-[#AAA] text-[#CCC] font-mono text-sm p-2 min-h-[120px] resize-y focus:border-[#00aaaa] outline-none"
            placeholder="data:image/png;base64,iVBORw0KGgo..."
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-2">
          <button onClick={handleDecode} className="btn-retro bg-[#00aaaa]">
            解析并预览
          </button>
          <button onClick={handleClear} className="btn-retro px-3 py-1">
            清空
          </button>
          {status && (
            <span className={`text-sm ${statusType === 'ok' ? 'text-[#0a0]' : 'text-[#f55]'}`}>
              {status}
            </span>
          )}
        </div>

        {preview && meta && (
          <div className="mt-3 border-t border-[#AAA] pt-3">
            <h3 className="text-sm text-[#00aaaa] mb-2">[ 解析结果 ]</h3>

            <div className="flex flex-col lg:flex-row gap-3">
              <div className="flex-shrink-0 lg:w-2/3 bg-black p-1 flex items-center justify-center min-h-[150px]">
                <img
                  src={imgSrc}
                  alt="preview"
                  className="max-w-full h-auto max-h-[400px] object-contain checkerboard"
                  loading="lazy" decoding="async"
                />
              </div>

              <div className="flex-1 flex flex-col gap-2">
                <div className="bg-black border-[6px] border-double border-[#AAA] p-2">
                  <p className="text-xs text-[#CCC] uppercase mb-1">[ 图像元数据 ]</p>
                  <div className="space-y-1 text-sm">
                    <div><span className="text-[#CCC]">类型：</span><span className="text-[#00aaaa]">{meta.mime}</span></div>
                    <div><span className="text-[#CCC]">体积：</span><span className="text-[#00aaaa]">{meta.sizeKB} KB</span></div>
                    <div><span className="text-[#CCC]">字符：</span><span className="text-[#CCC]">{meta.charLen}</span></div>
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <a
                    href={imgSrc}
                    download={`image.${ext}`}
                    className="btn-retro block text-center py-1 px-3 text-sm"
                  >
                    [ 下载图片 ]
                  </a>
                  <button
                    onClick={handleOpen}
                    className="btn-retro py-1 px-3 text-sm"
                  >
                    [ 新标签页打开 ]
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </fieldset>
    </div>
  );
}
