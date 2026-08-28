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
