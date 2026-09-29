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
import { CUSTOM_SIZE_PATTERN, formatSizeDisplay } from '@/lib/size';

import MenuSelect, { type MenuSelectGroup } from '@/components/MenuSelect';
import {
  fieldsetClass,
  legendClass,
  labelClass,
  inputClass,
} from './styles';

export default function ImageParamSettings() {
  const { config, updateConfig } = useConfig();
  const { images, selectedIndices } = useImages();
  const [customSize, setCustomSize] = useState(false);
  const [sizeInvalid, setSizeInvalid] = useState(false);
  const sizeIsPreset = SIZE_PRESETS.some(s => s.value === config.size);
  const activeImages = selectedIndices.size > 0
    ? images.filter((_, i) => selectedIndices.has(i))
    : [];
  const originalAspectLabel = formatSizeDisplay(ORIGINAL_ASPECT_SIZE, activeImages);
  const sizeGroups: MenuSelectGroup[] = [
    ...(['AUTO', '1K', '2K', '4K'] as const).map(group => ({
      label: group,
      options: SIZE_PRESETS.filter(s => s.group === group).map(s => ({
        value: s.value,
        label: s.value === ORIGINAL_ASPECT_SIZE ? originalAspectLabel : s.label,
      })),
    })),
    { options: [{ value: '__custom__', label: '自定义...' }] },
  ];

  return (
    <fieldset className={`${fieldsetClass} lg:col-span-2`}>
              <legend className={legendClass}>图像参数</legend>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
                <div className="sm:col-span-2 lg:col-span-1">
                  <span className={labelClass}>尺寸</span>
                  <MenuSelect
                    ariaLabel="尺寸"
                    value={(customSize || !sizeIsPreset) ? '__custom__' : config.size}
                    groups={sizeGroups}
                    onSelect={(v) => {
                      if (v === '__custom__') setCustomSize(true);
                      else { setCustomSize(false); setSizeInvalid(false); updateConfig('size', v); }
                    }}
                  />
                  {(customSize || !sizeIsPreset) && (
                    <input
                      type="text"
                      aria-label="自定义尺寸"
                      value={config.size}
                      onChange={(e) => { updateConfig('size', e.target.value); setSizeInvalid(false); }}
                      onBlur={(e) => setSizeInvalid(!CUSTOM_SIZE_PATTERN.test(e.target.value.trim()))}
                      onKeyDown={(e) => {
                        if (e.nativeEvent.isComposing) return;
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          setSizeInvalid(!CUSTOM_SIZE_PATTERN.test(e.currentTarget.value.trim()));
                          e.currentTarget.blur();
                        }
                      }}
                      placeholder="WxH"
                      title={sizeInvalid ? '格式如 1024x1024' : undefined}
                      aria-invalid={sizeInvalid || undefined}
                      className={`${inputClass} mt-4 ${sizeInvalid ? 'ring-error focus:ring-error' : ''}`}
                    />
                  )}
                </div>

                <div>
                  <span className={labelClass}>数量</span>
                  <MenuSelect
                    ariaLabel="生成数量"
                    value={String(config.n)}
                    groups={[{ options: [1, 2, 3, 4, 5, 10, 20].map(v => ({ value: String(v), label: String(v) })) }]}
                    onSelect={(v) => updateConfig('n', parseInt(v, 10))}
                  />
                </div>

                <div>
                  <span className={labelClass}>质量</span>
                  <MenuSelect
                    ariaLabel="质量"
                    value={config.quality}
                    groups={[{ options: QUALITY_OPTIONS.map(q => ({ value: q, label: q })) }]}
                    onSelect={(v) => updateConfig('quality', v)}
                  />
                </div>

                <div>
                  <span className={labelClass}>格式</span>
                  <MenuSelect
                    ariaLabel="格式"
                    value={config.format}
                    groups={[{ options: FORMAT_OPTIONS.map(f => ({ value: f, label: f.toUpperCase() })) }]}
                    onSelect={(v) => updateConfig('format', v)}
                  />
                </div>

                <div>
                  <span className={labelClass}>背景</span>
                  <MenuSelect
                    ariaLabel="背景"
                    value={config.background}
                    groups={[{ options: BACKGROUND_OPTIONS.map(b => ({ value: b, label: b })) }]}
                    onSelect={(v) => updateConfig('background', v)}
                  />
                </div>

                <div>
                  <span className={labelClass}>审核</span>
                  <MenuSelect
                    ariaLabel="审核级别"
                    value={config.moderation}
                    groups={[{ options: MODERATION_OPTIONS.map(m => ({ value: m, label: m })) }]}
                    onSelect={(v) => updateConfig('moderation', v)}
                  />
                </div>

                {(config.format === 'jpeg' || config.format === 'webp') && (
                  <div>
                    <span className={labelClass}>压缩率</span>
                    <label className="flex h-32 items-center gap-8 bg-theme-bg px-8 font-mono text-body-14 text-theme-fg ring-1 ring-theme-fg/30">
                      <input
                        type="range"
                        aria-label="压缩率"
                        min={0}
                        max={100}
                        value={config.compression}
                        onChange={(e) => updateConfig('compression', parseInt(e.target.value, 10))}
                        className="flex-1 accent-theme-fg"
                      />
                      <span className="w-28 text-right tabular-nums">{config.compression}</span>
                    </label>
                  </div>
                )}
              </div>
            </fieldset>
  );
}
