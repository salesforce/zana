import type { HarnessFamily, HarnessModelRoutingV1, LaunchProfileId } from '@zana-ai/zcc-domain/product';
import type { PromptTextMention } from '@zana-ai/zcc-domain/thread-runtime';
import type { PluginComposerLaunchPatch } from '@zana-ai/zcc-plugin-sdk/app';
import {
  mergeExtraArgs,
  mergeHarnessRouting,
  mergeLaunchPatches
} from '../plugins/plugin-composer-api.js';
import { permissionModeOptionsFor } from './thread/pickers/permission-mode-options.js';

export const PROFILE_BY_FAMILY: Record<HarnessFamily, LaunchProfileId> = {
  claude: 'claude',
  cursor: 'cursor',
  codex: 'codex',
  pi: 'pi',
  opencode: 'opencode'
};

const THREAD_PROVIDER_BY_FAMILY: Record<HarnessFamily, string> = {
  claude: 'claude-code',
  cursor: 'acp-cursor',
  codex: 'codex',
  pi: 'pi',
  opencode: 'acp-opencode'
};

export type CliAgentModelOption = { id: string; label: string };

/**
 * Claude/Codex/Cursor/OpenCode keep their trusted PTY adapter catalogs.
 * Pi's adapter catalog is empty, so the CLI Agent picker uses the live
 * thread model list (`provider.list_models`) instead of "No models available".
 * When `preferCatalog` is set (remote host catalog experiment), the live
 * host list wins once it has loaded — including an empty list.
 */
export function cliAgentModelOptions(input: {
  adapterModels: ReadonlyArray<{ id: string; label: string }>;
  catalogModels: ReadonlyArray<{ model: string; displayName: string }>;
  preferCatalog?: boolean;
  catalogReady?: boolean;
}): CliAgentModelOption[] {
  if (input.preferCatalog && (input.catalogReady || input.catalogModels.length > 0)) {
    return input.catalogModels.map((row) => ({ id: row.model, label: row.displayName }));
  }
  if (input.adapterModels.length > 0) {
    return input.adapterModels.map((row) => ({ id: row.id, label: row.label }));
  }
  return input.catalogModels.map((row) => ({ id: row.model, label: row.displayName }));
}

export function cliAgentMoreModelOptions(input: {
  adapterModelCount: number;
  catalogMoreModels: ReadonlyArray<{ model: string; displayName: string }>;
  preferCatalog: boolean;
}): Array<{ value: string; label: string }> {
  if (!input.preferCatalog && input.adapterModelCount > 0) return [];
  return input.catalogMoreModels.map((row) => ({
    value: row.model,
    label: row.displayName
  }));
}

/** PTY-capable providers from the host execution-options roster. */
export function cliAgentCatalogProviders<T extends {
  id: string;
  displayName: string;
  permissionModes?: readonly string[];
  composerActions?: readonly string[];
}>(
  catalogProviders: readonly T[]
): Array<{ id: string; displayName: string; permissionModes: string[]; composerActions: string[] }> {
  return catalogProviders.flatMap((row) =>
    familyForThreadProviderId(row.id)
      ? [{
          id: row.id,
          displayName: row.displayName,
          permissionModes: [...(row.permissionModes ?? [])],
          composerActions: [...(row.composerActions ?? [])]
        }]
      : []
  );
}

export function cliAgentFamilyIdsFromCatalog(
  catalogProviders: readonly { id: string }[]
): string[] {
  const ids: string[] = [];
  for (const row of catalogProviders) {
    const family = familyForThreadProviderId(row.id);
    if (family) ids.push(family);
  }
  return ids;
}

export function threadProviderIdForFamily(family: string): string | null {
  if (family in THREAD_PROVIDER_BY_FAMILY) return THREAD_PROVIDER_BY_FAMILY[family as HarnessFamily];
  return null;
}

export function familyForThreadProviderId(providerId: string): HarnessFamily | null {
  for (const [family, id] of Object.entries(THREAD_PROVIDER_BY_FAMILY) as Array<[HarnessFamily, string]>) {
    if (id === providerId) return family;
  }
  return null;
}

/**
 * Keep a still-available family (current, then last-used, then configured default)
 * so the CLI composer does not flash empty on catalog / persona churn.
 */
export function resolveCliAgentFamily(input: {
  currentFamilyId: string;
  availableFamilyIds: readonly string[];
  rememberedFamilyId: string | null;
  effectiveDefaultFamilyId: string | null;
}): string {
  const available = new Set(input.availableFamilyIds);
  if (available.size === 0) {
    return input.currentFamilyId || input.rememberedFamilyId || input.effectiveDefaultFamilyId || '';
  }
  if (input.currentFamilyId && available.has(input.currentFamilyId)) return input.currentFamilyId;
  if (input.rememberedFamilyId && available.has(input.rememberedFamilyId)) return input.rememberedFamilyId;
  if (input.effectiveDefaultFamilyId && available.has(input.effectiveDefaultFamilyId)) {
    return input.effectiveDefaultFamilyId;
  }
  return input.effectiveDefaultFamilyId || '';
}

export function availableAgentHarnesses<T extends {
  agentDefaultEligible: boolean;
  availability: { enabled: boolean; installed: boolean };
}>(descriptors: readonly T[]): T[] {
  return descriptors.filter((descriptor) =>
    descriptor.agentDefaultEligible
    && descriptor.availability.enabled
    && descriptor.availability.installed
  );
}

export function isAbsoluteLocalPath(path: string): boolean {
  return path.startsWith('/') || /^[a-zA-Z]:[\\/]/u.test(path);
}

export function absolutePathMentions(mentions: readonly PromptTextMention[]): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const mention of mentions) {
    if (mention.resource.kind !== 'path') continue;
    const path = mention.resource.path;
    if (!path || !isAbsoluteLocalPath(path) || seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
  }
  return paths;
}

export function rewritePromptPaths(
  text: string,
  replacements: ReadonlyArray<{ from: string; to: string }>
): string {
  let next = text;
  for (const { from, to } of replacements) {
    if (!from || from === to) continue;
    next = next.split(`@${from}`).join(`@${to}`);
  }
  return next;
}

export function assembleCliLaunchPrompt(args: {
  text: string;
  imagePaths?: readonly string[];
}): string {
  const parts = [
    args.text.trim(),
    ...(args.imagePaths ?? []).map((path) => (path.startsWith('@') ? path : `@${path}`))
  ].filter(Boolean);
  return parts.join('\n');
}

export { mergeExtraArgs, mergeHarnessRouting, mergeLaunchPatches };

const EXTRA_ARGS_STORAGE_KEY = 'zcc.cliComposer.extraArgs';

function extraArgsStore(): Record<string, string[]> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(EXTRA_ARGS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const next: Record<string, string[]> = {};
    for (const [family, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(value)) continue;
      next[family] = value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
    }
    return next;
  } catch {
    return {};
  }
}

export function readCliExtraArgs(familyId: string): string[] {
  if (!familyId) return [];
  return extraArgsStore()[familyId] ?? [];
}

export function writeCliExtraArgs(familyId: string, args: string[]): void {
  if (!familyId || typeof localStorage === 'undefined') return;
  const next = extraArgsStore();
  if (args.length) next[familyId] = args;
  else delete next[familyId];
  localStorage.setItem(EXTRA_ARGS_STORAGE_KEY, JSON.stringify(next));
}

export function resolveCliLaunchProfile(input: {
  baseProfile: LaunchProfileId;
  patchProfileId?: string;
}): LaunchProfileId {
  const candidate = input.patchProfileId?.trim();
  if (!candidate) return input.baseProfile;
  return candidate as LaunchProfileId;
}

export function unrestrictedProfileId(
  profiles: readonly { id: string; posture: string }[] | undefined
): string | undefined {
  return profiles?.find((profile) => profile.posture === 'unrestricted')?.id;
}

/** Filter Modern permission modes to what this CLI harness can actually spawn. */
export function cliPermissionModesFor(input: {
  catalogModes: readonly string[];
  hasUnrestrictedProfile: boolean;
}): string[] {
  const modes = permissionModeOptionsFor(input.catalogModes).map((option) => option.value);
  if (!input.hasUnrestrictedProfile) return modes.filter((mode) => mode !== 'full');
  return modes;
}

export function cliLaunchFromPermissionMode(input: {
  mode: string;
  unrestrictedProfileId?: string;
}): { profileId?: string; executionState?: 'accept-edits' } {
  if (input.mode === 'full' && input.unrestrictedProfileId) {
    return { profileId: input.unrestrictedProfileId };
  }
  if (input.mode === 'accept-edits') return { executionState: 'accept-edits' };
  return {};
}

export function withExecutionState(
  routing: HarnessModelRoutingV1 | undefined,
  familyId: string,
  executionState: 'plan' | 'interactive' | 'accept-edits' | 'autonomous' | ''
): HarnessModelRoutingV1 | undefined {
  if (!familyId || !executionState) return routing;
  const byAdapter = { ...(routing?.byAdapter ?? {}) };
  byAdapter[familyId as HarnessFamily] = {
    ...byAdapter[familyId as HarnessFamily],
    executionState
  };
  return { schemaVersion: 1, byAdapter };
}

/** First-slot chip for CLI Agent. OpenCode keeps native `--agent` roles. */
export type CliComposerModeChip = 'native-role' | 'work-mode' | 'none';

export const CLI_WORK_MODES = ['agent', 'plan'] as const;

export function cliComposerModeChip(familyId: string): CliComposerModeChip {
  if (familyId === 'opencode') return 'native-role';
  if (familyId === 'claude' || familyId === 'cursor' || familyId === 'codex') return 'work-mode';
  return 'none';
}

/**
 * Fold Plan into the existing executionState merge. Default Agent emits nothing
 * extra so Claude/Cursor/Codex launches stay byte-identical. Plan XOR Edits;
 * a native OpenCode role or Full/yolo profile skips structured executionState.
 */
export function cliLaunchExecutionState(input: {
  familyId: string;
  workMode: (typeof CLI_WORK_MODES)[number];
  permissionExecutionState?: 'accept-edits';
  hasNativeRole: boolean;
  unrestrictedProfileSelected: boolean;
}): 'plan' | 'accept-edits' | undefined {
  if (input.hasNativeRole || input.unrestrictedProfileSelected) return undefined;
  if (cliComposerModeChip(input.familyId) === 'work-mode' && input.workMode === 'plan') {
    return 'plan';
  }
  return input.permissionExecutionState;
}

export function applyLaunchPatch(input: {
  baseProfile: LaunchProfileId;
  extraArgs?: readonly string[];
  harnessRouting?: HarnessModelRoutingV1;
  patch: PluginComposerLaunchPatch;
}): {
  profile: LaunchProfileId;
  extraArgs?: string[];
  harnessRouting?: HarnessModelRoutingV1;
} {
  return {
    profile: resolveCliLaunchProfile({
      baseProfile: input.baseProfile,
      patchProfileId: input.patch.profileId
    }),
    extraArgs: mergeExtraArgs(input.extraArgs, input.patch.extraArgs),
    harnessRouting: mergeHarnessRouting(input.harnessRouting, input.patch.harnessRouting)
  };
}
