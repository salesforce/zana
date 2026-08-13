/**
 * BaseLaunchProvider — the abstract base every concrete provider extends.
 *
 * It supplies the DEFAULTS that were, before extraction, copy-pasted across all
 * four providers: capability delegation, the five no-op arg builders, "no auto
 * mode", "no pinned session", and a shared simple-agent remote-exec template.
 * A concrete provider then overrides ONLY what actually differs — so reading a
 * provider file shows its real behaviour, not a wall of `return []`.
 *
 * The contract is unchanged: these defaults are exactly what a provider whose
 * CLI carries no launcher-injected flags wants (shell, and the v1 cursor
 * posture). The Claude provider overrides most of them; the codex provider
 * overrides the three `-c`-channel builders. Substitutability holds — every
 * default is a valid `LaunchProvider` answer, not a "not applicable" stub that
 * would surprise `PtyManager`.
 *
 * Rule 6: the base names no concrete profile/provider literal — subclasses +
 * the registry own those.
 */

import type {
  AppConfig,
  LaunchProfileId,
  Persona,
  ProjectSettings
} from '../../shared/types.js';
import {
  harnessOptions,
  providerCapabilities,
  type HarnessOption,
  type ProviderCapabilities
} from '../../shared/launch-provider.js';
import type {
  AutoModeInput,
  HarnessAuthInjection,
  LaunchProvider,
  ProviderHookUrls,
  RemoteCommandInput,
  RemoteCommandResult,
  ResolvedLaunch
} from './launch-provider.js';
import type { HarnessAuthCredential, HarnessAuthKey } from '../harness-auth.js';
import type { TrustedHarnessAdapter } from './adapter-contract.js';
import { cleanExtraArgs } from './argv-utils.js';
import { remoteCdPrefix, shellQuoteArgv } from './shell-quote.js';
import { resolveExecutionState, resolveModelTarget, resolveRoleTarget } from "./target-resolution.js";
import { launchMetadataSnapshot, type LaunchMetadataAxis } from './session-metadata.js';


export abstract class BaseLaunchProvider implements LaunchProvider {
  /** Stable provider id — set by the concrete subclass (Rule 6). */
  abstract readonly id: string;
  abstract readonly adapter: TrustedHarnessAdapter;

  launchMetadata(input: {
    model: import('./target-resolution.js').ModelResolution;
    role: import('./target-resolution.js').RoleResolution;
    execution: import('./target-resolution.js').ExecutionResolution;
    observedAt: number;
  }): import('../../shared/types.js').SessionMetadataSnapshot {
    const targets = this.adapter.descriptor.targets;
    const axes: LaunchMetadataAxis[] = [];
    if (input.model.providerTargetId || targets?.providerModelRelationship === 'fixed-provider') axes.push('provider');
    if (!input.model.rawOverride && input.model.targetId) axes.push('model');
    if (input.role.targetId) axes.push('role');
    if (input.execution.targetId || input.execution.state) axes.push('execution');
    return launchMetadataSnapshot({ provider: this, ...input, axes });
  }

  /** The base command + argv — the one thing every provider must define. */
  abstract resolveLaunch(
    profile: LaunchProfileId,
    config: AppConfig,
    autoModeActive: boolean,
    resumeSessionId?: string
  ): ResolvedLaunch;

  /** Display title for a tab of this profile. */
  abstract title(profile: LaunchProfileId): string;

  /**
   * Capabilities come from the shared, renderer-safe accessor keyed by profile
   * — the single source of truth. Overriding this is almost never right; a
   * provider varies behaviour through the arg builders + capability FLAGS, not
   * by re-deciding the capability set here.
   */
  capabilities(profile: LaunchProfileId): ProviderCapabilities {
    return providerCapabilities(profile);
  }

  /**
   * Picker options default to the shared, renderer-safe producer keyed by
   * profile — the single source of truth, exactly like {@link capabilities}.
   * Overriding is almost never right; a provider varies its options through the
   * shared catalogs in `harnessOptions`, not by re-deciding them here.
   */
  options(profile: LaunchProfileId): HarnessOption[] {
    return harnessOptions(profile);
  }

  /**
   * The three `-c`-channel arg builders default to EMPTY: a provider only
   * emits these if its CLI carries MCP / guidance / hook config as command-line
   * ARGS (codex). Claude uses the launcher-owned file paths; cursor/shell have
   * no such surface. See the interface doc for the full rationale.
   */
  mcpArgs(_profile: LaunchProfileId, _mcpUrl: string): string[] {
    return [];
  }

  /**
   * No MCP-via-env injection by default: only a provider whose CLI reads MCP
   * config from an environment variable (OpenCode's `OPENCODE_CONFIG_CONTENT`)
   * overrides this. Claude/codex/cursor/pi/shell return `{}` — they use the
   * file-arg, `-c`-arg, or no MCP surface. See the interface doc for the rationale.
   */
  mcpEnv(_profile: LaunchProfileId, _mcpUrl: string): Record<string, string> {
    return {};
  }

  guidanceArgs(_profile: LaunchProfileId, _guidance: string): string[] {
    return [];
  }

  hookArgs(_profile: LaunchProfileId, _urls: ProviderHookUrls): string[] {
    return [];
  }

  /**
   * No per-harness auth override by default: shell has no auth, and a provider
   * that hasn't opted in leaves the child to inherit ambient env untouched.
   * Claude/Codex/Cursor override this with their CLI's auth dialect.
   */
  authInjection(_profile: LaunchProfileId, _cred: HarnessAuthCredential): HarnessAuthInjection {
    return {};
  }

  /**
   * No credential family by default — shell has no auth surface, so `PtyManager`
   * never fetches a stored credential for it. Claude/Codex/Cursor override this
   * with their family key.
   */
  authKey(_profile: LaunchProfileId): HarnessAuthKey | null {
    return null;
  }

  /** No persona / project-settings flags by default (claude overrides). */
  personaArgs(_persona: Persona, _profile: LaunchProfileId): string[] {
    return [];
  }

  projectSettingsArgs(_settings: ProjectSettings, _profile: LaunchProfileId): string[] {
    return [];
  }

  /** Auto mode is a Claude-Code concept; off by default. */
  computeAutoModeActive(_input: AutoModeInput): boolean {
    return false;
  }

  /** No profile pins a session by default (claude-resume / codex-resume override). */
  baseArgsPinSession(_profile: LaunchProfileId): boolean {
    return false;
  }

  /**
   * No screen-scan blocked pattern by default. Only a provider whose CLI goes
   * QUIET at an interactive prompt with no OSC/hook blocked signal (OpenCode's
   * `△ Permission required` TUI) overrides this — see the interface doc. Claude
   * (Notification hook) and every provider without that failure mode inherit
   * `false`, so the `ScreenScanBlockedDetector` never marks them blocked.
   */
  detectBlockedPrompt(_profile: LaunchProfileId, _recentText: string): boolean {
    return false;
  }

  /** Build the command handed to the remote sshd, plus the resumable session id. */
  abstract buildRemoteCommand(input: RemoteCommandInput): RemoteCommandResult;

  /**
   * The simple-agent remote template shared by cursor + codex: cd into the start
   * path, then `exec <bareBinary> <baseArgs> <injectedArgs> <cleaned extraArgs>`.
   * The bare binary NAME (not the configured local path) is passed by the caller
   * because the remote relies on the CLI being on the remote PATH. `resolveLaunch`
   * is called off the effective (persona-baseProfile-overridden) profile so a
   * persona can retarget within the family, mirroring the local path.
   *
   * `injectedArgs` (default none) are launcher-supplied flags spliced BETWEEN the
   * base argv and the trailing per-tab `extraArgs` (which, for an agent that takes
   * its prompt positionally, is the prompt). codex uses this to fold its
   * reverse-tunnel `-c hooks.*` bridges + trust-bypass flag in ahead of the prompt
   * — the remote twin of the local hook `-c` args (see `CodexProvider`).
   *
   * Providers with a richer remote stack (claude: persona/project/auto-mode/
   * allowedTools folding) build their own command instead of calling this.
   */
  protected simpleRemoteExec(
    input: RemoteCommandInput,
    remoteBinary: string,
    injectedArgs: string[] = []
  ): RemoteCommandResult {
    const startPath = input.remote.remotePath || input.config.remoteDefaultPath;
    const cdPrefix = remoteCdPrefix(startPath);
    const remoteExtra = cleanExtraArgs(input.extraArgs);
    const effectiveProfile = input.persona?.baseProfile ?? input.profile;
    const { args: baseArgs } = this.resolveLaunch(effectiveProfile, input.config, false);
    const modelTarget = resolveModelTarget(this, { config: input.config, persona: input.persona, projectSettings: input.projectSettings, perTabRouting: input.harnessRouting, profile: effectiveProfile, extraArgs: remoteExtra, scope: 'remote' });
    const roleTarget = resolveRoleTarget(this, { config: input.config, persona: input.persona, projectSettings: input.projectSettings, perTabRouting: input.harnessRouting, profile: effectiveProfile, extraArgs: remoteExtra, scope: 'remote' });
    const execution = resolveExecutionState(this, { config: input.config, persona: input.persona, projectSettings: input.projectSettings, perTabRouting: input.harnessRouting, profile: effectiveProfile, extraArgs: remoteExtra, scope: 'remote' });

    const argv = [remoteBinary, ...baseArgs, ...injectedArgs, ...(modelTarget.contribution.args || []), ...(roleTarget.contribution.args || []), ...(execution.contribution.args || []), ...remoteExtra];
    // cursor/codex don't take a launcher-injected `--session-id` in v1
    // (acceptsSessionId is false), so there's no resumable id to surface here.
    return { cmd: `${cdPrefix}exec ${shellQuoteArgv(argv)}` };
  }
}
