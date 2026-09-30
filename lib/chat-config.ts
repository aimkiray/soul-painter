import { AppConfig } from '@/types';
import { CHAT_EFFORT_OPTIONS, CHAT_MODEL_PRESETS, CLAUDE_MODEL_PRESETS } from '@/lib/constants';
import { mergeModelOptions, modelNamesToOptions, ModelOption, normalizeModelList } from '@/lib/model-options';

export type ChatApiFormat = AppConfig['chatApiFormat'];

export type ChatProviderModelOption = ModelOption & {
  readonly format: ChatApiFormat;
};

export function getOpenAIChatModelOptions(config: AppConfig): ModelOption[] {
  const configuredModels = normalizeModelList(config.openAIChatModels);
  const presets = configuredModels.length > 0
    ? modelNamesToOptions(configuredModels)
    : CHAT_MODEL_PRESETS;
  return mergeModelOptions(presets, config.customChatModels);
}

export function getClaudeChatModelOptions(config: AppConfig): ModelOption[] {
  const configuredModels = normalizeModelList(config.claudeChatModels);
  const presets = configuredModels.length > 0
    ? modelNamesToOptions(configuredModels)
    : CLAUDE_MODEL_PRESETS;
  return mergeModelOptions(presets, config.customClaudeModels);
}

export function getAllChatModelOptions(config: AppConfig): ChatProviderModelOption[] {
  return [
    ...getOpenAIChatModelOptions(config).map((option) => ({ ...option, format: 'openai' as const })),
    ...getClaudeChatModelOptions(config).map((option) => ({ ...option, format: 'claude' as const })),
  ];
}

function hasModel(options: readonly ModelOption[], model: string) {
  return options.some((option) => option.value === model);
}

function looksLikeClaudeModel(model: string) {
  return /claude/i.test(model);
}

export function getChatFormatForModel(
  config: AppConfig,
  model: string = getActiveChatModel(config),
  fallback: ChatApiFormat = config.chatApiFormat,
): ChatApiFormat {
  const inOpenAI = hasModel(getOpenAIChatModelOptions(config), model);
  const inClaude = hasModel(getClaudeChatModelOptions(config), model);

  if (inClaude && !inOpenAI) return 'claude';
  if (inOpenAI && !inClaude) return 'openai';
  if (inClaude && inOpenAI) return fallback;
  if (looksLikeClaudeModel(model)) return 'claude';

  return fallback === 'claude' ? 'claude' : 'openai';
}

export function encodeChatModelChoice(format: ChatApiFormat, model: string) {
  return `${format}:${model}`;
}

export function parseChatModelChoice(value: string): { format: ChatApiFormat; model: string } | null {
  const separatorIndex = value.indexOf(':');
  if (separatorIndex < 0) return null;

  const format = value.slice(0, separatorIndex);
  if (format !== 'openai' && format !== 'claude') return null;

  const model = value.slice(separatorIndex + 1);
  if (!model.trim()) return null;
  return { format, model };
}

export function getChatProviderConfig(
  config: AppConfig,
  modelOrFormat?: string | ChatApiFormat,
  forcedFormat?: ChatApiFormat,
) {
  const modelOrFormatIsFormat = modelOrFormat === 'openai' || modelOrFormat === 'claude';
  const format = modelOrFormatIsFormat
    ? modelOrFormat
    : forcedFormat ?? getChatFormatForModel(config, modelOrFormat || getActiveChatModel(config));
  const model = modelOrFormatIsFormat
    ? (format === 'claude' ? config.claudeModel : config.chatModel)
    : modelOrFormat || getActiveChatModel(config);

  if (format === 'claude') {
    return {
      format,
      apiKey: config.claudeApiKey || config.chatApiKey || config.apiKey,
      baseUrl: config.claudeBaseUrl,
      model,
      titleModel: config.claudeTitleModel,
      customModels: config.customClaudeModels,
    };
  }

  return {
    format,
    apiKey: config.chatApiKey || config.apiKey,
    baseUrl: config.chatBaseUrl,
    model,
    titleModel: config.titleModel,
    customModels: config.customChatModels,
  };
}

export function getActiveChatModel(config: AppConfig) {
  return config.chatModel;
}

// Structurally identical to MenuSelectGroup — kept local so lib code does not
// import a component for a plain data shape.
export interface ModelMenuGroup {
  label?: string;
  options: { value: string; label: string }[];
}

// A value absent from the known options still renders — as a raw orphan
// option at the top — so stale/custom persisted models stay visible and
// selectable instead of silently migrating away.
export function buildModelMenuGroups(
  options: readonly ModelOption[],
  activeValue: string,
): ModelMenuGroup[] {
  const isOption = hasModel(options, activeValue);
  return [{
    options: [
      ...(isOption ? [] : [{ value: activeValue, label: activeValue }]),
      ...options.map((m) => ({ value: m.value, label: m.label })),
    ],
  }];
}

export function buildChatModelMenuGroups(
  config: AppConfig,
  labels: { openai: string; claude: string },
) {
  const activeModel = getActiveChatModel(config);
  const activeFormat = getChatFormatForModel(config, activeModel);
  const activeChoice = encodeChatModelChoice(activeFormat, activeModel);
  const isOption = getAllChatModelOptions(config).some(
    (m) => m.format === activeFormat && m.value === activeModel,
  );
  const groups = [
    { options: isOption ? [] : [{ value: activeChoice, label: activeModel }] },
    {
      label: labels.openai,
      options: getOpenAIChatModelOptions(config).map(
        (m) => ({ value: encodeChatModelChoice('openai', m.value), label: m.label }),
      ),
    },
    {
      label: labels.claude,
      options: getClaudeChatModelOptions(config).map(
        (m) => ({ value: encodeChatModelChoice('claude', m.value), label: m.label }),
      ),
    },
  ].filter((group) => group.options.length > 0);
  return { groups, activeModel, activeFormat, activeChoice };
}

export function normalizeChatEffort(value: unknown): string | undefined {
  return CHAT_EFFORT_OPTIONS.some((option) => option === value) ? value as string : undefined;
}
