export type ModelOption = {
  readonly label: string;
  readonly value: string;
};

export function normalizeModelList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    });
}

export function modelNamesToOptions(models: readonly string[]): ModelOption[] {
  return normalizeModelList(models).map((value) => ({ label: value, value }));
}

export function mergeModelOptions(
  presets: readonly ModelOption[],
  customModels: readonly string[],
): ModelOption[] {
  const seen = new Set<string>();
  const options: ModelOption[] = [];

  presets.forEach((option) => {
    if (seen.has(option.value)) return;
    seen.add(option.value);
    options.push(option);
  });

  normalizeModelList(customModels).forEach((value) => {
    if (seen.has(value)) return;
    seen.add(value);
    options.push({ label: value, value });
  });

  return options;
}

export function addModelToList(models: readonly string[], model: string): string[] {
  return normalizeModelList([...models, model]);
}

export function removeModelFromList(models: readonly string[], model: string): string[] {
  return normalizeModelList(models).filter((item) => item !== model);
}

export function getModelFallback(
  options: readonly ModelOption[],
  preferredModel: string,
  removedModel: string,
) {
  const remainingModels = options.filter((option) => option.value !== removedModel);
  return remainingModels.some((option) => option.value === preferredModel)
    ? preferredModel
    : remainingModels[0]?.value || preferredModel;
}
