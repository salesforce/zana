import type { HarnessFamily, LaunchProfileId } from '@zana-ai/zcc-domain/product';
import type { PromptTextMention } from '@zana-ai/zcc-domain/thread-runtime';

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
 */
export function cliAgentModelOptions(input: {
  adapterModels: ReadonlyArray<{ id: string; label: string }>;
  catalogModels: ReadonlyArray<{ model: string; displayName: string }>;
}): CliAgentModelOption[] {
  if (input.adapterModels.length > 0) {
    return input.adapterModels.map((row) => ({ id: row.id, label: row.label }));
  }
  return input.catalogModels.map((row) => ({ id: row.model, label: row.displayName }));
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
