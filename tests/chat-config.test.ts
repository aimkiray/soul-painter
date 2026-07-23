import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '@/lib/constants';
import {
  getChatFormatForModel,
  getClaudeChatModelOptions,
  getOpenAIChatModelOptions,
} from '@/lib/chat-config';
import { getModelFallback } from '@/lib/model-options';
import type { AppConfig } from '@/types';

function createConfig(): AppConfig {
  return {
    ...DEFAULT_CONFIG,
    openAIChatModels: ['openai-env-model'],
    claudeChatModels: ['vendor/anthropic-model'],
    customImageModels: [],
    customChatModels: ['openai-custom-model'],
    customClaudeModels: ['claude-custom-model'],
    n: DEFAULT_CONFIG.n,
    compression: DEFAULT_CONFIG.compression,
  };
}

describe('chat model configuration', () => {
  it('uses environment-provided presets before user custom models', () => {
    const config = createConfig();

    expect(getOpenAIChatModelOptions(config).map((option) => option.value)).toEqual([
      'openai-env-model',
      'openai-custom-model',
    ]);
    expect(getClaudeChatModelOptions(config).map((option) => option.value)).toEqual([
      'vendor/anthropic-model',
      'claude-custom-model',
    ]);
  });

  it('recognizes a configured Claude model without relying on its name', () => {
    expect(getChatFormatForModel(createConfig(), 'vendor/anthropic-model')).toBe('claude');
  });

  it('falls back to the configured default after removing a custom model', () => {
    const options = [
      { label: 'high-capability', value: 'high-capability' },
      { label: 'configured-default', value: 'configured-default' },
      { label: 'custom-model', value: 'custom-model' },
    ];

    expect(getModelFallback(options, 'configured-default', 'custom-model')).toBe('configured-default');
  });
});
