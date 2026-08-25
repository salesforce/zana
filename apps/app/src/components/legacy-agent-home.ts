import type { HarnessFamily, LaunchProfileId } from '@zana-ai/zcc-domain/product';

export const PROFILE_BY_FAMILY: Record<HarnessFamily, LaunchProfileId> = {
  claude: 'claude',
  cursor: 'cursor',
  codex: 'codex',
  pi: 'pi',
  opencode: 'opencode'
};

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
