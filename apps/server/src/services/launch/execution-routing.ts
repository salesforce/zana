import type { AppConfig, HarnessModelRoutingV1, LaunchProfileId, Persona, ProjectSettings } from '@zana-ai/zcc-domain/product';
import type { HarnessPersonaFacet, HarnessRoleTarget } from '@zana-ai/zcc-domain/harness-adapter';
import { harnessFamilyOf } from '@zana-ai/zcc-domain/launch-provider';
import { executionEvidenceFor, executionTargetFor } from '@zana-ai/zcc-host-daemon/harness/evidence-registry';
import type { ExecutionConsentService } from '@zana-ai/zcc-host-daemon/harness/execution-consent';
import type { ExecutionConsentScope, createExecutionConsentStore } from '@zana-ai/zcc-host-daemon/harness/execution-consent-store';
import type { LaunchProvider } from '@zana-ai/zcc-host-daemon/harness/launch-provider';
import { withLiveModelTargets } from '@zana-ai/zcc-host-daemon/harness/launch-provider';
import { providerFor, registrationFor } from '@zana-ai/zcc-host-daemon/harness/registry';
import { harnessEnabledFromProbe } from '@zana-ai/zcc-host-daemon/harness/harness-verify';
import {
  acceptsUnlistedModelTarget,
  allowsLiveListedModelTarget,
  resolveExecutionState,
  resolveModelTarget,
  resolveRoleTarget,
  type AuthorizedModelTarget
} from '@zana-ai/zcc-host-daemon/harness/target-resolution';
import { evaluateFacetEvidence, evaluateTargetEvidence } from '@zana-ai/zcc-host-daemon/harness/routing-evidence';
import type { ExecutionAuthorizationInput, ExecutionPreflightDecision } from './preflight.js';
import { preflightExecutionAuthorization } from './preflight.js';

type ExecutionConsentStore = ReturnType<typeof createExecutionConsentStore>;

export interface TerminalExecutionDiscovery {
  roles(): Promise<readonly HarnessRoleTarget[]>;
  models(): Promise<readonly string[] | undefined>;
}

export interface TerminalExecutionPreflightInput {
  config: AppConfig;
  profile: LaunchProfileId;
  persona?: Persona;
  projectSettings?: ProjectSettings;
  harnessRouting?: HarnessModelRoutingV1;
  extraArgs?: string[];
  projectId: string;
  projectPath?: string;
  scope: 'local' | 'remote';
  mode: ExecutionAuthorizationInput['mode'];
  idempotencyKey: string;
  /**
   * Existing Team definitions predate structured persona-facet routing. Keep
   * their established CLI persona args while still enforcing any explicit
   * role/model/execution selection through the normal evidence gate.
   */
  legacyPersonaFacetCompatibility?: boolean;
}

export async function preflightTerminalExecution(
  input: TerminalExecutionPreflightInput,
  deps: {
    consentStore: Pick<ExecutionConsentStore, 'reserve'>;
    consentService?: Pick<ExecutionConsentService, 'request'>;
    installedVersion: (adapterId: string) => Promise<string | undefined>;
    provider?: LaunchProvider;
    /** If supplied, no provider discovery may run in the coordinator process. */
    discovery?: TerminalExecutionDiscovery;
  }
): Promise<ExecutionPreflightDecision> {
  const effectiveProfile = input.persona?.baseProfile ?? input.profile;
  const sharedProvider = deps.provider ?? providerFor(effectiveProfile);
  const adapterId = harnessFamilyOf(effectiveProfile) || sharedProvider.adapter.descriptor.id;
  // Providers are process-wide singletons. A live inventory belongs to THIS
  // launch only: it is probed at most once and resolved through a launch-scoped
  // view — never written onto the shared provider or into any keyed store, where
  // an interleaved launch (another project, a sibling slot sharing this cwd, or
  // one whose probe failed) would pick it up. The concrete model id a portable
  // level resolves to travels in the decision (`modelPin`), is bound into the
  // authorized launch digest, and is used verbatim by the spawn.
  const liveModels = liveModelProbe(sharedProvider, input, deps.discovery);
  let provider: LaunchProvider = sharedProvider;
  let resolved: ReturnType<typeof resolveExecutionState>;
  let preflight: ReturnType<typeof resolveStructuredRouting>;
  try {
    resolved = resolveExecutionState(provider, executionResolutionInput(input, effectiveProfile));
    preflight = resolveStructuredRouting(provider, input);
    // A portable level must follow the currently installed gateway catalog. Probe
    // after the initial resolution tells us a level was selected, then resolve
    // again against this launch's live view before authorization or spawn.
    if (preflight.model.level && liveModels.available) {
      provider = withLiveModelTargets(sharedProvider, await liveModels.read());
      resolved = resolveExecutionState(provider, executionResolutionInput(input, effectiveProfile));
      preflight = resolveStructuredRouting(provider, input);
    }
  } catch (error) {
    return {
      decision: 'blocked',
      reason: error instanceof Error ? error.message : String(error)
    };
  }
    const combinationError = provider.validateRoutingCombination?.({
      roleTargetId: preflight.role.targetId,
      executionOrigin: preflight.execution.origin,
      executionTargetId: preflight.execution.targetId
    });
  if (combinationError) return { decision: 'blocked', reason: combinationError };
  const modelPin = authorizedModelPin(effectiveProfile, preflight.model);
  const pinned = (decision: ExecutionPreflightDecision): ExecutionPreflightDecision =>
    decision.decision === 'allowed' && modelPin ? { ...decision, modelPin } : decision;
  let installedVersion: string | undefined;
  if (preflight.requested) {
    installedVersion = await deps.installedVersion(adapterId);
    const unavailable = await preflightStructuredRouting(provider, input, installedVersion, preflight, deps.discovery, liveModels);
    if (unavailable) return { decision: 'blocked', reason: unavailable };
  }
  if (resolved.origin === 'inherited-native-default' || (resolved.origin === 'explicit-native' && !resolved.targetId)) {
    // An unrestricted profile (e.g. claude-yolo) with no per-tab override resolves
    // to 'explicit-native' but carries no target to validate — treat it the same
    // as the native-default fallback rather than falling through to the
    // target-required authorization path below.
    return pinned({ decision: 'allowed', scope: input.scope });
  }
  if (resolved.origin === 'legacy-compatibility') {
    const selection = resolved.targetId && resolved.nativePolicy
      ? {
          targetId: resolved.targetId,
          contribution: resolved.contribution,
          nativePolicy: resolved.nativePolicy
        }
      : undefined;
    const reason = selection
      ? provider.adapter.legacyRouting?.auditExecution?.(selection) ?? 'unaudited legacy compatibility target'
      : 'unaudited legacy compatibility target';
    return reason ? { decision: 'blocked', reason } : pinned({ decision: 'allowed', scope: input.scope });
  }
  const target = resolved.targetId ? executionTargetFor(provider, resolved.targetId) : undefined;
  const consentScopes: readonly ExecutionConsentScope[] = input.mode === 'interactive'
    ? ['one-launch', 'project']
    : ['project'];
  return pinned(await preflightExecutionAuthorization({
    adapterId,
    provenance: resolved.origin,
    target,
    evidence: target ? executionEvidenceFor(target.id) : undefined,
    installedVersion: installedVersion ?? await deps.installedVersion(adapterId),
    scope: input.scope,
    profilePosture: provider.adapter.descriptor.profiles.find(({ id }) => id === effectiveProfile)?.posture ?? 'other',
    projectId: input.projectId,
    mode: input.mode,
    consentScopes,
    idempotencyKey: input.idempotencyKey
  }, {
    reserve: deps.consentStore.reserve,
    request: deps.consentService?.request.bind(deps.consentService)
  }));
}

/**
 * The launch's level → concrete model id, when a portable level selected the
 * model. Explicit ids need no pin: the spawn already uses them verbatim.
 */
function authorizedModelPin(
  profile: LaunchProfileId,
  model: { level?: AuthorizedModelTarget['level']; targetId?: string }
): AuthorizedModelTarget | undefined {
  const adapterId = harnessFamilyOf(profile);
  return adapterId && model.level && model.targetId
    ? { adapterId, level: model.level, targetId: model.targetId }
    : undefined;
}

async function preflightStructuredRouting(
  provider: LaunchProvider,
  input: TerminalExecutionPreflightInput,
  installedVersion: string | undefined,
  resolved: ReturnType<typeof resolveStructuredRouting>,
  discovery: TerminalExecutionDiscovery | undefined,
  liveModels: LiveModelProbe
): Promise<string | undefined> {
  if (!installedVersion) return 'selected harness is unavailable or has no verifiable version';
  const registration = registrationFor(provider.adapter.descriptor.defaultProfileId ?? input.profile);
  const verification = registration?.verification;
  const configEnabled = verification?.enabledConfigKey !== undefined
    ? input.config[verification.enabledConfigKey as keyof AppConfig] as boolean | undefined
    : undefined;
  const enabled = harnessEnabledFromProbe({
    alwaysEnabled: verification?.alwaysEnabled,
    configEnabled,
    installed: true
  });
  // A remote daemon supplies a version only for its own enabled harnesses.
  // The coordinator's local toggle does not describe that remote installation.
  if (!enabled && !(input.scope === 'remote' && discovery)) return 'selected harness is disabled';
  for (const facet of resolved.facets) {
    const evaluated = evaluateFacetEvidence(provider, facet, input.scope, installedVersion);
    if (evaluated.classification === 'unavailable') return `${facet}: ${evaluated.reason}`;
  }
  const { role, model } = resolved;
  if (role.targetId) {
    const authoritativeDynamicRoles = !!(provider.acceptsDynamicRoleTargets && provider.discoverRoleTargets && input.projectPath);
    const dynamicRoles = provider.discoverRoleTargets && input.projectPath
      ? await (discovery ? discovery.roles() : provider.discoverRoleTargets({ cwd: input.projectPath, config: input.config }))
      : [];
    const roleTargets = authoritativeDynamicRoles
      ? dynamicRoles
      : [...(provider.adapter.descriptor.targets?.roles ?? []), ...dynamicRoles];
    const target = roleTargets
      .find(({ id }) => id === role.targetId);
    if (!target) return 'role target unavailable';
    const dynamic = authoritativeDynamicRoles || (provider.acceptsDynamicRoleTargets
      && !provider.adapter.descriptor.targets?.roles.some(({ id }) => id === target.id));
    const evidenceTarget = dynamic
      ? provider.dynamicRoleEvidenceTarget?.(target, installedVersion)
      : target;
    if (!evidenceTarget) return 'role target: adapter has no evidence for discovered roles';
    const evaluated = evaluateTargetEvidence(provider, evidenceTarget, input.scope, installedVersion);
    if (evaluated.classification === 'unavailable') return `role target: ${evaluated.reason}`;
  }
  if (model.targetId && model.structuredSelected) {
    const snapshotTarget = provider.adapter.descriptor.targets?.models.find(({ id }) => id === model.targetId);
    // The static model catalog is a release-maintained snapshot that DRIFTS when
    // the installed provider renames models: a snapshot id can be GONE
    // (its spawn dies with ProviderModelNotFoundError / exit 64) and a valid NEW id
    // can be ABSENT from the snapshot. So the LIVE gateway inventory is
    // authoritative when the provider can probe it — it decides yes/no for BOTH
    // cases, catching a drifted-away id before the spawn. Only when no probe is
    // possible (no projectPath, or the provider can't list) do we fall back to the
    // snapshot rule (evidence for a snapshot id; live-listed allowance otherwise).
    const live = liveModels.available ? await liveModels.read() : undefined;
    if (live) {
      if (!live.includes(model.targetId)) return 'model target unavailable';
    } else if (snapshotTarget) {
      const evaluated = evaluateTargetEvidence(provider, snapshotTarget, input.scope, installedVersion);
      if (evaluated.classification === 'unavailable') return `model target: ${evaluated.reason}`;
    } else if (
      !allowsLiveListedModelTarget(provider, model.targetId)
      && !acceptsUnlistedModelTarget(provider, model.targetId)
    ) {
      return 'model target unavailable';
    }
  }
  return undefined;
}

interface LiveModelProbe {
  /** The provider can probe a live inventory for this launch's cwd. */
  readonly available: boolean;
  /** Call only when `available`. At most one probe per launch; the outcome never outlives it. */
  read(): Promise<readonly string[] | undefined>;
}

function liveModelProbe(
  provider: LaunchProvider,
  input: TerminalExecutionPreflightInput,
  discovery: TerminalExecutionDiscovery | undefined
): LiveModelProbe {
  const projectPath = input.projectPath;
  const available = !!(provider.discoverModelTargets && projectPath);
  let pending: Promise<readonly string[] | undefined> | undefined;
  return {
    available,
    read() {
      pending ??= discovery
        ? discovery.models()
        : provider.discoverModelTargets!({ cwd: projectPath!, config: input.config });
      return pending;
    }
  };
}

function executionResolutionInput(input: TerminalExecutionPreflightInput, profile: LaunchProfileId) {
  return {
    config: input.config,
    persona: input.persona,
    projectSettings: input.projectSettings,
    perTabRouting: input.harnessRouting,
    profile,
    extraArgs: input.extraArgs ?? [],
    scope: input.scope
  };
}

function resolveStructuredRouting(provider: LaunchProvider, input: TerminalExecutionPreflightInput) {
  const effectiveProfile = input.persona?.baseProfile ?? input.profile;
  const resolutionInput = {
    config: input.config,
    persona: input.persona,
    projectSettings: input.projectSettings,
    perTabRouting: input.harnessRouting,
    profile: effectiveProfile,
    extraArgs: input.extraArgs ?? [],
    scope: input.scope
  };
  const facets = input.legacyPersonaFacetCompatibility ? [] : personaFacets(input.persona);
  const role = resolveRoleTarget(provider, resolutionInput);
  const model = resolveModelTarget(provider, resolutionInput);
  const execution = resolveExecutionState(provider, resolutionInput);
  return {
    facets,
    role,
    model,
    execution,
    requested: facets.length > 0 || !!role.targetId || model.structuredSelected
      || (execution.origin === 'explicit-native' && !!execution.targetId) || execution.origin === 'portable-mapped'
  };
}

function personaFacets(persona: Persona | undefined): HarnessPersonaFacet[] {
  if (!persona) return [];
  return [
    persona.appendSystemPrompt ? 'system-instructions' : undefined,
    persona.initialPrompt ? 'opening-prompt' : undefined,
    persona.allowedTools?.length ? 'tool-allowlist' : undefined,
    persona.deniedTools?.length ? 'tool-denylist' : undefined,
    persona.addDirs?.length ? 'context-directories' : undefined,
    persona.mcpServers?.length ? 'mcp-references' : undefined
  ].filter((facet): facet is HarnessPersonaFacet => !!facet);
}
