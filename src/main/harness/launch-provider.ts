/**
 * The interactive-launch SEAM.
 *
 * A `LaunchProvider` owns everything provider-SPECIFIC about turning a launch
 * profile into a spawned process: the base command + argv, the persona /
 * project-settings flag stack, auto-mode resolution, remote-command assembly,
 * and the tab title. `PtyManager` keeps the provider-AGNOSTIC orchestration
 * (session-id minting, the launcher-owned MCP config, lifecycle hooks, the
 * session env, backlog / batching / capacity) and dispatches every
 * provider-identity decision through the descriptor here.
 *
 * This is the main-side counterpart to `src/shared/launch-provider.ts` (which
 * holds the pure, renderer-safe `ProviderCapabilities` accessor). The split is
 * deliberate: the shared file has NO node/electron imports so the renderer can
 * gate UI on capabilities, while THIS file pulls in the node-only arg builders.
 *
 * Extraction discipline: every method below moved out of `pty.ts` byte-for-byte.
 * The golden-argv snapshot suite (`src/main/__tests__/pty-golden-argv.test.ts`)
 * proves dispatch changed nothing observable at the command line.
 *
 * Rule 6: concrete provider ids (`'claude-code'`, `'shell'`) and the profile
 * literals they switch on (`'claude-yolo'`, …) appear ONLY inside a provider
 * implementation and the registry — never in `PtyManager`'s launch logic, which
 * reads `capabilities(profile)` + calls these methods.
 */

import type {
  AppConfig,
  HarnessModelRoutingV1,
  LaunchProfileId,
  Persona,
  ProjectRemote,
  ProjectSettings
} from '../../shared/types.js';
import type { HarnessOption, ProviderCapabilities } from '../../shared/launch-provider.js';
import type { ModelLevel } from '../../shared/harness-adapter.js';
import type { HarnessAuthCredential, HarnessAuthKey } from '../harness-auth.js';
import type { TrustedHarnessAdapter } from './adapter-contract.js';

/** A resolved base launch: the executable and its base argv (pre-layers). */
export interface ResolvedLaunch {
  command: string;
  args: string[];
}

/**
 * The result of {@link LaunchProvider.authInjection}: how a per-harness base URL +
 * token (from the encrypted `harness-auth` store) is applied to THIS provider's
 * spawn. Two orthogonal channels, both optional:
 *  - `env` — extra environment variables merged into the child's env (the usual
 *    way a CLI takes a gateway URL + bearer: `ANTHROPIC_BASE_URL`/`_AUTH_TOKEN`,
 *    `OPENAI_API_KEY`, …).
 *  - `args` — extra argv the CLI needs to actually READ that env / URL (codex needs
 *    a `-c model_providers.*` block pointing at the base_url + env_key; claude/
 *    cursor take pure env and need none).
 * An empty object ⇒ nothing to inject (the credential is absent, or this provider
 * doesn't support an override).
 */
export interface HarnessAuthInjection {
  env?: Record<string, string>;
  args?: string[];
}

/** Inputs to auto-mode resolution — the precedence sources that can pin or
 *  override the default permission mode. Mirrors the old `computeAutoModeActive`
 *  signature exactly. */
export interface AutoModeInput {
  profile: LaunchProfileId;
  config: AppConfig;
  persona?: Persona;
  projectSettings?: ProjectSettings;
  harnessRouting?: HarnessModelRoutingV1;
  /** Already `cleanExtraArgs`-filtered per-tab args. */
  extraArgs: string[];
}

/** Inputs to the remote-command builder. */
export interface RemoteCommandInput {
  profile: LaunchProfileId;
  config: AppConfig;
  projectSettings?: ProjectSettings;
  extraArgs?: string[];
  harnessRouting?: HarnessModelRoutingV1;
  remote: ProjectRemote;
  persona?: Persona;
  /**
   * Per-session `ZCC_*` hook-callback URLs to export into the remote agent's
   * environment (pointed at the reverse-tunnel loopback endpoint — see
   * `PtyManager.createRemote`). Baked into the command string as a `KEY=val …`
   * prefix on the `exec`, exactly like the auto-mode env, so each session's
   * command literal carries its OWN session-unique URLs (no tmux `-e` threading
   * needed — the value never rides tmux's server-global env snapshot). Undefined
   * ⇒ no hooks wired (the historical remote behaviour).
   */
  hookEnv?: Record<string, string>;
  /**
   * The inline `--settings` JSON registering the remote hooks (from
   * `buildHookSettings`). Spliced into argv only when `hookEnv` is set.
   */
  hookSettingsJson?: string;
  /**
   * Provider-neutral remote hook-callback URLs — the reverse-tunnel-loopback twin
   * of {@link ProviderHookUrls}, pointed at `http://127.0.0.1:<remotePort>/hook/*`
   * (the `ssh -R` forward back to our local hook server). This is the same
   * per-event set `createRemote` derives its claude `hookEnv` from; a provider
   * whose CLI carries hooks as ARGS (codex) turns it into `-c hooks.*` overrides
   * via {@link LaunchProvider.hookArgs}, so codex remote reaches the SAME `/hook/*`
   * routes as claude remote. Undefined ⇒ no hooks wired (a shell/cursor remote, a
   * scheduled/headless run, or a boot before the MCP server binds).
   */
  remoteHookUrls?: ProviderHookUrls;
  /**
   * Mint a fresh claude `--session-id`. Called ONLY when the remote path owns a
   * stable session id (a `acceptsSessionId` profile with no caller-pinned
   * resume/session-id) — mirrors the local `create()` `mintClaudeSessionId`
   * dependency so the `randomUUID` side effect stays with the caller and the
   * builder stays deterministically testable. Undefined ⇒ no id injected (a
   * shell/cursor/codex profile, or a caller that doesn't want a session id).
   */
  mintClaudeSessionId?: () => string;
  /**
   * Reconnect resume: fold `--continue` into the remote claude argv so a
   * create-fresh reconnect (the remote tmux session was GONE — box rebooted or
   * persistence off) resumes the cwd's most-recent conversation from the
   * on-disk transcript instead of starting cold. Set by `createRemote` on a
   * wake reconnect. No-op when the caller already pins a resume/continue/
   * session-id flag (else it would double the flag), and for non-claude
   * profiles. When re-attach succeeds instead, tmux ignores this inner command
   * entirely, so it's harmless on the attach path.
   */
  resume?: boolean;
  /**
   * The reverse-tunnel loopback URL of the zcc-inbox MCP server, as the remote
   * agent sees it: `http://127.0.0.1:<remotePort>/mcp/<projectId>/<sessionId>`
   * (the `ssh -R` forward back to our local MCP/hook HTTP server). Set by
   * `createRemote` ONLY when `remoteMcpEnabled` is on AND the reverse tunnel is
   * being wired; a claude-family provider turns it into an inline `--mcp-config`
   * (URL baked in, no remote file needed) + the inbox `--allowedTools` +
   * inbox-usage `--append-system-prompt` guidance, so the remote agent gains the
   * SAME zcc-inbox surface (inbox_push/ask/search, mesh, follow-ups, library) a
   * local agent has. Undefined ⇒ the historical MCP-cut-off remote behaviour.
   */
  remoteMcpUrl?: string;
  /**
   * Whether this launch is a scheduled/headless run — threaded so the remote
   * MCP path can add `schedule_report` to the inbox allowlist and the
   * run-report guidance, mirroring the local `create()` `scheduled` flag. Only
   * consulted when `remoteMcpUrl` is set.
   */
  scheduled?: boolean;
}

/**
 * The identity-bearing hook-callback URLs a provider whose CLI carries hooks as
 * command-line ARGS (codex) can wire, mirroring the per-event `ZCC_*_URL` env the
 * claude path bakes. Every field is the SAME fully-resolved `/hook/*` route the
 * claude launcher points its env at, so the main-process handlers
 * (`onStopHook`/`onNotifyHook`/`onFirstPromptHook`/`onSubagentHook`) are
 * provider-AGNOSTIC — codex just reaches the same routes with the same semantics.
 *
 * A field is `undefined` when the launcher doesn't want that hook for this launch
 * (e.g. `firstPrompt` is omitted for a scheduled run, whose opening prompt rides
 * argv and never fires a UserPromptSubmit). The provider emits a `-c hooks.<Event>`
 * override only for the fields that are present.
 */
export interface ProviderHookUrls {
  /** Turn-END callback (`/hook/stop/:proj/:sess`). codex → `hooks.Stop`. */
  stop?: string;
  /**
   * Blocked/unblocked base (`/hook/notify/:proj/:sess`); the trailing path segment
   * (`/blocked` vs `/unblocked`) selects the transition. codex maps
   * `PermissionRequest` → `/blocked` (waiting on the user) and `UserPromptSubmit`
   * → `/unblocked` (a new turn cleared the wait).
   */
  notify?: string;
  /**
   * First-prompt callback (`/hook/firstprompt/:proj/:sess`) — POST the event JSON
   * (which carries a `prompt` field) so the tab-namer can title the tab. codex →
   * a `UserPromptSubmit` hook that forwards stdin.
   */
  firstPrompt?: string;
  /**
   * Sub-agent start/stop base (`/hook/subagent/:proj/:sess`); the trailing segment
   * (`/start` vs `/stop`) selects the event. codex maps `SubagentStart` → `/start`
   * and `SubagentStop` → `/stop` for the live sub-agent-count badge.
   */
  subagent?: string;
}

/**
 * The result of {@link LaunchProvider.buildRemoteCommand}: the command string
 * handed to the remote sshd, plus the claude `--session-id` the builder decided
 * to own (minted or recovered from a caller-pinned resume). `claudeSessionId` is
 * undefined for providers/profiles that don't carry a resumable session id.
 */
export interface RemoteCommandResult {
  cmd: string;
  claudeSessionId?: string;
}

/**
 * A launch provider. Registered per-profile (see `registry.ts`); one provider
 * may serve several profiles (the Claude-Code provider serves `claude`,
 * `claude-resume`, `claude-yolo`), so every method takes the concrete profile
 * to vary behaviour within the family.
 */
export interface LaunchProvider {
  /** Stable provider id — appears only here + the registry (Rule 6). */
  readonly id: string;

  /** Trusted capability/contribution metadata. It never changes emitted argv by itself. */
  readonly adapter: TrustedHarnessAdapter;

  /** Emit the opaque native contribution for a resolved model target. */
  modelContribution?(targetId: string, level?: ModelLevel): import('./adapter-contract.js').HarnessNativeContribution;

  /** Emit the opaque native contribution for a resolved role target. */
  roleContribution?(roleId: string): import('./adapter-contract.js').HarnessNativeContribution;

  /** Discover adapter-native role targets from main-authorized effective configuration. */
  discoverRoleTargets?(context: { cwd: string; config: AppConfig }): Promise<readonly import('../../shared/harness-adapter.js').HarnessRoleTarget[]>;

  /** Dynamic role catalogs are revalidated in main before launch. */
  acceptsDynamicRoleTargets?: boolean;

  /** Return the adapter-owned evidence identity for a discovered role target. */
  dynamicRoleEvidenceTarget?(target: import('../../shared/harness-adapter.js').HarnessRoleTarget, installedVersion: string): import('../../shared/harness-adapter.js').HarnessRoleTarget;

  /** Reject adapter-native combinations that cannot be represented safely. */
  validateRoutingCombination?(input: { roleTargetId?: string; executionOrigin: string }): string | undefined;

  /** Emit an adapter-owned native contribution for a stable execution target ID. */
  executionContribution?(targetId: string): import('./adapter-contract.js').HarnessNativeContribution;

  /** Capabilities for a specific profile this provider serves. */
  capabilities(profile: LaunchProfileId): ProviderCapabilities;

  /**
   * The data-driven picker options this profile offers — a flat, role-tagged
   * list (model / permissionMode / sandbox / approval). Like {@link capabilities},
   * this re-wraps the shared renderer-safe accessor (`harnessOptions`) so the
   * concrete catalogs live in ONE place; a provider only overrides it if its
   * options are computed from runtime `ctx` rather than a static catalog (none
   * do in v1). An empty role means the provider ignores that axis.
   */
  options(profile: LaunchProfileId): HarnessOption[];

  /**
   * The base command + argv, before the MCP / persona / project / hook layers
   * that `PtyManager` splices on. `autoModeActive` is resolved by the caller
   * via {@link computeAutoModeActive} and feeds the base permission flag.
   *
   * `resumeSessionId` (optional) is a provider-native EXACT-session resume target
   * — the id to reopen instead of the profile's blunt most-recent resume. It's
   * the seam for restoring a specific prior conversation whose resume dialect is
   * a POSITIONAL arg the launcher can't append (codex: `resume <uuid>`, distinct
   * from claude's appendable `--resume <id>` which rides `extraArgs` instead).
   * Providers that resume by flag ignore it; codex turns it into `resume <uuid>`.
   */
  resolveLaunch(
    profile: LaunchProfileId,
    config: AppConfig,
    autoModeActive: boolean,
    resumeSessionId?: string
  ): ResolvedLaunch;

  /**
   * Argv fragment that wires the zcc-inbox MCP server directly into the launch,
   * given the resolved per-session MCP URL (`<base>/mcp/<projectId>/<sessionId>`).
   *
   * This is for providers whose CLI carries MCP config as command-line ARGS —
   * codex takes `-c mcp_servers.zcc-inbox.url="<url>"` (a global `-c` override
   * that needs no file and no env-substitution: the full identity-bearing URL is
   * baked into the value at spawn). The Claude provider returns `[]` here because
   * its MCP wiring is the launcher-owned `--mcp-config` FILE + `ZCC_MCP_URL` env,
   * which `PtyManager` still owns and gates on `injectsClaudeMcpConfig`. Cursor returns
   * `[]` because cursor-agent reads MCP only from the user's project/global
   * `.cursor/mcp.json` — both off-limits — so it can't be bridged without a rule
   * violation (see the A5 CLI-surface finding). Shell returns `[]`.
   *
   * `PtyManager` calls this for every provider when it has a live MCP base URL, so
   * the concrete `-c mcp_servers…` string lives ONLY in the codex provider (Rule 6).
   */
  mcpArgs(profile: LaunchProfileId, mcpUrl: string): string[];

  /**
   * ENV fragment that wires the zcc-inbox MCP server into the launch, given the
   * resolved per-session MCP URL — the env-var counterpart to {@link mcpArgs}.
   *
   * This is for providers whose CLI carries MCP config as an ENVIRONMENT VARIABLE
   * rather than a file-arg (claude) or a `-c` arg (codex). OpenCode reads a merged
   * `opencode.json` and ALSO honours `OPENCODE_CONFIG_CONTENT` — an env var holding
   * inline config JSON that is deep-merged LAST (highest precedence) over the user's
   * config. So OpenCode returns `{ OPENCODE_CONFIG_CONTENT: '{"mcp":{"zcc-inbox":
   * {"type":"remote","url":"<url>","enabled":true}}}' }` with the full identity-
   * bearing URL baked straight into the value — no file written (Rule 2: we never
   * touch the user's project dir) and no `{env:…}` substitution needed. The deep
   * merge preserves the user's own MCP servers.
   *
   * Every other provider returns `{}`: claude uses the launcher-owned `--mcp-config`
   * FILE + `ZCC_MCP_URL` env (owned by `PtyManager`, gated on
   * `injectsClaudeMcpConfig`), codex bakes the URL into `mcpArgs`, and cursor/pi/
   * shell have no injectable MCP surface. `PtyManager` calls this for every provider
   * when it has a live MCP base URL and merges the result into the child env, so the
   * concrete `OPENCODE_CONFIG_CONTENT` string lives ONLY in the OpenCode provider
   * (Rule 6).
   */
  mcpEnv(profile: LaunchProfileId, mcpUrl: string): Record<string, string>;

  /**
   * Argv fragment that delivers the launcher's inbox/mesh/report GUIDANCE text
   * (when/why to use `inbox_push`, file a schedule report, discover peers, …) to
   * a provider whose CLI carries system-prompt guidance as command-line ARGS.
   *
   * This is the counterpart to {@link mcpArgs} for the *instructions* channel:
   * `mcpArgs` wires the inbox SERVER in, `guidanceArgs` teaches the agent when to
   * USE it. codex takes `-c developer_instructions="<toml>"` (a global `-c`
   * override that injects a developer-role message at spawn, verified via
   * `codex debug prompt-input` — version-independent, no file, no change to the
   * user's `~/.codex/config.toml`).
   *
   * The Claude provider returns `[]` here because its guidance rides on the
   * `--append-system-prompt` that `PtyManager` splices into `claudeMcpArgs`
   * (gated on `injectsClaudeMcpConfig`). Cursor returns `[]` because cursor-agent has no
   * flag-level system-prompt channel (same off-limits-config reason as its
   * `mcpArgs`). Shell returns `[]`.
   *
   * `PtyManager` calls this for every provider whenever it has BOTH a live MCP
   * base URL AND guidance to deliver, so the concrete `-c developer_instructions`
   * string lives ONLY in the codex provider (Rule 6). The `guidance` argument is
   * the exact same assembled text the claude path passes to
   * `--append-system-prompt`, so codex and claude tabs get identical guidance.
   */
  guidanceArgs(profile: LaunchProfileId, guidance: string): string[];

  /**
   * Argv fragment that wires the launcher's lifecycle hooks into a provider whose
   * CLI carries hook config as command-line ARGS, given the fully-resolved,
   * identity-bearing callback URLs in {@link ProviderHookUrls} — the SAME `/hook/*`
   * routes `PtyManager` bakes into the claude path's `ZCC_*_URL` env.
   *
   * This is the third `-c`-channel counterpart to {@link mcpArgs} (wires the
   * server) and {@link guidanceArgs} (teaches when to use it): `hookArgs` wires the
   * lifecycle signals. codex emits a `-c hooks.<Event>=[…]` global override per
   * present url — `Stop` (turn end → auto-close/scheduler/goal-loop),
   * `PermissionRequest`+`UserPromptSubmit` (blocked/unblocked status),
   * `UserPromptSubmit` (first-prompt tab naming, forwards stdin), and
   * `SubagentStart`+`SubagentStop` (live sub-agent count) — PLUS the single global
   * `--dangerously-bypass-hook-trust` flag (a `-c`-injected hook is untrusted and
   * won't RUN without it; every hook command is OUR curl to 127.0.0.1, never
   * agent- or user-supplied). codex delivers each hook's event JSON on the
   * command's STDIN (verified — the binary logs `failed to write hook stdin`), so
   * the first-prompt hook pipes stdin through to the callback exactly like the
   * claude `--data-binary @-` command. That Stop callback is what `PtyManager`'s
   * auto-close / scheduler / goal-loop turn-end logic keys on, so flipping codex's
   * `supportsHooks`/`canAutoCloseOnFinish` on is backed by a real signal.
   *
   * The Claude provider returns `[]` here because its hooks ride the launcher-
   * owned `--settings` JSON + `ZCC_*_URL` env that `PtyManager` still owns and
   * gates on `injectsClaudeMcpConfig` (claude-only). Cursor returns `[]` (no config-
   * injectable hook surface). Shell returns `[]`.
   *
   * `PtyManager` calls this for every provider whenever any hook url is present, so
   * the concrete `-c hooks.…` strings + bypass flag live ONLY in the codex provider
   * (Rule 6). Returns `[]` when no url is set (nothing to wire).
   */
  hookArgs(profile: LaunchProfileId, urls: ProviderHookUrls): string[];

  /**
   * Map a resolved per-harness credential ({@link HarnessAuthCredential}: an
   * optional base URL + token from the encrypted `harness-auth` store) onto THIS
   * provider's spawn — env vars and/or argv (see {@link HarnessAuthInjection}).
   *
   * This is how a user points a harness at a gateway/proxy or supplies a key
   * WITHOUT running the CLI's own `login`. Each provider owns its CLI's auth
   * dialect (Rule 6): claude → `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` env;
   * codex → a `-c model_providers.*` block + a token env var it names via
   * `env_key`; cursor → best-effort env. `PtyManager` decrypts the credential
   * (the impure step) and calls this for every launch, merging `env` into the
   * child env and splicing `args` into the argv. Returns `{}` when there's
   * nothing to inject (no stored/ambient credential), so a plain launch is
   * byte-identical to before this seam existed.
   */
  authInjection(profile: LaunchProfileId, cred: HarnessAuthCredential): HarnessAuthInjection;

  /**
   * Which per-harness credential family this profile draws from in the
   * `harness-auth` store — `'claude'` / `'codex'` / `'cursor'`, or `null` for a
   * provider with no auth surface (shell). This is the Rule-6-clean profile→family
   * map: `PtyManager` reads it to fetch the right stored credential to hand
   * {@link authInjection}, without naming a provider literal in its launch logic.
   */
  authKey(profile: LaunchProfileId): HarnessAuthKey | null;

  /** Persona-derived flags (empty when the provider ignores personas). */
  personaArgs(persona: Persona, profile: LaunchProfileId): string[];

  /** Project-settings-derived flags (empty when the provider ignores them). */
  projectSettingsArgs(settings: ProjectSettings, profile: LaunchProfileId): string[];

  /**
   * Whether this launch runs in auto mode. Providers with no permission system
   * (shell) always return false. Absorbs the old `resolveEffectiveModel` +
   * `computeAutoModeActive` pair — the effective model is an internal detail.
   */
  computeAutoModeActive(input: AutoModeInput): boolean;

  /**
   * True when the base args for this profile already pin a session id (so
   * `PtyManager` must NOT mint a second `--session-id`). Claude-resume's base
   * args carry `--resume`.
   */
  baseArgsPinSession(profile: LaunchProfileId): boolean;

  /**
   * Build the command handed to the remote sshd, plus the resumable session id
   * the builder owns (see {@link RemoteCommandResult}).
   */
  buildRemoteCommand(input: RemoteCommandInput): RemoteCommandResult;

  /** Display title for a tab of this profile. */
  title(profile: LaunchProfileId): string;

  /**
   * Screen-scan blocked detection (LAS-07): given the SETTLED recent screen text
   * of a session (ANSI already stripped), return `true` when it shows the harness
   * waiting on the user — a permission prompt or an interactive question the user
   * must answer. This is the ONLY blocked signal for a harness that emits no OSC
   * status glyph AND wires no lifecycle hook (`emitsOscStatus:false` +
   * `supportsHooks:false` — OpenCode, cursor, pi): such an agent goes QUIET at the
   * prompt, so the output-activity heuristic would otherwise read "waiting on the
   * user" as plain `idle`. The `ScreenScanBlockedDetector` scans the settled screen
   * on the silence edge and calls `AgentStatusTracker.markBlocked` when this
   * returns true; the overlay auto-clears when the agent visibly resumes (output →
   * `report('working')`).
   *
   * The concrete, harness-specific prompt PATTERN lives ONLY in the provider that
   * owns it (Rule 6) — e.g. OpenCode's `△ Permission required` / `Allow once` /
   * `Reject` TUI prompt. Claude returns `false` here (it uses the Notification hook
   * in `markBlocked`, not a screen scan), and every provider whose CLI has no such
   * quiet-at-prompt failure mode inherits the base `false`. Providers that grow a
   * `supportsHooks`-based blocked signal (codex) also stay `false` — the hook is
   * the higher-fidelity source. Must be PURE (no I/O) and cheap: it runs on a
   * bounded recent-text window each time a non-OSC agent settles.
   */
  detectBlockedPrompt(profile: LaunchProfileId, recentText: string): boolean;
}
