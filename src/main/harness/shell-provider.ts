/**
 * ShellProvider — the degenerate launch provider for a plain interactive shell.
 *
 * A shell has no MCP host, no transcript, no permission system, and no CLI flag
 * stack, so it inherits every no-op default from {@link BaseLaunchProvider} and
 * overrides only the three things that are shell-specific: the base launch (the
 * configured shell, empty argv), the remote command, and the title. It exists
 * so `PtyManager` can dispatch EVERY profile through the same seam rather than
 * special-casing `'shell'` in launch logic (Rule 6).
 *
 * The remote branch reproduces the old `buildRemoteCmd` shell path verbatim:
 * `exec "${SHELL:-/bin/sh}" -l` with the braces kept literal (built outside a
 * template literal so a future edit can't accidentally interpolate `${SHELL}`
 * locally). It deliberately does NOT run `cleanExtraArgs` (unlike the agent
 * providers' `simpleRemoteExec`) — extraArgs pass through raw, preserved verbatim
 * — so it builds its own command rather than calling the base helper.
 */

import type { AppConfig, LaunchProfileId } from '../../shared/types.js';
import type { RemoteCommandInput, RemoteCommandResult, ResolvedLaunch } from './launch-provider.js';
import { BaseLaunchProvider } from './base-provider.js';
import { remoteCdPrefix, shellQuoteArgv } from './shell-quote.js';
import type { ModelLevel } from "../../shared/harness-adapter.js";
import { facetSupport, type TrustedHarnessAdapter } from './adapter-contract.js';

const SHELL_ADAPTER: TrustedHarnessAdapter = {
  descriptor: {
    id: 'shell', label: 'Shell', agentDefaultEligible: false, terminalEligible: true,
    profiles: [{ id: 'shell', posture: 'other' }], capabilities: facetSupport({}), settingsContributionIds: [],
    configFiles: [{ id: 'native-settings', label: 'Native settings', scopes: [], effect: 'unsupported', rawEdit: false, reason: 'Shell has no native settings file.' }],
    targets: {
      roles: [],
      models: [],
      modelLevelMapping: { low: undefined, medium: undefined, high: undefined, "extra-high": undefined }
    },
    initialTaskDelivery: { local: 'unsupported', remote: 'unsupported', readinessSignal: 'none', acceptanceSignal: 'delivery-attempted' }
  },
  collision: { terminatesAtDoubleDash: true }, evidence: []
};

export class ShellProvider extends BaseLaunchProvider {
  readonly id = 'shell';
  readonly adapter = SHELL_ADAPTER;

  modelContribution(targetId: string, level?: ModelLevel) {
    return {};
  }

  roleContribution(roleId: string) {
    return {};
  }

  resolveLaunch(_profile: LaunchProfileId, config: AppConfig): ResolvedLaunch {
    return { command: config.shell, args: [] };
  }

  buildRemoteCommand(input: RemoteCommandInput): RemoteCommandResult {
    const startPath = input.remote.remotePath || input.config.remoteDefaultPath;
    const cdPrefix = remoteCdPrefix(startPath);
    // The remote shell expands ${SHELL:-/bin/sh}; the braces stay literal here
    // (built outside a template literal so a future edit can't interpolate it).
    // NOTE: the old buildRemoteCmd shell path did NOT run cleanExtraArgs here
    // (unlike its claude branch) — extraArgs pass through raw. Preserved verbatim.
    const shellExec = 'exec "${SHELL:-/bin/sh}" -l';
    const tail = shellQuoteArgv(input.extraArgs ?? []);
    // A shell has no resumable claude session id.
    return { cmd: `${cdPrefix}${shellExec}${tail ? ' ' + tail : ''}` };
  }

  title(_profile: LaunchProfileId): string {
    return 'shell';
  }
}
