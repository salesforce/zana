import type { HarnessFamily, HarnessVerifyResult, LaunchProfileId } from './types.js';

/** Trusted harness family, including Shell's terminal-only adapter. */
export type HarnessAdapterId = HarnessFamily | 'shell';

export type HarnessProfilePosture = 'default' | 'resume' | 'unrestricted' | 'other';
export type HarnessScope = 'local' | 'remote';
export type HarnessSupport = 'exact' | 'closest' | 'unsupported';
export type HarnessPersonaFacet =
  | 'system-instructions'
  | 'opening-prompt'
  | 'tool-allowlist'
  | 'tool-denylist'
  | 'context-directories'
  | 'mcp-references'
  | 'model-selection'
  | 'execution-policy';
export type InitialTaskTransport = 'spawn-arg' | 'stdin-after-ready' | 'unsupported';
export type InitialTaskReadiness = 'process-spawned' | 'provider-ready' | 'none';
export type InitialTaskAcceptance = 'argv-bound' | 'provider-acknowledged' | 'delivery-attempted';

export type ModelLevel = 'low' | 'medium' | 'high' | 'extra-high';
export type ExecutionState = 'plan' | 'interactive' | 'accept-edits' | 'autonomous';
export type HarnessExecutionEquivalence = 'exact' | 'closest' | 'conditional' | 'unsupported';
export type HarnessExecutionRisk = 'low' | 'medium' | 'high' | 'critical';
export type HarnessConsentRequirement = 'none' | 'required';
export type ProviderModelRelationship = 'fixed-provider' | 'provider-then-model' | 'combined-provider-model' | 'model-only';

export interface HarnessProviderTarget {
  id: string;
  label: string;
}

export interface HarnessRoleTarget {
  id: string;
  label: string;
  scope: HarnessScope[];
  evidenceVersion?: string;
}

export interface HarnessModelTarget {
  id: string;
  label: string;
  provider?: string;
  level?: ModelLevel;
  scope: HarnessScope[];
  evidenceVersion?: string;
}

export interface HarnessEvidence {
  id: string;
  versionRange?: string;
  scope: HarnessScope;
  probe?: string;
  observed?: string;
  reviewedAt?: string;
}

/** Renderer-safe execution mapping metadata. Native argv/env/config stay main-only. */
export interface HarnessExecutionTarget {
  id: string;
  state: ExecutionState;
  equivalence: HarnessExecutionEquivalence;
  effect: string;
  materialDifference: string;
  risk: HarnessExecutionRisk;
  evidence: { id: string; version: number };
  evidenceStatus: 'candidate' | 'approved' | 'revoked';
  scopes: readonly HarnessScope[];
  profilePostures: readonly HarnessProfilePosture[];
  unattendedAllowed: boolean;
  consent: HarnessConsentRequirement;
}

export interface HarnessFacetSupport {
  support: HarnessSupport;
  evidence?: HarnessEvidence;
  reason?: string;
}

export interface HarnessProfileDescriptor {
  id: LaunchProfileId;
  posture: HarnessProfilePosture;
}

export interface HarnessAvailability {
  enabled: boolean;
  installed: boolean;
  version?: string;
  reason?: string;
}

export interface HarnessTargetCatalog {
  roles: readonly HarnessRoleTarget[];
  providers?: readonly HarnessProviderTarget[];
  providerModelRelationship?: ProviderModelRelationship;
  models: readonly HarnessModelTarget[];
  modelLevelMapping: Readonly<Record<ModelLevel, string | undefined>>;
  /** Portable execution states supported by this adapter and their native policy labels. */
  executionStateMapping?: Readonly<Partial<Record<ExecutionState, string>>>;
  executionTargets?: readonly HarnessExecutionTarget[];
}

/** Renderer-safe adapter metadata. This contains no native argv/env/config. */
export interface HarnessAdapterDescriptor {
  id: HarnessAdapterId;
  label: string;
  agentDefaultEligible: boolean;
  terminalEligible: boolean;
  defaultProfileId?: LaunchProfileId;
  /** Adapter-owned legacy fallback used only when no launch selection is configured. */
  compatibilityFallbackProfileId?: LaunchProfileId;
  profiles: readonly HarnessProfileDescriptor[];
  availability: HarnessAvailability;
  capabilities: Readonly<Record<HarnessPersonaFacet, Readonly<Record<HarnessScope, HarnessFacetSupport>>>>;
  targets?: HarnessTargetCatalog;
  settingsContributionIds: readonly string[];
  initialTaskDelivery: {
    local: InitialTaskTransport;
    remote: InitialTaskTransport;
    readinessSignal: InitialTaskReadiness;
    acceptanceSignal: InitialTaskAcceptance;
    evidenceVersion?: string;
  };
}

/** Resolve a verification row to a descriptor availability value. */
export function availabilityFromVerify(
  id: HarnessAdapterId,
  result: HarnessVerifyResult | undefined
): HarnessAvailability {
  if (id === 'shell') return { enabled: true, installed: true };
  if (!result) return { enabled: false, installed: false, reason: 'Verification required' };
  if (!result.enabled) return { enabled: false, installed: result.installed, version: result.version, reason: 'Disabled' };
  if (!result.installed) return { enabled: true, installed: false, reason: 'Binary not found' };
  return { enabled: true, installed: true, version: result.version };
}
