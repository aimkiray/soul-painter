'use client';

import React from 'react';
import { useConfig } from '@/contexts/ConfigContext';
import { useI18n } from '@/contexts/I18nContext';


import MenuSelect from '@/components/MenuSelect';
import {
  fieldsetClass,
  legendClass,
  labelClass,
  inputClass,
  hintClass,
  optionRowClass,
} from './styles';

// aria-pressed option rows replace checkbox inputs — the whole row is the
// toggle, the trailing square is the checkbox glyph (filled = on).
function OptionToggle({ label, pressed, onToggle }: { label: string; pressed: boolean; onToggle: () => void }) {
  return (
    <button type="button" aria-pressed={pressed} onClick={onToggle} className={`${optionRowClass} w-full`}>
      <span className="font-mono text-body-10 uppercase text-theme-muted">{label}</span>
      <span
        aria-hidden
        className={`size-18 shrink-0 rounded-2 ring-1 ${pressed ? 'bg-theme-fg ring-theme-fg' : 'ring-theme-fg/30'}`}
      />
    </button>
  );
}

export default function RuntimeSettings() {
  const { options, updateOption } = useConfig();
  const { t } = useI18n();

  const commitTimeout = (input: HTMLInputElement) => {
    const parsed = parseInt(input.value, 10);
    const clamped = Number.isFinite(parsed) ? Math.max(10, Math.min(3600, parsed)) : 600;
    input.value = String(clamped);
    updateOption('timeout', clamped);
  };


  return (
    <fieldset className={`${fieldsetClass} lg:col-span-2`}>
              <legend className={legendClass}>{t('runtimeSection')}</legend>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-start">
                <div className="space-y-12 px-8 py-8">
                  <div className="min-h-58">
                    <span className={labelClass}>{t('timeoutLabel')}</span>
                    <input
                      key={options.timeout}
                      aria-label={t('timeoutLabel')}
                      type="number"
                      defaultValue={options.timeout}
                      onBlur={(e) => commitTimeout(e.currentTarget)}
                      onKeyDown={(e) => {
                        if (e.nativeEvent.isComposing) return;
                        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
                      }}
                      className={inputClass}
                    />
                    <p className={hintClass}>10-3600</p>
                  </div>

                  <div className="min-h-58">
                    <span className={labelClass}>{t('contextLimit')}</span>
                    <MenuSelect
                      ariaLabel={t('contextLimit')}
                      value={String(options.contextLimit)}
                      groups={[{ options: [0, 1, 2, 3, 4, 5].map(v => ({ value: String(v), label: String(v) })) }]}
                      onSelect={(v) => updateOption('contextLimit', Math.max(0, Math.min(5, parseInt(v, 10) || 0)))}
                    />
                    <p className={hintClass}>{t('contextLimitHint')}</p>
                  </div>
                </div>

                <div className="space-y-12 px-8 py-8">
                  <OptionToggle label={t('optStreaming')} pressed={options.streaming} onToggle={() => updateOption('streaming', !options.streaming)} />
                  <OptionToggle label={t('optClearRefs')} pressed={options.clearOnSubmit} onToggle={() => updateOption('clearOnSubmit', !options.clearOnSubmit)} />
                  <OptionToggle label={t('optPersistPrompt')} pressed={options.persistPrompt} onToggle={() => updateOption('persistPrompt', !options.persistPrompt)} />
                </div>
              </div>
            </fieldset>
  );
}
