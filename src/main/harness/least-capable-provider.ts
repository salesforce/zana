/**
 * LeastCapableProvider — the forward-compat degrade floor for the launch
 * registry (T2.1). {@link providerFor} returns this stub when it's handed a
 * profile id with NO registered provider — a string persisted by a newer app
 * version, or a harness not yet wired up.
 *
 * Its posture is deliberately split (mirroring the two things a provider answers):
 *  - CAPABILITIES are the all-off {@link LEAST_CAPABLE} floor, so every feature
 *    gate (resume-picker, auto-close-idle, scheduler stop-hook, heap ceiling,
 *    MCP/hook injection) sees false and NOTHING activates against a harness we
 *    can't describe. A missing entry is a visible OVER-degrade, never a feature
 *    firing blind. (BaseLaunchProvider.capabilities already resolves an unknown
 *    id to LEAST_CAPABLE via the shared accessor; we override to make the floor
 *    explicit and independent of that id ever being unknown.)
 *  - The SPAWN still degrades to a runnable plain shell (`config.shell`, empty
 *    argv) — the same honest floor the old `?? shell` alias gave — so opening a
 *    tab for an unrecognised profile drops the user into a shell instead of
 *    throwing. The difference from the old alias is that FEATURE queries no
 *    longer see shell's identity; only the literal spawn does.
 *
 * Rule 6: this names no concrete profile/harness literal — it's the generic
 * floor, registered from `registry.ts` as the fallback, not keyed to any id.
 */

import type { AppConfig, LaunchProfileId } from '../../shared/types.js';
import { LEAST_CAPABLE, type ProviderCapabilities } from '../../shared/launch-provider.js';
import type { RemoteCommandInput, RemoteCommandResult, ResolvedLaunch } from './launch-provider.js';
import { BaseLaunchProvider } from './base-provider.js';
import { remoteCdPrefix, shellQuoteArgv } from './shell-quote.js';
import { facetSupport, type TrustedHarnessAdapter } from './adapter-contract.js';

const LEAST_CAPABLE_ADAPTER: TrustedHarnessAdapter = {
  descriptor: {
    id: 'shell', label: 'Unavailable harness', agentDefaultEligible: false, terminalEligible: false,
    profiles: [], capabilities: facetSupport({}), settingsContributionIds: [],
    configFiles: [],
    initialTaskDelivery: { local: 'unsupported', remote: 'unsupported', readinessSignal: 'none', acceptanceSignal: 'delivery-attempted' }
  },
  collision: { terminatesAtDoubleDash: true }, evidence: []
};

export class LeastCapableProvider extends BaseLaunchProvider {
  readonly id = 'unknown';
  readonly adapter = LEAST_CAPABLE_ADAPTER;

  /** All-off capabilities — no feature service ever activates on an unknown id. */
  capabilities(_profile: LaunchProfileId): ProviderCapabilities {
    return { ...LEAST_CAPABLE };
  }

  /** The spawn degrades to a plain shell (runnable floor), never a throw. */
  resolveLaunch(_profile: LaunchProfileId, config: AppConfig): ResolvedLaunch {
    return { command: config.shell, args: [] };
  }

  /** Remote degrade: a plain login shell, mirroring ShellProvider's remote path. */
  buildRemoteCommand(input: RemoteCommandInput): RemoteCommandResult {
    const startPath = input.remote.remotePath || input.config.remoteDefaultPath;
    const cdPrefix = remoteCdPrefix(startPath);
    const shellExec = 'exec "${SHELL:-/bin/sh}" -l';
    const tail = shellQuoteArgv(input.extraArgs ?? []);
    return { cmd: `${cdPrefix}${shellExec}${tail ? ' ' + tail : ''}` };
  }

  title(_profile: LaunchProfileId): string {
    return 'unknown';
  }
}
