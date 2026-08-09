/**
 * The launch-provider registry — the ONE place a concrete profile literal is
 * mapped to its provider (the Rule 6 "registration seam" for the launch layer,
 * mirroring `MAIN_MODULES`). `PtyManager` resolves a provider via
 * {@link providerFor} and never names a profile in its launch logic.
 *
 * The map is a module-level constant, built ONCE at module load, not inside any
 * per-window / per-launch path (Rule 3): the providers are stateless, so a
 * single frozen instance each is shared across every launch.
 *
 * Adding a provider (Cursor, Codex, PI …) is a two-line change here plus the
 * new profile ids in `VALID_PROFILES` — no edit to `PtyManager`.
 */

import type { LaunchProfileId } from '../../shared/types.js';
import type { HarnessAdapterDescriptor, HarnessAdapterId, HarnessAvailability } from '../../shared/harness-adapter.js';
import { availabilityFromVerify } from '../../shared/harness-adapter.js';
import type { HarnessVerifyResult } from '../../shared/types.js';
import type { LaunchProvider } from './launch-provider.js';
import { ClaudeCodeProvider } from './claude-code-provider.js';
import { CursorProvider } from './cursor-provider.js';
import { CodexProvider } from './codex-provider.js';
import { PiProvider } from './pi-provider.js';
import { OpenCodeProvider } from './opencode-provider.js';
import { ShellProvider } from './shell-provider.js';
import { LeastCapableProvider } from './least-capable-provider.js';
import { executionTargetsFor } from './evidence-registry.js';
import { discoverCodexModels } from './codex-model-catalog.js';

const claudeCode = new ClaudeCodeProvider();
const cursor = new CursorProvider();
const codex = new CodexProvider();
const pi = new PiProvider();
const opencode = new OpenCodeProvider();
const shell = new ShellProvider();
/** The forward-compat floor for an unregistered id (T2.1) — see {@link providerFor}. */
const leastCapable = new LeastCapableProvider();

/** Profile → provider. The only site that pairs a concrete profile id with a
 *  provider instance (Rule 6). */
const LAUNCH_PROVIDERS: Readonly<Record<LaunchProfileId, LaunchProvider>> = Object.freeze({
  claude: claudeCode,
  'claude-resume': claudeCode,
  'claude-yolo': claudeCode,
  cursor,
  'cursor-resume': cursor,
  'cursor-yolo': cursor,
  codex,
  'codex-resume': codex,
  'codex-yolo': codex,
  pi,
  'pi-resume': pi,
  opencode,
  'opencode-resume': opencode,
  shell
});

/**
 * Resolve the provider for a profile. Every profile in `VALID_PROFILES` has an
 * entry; an id with no registered provider — impossible through the typed union
 * today, but reachable when a persisted/config string drifts ahead of the app —
 * falls back to the {@link LeastCapableProvider} (T2.1). That stub answers all-off
 * {@link LEAST_CAPABLE} capabilities (so NO feature service — resume, auto-close,
 * scheduler hooks, heap ceiling, MCP/hook injection — activates on a harness we
 * can't describe) while still degrading the literal SPAWN to a plain shell rather
 * than throwing. This replaces the old `?? shell` alias, whose flaw was that
 * feature QUERIES on an unknown id saw shell's identity as if it were a real,
 * runnable answer; now only the spawn borrows shell's command, never the
 * capability set.
 */
export function providerFor(profile: LaunchProfileId): LaunchProvider {
  return LAUNCH_PROVIDERS[profile] ?? leastCapable;
}

/** Every trusted adapter once, in profile registry order. No renderer/config registration path exists. */
export function registeredAdapters(): readonly LaunchProvider[] {
  return [claudeCode, cursor, codex, pi, opencode, shell];
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

/** Refresh Codex's account-visible model catalog before projecting descriptors. */
export async function refreshDynamicHarnessCatalogs(results: readonly HarnessVerifyResult[]): Promise<void> {
  const codexResult = results.find((result) => result.family === 'codex');
  if (!codexResult?.enabled || !codexResult.installed) return;
  codex.setDiscoveredModels(await discoverCodexModels(codexResult.binary, `${codexResult.binary}:${codexResult.normalizedVersion ?? ''}`));
}
