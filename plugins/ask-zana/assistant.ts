export interface ModelChoice {
  providerId: string;
  modelId: string;
}

export interface AvailableModel extends ModelChoice {
  providerLabel: string;
  modelLabel: string;
}

export interface AssistantAvailability {
  defaultModel: AvailableModel | null;
  models: AvailableModel[];
}

export interface AssistantStatus extends AssistantAvailability {
  selection: ModelChoice | null;
}

export interface Turn {
  question: string;
  answer: string;
  sourceIds: string[];
}

export const noAssistant: AssistantStatus = {
  defaultModel: null,
  models: [],
  selection: null
};

export function modelKey(model: ModelChoice): string {
  return JSON.stringify([model.providerId, model.modelId]);
}

export function resolveModel(status: AssistantStatus): AvailableModel | null {
  const selected = status.selection;
  return selected
    ? status.models.find((model) => modelKey(model) === modelKey(selected)) ?? null
    : status.defaultModel;
}
