/**
 * Static registration contracts for first-party harness implementations.
 *
 * Registrations are deliberately compile-time objects. They describe a harness
 * without granting dynamically-loaded code access to the host process.
 */

export type HarnessScope = 'local' | 'remote';
export type HarnessProfilePosture = 'default' | 'resume' | 'unrestricted' | 'other';

export interface HarnessProfileDefinition<TProfile extends string = string> {
  readonly id: TProfile;
  readonly posture: HarnessProfilePosture;
}

export interface HarnessRegistration<TProfile extends string = string, TImplementation = unknown> {
  readonly id: string;
  readonly label: string;
  readonly profiles: readonly HarnessProfileDefinition<TProfile>[];
  readonly defaultProfileId?: TProfile;
  readonly implementation: TImplementation;
  readonly supportedScopes: readonly HarnessScope[];
}

export interface HarnessRegistrationIssue {
  readonly message: string;
}

/** Validate static registry invariants before a host accepts registrations. */
export function validateHarnessRegistrations(
  registrations: readonly HarnessRegistration[]
): readonly HarnessRegistrationIssue[] {
  const issues: HarnessRegistrationIssue[] = [];
  const harnessIds = new Set<string>();
  const profileOwners = new Map<string, string>();

  for (const registration of registrations) {
    if (!registration.id.trim()) {
      issues.push({ message: 'Harness registration id must not be empty.' });
      continue;
    }
    if (harnessIds.has(registration.id)) {
      issues.push({ message: `Duplicate harness registration id: ${registration.id}.` });
    }
    harnessIds.add(registration.id);

    if (!registration.label.trim()) {
      issues.push({ message: `${registration.id} label must not be empty.` });
    }
    if (registration.supportedScopes.length === 0) {
      issues.push({ message: `${registration.id} must support at least one scope.` });
    }
    if (new Set(registration.supportedScopes).size !== registration.supportedScopes.length) {
      issues.push({ message: `${registration.id} declares duplicate supported scopes.` });
    }

    if (registration.profiles.length === 0) {
      issues.push({ message: `${registration.id} must register at least one profile.` });
    }
    if (registration.defaultProfileId && !registration.profiles.some((profile) => profile.id === registration.defaultProfileId)) {
      issues.push({ message: `${registration.id} default profile is not registered: ${registration.defaultProfileId}.` });
    }

    for (const profile of registration.profiles) {
      if (!profile.id.trim()) {
        issues.push({ message: `${registration.id} profile id must not be empty.` });
      }
      const owner = profileOwners.get(profile.id);
      if (owner) {
        issues.push({ message: `Profile ${profile.id} is registered by both ${owner} and ${registration.id}.` });
      } else {
        profileOwners.set(profile.id, registration.id);
      }
    }
  }

  return issues;
}
