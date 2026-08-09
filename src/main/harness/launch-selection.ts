import type {
  AppConfig,
  HarnessFamily,
  LaunchProfileId,
  LaunchProfileSource,
  Persona,
  Project,
  ProjectLaunchDefault
} from '../../shared/types.js';
import { harnessFamilyOf, parseProfile } from '../../shared/launch-provider.js';
import { registeredAdapters } from './registry.js';

export type LaunchSelectionSource =
  | 'explicit'
  | 'persona-pin'
  | 'project-canonical'
  | 'project-legacy'
  | 'global-default'
  | 'adapter-compatibility';

export type LaunchSelection =
  | {
      ok: true;
      requestedProfile: LaunchProfileId;
      requestedSource: LaunchProfileSource;
      profile: LaunchProfileId;
      personaId?: string;
      source: LaunchSelectionSource;
    }
  | {
      ok: false;
      code: 'PROFILE_CONFLICT' | 'UNAVAILABLE_DEFAULT';
      message: string;
    };

const enabledByConfig: Readonly<Record<HarnessFamily, keyof AppConfig | null>> = {
  claude: null,
  cursor: 'harnessCursorEnabled',
  codex: 'harnessCodexEnabled',
  pi: 'harnessPiEnabled',
  opencode: 'harnessOpenCodeEnabled'
};

function isEnabled(config: AppConfig, adapterId: HarnessFamily): boolean {
  const key = enabledByConfig[adapterId];
  return key === null || config[key] === true;
}

function defaultProfile(adapterId: HarnessFamily): LaunchProfileId | undefined {
  return registeredAdapters().find((provider) => provider.adapter.descriptor.id === adapterId)
    ?.adapter.descriptor.defaultProfileId;
}

function compatibilityFallbackProfile(): LaunchProfileId | undefined {
  return registeredAdapters().find(({ adapter }) => adapter.descriptor.compatibilityFallbackProfileId)
    ?.adapter.descriptor.compatibilityFallbackProfileId;
}

function validProfile(adapterId: HarnessFamily, profileId: string): profileId is LaunchProfileId {
  return parseProfile(profileId) !== null && harnessFamilyOf(profileId as LaunchProfileId) === adapterId;
}

function isLifecycleVariantOf(pinned: LaunchProfileId, requested: LaunchProfileId): boolean {
  return requested === `${pinned}-resume`;
}

function configuredDefault(
  config: AppConfig,
  adapterId: HarnessFamily,
  source: LaunchSelectionSource,
  personaId?: string
): LaunchSelection {
  const profile = defaultProfile(adapterId);
  if (!profile || !isEnabled(config, adapterId)) {
    return {
      ok: false,
      code: 'UNAVAILABLE_DEFAULT',
      message: `${adapterId} is configured as the default but is disabled or unavailable`
    };
  }
  return {
    ok: true,
    requestedProfile: profile,
    requestedSource: 'seeded-default',
    profile,
    personaId,
    source
  };
}

function canonicalDefault(
  value: ProjectLaunchDefault | undefined,
  config: AppConfig
): LaunchSelection | undefined {
  if (!value) return undefined;
  if (value.kind === 'use-global') return undefined;
  if (!validProfile(value.adapterId, value.profileId) || !isEnabled(config, value.adapterId)) {
    return {
      ok: false,
      code: 'UNAVAILABLE_DEFAULT',
      message: 'Project default profile is stale, disabled, or unavailable'
    };
  }
  return {
    ok: true,
    requestedProfile: value.profileId,
    requestedSource: 'seeded-default',
    profile: value.profileId,
    personaId: value.personaId,
    source: 'project-canonical'
  };
}

/** Resolve only canonical/global project defaults; used by defaulted UI launch paths before persona precedence. */
export function resolveProjectDefaultSelection(input: {
  config: AppConfig;
  project: Project;
}): LaunchSelection | undefined {
  const canonical = canonicalDefault(input.project.launchDefault, input.config);
  if (canonical) return canonical;
  if (input.project.launchDefault?.kind === 'use-global' && input.config.defaultHarness) {
    return configuredDefault(input.config, input.config.defaultHarness, 'global-default');
  }
  return undefined;
}

/**
 * Main-owned default selection. Existing callers remain explicit unless they mark
 * their request as seeded, so old schedule/resume/restore identity never changes.
 */
export function resolveLaunchSelection(input: {
  config: AppConfig;
  project: Project;
  personas: readonly Persona[];
  requestedProfile: LaunchProfileId;
  requestedSource?: LaunchProfileSource;
  requestedPersonaId?: string;
  persona?: Persona;
}): LaunchSelection {
  const requestedSource = input.requestedSource ?? 'explicit';
  const requestedPersona = input.persona ?? (input.requestedPersonaId
    ? input.personas.find((persona) => persona.id === input.requestedPersonaId)
    : undefined);
  const pinned = requestedPersona?.baseProfile;

  if (pinned && requestedSource === 'explicit'
    && pinned !== input.requestedProfile
    && !isLifecycleVariantOf(pinned, input.requestedProfile)) {
    return {
      ok: false,
      code: 'PROFILE_CONFLICT',
      message: `Persona ${requestedPersona!.name} is pinned to ${pinned}; explicit ${input.requestedProfile} conflicts`
    };
  }
  if (pinned) {
    return {
      ok: true,
      requestedProfile: input.requestedProfile,
      requestedSource,
      profile: isLifecycleVariantOf(pinned, input.requestedProfile) ? input.requestedProfile : pinned,
      personaId: requestedPersona!.id,
      source: 'persona-pin'
    };
  }
  if (requestedSource === 'explicit') {
    return {
      ok: true,
      requestedProfile: input.requestedProfile,
      requestedSource,
      profile: input.requestedProfile,
      personaId: requestedPersona?.id,
      source: 'explicit'
    };
  }

  const canonical = canonicalDefault(input.project.launchDefault, input.config);
  if (canonical) return canonical;

  // An explicit canonical use-global record retires legacy arrays for routing.
  // Only an absent canonical record may project legacy defaults.
  const legacyPersona = input.project.launchDefault ? undefined : input.project.defaultPersonas
    ?.map((id) => input.personas.find((persona) => persona.id === id))
    .find((persona): persona is Persona => !!persona);
  if (legacyPersona) {
    const profile = legacyPersona.baseProfile ?? compatibilityFallbackProfile();
    if (!profile) {
      return {
        ok: false,
        code: 'UNAVAILABLE_DEFAULT',
        message: 'No compatibility fallback harness is registered'
      };
    }
    return {
      ok: true,
      requestedProfile: input.requestedProfile,
      requestedSource,
      profile,
      personaId: legacyPersona.id,
      source: 'project-legacy'
    };
  }
  const legacyProfile = input.project.launchDefault ? undefined : input.project.defaultAgents
    ?.map((profile) => parseProfile(profile))
    .find((profile): profile is LaunchProfileId => profile !== null);
  if (legacyProfile) {
    return {
      ok: true,
      requestedProfile: input.requestedProfile,
      requestedSource,
      profile: legacyProfile,
      source: 'project-legacy'
    };
  }
  if (input.config.defaultHarness) {
    return configuredDefault(input.config, input.config.defaultHarness, 'global-default');
  }
  const fallbackProfile = compatibilityFallbackProfile();
  if (!fallbackProfile) {
    return {
      ok: false,
      code: 'UNAVAILABLE_DEFAULT',
      message: 'No compatibility fallback harness is registered'
    };
  }
  return {
    ok: true,
    requestedProfile: input.requestedProfile,
    requestedSource,
    profile: fallbackProfile,
    source: 'adapter-compatibility'
  };
}
