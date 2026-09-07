import type {
  ComposerView,
  PluginComposerApi,
  PluginComposerLaunchPatch
} from '@zana-ai/zcc-plugin-sdk/app';
import { createContext } from 'react';
import type { HarnessModelRoutingV1 } from '@zana-ai/zcc-domain/product';

export const ComposerViewContext = createContext<ComposerView | null>(null);

const composerApiRef: { current: PluginComposerApi | null } = { current: null };
const composerViewRef: { current: ComposerView | null } = { current: null };
const launchPatches = new Map<string, PluginComposerLaunchPatch>();
const patchListeners = new Set<() => void>();
let mergedSnapshot: PluginComposerLaunchPatch = {};

function notifyPatchListeners(): void {
  mergedSnapshot = mergeLaunchPatches(launchPatches.values());
  for (const listener of patchListeners) listener();
}

export function setActiveComposerApi(api: PluginComposerApi | null): void {
  composerApiRef.current = api;
}

export function getActiveComposerApi(): PluginComposerApi | null {
  return composerApiRef.current;
}

export function setActiveComposerView(view: ComposerView | null): void {
  composerViewRef.current = view;
}

export function getActiveComposerView(): ComposerView | null {
  return composerViewRef.current;
}

export function setPluginLaunchPatch(
  pluginId: string,
  patch: PluginComposerLaunchPatch | null
): void {
  if (!pluginId) return;
  if (patch === null) {
    if (!launchPatches.delete(pluginId)) return;
  } else {
    launchPatches.set(pluginId, patch);
  }
  notifyPatchListeners();
}

export function clearLaunchPatches(): void {
  if (launchPatches.size === 0) return;
  launchPatches.clear();
  notifyPatchListeners();
}

export function subscribeLaunchPatches(listener: () => void): () => void {
  patchListeners.add(listener);
  return () => {
    patchListeners.delete(listener);
  };
}

export function mergeHarnessRouting(
  core?: HarnessModelRoutingV1,
  patch?: PluginComposerLaunchPatch['harnessRouting']
): HarnessModelRoutingV1 | undefined {
  if (!core && !patch) return undefined;
  if (!patch) return core;
  if (!core) {
    return {
      schemaVersion: 1,
      byAdapter: { ...patch.byAdapter }
    };
  }
  const byAdapter = { ...core.byAdapter };
  for (const [family, entry] of Object.entries(patch.byAdapter ?? {})) {
    byAdapter[family as keyof typeof byAdapter] = {
      ...byAdapter[family as keyof typeof byAdapter],
      ...entry
    };
  }
  return { schemaVersion: 1, byAdapter };
}

export function mergeExtraArgs(
  core: readonly string[] | undefined,
  patch: readonly string[] | undefined
): string[] | undefined {
  const merged = [...(core ?? []), ...(patch ?? [])];
  return merged.length ? merged : undefined;
}

export function mergeLaunchPatches(
  patches: Iterable<PluginComposerLaunchPatch>
): PluginComposerLaunchPatch {
  const extraArgs: string[] = [];
  let profileId: string | undefined;
  let harnessRouting: PluginComposerLaunchPatch['harnessRouting'];
  for (const patch of patches) {
    if (patch.extraArgs?.length) extraArgs.push(...patch.extraArgs);
    if (patch.profileId) profileId = patch.profileId;
    if (patch.harnessRouting) {
      harnessRouting = mergeHarnessRouting(
        harnessRouting as HarnessModelRoutingV1 | undefined,
        patch.harnessRouting
      ) as PluginComposerLaunchPatch['harnessRouting'];
    }
  }
  return {
    ...(extraArgs.length ? { extraArgs } : {}),
    ...(profileId ? { profileId } : {}),
    ...(harnessRouting ? { harnessRouting } : {})
  };
}

export function getMergedLaunchPatch(): PluginComposerLaunchPatch {
  return mergedSnapshot;
}
