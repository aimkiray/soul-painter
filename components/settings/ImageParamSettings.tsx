'use client';

import React, { useState } from 'react';
import { useConfig } from '@/contexts/ConfigContext';
import { useImages } from '@/contexts/ImageContext';
import {
  BACKGROUND_OPTIONS,
  FORMAT_OPTIONS,
  MODERATION_OPTIONS,
  ORIGINAL_ASPECT_SIZE,
  QUALITY_OPTIONS,
  SIZE_PRESETS,
} from '@/lib/constants';
import { formatSizeDisplay } from '@/lib/size';

export const fieldsetClass = 'tui-fieldset border-[#AAA] min-w-0';
export const labelClass = 'block text-xs text-[#CCC] mb-0.5';
export const inputClass = 'w-full bg-black border-2 border-[#AAA] focus:border-[#00aaaa] text-[#CCC] text-sm py-1 px-2 outline-none font-mono';
export const selectClass = 'w-full bg-[#AAA] text-black border-2 border-[#999] text-sm py-1 px-1 cursor-pointer font-mono';
export const hintClass = 'text-xs text-[#888] mt-1';
export const providerHeadingClass = 'flex items-center justify-between gap-2 pt-2 border-t border-[#444] text-xs text-[#00aaaa]';
export const toggleClass = 'shrink-0 w-5 h-5 appearance-none border-2 border-[#AAA] bg-black checked:bg-[#00aaaa] checked:border-[#00aaaa] cursor-pointer';
export const optionRowClass = 'flex items-center justify-between gap-3 bg-black cursor-pointer select-none';

export default function ImageParamSettings() {
  const { config, updateConfig } = useConfig();
  const { images, selectedIndices } = useImages();
  const [customSize, setCustomSize] = useState(false);
  const sizeIsPreset = SIZE_PRESETS.some(s => s.value === config.size);
  const activeImages = selectedIndices.size > 0
    ? images.filter((_, i) => selectedIndices.has(i))
    : [];
  const originalAspectLabel = formatSizeDisplay(ORIGINAL_ASPECT_SIZE, activeImages);

  return (
    <fieldset className={`${fieldsetClass} lg:col-span-2`}>
              <legend className="text-[#00aaaa] px-2">图像参数</legend>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                <div className="sm:col-span-2 lg:col-span-1">
                  <label className={labelClass}>Size</label>
                  <select
                    value={(customSize || !sizeIsPreset) ? '__custom__' : config.size}
                    onChange={(e) => {
                      if (e.target.value === '__custom__') {
                        setCustomSize(true);
                      } else {
                        setCustomSize(false);
                        updateConfig('size', e.target.value);
                      }
                    }}
                    className={selectClass}
                  >
                    <optgroup label="AUTO">
                      {SIZE_PRESETS.filter(s => s.group === 'AUTO').map(s => (
                        <option key={s.value} value={s.value}>{s.value === ORIGINAL_ASPECT_SIZE ? originalAspectLabel : s.label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="1K">
                      {SIZE_PRESETS.filter(s => s.group === '1K').map(s => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="2K">
                      {SIZE_PRESETS.filter(s => s.group === '2K').map(s => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="4K">
                      {SIZE_PRESETS.filter(s => s.group === '4K').map(s => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </optgroup>
                    <option value="__custom__">自定义...</option>
                  </select>
                  {(customSize || !sizeIsPreset) && (
                    <input
                      type="text"
                      value={config.size}
                      onChange={(e) => updateConfig('size', e.target.value)}
                      placeholder="WxH"
                      className={`${inputClass} mt-1`}
                    />
                  )}
                </div>

                <div>
                  <label className={labelClass}>N</label>
                  <select
                    value={config.n}
                    onChange={(e) => updateConfig('n', parseInt(e.target.value, 10))}
                    className={selectClass}
                  >
                    {[1, 2, 3, 4, 5, 10, 20].map(v => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={labelClass}>Quality</label>
                  <select value={config.quality} onChange={(e) => updateConfig('quality', e.target.value)} className={selectClass}>
                    {QUALITY_OPTIONS.map(q => (
                      <option key={q} value={q}>{q}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={labelClass}>Format</label>
                  <select value={config.format} onChange={(e) => updateConfig('format', e.target.value)} className={selectClass}>
                    {FORMAT_OPTIONS.map(f => (
                      <option key={f} value={f}>{f.toUpperCase()}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={labelClass}>Background</label>
                  <select value={config.background} onChange={(e) => updateConfig('background', e.target.value)} className={selectClass}>
                    {BACKGROUND_OPTIONS.map(b => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={labelClass}>Moderation</label>
                  <select value={config.moderation} onChange={(e) => updateConfig('moderation', e.target.value)} className={selectClass}>
                    {MODERATION_OPTIONS.map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>

                {(config.format === 'jpeg' || config.format === 'webp') && (
                  <div>
                    <label className={labelClass}>Compression</label>
                    <label className="flex items-center gap-2 bg-[#AAA] text-black border-2 border-[#999] text-sm py-1 px-2 font-mono">
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={config.compression}
                        onChange={(e) => updateConfig('compression', parseInt(e.target.value, 10))}
                        className="flex-1 accent-[#00aaaa]"
                      />
                      <span className="w-7 text-right">{config.compression}</span>
                    </label>
                  </div>
                )}
              </div>
            </fieldset>
  );
}
