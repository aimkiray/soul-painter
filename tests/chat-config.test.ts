import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '@/lib/constants';
import {
  getChatFormatForModel,
  getChatProviderConfig,
  getClaudeChatModelOptions,
  getOpenAIChatModelOptions,
  parseChatModelChoice,
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

  it('treats any model id containing "claude" as claude format', () => {
    expect(getChatFormatForModel(createConfig(), 'anthropic.claude-3-5-sonnet')).toBe('claude');
    expect(getChatFormatForModel(createConfig(), 'claude_x')).toBe('claude');
  });

  it('rejects a model choice with an empty model', () => {
    expect(parseChatModelChoice('openai:')).toBeNull();
    expect(parseChatModelChoice('claude:  ')).toBeNull();
    expect(parseChatModelChoice('openai:gpt-x')).toEqual({ format: 'openai', model: 'gpt-x' });
  });

  it('falls back to chatApiKey and apiKey for the claude provider', () => {
    const base = createConfig();
    expect(getChatProviderConfig({ ...base, claudeApiKey: 'claude-key', chatApiKey: 'chat-key' }, 'claude').apiKey)
      .toBe('claude-key');
    expect(getChatProviderConfig({ ...base, claudeApiKey: '', chatApiKey: 'chat-key' }, 'claude').apiKey)
      .toBe('chat-key');
    expect(getChatProviderConfig({ ...base, claudeApiKey: '', chatApiKey: '', apiKey: 'main-key' }, 'claude').apiKey)
      .toBe('main-key');
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
