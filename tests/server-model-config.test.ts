import { describe, expect, it } from 'vitest';
import { getServerModelConfig } from '@/lib/server-model-config';

describe('getServerModelConfig', () => {
  it('keeps the built-in defaults when model env vars are absent', () => {
    expect(getServerModelConfig({})).toEqual({
      openAIChatModels: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'],
      defaultOpenAIChatModel: 'gpt-5.6-sol',
      defaultOpenAITitleModel: 'gpt-5.6-terra',
      claudeChatModels: ['claude-fable-5', 'claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5'],
      defaultClaudeChatModel: 'claude-sonnet-5',
      defaultClaudeTitleModel: 'claude-haiku-4-5',
    });
  });

  it('uses the first and last configured models as defaults', () => {
    expect(getServerModelConfig({
      OPENAI_CHAT_MODELS: ' openai-a, openai-b, openai-a ',
      CLAUDE_CHAT_MODELS: 'claude-a\nclaude-b',
    })).toEqual({
      openAIChatModels: ['openai-a', 'openai-b'],
      defaultOpenAIChatModel: 'openai-a',
      defaultOpenAITitleModel: 'openai-b',
      claudeChatModels: ['claude-a', 'claude-b'],
      defaultClaudeChatModel: 'claude-a',
      defaultClaudeTitleModel: 'claude-b',
    });
  });

  it('adds explicit default models to their selectors', () => {
    expect(getServerModelConfig({
      OPENAI_CHAT_MODELS: 'openai-a',
      DEFAULT_OPENAI_CHAT_MODEL: 'openai-default',
      DEFAULT_OPENAI_TITLE_MODEL: 'openai-title',
      CLAUDE_CHAT_MODELS: 'claude-a',
      DEFAULT_CLAUDE_CHAT_MODEL: 'claude-default',
      DEFAULT_CLAUDE_TITLE_MODEL: 'claude-title',
    })).toMatchObject({
      openAIChatModels: ['openai-a', 'openai-default', 'openai-title'],
      claudeChatModels: ['claude-a', 'claude-default', 'claude-title'],
    });
  });
});
