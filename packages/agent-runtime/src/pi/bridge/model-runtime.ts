import { resolve } from "node:path";
import {
  resolveModelScopeWithDiagnostics,
  type ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import {
  loadConfiguredPiServices,
  type LoadedPiServices,
} from "./configured-services.js";

const loadedByCwd = new Map<string, Promise<LoadedPiServices>>();

function loadPiServicesForCwd(cwd: string): Promise<LoadedPiServices> {
  const resolvedCwd = resolve(cwd);
  const existing = loadedByCwd.get(resolvedCwd);
  if (existing) {
    return existing;
  }

  const loaded = loadConfiguredPiServices({ cwd: resolvedCwd })
    .then((result) => {
      if (result.configErrors.length > 0) {
        for (const configError of result.configErrors) {
          process.stderr.write(`pi bridge: ${configError}\n`);
        }
        loadedByCwd.delete(resolvedCwd);
      }
      return result;
    })
    .catch((error: unknown) => {
      loadedByCwd.delete(resolvedCwd);
      throw error;
    });
  loadedByCwd.set(resolvedCwd, loaded);
  return loaded;
}

export function getPiModelRuntime(cwd = process.cwd()): Promise<ModelRuntime> {
  return loadPiServicesForCwd(cwd).then(({ services }) => services.modelRuntime);
}

export interface PiModelPickerScope {
  scopedModelIds?: string[];
  preferredDefaultId?: string;
}

/**
 * Honor Pi `enabledModels` / default model settings the SDK already loaded.
 * Empty scope means the full catalog.
 */
export async function getPiModelPickerScope(
  cwd = process.cwd(),
): Promise<PiModelPickerScope> {
  const { services } = await loadPiServicesForCwd(cwd);
  const enabled = services.settingsManager.getEnabledModels();
  const defaultProvider = services.settingsManager.getDefaultProvider();
  const defaultModel = services.settingsManager.getDefaultModel();
  const preferredDefaultId =
    defaultProvider && defaultModel
      ? `${defaultProvider}/${defaultModel}`
      : undefined;
  if (!enabled || enabled.length === 0) {
    return preferredDefaultId ? { preferredDefaultId } : {};
  }
  const { scopedModels } = await resolveModelScopeWithDiagnostics(
    enabled,
    services.modelRuntime,
  );
  return {
    scopedModelIds: scopedModels.map(
      (entry) => `${entry.model.provider}/${entry.model.id}`,
    ),
    ...(preferredDefaultId ? { preferredDefaultId } : {}),
  };
}

/** @internal Test seam. */
export function resetPiModelRuntimesForTests(): void {
  loadedByCwd.clear();
}
