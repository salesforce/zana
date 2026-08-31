import type { AppConfig, Persona, ProjectSettings, LaunchProfileId, HarnessModelRoutingV1 } from '@zana-ai/zcc-domain/product';
import type { HarnessFamily } from '@zana-ai/zcc-domain/product';
import type { HarnessScope, ModelLevel } from '@zana-ai/zcc-domain/harness-adapter';
import { harnessFamilyOf } from '@zana-ai/zcc-domain/launch-provider';
import { hasNativeOption, type HarnessNativeContribution } from './adapter-contract.js';
import { executionTargetFor } from './evidence-registry.js';

export interface TargetResolutionInput {
  config: AppConfig;
  persona?: Persona;
  projectSettings?: ProjectSettings;
  perTabRouting?: HarnessModelRoutingV1;
  profile: LaunchProfileId;
  extraArgs: string[];
  /** Main-derived launch scope. Per-tab routing cannot select a local-only target remotely. */
  scope?: HarnessScope;
}

export interface ModelResolution {
  providerTargetId?: string;
  targetId?: string;
  level?: ModelLevel;
  source: 'per-tab' | 'project' | 'persona' | 'global' | 'native-default';
  structuredSelected: boolean;
  /** A trailing raw model flag may override config-derived launch selection. */
  rawOverride?: boolean;
  contribution: HarnessNativeContribution;
}

export interface RoleResolution {
  targetId?: string;
  source: 'Agent' | 'Persona' | 'Project' | 'Global' | 'native-default';
  contribution: HarnessNativeContribution;
}

export interface ExecutionResolution {
  state?: 'plan' | 'interactive' | 'accept-edits' | 'autonomous';
  origin: 'explicit-native' | 'portable-mapped' | 'inherited-native-default' | 'legacy-compatibility';
  source: 'Agent' | 'Persona' | 'Project' | 'Global' | 'native-default';
  targetId?: string;
  equivalence?: import('@zana-ai/zcc-domain/harness-adapter').HarnessExecutionEquivalence;
  consentRequired: boolean;
  contribution: HarnessNativeContribution;
  /** Existing native policy selected by precedence; later preflight can audit it without re-parsing argv. */
  nativePolicy?: Readonly<Record<string, string>>;
}

import type { LaunchProvider } from './launch-provider.js';

/** Pi (and similar) list models at runtime; the static adapter catalog is empty. */
const LIVE_LISTED_MODEL_TARGET_ID = /^[A-Za-z0-9][\w./:+@-]{0,255}$/;

export function isLiveListedModelTargetId(id: string): boolean {
  return !id.startsWith('-') && LIVE_LISTED_MODEL_TARGET_ID.test(id);
}

/** Pi-style adapters list models at runtime; an empty static catalog still accepts those ids. */
export function allowsLiveListedModelTarget(provider: LaunchProvider, targetId: string): boolean {
  const catalog = provider.adapter.descriptor.targets?.models ?? [];
  return catalog.length === 0 && isLiveListedModelTargetId(targetId) && !!provider.modelContribution;
}

const MODEL_LEVELS: readonly ModelLevel[] = ['low', 'medium', 'high', 'extra-high'];
const EXECUTION_STATES = ['plan', 'interactive', 'accept-edits', 'autonomous'] as const;

/**
 * Renderer-provided per-tab routing is intent, never authority. Validate its full
 * shape at the launch boundary before consulting the trusted provider catalog.
 */
function validatePerTabRouting(routing: HarnessModelRoutingV1 | undefined): void {
  if (!routing) return;
  if (routing.schemaVersion !== 1 || !routing.byAdapter || typeof routing.byAdapter !== 'object') {
    throw new Error('Invalid structured model routing request.');
  }
  for (const [family, value] of Object.entries(routing.byAdapter)) {
    if (!['claude', 'cursor', 'codex', 'pi', 'opencode'].includes(family) || !value || typeof value !== 'object') {
      throw new Error('Invalid structured model routing request.');
    }
    const intent = value as {
      providerTargetId?: unknown;
      roleTargetId?: unknown;
      modelTargetId?: unknown;
      modelLevel?: unknown;
      executionState?: unknown;
      executionTargetId?: unknown;
      compatibility?: unknown;
    };
    const compatibility = intent.compatibility;
    if (
      Object.keys(intent).some((key) => !['providerTargetId', 'roleTargetId', 'modelTargetId', 'modelLevel', 'executionState', 'executionTargetId', 'compatibility'].includes(key)) ||
      (intent.roleTargetId !== undefined &&
        (typeof intent.roleTargetId !== 'string' || !intent.roleTargetId.trim() || intent.roleTargetId.length > 256)) ||
      (intent.modelTargetId !== undefined &&
        (typeof intent.modelTargetId !== 'string' || !intent.modelTargetId.trim() || intent.modelTargetId.length > 512)) ||
      (intent.providerTargetId !== undefined &&
        (typeof intent.providerTargetId !== 'string' || !intent.providerTargetId.trim() || intent.providerTargetId.length > 256)) ||
      (intent.modelLevel !== undefined && !MODEL_LEVELS.includes(intent.modelLevel as ModelLevel)) ||
      (intent.executionState !== undefined && !EXECUTION_STATES.includes(intent.executionState as typeof EXECUTION_STATES[number])) ||
      (intent.executionTargetId !== undefined &&
        (typeof intent.executionTargetId !== 'string' || !intent.executionTargetId.trim() || intent.executionTargetId.length > 256)) ||
      (compatibility !== undefined &&
        (!compatibility || typeof compatibility !== 'object' || Array.isArray(compatibility) ||
          Object.keys(compatibility as object).length > 8 ||
          Object.values(compatibility as Record<string, unknown>).some((entry) =>
            typeof entry !== 'string' || !entry.trim() || entry.length > 256)))
    ) {
      throw new Error('Invalid structured model routing request.');
    }
  }
}

export function resolveModelTarget(provider: LaunchProvider, input: TargetResolutionInput): ModelResolution {
  const adapterId = harnessFamilyOf(input.profile);
  if (!adapterId) return { source: 'native-default', structuredSelected: false, contribution: {} };

  validatePerTabRouting(input.perTabRouting);
  let targetId: string | undefined;
  let level: ModelLevel | undefined;
  let source: ModelResolution['source'] = 'native-default';
  let structuredSelected = false;

  const hasRawModel = hasNativeOption(
    input.extraArgs,
    provider.adapter.collision.model,
    provider.adapter.collision.terminatesAtDoubleDash
  );

  const perTab = input.perTabRouting?.byAdapter?.[adapterId as HarnessFamily];
  const personaRouting = input.persona?.harnessRouting?.byAdapter?.[adapterId as HarnessFamily];
  const personaPinsAdapter = !!input.persona?.baseProfile
    && harnessFamilyOf(input.persona.baseProfile) === adapterId;
  const projectRouting = input.projectSettings?.harnessRouting?.byAdapter?.[adapterId as HarnessFamily];
  const globalRouting = input.config.harnessRouting?.byAdapter?.[adapterId as HarnessFamily];
  const providerTargetId = perTab?.providerTargetId
    ?? (personaPinsAdapter ? personaRouting?.providerTargetId : undefined)
    ?? projectRouting?.providerTargetId
    ?? globalRouting?.providerTargetId;
  if (perTab?.modelTargetId) {
    targetId = perTab.modelTargetId;
    source = 'per-tab';
    structuredSelected = true;
  } else if (perTab?.modelLevel) {
    level = perTab.modelLevel;
    source = 'per-tab';
    structuredSelected = true;
  }


  if (!targetId && !level && input.persona) {
    if (personaPinsAdapter && personaRouting?.modelTargetId) {
      targetId = personaRouting.modelTargetId;
      source = 'persona';
      structuredSelected = true;
    } else if (input.persona.modelLevel) {
      level = input.persona.modelLevel;
      source = 'persona';
      structuredSelected = true;
    } else {
      const legacy = provider.adapter.legacyRouting?.resolveModel?.(legacyContext(input), 'persona');
      if (legacy?.targetId) {
        targetId = legacy.targetId;
        source = 'persona';
      }
    }
  }

  if (!targetId && !level && input.projectSettings) {
    if (projectRouting?.modelTargetId) {
      targetId = projectRouting.modelTargetId;
      source = 'project';
      structuredSelected = true;
    }
    if (!targetId && !level && projectRouting?.modelLevel) {
      level = projectRouting.modelLevel;
      source = 'project';
      structuredSelected = true;
    }
    if (!targetId && !level && input.projectSettings.modelLevel) {
      level = input.projectSettings.modelLevel;
      source = 'project';
      structuredSelected = true;
    }
    if (!targetId && !level) {
      const legacy = provider.adapter.legacyRouting?.resolveModel?.(legacyContext(input), 'project');
      if (legacy?.targetId) {
        targetId = legacy.targetId;
        source = 'project';
      }
    }
  }





  if (!targetId && !level) {
    if (globalRouting?.modelTargetId) {
      targetId = globalRouting.modelTargetId;
      source = 'global';
      structuredSelected = true;
    } else if (globalRouting?.modelLevel) {
      level = globalRouting.modelLevel;
      source = 'global';
      structuredSelected = true;
    }
  }

  if (!targetId && !level) {
    const legacy = provider.adapter.legacyRouting?.resolveModel?.(legacyContext(input), 'global');
    if (legacy?.targetId) {
      targetId = legacy.targetId;
      source = 'global';
    }
  }

  if (!targetId && level) {
    targetId = provider.adapter.descriptor.targets?.modelLevelMapping?.[level];
    if (!targetId) {
      throw new Error(`${provider.adapter.descriptor.label} does not support ${level} model level.`);
    }
  }

  let contribution: HarnessNativeContribution = {};
  if (structuredSelected && targetId) {
    const catalogModels = provider.adapter.descriptor.targets?.models ?? [];
    const target = catalogModels.find((candidate) => candidate.id === targetId);
    if (!target) {
      if (!allowsLiveListedModelTarget(provider, targetId)) {
        throw new Error(`Unknown model target for ${provider.adapter.descriptor.label}.`);
      }
    } else if (input.scope && !target.scope.includes(input.scope)) {
      throw new Error(`${provider.adapter.descriptor.label} model target is unavailable for ${input.scope} launches.`);
    }
  }
  if (providerTargetId) {
    const catalog = provider.adapter.descriptor.targets;
    const providerTarget = catalog?.providers?.find((candidate) => candidate.id === providerTargetId);
    if (!providerTarget) throw new Error(`Unknown provider target for ${provider.adapter.descriptor.label}.`);
    if (catalog?.providerModelRelationship === 'combined-provider-model' && !targetId) {
      throw new Error(`${provider.adapter.descriptor.label} provider selection requires a concrete compatible model target.`);
    }
    if (targetId && catalog?.providerModelRelationship !== 'fixed-provider') {
      const modelTarget = catalog?.models.find((candidate) => candidate.id === targetId);
      if (modelTarget?.provider && modelTarget.provider !== providerTargetId) {
        throw new Error(`${provider.adapter.descriptor.label} model target does not belong to selected provider.`);
      }
    }
  }
  if (targetId && provider.modelContribution) {
    contribution = provider.modelContribution(targetId, level);
  }

  if (hasRawModel && structuredSelected) {
    throw new Error('Structured model selection conflicts with raw --model arguments. Remove raw model arguments or clear structured selection.');
  }

  return { providerTargetId, targetId, level, source, structuredSelected, rawOverride: hasRawModel, contribution };
}

export function resolveRoleTarget(provider: LaunchProvider, input: TargetResolutionInput): RoleResolution {
  const adapterId = harnessFamilyOf(input.profile);
  if (!adapterId) return { source: 'native-default', contribution: {} };
  validatePerTabRouting(input.perTabRouting);

  let targetId: string | undefined;
  let source: RoleResolution['source'] = 'native-default';
  const perTabTarget = input.perTabRouting?.byAdapter?.[adapterId]?.roleTargetId;
  const projectTarget = input.projectSettings?.harnessRouting?.byAdapter?.[adapterId]?.roleTargetId;
  const globalTarget = input.config.harnessRouting?.byAdapter?.[adapterId]?.roleTargetId;

  if (perTabTarget) {
    targetId = perTabTarget;
    source = 'Agent';
  }

  if (!targetId && input.persona) {
    const routingTarget = input.persona.harnessRouting?.byAdapter?.[adapterId as keyof typeof input.persona.harnessRouting.byAdapter];
    const personaAllowsAdapter = !input.persona.baseProfile
      || harnessFamilyOf(input.persona.baseProfile) === adapterId;
    if (personaAllowsAdapter && routingTarget?.roleTargetId) {
      targetId = routingTarget.roleTargetId;
      source = 'Persona';
    }
  }
  if (!targetId && projectTarget) {
    targetId = projectTarget;
    source = 'Project';
  }
  if (!targetId && globalTarget) {
    targetId = globalTarget;
    source = 'Global';
  }

  let contribution: HarnessNativeContribution = {};
  if (targetId) {
    const target = provider.adapter.descriptor.targets?.roles.find((candidate) => candidate.id === targetId);
    if (!target && !provider.acceptsDynamicRoleTargets) {
      throw new Error(`Unknown role target for ${provider.adapter.descriptor.label}.`);
    }
    if (input.scope && (target ? !target.scope.includes(input.scope) : input.scope !== 'local')) {
      throw new Error(`${provider.adapter.descriptor.label} role target is unavailable for ${input.scope} launches.`);
    }
    if (provider.roleContribution) contribution = provider.roleContribution(targetId);
    if (hasNativeOption(input.extraArgs, provider.adapter.collision.role, provider.adapter.collision.terminatesAtDoubleDash)) {
      throw new Error('Structured role selection conflicts with raw role arguments.');
    }
  }

  return { targetId, source, contribution };
}

/** Resolve portable execution intent. Unsupported adapters preserve native behavior. */
export function resolveExecutionState(provider: LaunchProvider, input: TargetResolutionInput): ExecutionResolution {
  const adapterId = harnessFamilyOf(input.profile);
  if (!adapterId) return { origin: 'inherited-native-default', source: 'native-default', consentRequired: false, contribution: {} };
  validatePerTabRouting(input.perTabRouting);
  const globalState = input.config.harnessRouting?.byAdapter?.[adapterId as HarnessFamily]?.executionState;
  const perTabState = input.perTabRouting?.byAdapter?.[adapterId as HarnessFamily]?.executionState;
  const perTabTargetId = input.perTabRouting?.byAdapter?.[adapterId as HarnessFamily]?.executionTargetId;
  const perTabCompatibility = input.perTabRouting?.byAdapter?.[adapterId as HarnessFamily]?.compatibility;
  const effectiveProfile = input.persona?.baseProfile ?? input.profile;
  const unrestrictedProfile = provider.adapter.descriptor.profiles.find((candidate) => candidate.id === effectiveProfile)?.posture === 'unrestricted';
  const projectState = input.projectSettings?.harnessRouting?.byAdapter?.[adapterId as HarnessFamily]?.executionState
    ?? input.projectSettings?.executionState;
  const personaPinsAdapter = !!input.persona?.baseProfile
    && harnessFamilyOf(input.persona.baseProfile) === adapterId;
  const personaState = (personaPinsAdapter
    ? input.persona?.harnessRouting?.byAdapter?.[adapterId as HarnessFamily]?.executionState
    : undefined) ?? input.persona?.executionState;
  if (unrestrictedProfile && (perTabState || perTabTargetId || perTabCompatibility)) {
    throw new Error('Structured execution state conflicts with unrestricted profile.');
  }
  if (unrestrictedProfile) return {
    state: undefined, origin: 'explicit-native', source: 'native-default', consentRequired: false, contribution: {}
  };
  if (perTabTargetId) {
    const target = executionTargetFor(provider, perTabTargetId);
    if (!target) throw new Error(`Unknown execution target for ${provider.adapter.descriptor.label}.`);
    return {
      state: target.state, origin: 'explicit-native', source: 'Agent', targetId: target.id,
      equivalence: target.equivalence, consentRequired: false,
      contribution: provider.executionContribution?.(target.id) ?? {}
    };
  }
  if (perTabCompatibility && !perTabState) {
    const legacy = provider.adapter.legacyRouting?.resolveCompatibilityExecution?.(perTabCompatibility);
    if (!legacy) throw new Error('Invalid structured model routing request.');
    assertNoRawExecutionCollision(provider, input.extraArgs);
    return {
      origin: 'explicit-native', source: 'Agent', consentRequired: false,
      targetId: legacy.targetId, equivalence: 'exact', contribution: legacy.contribution, nativePolicy: legacy.nativePolicy
    };
  }
  const personaLegacy = provider.adapter.legacyRouting?.resolveExecution?.(legacyContext(input), 'persona');
  if (!perTabState && personaLegacy) {
    assertNoRawExecutionCollision(provider, input.extraArgs);
    return {
      origin: 'legacy-compatibility', source: 'Persona', consentRequired: false,
      targetId: personaLegacy.targetId, equivalence: 'exact', contribution: personaLegacy.contribution,
      nativePolicy: personaLegacy.nativePolicy
    };
  }
  const projectLegacy = provider.adapter.legacyRouting?.resolveExecution?.(legacyContext(input), 'project');
  if (!perTabState && !personaState && !personaLegacy && projectLegacy) {
    assertNoRawExecutionCollision(provider, input.extraArgs);
    return {
      origin: 'legacy-compatibility', source: 'Project', consentRequired: false,
      targetId: projectLegacy.targetId, equivalence: 'exact', contribution: projectLegacy.contribution,
      nativePolicy: projectLegacy.nativePolicy
    };
  }
  const state = perTabState ?? personaState ?? projectState ?? globalState ?? input.config.defaultExecutionState;
  const source: ExecutionResolution['source'] = perTabState
    ? 'Agent'
    : personaState
      ? 'Persona'
      : projectState
        ? 'Project'
      : globalState || input.config.defaultExecutionState
        ? 'Global'
        : 'native-default';
  if (!state) return { state, origin: 'inherited-native-default', source, consentRequired: false, contribution: {} };
  if (!provider.adapter.descriptor.targets?.executionStateMapping?.[state] || !provider.executionContribution) {
    throw new Error(`${provider.adapter.descriptor.label} does not support ${state} execution state.`);
  }
  if (hasNativeOption(input.extraArgs, provider.adapter.collision.execution, provider.adapter.collision.terminatesAtDoubleDash)) {
    throw new Error('Structured execution state conflicts with raw execution arguments.');
  }
  const target = executionTargetFor(provider, state);
  if (!target) throw new Error(`Unknown execution target for ${provider.adapter.descriptor.label}.`);
  return {
    state, origin: 'portable-mapped', source, targetId: target.id,
    equivalence: target.equivalence, consentRequired: target.consent === 'required',
    contribution: provider.executionContribution(target.id)
  };
}

function legacyContext(input: TargetResolutionInput) {
  return {
    config: input.config,
    persona: input.persona,
    projectSettings: input.projectSettings,
    perTabRouting: input.perTabRouting,
    scope: input.scope ?? 'local'
  } as const;
}

function assertNoRawExecutionCollision(provider: LaunchProvider, extraArgs: readonly string[]): void {
  if (hasNativeOption(extraArgs, provider.adapter.collision.execution, provider.adapter.collision.terminatesAtDoubleDash)) {
    throw new Error('Compatibility execution policy conflicts with raw execution arguments.');
  }
}
