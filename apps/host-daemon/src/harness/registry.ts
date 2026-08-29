/**
 * The trusted static registration seam for first-party harnesses.
 *
 * A harness is implemented in its own folder and added once below. The main
 * process retains ownership of loading, validation, and every sensitive host
 * service; registrations are not dynamically discovered or renderer-supplied.
 */

import { validateHarnessRegistrations } from '@zcc/harness-sdk';
import type { LaunchProfileId, HarnessVerifyResult } from '@zana-ai/zcc-domain/product';
import type { HarnessFamily } from '@zana-ai/zcc-domain/product';
import type { HarnessAdapterDescriptor, HarnessAdapterId, HarnessAvailability } from '@zana-ai/zcc-domain/harness-adapter';
import { availabilityFromVerify } from '@zana-ai/zcc-domain/harness-adapter';
import { executionTargetsFor } from './evidence-registry.js';
import { validateConfigFiles } from './adapter-contract.js';
import { LeastCapableProvider } from './least-capable-provider.js';
import type { RemoteCommandInput, RemoteCommandResult } from './launch-provider.js';
import type { LaunchProvider } from './launch-provider.js';
import type { HarnessRegistration } from './registration.js';
import { claudeHarness } from './claude/registration.js';
import { cursorHarness } from './cursor/registration.js';
import { codexHarness } from './codex/registration.js';
import { piHarness } from './pi/registration.js';
import { openCodeHarness } from './opencode/registration.js';
import { shellHarness } from './shell/registration.js';

export const HARNESS_REGISTRATIONS: readonly HarnessRegistration[] = Object.freeze([
  claudeHarness,
  cursorHarness,
  codexHarness,
  piHarness,
  openCodeHarness,
  shellHarness
]);

const registrationIssues = validateHarnessRegistrations(HARNESS_REGISTRATIONS);
if (registrationIssues.length > 0) {
  throw new Error(`Invalid harness registrations: ${registrationIssues.map((issue) => issue.message).join(' ')}`);
}

const providersByProfile = new Map<LaunchProfileId, LaunchProvider>(
  HARNESS_REGISTRATIONS.flatMap((registration) =>
    registration.profiles.map((profile) => [profile.id, registration.implementation] as const)
  )
);
const leastCapable = new LeastCapableProvider();
const unsupportedRemote = (input: RemoteCommandInput): RemoteCommandResult =>
  leastCapable.buildRemoteCommand(input);

/** Resolve the owning registration for a profile, if one is registered. */
export function registrationFor(profile: LaunchProfileId): HarnessRegistration | undefined {
  return HARNESS_REGISTRATIONS.find((registration) => registration.profiles.some((candidate) => candidate.id === profile));
}

/**
 * Render remote argv through the owning registration. Unknown persisted profiles
 * keep the same least-capable shell floor used by `providerFor`.
 */
export function renderRemoteCommand(profile: LaunchProfileId, input: RemoteCommandInput): RemoteCommandResult {
  return registrationFor(profile)?.renderRemoteCommand(input) ?? unsupportedRemote(input);
}

/** Resolve a provider by harness family for validation of multi-adapter intent. */
export function providerForFamily(family: HarnessFamily): LaunchProvider | undefined {
  return HARNESS_REGISTRATIONS.find((registration) => registration.id === family)?.implementation;
}

export function registeredHarnessFamilies(): readonly HarnessFamily[] {
  return HARNESS_REGISTRATIONS
    .filter((registration): registration is HarnessRegistration & { id: HarnessFamily } => registration.id !== 'shell')
    .map((registration) => registration.id);
}

/** Unknown persisted ids deliberately degrade to the non-featureful shell floor. */
export function providerFor(profile: LaunchProfileId): LaunchProvider {
  return providersByProfile.get(profile) ?? leastCapable;
}

/** One trusted implementation per registered harness, in display order. */
export function registeredAdapters(): readonly LaunchProvider[] {
  const providers = HARNESS_REGISTRATIONS.map((registration) => registration.implementation);
  providers.forEach((provider) => validateConfigFiles(provider.adapter.descriptor));
  return providers;
}

/** Build renderer-safe descriptors from trusted provider metadata plus verified availability. */
export function harnessAdapterDescriptors(
  availability: ReadonlyMap<HarnessAdapterId, HarnessAvailability>
): HarnessAdapterDescriptor[] {
  return registeredAdapters().map((provider) => ({
    ...provider.adapter.descriptor,
    targets: provider.adapter.descriptor.targets ? {
      ...provider.adapter.descriptor.targets,
      executionTargets: executionTargetsFor(provider)
    } : undefined,
    availability: availability.get(provider.adapter.descriptor.id) ?? {
      enabled: false,
      installed: false,
      reason: 'Verification required'
    }
  }));
}

/** Resolve verified availability into renderer-safe trusted adapter descriptors. */
export function harnessAdapterDescriptorsFromVerify(
  results: readonly HarnessVerifyResult[]
): HarnessAdapterDescriptor[] {
  return harnessAdapterDescriptors(
    new Map(registeredAdapters().map(({ adapter }) => [
      adapter.descriptor.id,
      availabilityFromVerify(
        adapter.descriptor.id,
        results.find((result) => result.family === adapter.descriptor.id)
      )
    ]))
  );
}

/** Refresh only the registrations that declare dynamic catalogs after a successful probe. */
export async function refreshDynamicHarnessCatalogs(
  results: readonly HarnessVerifyResult[]
): Promise<void> {
  await Promise.all(HARNESS_REGISTRATIONS.flatMap((registration) => {
    if (!registration.refreshCatalog || registration.id === 'shell') return [];
    const result = results.find((candidate) => candidate.family === registration.id);
    if (!result?.enabled || !result.installed) return [];
    return [registration.refreshCatalog({ binary: result.binary, normalizedVersion: result.normalizedVersion })];
  }));
}
