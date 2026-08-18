/**
 * PiProvider — launching the PI coding-agent CLI (`pi`, from the npm package
 * `@earendil-works/pi-coding-agent`), for the profiles it serves: `pi` and
 * `pi-resume`.
 *
 * PI is very Claude-Code / Codex / cursor-agent-shaped at the command line: an
 * interactive TUI by default, a positional prompt taken as the first user turn
 * (`pi "do the thing"`), and `--continue` / `--resume` / `--session <id>` to
 * reopen a prior session. But the launcher-injected Claude flags — `--mcp-config`,
 * `--settings` (lifecycle hooks), `--session-id`, `--permission-mode` — are NOT
 * part of PI's interface: PI is deliberately MCP-less (it exposes tools through
 * extensions/skills, not an MCP `--mcp-config` flag), wires lifecycle behavior
 * through extensions rather than a `--settings` JSON, and gates its own tools.
 * So this provider is a "base command + resume" provider in v1: it resolves the
 * right binary and the resume flag, and inherits the no-op arg builders + "no
 * auto mode" defaults from {@link BaseLaunchProvider} (those Claude-only flags
 * would break the spawn). Its `ProviderCapabilities` (see `providerCapabilities`)
 * gate every launcher injection OFF, matching this — the SAME posture the cursor
 * provider ships with.
 *
 * MULTI-PROVIDER DEFAULTS (`--provider` / `--model` / `--thinking`): PI is a
 * multi-provider agent — its identity is a `(provider, model)` pair, not a single
 * vendor. The launcher exposes three GLOBAL defaults on `AppConfig`
 * (`piProvider` / `piModel` / `piThinking`, set in Settings → Harness) that
 * {@link PiProvider.resolveLaunch} folds into the base argv for every PI tab.
 * Each is emitted only when set, so an unconfigured launch stays byte-clean and
 * PI falls back to its own `~/.pi` defaults. These are read from config in
 * `resolveLaunch` (not `personaArgs`/`projectSettingsArgs`) because they are a
 * launcher-wide default, and because PI's model axis is not yet wired into the
 * per-persona / per-project `harnessOptions` picker (that remains a follow-up —
 * see the empty PI branch note in `harnessOptions`).
 *
 * v1 follow-ups (mirroring cursor): surfacing PI's model axis in the per-persona
 * / per-project picker (`harnessOptions`), and `--append-system-prompt` for
 * persona guidance via `personaArgs`. Auth stays PI-owned (its `/login` OAuth in
 * `~/.pi` or provider env keys), so `authKey`/`authInjection` remain the base
 * no-ops.
 *
 * Rule 6: the concrete profile literals (`'pi'`, `'pi-resume'`) and the provider
 * id (`'pi'`) appear ONLY here + the registry — `PtyManager` dispatches through
 * the interface.
 */

import type { AppConfig, LaunchProfileId, ProjectSettings } from '../../../shared/types.js';
import type {
  RemoteCommandInput,
  RemoteCommandResult,
  ResolvedLaunch
} from '../launch-provider.js';
import { BaseLaunchProvider } from '../base-provider.js';
import type { ModelLevel } from '../../../shared/harness-adapter.js';
import { facetSupport, type TrustedHarnessAdapter } from '../adapter-contract.js';

const PI_EVIDENCE_VERSION = '0.52.12';
const PI_OPENING_PROMPT_EVIDENCE = {
  id: 'pi.facet.opening-prompt', versionRange: PI_EVIDENCE_VERSION, scope: 'local' as const,
  probe: 'pi --version plus provider contract suite', observed: 'CLI binds opening prompt at spawn.', reviewedAt: '2026-08-04'
};

const PI_ADAPTER: TrustedHarnessAdapter = {
  descriptor: {
    id: 'pi', label: 'PI', agentDefaultEligible: true, terminalEligible: false, defaultProfileId: 'pi',
    profiles: [{ id: 'pi', posture: 'default' }, { id: 'pi-resume', posture: 'resume' }],
    capabilities: facetSupport({ 'opening-prompt': 'exact' }, undefined, {
      'opening-prompt': PI_OPENING_PROMPT_EVIDENCE
    }),
    settingsContributionIds: ['pi-global-defaults'],
    configFiles: [{ id: 'native-settings', label: 'Native settings', scopes: [], effect: 'argv-app-store', rawEdit: false, reason: 'Zana uses verified argv and app settings; native file mapping is not verified.' }],
    targets: {
      roles: [],
      providers: [],
      providerModelRelationship: 'provider-then-model',
      models: [],
      modelLevelMapping: { low: undefined, medium: undefined, high: undefined, 'extra-high': undefined }
    },
    initialTaskDelivery: { local: 'spawn-arg', remote: 'spawn-arg', readinessSignal: 'process-spawned', acceptanceSignal: 'argv-bound' }
  },
  collision: {
    model: [{ names: ['--provider', '--model', '--thinking'], arity: 1, acceptsAttachedValue: true }],
    terminatesAtDoubleDash: true
  },
  status: { mode: 'output-activity' },
  evidence: [PI_OPENING_PROMPT_EVIDENCE]
};

/** The `pi` binary: the configured path, else the bare name on PATH. */
function piBinary(config: AppConfig): string {
  return config.piBinary || 'pi';
}

/**
 * The launcher-global PI defaults folded into every PI tab's base argv, in a
 * stable order (provider → model → thinking). Each flag is emitted only when the
 * config field is a non-empty override, so an unconfigured launch is byte-clean
 * and PI uses its own `~/.pi` defaults. `piThinking` is normalized to drop the
 * `'default'` sentinel in `store.ts`, so any value here is a real level.
 */
function piDefaultArgs(config: AppConfig): string[] {
  const args: string[] = [];
  if (config.piProvider) args.push('--provider', config.piProvider);
  if (config.piModel) args.push('--model', config.piModel);
  if (config.piThinking) args.push('--thinking', config.piThinking);
  return args;
}

export class PiProvider extends BaseLaunchProvider {
  readonly id = 'pi';
  readonly adapter = PI_ADAPTER;

  modelContribution(targetId: string, level?: ModelLevel) {
    return { args: ['--model', targetId] };
  }

  roleContribution(roleId: string) {
    return {};
  }

  projectSettingsArgs(settings: ProjectSettings, _profile?: LaunchProfileId): string[] {
    const args: string[] = [];
    if (settings.piProvider) args.push('--provider', settings.piProvider);
    if (settings.piModel) args.push('--model', settings.piModel);
    if (settings.piThinking && settings.piThinking !== 'default') args.push('--thinking', settings.piThinking);
    return args;
  }

  resolveLaunch(profile: LaunchProfileId, config: AppConfig, _autoModeActive: boolean): ResolvedLaunch {
    const command = piBinary(config);
    const defaults = piDefaultArgs(config);
    // `pi-resume` continues the most-recent session in the cwd. `-c`/`--continue`
    // reopens the latest session (parity with claude's `--continue` intent); it's
    // the flag that pins the session, so `baseArgsPinSession` returns true. The
    // provider/model/thinking defaults follow the resume flag (all are global
    // options PI accepts in any position).
    if (profile === 'pi-resume') {
      return { command, args: ['--continue', ...defaults] };
    }
    return { command, args: defaults };
  }

  baseArgsPinSession(profile: LaunchProfileId): boolean {
    // pi-resume's base args carry `--continue`, which pins the session.
    return profile === 'pi-resume';
  }

  // mcpArgs / guidanceArgs / hookArgs / personaArgs / projectSettingsArgs /
  // authInjection / authKey and computeAutoModeActive all inherit the EMPTY /
  // false / null defaults from BaseLaunchProvider. PI has no launcher-injectable
  // MCP / guidance / hook surface (it's MCP-less and wires hooks via extensions,
  // not a `--settings` flag), its flag surface differs from claude's (no
  // --mcp-config / --settings / --session-id / --permission-mode), and it
  // authenticates via its own `/login` (OAuth in `~/.pi`) or provider env keys —
  // there is no verified single endpoint+token spawn-env override to inject. Auto
  // mode is Claude Code's classifier-backed --permission-mode, not a PI concept.
  // All of these are v1 follow-ups if PI grows a launcher-injectable surface.

  buildRemoteCommand(input: RemoteCommandInput): RemoteCommandResult {
    // Relies on `pi` being on the remote PATH (mirrors the claude/cursor remote
    // path, which use the bare binary name rather than a local path).
    return this.simpleRemoteExec(input, 'pi');
  }

  title(profile: LaunchProfileId): string {
    return profile === 'pi-resume' ? 'pi --continue' : 'pi';
  }
}
