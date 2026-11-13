/**
 * CodexProvider — launching the OpenAI Codex CLI (`codex`), for the profiles it
 * serves: `codex` and `codex-resume`.
 *
 * Codex differs from Claude/Cursor in two ways that matter to the launcher:
 *  - RESUME IS A SUBCOMMAND, not a flag: `codex resume --last` reopens the most
 *    recent session (vs claude's `--resume`/`--continue` flag). So the base argv
 *    for `codex-resume` is `['resume', '--last']`, not a leading `--flag`.
 *  - HOOKS are discovered PER CONFIG LAYER and APPENDED, not sourced from one
 *    file: codex collects hooks from each layer (user `~/.codex/config.toml`,
 *    project `.codex`, the session-flags layer our `-c hooks.*` lands in, and
 *    managed/requirements layers) lowest-precedence-first and concatenates them.
 *    Our `-c hooks.<Event>=…` overrides only replace each other WITHIN the
 *    session-flags layer; they do NOT drop the user's or project's hooks. Hooks
 *    do NOT come from CLI flags, so the Claude flag stack (`--settings`,
 *    `--session-id`, `--permission-mode`) is not part of codex's interface, and
 *    this provider returns `[]` for the persona / project-settings flag stacks.
 *    Those `ProviderCapabilities` stay OFF (see `providerCapabilities`).
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
 *    our local `/hook/*` callbacks. A `-c`-injected hook lands in the session-flags
 *    layer UNTRUSTED and won't RUN until trusted, so the launcher also passes ONE
 *    `-c hooks.state={…}` override carrying the `trusted_hash` of exactly the
 *    handlers Zana generates (user and project hooks keep their normal trust
 *    state). That scoped mode is enabled only after a per-binary conformance probe
 *    proves codex computes the same hashes (`hook-trust.ts`); until then, when the
 *    probe fails, and for every remote launch, the DEGRADED fallback is the global
 *    `--dangerously-bypass-hook-trust` flag, which skips the trust prompt for the
 *    user's and project's enabled hooks too — see {@link hookArgs}. Full lifecycle
 *    parity with the claude `--settings` hooks,
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

import type { AppConfig, LaunchProfileId, Persona, ProjectSettings } from '@zana-ai/zcc-domain/product';
import type { HarnessMcpServer } from '@zcc/harness-sdk';
import type {
  HarnessAuthInjection,
  ProviderHookUrls,
  RemoteCommandInput,
  McpToolApproval,
  RemoteCommandResult,
  ResolvedLaunch,
  SquadSeatCapability,
  UserMcpEnumeration
} from '../launch-provider.js';

import type { HarnessAuthCredential, HarnessAuthKey } from '../../harness-auth.js';
import { BaseLaunchProvider } from '../base-provider.js';
import type { HarnessModelTarget, ModelLevel } from '@zana-ai/zcc-domain/harness-adapter';
import { facetSupport, type TrustedHarnessAdapter } from '../adapter-contract.js';
import { enumerateCodexUserMcpServers } from './user-mcp-servers.js';
import { overlayDiscoveredModels } from '../discovered-model-evidence.js';
import { codexLegacyRouting } from './legacy-routing.js';
import { codexInteractionHook } from './interaction-hooks.js';
import { buildCodexHookSpecs, renderHookOverrides, tomlBasic } from './hook-trust-specs.js';
import { resolveHarnessCommand, verificationSearchPath } from '../harness-command.js';
import { CODEX_BYPASS_HOOK_TRUST_FLAG, codexHookStateArgs, type CodexHookTrustMode } from './hook-trust.js';
import { BARE_KEY } from '../../mcp-allowlist-disable.js';

export const CODEX_EVIDENCE_VERSION = '0.140.0';
const codexEvidence = (id: string, scope: 'local' | 'remote', observed: string) => ({
  id, versionRange: CODEX_EVIDENCE_VERSION, scope,
  probe: 'codex --version plus provider and golden argv contract suite', observed, reviewedAt: '2026-08-04'
});

const CODEX_ADAPTER: TrustedHarnessAdapter = {
  descriptor: {
    id: 'codex', label: 'Codex', agentDefaultEligible: true, terminalEligible: false, defaultProfileId: 'codex',
    profiles: [{ id: 'codex', posture: 'default' }, { id: 'codex-resume', posture: 'resume' }, { id: 'codex-yolo', posture: 'unrestricted' }],
    capabilities: facetSupport(
      { 'opening-prompt': 'exact', 'model-selection': 'exact', 'execution-policy': 'exact', 'mcp-references': 'exact' },
      { 'opening-prompt': 'exact' },
      {
        'opening-prompt': {
          local: codexEvidence('codex.facet.opening-prompt', 'local', 'CLI binds opening prompt at spawn.'),
          remote: codexEvidence('codex.facet.opening-prompt', 'remote', 'Remote command binds opening prompt at spawn.')
        },
        'mcp-references': codexEvidence(
          'codex.facet.mcp-references', 'local',
          'Persona MCP allowlist disables each unlisted user server by name with -c mcp_servers.<n>.enabled=false; no generated file.'
        )
      }
    ),
    settingsContributionIds: ['codex-global-defaults'],
    configFiles: [{ id: 'native-settings', label: 'Native settings', scopes: [], effect: 'argv-app-store', rawEdit: false, reason: 'Zana uses verified argv and app settings; native file mapping is not verified.' }],
    targets: {
      roles: [],
      providers: [{ id: 'openai', label: 'OpenAI' }],
      providerModelRelationship: 'fixed-provider',
      models: [
        { id: 'gpt-5.5', label: 'GPT-5.5', scope: ['local', 'remote'], evidenceVersion: CODEX_EVIDENCE_VERSION },
        { id: 'gpt-5.4', label: 'GPT-5.4', scope: ['local', 'remote'], evidenceVersion: CODEX_EVIDENCE_VERSION },
        { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', scope: ['local', 'remote'], evidenceVersion: CODEX_EVIDENCE_VERSION },
        { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', scope: ['local', 'remote'], evidenceVersion: CODEX_EVIDENCE_VERSION },
        { id: 'gpt-4o', label: 'GPT-4o', scope: ['local', 'remote'], evidenceVersion: CODEX_EVIDENCE_VERSION },
        { id: 'gpt-4o-mini', label: 'GPT-4o Mini', scope: ['local', 'remote'], evidenceVersion: CODEX_EVIDENCE_VERSION },
        { id: 'o1', label: 'o1', scope: ['local', 'remote'], evidenceVersion: CODEX_EVIDENCE_VERSION },
        { id: 'o1-mini', label: 'o1 Mini', scope: ['local', 'remote'], evidenceVersion: CODEX_EVIDENCE_VERSION },
        { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet', scope: ['local', 'remote'], evidenceVersion: CODEX_EVIDENCE_VERSION }
      ],
      modelLevelMapping: { low: undefined, medium: undefined, high: undefined, 'extra-high': undefined },
      // Name terms first (they track new releases); exact catalog ids last so a harness with no live
      // inventory still lands on a sensible model ('mini' alone would rank o1-mini above gpt-4o-mini).
      defaultModelTierRules: {
        low: ['luna', 'gpt-4o-mini', 'mini'],
        medium: ['terra', 'gpt-4o'],
        high: ['sol', 'gpt-5.5'],
        'extra-high': ['sol', 'gpt-5.5']
      },
      executionStateMapping: {
        plan: 'read-only + on-request',
        interactive: 'workspace-write + on-request',
        'accept-edits': 'default',
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
  status: { mode: 'output-activity', interactionHook: codexInteractionHook },
  legacyRouting: codexLegacyRouting,
  evidence: [
    codexEvidence('codex.facet.opening-prompt', 'local', 'CLI binds opening prompt at spawn.'),
    codexEvidence('codex.facet.opening-prompt', 'remote', 'Remote command binds opening prompt at spawn.'),
    ...['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.6-sol', 'gpt-4o', 'gpt-4o-mini', 'o1', 'o1-mini', 'claude-3-5-sonnet-20241022'].flatMap((id) => [
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

/** A complete double-quoted TOML basic string (the escaped value in quotes). */
function tomlValue(s: string): string {
  return `"${tomlBasic(s)}"`;
}

/**
 * `-c` overrides that add one plugin-contributed MCP server to a codex launch.
 * The server name is a bare key by construction; env keys that are not bare
 * keys are dropped rather than quoted. A stdio server without a command and a
 * URL server without a URL contribute nothing.
 */
export function codexServerArgs(server: HarnessMcpServer): string[] {
  const base = `mcp_servers.${server.name}`;
  if (server.type === 'stdio') {
    if (!server.command) return [];
    const out = ['-c', `${base}.command=${tomlValue(server.command)}`];
    if (server.args?.length) out.push('-c', `${base}.args=[${server.args.map(tomlValue).join(',')}]`);
    const env = Object.entries(server.env ?? {}).filter(([key]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key));
    if (env.length) out.push('-c', `${base}.env={${env.map(([key, value]) => `${key}=${tomlValue(value)}`).join(',')}}`);
    return out;
  }
  return server.url ? ['-c', `${base}.url=${tomlValue(server.url)}`] : [];
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

export class CodexProvider extends BaseLaunchProvider {
  readonly id = 'codex';
  /** Squad seat contract (#675, D1). Persona text folds into the single developer_instructions value. No denylist: u-spike showed a PATH shim loses to the login shell path_helper (shim-wins: no). */
  readonly squadSeat: SquadSeatCapability = {
    instructions: true,
    commandDeny: 'none',
    executionTools: true,
    foldPersonaIntoGuidance: true
  };
  /** Same as Claude: CLI Agent / Modern send thread-catalog ids (`gpt-5.5`, …). */
  readonly acceptsUnlistedModelTargets = true;
  private discoveredModels: readonly HarnessModelTarget[] = [];

  get adapter(): TrustedHarnessAdapter {
    if (!this.discoveredModels.length) return CODEX_ADAPTER;
    const { models, evidence } = overlayDiscoveredModels(
      this.discoveredModels,
      CODEX_ADAPTER.evidence,
      CODEX_EVIDENCE_VERSION,
      (id, scope) => codexEvidence(id, scope, 'Live Codex model/list catalog and -m contribution verified.')
    );
    return {
      ...CODEX_ADAPTER,
      evidence,
      descriptor: {
        ...CODEX_ADAPTER.descriptor,
        targets: {
          ...CODEX_ADAPTER.descriptor.targets!,
          models,
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
    if (state === 'accept-edits') return {};
    const policies = {
      plan: ['read-only', 'on-request'],
      interactive: ['workspace-write', 'on-request'],
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
    this.launchBinary = command;
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
    // `--dangerously-bypass-hook-trust` (hooks only), which is only the degraded hook-trust fallback.
    if (profile === 'codex-yolo') {
      return { command, args: ['--dangerously-bypass-approvals-and-sandbox'] };
    }
    return {
      command,
      args: codexOptionArgs(undefined, config.defaultCodexSandbox, config.defaultCodexApproval)
    };
  }

  enumerateUserMcpServers(input: { cwd: string; env: NodeJS.ProcessEnv }): UserMcpEnumeration {
    return enumerateCodexUserMcpServers(input);
  }

  mcpArgs(
    _profile: LaunchProfileId,
    mcpUrl: string,
    servers?: readonly HarnessMcpServer[],
    disabledServers?: readonly string[]
  ): string[] {
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
    // A persona MCP allowlist: Codex has no clear-all, so each unlisted user server is
    // disabled by name. Names are bare config keys (the host skips any that are not),
    // and only the name is written, never a definition or credential.
    const disableArgs = (disabledServers ?? [])
      .filter((name) => BARE_KEY.test(name))
      .flatMap((name) => ['-c', `mcp_servers.${name}.enabled=false`]);
    return ['-c', `mcp_servers.zcc-inbox.url=${tomlValue}`, ...(servers ?? []).flatMap((server) => codexServerArgs(server)), ...disableArgs];
  }

  mcpApprovalArgs(_profile: LaunchProfileId, approval: McpToolApproval): string[] {
    if (approval.defaultToolsApprovalMode === 'approve') {
      return ['-c', 'mcp_servers.zcc-inbox.default_tools_approval_mode="approve"'];
    }

    const tools = [...new Set(approval.tools ?? [])];
    if (tools.length === 0) return [];
    // Codex splits CLI override keys on every dot, without interpreting quoted
    // segments. Keep tool names in the TOML value so dots remain part of the name.
    const entries = tools.map((tool) => `${tomlValue(tool)} = { approval_mode = "approve" }`);
    return ['-c', `mcp_servers.zcc-inbox.tools={ ${entries.join(', ')} }`];
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

  /** Trust mode for LOCAL launches; `bypass` until a binary probe verifies scoped trust. */
  private hookTrustMode: CodexHookTrustMode = 'bypass';

  /** Set by the registration after the per-binary conformance probe. */
  setHookTrustMode(mode: CodexHookTrustMode, binary?: string): void {
    this.hookTrustMode = mode;
    this.verifiedBinary = mode === 'scoped' ? binary : undefined;
  }

  /** Binary the conformance probe verified; scoped trust never applies to any other binary. */
  private verifiedBinary: string | undefined;
  /** Binary of the launch currently being assembled (resolveLaunch runs just before hookArgs). */
  private launchBinary: string | undefined;
  /**
   * The probe verifies the RESOLVED path (`harness-verify.ts` records it), while
   * `launchBinary` is the configured command, usually the bare `codex`. Compare
   * like with like: resolve the launch command exactly as verification did.
   */
  private resolveBinary: (command: string) => string = (command) =>
    resolveHarnessCommand(command, verificationSearchPath());

  /** Test seam: substitute the command resolver so identity checks do not depend on the host PATH. */
  setBinaryResolverForTests(resolver: (command: string) => string): void {
    this.resolveBinary = resolver;
  }

  get currentHookTrustMode(): CodexHookTrustMode {
    return this.hookTrustMode;
  }

  hookArgs(_profile: LaunchProfileId, urls: ProviderHookUrls): string[] {
    const scoped =
      this.hookTrustMode === 'scoped' &&
      this.verifiedBinary !== undefined &&
      this.launchBinary !== undefined &&
      this.verifiedBinary === this.resolveBinary(this.launchBinary);
    return this.buildHookArgs(urls, scoped);
  }

  /**
   * `-c hooks.<Event>=[…]` overrides register `command` hooks at spawn with NO
   * file written; they curl the SAME identity-baked `/hook/*` routes the claude
   * path uses, so the main-process handlers stay provider-agnostic (specs and
   * command shapes live in `hook-trust-specs.ts`).
   *
   * A `-c`-injected hook lands in codex's SESSION-FLAGS config layer and is
   * UNTRUSTED until `hooks.state` holds a matching `trusted_hash`. Two ways to
   * make it run:
   *  - SCOPED (preferred): one extra `-c hooks.state={…}` naming only the hashes
   *    of the handlers generated here, so user and project hooks keep their normal
   *    trust state. Used only when the per-binary conformance probe verified that
   *    codex computes the same hashes (see `hook-trust.ts`).
   *  - GLOBAL bypass (degraded fallback): `--dangerously-bypass-hook-trust`, which
   *    skips the trust check for EVERY enabled hook, user and project hooks
   *    included. Used before the probe completes, when the probe fails or
   *    mismatches, and always for remote launches (the remote binary cannot be
   *    probed locally). Every command wired here is OUR curl to 127.0.0.1, never
   *    agent- or user-supplied. The flag is valid before OR after the `resume`
   *    subcommand, same slot as our `-c` args; emitted ONCE.
   */
  private buildHookArgs(urls: ProviderHookUrls, scoped: boolean): string[] {
    const specs = buildCodexHookSpecs(urls);
    // No hooks wanted → nothing to wire (and no need for any trust arg).
    if (specs.length === 0) return [];
    const overrides = renderHookOverrides(specs);
    return scoped
      ? [...overrides, ...codexHookStateArgs(specs)]
      : [CODEX_BYPASS_HOOK_TRUST_FLAG, ...overrides];
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
    // Persona reasoning effort → codex's `model_reasoning_effort` config key
    // (the same key the Codex thread provider sets). The persona levels are a
    // subset of codex's, so the value passes through unchanged. `-c` is a global
    // option, valid before or after `resume`. Absent = no flag.
    const effort = persona.reasoningLevel ? ['-c', `model_reasoning_effort=${tomlValue(persona.reasoningLevel)}`] : [];
    return [...codexOptionArgs(modelValue, undefined, undefined), ...effort];
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
    // (+ the one trust-bypass flag, never the scoped state) as the local path — so a remote codex tab
    // reaches the identical provider-agnostic `/hook/*` routes as a remote claude
    // tab (turn-end / blocked-unblocked / first-prompt naming / subagent count).
    // No urls (shell/cursor gate, scheduled/headless, or pre-bind) ⇒ empty, i.e.
    // the historical no-hooks remote spawn. MCP/guidance are deliberately NOT
    // bridged remotely — mirroring claude remote, which tunnels only the async
    // fire-and-forget hooks, never the larger MCP surface.
    // Remote launches always use the global bypass flag: the probe verifies the
    // LOCAL binary only, so scoped trust cannot be vouched for on the remote one.
    const hookArgs = input.remoteHookUrls
      ? this.buildHookArgs(input.remoteHookUrls, false)
      : [];
    return this.simpleRemoteExec(input, 'codex', hookArgs);
  }

  title(profile: LaunchProfileId): string {
    if (profile === 'codex-resume') return 'codex resume';
    if (profile === 'codex-yolo') return 'codex --yolo';
    return 'codex';
  }
}
