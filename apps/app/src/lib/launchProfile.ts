// Resolving a project's one-click default launch from `defaultPersonas` /
// `defaultAgents`. Extracted so ListPane, Workspace, TabBar, and the command
// palette share one source of truth instead of each keeping a near-identical
// local copy.
import type { LaunchProfileId, Persona, Project } from '@zana-ai/zcc-domain/product';
import { VALID_PROFILES, parseProfile, isClaudeProfile } from '@zana-ai/zcc-domain/launch-provider';

/** The launch profiles the UI knows how to spawn directly. A `defaultAgents`
 *  entry that isn't one of these is a persona/agent id, not a profile. */
export const KNOWN_PROFILES: LaunchProfileId[] = [...VALID_PROFILES];

/** Narrow an arbitrary string to a LaunchProfileId, or undefined if unknown. */
export function knownProfile(value: string | undefined): LaunchProfileId | undefined {
  return value ? parseProfile(value) ?? undefined : undefined;
}

// Re-export isClaudeProfile for backward compatibility with existing imports.
export { isClaudeProfile };

/** First entry in `defaultAgents` wins for one-click "+" semantics, but only if
 *  it's a known profile id; otherwise fall back to plain 'claude'. */
export function projectDefaultProfile(project: Project): LaunchProfileId {
  return knownProfile(project.defaultAgents?.[0]) ?? 'claude';
}

/** What a one-click "+" spawns for a project: either a persona (its flags layer
 *  onto the persona's baseProfile) or a bare profile. `personaId` is set only
 *  when the project pins a default persona that still resolves in the merged
 *  catalogue — a stale id (persona file deleted) silently falls through to the
 *  profile default, so the "+" never dead-ends. */
export interface ProjectDefaultLaunch {
  profile: LaunchProfileId;
  personaId?: string;
}

/**
 * Resolve a project's one-click "+" launch. A pinned `defaultPersonas[0]` that
 * resolves to a real persona wins — we spawn that persona on its own
 * `baseProfile` (default 'claude'). Otherwise fall back to the profile default
 * (`defaultAgents[0]` or 'claude'). Pure; shared by every "+" entry point so a
 * plain click, ⌘T, and the palette all agree.
 */
export function projectDefaultLaunch(
  project: Project,
  personas: Persona[]
): ProjectDefaultLaunch {
  const pinnedId = project.defaultPersonas?.[0];
  if (pinnedId) {
    const persona = personas.find((p) => p.id === pinnedId);
    if (persona) {
      return { profile: persona.baseProfile ?? 'claude', personaId: persona.id };
    }
  }
  return { profile: projectDefaultProfile(project) };
}
