import type { HarnessModelRoutingV1, LaunchProfileId, Persona } from '@zana-ai/zcc-domain/product';
import { harnessFamilyOf, isClaudeProfile } from '@zana-ai/zcc-domain/launch-provider';
import { providerFor } from './registry.js';

/** YOLO / skip-permissions sibling declared by the adapter, if any. */
export function unrestrictedSiblingOf(profile: LaunchProfileId): LaunchProfileId | undefined {
  const id = providerFor(profile).adapter.descriptor.profiles.find((candidate) => candidate.posture === 'unrestricted')?.id;
  return id as LaunchProfileId | undefined;
}

export function profilePostureOf(profile: LaunchProfileId) {
  return providerFor(profile).adapter.descriptor.profiles.find((candidate) => candidate.id === profile)?.posture;
}

/**
 * Overlay portable `executionState: 'autonomous'` so an unattended launch
 * cannot inherit interactive / accept-edits / plan from global/project/persona
 * settings (those prompt, or — for accept-edits — refuse unattended preflight).
 * No-op when the adapter has no autonomous mapping (yolo is a profile instead).
 */
export function unattendedExecutionRouting(
  profile: LaunchProfileId,
  existing?: HarnessModelRoutingV1
): HarnessModelRoutingV1 | undefined {
  const family = harnessFamilyOf(profile);
  if (!family) return existing;
  const mapping = providerFor(profile).adapter.descriptor.targets?.executionStateMapping;
  if (!mapping?.autonomous) return existing;
  return {
    schemaVersion: 1,
    byAdapter: {
      ...existing?.byAdapter,
      [family]: { ...existing?.byAdapter?.[family], executionState: 'autonomous' }
    }
  };
}

/** Drop execution intent that would conflict with an unrestricted (yolo) profile. */
export function withoutExecutionIntent(
  routing: HarnessModelRoutingV1 | undefined,
  profile: LaunchProfileId
): HarnessModelRoutingV1 | undefined {
  const family = harnessFamilyOf(profile);
  if (!routing || !family || !routing.byAdapter[family]) return routing;
  const current = routing.byAdapter[family];
  if (!current || (current.executionState === undefined && current.executionTargetId === undefined)) {
    return routing;
  }
  const { executionState: _state, executionTargetId: _target, ...rest } = current;
  return {
    schemaVersion: 1,
    byAdapter: { ...routing.byAdapter, [family]: rest }
  };
}

/**
 * Argv identity for an unattended spawn.
 *
 * Autonomous Claude-family runs (including resume) keep the existing Team
 * contract: switch onto the unrestricted sibling. Scheduled default-posture
 * runs do the same so a `claude` / `cursor` / `grok` schedule cannot inherit
 * prompting permission settings. Resume schedules keep their resume profile
 * and rely on {@link unattendedExecutionRouting}.
 */
export function effectiveUnattendedProfile(
  requested: LaunchProfileId,
  persona: Persona | undefined,
  flags: { autonomous?: boolean; scheduled?: boolean }
): LaunchProfileId {
  const identity = persona?.baseProfile ?? requested;
  const yolo = unrestrictedSiblingOf(identity);
  if (!yolo) return identity;
  if (flags.autonomous && isClaudeProfile(identity)) return yolo;
  if (flags.scheduled && profilePostureOf(identity) === 'default') return yolo;
  return identity;
}

/**
 * Preflight-facing scheduled launch: force unattended execution routing (or
 * the yolo profile when the adapter has no autonomous mapping) so inherited
 * accept-edits cannot deny the fire, and the spawn never prompts.
 */
export function applyUnattendedScheduledLaunch<T extends {
  profile: LaunchProfileId;
  scheduled?: boolean;
  persona?: Persona;
  harnessRouting?: HarnessModelRoutingV1;
}>(opts: T): T {
  if (!opts.scheduled) return opts;
  const identity = opts.persona?.baseProfile ?? opts.profile;
  const effective = effectiveUnattendedProfile(opts.profile, opts.persona, { scheduled: true });
  const persona = opts.persona
    ? { ...opts.persona, baseProfile: effective }
    : opts.persona;
  if (profilePostureOf(effective) === 'unrestricted') {
    return {
      ...opts,
      profile: effective,
      persona,
      harnessRouting: withoutExecutionIntent(opts.harnessRouting, effective)
    };
  }
  return {
    ...opts,
    persona,
    harnessRouting: unattendedExecutionRouting(identity, opts.harnessRouting) ?? opts.harnessRouting
  };
}
