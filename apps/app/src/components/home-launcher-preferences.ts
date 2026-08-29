export interface HomeLauncherPreferences {
  projectId?: string;
  modelId?: string;
}

export function parseHomeLauncherPreferences(raw: string | null): HomeLauncherPreferences {
  try {
    const value = JSON.parse(raw ?? '{}') as Record<string, unknown>;
    return {
      projectId: typeof value.projectId === 'string' ? value.projectId : undefined,
      modelId: typeof value.modelId === 'string' ? value.modelId : undefined
    };
  } catch {
    return {};
  }
}
