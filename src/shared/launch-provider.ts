/**
 * Shared launch profile parsing, validation, and capability resolution.
 * Single source of truth for the canonical profile set and what each profile
 * can do. Imported by both main and renderer — must have NO electron/node-only
 * imports.
 */

import type { LaunchProfileId, HarnessFamily } from './types.js';

/**
 * The canonical set of launch profiles — the single source of truth.
 * Order is stable and deliberate: most-common first.
 */
export const VALID_PROFILES = [
  'claude',
  'claude-resume',
  'claude-yolo',
  'cursor',
  'cursor-resume',
  'cursor-yolo',
  'codex',
  'codex-resume',
  'codex-yolo',
  'pi',
  'pi-resume',
  'opencode',
  'opencode-resume',
  'shell'
] as const satisfies readonly LaunchProfileId[];

/**
 * Parse a string into a validated LaunchProfileId, or null if unrecognized.
 * Round-trips with {@link formatProfile}.
 */
export function parseProfile(s: string): LaunchProfileId | null {
  return (VALID_PROFILES as readonly string[]).includes(s) ? (s as LaunchProfileId) : null;
}

/**
 * Format a LaunchProfileId as a string (the identity function, but typed for
 * symmetry with {@link parseProfile}).
 */
export function formatProfile(p: LaunchProfileId): string {
  return p;
}

/** Human-facing label for a launch profile id (renderer/palette copy). */
export function profileLabel(p: LaunchProfileId): string {
  switch (p) {
    case 'claude':
      return 'Claude';
    case 'claude-resume':
      return 'Claude Resume';
    case 'claude-yolo':
      return 'Claude YOLO';
    case 'cursor':
      return 'Cursor';
    case 'cursor-resume':
      return 'Cursor Resume';
    case 'cursor-yolo':
      return 'Cursor YOLO';
    case 'codex':
      return 'Codex';
    case 'codex-resume':
      return 'Codex Resume';
    case 'codex-yolo':
      return 'Codex YOLO';
    case 'pi':
      return 'PI';
    case 'pi-resume':
      return 'PI Resume';
    case 'opencode':
      return 'OpenCode';
    case 'opencode-resume':
      return 'OpenCode Resume';
    case 'shell':
      return 'Shell';
    default:
      return p;
  }
}

/**
 * True for Claude-family profiles that run an MCP host and own a resumable
 * conversation. False for shell (a plain interactive shell with no transcript).
 */
export function isClaudeProfile(p: LaunchProfileId): boolean {
  return p === 'claude' || p === 'claude-resume' || p === 'claude-yolo';
}

/** True for the Cursor-family profiles (`cursor-agent` CLI). */
export function isCursorProfile(p: LaunchProfileId): boolean {
  return p === 'cursor' || p === 'cursor-resume' || p === 'cursor-yolo';
}

/** True for the Codex-family profiles (`codex` CLI). */
export function isCodexProfile(p: LaunchProfileId): boolean {
  return p === 'codex' || p === 'codex-resume' || p === 'codex-yolo';
}

/** True for the PI-family profiles (`pi` CLI — `@earendil-works/pi-coding-agent`). */
export function isPiProfile(p: LaunchProfileId): boolean {
  return p === 'pi' || p === 'pi-resume';
}

/** True for the OpenCode-family profiles (`opencode` CLI — npm `opencode-ai`). */
export function isOpenCodeProfile(p: LaunchProfileId): boolean {
  return p === 'opencode' || p === 'opencode-resume';
}

/**
 * True for any profile we treat as an "agent" (a coding CLI with a conversation)
 * as opposed to a plain interactive shell. This is the single predicate the
 * Agents board / auto-close-idle should key on instead of `=== 'shell'`.
 */
export function isAgentProfile(p: LaunchProfileId): boolean {
  return (
    isClaudeProfile(p) ||
    isCursorProfile(p) ||
    isCodexProfile(p) ||
    isPiProfile(p) ||
    isOpenCodeProfile(p)
  );
}

/**
 * Map a profile to its verifiable code-harness FAMILY, or `null` for a profile
 * that has no verifiable CLI (shell). The launcher uses this to look up a
 * profile's install status (`HarnessVerifyResult.family`) so an enabled-but-
 * missing harness can be shown greyed-out.
 */
export function harnessFamilyOf(p: LaunchProfileId): HarnessFamily | null {
  if (isClaudeProfile(p)) return 'claude';
  if (isCursorProfile(p)) return 'cursor';
  if (isCodexProfile(p)) return 'codex';
  if (isPiProfile(p)) return 'pi';
  if (isOpenCodeProfile(p)) return 'opencode';
  return null;
}

/**
 * Provider capabilities — what a profile can do. Drives conditional UI
 * (showing summarize / resume / auto-close controls) and what command-line
 * flags / hooks we can wire up at spawn. Grounded in CURRENT usage — see the
 * call sites that branch on these predicates.
 */
export interface ProviderCapabilities {
  /**
   * True when the profile runs a Claude CLI (an MCP host) with a conversation
   * transcript that can be resumed/summarized. False for shell.
   * Drives: inbox summary, resume-picker, agent registry, transcript reads.
   *
   * PURE "does a transcript exist" semantics — do NOT reuse this to gate
   * Claude-CLI flag injection; that is {@link injectsClaudeMcpConfig}. The two
   * happen to coincide for every profile today, but a future non-Claude provider
   * could have a resumable transcript WITHOUT taking Claude's launcher flags.
   */
  hasTranscript: boolean;

  /**
   * True when the profile takes Claude Code's launcher-injected flags/env at
   * spawn — the `--mcp-config` file write, the `--settings` Stop/Notify hook
   * JSON + `ZCC_*_URL` env, the per-session V8 heap ceiling (NODE_OPTIONS), and
   * interactive persona `initialPrompt` injection. True for Claude-family only;
   * false for cursor/codex/shell (they discover MCP/hooks from their own on-disk
   * config, or take none). De-conflated from {@link hasTranscript}: this gates
   * WHICH launcher flags we splice into argv/env, independent of whether a
   * transcript exists. Gated sites: `PtyManager.create` — the `--mcp-config`
   * write, `claudeWithCallback`, `applyHeapCeiling`, and persona `initialPrompt`.
   */
  injectsClaudeMcpConfig: boolean;

  /**
   * True when the profile accepts --permission-mode flags. False for
   * claude-yolo (which forces --dangerously-skip-permissions and ignores the
   * flag) and shell (no permission system).
   * Drives: whether to emit --permission-mode in persona/project/global args.
   */
  acceptsPermissionMode: boolean;

  /**
   * True when the profile accepts a prompt as positional argv (scheduled runs
   * and goal-manager inject prompts this way). True for all Claude-family
   * profiles, false for shell (a shell has no --prompt interpretation).
   * Drives: whether scheduler / goal-manager append the prompt to argv.
   */
  acceptsPromptArgv: boolean;

  /**
   * True when the profile can wire up lifecycle hooks (Stop, Notify,
   * FirstPrompt, Subagent, Overseer) via --settings + ZCC_*_URL env vars.
   * True for all Claude-family profiles, false for shell.
   * Drives: whether to build hookArgs / sessionEnv entries in pty.ts.
   */
  supportsHooks: boolean;

  /**
   * True when the profile should be counted as an "agent" in the agent monitor
   * / ProjectAgentsBoard (vs plain shells).
   * Drives: filter `session.profile === 'shell'` in AgentsView, auto-close-idle.
   */
  isAgent: boolean;

  /**
   * True when the profile can receive an --session-id to mint a stable
   * claudeSessionId for restore. True for all Claude-family profiles when the
   * caller doesn't already pin one (via --resume / --continue).
   * Drives: whether to mint + inject sessionIdArgs in pty.ts.
   */
  acceptsSessionId: boolean;

  /**
   * True when the profile can be auto-closed on "finished" by the scheduler
   * (a shell never signals "finished").
   * Drives: whether to enable the scheduler's autoCloseOnFinish checkbox.
   */
  canAutoCloseOnFinish: boolean;

  /**
   * True when the profile drives its own agent-status via OSC terminal titles
   * (Claude Code emits a leading braille spinner while working and a `✳` glyph
   * when idle — see `agent-status.ts` `classifyOscTitle`). True for Claude only.
   *
   * When FALSE (codex/cursor), the OSC detector never fires, so the session
   * would sit at `unknown` forever — the agent board, auto-close-idle, heartbeat,
   * idle-triage and catch-up all key off the `status` stream. Such an agent
   * instead gets the provider-agnostic OUTPUT-ACTIVITY heuristic
   * (`output-activity.ts`): any output → `working`, a short silence → `idle`.
   * Drives: which detector `index.ts`'s pty `data` handler feeds a session
   * through (`isAgent && !emitsOscStatus` → the activity monitor). Shell is not
   * an agent, so it gets neither.
   */
  emitsOscStatus: boolean;
}

/**
 * The all-off capability floor — every gate FALSE. Two uses:
 *  1. The forward-compat fallback in {@link providerCapabilities} for a profile
 *     id we don't recognise (a persisted string from a newer app version, or a
 *     harness not yet registered) — so an unknown id degrades to "runs nothing,
 *     enables no feature" instead of silently borrowing shell's identity.
 *  2. The capability answer of the {@link providerFor} least-capable STUB.
 *
 * It is deliberately NON-runnable in spirit: `isAgent`/`acceptsPromptArgv`/… all
 * off means no feature service (resume-picker, auto-close-idle, scheduler
 * stop-hook, heap ceiling, MCP/hook injection) ever activates on it. A missing
 * registry entry is therefore a visible OVER-degrade, never a crash and never a
 * feature firing against a harness that can't honor it. Frozen so a caller can't
 * mutate the shared floor.
 */
export const LEAST_CAPABLE: Readonly<ProviderCapabilities> = Object.freeze({
  hasTranscript: false,
  injectsClaudeMcpConfig: false,
  acceptsPermissionMode: false,
  acceptsPromptArgv: false,
  supportsHooks: false,
  isAgent: false,
  acceptsSessionId: false,
  canAutoCloseOnFinish: false,
  emitsOscStatus: false
});

/**
 * Resolve the capabilities for a given profile. The single accessor every
 * provider re-wraps.
 *
 * Claude-family profiles are the fully-integrated harness: they take Claude
 * Code's launcher-injected `--mcp-config` / `--settings` / `--session-id`
 * flags, so every capability that gates one of those injections in
 * `PtyManager.create` is on.
 *
 * Cursor (`cursor-agent`) and Codex (`codex`) are ALSO agents with resumable
 * conversations, but they discover MCP servers and hooks from their OWN on-disk
 * config (`.cursor/mcp.json`, `~/.codex/config.toml`) — NOT from Claude's CLI
 * flags. So the flag-INJECTION capabilities (`injectsClaudeMcpConfig` — which
 * gates the launcher's `--mcp-config` write, hook `--settings`, heap ceiling and
 * persona initialPrompt —, `supportsHooks`, `acceptsSessionId`,
 * `acceptsPermissionMode`) are OFF for them in v1: turning any on would splice a
 * Claude-only flag into an argv the CLI doesn't understand and break the spawn.
 * This is the same "launch works, MCP/hooks are a follow-up" posture the remote
 * ssh path already ships with. What stays ON is what's true and safe today:
 * `isAgent` (they belong on the Agents board / auto-close-idle) and
 * `acceptsPromptArgv` (both take a positional seed prompt).
 */
export function providerCapabilities(profile: LaunchProfileId): ProviderCapabilities {
  const isClaude = isClaudeProfile(profile);
  const isYolo = profile === 'claude-yolo';

  if (isClaude) {
    return {
      hasTranscript: true,
      injectsClaudeMcpConfig: true, // Claude CLI natively accepts these flags
      acceptsPermissionMode: !isYolo, // ZCC limitation: yolo forces its own bypass, skipping this
      acceptsPromptArgv: true, // Claude CLI supports positional prompt
      supportsHooks: true, // Claude CLI accepts --settings
      isAgent: true,
      acceptsSessionId: true, // Claude CLI accepts --session-id
      canAutoCloseOnFinish: true,
      emitsOscStatus: true // Claude emits the braille/✳ OSC status glyphs
    };
  }

  if (isCodexProfile(profile)) {
    return {
      // No Claude-CLI flags (--mcp-config/--settings/--session-id/--permission-
      // mode) — those stay OFF — but codex hooks ARE bridgeable via the `-c`
      // override channel (Stop hook → curl our callback + bypass-trust flag), so
      // it can signal turn-end: supportsHooks + canAutoCloseOnFinish ON.
      //
      // hasTranscript is TRUE: codex writes a readable rollout JSONL at
      // ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<UUID>.jsonl that
      // `codex-transcript-reader.ts` parses into the same SessionStats/digest/
      // last-turn as Claude. Unlike Claude the session id is DETECTED not minted
      // (see `codex-session-resolver.ts`), so `acceptsSessionId` (mint at spawn
      // via --session-id) stays FALSE — a Codex session has a transcript without
      // taking a forced id, exactly the case `hasTranscript` was de-conflated
      // from `injectsClaudeMcpConfig` to allow. The transcript reads dispatch
      // through `transcript-source.ts` by this capability.
      hasTranscript: true,
      injectsClaudeMcpConfig: false, // Harness limitation: Codex CLI does not accept --mcp-config
      acceptsPermissionMode: false, // Harness limitation: Codex uses sandbox instead of permission-mode
      acceptsPromptArgv: true, // Codex CLI supports positional prompt
      supportsHooks: true,
      isAgent: true,
      acceptsSessionId: false, // Harness limitation: Codex mints its own session IDs
      canAutoCloseOnFinish: true,
      // codex prints no OSC status glyph → the output-activity heuristic drives
      // its working/idle state instead (see `emitsOscStatus` doc + output-activity.ts).
      emitsOscStatus: false
    };
  }

  if (isCursorProfile(profile)) {
    return {
      // v1: no launcher-injected MCP config / hooks / session-id / permission
      // flags — cursor-agent reads all of those from off-limits on-disk config
      // with no config-path flag to redirect it. See the doc comment above.
      hasTranscript: false,
      injectsClaudeMcpConfig: false, // Harness limitation: Cursor CLI reads from disk, not flags
      acceptsPermissionMode: false, // Harness limitation: Cursor does not support this flag
      acceptsPromptArgv: true, // Cursor CLI supports positional prompt
      supportsHooks: false, // Harness limitation: Cursor hooks are read from disk
      isAgent: true,
      acceptsSessionId: false, // Harness limitation: Cursor handles its own sessions
      canAutoCloseOnFinish: false,
      // cursor-agent prints no OSC status glyph → output-activity heuristic drives it.
      emitsOscStatus: false
    };
  }

  if (isPiProfile(profile)) {
    return {
      // v1: PI (`@earendil-works/pi-coding-agent`) is a cursor/codex-shaped
      // interactive CLI — positional seed prompt + `--continue`/`--resume`/
      // `--session <id>` — but it takes NONE of Claude's launcher-injected flags
      // (`--mcp-config`/`--settings`/`--session-id`/`--permission-mode`): it has
      // no MCP flag surface ("No MCP" by design — extensions only), wires hooks
      // through extensions (not `--settings`), and gates its own tools. So every
      // flag-injection capability stays OFF, exactly like cursor. `hasTranscript`
      // is FALSE in v1: PI writes JSONL sessions under `~/.pi`, but we ship no
      // reader for that format yet, and TRUE would misroute `transcript-source.ts`
      // to the claude reader. What stays ON is what's true today: `isAgent` (it
      // belongs on the Agents board / auto-close-idle) and `acceptsPromptArgv`
      // (it takes a positional seed prompt). See A5 multi-provider posture.
      hasTranscript: false, // ZCC limitation: we ship no reader for the PI format yet
      injectsClaudeMcpConfig: false, // Harness limitation: PI CLI does not take MCP config flags
      acceptsPermissionMode: false, // Harness limitation: PI gates its own tools
      acceptsPromptArgv: true, // PI CLI supports positional prompt
      supportsHooks: false, // Harness limitation: PI hooks are wired through extensions
      isAgent: true,
      acceptsSessionId: false, // Harness limitation: PI handles its own sessions
      // PI prints no OSC status glyph → the output-activity heuristic drives its
      // working/idle state (see `emitsOscStatus` doc + output-activity.ts).
      emitsOscStatus: false,
      canAutoCloseOnFinish: false
    };
  }

  if (isOpenCodeProfile(profile)) {
    return {
      // v1: OpenCode (`opencode`, npm `opencode-ai`) is a cursor/pi-shaped
      // interactive TUI — a seed prompt via `--prompt` and `-c/--continue` /
      // `-s/--session <id>` resume — but it takes NONE of Claude's launcher-
      // injected flags (`--mcp-config`/`--settings`/`--session-id`/`--permission-
      // mode`): it reads MCP servers, agents and plugins from its OWN config
      // (`opencode.json` / `OPENCODE_CONFIG_CONTENT` env), has no `--append-
      // system-prompt` (personas map to named `--agent` configs, not free text),
      // wires no `--settings` lifecycle hooks, and its session id is DETECTED via
      // `-s`, not minted at spawn. So every flag-injection capability stays OFF,
      // exactly like cursor/pi. NOTE this is why zcc-inbox is injected through the
      // provider's own `mcpEnv` (`OPENCODE_CONFIG_CONTENT`) channel, NOT the
      // claude `--mcp-config` path `injectsClaudeMcpConfig` gates — the two are
      // deliberately independent (see OpenCodeProvider + pty.ts env assembly).
      // `hasTranscript` is TRUE: OpenCode stores sessions in a SQLite db under
      // `~/.local/share/opencode/opencode.db` (or `$XDG_DATA_HOME/opencode/…`),
      // and `opencode-transcript-reader.ts` reads it directly (read-only,
      // WAL-safe alongside the live process) — `transcript-source.ts` routes
      // here via `isOpenCodeProfile`, keyed off `TranscriptSessionRef.openCodeSessionId`
      // (detected by `OpenCodeSessionResolver`, not minted at spawn).
      hasTranscript: true,
      injectsClaudeMcpConfig: false, // Harness limitation: OpenCode CLI reads from its own config
      acceptsPermissionMode: false, // Harness limitation: OpenCode does not support this flag
      acceptsPromptArgv: true, // OpenCode CLI supports --prompt flag
      supportsHooks: false, // Harness limitation: OpenCode wires no --settings lifecycle hooks
      isAgent: true,
      acceptsSessionId: false, // Harness limitation: OpenCode detects session id, not minted
      // OpenCode's TUI prints no OSC status glyph → the output-activity heuristic
      // drives its working/idle state (see `emitsOscStatus` doc + output-activity.ts).
      emitsOscStatus: false,
      canAutoCloseOnFinish: false
    };
  }

  if (profile === 'shell') {
    // A plain interactive shell: none of the above. Shell's floor happens to be
    // byte-identical to LEAST_CAPABLE, but we return a fresh (mutable) object
    // here — not the frozen shared constant — so a legacy caller that mutates the
    // result can't poison the shared floor.
    return { ...LEAST_CAPABLE };
  }

  // Forward-compat degrade floor (T2.1): a profile id we don't recognise — a
  // string persisted by a newer app version, or a harness not yet registered —
  // degrades to the all-off LEAST_CAPABLE stub. This can't be reached through
  // the typed `LaunchProfileId` union today, but `providerCapabilities` is called
  // on the runtime string a session/config carries, which CAN drift ahead of the
  // union. Returning all-off means every feature gate sees false and no service
  // fires against a harness that can't honor it (a visible over-degrade, never a
  // crash) — instead of the old `?? shell` alias that made an unknown id LOOK
  // like a runnable shell.
  return { ...LEAST_CAPABLE };
}

/**
 * Build the argv fragment that seeds a fresh session with an opening PROMPT for
 * a given profile — the single source of truth for HOW a seed prompt is
 * delivered per harness. Callers append the result to their assembled argv.
 *
 * The delivery mechanism differs by harness and getting it wrong breaks the
 * spawn:
 *  - Claude / Cursor / Codex / PI read a POSITIONAL `[prompt]` as the first
 *    turn — `claude [options] [prompt]`. A prompt that begins with a dash is
 *    preceded by `--` (end-of-options) so it's treated as the positional prompt
 *    rather than a flag. This MUST be the LAST argv element.
 *  - OpenCode's positional is a DIRECTORY (`opencode [project]`), NOT a prompt —
 *    passing the prompt positionally makes it `cd` into a bogus path and exit
 *    (`Failed to change directory to …/<prompt>`). Its seed prompt rides the
 *    `--prompt <text>` flag instead.
 *  - `shell` (and any profile without `acceptsPromptArgv`) takes NO seed prompt
 *    — a shell would run it as a command. Returns `[]`.
 *
 * An empty / whitespace-only prompt yields `[]` for every profile.
 */
export function seedPromptArgs(profile: LaunchProfileId, prompt: string): string[] {
  const body = prompt.trim();
  if (!body) return [];
  if (!providerCapabilities(profile).acceptsPromptArgv) return [];
  // OpenCode: the positional is the project dir, so the seed prompt is a flag.
  if (isOpenCodeProfile(profile)) return ['--prompt', body];
  // Positional seed prompt (claude/cursor/codex/pi): escape a dash-leading body
  // with `--` so the CLI treats it as the prompt, not an unknown flag.
  return body.startsWith('-') ? ['--', body] : [body];
}

/** A selectable option in a provider-driven picker (`<option>` id + label). */
export interface ProviderUiOption {
  id: string;
  label: string;
}

/**
 * The provider-agnostic UI schema a renderer picker reads to render the model /
 * permission-mode selectors for a launch profile, INSTEAD of hard-coding claude's
 * aliases. Grounded in what the provider actually consumes at spawn:
 *
 *  - An EMPTY list means the provider IGNORES that dimension in v1 — codex/cursor
 *    discard `--model` (their `personaArgs`/`projectSettingsArgs` are no-ops) and
 *    `--permission-mode` (`acceptsPermissionMode: false`), and shell has neither.
 *    A picker reading an empty list disables/hides itself rather than offering a
 *    control whose value would be silently dropped (an honest UI over a lie).
 *  - A NON-empty list is the exact set the provider's flag builders understand.
 *
 * This is the "config/persona/model/permission UI" counterpart to
 * {@link ProviderCapabilities}: capabilities gate spawn-time flag injection, the
 * UI schema gates which picker OPTIONS the renderer offers. Both are keyed off the
 * profile so the concrete claude model aliases / permission modes live here (the
 * shared single-source-of-truth) — never re-inlined in a renderer picker.
 */
export interface ProviderUiSchema {
  /** Model options for `--model` (empty ⇒ provider ignores model selection). */
  models: ProviderUiOption[];
  /** Permission-mode options (empty ⇒ provider takes no `--permission-mode`). */
  permissionModes: ProviderUiOption[];
  /**
   * Sandbox-policy options for codex's `-s` (empty ⇒ provider has no sandbox
   * axis). Codex uses a sandbox + approval pair INSTEAD of claude's single
   * `--permission-mode`, so a codex profile fills these two lists and leaves
   * `permissionModes` empty; claude fills `permissionModes` and leaves these
   * empty. A picker reads whichever list is non-empty. `default` ⇒ "emit no `-s`".
   */
  sandboxes: ProviderUiOption[];
  /** Approval-policy options for codex's `-a` (empty ⇒ no approval axis). `default` ⇒ "emit no `-a`". */
  approvals: ProviderUiOption[];
}

/**
 * Claude's `--model` family aliases (opus/sonnet/haiku) pass straight to
 * `claude --model`, which resolves each to the LATEST model in that family — no
 * pinned version to bump. `default` means "emit no `--model`".
 */
const CLAUDE_MODEL_OPTIONS: readonly ProviderUiOption[] = [
  { id: 'default', label: 'Default' },
  { id: 'opus', label: 'Opus (latest)' },
  { id: 'sonnet', label: 'Sonnet (latest)' },
  { id: 'haiku', label: 'Haiku (latest)' }
];

/**
 * Codex's `-m/--model` options — a compiled-static catalog (Decision D6: no
 * runtime registry fetch; we're serverless). `default` means "emit no `-m`, let
 * codex use its configured default". The concrete ids are codex model slugs
 * accepted by `codex -m <MODEL>`; bump this list as codex ships new models.
 */
const CODEX_MODEL_OPTIONS: readonly ProviderUiOption[] = [
  { id: 'default', label: 'Default' },
  { id: 'gpt-5-codex', label: 'GPT-5 Codex' },
  { id: 'gpt-5', label: 'GPT-5' },
  { id: 'o3', label: 'o3' },
  { id: 'o4-mini', label: 'o4-mini' }
];

/** Claude's `--permission-mode` values. `default` means "emit no flag". */
const CLAUDE_PERMISSION_MODE_OPTIONS: readonly ProviderUiOption[] = [
  { id: 'default', label: 'Default' },
  { id: 'acceptEdits', label: 'Accept edits' },
  { id: 'plan', label: 'Plan' },
  { id: 'bypassPermissions', label: 'Bypass' }
];

/**
 * Codex's `-s/--sandbox` policies. `default` means "emit no `-s`, let codex use
 * its configured sandbox". The concrete ids are codex's own sandbox modes
 * (`codex -s <MODE>`), from least → most permissive.
 */
const CODEX_SANDBOX_OPTIONS: readonly ProviderUiOption[] = [
  { id: 'default', label: 'Default' },
  { id: 'read-only', label: 'Read-Only [Execution State Plan]' },
  { id: 'workspace-write', label: 'Workspace Write [Execution State Interactive/Accept Edits]' },
  { id: 'danger-full-access', label: 'Full Access (danger) [Execution State Autonomous]' }
];

/**
 * Codex's `-a/--ask-for-approval` policies. `default` means "emit no `-a`, let
 * codex use its configured approval policy". Ids are codex's own approval modes
 * (`codex -a <MODE>`), from most → least gated.
 */
const CODEX_APPROVAL_OPTIONS: readonly ProviderUiOption[] = [
  { id: 'default', label: 'Default' },
  { id: 'untrusted', label: 'Untrusted (ask always) [Execution State Interactive]' },
  { id: 'on-request', label: 'On Request [Execution State Plan/Accept Edits]' },
  { id: 'never', label: 'Never Ask [Execution State Autonomous]' }
];

/**
 * Resolve the picker options for a launch profile. The renderer's persona /
 * settings model+permission selectors read THIS instead of a local claude-only
 * list, so adding a provider that understands models/modes is a change here, not
 * in every picker.
 *
 * Mapping, derived from what each provider's flag builders actually emit:
 *  - MODELS: claude family (incl. yolo) → its `--model` aliases; codex family →
 *    its `-m` model catalog (both provider flag builders emit the model flag).
 *    cursor/shell get `[]` (they discard model selection in v1).
 *  - PERMISSION MODES: offered iff {@link ProviderCapabilities.acceptsPermissionMode}
 *    — claude family EXCEPT yolo (which forces skip-permissions). codex uses the
 *    sandbox/approval axis instead of `--permission-mode`, so it gets `[]` here.
 */
export function providerUiSchema(profile: LaunchProfileId): ProviderUiSchema {
  // Derive the four named axes by GROUPING the flat, role-tagged producer
  // (`harnessOptions`) — so the "which profile gets which axis" mapping lives in
  // exactly ONE place (harnessOptions), and this grouped view can't drift from
  // the flat view a generic picker reads. Both are the same data, two shapes.
  const opts = harnessOptions(profile);
  const byRole = (role: HarnessOptionRole): ProviderUiOption[] =>
    opts.filter((o) => o.role === role).map(({ id, label }) => ({ id, label }));
  return {
    models: byRole('model'),
    permissionModes: byRole('permissionMode'),
    sandboxes: byRole('sandbox'),
    approvals: byRole('approval')
  };
}

/**
 * The ROLE of a harness picker option — the provider-agnostic axis a value
 * selects. A generic renderer picker groups a flat {@link HarnessOption}[] by
 * this and renders one control per role present, so adding a provider that
 * introduces a new selectable axis is a change HERE + in {@link harnessOptions},
 * never a new per-axis branch in every picker component.
 *
 *  - `model`          → the CLI's `--model`/`-m` (persona `model`, settings `model`)
 *  - `permissionMode` → claude's `--permission-mode` (persona/settings `permissionMode`)
 *  - `sandbox`        → codex's `-s/--sandbox` (persona/settings `codexSandbox`)
 *  - `approval`       → codex's `-a/--ask-for-approval` (persona/settings `codexApproval`)
 */
export type HarnessOptionRole = 'model' | 'permissionMode' | 'sandbox' | 'approval';

/** A single selectable option, tagged with the axis (role) it belongs to. */
export interface HarnessOption extends ProviderUiOption {
  role: HarnessOptionRole;
}

/** Renderer-facing metadata for a role (picker label + a11y help). */
export interface HarnessOptionRoleMeta {
  role: HarnessOptionRole;
  /** Short control label ("Model", "Permission mode", …). */
  label: string;
}

/**
 * The role catalogue — stable ORDER (model → permission → sandbox → approval)
 * and human labels for a generic picker. A picker iterates this and renders the
 * control for each role that has ≥1 option for the current profile.
 */
export const HARNESS_OPTION_ROLES: readonly HarnessOptionRoleMeta[] = [
  { role: 'model', label: 'Model' },
  { role: 'permissionMode', label: 'Permission mode' },
  { role: 'sandbox', label: 'Sandbox' },
  { role: 'approval', label: 'Approval' }
];

/**
 * FLAT, role-tagged option producer for a launch profile — the single source of
 * truth Phase 4's generic picker reads. Same underlying catalogs as
 * {@link providerUiSchema} (which now GROUPS this output), with the exact
 * "which profile offers which axis" mapping:
 *  - MODEL: codex family → its `-m` catalog; claude family → its `--model`
 *    aliases; cursor/shell → none (they discard model selection in v1).
 *  - PERMISSION MODE: profiles with `acceptsPermissionMode` (claude family
 *    except yolo). Codex uses sandbox+approval instead, so it gets none here.
 *  - SANDBOX + APPROVAL: codex family only (its stand-in for permission mode).
 *
 * An empty result for a role means the provider IGNORES that axis — a picker
 * hides/disables the control rather than offering a value the spawn would drop.
 */
export function harnessOptions(profile: LaunchProfileId): HarnessOption[] {
  const caps = providerCapabilities(profile);
  const isCodex = isCodexProfile(profile);
  const out: HarnessOption[] = [];
  const push = (role: HarnessOptionRole, opts: readonly ProviderUiOption[]) => {
    for (const o of opts) out.push({ role, id: o.id, label: o.label });
  };
  if (isCodex) push('model', CODEX_MODEL_OPTIONS);
  else if (caps.injectsClaudeMcpConfig) push('model', CLAUDE_MODEL_OPTIONS);
  if (caps.acceptsPermissionMode) push('permissionMode', CLAUDE_PERMISSION_MODE_OPTIONS);
  // codex's sandbox+approval axis is the twin of claude's --permission-mode; the
  // codex YOLO variant forces `--dangerously-bypass-approvals-and-sandbox`, which
  // supersedes BOTH, so it offers no sandbox/approval picker (parity with how
  // claude-yolo suppresses permissionMode above).
  if (isCodex && profile !== 'codex-yolo') {
    push('sandbox', CODEX_SANDBOX_OPTIONS);
    push('approval', CODEX_APPROVAL_OPTIONS);
  }
  return out;
}
