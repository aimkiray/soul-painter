import {
  CHAT_MODEL_PRESETS,
  CLAUDE_MODEL_PRESETS,
  DEFAULT_CONFIG,
} from '@/lib/constants';
import { normalizeModelList } from '@/lib/model-options';

type ModelEnvironment = Record<string, string | undefined>;

function parseModelList(value: string | undefined) {
  return normalizeModelList((value || '').split(/[\r\n,]/));
}

function configuredModel(value: string | undefined) {
  return value?.trim() || '';
}

export function getServerModelConfig(env: ModelEnvironment = process.env) {
  const configuredOpenAIModels = parseModelList(env.OPENAI_CHAT_MODELS);
  const configuredClaudeModels = parseModelList(env.CLAUDE_CHAT_MODELS);
  const openAIChatModels = configuredOpenAIModels.length > 0
    ? configuredOpenAIModels
    : CHAT_MODEL_PRESETS.map((option) => option.value);
  const claudeChatModels = configuredClaudeModels.length > 0
    ? configuredClaudeModels
    : CLAUDE_MODEL_PRESETS.map((option) => option.value);

  const defaultOpenAIChatModel = configuredModel(env.DEFAULT_OPENAI_CHAT_MODEL)
    || (configuredOpenAIModels.length > 0 ? openAIChatModels[0] : DEFAULT_CONFIG.chatModel);
  const defaultOpenAITitleModel = configuredModel(env.DEFAULT_OPENAI_TITLE_MODEL)
    || (configuredOpenAIModels.length > 0 ? openAIChatModels[openAIChatModels.length - 1] : DEFAULT_CONFIG.titleModel);
  const defaultClaudeChatModel = configuredModel(env.DEFAULT_CLAUDE_CHAT_MODEL)
    || (configuredClaudeModels.length > 0 ? claudeChatModels[0] : DEFAULT_CONFIG.claudeModel);
  const defaultClaudeTitleModel = configuredModel(env.DEFAULT_CLAUDE_TITLE_MODEL)
    || (configuredClaudeModels.length > 0 ? claudeChatModels[claudeChatModels.length - 1] : DEFAULT_CONFIG.claudeTitleModel);

  return {
    openAIChatModels: normalizeModelList([
      ...openAIChatModels,
      defaultOpenAIChatModel,
      defaultOpenAITitleModel,
    ]),
    defaultOpenAIChatModel,
    defaultOpenAITitleModel,
    claudeChatModels: normalizeModelList([
      ...claudeChatModels,
      defaultClaudeChatModel,
      defaultClaudeTitleModel,
    ]),
    defaultClaudeChatModel,
    defaultClaudeTitleModel,
  };
}
