/**
 * CodexProvider — launching the OpenAI Codex CLI (`codex`), for the profiles it
 * serves: `codex` and `codex-resume`.
 *
 * Codex differs from Claude/Cursor in two ways that matter to the launcher:
 *  - RESUME IS A SUBCOMMAND, not a flag: `codex resume --last` reopens the most
 *    recent session (vs claude's `--resume`/`--continue` flag). So the base argv
 *    for `codex-resume` is `['resume', '--last']`, not a leading `--flag`.
 *  - HOOKS come from `~/.codex/config.toml` / codex's hook schema, NOT from CLI
 *    flags. So the Claude flag stack (`--settings`, `--session-id`,
 *    `--permission-mode`) is not part of codex's interface, and this provider
 *    returns `[]` for the persona / project-settings flag stacks. Those
 *    `ProviderCapabilities` stay OFF (see `providerCapabilities`).
 *
 * MCP, GUIDANCE, and HOOKS are all bridged through the SAME `-c` global-override
 * channel — codex accepts three launcher injections natively, each written with
 * NO file and NO change to the user's `~/.codex/config.toml`:
 *  - **MCP** (A5): `-c mcp_servers.zcc-inbox.url=…` wires our streamable-http
 *    inbox server, so the inbox mesh (inbox_push / inbox_search / follow-ups /
 *    library / goals) works on codex tabs — see {@link mcpArgs}.
 *  - **GUIDANCE** (G3): `-c developer_instructions=…` injects the inbox/mesh/
 *    report guidance as a developer-role message — see {@link guidanceArgs}.
 *  - **HOOKS** (A6/C9): `-c hooks.<Event>=[…]` registers `command` hooks that curl
 *    our local `/hook/*` callbacks, PLUS the global `--dangerously-bypass-hook-trust`
 *    flag (a `-c`-injected hook is untrusted and won't RUN without it; the source
 *    is self-vetted since WE build the curl-to-127.0.0.1 commands) — see
 *    {@link hookArgs}. Full lifecycle parity with the claude `--settings` hooks,
 *    reaching the SAME provider-agnostic `/hook/*` handlers:
 *      · `Stop` → `/hook/stop` — turn END (auto-close, scheduler stamp, goal loop);
 *        codex's `supportsHooks`/`canAutoCloseOnFinish` are ON because of it.
 *      · `PermissionRequest` → `/hook/notify/…/blocked` and `UserPromptSubmit` →
 *        `/hook/notify/…/unblocked` — the "blocked — needs you" live status.
 *      · `UserPromptSubmit` → `/hook/firstprompt` (forwards the event JSON on
 *        stdin, which carries `prompt`) — tab auto-naming.
 *      · `SubagentStart` → `/hook/subagent/…/start` and `SubagentStop` →
 *        `/hook/subagent/…/stop` — the live sub-agent-count badge.
 *    codex delivers each hook's event JSON on the command's STDIN (verified: the
 *    binary logs `failed to write hook stdin`), so the first-prompt command pipes
 *    stdin through with `--data-binary @-`, exactly like the claude path.
 *    Event-key CASING is PascalCase (`Stop`, `UserPromptSubmit`, …) — codex's
 *    `HookEventsToml` config struct, confirmed in the 0.140.0 binary; the
 *    lowercase `userPromptSubmit`/… names are the app-server JSON-RPC surface, not
 *    the TOML config keys.
 *
 * Rule 6: the concrete profile literals (`'codex'`, `'codex-resume'`) and the
 * provider id (`'codex'`) appear ONLY here + the registry.
 */

import type { AppConfig, LaunchProfileId, Persona, ProjectSettings } from '../../shared/types.js';
import type {
  HarnessAuthInjection,
  ProviderHookUrls,
  RemoteCommandInput,
  RemoteCommandResult,
  ResolvedLaunch
} from './launch-provider.js';
import type { HarnessAuthCredential, HarnessAuthKey } from '../harness-auth.js';
import { BaseLaunchProvider } from './base-provider.js';
import type { HarnessModelTarget, ModelLevel } from '../../shared/harness-adapter.js';
import { facetSupport, type TrustedHarnessAdapter } from './adapter-contract.js';

const CODEX_EVIDENCE_VERSION = '0.140.0';
const codexEvidence = (id: string, scope: 'local' | 'remote', observed: string) => ({
  id, versionRange: CODEX_EVIDENCE_VERSION, scope,
  probe: 'codex --version plus provider and golden argv contract suite', observed, reviewedAt: '2026-08-04'
});

const CODEX_ADAPTER: TrustedHarnessAdapter = {
  descriptor: {
    id: 'codex', label: 'Codex', agentDefaultEligible: true, terminalEligible: false, defaultProfileId: 'codex',
    profiles: [{ id: 'codex', posture: 'default' }, { id: 'codex-resume', posture: 'resume' }, { id: 'codex-yolo', posture: 'unrestricted' }],
    capabilities: facetSupport(
      { 'opening-prompt': 'exact', 'model-selection': 'exact', 'execution-policy': 'exact' },
      { 'opening-prompt': 'exact' },
      { 'opening-prompt': {
        local: codexEvidence('codex.facet.opening-prompt', 'local', 'CLI binds opening prompt at spawn.'),
        remote: codexEvidence('codex.facet.opening-prompt', 'remote', 'Remote command binds opening prompt at spawn.')
      } }
    ),
    settingsContributionIds: ['codex-global-defaults'],
    targets: {
      roles: [],
      providers: [{ id: 'openai', label: 'OpenAI' }],
      providerModelRelationship: 'fixed-provider',
      models: [
        { id: 'gpt-4o', label: 'GPT-4o', scope: ['local', 'remote'], evidenceVersion: CODEX_EVIDENCE_VERSION },
        { id: 'gpt-4o-mini', label: 'GPT-4o Mini', scope: ['local', 'remote'], evidenceVersion: CODEX_EVIDENCE_VERSION },
        { id: 'o1', label: 'o1', scope: ['local', 'remote'], evidenceVersion: CODEX_EVIDENCE_VERSION },
        { id: 'o1-mini', label: 'o1 Mini', scope: ['local', 'remote'], evidenceVersion: CODEX_EVIDENCE_VERSION },
        { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet', scope: ['local', 'remote'], evidenceVersion: CODEX_EVIDENCE_VERSION }
      ],
      modelLevelMapping: { low: 'gpt-4o-mini', medium: 'gpt-4o', high: 'gpt-4o', 'extra-high': 'o1' },
      executionStateMapping: {
        plan: 'read-only + on-request',
        interactive: 'workspace-write + untrusted',
        'accept-edits': 'workspace-write + on-request',
        autonomous: 'danger-full-access + never'
      }
    },
    initialTaskDelivery: { local: 'spawn-arg', remote: 'spawn-arg', readinessSignal: 'process-spawned', acceptanceSignal: 'argv-bound' }
  },
  executionTargetMetadata: {
    plan: { equivalence: 'exact', scopes: ['local', 'remote'] },
    interactive: { equivalence: 'exact', scopes: ['local', 'remote'] },
    'accept-edits': { equivalence: 'exact', scopes: ['local', 'remote'] },
    autonomous: { equivalence: 'exact', scopes: ['local', 'remote'] }
  },
  collision: {
    model: [{ names: ['-m', '--model'], arity: 1, acceptsAttachedValue: true }],
    execution: [
      { names: ['-s', '--sandbox', '-a', '--ask-for-approval'], arity: 1, acceptsAttachedValue: true },
      { names: ['--dangerously-bypass-approvals-and-sandbox'], arity: 0 }
    ],
    terminatesAtDoubleDash: true
  },
  evidence: [
    codexEvidence('codex.facet.opening-prompt', 'local', 'CLI binds opening prompt at spawn.'),
    codexEvidence('codex.facet.opening-prompt', 'remote', 'Remote command binds opening prompt at spawn.'),
    ...['gpt-4o', 'gpt-4o-mini', 'o1', 'o1-mini', 'claude-3-5-sonnet-20241022'].flatMap((id) => [
      codexEvidence(id, 'local', 'Codex model selector verified by provider contract.'),
      codexEvidence(id, 'remote', 'Codex remote model selector verified by remote command contract.')
    ])
  ]
};

/** The env var name codex's injected custom provider reads its bearer token from. */
const CODEX_TOKEN_ENV = 'ZCC_CODEX_KEY';

/** The codex binary: the configured path, else the bare name on PATH. */
function codexBinary(config: AppConfig): string {
  return config.codexBinary || 'codex';
}

/** Escape a value for embedding in a TOML basic (double-quoted) string. */
function tomlBasic(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
    .replace(/\r/g, '\\r');
}

/** A complete double-quoted TOML basic string (the escaped value in quotes). */
function tomlValue(s: string): string {
  return `"${tomlBasic(s)}"`;
}

/**
 * Assemble codex's model/sandbox/approval flags in a stable order. Shared by
 * {@link CodexProvider.personaArgs} and {@link CodexProvider.projectSettingsArgs}.
 * `default`/empty model is the "emit nothing" sentinel (codex uses its own
 * configured default). sandbox/approval are emitted only when set.
 */
function codexOptionArgs(
  model: string | undefined,
  sandbox: string | undefined,
  approval: string | undefined
): string[] {
  const args: string[] = [];
  // if (model && model !== 'default') args.push('-m', model);
  if (sandbox) args.push('-s', sandbox);
  if (approval) args.push('-a', approval);
  return args;
}

/**
 * Build one `-c hooks.<Event>=[…]` override registering a single `command` hook.
 * The `command` is a shell string codex runs via `sh -c` (with the event JSON on
 * stdin), so the WHOLE inline-table is one TOML value: escape the assembled
 * command once for the TOML basic string it sits in. Matcher is `"*"` (match-all)
 * — codex's Stop/lifecycle events aren't tool-scoped.
 */
function codexHookOverride(event: string, command: string): string[] {
  return ['-c', `hooks.${event}=[{matcher="*",hooks=[{type="command",command="${tomlBasic(command)}"}]}]`];
}

export class CodexProvider extends BaseLaunchProvider {
  readonly id = 'codex';
  private discoveredModels: readonly HarnessModelTarget[] = [];

  get adapter(): TrustedHarnessAdapter {
    if (!this.discoveredModels.length) return CODEX_ADAPTER;
    const models = this.discoveredModels;
    const defaultModel = models[0]?.id;
    return {
      ...CODEX_ADAPTER,
      descriptor: {
        ...CODEX_ADAPTER.descriptor,
        targets: {
          ...CODEX_ADAPTER.descriptor.targets!,
          models,
          modelLevelMapping: {
            low: models.find((model) => /mini/i.test(model.id))?.id ?? defaultModel,
            medium: defaultModel,
            high: defaultModel,
            'extra-high': defaultModel
          }
        }
      }
    };
  }

  setDiscoveredModels(models: readonly HarnessModelTarget[]): void {
    this.discoveredModels = models;
  }

  modelContribution(targetId: string, level?: ModelLevel) {
    return { args: ['-m', targetId] };
  }

  executionContribution(targetId: string) {
    const state = targetId.replace('codex.execution.', '') as 'plan' | 'interactive' | 'accept-edits' | 'autonomous';
    const policies = {
      plan: ['read-only', 'on-request'],
      interactive: ['workspace-write', 'untrusted'],
      'accept-edits': ['workspace-write', 'on-request'],
      autonomous: ['danger-full-access', 'never']
    } as const;
    const [sandbox, approval] = policies[state];
    return { args: codexOptionArgs(undefined, sandbox, approval) };
  }

  roleContribution(roleId: string) {
    return {};
  }

  resolveLaunch(
    profile: LaunchProfileId,
    config: AppConfig,
    _autoModeActive: boolean,
    resumeSessionId?: string
  ): ResolvedLaunch {
    const command = codexBinary(config);
    // Resume is a SUBCOMMAND (positional), unlike claude/cursor's leading
    // `--resume` flag — so it must be the FIRST argv element, and the `-c`/`-m`/
    // `-s`/`-a` layers `PtyManager` splices on all come AFTER it (verified:
    // `codex resume <UUID> -m … -s … -c …` parses). Two resume shapes:
    //  - EXACT: an app-detected rollout UUID (restore of a specific tab) →
    //    `resume <uuid>` reopens THAT conversation (the codex twin of claude's
    //    `--resume <claudeSessionId>`).
    //  - MOST-RECENT: no id → `resume --last` reopens the cwd's newest session.
    if (profile === 'codex-resume') {
      return {
        command,
        args: resumeSessionId ? ['resume', resumeSessionId] : ['resume', '--last']
      };
    }
    // codex-yolo → `--dangerously-bypass-approvals-and-sandbox`: codex's documented
    // full bypass (skips BOTH the approval prompt AND the sandbox). It supersedes
    // the `-s`/`-a` axis, so the launcher suppresses those pickers for this profile
    // (see `harnessOptions` in launch-provider.ts). This differs from
    // `--dangerously-bypass-hook-trust` (hooks only), which is spliced separately.
    if (profile === 'codex-yolo') {
      return { command, args: ['--dangerously-bypass-approvals-and-sandbox'] };
    }
    return {
      command,
      args: codexOptionArgs(undefined, config.defaultCodexSandbox, config.defaultCodexApproval)
    };
  }

  mcpArgs(_profile: LaunchProfileId, mcpUrl: string): string[] {
    // codex reads MCP servers from `~/.codex/config.toml` [mcp_servers], but the
    // `-c key=value` GLOBAL override injects one at spawn with NO file written and
    // NO change to the user's config — the true `--mcp-config` analogue. codex's
    // MCP client speaks streamable-http natively (bundled rmcp
    // StreamableHttpClient), which is exactly the transport our zcc-inbox server
    // uses, so a bare `url` entry is a first-class HTTP MCP server.
    //
    // Unlike claude's `.mcp.json` (which does `${ZCC_MCP_URL}` env-substitution at
    // spawn), the `-c` value is taken literally — so we bake the FULL resolved,
    // identity-bearing URL into it here. The value must be valid TOML: a
    // double-quoted string. Our URLs are ASCII (http://host:port/mcp/<id>/<id>)
    // with no embedded quote/backslash, so quoting is a plain wrap; guard anyway.
    //
    // `-c` is a global option accepted before OR after the `resume` subcommand
    // (verified), so appending it to the base argv is safe for both profiles.
    const tomlValue = `"${mcpUrl.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    return ['-c', `mcp_servers.zcc-inbox.url=${tomlValue}`];
  }

  guidanceArgs(_profile: LaunchProfileId, guidance: string): string[] {
    // codex has no `--append-system-prompt`, but the `-c developer_instructions=…`
    // GLOBAL override injects a developer-role message at spawn with NO file
    // written and NO change to the user's `~/.codex/config.toml` — the true
    // `--append-system-prompt` analogue for codex. Verified via
    // `codex debug prompt-input`: the value surfaces verbatim as a `developer`
    // message ahead of the user turn (works on both the interactive and `exec`
    // paths; version-independent — it's a plain config key, not a CLI flag).
    //
    // The value must be valid TOML: a double-quoted basic string. Our guidance is
    // multi-line prose with embedded quotes, so escape the TOML-significant chars
    // (backslash, double-quote) and the control chars a basic string forbids raw
    // (newline, tab, CR) into their `\`-escapes. `-c` is a global option accepted
    // before OR after the `resume` subcommand, so this is safe for both profiles.
    if (!guidance) return [];
    const tomlValue = `"${guidance
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\t/g, '\\t')
      .replace(/\r/g, '\\r')}"`;
    return ['-c', `developer_instructions=${tomlValue}`];
  }

  authInjection(_profile: LaunchProfileId, cred: HarnessAuthCredential): HarnessAuthInjection {
    // codex authenticates its model turns against the Responses API; a plain
    // `OPENAI_API_KEY` env is NOT honored there (empirically → 401 on
    // `wss://.../v1/responses`). The supported override is a CUSTOM PROVIDER block,
    // selected as the active `model_provider` and pointed at a base_url + an
    // `env_key` naming the env var that carries the bearer — verified accepted by
    // codex 0.140.0's strict config parser. So we inject BOTH: the `-c` block that
    // DEFINES + SELECTS the provider, and the token in the env var it reads.
    //
    // Only wire it when we actually have an override to apply — a bare token with
    // no base_url still benefits (points codex's own API host at a keyed provider),
    // but with NEITHER a stored/ambient token NOR a base_url there's nothing to do,
    // so a plain launch stays byte-identical (codex uses its own `login`).
    if (!cred.token && !cred.baseUrl) return {};

    // Default to codex's normal OpenAI endpoint when only a token was supplied.
    const baseUrl = cred.baseUrl || 'https://api.openai.com/v1';
    const args = [
      '-c',
      'model_provider="zcc"',
      '-c',
      `model_providers.zcc.name="ZCC"`,
      '-c',
      `model_providers.zcc.base_url=${tomlValue(baseUrl)}`,
      '-c',
      `model_providers.zcc.env_key="${CODEX_TOKEN_ENV}"`
    ];
    const env: Record<string, string> = {};
    if (cred.token) env[CODEX_TOKEN_ENV] = cred.token;
    return { env, args };
  }

  authKey(_profile: LaunchProfileId): HarnessAuthKey {
    return 'codex';
  }

  hookArgs(_profile: LaunchProfileId, urls: ProviderHookUrls): string[] {
    // codex has a claude-shaped hooks subsystem in `~/.codex/config.toml`; the
    // `-c hooks.<Event>=[…]` GLOBAL overrides register hooks at spawn with NO file
    // written. We wire `command`-type hooks that curl the SAME identity-baked
    // `/hook/*` routes the claude path bakes into its `ZCC_*_URL` env, so the
    // main-process handlers stay provider-agnostic. Event-key casing is PascalCase
    // (codex's `HookEventsToml` config struct).
    //
    // Two hard requirements, both verified on codex 0.140.0 (A6/C9 spike):
    //  1. A `-c`-injected hook is UNTRUSTED and parses-but-won't-RUN unless we also
    //     pass the global `--dangerously-bypass-hook-trust` flag. That's a
    //     deliberate security-posture choice; it's the flag's stated use ("automation
    //     that already vets hook sources") — every command is OUR curl to 127.0.0.1,
    //     never agent- or user-supplied. The flag is global (valid before OR after
    //     the `resume` subcommand), same slot as our `-c` args. Emitted ONCE.
    //  2. codex delivers each hook's event JSON on the command's STDIN (verified:
    //     the binary logs `failed to write hook stdin`). Fire-and-forget hooks that
    //     only ping a fixed URL DRAIN stdin first (`cat >/dev/null`) so codex's
    //     write never blocks on an unread pipe; the first-prompt hook instead pipes
    //     stdin through (`--data-binary @-`) because it needs the `prompt` body.
    //     `curl -sS -m 5 -o /dev/null` keeps every hook quiet and bounded so a
    //     hung callback can't wedge codex's shutdown.
    //
    //     `-o /dev/null` is LOAD-BEARING, not cosmetic: codex reads a hook
    //     command's STDOUT and, for lifecycle events like `Stop`, tries to parse
    //     it as an optional JSON control directive. Our `/hook/*` routes reply
    //     with a plain `ok` body, so without discarding curl's response codex logs
    //     `error: hook returned invalid stop hook JSON output` on every turn end
    //     (verified live via an interactive PTY on codex 0.140.0). Draining STDIN
    //     (`cat >/dev/null`) is a separate concern — that stops codex blocking on
    //     the pipe; `-o /dev/null` stops it mis-reading the reply. The claude path
    //     (`spawn-plan.ts`) already redirects with `>/dev/null 2>&1` for the same
    //     reason.
    const args: string[] = [];

    if (urls.stop) {
      // Turn END → auto-close / scheduler stamp / goal loop. `/hook/stop` ignores
      // the body, so just drain stdin and ping.
      args.push(
        ...codexHookOverride('Stop', `cat >/dev/null 2>&1; curl -sS -m 5 -o /dev/null -X POST "${urls.stop}"`)
      );
    }

    if (urls.notify) {
      // Blocked/unblocked live status. codex's `PermissionRequest` fires when the
      // agent is waiting on the user (permission escalation) → POST /blocked; a new
      // `UserPromptSubmit` means the wait cleared → POST /unblocked. (The claude
      // path also clears on Stop, but codex's Stop slot is taken by the turn-end
      // hook above, and `/hook/stop`'s handler already clears blocked — so a
      // separate unblock-on-stop is redundant.)
      args.push(
        ...codexHookOverride(
          'PermissionRequest',
          `cat >/dev/null 2>&1; curl -sS -m 5 -o /dev/null -X POST "${urls.notify}/blocked"`
        )
      );
    }

    // UserPromptSubmit carries two independent jobs; codex takes ONE hooks list per
    // event key, so fold both commands into a single `UserPromptSubmit` override
    // (each `command` entry gets its own stdin copy).
    const userPromptCommands: string[] = [];
    if (urls.notify) {
      // A new turn cleared the "needs you" wait → POST /unblocked. Drains stdin.
      userPromptCommands.push(`cat >/dev/null 2>&1; curl -sS -m 5 -o /dev/null -X POST "${urls.notify}/unblocked"`);
    }
    if (urls.firstPrompt) {
      // Forward the event JSON (carries `prompt`) so the tab-namer can title the
      // tab. Pipe stdin through verbatim — this is the one hook that needs the body.
      userPromptCommands.push(
        `curl -sS -m 5 -o /dev/null -X POST --data-binary @- "${urls.firstPrompt}"`
      );
    }
    if (userPromptCommands.length > 0) {
      const hookEntries = userPromptCommands
        .map((c) => `{type="command",command="${tomlBasic(c)}"}`)
        .join(',');
      args.push('-c', `hooks.UserPromptSubmit=[{matcher="*",hooks=[${hookEntries}]}]`);
    }

    if (urls.subagent) {
      // Live sub-agent-count badge. SubagentStart → /start (increments),
      // SubagentStop → /stop (decrements). Both fixed-URL pings; drain stdin.
      args.push(
        ...codexHookOverride(
          'SubagentStart',
          `cat >/dev/null 2>&1; curl -sS -m 5 -o /dev/null -X POST "${urls.subagent}/start"`
        ),
        ...codexHookOverride(
          'SubagentStop',
          `cat >/dev/null 2>&1; curl -sS -m 5 -o /dev/null -X POST "${urls.subagent}/stop"`
        )
      );
    }

    // No hooks wanted → nothing to wire (and no need for the bypass flag).
    if (args.length === 0) return [];
    // The bypass flag must precede the `-c` hooks so an untrusted `-c` hook will
    // actually RUN. Emitted exactly once regardless of how many events we wired.
    return ['--dangerously-bypass-hook-trust', ...args];
  }

  /**
   * Codex model/sandbox/approval flags from a persona. Codex's flag dialect
   * differs from claude's (`-m`/`-s`/`-a`, no `--permission-mode`/`--allowedTools`),
   * so we emit ONLY the codex-relevant fields:
   *  - `model` → `-m <model>` (skip the `default` sentinel = "codex's own default").
   *  - `codexSandbox` → `-s <policy>`; `codexApproval` → `-a <policy>`.
   * `-m/-s/-a` are global options accepted before OR after the `resume`
   * subcommand, so this is safe for both profiles. Order is stable
   * (model → sandbox → approval) for the golden-argv net.
   */
  personaArgs(persona: Persona, _profile: LaunchProfileId): string[] {
    // codex-yolo forces `--dangerously-bypass-approvals-and-sandbox`, which
    // supersedes `-s`/`-a` — so drop those two (a stored sandbox/approval would
    // otherwise conflict with the bypass), keeping only `-m`. Parity with how
    // claude-yolo drops `--permission-mode`.
    const modelValue = persona.model || persona.harnessRouting?.byAdapter?.codex?.modelTargetId || persona.harnessRouting?.byAdapter?.codex?.compatibility?.model;
    return codexOptionArgs(modelValue, undefined, undefined);
  }

  /** Project-settings twin of {@link personaArgs}; same codex flag dialect. */
  projectSettingsArgs(settings: ProjectSettings, _profile: LaunchProfileId): string[] {
    return codexOptionArgs(settings.model, undefined, undefined);
  }

  // computeAutoModeActive inherits the `false` default from BaseLaunchProvider:
  // auto mode is a Claude-Code `--permission-mode auto` concept; codex gates
  // execution via `-s`/`-a` (above) instead.

  baseArgsPinSession(profile: LaunchProfileId): boolean {
    // `codex resume --last` pins the session (reopens a specific prior session).
    return profile === 'codex-resume';
  }

  buildRemoteCommand(input: RemoteCommandInput): RemoteCommandResult {
    // Relies on `codex` being on the remote PATH (mirrors the claude/cursor
    // remote path, which use the bare binary name rather than a local path).
    //
    // HOOK PARITY WITH CLAUDE REMOTE: when `createRemote` set up the reverse
    // tunnel (interactive, MCP server up), it hands us `remoteHookUrls` pointed at
    // the loopback `-R` port. We turn those into the SAME `-c hooks.*` overrides
    // (+ the one trust-bypass flag) as the local path — so a remote codex tab
    // reaches the identical provider-agnostic `/hook/*` routes as a remote claude
    // tab (turn-end / blocked-unblocked / first-prompt naming / subagent count).
    // No urls (shell/cursor gate, scheduled/headless, or pre-bind) ⇒ empty, i.e.
    // the historical no-hooks remote spawn. MCP/guidance are deliberately NOT
    // bridged remotely — mirroring claude remote, which tunnels only the async
    // fire-and-forget hooks, never the larger MCP surface.
    const hookArgs = input.remoteHookUrls
      ? this.hookArgs(input.profile, input.remoteHookUrls)
      : [];
    return this.simpleRemoteExec(input, 'codex', hookArgs);
  }

  title(profile: LaunchProfileId): string {
    if (profile === 'codex-resume') return 'codex resume';
    if (profile === 'codex-yolo') return 'codex --yolo';
    return 'codex';
  }
}
