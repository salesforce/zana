/**
 * Product vocabulary extracted from the historical `src/shared/types.ts` dump.
 * Named sibling modules re-export slices so callers can import a destination
 * (`./project.js`, `./llm.js`, …) without depending on this catalog file.
 */
import type { TerminalThemeId } from './terminal-themes.js';
import type { WorkflowArgument } from './workflow-args.js';

export type { WorkflowArgument } from './workflow-args.js';
export type { TerminalThemeId } from './terminal-themes.js';
export {
  ABOUT_CREDITS,
  BB_IDE_URL,
  CLAUDE_CODE_URL,
  CODEX_URL,
  CURSOR_URL
} from './about-credits.js';

export type {
  Environment,
  EnvironmentAction,
  GitHostPullRequest,
  SpawnEnvironmentChoice,
  WorkspaceStatus
} from './environment.js';
export type { WorkspaceDiffResponse } from './workspace-diff.js';

export type LaunchProfileId =
  | 'shell'
  | 'claude'
  | 'claude-resume'
  | 'claude-yolo'
  | 'cursor'
  | 'cursor-resume'
  | 'cursor-yolo'
  | 'codex'
  | 'codex-resume'
  | 'codex-yolo'
  | 'pi'
  | 'pi-resume'
  | 'opencode'
  | 'opencode-resume';

/**
 * A verifiable code-harness FAMILY — the coarse grouping the Settings → Code
 * Harness category and the launcher's profile gate reason about (one family can
 * back several `LaunchProfileId`s, e.g. `claude`/`claude-resume`/`claude-yolo`).
 */
export type HarnessFamily = 'claude' | 'cursor' | 'codex' | 'pi' | 'opencode';

/** Why a launch profile was supplied. Only an explicit choice may override a persona pin. */
export type LaunchProfileSource = 'explicit' | 'seeded-default';

/** Canonical one-click launch selection for a project. */
export type ProjectLaunchDefault =
  | {
      schemaVersion: 1;
      kind: 'exact-profile';
      personaId?: string;
      adapterId: HarnessFamily;
      profileId: LaunchProfileId;
      source: string;
    }
  | { schemaVersion: 1; kind: 'use-global'; personaId?: string; source: string }
  | {
      schemaVersion: 1;
      kind: 'persona-pin';
      personaId: string;
      adapterId: HarnessFamily;
      profileId: LaunchProfileId;
      source: string;
    };

/**
 * The result of probing one code-harness family (see `harness-verify.ts`). It
 * carries the two orthogonal axes the launcher gates on — `enabled` (the user's
 * persisted intent) and `installed` (the machine reality from `<binary>
 * --version`) — plus the resolved binary and a version string for display.
 */
export interface HarnessVerifyResult {
  family: HarnessFamily;
  /** Human label ("Claude Code", "Cursor", …). */
  label: string;
  /** The binary that was probed (config override resolved by the provider). */
  binary: string;
  /** User intent: the persisted enable flag (always true for `alwaysEnabled`). */
  enabled: boolean;
  /** True for the default harness (Claude Code) — verify-only, no enable toggle. */
  alwaysEnabled: boolean;
  /** Machine reality: `<binary> --version` exited 0. */
  installed: boolean;
  /** Trimmed `--version` output when installed. */
  version?: string;
  /** Exact normalized numeric CLI version, when the output contains one. */
  normalizedVersion?: string;
  /** Where to get the CLI — a convenience hint for the Settings card. */
  installHint: string;
}

/** Renderer-safe effective default for a registered project. Main resolves and
 * verifies this value; it is advisory display state, never launch authority. */
export type EffectiveHarnessDefaultResult =
  | {
      ok: true;
      profile: LaunchProfileId;
      family: HarnessFamily;
      source: 'persona-pin' | 'project-canonical' | 'project-legacy' | 'global-default' | 'adapter-compatibility';
    }
  | {
      ok: false;
      code: 'NOT_FOUND' | 'UNAVAILABLE_DEFAULT';
      message: string;
    };

export interface TmuxVerifyResult {
  installed: boolean;
  version?: string;
  installHint: string;
}

export interface TmuxRestoreCandidate {
  capabilityId: string;
  projectId: string;
}

/**
 * External editors an opener button can target (a subset of {@link OpenTarget} —
 * the GUI editors that have a detectable CLI shim). Used by the Settings →
 * Editor install-status row.
 */
export type EditorTarget = 'cursor' | 'code' | 'intellij';

/**
 * The result of probing one external editor's launch shim (see
 * `editor-verify.ts`), mirroring {@link HarnessVerifyResult} but for the
 * `OpenerButtons` editors. `installed` is `<binary> --version` exiting 0.
 */
export interface EditorVerifyResult {
  target: EditorTarget;
  /** Human label ("Cursor", "VS Code", "IntelliJ IDEA"). */
  label: string;
  /** The CLI shim that was probed (config override resolved, else the default). */
  binary: string;
  /** Machine reality: `<binary> --version` exited 0. */
  installed: boolean;
  /** Trimmed `--version` output when installed. */
  version?: string;
  /** Where/how to get the editor's CLI — a convenience hint for the Settings card. */
  installHint: string;
}

/**
 * Provenance of a {@link Persona} or {@link Team} — where the loader/host
 * discovered it. Stamped by the loader (disk) or the host (extension), NEVER
 * trusted from the renderer or an extension's self-declaration:
 *  - `'builtin'` — shipped in the app catalogue.
 *  - `'user'` — a hand-edited file under `~/.zcc/...`.
 *  - `{ projectId }` — a file under `<project>/.zcc/...`.
 *  - `{ extensionId }` — an in-memory registration contributed by an extension.
 *    The host stamps `extensionId` from the AUTHENTICATED calling module id
 *    (`mod.id` / `state.moduleId`), never a literal in core logic (Rule 6). The
 *    `{ extensionId }` variant is structurally distinct from `{ projectId }`, so
 *    the renderer narrows with `'extensionId' in source`.
 */
export type PersonaSource =
  | 'builtin'
  | 'user'
  | { projectId: string; projectName?: string }
  | { extensionId: string; extensionTitle?: string };

/**
 * User-facing label for the built-in scratch workspace. The on-disk folder
 * and project tag stay `zcc-workspace` (the API / handle name).
 */
export const DEFAULT_WORKSPACE_DISPLAY_NAME = 'Default Workspace';

export interface Project {
  id: string;
  name: string;
  path: string;
  color?: string;
  createdAt: number;
  lastActiveAt: number;
  sortIndex?: number;
  /**
   * Stable, regex-validated handle for the project (URL-safe slug).
   * Pattern: ^[a-z0-9][a-z0-9_-]{0,32}$
   * Backfilled from `name` on first touch when absent.
   */
  tag?: string;
  /**
   * Ordered list of `LaunchProfileId` values. The first entry is used as
   * the default for one-click "+" terminal creation.
   */
  defaultAgents?: string[];
  /**
   * Ordered list of persona ids this project surfaces in the "+" picker. The
   * first entry, if present, is the one-click default (parallels how
   * `defaultAgents[0]` selects the default profile). Resolved against the
   * persona store at spawn time; an id that no longer resolves is ignored.
   */
  defaultPersonas?: string[];
  /** Canonical project launch selection. Legacy default arrays are projected only while absent. */
  launchDefault?: ProjectLaunchDefault;
  /** Reserved for future templates work; no logic yet. */
  template?: string;
  /**
   * Free-form grouping label for the Projects rail. When set, the project is
   * pulled into its own named section (above Remote/Local) instead of the
   * default Local/Remote split. Currently only `'Extensions'` is minted by the
   * app (the per-extension projects the "create your own extension" flow spawns),
   * but the field is deliberately open so future groupings need no schema change.
   */
  category?: string;
  /**
   * Enrolled host-daemon that owns this checkout. Absent means the primary
   * (this-machine) host. Distinct from {@link remote} SSH projects.
   */
  hostId?: string;
  /**
   * Pinned to the top of the Projects rail (above the Remote/Local groups),
   * in a dedicated "Favorites" section. Toggled from the project context menu.
   */
  favorite?: boolean;
  /**
   * True for the single built-in scratch project that backs the Agents-module
   * Quick Agent. Rooted at `~/zcc-workspace`, created on first launch. Lets the
   * UI treat it specially (e.g. surface it in the Agents launcher, optionally
   * hide it from the Projects sidebar later).
   */
  quickAgent?: boolean;
  /** Reserved for future lineage / upgrade-hint work; no logic yet. */
  spawnedFromVersion?: string;
  /**
   * If present, this Project's terminals are opened as SSH sessions to the
   * named host instead of local processes. Absent = local Project.
   */
  remote?: ProjectRemote;
}

export interface ProjectRemote {
  /** Host alias as it appears in ~/.ssh/config (e.g. "my-devbox"). */
  host: string;
  /** Optional override; otherwise ssh resolves it from ~/.ssh/config. */
  user?: string;
  /** Optional override path to start in. Otherwise the remote $HOME. */
  remotePath?: string;
  /**
   * Optional bastion / jump host, threaded into ssh as `-J <proxyJump>` for
   * every connection to this remote (interactive spawn AND the remote-fs /
   * remote-exec ops). Its most important effect is on the reverse tunnel: an
   * `ssh -R` forward on a bastion hop terminates on the FINAL host only when the
   * jump is expressed to the local ssh (`-J`) rather than left implicit — so a
   * missing/incorrect value is why remote hooks/MCP silently stop across a
   * bastion. Value is an ssh `-J` spec (`[user@]host[:port][,next…]`). Usually
   * left unset when `~/.ssh/config` already carries a `ProxyJump` for the host
   * (ssh applies it transparently); set explicitly when the config doesn't, or
   * to override it. Rejected if it starts with `-` (would read as an ssh flag).
   */
  proxyJump?: string;
}

/**
 * A SMALL, stable projection of a {@link Project} — the non-sensitive metadata
 * an agent needs to identify a project and scope work to it (over the MCP
 * `list_projects` tool / control-plane `project.list`), without exposing the
 * full store record (sort index, default-agent lists, lineage hints, …).
 */
export interface ProjectSummary {
  id: string;
  name: string;
  /** Local root, or the remote start path for a remote (SSH) project. */
  path: string;
  /** URL-safe slug handle (e.g. for `zcc run <tag>`); absent on legacy rows. */
  tag?: string;
  /** Present only for a remote (SSH) project — tells it apart from a local folder. */
  remote?: ProjectRemote;
  /** True for the built-in scratch project that backs the Quick Agent. */
  quickAgent?: boolean;
}

/** Project a full {@link Project} down to its non-sensitive {@link ProjectSummary}. */
export function toProjectSummary(p: Project): ProjectSummary {
  const summary: ProjectSummary = { id: p.id, name: p.name, path: p.path };
  if (p.tag) summary.tag = p.tag;
  if (p.remote) summary.remote = p.remote;
  if (p.quickAgent) summary.quickAgent = true;
  return summary;
}

export interface SshHostEntry {
  /** Host alias as it appears in ~/.ssh/config. */
  alias: string;
  /** Explicit HostName line, if present. */
  hostname?: string;
  /** Explicit User line, if present. */
  user?: string;
  /** Explicit ProxyJump line, if present — used to prefill the bastion field. */
  proxyJump?: string;
}

/** Result of refreshing hosts from the user's SSH configuration. */
export interface SshSyncResult {
  /** Hosts parsed from ~/.ssh/config after the sync attempt. */
  hosts: SshHostEntry[];
  /** Non-fatal warning emitted by an optional host provider. */
  warning?: string;
}

/** Pointer to a project file. Rendered live at view time, never snapshotted. */
export interface InboxDoc {
  /** Path relative to the project root. */
  path: string;
}

/**
 * How loudly a schedule's inbox entries should surface.
 *  - `silent` — runs are not recorded in the inbox at all.
 *  - `quiet`  — recorded, but collapsed into the per-project "Scheduled"
 *               group and excluded from the unread badge (the default — keeps
 *               recurring jobs from nagging).
 *  - `loud`   — surfaced as a normal entry and counted in the unread badge.
 */
export type InboxNotifyLevel = 'silent' | 'quiet' | 'loud';

/** One choosable answer in an {@link InboxQuestion}. */
export interface InboxQuestionOption {
  /**
   * Stable letter label assigned host-side at write time (`A`, `B`, `C`, …) —
   * never agent-supplied, so the ordering the user sees is deterministic and
   * the agent can't collide two options on the same key. The renderer shows it
   * as the leading badge; the injected answer uses the option's {@link label}.
   */
  id: string;
  /** The option text shown to the user (and injected verbatim when chosen). */
  label: string;
}

/**
 * A structured multiple-choice question form on an inbox entry — the Cursor-IDE
 * "Questions" panel: lettered options, an optional free-text "Other…" row, and
 * Skip / Continue. The **prompt itself lives in the entry's `comments`** (so the
 * sidebar preview, search, AI-summary, and PDF export all pick it up with zero
 * extra plumbing); this object carries only the *answer form* — the options and
 * how they may be picked.
 *
 * The write-half of the loop is the same one that backs the free-text ReplyBox:
 * when the user hits Continue, the chosen option label(s) (or the Other text)
 * are injected into the originating session's pty via `terminals.reply`, so an
 * agent that asked via `inbox_ask` and blocked for input gets the answer as if
 * it were typed at its prompt. Only present when an agent used `inbox_ask`.
 */
export interface InboxQuestion {
  /**
   * Per-question prompt line, shown as a small heading above this question's
   * options. Only meaningful when an entry carries MULTIPLE questions (see
   * {@link InboxEntry.questions}) — with several forms stacked in one card, each
   * needs its own label to be answerable. For a lone question the prompt lives
   * in the entry's `comments` (rendered above the whole card), so this stays
   * absent and no per-question heading is drawn.
   */
  prompt?: string;
  /** The choosable options, in display order. Host-assigns each `id` letter. */
  options: InboxQuestionOption[];
  /**
   * When true, render a final free-text "Other…" row so the user can answer
   * outside the offered options. Absent/false ⇒ the offered options are the
   * only answers (besides Skip).
   */
  allowOther?: boolean;
  /**
   * When true, options are checkboxes (pick any number, joined on Continue);
   * absent/false ⇒ radio (exactly one).
   */
  multiSelect?: boolean;
  /**
   * Whether the agent is BLOCKED on this answer (cannot proceed without it) vs.
   * merely offering an optional/soft follow-up ("want me to open a PR?"). Only a
   * blocking question earns a spot in the pinned "NEEDS YOUR ANSWER" band — a
   * non-blocking one still renders inline and stays answerable, it just doesn't
   * demand attention. Host-defaulted at the tool layer: `inbox_ask` (a genuine
   * "I'm stuck, pick A/B") defaults true; `inbox_push` with options (a report
   * plus a soft follow-up) defaults false. Either tool may set it explicitly.
   */
  blocking?: boolean;
}

/**
 * Resume/reopen coordinates for an inbox entry's originating agent, captured at
 * push time from the live pty. This is what lets the inbox reopen an agent's
 * work AFTER its tab is gone: `claudeSessionId` resumes the exact conversation
 * (`claude --resume <id>`), and `profile`/`personaId`/`cwd` reconstruct the
 * launch. All fields are host-resolved, never agent-supplied (Rule 1).
 */
export interface InboxOrigin {
  /**
   * The originating agent's Claude transcript id. When present, the entry is
   * resumable — reopening spawns `claude --resume <claudeSessionId>` and gets
   * the full prior conversation back. Absent ⇒ not resumable (a fresh, seeded
   * agent is spawned instead).
   */
  claudeSessionId?: string;
  /** Launch profile of the originating session (claude / claude-yolo / …). */
  profile?: LaunchProfileId;
  /** Persona the session was launched as, if any — re-applied on reopen. */
  personaId?: string;
  /**
   * The originating session's working directory. Re-confined to the project on
   * reopen (createTerminalConfined realpath-checks it), so a stale/escaped cwd
   * silently falls back to the project root — never a trust anchor by itself.
   */
  cwd?: string;
  /**
   * Human-readable label of the originating agent's task, snapshotted from the
   * live pty session's title at push time (the OSC/LLM auto-title). Display-only:
   * it lets the inbox row and detail header name the task even after the session
   * dies. Absent when no meaningful title was set or the session is unknown.
   */
  title?: string;
}

/**
 * A concrete "next step" action a suggestion can carry. `open-view`/`navigate`
 * are combo-tail only (rejected as a standalone top-level suggestion; permitted
 * only as the trailing step of a `combo`).
 */
export type SuggestedActionKind =
  | { kind: 'start-terminal'; profile?: string; cwd?: string }
  | { kind: 'start-agent'; persona?: string; prompt?: string }
  | { kind: 'open-view'; nav: string }
  | { kind: 'navigate'; projectId: string; tabId?: string }
  | { kind: 'combo'; steps: SuggestedActionKind[] };

/** Top-level action kinds that carry a real payload — the only kinds allowed as
 *  a STANDALONE suggestion. `open-view`/`navigate` are combo-tail only. */
export const STANDALONE_SUGGESTION_KINDS = ['start-terminal', 'start-agent', 'combo'] as const;

export interface SuggestionInput {
  projectId: string;
  /** Display snapshot of the project label. Optional; readers fall back to projectId. */
  projectLabel?: string;
  title: string;
  /**
   * REQUIRED one-line "why now" — the rationale the operator reads to decide
   * whether to run. Distinct from the optional `detail` (longer body copy).
   */
  reason: string;
  detail?: string;
  action: SuggestedActionKind;
  /** Originating terminal session, when known. Persisted as-is. */
  sessionId?: string;
  /** Resume/reopen coordinates for the originating agent — reuses the inbox origin type. */
  origin?: InboxOrigin;
  /** Coalescing key — folds into the most-recent live entry sharing `(projectId, dedupeKey)`. */
  dedupeKey?: string;
  /** ms epoch after which the suggestion is stale; read-time filtered (never surfaced). */
  expiresAt?: number;
}

export interface Suggestion extends SuggestionInput {
  id: string;
  ts: number;
  /** How many times this entry was written/refreshed under its {@link SuggestionInput.dedupeKey}. */
  occurrences?: number;
}

export interface InboxEntry {
  id: string;
  ts: number;
  projectId: string;
  /** Display snapshot of the project label. Optional; readers fall back to projectId. */
  projectLabel?: string;
  /** Project files to render. Each entry is a pointer — content is fetched live at view time. */
  docs?: InboxDoc[];
  /** Agent's message body (markdown). Renders below docs. */
  comments?: string;
  /**
   * OPTIONAL author-set one-line heading for this entry — a short "subject"
   * describing what it's about. Display-only and PREFERRED over `origin.title`
   * and the comment/doc preview in the sidebar row heading and the detail-pane
   * title (fallback chain: `subject → origin.title → comment/doc preview`).
   * Plain text — trimmed and length-capped at write time. Absent for legacy
   * entries and pushes that omit it.
   */
  subject?: string;
  /**
   * OPTIONAL author-set one-line CONTEXT — the "why"/goal the agent (or user)
   * was pursuing when this entry was created ("what I was trying to achieve").
   * Distinct from `subject` (WHAT this is) and `comments` (the body). Display-
   * only: the inbox shows it as a "Context" line on the detail pane and beside
   * pinned questions so the user can triage a message without opening it. When
   * absent, readers fall back to `origin.title` (the session's task title), so
   * every entry still carries some context. Plain text — trimmed and length-
   * capped at write time. Absent for legacy entries and pushes that omit it.
   */
  intent?: string;
  /**
   * OPTIONAL author-set flag marking this entry as a REPORT — a finished
   * deliverable/analysis the user should be able to find fast (an RCA, an audit,
   * a design writeup), as opposed to a routine status check-in. Set by the agent
   * via `inbox_push({ report: true })`; the app surfaces flagged entries with a
   * "Report" badge, a dedicated Reports tab, and a list-pane Reports filter.
   *
   * This is an EXPLICIT opt-in signal, distinct from the `report` FEED CATEGORY
   * in `feedCategories.ts` (which is the un-classified *fallback* — every plain
   * push lands there). A `report: true` entry is always a feed-category `report`
   * too, but not every feed-category `report` carries this flag. The flag is what
   * `isReport()` reads to power the report-only surfaces. Absent/false ⇒ a normal
   * entry (still surfaced inline, just not badged or in the Reports tab).
   */
  report?: boolean;
  /**
   * Originating terminal session, when the creation path knows it. Set by
   * the scheduler when a notify-on-exit run completes. Absent for legacy
   * entries on disk and for paths that don't track session identity —
   * readers must treat undefined as "no preferred tab; fall back to the
   * project's last active tab."
   */
  sessionId?: string;
  /**
   * Enough about the originating agent to REOPEN its work when the live
   * {@link sessionId} pty is gone (the common case — the agent pushed, then its
   * tab was closed). Resolved server-side from the live pty at push time (never
   * trusted from the agent) and persisted, so the inbox "Open" action can
   * `--resume` the exact conversation, or — for legacy/non-resumable entries —
   * spawn a fresh agent seeded with this report. Absent for entries pushed
   * before this field existed and for non-claude sessions (nothing to resume).
   * See {@link InboxOrigin}.
   */
  origin?: InboxOrigin;
  /**
   * True when the originating session was a scheduled (background) run.
   * Stamped at write time — the originating session is often dead by the
   * time the renderer reads the entry, so this can't be inferred client-side.
   * The sidebar collapses scheduled entries into a single group so recurring
   * jobs don't flood the per-project list.
   */
  scheduled?: boolean;
  /**
   * Loudness of a scheduled entry, copied from the owning schedule at write
   * time (`silent` entries are never written, so only `quiet`/`loud` appear on
   * disk). Absent on non-scheduled (manual / agent-on-a-real-tab) entries,
   * which are always treated as loud. The renderer reads this to decide badge
   * counting and whether the entry shows inline or in the collapsed group —
   * it can't be re-derived client-side once the originating session is gone,
   * same rationale as {@link scheduled}.
   */
  notify?: InboxNotifyLevel;
  /**
   * Coalescing key. When a push carries a `dedupeKey`, the store folds it into
   * the most-recent live entry sharing the same `(projectId, dedupeKey)` instead
   * of appending a new row: the existing entry's `ts`/`docs`/`comments` are
   * refreshed in place and {@link occurrences} is incremented. This is what
   * keeps a chatty recurring producer (a 5-min schedule, a heartbeat that keeps
   * tripping its cap) to ONE self-refreshing row rather than hundreds.
   *
   * Set by recurring producers (scheduler run-complete notices, heartbeat
   * pause notices); absent on manual agent `inbox_push` calls, which are always
   * distinct. Stamped at write time and persisted so coalescing survives a
   * restart (the store re-derives the latest-per-key from disk).
   */
  dedupeKey?: string;
  /**
   * How many times this entry has been written/refreshed under its
   * {@link dedupeKey}. Absent or 1 for a normal single push; >1 after the store
   * has coalesced repeats into it. The sidebar surfaces it as a "×N" badge so
   * the user can see a row stands for many occurrences without it flooding the
   * list. Only meaningful alongside `dedupeKey`.
   */
  occurrences?: number;
  /**
   * Structured multiple-choice question form — set only when an agent used the
   * `inbox_ask` tool with a SINGLE question. Renders the Cursor-style options +
   * Skip/Continue in the detail pane; the chosen answer is injected back into
   * {@link sessionId}'s pty (same channel as the free-text ReplyBox). The
   * question text lives in {@link comments}; this holds only the answer options.
   * Mutually exclusive with {@link questions}. See {@link InboxQuestion}.
   */
  question?: InboxQuestion;
  /**
   * Multiple structured questions asked together in ONE inbox entry — set when
   * an agent used `inbox_ask` with a `questions` array. Each carries its own
   * `prompt` heading + options; the detail pane stacks them in one card and
   * Continue is enabled only once every question is answered. The combined
   * answers are injected back into {@link sessionId}'s pty as one reply (one
   * "Q: …\nA: …" block per question). The card's shared preamble (if any) lives
   * in {@link comments}. Mutually exclusive with {@link question}; when both are
   * somehow present, readers prefer `questions`.
   */
  questions?: InboxQuestion[];
  /**
   * Host-stamped provenance for an entry pushed by a sandboxed disk extension's
   * MAIN-process `ctx.inbox.push` (Phase B, brokered path). `extensionId` is the
   * AUTHENTICATED module id bound to the child's port — never a payload value
   * (Rule 1), mirroring `PersonaTeamRegistry`'s `source: { extensionId }` stamp.
   * Absent for agent (`inbox_push`/`inbox_ask` MCP tools) and renderer-panel
   * (`window.cc.modules.pushInbox`) origins — the panel path's `moduleId` is only
   * a best-effort CLAIM, never authenticated, so it is deliberately left
   * unstamped rather than recorded as if verified.
   */
  extensionSource?: { extensionId: string };
  /**
   * OPTIONAL click-navigation redirect, set only by an extension's brokered
   * `ctx.inbox.push` (never the agent MCP tools or the renderer-panel path) and
   * only alongside {@link extensionSource} — see `inbox-broker.ts`'s
   * `pushInboxOnBehalfOf`, which rejects a `target` without an authenticated
   * origin and enforces `target.moduleId === extensionSource.extensionId` (an
   * extension may redirect to its OWN surface, never a sibling's).
   *
   * Consumed at CLICK time (native OS notification, or a `NotificationsDrawer`
   * row), never trusted blindly (Rule 1): the renderer re-resolves `moduleId`
   * against the LIVE merged module registry and falls back to the plain Inbox
   * entry landing if the module is gone, disabled, or has no project-tab
   * surface to land on by then.
   */
  target?: { moduleId: string };
}

/**
 * Normalize an entry's question shape to a flat list, so readers don't each
 * re-implement the `questions ?? [question]` fallback. Returns the multi-form
 * `questions` when present, else wraps a lone `question`, else empty. `questions`
 * wins if both are somehow set (matches the {@link InboxEntry.questions} doc).
 */
export function inboxQuestions(
  entry: Pick<InboxEntry, 'question' | 'questions'>
): InboxQuestion[] {
  if (entry.questions && entry.questions.length > 0) return entry.questions;
  if (entry.question) return [entry.question];
  return [];
}

/**
 * True when an entry carries at least one BLOCKING question (the agent can't
 * proceed without an answer). This is the gate for the pinned "NEEDS YOUR
 * ANSWER" band: a non-blocking (soft/optional) question still renders inline and
 * is answerable, but does not demand a pinned slot. An entry with no questions,
 * or only non-blocking ones, returns false.
 */
export function hasBlockingQuestion(
  entry: Pick<InboxEntry, 'question' | 'questions'>
): boolean {
  return inboxQuestions(entry).some((q) => q.blocking === true);
}

/** Structured AI digest of the inbox — backs the "AI Summary" card. */
export interface InboxDigest {
  /** One-line gist of the period. */
  headline: string;
  /** Up to 5 "what got done" bullets. */
  done: string[];
  /** Up to 5 "needs your attention" bullets; empty when nothing is pending. */
  attention: string[];
}

/** Result of an inbox-summary call (the `inbox:summarize` IPC). */
export type InboxSummaryResult =
  | { ok: true; digest: InboxDigest; entryCount: number }
  | { ok: false; reason: 'empty' | 'summary-failed' };

/**
 * One actionable point in a {@link DetailedInboxDigest} section. The modal renders
 * these as bullets; a point with a `projectId` (resolved + validated in main from
 * the model's project-name mention) and a `suggestedPrompt` gets a "Spawn agent"
 * affordance that opens a fresh agent in that project seeded with the prompt.
 */
export interface DetailedInboxPoint {
  /** The bullet text. */
  text: string;
  /** Semantic bucket, drives the icon/color. */
  kind: 'done' | 'attention' | 'question';
  /**
   * Project this point can be actioned in — a VALIDATED project id (main resolved
   * it from the model's project-name mention against the live project list, or
   * forced it to the scope when the summary is project-scoped). Absent ⇒ the point
   * is informational only and gets no spawn affordance. Never a raw model string.
   */
  projectId?: string;
  /** Seed prompt for the spawned agent. Only meaningful alongside `projectId`. */
  suggestedPrompt?: string;
}

/** A themed section of the detailed digest (e.g. one project, or a cross-cutting theme). */
export interface DetailedInboxSection {
  /** Short section heading. */
  title: string;
  /** The section's points, in reading order. */
  points: DetailedInboxPoint[];
}

/** Rich, sectioned inbox digest — backs the "expand" modal on the AI Summary card. */
export interface DetailedInboxDigest {
  /** One-line gist of the period (same role as {@link InboxDigest.headline}). */
  headline: string;
  /** Themed sections, each with actionable points. */
  sections: DetailedInboxSection[];
}

/** Result of a detailed-inbox-summary call (the `inbox:summarizeDetailed` IPC). */
export type DetailedInboxSummaryResult =
  | { ok: true; digest: DetailedInboxDigest; entryCount: number }
  | { ok: false; reason: 'empty' | 'summary-failed' };

/**
 * Result of the OPTIONAL feed-noise classifier (the `inbox:classifyNoise` IPC):
 * the ids of free-form reports main judged ROUTINE and safe to fold into the
 * collapsed "Routine" section. Always an id set (empty on any failure or when
 * nothing is routine) — the renderer applies it as an advisory overlay to the
 * inbox grouping and never persists it. See `feed-noise-classifier.ts`.
 */
export interface FeedNoiseResult {
  routineIds: string[];
  /** How many entries were considered (comment-only reports after the gate). */
  candidateCount: number;
}

/** A frozen snapshot of an inbox doc, captured at save time. */
export interface SavedDoc {
  /** Original path relative to the project root (for reference/search). */
  path: string;
  /** File content at save time. Absent if it couldn't be read. */
  content?: string;
  /** True if content was truncated by the fs read cap (mirrors FsReadResult). */
  truncated?: boolean;
  /** True if the file was binary and not snapshotted. */
  binary?: boolean;
  /** Set when the snapshot read failed (project tombstoned, missing file). */
  error?: string;
}

/**
 * A saved inbox report — a durable, frozen copy of an inbox entry's docs +
 * comments, kept for later reuse. Persisted GLOBAL-only, one JSON file per
 * record at `~/.zcc/saved/<id>.json`. Doc contents are SNAPSHOTTED at
 * save time (unlike live inbox docs) so the record survives project file
 * changes / moves / deletion. The bundled `saved-reports` skill reads these
 * files directly. Each record carries `projectId` so it can be filtered.
 */
export interface SavedRecord {
  id: string;
  savedAt: number;
  /** Originating inbox entry id, when known. */
  sourceEntryId?: string;
  projectId: string;
  /** Display snapshot of the project label; readers fall back to projectId. */
  projectLabel?: string;
  /** Short title derived from the first comment line or first doc path. */
  title: string;
  comments?: string;
  docs?: SavedDoc[];
  tags?: string[];
}

/** Library document types. */
export type LibraryDocKind = 'md' | 'pdf' | 'image' | 'code' | 'other';
export type LibraryScope = 'project' | 'global';

export interface LibraryDoc {
  id: string;
  relPath: string;            // posix, relative to its library dir
  title: string;
  summary?: string;
  tags?: string[];
  kind: LibraryDocKind;       // derived from ext
  createdAt: number;
  updatedAt: number;
  bytes?: number;
  source?: {
    kind: 'agent' | 'user' | 'schedule' | 'inbox';
    sessionId?: string;
    scheduleId?: string;
    projectId?: string;
  };
  // stamped at list() time, not persisted:
  scope?: LibraryScope;
  absPath?: string;
  projectId?: string;         // owning project (for 'project' scope)
  projectName?: string;
}

export interface LibraryManifest {
  version: 1;
  docs: LibraryDoc[];
}

/**
 * A single body-content match from a full-text library search. `absPath` keys
 * back to the {@link LibraryDoc.absPath} stamped by `list()`, so the renderer
 * can merge these into the doc set and show `preview` as snippet context.
 */
export interface LibrarySearchHit {
  absPath: string;
  scope?: LibraryScope;
  line: number;      // 1-indexed line of the first match in the doc body
  preview: string;   // the matched line, trimmed + truncated
}

export interface LibrarySearchResult {
  hits: LibrarySearchHit[];
  truncated: boolean; // true if the scan hit its file cap before finishing
}

export interface LibraryAddInput {
  scope: LibraryScope;
  projectId?: string;         // required when scope==='project'
  relPath: string;
  title: string;
  content?: string;           // text write; omit if file already on disk
  tags?: string[];
  summary?: string;
  source?: LibraryDoc['source'];
}

/** Input to SavedStore.save — the record minus the store-assigned id/savedAt. */
export interface SavedRecordInput {
  sourceEntryId?: string;
  projectId: string;
  projectLabel?: string;
  title: string;
  comments?: string;
  docs?: SavedDoc[];
  tags?: string[];
}

/**
 * Live agent state for a session, inferred from detection signals (OSC title
 * spinner, screen-scan, lifecycle hooks). Deliberately separate from
 * {@link TerminalSession.status}, which tracks the pty *process* lifecycle
 * (starting/running/exited) — `AgentState` tracks what the *agent inside* the
 * pty is doing. The two are orthogonal: a `running` pty can be `idle`, and a
 * just-`exited` pty has no agent state at all.
 *
 *  - `working` — agent is actively producing output / running a tool.
 *  - `blocked` — agent is waiting on the user (permission prompt, question).
 *  - `done`    — agent finished its turn but the user hasn't looked yet.
 *  - `idle`    — at the prompt, nothing pending, and the user has seen it.
 *  - `unknown` — plain shell, or no detector has a confident read yet.
 *
 * See `docs/live-agent-status-plan.md`. State lives in a dedicated main-side
 * store and streams over the `onAgentStatus` IPC channel — NOT on this object
 * — so status ticks don't rebuild the `terminals` map (render-storm guard).
 */
export type AgentState = 'working' | 'blocked' | 'done' | 'idle' | 'unknown';

/**
 * Why an agent (or an Agent-tool subagent) reached its terminal / idle state —
 * the STRUCTURED exit signal that turns a bare `idle_notification` into an
 * actionable completion event. This is the fix for "silent agent failure: no
 * error channel when subagents produce no output": a consumer no longer just
 * sees "the agent went idle", it sees WHY and WHETHER it did anything.
 *
 * The five values are the zana-core lifecycle terminal reasons
 * (`packages/core/src/agents/lifecycle.ts` / `packages/work/src/runs/tracker.ts`
 * emit `completed`/`errored`/`killed` on `AGENT_TERMINATED`, plus the idle-
 * timeout reap and permission-prompt denial) collapsed onto the five the UI /
 * peers act on:
 *  - `success`           — finished a turn cleanly.
 *  - `error`             — exited nonzero / a tool error was the last thing seen.
 *  - `timeout`           — reaped after the inactivity threshold with no output.
 *  - `permission_denied` — a permission prompt was denied / never answered.
 *  - `killed`            — torn down by a user / operator (SIGTERM/SIGKILL).
 */
export type AgentExitReason =
  | 'success'
  | 'error'
  | 'timeout'
  | 'permission_denied'
  | 'killed';

/**
 * The structured exit state captured for a session when its agent (or an
 * Agent-tool subagent) finishes a turn. This is an ADDITIVE overlay surfaced on
 * its own `exit` event (see {@link AgentStatusTracker}) and via the
 * `agent_status` MCP tool — it NEVER replaces the existing {@link AgentState}
 * status stream, so existing `idle_notification` consumers keep working
 * unchanged.
 *
 * The load-bearing signal is `outputProduced === false && toolCallCount === 0`
 * on an otherwise-`success` exit: that is the previously-silent failure — an
 * agent that finished having done nothing — now made observable.
 */
export interface AgentExitState {
  /** Coarse terminal reason — the headline signal. */
  exitReason: AgentExitReason;
  /** The final tool error / permission denial text seen before idle, if any. */
  lastError?: string;
  /** Whether the agent produced ANY output (tool call / assistant work). */
  outputProduced: boolean;
  /** How many tool calls the agent made during this life. */
  toolCallCount: number;
}

/**
 * Replay result from {@link AgentStatusTracker.since}: either a replay of
 * transition events after `sinceSeq` (when no buffer gap), or a snapshot fallback
 * (when the cursor is too old / bogus and the ring overflowed past it).
 */
export type AgentStatusReplay =
  | {
      mode: 'replay';
      /** Transitions after `sinceSeq`, as `[seq, sessionId, state]` tuples. */
      events: Array<[number, string, AgentState]>;
      /** The current head seq (the last-emitted seq, or 0 when empty). */
      headSeq: number;
    }
  | {
      mode: 'snapshot';
      /** Full current state as `[sessionId, state]` pairs (same as `snapshot()`). */
      snapshot: Array<[string, AgentState]>;
      /** The current head seq. */
      headSeq: number;
    };

/**
 * The idle-triage add-on's read of WHY an agent is idle — the distinction the
 * OSC `✳` glyph can't make on its own (it looks identical in all three cases).
 * Produced by the `builtin:idle-triage` LLM micro-call over the session's last
 * assistant turn; off by default because it spends tokens.
 *
 *  - `awaiting-reply` — the agent asked a question / needs a decision from you.
 *  - `done`           — the task finished, nothing pending, safe to close.
 *  - `paused`         — stopped between steps, mid-task, not blocked on you.
 *  - `unknown`        — the classifier had no confident read (or no transcript).
 */
export type IdleResolution = 'awaiting-reply' | 'done' | 'paused' | 'unknown';

/**
 * One idle-triage classification for a session, streamed to the renderer over
 * the dedicated {@link onIdleTriage} channel (kept off `onAgentStatus` so it
 * can't rebuild the status slice). Lives in its own renderer store, attached to
 * the agent card only while the agent is idle — cleared the moment it leaves
 * idle (the read is about a specific idle spell).
 */
export interface IdleTriageResult {
  sessionId: string;
  resolution: IdleResolution;
  /** One-line gloss of what it's waiting for / what it finished (≤80 chars). */
  summary: string;
  /**
   * A short (≤400 chars) body expanding on {@link summary}: what the agent did,
   * the concrete decision/input it needs, and any options it offered. Feeds a
   * parked follow-up's `detail` so it isn't reduced to a bare one-liner. Absent
   * when the model returns nothing usable.
   */
  detail?: string;
  /**
   * Concrete answer choices the agent offered, inferred from its last message
   * (host-capped: ≤6 labels, each ≤60 chars; absent/empty when it offered none
   * or the model returned nothing usable). Feeds a parked follow-up's flat
   * `options` (see {@link FollowUp.options}) so an `awaiting-reply` verdict shows
   * the lettered picker instead of a free-text box. NOTE this is the flat
   * `string[]` shape — a picked option RESOLVES the follow-up record; it is NOT
   * the richer {@link InboxQuestion.options} (which INJECTS into a live pty), and
   * the two are deliberately kept distinct. Inferred from prose, so it drives a
   * record-resolution picker only — never a live-agent injection.
   */
  options?: string[];
  /** Model self-reported confidence 0–1, clamped; absent if unparsable. */
  confidence?: number;
  /** When the classification was produced (epoch ms). */
  at: number;
}

/**
 * A catch-up summary card result (the catch-up-summary add-on; off by default).
 * Emitted once per idle/blocked spell, after the configured dwell, when the
 * add-on is enabled. Contains a tight markdown catch-up: one-line headline +
 * up to ~4 bullets of "where are we / what changed". When the trigger is
 * 'blocked' (keyboard-choice / permission-prompt), the text SHOULD include a
 * recommended option + one-line why (the builtin prompt requests this).
 */
export interface CatchUpSummaryResult {
  sessionId: string;
  projectId: string;
  /** Success or failure. Only when `ok: true` is `text` guaranteed to be usable. */
  ok: boolean;
  /** The generated markdown summary text (empty string on failure). */
  text: string;
  /** Error message when `ok: false`; absent otherwise. */
  error?: string;
  /** The model used (e.g. 'haiku'), or undefined on failure. */
  model?: string;
  /** How long the LLM call took (ms); 0 on failure before spawn. */
  ms: number;
  /** When this summary was generated (epoch ms). */
  generatedAt: number;
  /** Which condition triggered the summary: 'idle' (long dwell) or 'blocked' (keyboard-choice / permission). */
  trigger: 'idle' | 'blocked';
}

/**
 * One Overseer auto-approval decision, captured for the audit ring (main) and
 * the dry-run review pane (renderer). A flattened, render-ready view of an
 * `OverseerDecision` stamped with the session/project/tool it concerned — the
 * Overseer engine itself stays UI-agnostic, so this shape lives here, not in
 * `overseer.ts`. `computed` is what the cascade decided; `verdict` is what it
 * actually returned to the agent (they differ in dryRun: computed `allow`,
 * verdict `ask`), so the pane/badge can honestly say "would" vs "did".
 */
/**
 * The cascade tier that produced a decision. Mirrors `OverseerTier` in
 * `overseer.ts` (the engine keeps its own copy so it stays electron/shared-free),
 * and is the single source of truth for the two render-facing shapes below.
 */
export type OverseerTierName =
  | 'deny-guard'
  | 'allow-list'
  | 'confine'
  | 'llm'
  | 'deep'
  | 'default';

export interface OverseerAuditEntry {
  sessionId: string;
  projectId: string;
  /** e.g. `Bash`, `Read`, `mcp__zcc-inbox__inbox_push`. */
  toolName: string;
  /** Which cascade tier decided: deny-guard / allow-list / confine / llm / deep / default. */
  tier: OverseerTierName;
  /** What the cascade computed (`allow` even when dryRun returned `ask`). */
  computed: 'allow' | 'ask';
  /** What was actually returned to the agent (forced `ask` in dryRun). */
  verdict: 'allow' | 'ask';
  /** One-line human reason (the same string surfaced to the agent). */
  reason: string;
  /** When the decision was made (epoch ms). */
  at: number;
}

/**
 * A per-session rollup of Overseer activity, streamed to the renderer over the
 * dedicated {@link onOverseerActivity} channel (kept off `onAgentStatus` so an
 * auto-approval can't rebuild the status slice — the render-storm guard, same
 * as {@link IdleTriageResult}). Drives the "auto-approved ×N" card badge.
 * Counts the decisions the cascade ACTED on for this session; `acted` is true
 * when at least one call was auto-approved (verdict `allow`) so the badge can
 * stay quiet in dryRun (where `wouldApprove` grows but `acted` never flips).
 */
export interface OverseerActivity {
  sessionId: string;
  /** Tool calls auto-approved for real (verdict === 'allow'). */
  autoApproved: number;
  /** Calls the cascade WOULD have approved but didn't (dryRun: computed allow,
   *  verdict ask). Zero outside dryRun. */
  wouldApprove: number;
  /** Calls the cascade handed back to the normal prompt (verdict === 'ask',
   *  excluding the dryRun would-approve ones counted above). */
  askedBack: number;
  /** Tier of the most recent decision (for the badge tooltip). */
  lastTier: OverseerTierName;
  /** Reason of the most recent decision (for the badge tooltip). */
  lastReason: string;
  /** When the most recent decision was made (epoch ms). */
  lastAt: number;
}

/**
 * A discoverable agent session in the inter-agent registry (the agent mesh).
 * Identity fields (`sessionId`/`projectId`/`cwd`) are filled server-side from
 * the MCP URL route; the soft fields are agent-supplied via `register_agent`.
 * Shared so the renderer's Agents board can show the live registry. The
 * canonical store lives in `src/main/agent-registry-store.ts`.
 */
export interface AgentRecord {
  sessionId: string;
  projectId: string;
  /**
   * The agent's AUTHORITATIVE, addressable name — set only when a handle is
   * explicitly requested (i.e. the agent called `register_agent`). It is NEVER
   * derived from, or overwritten by, the drifting tab title, so once an agent
   * picks a handle it is stable for the session. Undefined for an agent that
   * has only been auto-seeded and never registered — such an agent is listed
   * and addressed by its {@link displayName} instead.
   */
  handle?: string;
  /**
   * The live tab title (Claude's task summary / the user's rename), refreshed on
   * every auto-seed. Read-only identity hint, NOT authoritative: it drifts as the
   * agent works, so it must never be confused with {@link handle}. Peers may
   * address an unregistered agent by this name; a registered agent is best
   * addressed by its stable handle.
   */
  displayName?: string;
  role?: string;
  capabilities?: string[];
  cwd: string;
  registeredAt: number;
  /**
   * Opaque id of the team launch that spawned this agent. Set server-side from
   * the launch path (both autonomous and manual team launches mint a UUID).
   * Agents within the same launch form an isolated squad: handle dedup and
   * discovery (`list_agents`/`find_agent`) are scoped to this id when present,
   * so two squads in the same project using the same personas each get their
   * own independent namespace. Undefined for solo (non-team) agents.
   */
  teamLaunchId?: string;
}

/**
 * One agent→agent message on the {@link AgentMessage} channel (separate from the
 * user inbox). Shared so the renderer's Agents activity view can render the
 * audit history. The canonical store lives in `src/main/agent-message-log.ts`.
 */
export interface AgentMessage {
  id: string;
  ts: number;
  fromSessionId: string;
  fromHandle: string;
  toSessionId: string;
  toHandle: string;
  projectId: string;
  body: string;
  deliveredAt?: number;
}

/**
 * Marks a session as a member of a launched Team cohort. A "cohort" is ONE
 * launch of a team (`cohortId` is minted fresh per launch — relaunching the
 * same team yields a distinct cohort, so two live runs of "Review Squad" are
 * managed separately). Stamped on every tab `launchTeam` opens; absent on
 * sessions opened any other way. The `role` is the single source of truth for
 * "is this the fleet orchestrator?" — it replaces the former side Set, dies
 * with the session, and never needs manual cleanup.
 */
export interface SessionCohort {
  /** Unique per launch (a fresh uuid each time the team is launched). */
  cohortId: string;
  /** The {@link Team.id} this cohort was launched from. */
  teamId: string;
  /** The team's display name at launch time (for board grouping headers). */
  teamName: string;
  /** Orchestrator leads (carries the opening prompt + the control-plane unlock); workers follow. */
  role: 'orchestrator' | 'worker';
  /** The slot's label override, when the slot declared one (for the board chip). */
  slotLabel?: string;
  /** Main-minted stable identity for this expanded slot within one cohort. */
  slotId?: string;
}

/**
 * Canonical name for a PTY-spawned coding agent. Same shape as
 * {@link TerminalSession}; Threads use a separate domain type and must not
 * share this map, RPC, or event log.
 */
export type LegacyAgentSession = TerminalSession;

export interface TerminalSession {
  id: string;
  /** Opaque main-owned capability used to restore/reconnect this launch. */
  restoreCapabilityId?: string;
  projectId: string;
  title: string;
  profile: LaunchProfileId;
  cwd: string;
  pid?: number;
  status: 'starting' | 'running' | 'exited';
  exitCode?: number;
  createdAt: number;
  /**
   * Wall-clock ms (epoch) when the pty exited. Set in the renderer's
   * `markExited` for tombstoned (non-scheduled) sessions so the Agents view can
   * show an exact run length (`finishedAt - createdAt`) instead of a
   * live-growing timer. Absent while running and for reaped scheduled jobs.
   */
  finishedAt?: number;
  extraArgs?: string[];
  pinned?: boolean;
  /**
   * The transcript session id this tab owns, for any `acceptsSessionId`
   * profile we launched fresh — Claude-family AND PI (both mint at spawn via
   * a literal `--session-id <uuid>` flag, so one field serves both; the name
   * is historical). We force it at spawn so each tab has a *stable, distinct*
   * conversation id — independent of the pty `id` above. Restore resumes this
   * exact id (`--resume <claudeSessionId>` / `pi --session-id <id>`) so N tabs
   * in one cwd reopen their OWN N conversations instead of all collapsing onto
   * the single most-recent one (the old `--continue` behavior). Absent for
   * shell tabs and for tabs that carry an explicit `--resume`/`--continue`/
   * `--session-id` in extraArgs (resume-picker tabs), where the CLI owns the
   * id, not us. See `codexSessionId`/`openCodeSessionId` for the DETECTED
   * (not minted) twin used by providers whose id we can't force.
   */
  claudeSessionId?: string;
  /**
   * The Codex rollout session id (UUID) this tab owns, DETECTED after spawn (not
   * minted like claude's — codex mints its own and writes it into the rollout
   * file's `session_meta`). Resolved lazily by `CodexSessionResolver` on the
   * first transcript read, then stamped onto the session record (main emits
   * `sessionUpdated`). Restore resumes this exact id (`codex resume <id>`) so a
   * restored codex tab reopens ITS conversation, not the cwd's most-recent one.
   * Absent until detection succeeds, and for non-codex tabs.
   */
  codexSessionId?: string;
  /**
   * The OpenCode session id (`ses_<hex>`) this tab owns, DETECTED after spawn
   * (not minted like claude's — OpenCode mints its own into its SQLite store
   * and we read it back via `opencode session list`, scoped to this tab's
   * cwd — see `OpenCodeSessionResolver`). Resolved lazily on the first
   * agent-status edge after spawn, then stamped onto the session record
   * (main emits `sessionUpdated`). Restore resumes this exact id
   * (`opencode --session <id>`) so a restored opencode tab reopens ITS
   * conversation, not the cwd's most-recent one. Absent until detection
   * succeeds, and for non-opencode tabs.
   */
  openCodeSessionId?: string;
  /**
   * Set once the user manually renames the tab. Suppresses the OSC-title
   * auto-rename (Claude's generated task summary) so an explicit name is never
   * overwritten. Renderer-only — titles are renderer-authoritative after the
   * session is created.
   */
  titleLocked?: boolean;
  /**
   * Set once an LLM micro-call (the `tab-namer` prompt) names this tab from its
   * first instruction. Once set, later OSC idle-titles no longer rename the tab
   * (the LLM name wins); the OSC path is only the fallback when no LLM name has
   * landed. A manual rename ({@link titleLocked}) still wins over both.
   * Renderer-only.
   */
  autoTitledByLlm?: boolean;
  /**
   * Set once an OSC idle-title (Claude's auto-generated task summary) has named
   * this tab. It makes the OSC path a ONE-SHOT fallback: the FIRST idle summary
   * names a still-default tab, after which later summaries no longer rename it —
   * without this, every idle spell re-titled the tab to whatever Claude was last
   * doing, so a peer message or a new turn would visibly churn the name. An LLM
   * name (the first real prompt) still upgrades over an OSC name, and a manual
   * rename ({@link titleLocked}) still wins over everything. Renderer-only.
   */
  autoTitledByOsc?: boolean;
  /**
   * Headless sessions are hidden from the tab strip but their pty keeps
   * running. The user produces them by clicking the tab's X — we intentionally
   * don't kill the pty so background work survives. Restore via the new-tab
   * popover's "Hidden" section.
   */
  headless?: boolean;
  /**
   * Spawned by the scheduler — a background job, not a tab the user opened.
   * Persisted on the session so the renderer can treat it as background work
   * even after it's been promoted to a visible tab (e.g. opened from the
   * inbox): when its process exits, its tab is auto-removed rather than left
   * as a tombstone. User-opened tabs keep their exited tombstone.
   */
  scheduled?: boolean;
  /**
   * For scheduled sessions, the owning schedule's inbox loudness, baked in at
   * spawn so an `inbox_push` from the agent can be stamped with the right
   * {@link InboxNotifyLevel} (and dropped entirely when `silent`) — even after
   * the schedule itself has been edited or deleted mid-run. Absent on
   * user-opened tabs. Not surfaced in the UI.
   */
  inboxLevel?: InboxNotifyLevel;
  /**
   * Id of the {@link Persona} this session was launched as, if any. Drives the
   * tab chip's icon/label (falls back to the profile icon when absent). The
   * resolved flags are already baked into argv at spawn — this is kept only for
   * display and so a restored session can re-show the persona badge.
   */
  personaId?: string;
  /**
   * Set when this agent was launched into an ISOLATED GIT WORKTREE (the launcher's
   * "Isolate in a worktree" option). Carries the checkout path + branch so the
   * Agents board can badge which worktree/branch the agent works in, and so the
   * on-close prune knows which app-managed checkout belongs to this session.
   * Absent on a normal (shared project root) launch. See
   * {@link CreateTerminalRequest.worktree}.
   */
  worktree?: SessionWorktree;
  /**
   * Host-owned Environment this session runs in (thread-create / worktree picker).
   * Distinct from {@link environment} (sandbox/microvm). Used for git actions
   * and destroy-on-last-thread. Absent on a legacy Electron `terminals.create`.
   */
  workspaceEnvironmentId?: string;
  /**
   * Execution environment this session runs in — WHERE it runs, orthogonal to
   * {@link profile} (WHAT agent runs). Absent ⇒ a plain local spawn (the common
   * case). `'sandbox'` ⇒ launched under an OS kernel sandbox (Seatbelt on macOS),
   * inherited by every child the agent spawns. `'microvm'` ⇒ launched inside a
   * microsandbox microVM (hardware isolation via libkrun; async boot). Drives the
   * Agents-board isolation badge. See {@link isolationStatus} for whether it's
   * actually enforced.
   */
  environment?: 'local' | 'sandbox' | 'microvm' | 'runtime-host';
  /**
   * Honest isolation posture, recorded at spawn. `{ isolated: true }` ⇒ the kernel
   * sandbox is in force. `{ isolated: false, reason }` ⇒ isolation was REQUESTED
   * but the kernel couldn't enforce it (non-macOS, missing `sandbox-exec`), so the
   * agent runs unconfined (warn-and-run) — surface the reason so the posture is
   * never silently assumed. Absent ⇒ no isolation was requested (plain local).
   */
  isolationStatus?: { isolated: boolean; reason?: string };
  /**
   * Honest reverse-tunnel posture for a REMOTE (SSH) session, recorded at spawn
   * and refined from the ssh output stream. Only set when a reverse tunnel was
   * REQUESTED (interactive claude-family remote with the MCP/hook server up) —
   * absent on a plain remote shell, a scheduled/headless remote run, or any local
   * session. `{ ok: true }` ⇒ ssh accepted the `-R` forward (the optimistic
   * default — the common case; the remote hooks/MCP can reach back). `{ ok:
   * false, reason }` ⇒ ssh reported the remote bind FAILED (e.g. the loopback
   * port was already taken on the box, or `GatewayPorts`/`AllowTcpForwarding`
   * disallow it), so remote hooks and any forwarded MCP will NOT reach the app —
   * surface the reason rather than silently assuming the agent is wired. Mirrors
   * {@link isolationStatus}: a warn-and-run posture, never a silent assumption.
   */
  remoteTunnel?: { ok: boolean; reason?: string };
  /**
   * Per-agent opt-in for the Heartbeat feature (absent/false = off). When true
   * AND the global {@link AppConfig.heartbeatEnabled} master switch is on, this
   * session is nudged to continue after it stays idle for the configured delay.
   * Never set on background agents (scheduled/headless) — the toggle is hidden
   * for them. In-memory only (like {@link headless}); toggled via the
   * `terminals.setHeartbeat` IPC.
   */
  heartbeat?: boolean;
  /**
   * Wall-clock ms (epoch) of the last HUMAN keystroke written into this session
   * via `PtyManager.write` (the `terminals.write` IPC). Agent-injected writes
   * (heartbeat nudges, peer messages, inbox replies) go through `reply()` and do
   * NOT stamp this — it is purely the human-activity clock that
   * {@link AppConfig.autoCloseIdleEnabled} uses to spare a tab a person was just
   * typing in. In-memory only (like {@link headless}); absent ⇒ never typed.
   */
  lastInputAt?: number;
  /**
   * Set when this session was opened as part of a {@link Team} launch. Groups
   * the launch's tabs into one manageable unit on the Agents board ("By team")
   * and marks the orchestrator. Absent on every non-team session.
   */
  cohort?: SessionCohort;
  /**
   * For a REMOTE session wrapped in a persistent tmux session on the box, the
   * STABLE tmux session id (the `<id>` in `cc-<id>`). It equals the pty `id` on
   * a first spawn, but a wake-reconnect mints a FRESH pty `id` while the box's
   * tmux session keeps its ORIGINAL name — so this field carries that original
   * name forward across reconnects. The renderer passes it (falling back to
   * `id` when absent) as the reconnect target so a SECOND sleep still
   * re-attaches the same live agent instead of spawning a bare one. Absent on
   * local sessions and on remote sessions spawned without tmux persistence.
   */
  remoteTmuxId?: string;
  /**
   * Safe, main-resolved metadata captured when this agent was launched. Values
   * come from trusted target resolution, never raw argv or mutable settings.
   */
  metadata?: SessionMetadataSnapshot;
}

/** A safe value discovered or resolved for an agent session. */
export interface SessionMetadataValue {
  label: string;
  value?: string;
}

/**
 * One harness metadata section. A declared section may have no value while its
 * source is still unavailable; unsupported sections are omitted altogether.
 */
export interface SessionMetadataSection {
  id: string;
  label: string;
  values: SessionMetadataValue[];
}

/**
 * Main-owned, renderer-safe metadata for one agent. It records resolved launch
 * metadata until a provider collector explicitly supplies a later snapshot.
 */
export interface SessionMetadataSnapshot {
  observedAt: number;
  sections: SessionMetadataSection[];
}

/** One file the agent touched this session, with the last op it performed.
 *  R = read, C = created (Write), W = wrote/edited (Edit/NotebookEdit). */
export interface SessionFileTouch {
  path: string;
  op: 'R' | 'C' | 'W';
}

/** A single entry of the agent's live todo queue (from the latest TodoWrite). */
export interface SessionQueueItem {
  text: string;
  status: 'pending' | 'in_progress' | 'completed';
}

/**
 * Cumulative token counts for a session, summed across every assistant turn —
 * the input for a cost/usage rollup (see the usage dashboard). Distinct from
 * {@link SessionStats.contextTokens} (a point-in-time window snapshot): these
 * are lifetime totals. The four buckets bill at different rates (fresh input,
 * output, cache-read at 0.1×, cache-write at 1.25–2×), so a rollup that wants an
 * accurate cost keeps them separate rather than one lumped total.
 */
export interface SessionTokenBreakdown {
  /** Fresh (non-cached) input tokens billed at the base input rate. */
  input: number;
  /** Output (completion) tokens. */
  output: number;
  /** Cache-read input tokens (reused context, ~0.1× base input). */
  cacheRead: number;
  /** Cache-creation input tokens (5-min + 1-hour writes, 1.25–2× base input). */
  cacheWrite: number;
}

/**
 * A live, display-only snapshot of a session distilled from its supported
 * transcript source — surfaced in the Agent Monitor's status pane (model, context
 * occupancy, rough cost, files touched, todo queue). Every field degrades
 * gracefully: a value is omitted (or an empty list) when the transcript doesn't
 * carry it, so the UI shows nothing rather than a fabricated zero.
 */
export interface SessionStats {
  /** The model of the most recent assistant turn (e.g. `claude-sonnet-4-5-…`). */
  model?: string;
  /** Harness version recorded by its own session store, when available. */
  harnessVersion?: string;
  /** Active harness-native agent profile, when the session store reports one. */
  agent?: string;
  /** Context window occupancy: the LATEST turn's total input footprint (input +
   *  cache_read + cache_creation) — how full the window is now, not a sum. */
  contextTokens?: number;
  /** Rough USD cost, summed across all turns from token counts × model rates. */
  costUsd?: number;
  /** Lifetime token totals across all turns, split by billing bucket. Omitted
   *  when the transcript carried no usage accounting at all. */
  tokens?: SessionTokenBreakdown;
  /** How many prompts the human sent this session (typed user turns — not tool
   *  results). Omitted when the transcript carried none. */
  promptCount?: number;
  /** Total tool invocations across the session (every `tool_use` block). */
  toolCalls?: number;
  /** The subset of {@link toolCalls} that were MCP tools (name begins `mcp__`). */
  mcpCalls?: number;
  /** Distinct files the agent touched, most-recently-touched first. */
  files: SessionFileTouch[];
  /** The agent's latest todo list (empty when it never wrote one). */
  queue: SessionQueueItem[];
}

/**
 * Task Shelves (afl-04) — a host-owned, compact ledger of what an agent session
 * is touching / doing / producing, in three fixed shelves. Contributors supply
 * ONLY structured rows; ALL presentation (layout, density, truncation, icons,
 * tone, empty-states) is the host's — that separation is the load-bearing
 * contract (no layout/tone decisions in the derivation). The serializable fields
 * live here; the renderer adds an `onSelect` click handler on top.
 */
export type ShelfId = 'sources' | 'background' | 'outputs';

export interface ShelfRow {
  id: string;
  title: string;
  detail?: string;
  meta?: string;
  status?: 'active' | 'done' | 'pending' | 'error';
  tone?: 'default' | 'accent' | 'muted' | 'danger';
  /** Icon NAME, resolved via resolveIcon() renderer-side — never a component. */
  icon?: string;
}

export interface Shelf {
  id: ShelfId;
  label: string;
  rows: ShelfRow[];
}

export interface AppConfig {
  version: 1;
  /**
   * App light/dark mode. 'system' (added WARP-A2) follows the OS
   * `prefers-color-scheme` live; 'dark'/'light' pin it. Stored as this
   * tri-state; every consumer RESOLVES it to concrete dark/light at read time
   * (renderer via `matchMedia`, main via electron `nativeTheme`).
   */
  theme: 'dark' | 'light' | 'system';
  /**
   * Color palette for the xterm terminal, INDEPENDENT of the app light/dark
   * `theme`. 'auto' (default) follows `theme` (the historical behavior); every
   * other id is an explicit named palette (Dracula, Nord, …). Ids validated in
   * normalizeConfig against the shared registry (renderer untrusted — rule 1).
   * See `packages/domain/src/terminal-themes.ts`.
   */
  terminalTheme?: TerminalThemeId;
  shell: string;
  claudeBinary: string;
  /** Optional global agent-harness default. Absent preserves Claude compatibility fallback. */
  defaultHarness?: HarnessFamily;
  /** Structured global model defaults, keyed by owning harness. */
  harnessRouting?: HarnessModelRoutingV1;
  /** Global Claude text appended before project, persona, and agent prompt layers. */
  claudeAppendSystemPrompt?: string;
  /** Global Claude CLI arguments. Later project, persona, and agent layers take priority on conflicts. */
  claudeExtraArgs?: string[];
  /** Global Claude context directories, combined with later layers. */
  claudeAddDirs?: string[];
  /** Global Claude allowed tools, combined and deduplicated with later layers. */
  claudeAllowedTools?: string[];
  /** Global Claude denied tools, combined and deduplicated with later layers. */
  claudeDeniedTools?: string[];
  /** Global native Codex sandbox policy. */
  defaultCodexSandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
  /** Global native Codex approval policy. */
  defaultCodexApproval?: 'untrusted' | 'on-request' | 'never';
  /**
   * Extension-permission posture (the "Approve for me" tier). 'ask' = normal
   * consent; 'approveForMe' = the fail-closed reviewer may auto-approve narrow
   * low-risk requests; 'fullAccess' = never run the reviewer. Default 'ask'.
   * Validated in normalizeConfig (renderer untrusted — rule 1).
   */
  reviewerApprovalMode?: 'ask' | 'approveForMe' | 'fullAccess';
  /**
   * Enable the Suggested Actions launcher surface (afl-03). When ON, a top-level
   * "Suggestions" nav entry appears and agents' `suggest_action` proposals are
   * surfaced as a runnable card grid. Default OFF; gates only the renderer SURFACE.
   */
  suggestionsEnabled?: boolean;
  /**
   * Pre-authorize ALL zcc-inbox MCP tools for every session the app launches,
   * so agents are never prompted for them. When ON, the launch arg builder
   * injects the whole-server wildcard `mcp__zcc-inbox` into `--allowedTools`
   * (covers all current + future tools), replacing the narrower per-spawn
   * allow-list (which otherwise withholds `agent_send`, `remote_exec`, and
   * `library_remove` behind a first-use prompt for non-autonomous runs).
   * Default ON (absent-in-file ⇒ true, see `store.getConfig()`'s fallback) —
   * this also pre-approves privileged tools (remote shell exec, library
   * delete) for ordinary sessions, not just autonomous team runs, so the user
   * can opt OUT by persisting false. Enforced in pty.ts (`inboxAllow`).
   */
  trustZccToolsEnabled?: boolean;
  /**
   * Surface Claude AskUserQuestion prompts in the in-app Questions UI. Under
   * evaluation, hidden by default. Off ⇒ the prompt is only answerable in the
   * terminal (which remains a working fallback even when ON).
   */
  askUserQuestionUiEnabled?: boolean;
  /**
   * Master switch for the brokered `ctx.llm` extension capability (Epic C).
   * When OFF (the default — a net-new egress + cost surface), every `ctx.llm`
   * call resolves to a degraded `{ ok:false }` regardless of the extension's
   * grant. Enforced host-side in `broker-caps.ts`.
   */
  extensionLlmEnabled?: boolean;
  /**
   * Path/name of the `cursor-agent` CLI (the Cursor harness). Optional: absent
   * ⇒ the provider falls back to the bare `cursor-agent` on PATH. Same slot
   * shape as {@link claudeBinary}, one per non-shell provider family.
   */
  cursorBinary?: string;
  /**
   * Path/name of the `codex` CLI (the Codex harness). Optional: absent ⇒ the
   * provider falls back to the bare `codex` on PATH.
   */
  codexBinary?: string;
  /**
   * Path/name of the `pi` CLI (the PI harness — `@earendil-works/pi-coding-agent`).
   * Optional: absent ⇒ the provider falls back to the bare `pi` on PATH.
   */
  piBinary?: string;
  /**
   * Path/name of the `opencode` CLI (the OpenCode harness — npm `opencode-ai`).
   * Optional: absent ⇒ the provider falls back to the bare `opencode` on PATH.
   */
  opencodeBinary?: string;
  /**
   * Hide the Cursor harness from agent-launch UIs. Absent/undefined ⇒ auto-on
   * when the CLI is installed. `false` is an explicit hide.
   */
  harnessCursorEnabled?: boolean;
  /**
   * Hide the Codex harness from agent-launch UIs. Absent/undefined ⇒ auto-on
   * when the CLI is installed. `false` is an explicit hide.
   */
  harnessCodexEnabled?: boolean;
  /**
   * Hide the PI harness from agent-launch UIs. Absent/undefined ⇒ auto-on when
   * the CLI is installed. `false` is an explicit hide.
   */
  harnessPiEnabled?: boolean;
  /**
   * Hide the OpenCode harness from agent-launch UIs. Absent/undefined ⇒ auto-on
   * when the CLI is installed. `false` is an explicit hide.
   */
  harnessOpenCodeEnabled?: boolean;
  /**
   * Default PI provider (`pi --provider <name>`) for new PI tabs — PI is
   * multi-provider (anthropic / openai / google / …). Free text: PI accepts any
   * of its ~40 provider ids. Blank/absent ⇒ emit no `--provider`, letting PI use
   * its own configured default (`~/.pi`). A launcher-global default, the PI twin
   * of {@link codexSandbox}-style per-harness knobs.
   */
  piProvider?: string;
  /**
   * Default PI model (`pi --model <pattern>`) for new PI tabs. PI takes a
   * `provider/id` slug, a bare fuzzy pattern, or a `:thinking` suffix. Blank/
   * absent ⇒ emit no `--model` (PI picks its provider default).
   */
  piModel?: string;
  /**
   * Default PI reasoning level (`pi --thinking <level>`) for new PI tabs. One of
   * PI's fixed levels; `'default'`/absent ⇒ emit no `--thinking`.
   */
  piThinking?: 'default' | 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /**
   * Offer the microVM (`microsandbox`) execution environment in agent-launch UIs.
   * Default OFF — a rollout flag while the runtime bakes. Absent/false ⇒ the
   * launcher shows only Off/Kernel-sandbox; the `'microvm'` env still resolves if
   * a launch explicitly requests it (main re-authorizes), but no UI offers it.
   * Only meaningful where the platform can run a microVM (Apple Silicon / KVM /
   * WHP) — the launcher shows a disabled affordance elsewhere.
   */
  microVmEnabled?: boolean;
  /**
   * External-editor / opener configuration (Settings → Editor). These drive the
   * `OpenerButtons` "open in editor / terminal" bar — DISTINCT from the harness
   * `cursorBinary` (that's the `cursor-agent` coding CLI; this is the `cursor`
   * GUI-launch shim). Each editor has a CLI-shim override (`*Binary`, blank ⇒ the
   * bare name on PATH) and a macOS app-name override (`*App`, used by the
   * `open -a <App>` fallback when the shim isn't found). Blank/absent ⇒ the
   * built-in default.
   */
  editorCursorBinary?: string;
  editorCursorApp?: string;
  editorCodeBinary?: string;
  editorCodeApp?: string;
  editorIntellijBinary?: string;
  editorIntellijApp?: string;
  /**
   * Preferred macOS terminal app name for the "Open external Terminal" opener
   * (`open -a <name>`). Blank/absent ⇒ auto-pick (iTerm → WezTerm → Alacritty →
   * Terminal.app).
   */
  terminalApp?: string;
  /**
   * Opener-bar targets hidden by the user (Settings → Editor "Show in opener
   * bar" toggles). A target listed here is dropped from every `OpenerButtons`
   * row. Absent/empty ⇒ all targets shown.
   */
  openerHiddenTargets?: OpenTarget[];
  fontSize: number;
  lastProjectId: string | null;
  /**
   * Non-null ⇒ the project list column is drilled into that project's focused
   * session view. Persisted so focus survives relaunch, like lastProjectId.
   */
  focusedProjectId?: string | null;
  /**
   * Per-project active workspace view. A value is either a core
   * {@link WorkspaceMode} OR an
   * extension module id, when that project's active tab is an
   * extension-contributed project tab (see `ProjectTabContribution`). Stored as
   * a bare string so an arbitrary extension id round-trips; the renderer
   * tolerates an id whose extension is no longer installed (falls back to the
   * default view).
   */
  workspaceModes?: Record<string, string>;
  /** Global Agents-board layout preference: kanban lanes, grouped list, or the
   *  squad-flow graph. */
  agentsBoardView?: 'board' | 'list' | 'flow';
  /** How the inbox Feed groups rows within each day bucket: per-project
   *  subgroups ('project', default) or a flat chronological stream ('time'). */
  inboxGrouping?: 'project' | 'time';
  listPaneWidth?: number;
  /** Nav sidebar width in px. Absent ⇒ CSS default (256). Clamped [256, 480]. */
  sidebarWidth?: number;
  windowBounds?: { x?: number; y?: number; width: number; height: number };
  /** macOS Option-green zoom/maximize state; native fullscreen is never restored. */
  windowMaximized?: boolean;
  /** Global default model passed to claude CLI (absent = let claude decide). */
  defaultModel?: 'opus' | 'sonnet' | 'haiku' | 'default';
  /** Global default permission mode for new claude sessions. */
  defaultPermissionMode?: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';
  /** Portable default execution posture. Legacy permission mode remains readable for migration. */
  defaultExecutionState?: 'plan' | 'interactive' | 'accept-edits' | 'autonomous';
  /** Canonical adapter-owned settings containers. Legacy fields remain readable during migration. */
  harnesses?: {
    byId?: Partial<Record<HarnessFamily, {
      enabled?: boolean;
      binary?: string;
      compatibility?: {
        model?: string; permissionMode?: string; appendSystemPrompt?: string;
        extraArgs?: string[]; addDirs?: string[]; allowedTools?: string[]; deniedTools?: string[];
        codexSandbox?: string; codexApproval?: string; provider?: string; thinking?: string;
        autoMode?: { enabled?: boolean; environment?: string[]; allow?: string[]; softDeny?: string[]; hardDeny?: string[]; classifyAllShell?: boolean };
        executionPolicy?: {
          target: 'native-default-with-auto';
          autoMode?: { enabled?: boolean; environment?: string[]; allow?: string[]; softDeny?: string[]; hardDeny?: string[]; classifyAllShell?: boolean };
        };
      };
    }>>;
  };
  /** Show inbox guidance hints in the UI (default true). */
  inboxGuidanceEnabled?: boolean;
  /**
   * Whether xterm's built-in mouse-wheel → arrow-key translation stays on
   * (default true). On the *alternate* screen buffer with mouse tracking off,
   * xterm sends Up/Down arrows on a wheel notch — which pagers (less/man/git)
   * use to scroll, but a shell/prompt on the alt buffer reads as command-history
   * navigation (the "wheel cycles my history" complaint). Set false to suppress
   * the arrow translation on the alt buffer only; normal-buffer scrollback and
   * mouse-tracking (tmux `mouse on`) are unaffected either way. See
   * `apps/app/src/lib/terminalWheel.ts`.
   */
  terminalWheelArrowsEnabled?: boolean;
  /**
   * Version the user chose to "Skip" in the update prompt. The notify-only
   * updater stops offering this exact version until the feed advertises a newer
   * one (see apps/desktop/src/updater.ts). Absent ⇒ nothing skipped.
   */
  skippedUpdateVersion?: string;
  /**
   * The app version the user has already seen the "What's New" notes for. On the
   * first launch after an update (running `app.getVersion()` overtakes this),
   * main fires {@link IPC.updates.onWhatsNew} once and advances this to the
   * running version. Absent ⇒ first-ever launch: main writes the baseline
   * silently and shows nothing (a fresh install isn't interrupted). Validated in
   * `normalizeConfig` (renderer untrusted — Rule 1). See src/main/release-notes.ts.
   */
  lastSeenVersion?: string;
  /**
   * Dev/QA only: arm the in-app "Simulate update" affordance in Settings →
   * About. When true, the About tab shows a button that walks the full
   * available → downloading → downloaded status flow WITHOUT contacting the
   * release feed, downloading anything, or ever installing (see
   * `updater.simulate`). Off/absent by default. Re-checked in main before the
   * `updates:simulate` IPC calls the updater (Rule 1).
   */
  enableUpdateSimulation?: boolean;
  /**
   * Whether the first-run walkthrough has been completed or skipped. Absent /
   * false ⇒ the walkthrough auto-opens once on the next main-window launch
   * (per-project windows never show it). Set true when the user finishes or
   * dismisses it; the Settings "Replay walkthrough" action re-opens it without
   * clearing this flag.
   */
  walkthroughCompleted?: boolean;
  /**
   * Whether the first-run setup checklist (the dependency doctor) has been
   * completed or dismissed. Absent / false ⇒ the checklist auto-opens once on
   * the next main-window launch IF any tracked dependency is missing (a fully
   * set-up machine never sees it). Set true when the user finishes or dismisses
   * it; re-openable from Settings without clearing the flag. Per the
   * `walkthroughCompleted` pattern — scoped per-project windows never show it.
   */
  setupDismissed?: boolean;
  /**
   * Whether the one-time "Star us on GitHub" nudge (the small card that floats
   * just above the footer on first launch) has been dismissed or acted on.
   * Absent / false ⇒ the card auto-shows once in the main window; set true when
   * the user stars, closes it, or clicks through. The permanent ♥ button in the
   * footer stays regardless — this flag only gates the first-run popup. Follows
   * the `walkthroughCompleted` / `setupDismissed` pattern (main window only).
   */
  sponsorPromptDismissed?: boolean;
  /**
   * Auto-name a Claude tab or a conversation thread from its first instruction
   * via an LLM micro-call (the `tab-namer` prompt). Default true. When false,
   * tabs fall back to the legacy OSC idle-title rename, and threads keep the
   * short prompt-snippet placeholder.
   */
  autoRenameTabs?: boolean;
  /**
   * Overseer auto-approval cascade (EXPERIMENTAL, off by default). When armed,
   * a synchronous `PreToolUse` hook on every claude tab POSTs each tool call to
   * the local server, which runs a deny→allow→(optional LLM) cascade and prints
   * an `allow` to skip the permission prompt for provably-safe calls (read-only
   * tools, `git status`-class shell). It NEVER emits `deny` and is fail-open: a
   * server/cascade error, an empty reply, or `off` all leave the agent's normal
   * permission prompt untouched — so disabling it (or it breaking) can only ever
   * restore stock behaviour, never block work. Three modes:
   *   - `'off'` (default / absent): no hook is installed; the feature is inert.
   *   - `'dryRun'`: the hook runs and decisions are audited, but it always
   *     returns `ask` — so you can watch what it *would* auto-approve first.
   *   - `'on'`: auto-approvals take effect.
   * Takes effect on the next session launch (the hook is wired at spawn time).
   */
  overseerMode?: 'off' | 'dryRun' | 'on';
  /**
   * Run the Overseer's LLM judgment tier for tool calls the static deny/allow
   * tiers didn't resolve — a bounded `builtin:overseer-judge` micro-call that
   * answers "is this safe to auto-approve?". Default OFF: it spends tokens (one
   * `claude --print` per unresolved call). When off, the cascade stops after the
   * static allow-list and everything else falls through to the normal prompt.
   * Only consulted when {@link overseerMode} is `dryRun`/`on`.
   */
  overseerLlmTierEnabled?: boolean;
  /**
   * Enable the Overseer's second, "think harder" judgment pass. When the fast
   * `builtin:overseer-judge` micro-call answers `escalate` (a call that looks
   * probably safe but it isn't sure), run the stronger `builtin:overseer-judge-deep`
   * micro-call on a larger model + thinking budget to decide. Default OFF: it
   * spends more tokens and adds latency (the agent blocks a few extra seconds on
   * the escalated call). Only consulted when {@link overseerLlmTierEnabled} is on.
   * Holds the SAME conservative bar — it can only turn an escalate into an
   * auto-approve, never lower the guardrail floor.
   */
  overseerDeepTierEnabled?: boolean;
  /**
   * Operator-supplied deny substrings, additive on top of the built-in
   * guardrails. Matched case-insensitively against the tool name and a
   * flattened view of the tool input; a hit forces the normal prompt (`ask`)
   * and the LLM tier never runs. Only consulted when {@link overseerMode} is
   * `dryRun`/`on`.
   */
  overseerDenyPatterns?: string[];
  /**
   * Launch every interactive claude agent in Claude Code's native "auto mode"
   * (`--permission-mode auto`). Default ON (absent ⇒ treated as `true`). Auto
   * mode routes each tool call through a server-side classifier that blocks
   * anything irreversible, destructive, or aimed outside your environment while
   * skipping the routine permission prompts — a real guardrail, unlike the
   * fail-open {@link overseerMode} cascade (which can only ever loosen). When a
   * launch is in auto mode the Overseer hook is NOT installed (it would be
   * redundant and double-spend tokens); the Overseer stays as the fallback for
   * launches where auto mode is off or unavailable.
   *
   * Only applied to claude-family, non-yolo, interactive launches whose
   * effective model can support auto mode. Requirements (see
   * https://code.claude.com/docs/en/permission-modes): Claude Code ≥ v2.1.83
   * and, on Bedrock/Vertex/Foundry, one of Sonnet 5 / Opus 4.7 / Opus 4.8 plus
   * `CLAUDE_CODE_ENABLE_AUTO_MODE=1` (which the launcher sets in the spawn env).
   * A launch whose model is known-incapable (e.g. Haiku) silently falls back to
   * the normal permission mode + Overseer rather than emitting a flag the CLI
   * would reject.
   */
  autoModeEnabled?: boolean;
  /**
   * Classifier trust config passed through to auto mode's `autoMode` settings
   * block (see https://code.claude.com/docs/en/auto-mode-config). Each is an
   * array of natural-language rules; the launcher splices Claude Code's built-in
   * `"$defaults"` in front so operator entries are ADDITIVE and never discard the
   * built-in guardrails. All optional — an empty/absent array contributes
   * nothing beyond the defaults. Only consulted when {@link autoModeEnabled} is
   * on (the default).
   *   - `autoModeEnvironment`: trusted repos / buckets / domains / services.
   *   - `autoModeAllow`: exceptions to the built-in soft-block rules.
   *   - `autoModeSoftDeny`: extra destructive actions user intent can clear.
   *   - `autoModeHardDeny`: unconditional security boundaries.
   */
  autoModeEnvironment?: string[];
  autoModeAllow?: string[];
  autoModeSoftDeny?: string[];
  autoModeHardDeny?: string[];
  /**
   * Suspend every narrow Bash/PowerShell allow rule while auto mode is active so
   * the classifier evaluates every shell command (maps to
   * `autoMode.classifyAllShell`). Trades latency for coverage. Default OFF.
   * Only consulted when {@link autoModeEnabled} is on.
   */
  autoModeClassifyAllShell?: boolean;
  /**
   * Content Screen (EXPERIMENTAL, off by default) — inbound prompt-injection
   * defense, the counterpart to the Overseer's outbound auto-approval. When
   * armed, a synchronous `PostToolUse` hook on every claude tab POSTs the
   * result of WebFetch/WebSearch/third-party-MCP tool calls to the local
   * server, which runs the `builtin:content-screen` classifier over content
   * that came from OUTSIDE the project (web pages, remote/sandbox command
   * output, other MCP servers' replies) looking for an embedded instruction
   * planted to hijack the agent. It NEVER blocks anything — by the time the
   * result exists the tool already ran, so the only lever left is to warn:
   * a `suspicious` verdict adds a one-line heads-up to the agent's context
   * (`additionalContext`) framing the content as data to distrust, not a
   * command to obey. Fail-open: a server/cascade error, an empty reply, or
   * `off` all leave the tool result exactly as the agent would have seen it
   * anyway. Three modes:
   *   - `'off'` (default / absent): no hook is installed; the feature is inert.
   *   - `'dryRun'`: the hook runs and decisions are audited, but no warning is
   *     ever injected — so you can watch what it *would* flag first.
   *   - `'on'`: warnings take effect.
   * Takes effect on the next session launch (the hook is wired at spawn time).
   */
  contentScreenMode?: 'off' | 'dryRun' | 'on';
  /**
   * Enable the idle-agent triage add-on: when a claude agent settles into idle,
   * run the `builtin:idle-triage` LLM micro-call over its last turn to classify
   * WHY it's idle (waiting on you / done / paused) and surface that on the
   * Agents board. Default OFF — it spends tokens (one `claude --print` call per
   * idle spell). When false, idle cards show no resolution badge.
   */
  idleTriageEnabled?: boolean;
  /**
   * Suppress a BLOCKING inbox question (from `inbox_ask`, or an `inbox_push`
   * question marked `blocking`) WHILE its originating agent is still `working`,
   * flushing it to the inbox the moment the agent goes idle/blocked — or after a
   * ~10-min safety deadline so a never-idling agent can't bury a real blocker.
   * The point: a busy fleet stops filling the inbox with half-relevant questions
   * the agent often resolves itself before it ever stops. Spends NO tokens (pure
   * gating + a deferred append; see {@link HeldQuestionService}). A plain status
   * report or a soft (non-blocking) question always surfaces immediately — only a
   * blocking question fired mid-run is held. Default ON: it's the core of the
   * "quiet questions" behavior and can only ever DELAY a question, never drop one
   * (session exit before idle drops held questions, which is the intended
   * self-resolve). Set false to append every question the instant it's asked.
   */
  heldQuestionsEnabled?: boolean;
  /**
   * Idle dwell (seconds) before the idle-triage add-on fires its micro-call.
   * On the working/blocked → idle edge the service arms a timer of this length;
   * it triages ONLY if the agent is still idle when the timer elapses (any
   * non-idle transition cancels it). This filters the 1–2s idle flicker between
   * tool calls — a busy agent that never sits still this long is never triaged,
   * which also throttles cost. Clamped 10–600s in {@link normalizeConfig};
   * default 20 (mirrors the `heartbeatDelaySeconds` idiom). Only consulted when
   * {@link idleTriageEnabled} is on.
   */
  idleTriageDelaySeconds?: number;
  /**
   * How aggressively a triaged idle agent is promoted to the "Needs you" lane —
   * a pure renderer-side mapping over the existing verdict + `confidence`, no
   * new LLM output. `'high'` surfaces almost any non-`done` idle agent (incl.
   * paused/unknown); `'medium'` (default) surfaces only genuine `awaiting-reply`
   * questions; `'low'` surfaces only high-confidence (`≥0.7`) questions. Stored
   * as a named level (not a raw threshold) to match the `theme` enum-setting
   * idiom; missing/invalid normalizes to `'medium'`.
   */
  idleAttentionSensitivity?: 'high' | 'medium' | 'low';
  /**
   * Whether the LEFT-SIDE agents list (the Agents-nav column-2 `AgentsListPane`)
   * also promotes a triaged idle agent into its "Needs you" group — matching the
   * Agents board's behavior. Default OFF: when off, the list's "Needs you" holds
   * only `blocked` agents (a real permission prompt / question) and a
   * triage-flagged idle agent stays in the Idle group. Only meaningful while
   * {@link idleTriageEnabled} is on (no triage verdicts otherwise); the promotion
   * uses the same {@link idleAttentionSensitivity} mapping as the board.
   */
  agentListNeedsYouFromTriage?: boolean;
  /**
   * Turn an `awaiting-reply` idle-triage verdict into a durable {@link FollowUp}
   * record (so a parked question survives a kill / app restart, unlike the
   * ephemeral "Needs you" badge). Reuses the verdict idle-triage already computes
   * — NO extra LLM spend. Default ON whenever {@link idleTriageEnabled} is on
   * (there's a verdict to consume); a no-op when triage is off. Set false to keep
   * the live badge but stop auto-creating follow-ups.
   */
  followupsFromIdle?: boolean;
  /**
   * Let a running agent close ITS OWN session via MCP (the `close_session` /
   * `close_session_with_summary` tools on the session-scoped route). The
   * with-summary variant takes the agent's own one-line summary and writes it to
   * the inbox before the pty dies. Default OFF — a self-closing tool lets an
   * agent end its own turn, so it's opt-in. When false, neither tool is
   * registered (the agent doesn't see them). This is the agent-driven path,
   * distinct from the operator-driven board action (the Agents board's "Close
   * idle" button is unconditional, not gated by a config flag).
   */
  agentSelfCloseEnabled?: boolean;
  /**
   * Enable the catch-up summary card (EXPERIMENTAL; spends tokens). When an agent
   * is idle a long time OR waiting at a blocked prompt (keyboard-choice /
   * permission), generate a small background-precomputed summary — "where are we,
   * what changed" — and show it under the terminal in the agent modal. Uses the
   * FASTEST model (haiku) via a `builtin:catch-up-summary` micro-call gated by
   * this flag. Default OFF — it spends tokens and is experimental.
   */
  catchUpSummaryEnabled?: boolean;
  /**
   * Idle / blocked dwell (seconds) before the catch-up-summary add-on fires its
   * micro-call. On the working/blocked → idle edge (or entering 'blocked'), the
   * service arms a timer of this length; it generates ONLY if the agent is still
   * in the trigger state when the timer elapses. Throttles cost + churn. Clamped
   * 10–600s in {@link normalizeConfig}; default 20 (mirrors idle-triage). Only
   * consulted when {@link catchUpSummaryEnabled} is on.
   */
  catchUpSummaryDelaySeconds?: number;
  /**
   * Enable the feed-noise classifier (EXPERIMENTAL; spends tokens). When ON and
   * the Inbox is open, a background `builtin:feed-noise-classifier` haiku
   * micro-call judges which free-form reports are ROUTINE "task done" chatter
   * and DEMOTES them into a collapsed "Routine" section, so only meaningful
   * reports stay inline. A deterministic gate in main means the model only ever
   * sees comment-only reports — a report with docs, a question, an idea, or a
   * goal outcome is NEVER eligible (those stay pinned as signal). The verdict is
   * advisory + non-persisted (recomputed per scope, cached by inbox signature,
   * throttled like the AI summary). Default OFF — it spends tokens. When off,
   * every report stays inline (no demotion).
   */
  feedNoiseClassifierEnabled?: boolean;
  /**
   * Auto-link report-looking files an agent wrote to the inbox, even when it
   * never calls `inbox_push` itself (see {@link AutoReportLinkerService}). On
   * the working→idle edge, main re-scans the session's file-touch list for a
   * newly-created markdown file that LOOKS like a report deliverable (a report/
   * summary/analysis/audit keyword, or a bare `.md` at cwd root) and appends a
   * `report: true` entry pointing at it, stamped with the same `sessionId`/
   * `origin` a manual push would carry. Pure filename heuristic — spends NO
   * tokens — so unlike the LLM add-ons above this defaults ON: there's no cost
   * to weigh against always closing the "wrote a report, forgot to push it" gap.
   */
  autoReportLinkEnabled?: boolean;
  /**
   * Render structured questions (lettered options + Skip/Continue) instead of
   * plain markdown + a free-text reply box, wherever an inbox entry or follow-up
   * carries answer options (EXPERIMENTAL). Backs the `inbox_ask` question form,
   * the optional `inbox_push` options, and the follow-up option picker. Default
   * ON — off falls back to plain markdown + free-text reply everywhere (the
   * options are still shown in the comments text, just not as an interactive
   * form). A UX affordance only; it never changes what an agent receives.
   */
  structuredQuestionsEnabled?: boolean;
  /**
   * Let a running agent close OTHER idle agents via the `close_idle_agents` MCP
   * tool (the session-scoped route). The tool sweeps every at-rest (idle, not
   * working/blocked) agent — by default within the caller's own project, or
   * across all projects when invoked with `allProjects: true` — summarizing each
   * one's work to the inbox first (one `builtin:close-summary` micro-call per
   * agent) and returning that wrap-up so the caller can persist it elsewhere
   * (e.g. project memory). The caller's own session is never closed (that's
   * {@link agentSelfCloseEnabled}'s `close_session`). Default OFF — it kills
   * sibling processes and spends tokens, so it's strictly opt-in; takes effect
   * on the next app launch. When false the tool is not registered (the agent
   * doesn't see it). This is the agent-driven bulk-close path, distinct from
   * the operator-driven board button (unconditional, not gated by a config flag).
   */
  closeIdlePeersEnabled?: boolean;
  /**
   * Master switch for AUTOMATIC idle-agent close: when ON, any non-background
   * agent that sits idle (not working/blocked, not delegating) for
   * {@link autoCloseIdleMinutes} is closed by the app on a timer — its own
   * project only, never across projects. The close is SILENT (no summary
   * micro-call), but if idle-triage had classified the agent as
   * `awaiting-reply`, the cached verdict is turned into a durable follow-up
   * first so a parked question isn't lost (see `FollowUpManager.createFromIdle`).
   * Default OFF — it kills processes unprompted, so it's opt-in; toggled live
   * from the sidebar (no relaunch — the service reads this gate live, like
   * {@link heartbeatEnabled}). Distinct from {@link closeIdlePeersEnabled}
   * (agent-driven MCP sweep) and the operator-driven board button (unconditional,
   * not gated by a config flag): this is the unattended timer. Several
   * fail-safes (foreground-tab spare, a last-human-input clock, the
   * delegating/background/blocked exclusions) gate each close in
   * `AutoCloseIdleService`.
   */
  autoCloseIdleEnabled?: boolean;
  /**
   * Minutes an agent must sit idle before {@link autoCloseIdleEnabled} closes
   * it. Absent ⇒ {@link AUTO_CLOSE_IDLE_DEFAULTS.minutes} (15). Clamped to
   * [{@link AUTO_CLOSE_IDLE_DEFAULTS.minMinutes}, {@link AUTO_CLOSE_IDLE_DEFAULTS.maxMinutes}]
   * and rounded in {@link normalizeConfig}. Read live.
   */
  autoCloseIdleMinutes?: number;
  /**
   * When an idle agent is auto-closed (see {@link autoCloseIdleEnabled}), also
   * drop a folded breadcrumb into the inbox's collapsed "Agent closed" section.
   * Default OFF — an idle auto-close is routine bookkeeping already recorded in
   * the Activity Feed + Agents tab, so it's noise in the inbox unless the user
   * asks for it. A close that PRESERVED a parked question always pushes its
   * follow-up breadcrumb regardless of this flag (that's signal, not noise).
   * Read live.
   */
  autoCloseIdleNotifyInbox?: boolean;
  /**
   * Show the "Quit and end N running session(s)?" confirmation dialog when the
   * app is asked to quit while ptys are still alive. Default ON (absent ⇒ true)
   * — the guard exists so quitting doesn't silently kill in-flight agents and
   * background sessions (they aren't persisted). Set to `false` to quit
   * immediately without the prompt (for users who launch/kill many short-lived
   * sessions and find the confirmation a nuisance). Read live in the
   * `before-quit` handler — takes effect on the next quit, no relaunch.
   */
  confirmQuitOnLiveSessions?: boolean;
  /**
   * Default for the launcher's "Isolate in a git worktree" toggle. When ON, a
   * new agent launched into a LOCAL git project defaults to running in a
   * dedicated worktree/branch (under `~/zcc-worktrees`) instead of the shared
   * project root — the nudge that keeps many agents on one repo from trampling
   * each other. Absent/false ⇒ launches default to the project root (the user
   * can still flip the per-launch toggle). It's only a DEFAULT for the toggle:
   * the actual per-launch decision is always the `CreateTerminalRequest.worktree`
   * flag the launcher sends. Ignored for remote/scratch/non-repo projects (they
   * can't be isolated). A per-project override lives on
   * {@link ProjectSettings.worktreeIsolation}. Read live.
   */
  worktreeIsolationDefault?: boolean;
  /**
   * Let a running agent launch a Team via the `launch_team` MCP tool (the
   * session-scoped route). The tool opens one terminal tab per slot — workers
   * first, then an orchestrator carrying the team prompt + the workers' session
   * ids — into the caller's own project by default, or a named one. main
   * authorizes the whole launch (team lookup, project validation, per-persona
   * checks, the Rule-5 tab cap). Default OFF — it spawns sibling agents and
   * spends tokens, so it's strictly opt-in; takes effect on the next app launch.
   * When false the tool is not registered (the agent doesn't see it). The
   * operator can always launch a team from the New-agent launcher's autonomous
   * mode regardless.
   */
  teamLaunchEnabled?: boolean;
  /**
   * Master switch for the EXPERIMENTAL Goals feature: when ON, the "Goals"
   * project-scoped nav tab appears (persistent objectives with falsifiable
   * success criteria that spawn worker sessions and self-evaluate). Under
   * evaluation, so it's hidden by default and opted into from the Experimental
   * settings tab. Off ⇒ the Goals tab is not shown; if it was the active
   * project mode, the workspace falls back to Terminals.
   */
  goalsEnabled?: boolean;
  /**
   * Master switch for the EXPERIMENTAL Follow-ups feature: when ON, the
   * "Follow-ups" project-scoped nav tab appears (durable parked questions from
   * idle-triage and other origins). Under evaluation, so it's hidden by default
   * and opted into from the Experimental settings tab. Off ⇒ the Follow-ups tab
   * is not shown; if it was the active project mode, the workspace falls back to
   * Terminals.
   */
  followUpsEnabled?: boolean;
  /**
   * Master switch for the Agent Heartbeat feature: when ON, a per-agent
   * "Heartbeat" toggle appears in the agent inspector (for non-background
   * agents). An agent with heartbeat on that stays idle for
   * {@link heartbeatDelaySeconds} gets a nudge typed into its terminal (the
   * {@link heartbeatMessage}, submitted like an inbox reply) so it resumes on
   * its own. Default OFF — it types into a live session and spends tokens, so
   * it's strictly opt-in. When false, no heartbeat timers ever arm and the
   * per-agent toggle is hidden.
   */
  heartbeatEnabled?: boolean;
  /**
   * Keep the Mac awake while agents are actively working. When ON (the
   * default), the app holds a `prevent-app-suspension` power-save block — the
   * programmatic `caffeinate` — while ≥1 agent is in the `working` state, so
   * locking the screen can't let the system idle-sleep out from under an
   * in-flight turn. The display may still sleep; only the system is pinned. The
   * block is released after a short grace window once every agent goes quiet.
   * Set false to disable entirely (the Mac sleeps on its normal schedule). Absent
   * ⇒ true.
   */
  keepAwakeWhileWorking?: boolean;
  /**
   * Seconds an agent must sit idle before a heartbeat nudge fires (and the
   * interval between repeat nudges while it stays idle). Absent ⇒ 30s.
   * Clamped to 10–600 in {@link normalizeConfig}.
   */
  heartbeatDelaySeconds?: number;
  /**
   * Runaway guard: after this many consecutive nudges with no genuine activity
   * in between, heartbeat auto-disables for that agent and an inbox notice is
   * pushed. The counter resets when the agent resumes on its own / by human
   * input. Absent ⇒ 10. Clamped to 1–100.
   */
  heartbeatMaxNudges?: number;
  /**
   * The text typed into an idle agent on each heartbeat (submitted like an
   * inbox reply: body + Enter). Absent ⇒ a sensible default that tells the
   * agent to continue or to say so and stop if it's blocked / done.
   */
  heartbeatMessage?: string;
  /**
   * Autonomous-team run backstops. Defaults applied in main when a run starts
   * (see AUTONOMOUS_DEFAULTS). A value of 0 disables that backstop.
   */
  autonomousMaxRounds?: number;
  autonomousTimeoutMs?: number;
  /** Idle seconds before the supervisor nudges an agent in an autonomous run. */
  autonomousNudgeDelaySeconds?: number;
  /**
   * Back claude/shell sessions with tmux so they survive an app restart or a
   * dropped SSH connection (Phase 2 of the agent-mesh / persistence plan).
   * Default `'all'` (absent-in-file ⇒ `'all'`). This is a DURABILITY feature,
   * not a performance one — it does not make terminals faster or lighter, it
   * keeps the underlying process alive across restarts and lets a flaky
   * remote link be re-attached. Silently ignored when tmux isn't installed
   * (always on Windows), falling back to a plain node-pty spawn.
   * Scheduled/headless runs never use tmux regardless of this setting.
   * Three values:
   *   - `'off'`: never wrap, local or remote.
   *   - `'remote'`: wrap only SSH-backed sessions — the strongest use case
   *     (surviving a dropped link) — and leave local sessions unwrapped
   *     (skipping the extra tmux server/client for runs that don't need it).
   *   - `'all'`: wrap both local and remote sessions (the historical
   *     `tmuxPersistence: true` behavior).
   * A wake-reconnect to a session that was originally spawned tmux-backed
   * still forces the remote wrap on regardless of this setting (see
   * `reconnectTmuxId` in `pty.ts`) — that box session only exists because
   * persistence was active at first spawn, so re-attaching requires it.
   */
  tmuxScope?: 'off' | 'remote' | 'all';
  /**
   * Global fallback start path for remote (SSH) projects. When a remote project
   * has no per-project `ProjectRemote.remotePath` of its own, both the terminal
   * (the `cd` prefix in the ssh command) and the Explorer browse root start here
   * instead of the remote `$HOME`. Useful when every workspace lives under a
   * fixed root on the dev box — set it once here rather than on every project.
   * Precedence: per-project `remotePath` → this default → remote `$HOME`.
    * Trimmed; when absent or blank, remotes start in their own `$HOME`. The
    * renderer is untrusted, so the value is sanitized in main (no control chars,
    * length-capped) like the per-project field.
   */
  remoteDefaultPath?: string;
  /**
   * Opt-in: forward the zcc-inbox MCP server to REMOTE (SSH) agents over the
   * existing reverse tunnel. When on, a remote claude spawn that wires the
   * hook-callback reverse tunnel ALSO gets the zcc-inbox MCP surface (inbox_push
   * / inbox_ask / inbox_search, agent mesh, follow-ups, library) via an inline
   * `--mcp-config` pointed at the loopback `ssh -R` port, plus the matching
   * `--allowedTools` and inbox-usage guidance — reaching the SAME local MCP
   * server a local agent uses. Default OFF: without it, a remote agent stays
   * MCP-cut-off (the historical behaviour — only fire-and-forget hooks tunnel
   * back). Overseer is deliberately still excluded. The reverse tunnel is a
   * prerequisite, so this is a no-op for a remote spawn that didn't wire one
   * (a shell/cursor/codex profile, or before the MCP server binds).
   */
  remoteMcpEnabled?: boolean;
  /**
   * When on and a thread is running, Enter steers the active turn and
   * Cmd/Ctrl+Enter queues. Default off: Enter always uses `auto`.
   */
  steerActiveThreadOnEnter?: boolean;
  /**
   * Surface `provider/unhandled` timeline rows. Default off; development
   * builds also force this on.
   */
  showUnhandledProviderEvents?: boolean;
  /**
   * Hard ceiling on concurrently-live terminal sessions. Absent ⇒ a
   * memory-aware default derived from physical RAM (see `computeMaxLiveSessions`
   * in `pty.ts`), so the cap scales down on smaller machines instead of the old
   * flat 50. An explicit value overrides the derivation but is still clamped to
   * a safe range so a hand-edited config can't disable the guard. Counts every
   * live pty — visible, headless, and scheduled alike.
   */
  maxLiveSessions?: number;
  /**
   * Per-session V8 heap ceiling (MB), injected as
   * `NODE_OPTIONS=--max-old-space-size` for claude-family spawns. Bounds a
   * runaway agent — and its node subtree, since NODE_OPTIONS is inherited by
   * child node processes (subagents) — so it aborts its own turn at the ceiling
   * rather than growing until the OS memory-pressure killer takes the whole app
   * down. Absent ⇒ {@link SESSION_MEMORY_DEFAULTS.claudeMaxOldSpaceMB}. Set to 0
   * to disable injection (let V8 auto-size from physical RAM, the old behavior).
   * An existing `--max-old-space-size` in the inherited NODE_OPTIONS always wins.
   */
  claudeMaxOldSpaceMB?: number;
  /**
   * Absolute directory that "Import from Git" clones repos into. Absent ⇒ the
   * default `~/zcc-workspace` (the same scratch root the Quick Agent uses).
   */
  cloneRoot?: string;
  /**
   * Public origin (Tailscale Serve URL, Heroku pairing relay, etc.) used to
   * render remote host-daemon join commands and to allowlist Host headers on
   * enroll/WS. The product HTTP API stays loopback-only. Env `ZCC_APP_URL`
   * overrides this when set.
   */
  publicAppUrl?: string;
  /**
   * Shared secret for the outbound pairing-relay tunnel (`wss://<origin>/_zcc/relay`).
   * Must match Heroku `ZCC_RELAY_TOKEN`. Env `ZCC_RELAY_TOKEN` overrides this
   * when set. Authenticates laptop attach; many desktops may share one token
   * (each gets its own session id).
   */
  relayToken?: string;
  /**
   * Routing id for this laptop's pairing-relay session (`/t/<id>`). Persisted so
   * enrolled daemons can reconnect after Zana restarts. Not a Settings field.
   */
  relaySessionId?: string;
  /**
   * Absolute directory that inbox "Download as PDF" writes into. Absent ⇒ the
   * OS Downloads folder. The export saves straight there (no save dialog),
   * uniquely suffixing the filename so it never overwrites an existing file.
   */
  pdfExportDir?: string;
  /**
   * Master switch for voice-input dictation (push-to-talk mic button in the
   * prompt composer). Default OFF — it uses the user's OpenAI API key and costs
   * per audio-minute transcribed. When false, the mic button is hidden entirely
   * (no accidental spend); when true, the button renders and Settings shows the
   * key / model / language sub-settings.
   */
  voiceInputEnabled?: boolean;
  /**
   * OpenAI transcription model to use for voice input. Absent ⇒ 'whisper-1'.
   * Newer options: 'gpt-4o-transcribe', 'gpt-4o-mini-transcribe'.
   */
  voiceModel?: string;
  /**
   * ISO-639-1 language hint for the transcription model (e.g. 'en', 'fr').
   * Absent/empty ⇒ auto-detect (the model infers from the audio). Only sent
   * to the API when non-empty.
   */
  voiceLanguage?: string;
  /**
   * Render the macOS menu-bar tray as a clean frameless popover card (agent
   * mission-control) instead of the native context menu. macOS-only; on other
   * platforms the native menu is always used regardless of this flag. Default
   * OFF while it bakes — flipping it off falls straight back to the native menu
   * (the popover window is lazy, so "off" means it's never created). See
   * `src/main/menubar.ts` and `docs`/library `designs/menubar-popover.md`.
   */
  menubarPopoverEnabled?: boolean;
  /**
   * While a live terminal session's cwd sits inside a local (in-app-authored)
   * extension's working dir, watch its `dist/` and auto pack+reinstall on
   * change — the "author an extension" hot-reload path, so an agent editing
   * its own extension doesn't need an explicit "Reload from source" click or
   * `install_local_extension` call after every edit. Scoped to stay inside
   * Rule 5 (bounded background work): only watches while such a session is
   * open, keyed + refcounted by working dir, released when the last such
   * session exits. Default ON (absent ⇒ true) — cheap insurance with no
   * Settings UI toggle for v1. See `LocalExtensionWatcher`.
   */
  localExtensionHotReloadEnabled?: boolean;
}

/**
 * A single agent row in the menu-bar popover's fleet snapshot. A display-only,
 * cross-project distillation built entirely in main (`MenubarController`) from
 * the pty session record + the debounced agent state + transcript cost — the
 * popover renderer never derives it, so it stays a thin view (Rule 1).
 */
export interface MenubarAgent {
  sessionId: string;
  projectId: string;
  projectName: string;
  /** Project accent color, for the row's project chip tint (may be absent). */
  projectColor?: string;
  /** Session title (renderer-authoritative name is not known to main, so this
   *  is the pty/OSC title — good enough for a glance). */
  title: string;
  /** Debounced agent state from the OSC-title detector. */
  state: AgentState;
  /** Whether the user has starred this agent (favorite = pinned in the popover). */
  favorite: boolean;
  /** Wall-clock ms (epoch) the session started, for a "working · 2m40s" elapsed. */
  createdAt: number;
  /**
   * One-line gloss of what a `blocked` agent is waiting for, sourced from the
   * cached idle-triage verdict (`IdleTriageResult.summary`, ≤80 chars). Present
   * only for `blocked` agents that have a cached verdict — absent otherwise, so
   * the popover degrades to a plain "needs you" (Rule 5: no per-push LLM/fs read,
   * it's a straight in-memory cache lookup in main). Never set for working/done.
   */
  question?: string;
  /**
   * The triage `resolution` for a `blocked` agent (`awaiting-reply`/`done`/…),
   * used by the popover to decide whether to offer the Yes/No quick-actions
   * (only when we actually have a sense of what's being asked). Absent when no
   * verdict is cached.
   */
  resolution?: IdleResolution;
  /**
   * Whether this session accepts a "light" menubar reply. False for background
   * work — scheduled / headless sessions — which the glance surface must not
   * inject input into (a user replying from the menu bar can't see the terminal).
   * Main is authoritative; the popover only uses this to enable/disable the UI.
   */
  repliable: boolean;
}

/**
 * The full menu-bar popover snapshot main pushes to the popover window. Includes
 * the attention/working tallies (also the source of the tray-icon badge) and a
 * compact scheduler summary for the calm state.
 */
export interface MenubarSnapshot {
  /** Agents worth surfacing (blocked + working + done-but-open), attention-first. */
  agents: MenubarAgent[];
  /** Count of agents in the `blocked` (needs-you) state. */
  needsYou: number;
  /** Count of agents actively `working`. */
  working: number;
  /** Total number of configured schedules (for the calm-state summary). */
  scheduleCount: number;
  /** ISO timestamp of the soonest upcoming scheduled run, or null. */
  nextRunAt: string | null;
  /** Active theme so the popover matches the app without its own config read. */
  theme: 'dark' | 'light';
}

/**
 * Outcome of a `menubar:reply` — the light-interaction write path. `ok:true`
 * means the text reached the agent's stdin; on refusal `reason` says why (so the
 * popover can toast "session ended" / "can't reply to background work" rather
 * than silently swallowing the reply).
 */
export interface MenubarReplyResult {
  ok: boolean;
  reason?: 'ended' | 'background' | 'empty' | 'disabled';
}

/**
 * Memory-budget defaults + bounds for live sessions. These bound the two ways a
 * fleet of claude agents can exhaust RAM: too many concurrent sessions, and any
 * one session's heap growing without limit. See `pty.ts` for the derivation.
 */
export const SESSION_MEMORY_DEFAULTS = {
  /** Default per-session V8 heap ceiling (MB) for claude spawns. */
  claudeMaxOldSpaceMB: 4096,
  /** Floor for an explicit `maxLiveSessions` — never fewer than this. */
  minLiveSessions: 2,
  /**
   * Default live-session cap on a machine with ample RAM. The RAM-aware
   * derivation only pulls BELOW this on memory-constrained machines; a roomy
   * box defaults here rather than to the fd ceiling. Operators can still
   * override up to {@link maxLiveSessionsCeiling} in Settings.
   */
  defaultLiveSessions: 30,
  /** Hard ceiling for `maxLiveSessions`, derived or explicit (fd guard). */
  maxLiveSessionsCeiling: 50,
  /**
   * Approx. steady-state memory we budget per live claude session (MB) when
   * deriving the cap. Well under the per-session heap ceiling
   * ({@link claudeMaxOldSpaceMB}) — that 4GB cap is the hard per-process
   * backstop, while typical idle/working sessions sit far lower, so the
   * derivation budgets against realistic steady-state, not the worst case.
   */
  perSessionBudgetMB: 1024,
  /** Fraction of physical RAM the session fleet may claim when deriving the cap. */
  ramFractionForSessions: 0.5
} as const;

/** Defaults for the Agent Heartbeat feature (used when the config field is absent). */
export const HEARTBEAT_DEFAULTS = {
  delaySeconds: 30,
  maxNudges: 10,
  message:
    'Continue with your task. If you are blocked or genuinely finished, say so explicitly and stop.'
} as const;

/** Defaults + bounds for the automatic idle-agent close feature. */
export const AUTO_CLOSE_IDLE_DEFAULTS = {
  minutes: 15,
  minMinutes: 1,
  maxMinutes: 240
} as const;

/** Which `.claude/settings*.json` file we're reading or writing. */
export type ClaudeSettingsScope = 'shared' | 'local';
export type ClaudeProjectFileId = 'instructions' | 'mcp' | 'shared-settings' | 'local-settings';

/**
 * Curated subset of `.claude/settings.json` we surface in the UI. Anything
 * else remains on disk so atomic edits don't clobber user-edited keys (env,
 * hooks, outputStyle, etc.).
 */
export interface ClaudeProjectSettings {
  permissions?: {
    allow?: string[];
    deny?: string[];
    defaultMode?: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';
    additionalDirectories?: string[];
  };
  model?: string;
  /** Names of top-level keys we don't surface; values stay main-owned. */
  _unknown?: string[];
  /** Names of permission keys we don't surface; values stay main-owned. */
  _unknownPermissions?: string[];
}

export type ClaudeSettingsResult =
  | { state: 'missing'; settings: ClaudeProjectSettings; hash: string | null }
  | { state: 'valid'; settings: ClaudeProjectSettings; hash: string }
  | { state: 'invalid'; message: string }
  | { state: 'io-error'; message: string };

export interface CodexProjectSettings {
  model?: string;
  approvalPolicy?: 'untrusted' | 'on-request' | 'never';
  sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access';
  _unknown?: string[];
}

export type CodexSettingsResult =
  | { state: 'missing'; settings: CodexProjectSettings; hash: null }
  | { state: 'valid'; settings: CodexProjectSettings; hash: string }
  | { state: 'invalid'; message: string }
  | { state: 'io-error'; message: string };

export interface OpenCodeProjectSettings {
  model?: string;
  smallModel?: string;
  defaultAgent?: string;
  _unknown?: string[];
}

export type OpenCodeSettingsResult =
  | { state: 'missing'; settings: OpenCodeProjectSettings; hash: null }
  | { state: 'valid'; settings: OpenCodeProjectSettings; hash: string }
  | { state: 'invalid'; message: string }
  | { state: 'io-error'; message: string };

/** Per-project overrides passed to the claude CLI when launching a session. */
export interface ProjectSettings {
  /** Text appended to the system prompt (--append-system-prompt). */
  appendSystemPrompt?: string;
  /** Extra CLI arguments appended verbatim. */
  extraArgs?: string[];
  /** Additional directories to add to the context (--add-dir). */
  addDirs?: string[];
  /** Allowed tools (--allowedTools). */
  allowedTools?: string[];
  /** Denied tools (--deniedTools). */
  deniedTools?: string[];
  /** Native PI provider override for this project. */
  piProvider?: string;
  /** Native PI model/pattern override for this project. */
  piModel?: string;
  /** Native PI thinking-level override for this project. */
  piThinking?: 'default' | 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** Model override for this project (--model / codex -m). */
  model?: string;
  /** Portable model level resolved by whichever harness launches in this project. */
  modelLevel?: 'low' | 'medium' | 'high' | 'extra-high';
  /** Permission mode override for this project. */
  permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';
  /** Portable execution override. Takes precedence over legacy provider-specific settings. */
  executionState?: 'plan' | 'interactive' | 'accept-edits' | 'autonomous';
  /** Codex sandbox policy → `-s/--sandbox` (codex base profiles only). */
  codexSandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
  /** Codex approval policy → `-a/--ask-for-approval` (codex base profiles only). */
  codexApproval?: 'untrusted' | 'on-request' | 'never';
  /**
   * Per-project override for the launcher's worktree-isolation default. When set,
   * it wins over the global {@link AppConfig.worktreeIsolationDefault} for this
   * project's launcher — e.g. a shared monorepo can default agents into worktrees
   * even when the global default is off. Absent ⇒ inherit the global default.
   */
  worktreeIsolation?: boolean;
  /**
   * SSH remotes only. When true, new threads run the harness on this machine
   * and execute file/shell tools on the remote over the existing SSH
   * ControlMaster path. Off (default) keeps SSH PTY (`ssh -t`) for the CLI.
   * Ignored once the project is bound to an enrolled host daemon.
   */
  remoteToolProxy?: boolean;
  /**
   * Per-project default microVM image for agents launched in the `'microvm'`
   * environment (an allowlist key or allowlisted ref). ADVISORY: main
   * re-authorizes it against the closed image allowlist before spawn (Rule 1).
   * Lowest-priority override — an explicit launcher image or a persona's
   * {@link Persona.microVmImage} wins over it. Ignored outside the microVM env.
   */
  microVmImage?: string;
  /** Structured model override keyed by owning harness. */
  harnessRouting?: HarnessModelRoutingV1;
  /** Canonical adapter-owned project overrides. Legacy fields remain readable during migration. */
  harnesses?: {
    byId?: Partial<Record<HarnessFamily, { compatibility?: {
      model?: string; permissionMode?: string; appendSystemPrompt?: string;
      extraArgs?: string[]; addDirs?: string[]; allowedTools?: string[]; deniedTools?: string[];
      codexSandbox?: string; codexApproval?: string; provider?: string; thinking?: string;
    } }>>;
  };
}

export interface CreateTerminalRequest {
  projectId: string;
  profile: LaunchProfileId;
  /** Distinguishes an operator profile pick from a renderer-seeded default. */
  profileSource?: LaunchProfileSource;
  /**
   * Optional persona to launch as. When set, the main process resolves it
   * against the persona store and inserts the persona's flag layer between the
   * AppConfig globals and the per-project settings (see `personaArgs` in
   * `pty.ts`). `profile` is still used as the base command unless the persona
   * declares its own `baseProfile`.
   */
  personaId?: string;
  /**
   * Optional FRAMEWORK PRESETS to launch under (Advanced Quick Agent). Each names
   * an installed extension whose manifest declares an `agentPreset`
   * ({@link ExtensionManifestView.agentPreset}). main resolves them against its own
   * extension registry (NEVER trusting a renderer-supplied primer — Rule 1) and
   * MERGES their primers, in the given order, into ONE host-stamped synthetic
   * persona whose `appendSystemPrompt` is the joined primer, launched through the
   * standard persona path so the frameworks' system prompts are injected via a
   * single `--append-system-prompt`. When a `personaId` is ALSO supplied, the
   * explicit persona wins and the frameworks are ignored (a persona already
   * carries its own full launch intent). Unknown / preset-less ids are skipped
   * (dropped from the merge), never an error; an all-empty list is a bare launch.
   */
  frameworkIds?: string[];
  cols: number;
  rows: number;
  extraArgs?: string[];
  /** Structured model intent for this launch. Highest-precedence routing layer. */
  harnessRouting?: HarnessModelRoutingV1;
  title?: string;
  cwd?: string;
  /**
   * Provider-native EXACT-session resume target — the prior session id to reopen
   * instead of the profile's blunt most-recent resume. Used by session restore
   * for a profile whose resume dialect is a POSITIONAL subcommand the launcher
   * can't append to `extraArgs` (codex: `resume <uuid>`, from the detected
   * {@link TerminalSession.codexSessionId}). Claude's per-tab resume rides
   * `extraArgs` (`--resume <claudeSessionId>`) instead, so this is codex-only
   * today. Only selects WHICH prior session the CLI reopens — the CLI validates
   * it — so it's never a path/trust anchor (Rule 1).
   */
  resumeSessionId?: string;
  /**
   * When set (Quick Agent only), main mints a fresh unique subfolder under the
   * scratch workspace and uses it as the cwd, so parallel scratch sessions each
   * get an isolated dir instead of sharing the flat workspace root. Ignored
   * when an explicit `cwd` is supplied. The optional string value seeds a
   * human-readable folder prefix (e.g. the prompt's first words).
   */
  isolateScratch?: boolean | string;
  /**
   * ISOLATED-WORKTREE launch intent (INPUT). When truthy and the target is a
   * LOCAL git project, main mints a linked git worktree of the project on its
   * own branch (under the app-managed `~/zcc-worktrees` root) and launches the
   * agent there instead of the shared project root — so many agents on one repo
   * don't trample each other's working tree. The optional object form pins the
   * stable name (`{ branch }`) used for both `zcc/<name>` and the checkout
   * directory; a bare `true` is retained for older callers and derives a fallback
   * from the launch title/prompt. Named creation failures block launch rather than
   * silently using the shared project root. Ignored for remote projects, non-repo
   * projects, the scratch workspace, and when an explicit `cwd` is supplied. The actual worktree is
   * resolved ASYNCHRONOUSLY by the `terminals:create` IPC handler (git is async),
   * which then hands the resolved checkout to `createTerminalConfined` via
   * {@link worktreeInfo}. Renderer-supplied, so main re-authorizes the whole thing
   * (Rule 1).
   */
  worktree?: boolean | { branch?: string };
  /**
   * RESOLVED worktree (main-internal, never sent by the renderer). Set only by
   * the `terminals:create` handler after it has successfully minted/adopted the
   * worktree for {@link worktree}: carries the realpath'd checkout path + branch
   * so `createTerminalConfined` uses it as the cwd and records it on the session.
   * Distinct from the `worktree` INTENT flag so the sync confined-create path
   * never itself shells git. A renderer-supplied value here is untrusted and
   * MUST be ignored/overwritten by the handler.
   */
  worktreeInfo?: SessionWorktree;
  /**
   * Optional opening prompt for claude-family profiles — appended as the
   * positional `[prompt]` argv element so the spawned interactive session runs
   * it on first turn (e.g. a slash command like `/eq-craft`). Ignored for the
   * `shell` profile, where it would be parsed as a shell command.
   */
  prompt?: string;
  /**
   * Cohort stamp for a {@link Team} launch — set ONLY by `launchTeam` (one per
   * tab it opens). Carries the launch's `cohortId`, the team id/name, and this
   * tab's role. Never set on a user- or scheduler-opened terminal.
   */
  cohort?: SessionCohort;
  /**
   * Open as a background (headless) session. Used by `launchTeam` for WORKER
   * tabs: they stay visible on the Agents board (with the Background badge) but
   * are treated as background like scheduled runs — never nudged by heartbeat,
   * never triaged, and never promoted into the "Needs you" lane. The user only
   * fields the orchestrator; workers report to it. Distinct from `scheduled`
   * (which also hides the tab from the strip); a headless worker is still
   * listed. Absent ⇒ a normal foreground tab.
   */
  headless?: boolean;
  /**
   * Execution environment — WHERE the agent runs (local vs OS kernel sandbox),
   * orthogonal to {@link profile}. Renderer-supplied INTENT; main re-resolves it
   * through `environmentFor` (Rule 1 — a renderer value can only SELECT a
   * registered environment, never define one). Absent/`'local'` ⇒ a plain spawn.
   * `'sandbox'` ⇒ run under a kernel sandbox (Seatbelt on macOS), degrading to a
   * verbatim spawn with an honest {@link TerminalSession.isolationStatus} when the
   * kernel can't enforce it. `'microvm'` ⇒ run inside a microsandbox microVM
   * (async boot; fails closed with a red banner when the runtime is unavailable
   * rather than downgrading — see the microVM env's `createSession`).
   */
  environment?: 'local' | 'sandbox' | 'microvm';
  /**
   * Deny outbound network from the sandboxed agent (sandbox env only). Off by
   * default — a pty agent needs the LLM API + local MCP callbacks. Set for
   * untrusted/no-egress work. Ignored when `environment` isn't `'sandbox'`.
   */
  sandboxDenyNetwork?: boolean;
  /**
   * microVM ADVISORY hints (env `'microvm'`). `microVmImage` is an allowlist key
   * (`'node'`) or an allowlisted ref; cpus/memory are clamped. All re-authorized
   * in main's microVM builder (Rule 1 — renderer INTENT, never a definition).
   * Ignored when `environment` isn't `'microvm'`.
   */
  microVmImage?: string;
  microVmCpus?: number;
  microVmMemoryMib?: number;
}

export interface FsEntry {
  name: string;
  kind: 'file' | 'dir';
  path: string;
}

export interface FsReadResult {
  ok: boolean;
  content?: string;
  bytes?: number;
  binary?: boolean;
  truncated?: boolean;
  message?: string;
}

export interface FsWriteResult {
  ok: boolean;
  bytes?: number;
  message?: string;
}

/**
 * Result of resolving an inbox doc path that didn't exist at its reported
 * location. `rel` is the discovered project-root-relative posix path (e.g. the
 * agent wrote it in a subdir or the library); `relocated` is true when `rel`
 * differs from the reported path. Absent `rel` (with `ok:false`) means no
 * candidate matched anywhere under the project.
 */
export interface FsResolveDocResult {
  ok: boolean;
  /** Discovered path, relative to the project root, posix-style. */
  rel?: string;
  /** True when `rel` differs from the reported path (i.e. we relocated it). */
  relocated?: boolean;
  message?: string;
}

/**
 * Result of resolving the browse root of a remote (SSH-backed) project. `root`
 * is the realpath'd absolute path on the remote host that the Explorer seeds
 * its tree from; absent (with a `message`) when the host couldn't be reached or
 * the start path doesn't exist.
 */
export interface RemoteRootResult {
  ok: boolean;
  root?: string;
  message?: string;
}

/**
 * Result of running a one-shot shell command on a remote (SSH-backed) project
 * (the `remote_exec` MCP tool / `execRemote`). `ok` reflects whether the ssh
 * round-trip itself succeeded (spawned, didn't time out) — NOT the remote
 * command's exit status, which is carried separately in `code` so the caller
 * can distinguish a transport failure from a command that ran and exited
 * non-zero. `stdout`/`stderr` are UTF-8, each capped; `truncated` is set when
 * either stream hit the cap.
 */
export interface RemoteExecResult {
  ok: boolean;
  /** Remote command's exit code (null if killed by signal); absent when `ok` is false. */
  code?: number | null;
  stdout?: string;
  stderr?: string;
  /** True when stdout/stderr was clipped at the byte cap. */
  truncated?: boolean;
  /** Present only when `ok` is false — the transport-level failure reason. */
  message?: string;
}

/**
 * Result of an upload (local→remote) or download (remote→local) transfer.
 * `path` is the destination side: the final remote path for an upload, the
 * saved local path for a download. `bytes` is the transferred size.
 */
export interface RemoteTransferResult {
  ok: boolean;
  path?: string;
  bytes?: number;
  /** True when the user cancelled the save dialog (download) — not an error. */
  canceled?: boolean;
  message?: string;
}

/** Result of a create / rename / delete operation. `path` is the resolved target. */
export interface FsMutateResult {
  ok: boolean;
  path?: string;
  message?: string;
}

export interface FsReadDataUrlResult {
  ok: boolean;
  dataUrl?: string;
  bytes?: number;
  message?: string;
}

export interface WalkedFile {
  rel: string;
  path: string;
}

export interface SearchOptions {
  caseSensitive?: boolean;
  regex?: boolean;
}

export interface SearchHit {
  rel: string;
  path: string;
  line: number;
  column: number;
  match: string;
  preview: string;
}

export interface SearchResult {
  hits: SearchHit[];
  scanned: number;
  truncated: boolean;
}

export type OpenTarget = 'cursor' | 'code' | 'intellij' | 'finder' | 'terminal' | 'browser';

export interface OpenResult {
  ok: boolean;
  message?: string;
}

/**
 * Payload for `inbox.exportPdf`. The renderer serializes the already-rendered
 * inbox detail into a self-contained HTML document (inlined CSS, mermaid SVGs,
 * highlighted code) and passes it here for the main process to print to PDF.
 */
export interface InboxPdfExport {
  /** Full standalone HTML document to render and print. */
  html: string;
  /** Base filename (without extension) for the written PDF. */
  suggestedName: string;
}

export interface InboxPdfExportResult {
  ok: boolean;
  /** Absolute path the PDF was written to, when ok. */
  path?: string;
  /** Absent on user-cancel; set when something actually failed. */
  message?: string;
}

// Per-file git status code, matching VSCode's surface:
//   M = modified (staged or unstaged)
//   A = added (staged new file)
//   D = deleted
//   R = renamed
//   ? = untracked
//   ! = ignored (we don't surface these by default)
//   C = conflict (unmerged)
export type GitFileCode = 'M' | 'A' | 'D' | 'R' | '?' | 'C';

export interface GitStatus {
  branch: string | null;
  detached: boolean;
  ahead: number;
  behind: number;
  dirty: boolean;
  // Repo absolute path (toplevel) + per-file map keyed by absolute path. The
  // tree decoration consumer can look up `files[entry.path]` directly.
  toplevel?: string;
  files?: Record<string, GitFileCode>;
}

/**
 * One commit read from `git log`, for the Activity Feed. Read-only; produced by
 * `getRecentCommits` in `src/main/git.ts` (the feed's only greenfield git use —
 * the rest of git.ts is status/show/discard). `ts` is epoch ms of the commit
 * (author date). Bounded: callers cap the count so a huge history can't blow up
 * the read (CLAUDE.md rule 5).
 */
export interface GitCommit {
  /** Full 40-char SHA. */
  hash: string;
  /** Abbreviated SHA (first 7). */
  shortHash: string;
  /** Author name. */
  author: string;
  /** Commit author date, epoch ms. */
  ts: number;
  /** First line of the commit message. */
  subject: string;
}

export interface ClaudeSessionSummary {
  id: string;
  projectPath: string;
  startedAt: number;
  lastActiveAt: number;
  messageCount: number;
  firstUserPrompt: string | null;
  /**
   * The session's short name as shown by Claude Code — its `/rename`
   * (`custom-title`) value if the user set one, else Claude's auto-generated
   * `ai-title`. Null when the transcript has neither. The resume/agents pickers
   * prefer this over {@link firstUserPrompt} so a renamed session shows the
   * short given name, not its long opening prompt.
   */
  title: string | null;
}

/** A resumable native OpenCode session, listed by OpenCode's own CLI. */
export interface OpenCodeSessionSummary {
  /** OpenCode's server-minted `ses_<hex>` identifier. */
  id: string;
  title: string;
  startedAt: number;
  lastActiveAt: number;
}

export type ConversationHistorySource = 'claude' | 'opencode';
export type ConversationHistoryProviderState =
  | 'loading'
  | 'fresh'
  | 'empty'
  | 'unsupported'
  | 'timed-out'
  | 'failed'
  | 'pagination-limited';

/** Renderer-safe native-conversation projection. Native ids and paths stay in main. */
export interface ConversationHistoryRow {
  historyId: string;
  source: ConversationHistorySource;
  title: string;
  lastActiveAt: number | null;
  projectName: string;
  fidelity: 'exact-native-id';
  availability: 'available' | 'unavailable';
  unavailableReason?: string;
}

export interface ConversationHistoryCoverage {
  source: ConversationHistorySource;
  description: string;
  state: ConversationHistoryProviderState;
}

export interface ConversationHistorySnapshot {
  snapshotId: string;
  status: 'pending' | 'provisional' | 'ready' | 'expired';
  rows: ConversationHistoryRow[];
  coverage: ConversationHistoryCoverage[];
  snapshotAt?: number;
  hasNextPage: false;
}

export interface ConversationHistoryStartInput {
  /** Native conversations retain cwd-specific assumptions, so only project scope is supported. */
  projectId?: string;
  filter: 'project';
}

export interface GitDiscardResult {
  ok: boolean;
  message?: string;
}

export interface GitWorkflowResult {
  ok: boolean;
  message: string;
  branch?: string;
}

export interface GitCommitPreview {
  id: string;
  projectId: string;
  branch: string | null;
  revision: string;
  writeSet: Array<{ path: string; code: GitFileCode }>;
  expiresAt: number;
}

/**
 * One linked working tree of a repository, as reported by
 * `git worktree list --porcelain`. The main checkout has `isMain: true`.
 * `branch` is the short name (no `refs/heads/`), null when detached or bare.
 */
export interface Worktree {
  /** Absolute (realpath'd) path of the working tree's root. */
  path: string;
  /** Checked-out commit SHA, null for a bare entry. */
  head: string | null;
  /** Short branch name, or null when detached/bare. */
  branch: string | null;
  detached: boolean;
  bare: boolean;
  /** True for the repository's primary (non-linked) working tree. */
  isMain: boolean;
}

/**
 * One local branch of a repository, as reported by `git for-each-ref
 * refs/heads`. `current` is true for the branch checked out in the working tree
 * the enumeration was run from. The Explorer joins these against {@link Worktree}
 * (by branch name) to show which checkout a branch is assigned to.
 */
export interface GitBranch {
  /** Short branch name (no `refs/heads/`). */
  name: string;
  /** True for the branch checked out in the enumerating working tree. */
  current: boolean;
}

/**
 * Outcome of minting an isolated git worktree for an agent launch
 * ({@link createWorktree}). On success, `path` is the realpath'd absolute
 * checkout dir (under the app-managed `~/zcc-worktrees` root) and `branch` is the
 * short branch name it was created on. `reused: true` means an existing checkout
 * for that branch was adopted rather than re-created. Failures carry a reason so
 * the launcher can report the failure and preserve launch state.
 */
export type WorktreeCreateResult =
  | { ok: true; path: string; branch: string; reused: boolean }
  | { ok: false; reason: string };

/**
 * Per-session record of the isolated worktree an agent was launched into (set by
 * `createTerminalConfined` when the launch asked for worktree isolation, and the
 * project is a local git repo). Absent on every other session. Surfaced on the
 * Agents board / detail panel and used by the on-close prune to know which
 * managed checkout belongs to a session. `branch` mirrors the checkout's branch.
 */
export interface SessionWorktree {
  /** Realpath'd absolute path of the isolated checkout (under `~/zcc-worktrees`). */
  path: string;
  /** Short branch name the worktree was created on. */
  branch: string;
}

export interface GitShowResult {
  ok: boolean;
  /** UTF-8 contents of the file at HEAD; absent for binary or missing. */
  content?: string;
  /** True when HEAD has no entry for this path (e.g. newly added file). */
  notInHead?: boolean;
  /** True when HEAD blob looks binary; we can't render a text diff. */
  binary?: boolean;
  message?: string;
}

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; code: string; message: string };

/**
 * Outcome of cloning a git repo into a project. On success the repo is cloned
 * AND registered as a project (`project`). DEST_EXISTS means a folder already
 * sat at the destination and was left untouched — `path` points at it so the
 * UI can offer to open it instead.
 */
export type CloneProjectResult =
  | { ok: true; project: Project; reused?: boolean }
  | {
      ok: false;
      code: 'DEST_EXISTS' | 'CLONE_FAILED' | 'BAD_INPUT' | 'ADD_FAILED';
      message: string;
      /** Set for DEST_EXISTS: the existing folder's absolute path. */
      path?: string;
    };

/** Per-fire record persisted in a schedule's status.runs ring buffer. */
export interface ScheduleRun {
  /** Stable per-run id (uuid). Older records may not have it; renderer
   *  falls back to `at + sessionId` for keys. */
  id?: string;
  /** ISO-8601 timestamp of when the fire began. */
  at: string;
  /**
   * `incomplete` = the process exited 0 (so it isn't `error`) but the run never
   * filed a `schedule_report` before exiting, for a schedule that expects one
   * (`inboxLevel !== 'silent'` on a report-capable profile). Exit code alone
   * can't distinguish a clean finish from a stream that died mid-run (e.g. an
   * idle-dropped SSE connection) — a dead run can still exit 0 — so `incomplete`
   * is the loud, honest label for "we don't actually know this succeeded."
   */
  result: 'success' | 'error' | 'skipped' | 'incomplete';
  /** PtyManager session id, if a terminal was actually spawned. */
  sessionId?: string;
  /** Time from spawn to pty exit (only set once the session ends). */
  durationMs?: number;
  /**
   * ISO-8601 time the agent's turn ended (Stop hook), independent of pty exit.
   * Set for interactive scheduled runs that finish their turn but stay open at
   * the prompt — lets the UI show "done · session open" rather than "running"
   * forever. Absent until the agent stops (claude profiles).
   */
  finishedAt?: string;
  /** Free-text reason — populated for `error` and `skipped`. */
  message?: string;
  /**
   * Agent-authored markdown summary of what this run did. Set via the
   * `schedule_report` MCP tool, keyed by `sessionId`. This is a human-readable
   * report, NOT pty output. Absent until the agent files one (claude profiles).
   */
  report?: string;
  /** ISO-8601 time the report was attached. */
  reportedAt?: string;
  /** Agent's self-assessment of the run, independent of the pty exit code. */
  reportStatus?: 'success' | 'partial' | 'failure';
}

export interface ScheduleStatus {
  lastRunAt?: string;
  lastRunResult?: 'success' | 'error' | 'skipped' | 'incomplete';
  lastRunSessionId?: string;
  /** ISO-8601 timestamp of the next planned fire (informational; recomputed on load). */
  nextRunAt?: string;
  runCount: number;
  /** Newest first. Capped at history.retain (default 10). */
  runs: ScheduleRun[];
}

/**
 * One scheduled task. Persisted as JSON at:
 *  - `~/.zcc/schedules/<id>.json` (global), or
 *  - `<project.path>/.zcc/schedules/<id>.json` (per-project, optional).
 *
 * Hand-editable. The scheduler runs entirely in the Electron main process via
 * setTimeout — no OS cron daemon. When the app exits, fires stop; on next
 * launch, schedules are re-loaded from disk and the next fire is computed: for
 * `every` from `status.lastRunAt`, for `cron` from the expression's next
 * wall-clock slot (with a single boot catch-up for a slot missed while down).
 */
export interface ScheduledTask {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  /** Project to spawn the terminal in (FK into projects.json). */
  projectId: string;
  profile: LaunchProfileId;
  /**
   * Optional persona to launch this scheduled run as. Resolved against the
   * persona store at fire time; its `baseProfile` (if any) overrides `profile`.
   * Absent = launch the bare `profile`, as before.
   */
  personaId?: string;
  extraArgs?: string[];
  /** Optional initial prompt — typed into the pty on first data event. */
  prompt?: string;
  /**
   * When to fire. Exactly ONE of `every` / `cron` is set:
   *  - `every` — human interval ("5m", "1h", "1h30m"). Fires N after the last
   *    run; drifts relative to wall-clock (see {@link parseEvery}).
   *  - `cron` — 5-field cron expression ("0 9 * * 1-5"), optionally in `tz`
   *    (IANA zone). Fires at wall-clock-aligned times / calendar days. Because
   *    the scheduler is in-process (no daemon), a cron slot that falls while the
   *    app is closed is caught up once on next launch, not replayed per missed
   *    slot (see {@link nextCronRunAt} and the scheduler's boot catch-up).
   * The store's `validateScheduleFile` and the manager's create/update enforce
   * the exactly-one invariant; older files carry only `every`.
   */
  schedule: {
    /** Human-friendly interval. Examples: "5m", "1h", "24h", "300000ms". Min 60s. */
    every?: string;
    /** 5-field cron expression. Mutually exclusive with `every`. */
    cron?: string;
    /** IANA timezone for `cron` (e.g. "Europe/Paris"). Omitted = host local. */
    tz?: string;
  };
  /** Only 'skip' is honored in v1; the field is reserved for future modes. */
  overlap: 'skip';
  history: {
    retain: number;
  };
  status: ScheduleStatus;
  /** ISO-8601. */
  createdAt: string;
  /** ISO-8601. */
  updatedAt: string;
  /** Set by the loader for UI display; not persisted. */
  source?: 'global' | { projectId: string };
  /**
   * How loudly this schedule's runs surface in the inbox. Governs BOTH the
   * scheduler's own run-completion summary AND any `inbox_push` the agent makes
   * during a scheduled run:
   *  - `silent` — nothing recorded.
   *  - `quiet` (default) — recorded in the collapsed "Scheduled" group, no badge.
   *  - `loud` — surfaced inline and counted in the unread badge.
   * Replaces the legacy boolean `notifyInbox` (migrated on load: true→loud,
   * false/absent→quiet). See {@link InboxNotifyLevel}.
   */
  inboxLevel?: InboxNotifyLevel;
  /**
   * When true (claude-family profiles only), a Stop hook is injected into the
   * spawned session so the terminal auto-closes once Claude finishes its
   * response. Without it, a scheduled `claude` tab idles open forever — the
   * interactive CLI never exits on its own. Default false.
   */
  autoCloseOnFinish?: boolean;
  /**
   * Group id ({@link ScheduleGroup}) for organising global schedules in the
   * rail (e.g. "Personal" / "Work"). Absent or unresolvable = Ungrouped.
   * Ignored for project-scoped schedules.
   */
  group?: string;
  /**
   * Set when this row is NOT a native zcc schedule but a foreign cron the app
   * only mirrors for visibility — currently a Claude Code `/loop` job read from
   * `.claude/scheduled_tasks.json`. The app does NOT own its timer: it never
   * fires, enables, edits, or deletes it (the Claude harness does). The UI
   * renders these as read-only rows with a "Claude" badge and hides the
   * enable/run/edit/delete controls. Absent ⇒ a normal, app-owned schedule.
   *
   * `cron` is the raw 5-field expression (the app's native schedules use a
   * human `every` string instead, so this carries the original for display).
   */
  external?: {
    kind: 'claude-loop';
    /** Raw 5-field cron expression as written in scheduled_tasks.json. */
    cron: string;
    /** The Claude session id that created the loop (for display/attribution). */
    createdBySessionId?: string;
  };
}

export interface ScheduleCreateInput {
  name: string;
  description?: string;
  enabled?: boolean;
  projectId: string;
  profile: LaunchProfileId;
  personaId?: string;
  extraArgs?: string[];
  prompt?: string;
  /** Interval cadence. Provide exactly one of `every` / `cron`. */
  every?: string;
  /** 5-field cron expression. Provide exactly one of `every` / `cron`. */
  cron?: string;
  /** IANA timezone for `cron` (ignored without `cron`). */
  tz?: string;
  /** When omitted, the schedule is written to the global directory. */
  scope?: 'global' | { projectId: string };
  retain?: number;
  /** Inbox loudness; defaults to `quiet` when omitted. See {@link InboxNotifyLevel}. */
  inboxLevel?: InboxNotifyLevel;
  autoCloseOnFinish?: boolean;
  /** Group id (see {@link ScheduleGroup}). Only meaningful for global scope. */
  group?: string;
}

/**
 * A user-defined bucket for grouping global (non-project) schedules — e.g.
 * "Personal" vs "Work". Persisted as a single hand-editable file at
 * `~/.zcc/groups.json`. Groups are an orthogonal axis to scope: a global
 * `ScheduledTask` references one by `group` id; project-scoped schedules ignore
 * grouping (they live under their project). A schedule whose `group` doesn't
 * resolve to a known group is treated as Ungrouped — deleting a group never
 * loses schedules, it just drops them back into the Ungrouped bucket.
 */
export interface ScheduleGroup {
  /** URL-safe slug, unique. Pattern: ^[a-z0-9][a-z0-9_-]{0,32}$. */
  id: string;
  name: string;
  /** Hex color for the dot/pill. */
  color?: string;
  /** Lucide icon name; renderer falls back to a generic icon if unknown. */
  icon?: string;
  /** Ascending display order in the rail. */
  sortIndex?: number;
}

export interface ScheduleGroupInput {
  name: string;
  color?: string;
  icon?: string;
}

/**
 * Reusable preset that pre-fills the New Schedule form. Templates are *seeds*,
 * not running schedules — once a user enables one, it becomes a normal
 * `ScheduledTask` in the schedules store. Discovered from three places:
 *  - built-in catalogue shipped with the app
 *  - `~/.zcc/templates/<id>.json` (user-dropped, hand-editable)
 *  - `<project.path>/.zcc/templates/<id>.json` (project-shipped)
 */
export interface ScheduleTemplate {
  id: string;
  name: string;
  description?: string;
  /** Free-form grouping in the picker UI ("QA", "Maintenance", "Reports"). */
  category?: string;
  /** Lucide icon name. Renderer falls back to a generic icon if missing or unknown. */
  icon?: string;
  defaults: {
    profile: LaunchProfileId;
    every: string;
    prompt?: string;
    extraArgs?: string[];
    /** Used as the default schedule name; user can override before enabling. */
    name?: string;
    description?: string;
  };
  /** Set by the loader for UI display; never read from disk. */
  source?: 'builtin' | 'user' | { projectId: string; projectName?: string };
}

/**
 * A pre-made starter prompt for the Agents-module Quick Agent launcher. Clicking
 * a chip seeds the prompt into the launcher's textarea (still editable before
 * launch). Deliberately separate from {@link ScheduleTemplate} so the two can
 * evolve independently — quick prompts have no schedule, just a one-shot prompt.
 *
 * Discovered builtin ⊕ `~/.zcc/quick-prompts/<id>.json` (user, shadows a
 * builtin by id), mirroring the template/persona stores.
 */
export interface QuickPrompt {
  /** Stable id; `builtin:` prefix marks a shipped prompt a user can shadow. */
  id: string;
  /** Short chip label shown in the launcher. */
  label: string;
  /** The prompt text seeded into the textarea. */
  prompt: string;
  /** Suggested launch profile; the launcher defaults to `claude` when absent. */
  profile?: LaunchProfileId;
  /** Lucide icon name; renderer falls back to a generic icon if unknown. */
  icon?: string;
  /**
   * Optional argument-templating metadata. When present, `prompt` may carry
   * `{{name}}` placeholders (see `packages/domain/src/workflow-args.ts`); applying the
   * chip opens a per-argument fill form before injecting the substituted text.
   * Absent ⇒ a plain flat prompt exactly as before (fully back-compatible).
   */
  arguments?: WorkflowArgument[];
  /** Set by the loader for UI display; never read from disk. */
  source?: 'builtin' | 'user';
}

/**
 * Which transport an {@link LlmPromptEntry} runs through. v1 ships only
 * `claude-cli` (a headless `claude --print` spawn that reuses the user's
 * existing Claude Code auth). The others are reserved seams — adding one is a
 * new provider file behind the same `LlmProvider` interface, not a refactor.
 */
export type LlmProviderId = 'claude-cli' | 'anthropic-sdk' | 'openai' | 'gemini';

/**
 * A reusable "LLM micro-call" definition — a lightweight, prompt-registry
 * analog of a full agent, pared down to what a single one-shot call needs.
 * Built-ins ship in code (`builtin:` id prefix) and are editable by shadowing:
 * a JSON file with the same `id` in `~/.zcc/llm-prompts/` overrides one.
 *
 * The call is sub-agent-shaped: fill `{{var}}` placeholders in `userTemplate`
 * from the caller's vars, send `systemPrompt` + the filled user text to the
 * provider, get one text output back. The first consumer is `builtin:tab-namer`
 * (name a tab from its first instruction).
 */
export interface LlmPromptEntry {
  /** Stable id; `builtin:` prefix marks a shipped prompt a user can shadow. */
  id: string;
  /** Short label shown in the Prompts settings tab. */
  label: string;
  /** Optional human description of what the prompt does. */
  description?: string;
  /** Transport to run through; defaults to `claude-cli` when absent. */
  provider?: LlmProviderId;
  /** Model alias (`haiku`/`sonnet`/`opus`) or full id; '' / absent = provider default. */
  model?: string;
  /** The system instruction sent to the model. */
  systemPrompt: string;
  /** User-turn template; `{{var}}` placeholders are filled from caller vars. */
  userTemplate: string;
  /** Hard clamp on the returned text length (cost/safety). Default 2000. */
  maxOutputChars?: number;
  /** Spawn/call timeout in ms. Default 15000. */
  timeoutMs?: number;
  /** Set by the loader for UI display; never read from disk. */
  source?: 'builtin' | 'user';
}

/** The result of one {@link LlmPromptEntry} run via {@link LlmProviderId}. */
export interface LlmRunResult {
  ok: boolean;
  /** Trimmed, clamped output text. Empty on failure. */
  text: string;
  /** Present when `ok` is false. */
  error?: string;
  provider: LlmProviderId;
  model?: string;
  /** Wall-clock duration of the call in ms. */
  ms: number;
  /** Optional token accounting. CLI transport leaves this undefined; SDK/HTTP providers populate it. */
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface VoiceTranscribeResult {
  ok: boolean;
  text: string;
  error?: string;
  ms: number;
}

export interface PersonaHarnessIntentV1 {
  roleTargetId?: string;
  providerTargetId?: string;
  modelTargetId?: string;
  executionTargetId?: string;
  executionState?: 'plan' | 'interactive' | 'accept-edits' | 'autonomous';
  compatibility?: {
    model?: string;
    permissionMode?: string;
    codexSandbox?: string;
    codexApproval?: string;
  };
}

export interface PersonaHarnessRoutingV1 {
  schemaVersion: 1;
  byAdapter: Partial<Record<HarnessFamily, PersonaHarnessIntentV1>>;
}

/** Model intent stored by its owning harness. Target ids never cross adapters. */
export interface HarnessModelRoutingV1 {
  schemaVersion: 1;
  byAdapter: Partial<Record<HarnessFamily, {
    providerTargetId?: string;
    roleTargetId?: string;
    modelTargetId?: string;
    modelLevel?: 'low' | 'medium' | 'high' | 'extra-high';
    executionTargetId?: string;
    executionState?: 'plan' | 'interactive' | 'accept-edits' | 'autonomous';
    /** Harness-native per-agent overrides that cannot be represented by one portable axis. */
    compatibility?: {
      codexSandbox?: string;
      codexApproval?: string;
      /** Exact legacy shared/native values retained without claiming portable semantics. */
      model?: string;
      permissionMode?: string;
    };
  }>>;
}

/**
 * A named, reusable Claude Code personality (Reviewer, Architect, Bug-hunter…)
 * that composes native `claude` CLI flags. A persona is **not** a new launch
 * mechanism — it slots in as one more layer in the precedence chain `pty.ts`
 * already runs (base profile → AppConfig globals → ProjectSettings → PERSONA →
 * per-tab extraArgs). Every field maps to a flag the `claude` CLI already
 * accepts; there is no bespoke runtime.
 *
 * Discovered from three places, precedence-merged by `id` (later wins), exactly
 * like {@link ScheduleTemplate}:
 *  - built-in catalogue shipped with the app (`builtin:` id prefix)
 *  - `~/.zcc/personas/<id>.json` (user-dropped, hand-editable)
 *  - `<project.path>/.zcc/personas/<id>.json` (project-shipped)
 *
 * Field names mirror CU's agent YAML where sensible so a CU agent is roughly
 * mechanically portable to a ZCC persona.
 */
export interface Persona {
  /** Stable id; `builtin:` prefix marks a shipped persona a user can shadow. */
  id: string;
  name: string;
  /** Lucide icon name; renderer falls back to a generic icon if unknown. */
  icon?: string;
  description?: string;
  /**
   * Which of the four base profiles this persona builds on. The persona's flag
   * layer is added on top of this profile's base command/args. Default `claude`.
   * `claude-yolo` ignores `permissionMode` (it forces skip-permissions).
   */
  baseProfile?: LaunchProfileId;
  /**
   * Model override → the harness's model flag (claude `--model`, codex `-m`).
   * Provider-dialect string: claude accepts its family aliases
   * (`opus`/`sonnet`/`haiku`), codex accepts a concrete model id (e.g. `o3`,
   * `gpt-5-codex`); the picker options come from {@link providerUiSchema} per
   * base profile. `'default'` (or absent) means "emit no model flag".
   */
  model?: string;
  /** Permission mode → `--permission-mode` (ignored for `claude-yolo`). */
  permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';
  /**
   * Codex sandbox policy → `-s/--sandbox`. Codex's counterpart to claude's
   * `permissionMode` (the two providers gate execution differently). Ignored by
   * non-codex base profiles. Absent ⇒ emit no `-s` (codex uses its config default).
   */
  codexSandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
  /**
   * Codex approval policy → `-a/--ask-for-approval`. Ignored by non-codex base
   * profiles. Absent ⇒ emit no `-a` (codex uses its config default).
   */
  codexApproval?: 'untrusted' | 'on-request' | 'never';
  /** Portable persona system instructions. Applied where the harness adapter supports them. */
  appendSystemPrompt?: string;
  /** Portable tool allowlist. Supporting adapters merge and dedupe it with other layers. */
  allowedTools?: string[];
  /** Portable tool denylist. Supporting adapters merge denials across layers. */
  deniedTools?: string[];
  /** Portable additional-context directories, applied where supported. */
  addDirs?: string[];
  /**
   * Legacy Claude-local MCP references. Existing values remain readable and are
   * resolved against the launcher's internal registry; unknown names are ignored.
   * New personas do not expose this until MCP references have a real catalogue
   * and harness-neutral delivery contract.
   */
  mcpServers?: string[];
  /**
   * Opening prompt written to the pty after spawn (claude-family only; never
   * for `shell`, where it would run as a command). For non-interactive
   * scheduled runs it's delivered as the positional argv prompt instead.
   */
  initialPrompt?: string;
  /**
   * Default microVM image for this persona when launched in the `'microvm'`
   * environment — an allowlist key (e.g. `'node'`) or an allowlisted ref.
   * ADVISORY: main re-authorizes it against the closed image allowlist before
   * spawn (Rule 1), so an unknown value is rejected, not honored. Lets a persona
   * pin the toolchain its work needs. Ignored outside the microVM env; an
   * explicit launcher image overrides it.
   */
  microVmImage?: string;
  modelLevel?: 'low' | 'medium' | 'high' | 'extra-high';
  executionState?: 'plan' | 'interactive' | 'accept-edits' | 'autonomous';
  harnessRouting?: PersonaHarnessRoutingV1;
  /** Set by the loader/host for UI display; never read from disk / trusted from the renderer. */
  source?: PersonaSource;
}

/**
 * Shape the persona editor sends to `cc.personas.save`. Everything optional but
 * `name`: an `id` keys an in-place edit / built-in shadow, while an absent id
 * mints a new persona with a slug derived from the name. `source` is never
 * accepted from the renderer (the loader stamps it), so it's omitted here.
 */
export type PersonaInput = Omit<Persona, 'id' | 'name' | 'source'> & {
  id?: string;
  name: string;
};

/**
 * Non-sensitive persona metadata — the shape returned by discovery surfaces
 * (the `persona.list` control-plane op and the `list_personas` MCP tool). It
 * deliberately OMITS the launch internals (`appendSystemPrompt`, `allowedTools`,
 * `mcpServers`, …): a discovery caller only needs to pick a persona by id/name,
 * not read its system prompt. Keeping the projected shape in one place means the
 * CLI and MCP tool can't drift on what they expose.
 */
export interface PersonaSummary {
  id: string;
  name: string;
  description?: string;
  baseProfile?: LaunchProfileId;
  model?: string;
  modelLevel?: 'low' | 'medium' | 'high' | 'extra-high';
  executionState?: 'plan' | 'interactive' | 'accept-edits' | 'autonomous';
  /** Provenance (builtin / user / project / extension). Non-sensitive; lets a
   *  discovery surface show the source badge. */
  source?: PersonaSource;
}

/** Project a full {@link Persona} down to its non-sensitive {@link PersonaSummary}. */
export function toPersonaSummary(p: Persona): PersonaSummary {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    baseProfile: p.baseProfile,
    model: p.model,
    modelLevel: p.modelLevel,
    executionState: p.executionState,
    source: p.source
  };
}

/**
 * One row in a {@link Team}: a persona id + how many tabs to open for it. The
 * ZCC mirror of Zana's `slots:[{profileId,quantity}]` and CU's `members[]`.
 */
export interface TeamSlot {
  /** References a {@link Persona.id} (any source); existence validated at launch, not store time. */
  personaId: string;
  /** Tabs to open for this slot; default 1; host clamps to `1..TEAM_SLOT_MAX`. */
  quantity?: number;
  /** Optional tab label override. */
  label?: string;
}

export interface TeamLaunchTaskSlot {
  slotId: string;
  initialTask: string;
  authorizationId?: string;
}

export interface TeamLaunchAuthorizationInputSlot {
  initialTask: string;
}

export interface TeamLaunchAuthorizationResult {
  teamId: string;
  projectId: string;
  slots: Array<TeamLaunchTaskSlot & { personaId: string; authorizationId: string }>;
}

export interface TeamLaunchRequestInput {
  callerPrincipalId: string;
  launchRequestId: string;
  slots: TeamLaunchTaskSlot[];
  policy?: { deadlineMs?: number; maxConcurrent?: number; maxLaunches?: number };
  goal?: string;
  /** Main route adapter stamps this for public structured launches. */
  requirePreauthorization?: boolean;
}

export interface TeamLaunchedWorker {
  sessionId: string;
  cohortId: string;
  slotId: string;
  personaId: string;
  projectId: string;
  authorizationId: string;
}

export interface TeamFailedWorkerSlot {
  slotId: string;
  personaId: string;
  reason: string;
}

export interface LaunchTeamResult {
  launchRequestId: string;
  launched: number;
  cohortId: string;
  workers: TeamLaunchedWorker[];
  failedSlots: TeamFailedWorkerSlot[];
  orchestratorSessionId?: string;
  workerSessionIds: string[];
}

export interface CancelTeamLaunchResult {
  canceledSessionIds: string[];
  pendingSessionIds: string[];
  lifecycleState: 'cancel-pending' | 'canceled';
}

/**
 * A named bundle of personas that opens N terminal tabs when launched — the
 * core "Team" primitive. NOT a daemon: a Team is a registry row, launching
 * opens real tabs via the existing pty path (orchestrator first). Discovered
 * builtin ⊕ `~/.zcc/teams/*.json` ⊕ `<project>/.zcc/teams/*.json` ⊕ extension
 * registrations, mirroring {@link Persona}.
 */
export interface Team {
  /** Stable id; `builtin:` prefix marks a shipped team a user can shadow. */
  id: string;
  name: string;
  /** Lucide icon name; renderer falls back to a generic icon if unknown. */
  icon?: string;
  description?: string;
  /** Persona id opened FIRST; it receives {@link initialPrompt}. */
  orchestratorPersonaId?: string;
  slots: TeamSlot[];
  /** Project to launch into when none is supplied. */
  defaultProjectId?: string;
  /** Opening prompt handed to the orchestrator's tab. */
  initialPrompt?: string;
  /** Set by the loader/host for UI display; never read from disk / trusted from the renderer. */
  source?: PersonaSource;
}

/**
 * Shape the team editor / extension sends. Everything but `name`/`slots` is
 * optional; an `id` keys an in-place edit / built-in shadow, an absent id mints
 * a new team with a slug derived from `name`. `source` is never accepted from
 * the renderer (the loader/host stamps it), so it's omitted here.
 */
export type TeamInput = Omit<Team, 'id' | 'source'> & { id?: string };

/**
 * A Team plus every {@link Persona} it references (its `slots[].personaId` +
 * `orchestratorPersonaId`), bundled into ONE importable/exportable JSON file.
 * This is how a squad travels between environments — e.g. restoring a squad
 * that was removed from this app's built-in catalogue: export it from one
 * install, hand the file to another, import it there. Import writes each
 * persona then the team through the SAME `saveUser` gates as the editor (so a
 * hand-authored bundle is validated exactly like a hand-authored persona/team
 * file), landing in `~/.zcc/personas` + `~/.zcc/teams` — it never touches the
 * app's built-in catalogue. `source` is stripped from both `team` and
 * `personas` (never round-tripped — the loader stamps it fresh on import).
 */
export interface SquadBundle {
  kind: 'zcc-squad-bundle';
  /** Bundle format version; 1 for the current shape. */
  version: 1;
  team: TeamInput & { id: string };
  personas: Array<PersonaInput & { id: string }>;
}

/**
 * Non-sensitive team metadata — the shape returned by discovery surfaces (the
 * `team.list` control-plane op and the `list_teams` MCP tool). OMITS the launch
 * internals (`slots`, `initialPrompt`, `orchestratorPersonaId`); a discovery
 * caller only needs to pick a team by id/name and see how big it is.
 */
export interface TeamSummary {
  id: string;
  name: string;
  description?: string;
  /** Number of slot rows (NOT the total tab count — slots may have quantity > 1). */
  slotCount: number;
  source?: PersonaSource;
}

/**
 * A "squad" — a Zana *daemon* team template, discovered read-only from
 * `~/.zana/teams/*.json` (the registry the `/zana:team` slash command resolves
 * against). DISTINCT from {@link Team}: a Team (above) opens N terminal tabs via
 * the app's own pty path; a Squad is run by a SINGLE agent that orchestrates the
 * roster in-session via `/zana:team <id>`. The launcher lists squads so the user
 * can seed one agent to run the whole team. Only non-sensitive metadata is
 * surfaced (no slots/prompts — the renderer just needs to pick one by id).
 */
export interface SquadSummary {
  id: string;
  name: string;
  /** Emoji or icon hint from the daemon team file; renderer may show it verbatim. */
  icon?: string;
  description?: string;
  /** Σ slot quantity — the number of worker agents the squad spawns. */
  workerCount: number;
}

/** Lifecycle state of an autonomous team run. */
export type AutonomousRunState = 'running' | 'completed' | 'stopped' | 'failed';

/** Why an autonomous run ended (set once, when it leaves `running`). */
export type AutonomousRunStopReason =
  | 'goal-reached'
  | 'max-rounds'
  | 'timeout'
  | 'manual'
  | 'orchestrator-gone';

/** Hard backstops for one run. A value of 0 disables that backstop. */
export interface AutonomousRunLimits {
  /** Max total nudges across the whole run before it is stopped. 0 = no cap. */
  maxRounds: number;
  /** Wall-clock budget in ms before the run is stopped. 0 = no timeout. */
  timeoutMs: number;
}

/**
 * One autonomous team run: an orchestrator session plus its worker sessions,
 * driven toward `goal` by the main-process supervisor. In-memory only (like the
 * agent registry / message log) — a run dies with the app.
 */
export interface AutonomousRun {
  runId: string;
  teamId: string;
  projectId: string;
  /** The user's goal, verbatim (trimmed + length-capped in main). */
  goal: string;
  orchestratorSessionId: string;
  workerSessionIds: string[];
  state: AutonomousRunState;
  startedAt: number;
  endedAt?: number;
  /** Total nudges issued across the run (the maxRounds counter). */
  rounds: number;
  stopReason?: AutonomousRunStopReason;
  limits: AutonomousRunLimits;
  /** The orchestrator's close summary, when the run completed via goal-reached. */
  summary?: string;
}

/**
 * One Task-tool sub-agent under a parent session, captured from the
 * PreToolUse(Task) hook's `tool_input`. Identity is best-effort: when the hook
 * payload is absent/malformed the child is still tracked (so the count stays
 * exact) but `description`/`subagentType` are undefined and the view falls back
 * to the count badge. The canonical store lives in `src/main/agent-status.ts`.
 */
export interface SubagentChild {
  /** Correlation key — stable id for THIS child within its parent session
   *  (`<sessionId>:<ordinal>`). Minted on start; the FIFO start→stop match key. */
  id: string;
  /** Task `tool_input.description` (the prompt headline); undefined when the
   *  payload was absent/over-cap/unparseable. */
  description?: string;
  /** Task `tool_input.subagent_type` (e.g. "code-reviewer"); undefined as above. */
  subagentType?: string;
  /** `'running'` once started; `'done'` briefly retained after SubagentStop
   *  (Rule-5 retention) before eviction. */
  status: 'running' | 'done';
  /** Epoch ms the child started. */
  startedAt: number;
  /** Epoch ms the child stopped; undefined while running. */
  stoppedAt?: number;
}

/**
 * One node in the Squad Flow graph: a live (or recently-exited) agent in the
 * mesh, scoped to one project ("squad"). Fused at build time from the agent
 * registry (identity), the status tracker (live {@link AgentState}), the live
 * session list (title / liveness), and the sub-agent count slice. NEVER
 * persisted — rebuilt from live signals on every read (see `buildSquadFlow`).
 */
export interface SquadFlowNode {
  /** Un-forgeable session id — the stable graph-node key (= {@link AgentRecord.sessionId}). */
  sessionId: string;
  /** Best human label: `handle ?? displayName ?? sessionId` (matches `agentLabel()`). */
  label: string;
  /** Authoritative handle if the agent registered one; else undefined. */
  handle?: string;
  /** Live tab title (drifts); shown as a secondary line. */
  displayName?: string;
  role?: string;
  capabilities?: string[];
  /** Live agent state fused from the status slice (default `'unknown'`). */
  state: AgentState;
  /** Renderer-clock ms the node entered its current state (for "working for 2m"). */
  stateSince?: number;
  /** Count of in-flight Task-tool sub-agents under this node. Authoritative
   *  count (drives the Delegating lane + the fallback badge); may exceed
   *  {@link subagentChildren} length when a child's hook payload was lost. */
  liveSubagents: number;
  /** Per-child sub-agent records when identity was captured from the
   *  PreToolUse(Task) hook (A3). Optional and may be shorter than
   *  {@link liveSubagents}; when empty/absent the view falls back to the count
   *  badge — backward-compatible with the count-only v1. */
  subagentChildren?: SubagentChild[];
  /** True if the backing pty has exited (tombstone — render faded). */
  exited: boolean;
  /** True for the squad orchestrator: the node with the highest out-degree in
   *  the handoff graph, tie-broken by earliest `registeredAt`. Heuristic. */
  isOrchestrator: boolean;
}

/**
 * One directed handoff edge, aggregated from {@link AgentMessage} traffic. An
 * edge (from → to) exists when ≥1 agent→agent message went that direction.
 * Keyed by sessionId pairs so it survives a handle rename mid-session.
 */
export interface SquadFlowEdge {
  fromSessionId: string;
  toSessionId: string;
  /** Number of messages sent along this edge (drives line weight). */
  count: number;
  /** Epoch ms of the most recent message (drives recency highlight / fade). */
  lastTs: number;
  /** True if the most recent message on this edge is still queued (its
   *  {@link AgentMessage.deliveredAt} is undefined). */
  pending: boolean;
}

/**
 * The full runtime graph for one squad (= one project's live mesh). Built by
 * `buildSquadFlow()` in the renderer from existing store slices — no new
 * persistence, no new IPC. A "running squad" is a project with ≥1 live agent.
 */
export interface SquadFlowGraph {
  /** Project this graph is scoped to. */
  projectId: string;
  /** Optional squad-template descriptor when the project is running a known
   *  squad (matched loosely by name); absent when unknown. */
  squad?: SquadSummary;
  nodes: SquadFlowNode[];
  edges: SquadFlowEdge[];
  /** Convenience rollups for the header. */
  summary: {
    total: number;
    working: number;
    blocked: number;
    idle: number;
    exited: number;
  };
  /** Epoch ms the graph was built (one consistent "now" for all relative times). */
  builtAt: number;
}

/** Project a full {@link Team} down to its non-sensitive {@link TeamSummary}. */
export function toTeamSummary(t: Team): TeamSummary {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    slotCount: Array.isArray(t.slots) ? t.slots.length : 0,
    source: t.source
  };
}

export interface ScheduleUpdateInput {
  name?: string;
  description?: string;
  enabled?: boolean;
  projectId?: string;
  profile?: LaunchProfileId;
  /** Persona id, or null to clear (launch the bare profile). Omit to leave unchanged. */
  personaId?: string | null;
  extraArgs?: string[];
  prompt?: string;
  /** Switch to / update interval cadence. Sets `every`, clears `cron`. */
  every?: string;
  /** Switch to / update cron cadence. Sets `cron`, clears `every`. */
  cron?: string;
  /** IANA timezone for `cron`. `null` clears it; omit to leave unchanged. */
  tz?: string | null;
  retain?: number;
  /** Inbox loudness. Omit to leave unchanged. See {@link InboxNotifyLevel}. */
  inboxLevel?: InboxNotifyLevel;
  autoCloseOnFinish?: boolean;
  /** Group id, or null to clear (move to Ungrouped). Omit to leave unchanged. */
  group?: string | null;
}

// ----- Goals -----------------------------------------------------------------

/**
 * Execution engine a {@link Goal} delegates its work to. Only `native` is wired
 * in the MVP; the others are reserved so the data model is stable while the
 * driver registry grows. Core goal logic NEVER branches on a concrete engine
 * name (Rule 6) — non-native drivers live behind a quarantined adapter.
 *  - `native` — zcc owns the loop: spawn a claude session → evaluate → re-spawn.
 *  - `zana-autopilot` — delegate to Zana's goal-driven autopilot, mirror status.
 */
export type GoalDriver = 'native' | 'zana-autopilot';

/**
 * Lifecycle of a goal.
 *  - `draft` — created, not yet armed (no sessions spawned).
 *  - `active` — the loop is running (or will re-arm on the next finish).
 *  - `paused` — armed work suspended by the user; resumable.
 *  - `achieved` — the evaluator confirmed the success criteria. Terminal.
 *  - `exhausted` — hit `maxIterations` without achieving. Terminal.
 *  - `escalated` — stalled (no-progress limit) and handed to the human. Terminal.
 *  - `cancelled` — abandoned by the user. Terminal.
 */
export type GoalStatus =
  | 'draft'
  | 'active'
  | 'paused'
  | 'achieved'
  | 'exhausted'
  | 'escalated'
  | 'cancelled';

/** The evaluator's verdict on one iteration, scored against the criteria. */
export type GoalVerdict = 'pass' | 'partial' | 'fail' | 'unknown';

/**
 * Who works the goal. The MVP only uses `profile` (a bare launch profile);
 * `persona`/`team` binding lands in a later phase but the shape is stable now.
 */
export interface GoalAssignment {
  kind: 'profile' | 'persona' | 'team';
  /** When kind==='profile'. The launch profile to spawn each iteration. */
  profile?: LaunchProfileId;
  /** When kind==='persona'. */
  personaId?: string;
  /** When kind==='team'. */
  teamId?: string;
}

/**
 * One pass of the goal loop: a spawned session plus the evaluator's read of it.
 * Newest-first in {@link Goal.history}, capped at `history.retain`.
 */
export interface GoalIteration {
  /** uuid, stable per iteration. */
  id: string;
  /** ISO-8601 when the iteration's session was spawned. */
  at: string;
  /** The pty session this iteration spawned (absent if the spawn errored). */
  sessionId?: string;
  /** Evaluator verdict once the session finished and was scored. */
  verdict?: GoalVerdict;
  /** Evaluator's one-line rationale for the verdict. */
  rationale?: string;
  /** Evaluator confidence 0..1 (low confidence is treated as not-yet-achieved). */
  confidence?: number;
  /** The agent's own run report (via schedule_report), if it filed one. */
  report?: string;
  /** Wall-clock ms from spawn to finish. */
  durationMs?: number;
  /** ISO-8601 when the agent finished its turn. */
  finishedAt?: string;
  /** Set on a spawn/evaluator error so the row explains itself. */
  error?: string;
}

/**
 * A persistent objective attached to a project. Unlike a {@link ScheduledTask}
 * (which fires on a clock), a goal is event-driven: it spawns a worker, waits
 * for it to finish, runs the evaluator, and re-spawns with feedback until the
 * criteria pass, `maxIterations` is hit, or it stalls (`noProgressLimit`).
 *
 * Persisted as JSON at:
 *  - `~/.zcc/goals/<id>.json` (global), or
 *  - `<project.path>/.zcc/goals/<id>.json` (per-project).
 *
 * Runs entirely in the Electron main process — no daemon. On launch, `active`
 * goals auto-resume (re-arm) the same way schedules reload.
 */
export interface Goal {
  id: string;
  /** Project the worker sessions spawn in (FK into projects.json). */
  projectId: string;
  /** Short human title. */
  title: string;
  /** The objective in prose — handed to the worker as its opening prompt. */
  statement: string;
  /** Falsifiable checks the evaluator scores each iteration against. */
  successCriteria: string[];
  /** Execution engine. Defaults to `native`. */
  driver: GoalDriver;
  assignment: GoalAssignment;
  /**
   * How the loop re-runs. The MVP wires `continuous` (re-spawn immediately on
   * finish, bounded by the caps below). `{ every }` (clocked) and
   * `manual-approve` (human gate before each re-spawn) are reserved.
   */
  cadence: { every: string } | { mode: 'continuous' } | { mode: 'manual-approve' };
  /** Hard ceiling on iterations — runaway/cost safety. */
  maxIterations: number;
  /** Iterations spawned so far. */
  iteration: number;
  /**
   * Consecutive non-improving evaluator verdicts before the goal escalates to
   * the human instead of looping forever on a stuck task.
   */
  noProgressLimit: number;
  status: GoalStatus;
  history: {
    /** Ring cap on {@link iterations}. */
    retain: number;
    /** Newest first. */
    iterations: GoalIteration[];
  };
  /** External engine's own id (Zana goalId / cu run id) when driver != native. */
  externalRef?: string;
  /** ISO-8601. */
  createdAt: string;
  /** ISO-8601. */
  updatedAt: string;
  /** Set by the loader for UI display; not persisted. */
  source?: 'global' | { projectId: string };
}

export interface GoalCreateInput {
  projectId: string;
  title: string;
  statement: string;
  successCriteria: string[];
  /** Defaults to `native`. */
  driver?: GoalDriver;
  /** Defaults to `{ kind: 'profile', profile: 'claude-yolo' }`. */
  assignment?: GoalAssignment;
  /** Defaults to `{ mode: 'continuous' }`. */
  cadence?: Goal['cadence'];
  /** Defaults to a conservative ceiling. */
  maxIterations?: number;
  /** Defaults to a small number of stalled rounds. */
  noProgressLimit?: number;
  /** When omitted, the goal is written to the global directory. */
  scope?: 'global' | { projectId: string };
  retain?: number;
  /** Start armed (status `active`) instead of `draft`. Defaults to false. */
  activate?: boolean;
}

export interface GoalUpdateInput {
  title?: string;
  statement?: string;
  successCriteria?: string[];
  assignment?: GoalAssignment;
  cadence?: Goal['cadence'];
  maxIterations?: number;
  noProgressLimit?: number;
  retain?: number;
}

/* -------------------------------------------------------------------------- */
/* Follow-ups — agent-parked questions / decisions awaiting a human           */
/* -------------------------------------------------------------------------- */

/**
 * A {@link FollowUp}'s lifecycle. `open` is the only non-terminal state; both
 * terminal states are reversible (`setStatus('open')`) if the question resurfaces.
 *  - `open` — waiting on a human (the agent parked a question/decision).
 *  - `resolved` — answered / decided. Terminal.
 *  - `dismissed` — no longer relevant (stale, obsoleted, answered elsewhere). Terminal.
 */
export type FollowUpStatus = 'open' | 'resolved' | 'dismissed';

/** What kind of thing the follow-up captures — drives the icon/label and dedup. */
export type FollowUpKind =
  | 'question' // agent asked something and is idle waiting (the common case)
  | 'decision' // agent wants a go/no-go (commit? merge? deploy?)
  | 'note'; // a manual / informational reminder (no agent waiting)

/**
 * Resume/reopen coordinates for a follow-up's originating agent, captured at
 * create time from the live pty — the durable twin of {@link InboxOrigin}. This
 * is what lets the Follow-ups answer loop reopen the RIGHT agent after its tab
 * is gone: `claudeSessionId` resumes the exact conversation (`claude --resume
 * <id>`) so the answer lands in the transcript that asked the question, and
 * `profile`/`personaId`/`cwd` reconstruct the launch. All fields are
 * host-resolved from the trusted session, NEVER agent-supplied (Rule 1); an
 * absent/stale value just degrades the answer to a lower tier (fresh spawn), it
 * is never a trust anchor.
 */
export interface FollowUpResume {
  /**
   * The originating agent's Claude transcript id. Present ⇒ the follow-up is
   * resumable — answering spawns `claude --resume <claudeSessionId> <answer>`,
   * getting the full prior conversation back with the answer as its next turn.
   * Absent ⇒ not resumable (a fresh, seeded agent is spawned instead).
   */
  claudeSessionId?: string;
  /** Launch profile of the originating session (claude / claude-yolo / …). */
  profile?: LaunchProfileId;
  /** Persona the session was launched as, if any — re-applied on reopen. */
  personaId?: string;
  /**
   * The originating session's working directory. Re-confined to the project on
   * reopen (createTerminalConfined realpath-checks it), so a stale/escaped cwd
   * silently falls back to the project root — never a trust anchor by itself.
   */
  cwd?: string;
}

/**
 * How a follow-up came to exist. Host-stamped from trusted context (the idle
 * verdict, the authenticated MCP session, or the UI) — never from agent
 * free-text — so provenance can't be spoofed. Mirrors the `PersonaSource`
 * host-stamping idiom (CLAUDE.md coupling notes).
 *
 * The `agent` / `idle-triage` variants additionally carry {@link FollowUpResume}
 * coordinates, host-resolved from the live pty at create time. They power the
 * Follow-ups answer loop's "resume the original agent" tier — the answer is
 * delivered into the exact conversation that parked the question, not a stranger
 * seeded from scratch. A `user`-filed follow-up has no originating agent, so no
 * resume coords.
 */
export type FollowUpOrigin =
  | { source: 'idle-triage'; sessionId: string; confidence?: number; resume?: FollowUpResume }
  | { source: 'agent'; sessionId: string; resume?: FollowUpResume }
  | { source: 'user' };

/**
 * A small, persisted record an agent leaves when it reaches idle with a pending
 * question or decision — instead of silently blocking on human review. Unlike a
 * {@link Goal} (an autonomous loop) it has no execution: it's inert until a human
 * (or the agent, via `followup_resolve`) acts on it. The durable twin of the
 * ephemeral "Needs you" idle badge — it survives a kill / app restart.
 *
 * Persisted as JSON at:
 *  - `~/.zcc/followups/<id>.json` (global), or
 *  - `<project.path>/.zcc/followups/<id>.json` (per-project, the default).
 *
 * See `docs/followups-design.md` for the full design.
 */
export interface FollowUp {
  id: string;
  /** Project this belongs to (FK into projects.json). */
  projectId: string;
  /** One-line: the question or decision itself. */
  title: string;
  /** Optional longer body (markdown). */
  detail?: string;
  kind: FollowUpKind;
  status: FollowUpStatus;
  origin: FollowUpOrigin;
  /**
   * Optional concrete answer choices for a `question` / `decision`. When present,
   * the panel renders them as a lettered picker (gated by the experimental
   * `structuredQuestionsEnabled` flag): clicking one RESOLVES the follow-up with
   * that label as its {@link resolution} — the follow-up model is inert (no live
   * pty to inject into), so a pick is recorded as the outcome, not injected. Off
   * / when the flag is disabled, the options still read as text in the detail.
   * A short, human-scannable list; never agent-forgeable free identity.
   */
  options?: string[];
  /**
   * The pty session that prompted this, if any — lets the UI deep-link to the
   * agent tab so the user can answer in context. Best-effort: the session may be
   * long gone by the time the user looks.
   */
  sessionId?: string;
  /** Free-text resolution recorded when the follow-up left `open`. */
  resolution?: string;
  /** ISO-8601. */
  createdAt: string;
  /** ISO-8601. */
  updatedAt: string;
  /** ISO-8601, set when status leaves `open`. */
  resolvedAt?: string;
  /**
   * ISO-8601, set each time a human spawns an agent for this follow-up (the
   * "Spawn agent" button). Drives a short "work in progress" lock in the UI so a
   * second spawn can't be fired within {@link FOLLOWUP_SPAWN_LOCK_MS} of the
   * first — guarding against a double-click / two people both picking it up.
   * Persisted (not just component state) so the lock survives a window reload.
   */
  spawnedAt?: string;
  /**
   * Host-derived coalescing key, scoped to `(projectId, status === 'open')`.
   * Two follow-ups filed under the same key collapse into one refreshed record
   * (title + `occurrences++`) instead of piling up — the durable twin of the
   * inbox {@link InboxEntry.dedupeKey} idiom. NEVER agent free-text: derived in
   * `FollowUpManager` from the host-stamped {@link FollowUpOrigin} (Rule 1).
   * Absent for user-created follow-ups (a human filing twice means two records).
   */
  dedupeKey?: string;
  /**
   * How many times this open follow-up has been re-filed under its
   * {@link dedupeKey}. Absent / 1 in the common case; a `×N` chip surfaces it
   * when > 1 so a recurring question reads as one strong signal, not a pile.
   */
  occurrences?: number;
  /** Set by the loader for UI display; not persisted (mirrors {@link Goal.source}). */
  source?: 'global' | { projectId: string };
}

/**
 * How long (ms) a follow-up stays visually "work in progress" — and its spawn
 * buttons disabled — after {@link FollowUp.spawnedAt}. Shared by the manager's
 * host-stamp and the renderer's lock so the two agree. One minute per the
 * product ask: prevent a second agent launch against the same follow-up within
 * a minute of the first.
 */
export const FOLLOWUP_SPAWN_LOCK_MS = 60_000;

export interface FollowUpCreateInput {
  projectId: string;
  title: string;
  detail?: string;
  /** Optional concrete answer choices — see {@link FollowUp.options}. */
  options?: string[];
  /** Defaults to `'question'`. */
  kind?: FollowUpKind;
  /** Host-stamped by the caller; defaults to `{ source: 'user' }`. */
  origin?: FollowUpOrigin;
  sessionId?: string;
  /** When omitted, the follow-up is written to the global directory. */
  scope?: 'global' | { projectId: string };
}

export interface FollowUpUpdateInput {
  title?: string;
  detail?: string;
  kind?: FollowUpKind;
}

/* -------------------------------------------------------------------------- */
/* Project Activity Feed (per-project, read-only history — LinkedIn-style)    */
/* -------------------------------------------------------------------------- */

/**
 * The kind of milestone a {@link FeedEvent} records. Deliberately a small,
 * curated set of OUTCOME/milestone events — NOT raw status transitions or
 * per-session spawns (those are noise, per the design council; see
 * `.zcc/library/designs/project-activity-feed.md`). Each maps to an icon + a
 * one-line label in the renderer.
 */
export type FeedEventKind =
  | 'commit' // a git commit landed (persisted snapshot; see FeedStore)
  | 'session-finished' // an agent session ended (derived from inbox close breadcrumbs)
  | 'report' // an agent posted an inbox report (derived from the inbox store)
  | 'followup-created' // a follow-up was opened (derived from followups)
  | 'followup-resolved' // a follow-up was resolved/dismissed (derived)
  | 'goal-achieved' // a goal reached its target / escalated (derived from goals)
  | 'library-doc' // a library doc was written (derived from library store)
  | 'schedule-run' // a scheduled run completed (derived from scheduled inbox entries)
  | 'extension-installed' // an extension was installed (persisted)
  | 'extension-uninstalled' // an extension was uninstalled (persisted)
  | 'project-created'; // the project was added to the app (persisted)

/**
 * One entry in a project's activity feed. A read-only, timeline-friendly record
 * of something that happened on the project. Assembled by `FeedService` by
 * MERGING two sources: (a) events DERIVED live from existing stores (inbox,
 * followups, goals, library) — never persisted twice; and (b) a small set of
 * PERSISTED greenfield events with no other home (`commit`, `extension-*`,
 * `project-created`), read from `<project>/.zcc/activity.jsonl`.
 *
 * `id` is stable per source event so the renderer can key rows and de-dupe
 * across refreshes. `ts` is epoch ms (the sort key). `title` is the one-line
 * label; `detail` is optional markdown shown when the row is expanded.
 */
export interface FeedEvent {
  /** Stable id: for derived events, `${kind}:${sourceId}`; for persisted, a uuid. */
  id: string;
  projectId: string;
  kind: FeedEventKind;
  /** Epoch ms — the timeline sort key. */
  ts: number;
  /** One-line label (e.g. "3 commits pushed to 1.0.0", "Goal achieved: …"). */
  title: string;
  /** Optional longer body (markdown) — commit hash/author, resolution note, etc. */
  detail?: string;
  /**
   * Optional one-line "why" / goal the originating work was pursuing (an inbox
   * entry's `intent`, or the session's task title). Shown as a distinct muted
   * line above the detail body so the reader gets context without it being
   * jammed into the report text.
   */
  context?: string;
  /**
   * Originating pty session, when the source event carried one — lets the UI
   * deep-link to the agent tab. Best-effort; the session may be long gone.
   */
  sessionId?: string;
}

/** A persisted greenfield feed event, before the `id` is minted. What agents
 *  NEVER write — the host stamps these from trusted context (Rule 1). */
export interface FeedEventInput {
  projectId: string;
  kind: Extract<
    FeedEventKind,
    'commit' | 'extension-installed' | 'extension-uninstalled' | 'project-created'
  >;
  ts: number;
  title: string;
  detail?: string;
  /** Stable de-dupe key so re-stamping the same commit/extension is idempotent. */
  dedupeKey: string;
}

/** A page of feed events (newest-first), with a cursor for the next page. */
export interface FeedPage {
  events: FeedEvent[];
  /** True when older events remain beyond this page. */
  hasMore: boolean;
}

/** The structured weekly recap the `builtin:feed-digest` micro-call returns. */
export interface FeedDigest {
  /** One-line gist of the period. Always present. */
  headline: string;
  /** Up to 6 terse "what happened" bullets. */
  highlights: string[];
}

/** Result of a feed digest call. `ok:false` carries a reason the card shows. */
export type FeedDigestResult =
  | { ok: true; digest: FeedDigest; eventCount: number }
  | { ok: false; reason: 'empty' | 'summary-failed' };

/** The interactive-harness credential families (Settings → Harness auth). */
export type HarnessAuthKey = 'claude' | 'codex' | 'cursor';

/**
 * Renderer-safe status of a harness's stored auth (Settings → Harness): the
 * non-secret base URL, plus whether a token is configured (stored OR present in
 * the ambient env) — NEVER the token itself (Rule 1; the secret never leaves
 * main). Mirror of `HarnessAuthStatus` in `src/main/harness-auth.ts`.
 */
export interface HarnessAuthStatusInfo {
  key: HarnessAuthKey;
  /** The stored base URL (non-secret), if any. */
  baseUrl?: string;
  /** Whether a token is configured (stored or ambient). Never the token value. */
  hasToken: boolean;
}

export type SkillSource = 'user' | 'plugin' | 'project';

/**
 * The agent tool a skill belongs to — Claude Code, Cursor, and (in future)
 * Codex/Gemini/Windsurf. Core NEVER hardcodes a concrete id in logic: skill
 * discovery is dispatched through the `SKILL_PROVIDERS` registry
 * (`src/main/skills/registry.ts`), and the renderer derives its tool filters
 * from the distinct `tool` values present in the returned entries. Widened to
 * `string` so an unregistered/future tool id is tolerated everywhere.
 */
export type SkillTool = 'claude-code' | 'cursor' | (string & {});

/**
 * How (and whether) a skill can be enabled/disabled. Modelled as a descriptor
 * — never a bare boolean — so the UI can render a read-only row (no switch)
 * generically for tools that don't support toggling (plugin skills, Cursor
 * rules today), the same way plugin skills already render read-only.
 */
export interface SkillToggleState {
  /** `false` ⇒ render the row without a toggle switch. */
  supported: boolean;
  /** Current effective state (meaningful even when `supported` is false). */
  enabled: boolean;
  /** Shown as a hint when `supported` is false (e.g. "Managed by /plugin"). */
  reason?: string;
}

/**
 * A Claude Code *slash command* discovered from `.claude/commands/**\/*.md`.
 * Surfaced in the command palette so the user can launch it straight into a new
 * or existing Claude session. `scope` mirrors Claude's own resolution order.
 */
export interface SlashCommand {
  /** Stable handle: `${scope}:${name}`, e.g. `plugin:zana:status`. */
  id: string;
  /** Command name with `:` namespacing, e.g. `eq`, `git:commit`, `zana:status`. */
  name: string;
  /** The literal a user types / we send to Claude, e.g. `/git:commit`. */
  invocation: string;
  scope: 'user' | 'project' | 'plugin';
  /** Plugin slug (only when scope === 'plugin'). */
  pluginName?: string;
  /** Project id (only when scope === 'project'). */
  projectId?: string;
  /** Absolute path of the backing `.md` file. */
  path: string;
  /** From frontmatter `description`, else the first body line. */
  description?: string;
  /** From frontmatter `argument-hint`, e.g. `<pr-url>` — hints args exist. */
  argumentHint?: string;
}

export interface SkillEntry {
  /**
   * Stable handle. For Claude Code skills this is the historical 2-part
   * `${source}:${qualifiedName}` (e.g. `plugin:zana/team-status`) — kept
   * byte-identical so existing bundles + `skillOverrides` references stay
   * valid with zero migration. Non-Claude tools prefix the tool id:
   * `${tool}:${source}:${qualifiedName}` (e.g. `cursor:project:my-rule`).
   */
  id: string;
  /** Short display name (last path segment of the skill directory). */
  name: string;
  /** The agent tool this skill belongs to. Defaults to `'claude-code'`. */
  tool: SkillTool;
  /**
   * Human label for {@link tool} (e.g. "Claude Code", "Cursor"), supplied by the
   * owning provider. Carried on the entry so the renderer can show a tool chip
   * WITHOUT hardcoding a tool→label map (Rule 6: no concrete tool id in the
   * renderer's skills UI).
   */
  toolLabel: string;
  source: SkillSource;
  /** Plugin slug (only when source === 'plugin'). */
  pluginName?: string;
  /** Project id (only when source === 'project'). */
  projectId?: string;
  path: string;
  description?: string;
  allowedTools?: string[];
  /** Per-tool toggle capability + current state (see {@link SkillToggleState}). */
  toggle: SkillToggleState;
  /**
   * Derived convenience mirror of `toggle.enabled`, retained so existing
   * consumers (bundle apply, older UI) keep working. New UI reads `toggle`.
   */
  enabled: boolean;
}

export interface SkillBundle {
  id: string;
  name: string;
  description?: string;
  /** SkillEntry.id values. */
  skillIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SkillBundleInput {
  name: string;
  description?: string;
  skillIds: string[];
}

export type SkillBundleApplyMode = 'additive' | 'exclusive';

/**
 * Result of applying a bundle. `applied` is the count of user/project skills
 * the apply actually wrote to settings. `skippedPlugin` is the count of plugin
 * skills in the bundle that were ignored — plugin skills are managed via
 * Claude Code's `/plugin` command and can't be toggled from settings.json.
 */
export interface SkillBundleApplyResult {
  ok: boolean;
  applied: number;
  skippedPlugin: number;
  message?: string;
}

/** @deprecated Legacy per-project MCP shape; replaced by McpServerEntry. */
export interface McpServer {
  name: string;
  scope: 'user' | 'project' | 'session';
  command: string;
  args?: string[];
  /** Environment variable names only; values never cross the main-process boundary. */
  envKeys?: string[];
  enabled: boolean;
}

export type PluginSource = 'user' | 'marketplace';

export interface PluginProvides {
  skills: string[];
  commands: string[];
  mcpServers: string[];
}

export interface PluginEntry {
  /** `<name>@<marketplace>` — matches `enabledPlugins` key in
   *  `~/.claude/settings.json`. */
  id: string;
  name: string;
  source: PluginSource;
  /** Undefined when source === 'user'. */
  marketplace?: string;
  version?: string;
  description?: string;
  /** Root install dir of the plugin. */
  path: string;
  provides: PluginProvides;
  enabled: boolean;
  /** False if .claude-plugin/plugin.json is missing or malformed. */
  manifestValid: boolean;
}

/**
 * Redacted server-owned plugin app state. `appUrl` is same-origin and contains
 * no install path or credentials; the renderer uses it only to import a bundle.
 */
export interface PluginAppEntry {
  id: string;
  name: string;
  description: string;
  icon: string;
  enabled: boolean;
  provenance: 'builtin' | 'direct' | 'catalog';
  status: 'running' | 'disabled' | 'degraded' | 'needs-configuration';
  appUrl: string | null;
  /** Newer catalog version from the last `checkUpdates()` sweep, when any. */
  availableVersion?: string;
  projectTab?: {
    label?: string;
    icon?: string;
    order?: number;
    global?: boolean;
  };
}

export interface PluginSettingsSnapshot {
  descriptors: Record<
    string,
    {
      type: 'string' | 'boolean' | 'select' | 'project';
      label: string;
      description?: string;
      secret?: true;
      options?: string[];
      default?: string | boolean;
    }
  >;
  values: Record<string, string | boolean | undefined>;
}

/**
 * One discovered runtime extension under `~/.zcc/extensions/<id>/`, as
 * surfaced to the renderer by `cc.extensions.list()`. Mirrors the SDK's
 * `ExtensionManifest` shape inline so this IPC-contract file stays dependency-
 * free (no `@zana-ai/zcc-extension-sdk` import in the shared types surface).
 */
export interface ExtensionEntry {
  /** Stable, URL-safe id — the `<id>` directory name and storage namespace. */
  id: string;
  /** Absolute root dir of the extension (`~/.zcc/extensions/<id>`). */
  path: string;
  /**
   * The parsed `extension.json` manifest, or null when missing/malformed.
   * Null implies the extension was skipped (see `error`).
   */
  manifest: ExtensionManifestView | null;
  /** Enabled-map state; defaults to true unless explicitly disabled. */
  enabled: boolean;
  /**
   * True when the extension passed validation + version gate AND (if it
   * declares a main entry) its main module imported + registered cleanly.
   */
  loaded: boolean;
  /**
   * Whether the extension's MAIN side (its capabilities, reached via
   * `host.call`) is currently live in this process.
   *
   * - A renderer-only extension (no `entry.main`) is always `true` — there's
   *   nothing to activate, so its panel works the moment it's enabled.
   * - A main-bearing extension is `true` only when its `MainModule` was
   *   `import()`-ed into the host at THIS boot. Main modules are
   *   **relaunch-required to (re)activate**: enabling one that wasn't loaded at
   *   boot leaves `mainActive:false` until the next relaunch, so the renderer
   *   can surface a relaunch hint rather than mount a panel whose `host.call()`
   *   would reject with "Unknown module". Disable tears the main side down live
   *   (also `false`).
   */
  mainActive: boolean;
  /**
   * Why the extension was skipped or failed to load, if any. One of:
   * `bad-manifest` (missing/unparseable/invalid shape), `version-mismatch`
   * (engines.zccApi rejects the host), `disabled` (enabled-map says off),
   * `main-load-failed` (the main entry threw on import/setup). Absent on a
   * clean load.
   */
  error?: ExtensionLoadError;
  /**
   * P3-D install-time consent. True when the user has approved this extension's
   * CURRENT declared permissions. A disk extension does NOT run its main / mount
   * its panel until consented — distinct from `enabled` (the user may enable it,
   * but it stays inactive until consent is granted). Built-in modules never need
   * consent and don't appear in the discovered list.
   */
  consented: boolean;
  /**
   * Why this extension needs a consent prompt, or null when fully consented:
   *  - `'new'`     — never approved (first install).
   *  - `'widened'` — an update DECLARED more permissions than the user approved;
   *                  re-prompt showing the new ones. The extension stays inactive
   *                  (effective grant = declared ∩ consented) until re-approved.
   * Null for: a consented ext, OR an entry with no manifest / not a candidate to
   * run (bad-manifest / version-mismatch — nothing to consent to).
   */
  needsConsent: 'new' | 'widened' | null;
  /**
   * The permission tokens the user has already approved (the persisted consent
   * snapshot), or undefined when there's no consent record yet (`'new'`). Carried
   * to the consent screen so a `'widened'` re-prompt can visually DISTINGUISH the
   * newly-declared permissions from the ones already approved — without it the
   * overlay re-lists the whole declared set and reads as "approve everything
   * again". A subset of `manifest.permissions`; empty array = a record exists but
   * approved nothing.
   */
  consentedPermissions?: string[];
  /**
   * Provenance of this installed extension.
   *  - `'local'` — authored in-app via the Extension Creator: lives in the same
   *    `~/.zcc/extensions/<id>` dir and is subject to the SAME consent + broker
   *    gates as any disk extension (there is NO "trust local" fast-path), but it
   *    additionally has a `workingDir` recorded in the main-owned `local.json`
   *    registry, so the UI can offer "Continue building" / "Reload from source".
   *  - `'git'` — installed from a remote git repo (`{kind:'git'}`). Same consent
   *    + broker gates; its `{url, ref?, sha?}` provenance is recorded in the
   *    main-owned `git.json` registry and surfaced here as `remoteOrigin` so the
   *    consent screen can render a LOUD "code not reviewed by Zana" line and the
   *    hub can offer "Update from repo".
   * Absent ⇒ an ordinary installed extension (bundled/marketplace/hand-dropped).
   */
  source?: 'local' | 'git';
  /**
   * For `source:'git'` — the remote origin this extension was cloned from,
   * credential-stripped. Carried to the consent screen so the remote-origin
   * provenance warning can name the repo. Absent for non-git sources (and, if a
   * git extension's `git.json` record is somehow missing, the consent screen
   * falls back to a generic "origin unknown" warning keyed on `source==='git'`).
   */
  remoteOrigin?: { url: string; ref?: string };
}

export type ExtensionLoadError =
  | 'bad-manifest'
  | 'version-mismatch'
  | 'disabled'
  | 'main-load-failed';

/** Renderer-safe projection of the SDK `ExtensionManifest`. */
export interface ExtensionManifestView {
  id: string;
  title: string;
  icon: string;
  titleLabel?: string;
  /** Extension's own release version (SemVer). Absent ⇒ unversioned (`0.0.0`). */
  version?: string;
  /** Build provenance stamped at package time (git SHA + ISO timestamp). */
  build?: { sha?: string | null; at?: string };
  entry: { renderer?: string; main?: string };
  engines: { zccApi: string };
  permissions?: string[];
  /**
   * Scoping for the brokered permissions (exec bins / fs roots / egress hosts).
   * Surfaced so the renderer host can apply advisory scope checks and the P3-D
   * consent screen can render what an extension may run/read/reach.
   */
  permissionScopes?: {
    execAllowlist?: string[];
    fsRoots?: string[];
    egressAllowlist?: string[];
    mcpAllowlist?: string[];
    streamAllowlist?: string[];
    extensionInstallAllowlist?: string[];
  };
  /**
   * Present when the extension opts its renderer panel into a PER-PROJECT TAB
   * (SDK `ExtensionManifest.projectTab`). The renderer loader copies this onto
   * the built `AppModule.projectTab`; the Workspace then adds a project tab for
   * the module. Absent ⇒ global panel only (the default). `label`/`icon` default to
   * the module's title/icon; `order` sorts extension tabs (default 100).
   * `global: false` suppresses the global Extensions-hub launch (project-tab only).
   */
  projectTab?: { label?: string; icon?: string; order?: number; global?: boolean };
  /**
   * Present when the extension contributes a framework-aware Quick Agent preset
   * (SDK `AgentPreset`). The Advanced launcher renders these as selectable
   * framework chips; picking one injects `systemPrompt` into the spawned session
   * via `--append-system-prompt` (routed through the standard persona path, so
   * core never special-cases a framework). Discovered generically from the
   * manifest — no extension id in core launch logic (Rule 6). `systemPrompt` is
   * carried so main can rebuild the primer at launch from its own copy of this
   * view, keyed only by the extension id the renderer passes (Rule 1).
   */
  agentPreset?: AgentPresetView;
  /**
   * Skills the extension contributes to Claude Code's skill catalogue (SDK
   * `ExtensionManifest.skills`). Non-sensitive — surfaced so the consent
   * screen can list what would be deployed under `agent:contribute`. `path`
   * is the raw manifest-relative path; deployment/confinement happens main-side.
   */
  skills?: ExtensionSkillContributionView[];
  /**
   * MCP server definitions the extension owns (SDK
   * `ExtensionManifest.mcpServers`). Surfaced so the consent screen can list
   * each server's name + how it connects, gated the same way as `skills`.
   */
  mcpServers?: ExtensionMcpServerContributionView[];
}

/**
 * Renderer-safe projection of the SDK `AgentPreset` (see {@link
 * ExtensionManifestView.agentPreset}). Structurally identical — the launch
 * fields (`model`, `baseProfile`) are non-sensitive and drive the synthetic
 * persona main mints for a framework launch.
 */
export interface AgentPresetView {
  label?: string;
  description?: string;
  icon?: string;
  /** Framework primer injected via `--append-system-prompt`. */
  systemPrompt: string;
  /** Opening prompt written to the session after spawn (claude-family only). */
  initialPrompt?: string;
  model?: 'opus' | 'sonnet' | 'haiku' | 'default';
  baseProfile?: 'claude' | 'claude-yolo';
}

/** Renderer-safe projection of SDK `ExtensionSkillContribution`. */
export interface ExtensionSkillContributionView {
  path: string;
  slug?: string;
}

/**
 * Renderer-safe projection of SDK `ExtensionMcpServerContribution`. `env` is
 * deliberately OMITTED here (unlike the main-side SDK type) — env values may
 * carry secrets/tokens and this view is what the consent screen renders; only
 * `envKeys` (names, not values) crosses into the renderer.
 */
export interface ExtensionMcpServerContributionView {
  name: string;
  type: 'stdio' | 'streamable-http' | 'sse';
  command?: string;
  args?: string[];
  url?: string;
  /** Names of env vars this server declares (values withheld from the renderer). */
  envKeys?: string[];
  alwaysOn?: boolean;
}

/**
 * Where an on-demand install pulls its bytes from. The local variants carry NO
 * path: main opens the OS picker itself, because a renderer-supplied filesystem
 * path is never a trust anchor (engineering rule #1). The marketplace variant
 * names a release id main resolves against the (opt-in) registry index.
 */
export type ExtensionInstallSource =
  | { kind: 'localDir' }
  | { kind: 'localArchive' }
  | { kind: 'marketplace'; id: string }
  /**
   * Install from a remote git repository. `url`/`ref`/`subdir` are ADVISORY
   * renderer hints (Rule #1): main normalizes + clones the url itself, validates
   * `ref` via `safeRef`, realpath-confines `subdir`, and funnels the result
   * through the single trusted `installFromDir` seam — so consent + the
   * deny-by-default broker fire exactly as for `localDir`. `ref` is an optional
   * branch/tag/SHA (default branch when absent); `subdir` locates
   * `extension.json` when it isn't at the repo root.
   */
  | { kind: 'git'; url: string; ref?: string; subdir?: string }
  /**
   * Reinstall a FIRST-PARTY extension the app ships in its bundle (the catalog
   * `listMarketplace` surfaces even with no remote registry configured). Main
   * resolves `id` against the bundled root and copies the shipped dir in — no
   * network, same trust gates as `localDir`. A renderer-supplied id is never a
   * path (Rule #1): main maps id → the app-owned bundled dir itself.
   */
  | { kind: 'bundled'; id: string }
  /**
   * Install a plugin from npm. `spec` is a package name or `name@version`.
   * Main prefixes `npm:` and path-installs through PluginService — never a
   * renderer-supplied filesystem path (Rule 1).
   */
  | { kind: 'npm'; spec: string };

/**
 * Renderer → main request to create a new LOCAL (in-app authored) extension. The
 * renderer supplies only display intent (name / description / template kind); it
 * never supplies a path or an id — main mints the id and derives the working dir
 * itself (Rule 1). `kind` selects the starter template.
 */
export interface CreateLocalExtensionRequest {
  /** Human name; seeds the minted id and becomes the manifest title. */
  name: string;
  /** Optional one-line description for the manifest / hub. */
  description?: string;
  /**
   * Starter template to scaffold, along the trust ladder:
   *  - `'panel'`        — renderer-only, no permissions (default).
   *  - `'main-panel'`   — main + renderer; declares `exec` (git) — trips consent.
   *  - `'mcp-consumer'` — declares `mcp`; ships a placeholder allowlist + TODO.
   *  - `'agent-preset'` — a framework Quick Agent preset; no main, no permissions.
   */
  kind: 'panel' | 'main-panel' | 'mcp-consumer' | 'agent-preset';
}

/**
 * Result of {@link ExtensionsApi.createLocal}: the minted id and the SOURCE
 * working dir the Creator agent should open in. `projectId` is the built-in
 * scratch (Quick Agent) project the agent runs against; the renderer launches a
 * terminal there with cwd confined to `workingDir`.
 */
export interface CreateLocalExtensionResult {
  id: string;
  /** Absolute source dir under the scratch workspace (`~/zcc-workspace/extensions/<id>`). */
  workingDir: string;
  /** The scratch project id the Creator agent launches against. */
  projectId: string;
}

/** Repository input for opening an existing extension as editable local source. */
export interface AdoptLocalExtensionGitRequest {
  url: string;
  ref?: string;
  subdir?: string;
}

/**
 * Renderer-facing mirror of the main-side `UpdateOutcome` (extension-registry.ts).
 * Re-declared here so the renderer never imports the main-only registry module.
 */
export interface ExtensionUpdateOutcome {
  id: string;
  status: 'updated' | 'skipped' | 'needs-consent' | 'error';
  fromVersion?: string;
  toVersion?: string;
  /** Populated for `needs-consent`: the permissions newly requested. */
  addedPermissions?: string[];
  error?: string;
}

/**
 * One browsable marketplace row: a registry release joined with this host's
 * install state. `installed`/`hasUpdate`/`compatible` are computed in main so
 * the renderer just renders the right button (Install / Update / Installed /
 * Incompatible). Catalog fields (title/description/author/icon) come from the
 * release; `title` falls back to `id`.
 */
export interface MarketplaceEntry {
  id: string;
  /** Best compatible release version offered by the registry. */
  version: string;
  title: string;
  description?: string;
  author?: string;
  /** Lucide icon name (resolved renderer-side, like a manifest icon). */
  icon?: string;
  /** Permissions the release declares — previewed before install. */
  permissions?: string[];
  /** True when an extension with this id is already installed on disk. */
  installed: boolean;
  /** The currently-installed version, when `installed`. */
  installedVersion?: string;
  /** True when installed and the registry offers a strictly newer version. */
  hasUpdate: boolean;
  /** True when the release's `zccApi` satisfies this host (checkApiCompat). */
  compatible: boolean;
  /**
   * Where this catalog row came from. `'bundled'` is a first-party extension the
   * app ships (installable offline via `{ kind: 'bundled' }`); `'marketplace'`
   * comes from the opt-in remote registry index. When an id is offered by both,
   * the remote release wins (it can be newer) and the row reads `'marketplace'`.
   * Lets the browse UI badge provenance the way VSCode marks built-in vs. store.
   */
  source: 'bundled' | 'marketplace';
  /** Skill folder names this plugin would add. */
  skillNames?: string[];
  mcpServers?: Array<{ name: string; alwaysOn?: boolean }>;
  extra?: Record<string, unknown>;
  tags?: string[];
}

export type McpSource = 'user' | 'plugin' | 'project';

export type McpTransport = 'stdio' | 'http' | 'unknown';

export interface McpServerEntry {
  /** `${source}[:${pluginName}|:${projectId}]:${name}` — collision-free. */
  id: string;
  name: string;
  source: McpSource;
  pluginName?: string;
  projectId?: string;
  projectPath?: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  /** Environment variable names only; values never cross the main-process boundary. */
  envKeys?: string[];
  url?: string;
  /** Header names only; values never cross the main-process boundary. */
  headerKeys?: string[];
  enabled: boolean;
  /** Set when toggle is disabled in UI (plugin-scope rows). */
  enabledLockedBy?: 'plugin';
}

/**
 * Auto-update lifecycle, mirrored from electron-updater's autoUpdater events
 * onto a single renderer-facing union. `disabled` is our own state for the dev
 * build (electron-updater is a no-op when the app isn't packaged).
 */
export type UpdateStatusKind =
  | 'idle'
  | 'disabled'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export interface UpdateStatus {
  kind: UpdateStatusKind;
  /** Target version for available/downloading/downloaded; absent otherwise. */
  version?: string;
  /** Present when kind === 'error'. */
  message?: string;
}

/** Download progress as emitted by electron-updater's `download-progress`. */
export interface UpdateProgress {
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
}

/**
 * One curated release-notes document, parsed from a bundled
 * `docs/releases/<version>.md` (electron-builder copies these to
 * `process.resourcesPath/release-notes`; dev reads the repo dir). Rendered by the
 * "What's New" modal. The `markdown` is the file body verbatim — the renderer
 * sanitizes it through the same dompurify path as inbox reports.
 */
export interface ReleaseNote {
  /** SemVer of the release, derived from the filename (`1.0.4.md` → `1.0.4`). */
  version: string;
  /** Raw markdown body of the notes file. */
  markdown: string;
}

/**
 * Payload for the {@link IPC.updates.onWhatsNew} push. Main emits this once, on
 * the first launch after the running version overtakes the persisted
 * `lastSeenVersion` (see src/main/release-notes.ts). The renderer opens the
 * What's New modal covering the half-open interval `(fromVersion, toVersion]`.
 * `fromVersion` is null on a first-ever launch (no baseline) — the modal stays
 * closed in that case (silent baseline), so a fresh install isn't interrupted.
 */
export interface WhatsNewEvent {
  /** Previously-seen version, or null on a first-ever launch (no baseline). */
  fromVersion: string | null;
  /** The now-running version (`app.getVersion()`). */
  toVersion: string;
}

/**
 * First-run dependency check ("setup doctor"). On launch the app verifies that
 * the companion pieces the installer normally sets up are actually present —
 * the `claude` CLI, the Zana MCP server + Claude Code plugins, and the bundled
 * disk extensions — and auto-installs the ones it can do non-interactively,
 * guiding the user through the rest.
 *
 * `kind` distinguishes how a missing dependency is remediated:
 *   - `installable` — the app can install it itself (npm / claude CLI calls).
 *   - `manual`      — no scripted installer (e.g. the `claude` CLI itself); we
 *                     only detect + guide.
 *   - `bundled`     — seeded into ~/.zcc by the app on boot; informational.
 */
export type DependencyKind = 'installable' | 'manual' | 'bundled';

/** Where a single dependency stands the last time it was checked/installed. */
export type DependencyPhase =
  | 'checking'
  | 'present'
  | 'missing'
  | 'installing'
  | 'installed'
  | 'failed';

export interface DependencyState {
  /** Stable id, e.g. 'claude-cli', 'zana-mcp'. */
  id: string;
  /** Human label shown in the checklist, e.g. "Zana MCP server". */
  label: string;
  /** One-line description of what it is / why it's needed. */
  detail: string;
  kind: DependencyKind;
  phase: DependencyPhase;
  /** Resolved version / path when present; failure reason when failed. */
  note?: string;
  /**
   * For `manual` (and as a fallback for `installable`) dependencies: the exact
   * shell command the user can copy to install it themselves.
   */
  manualCommand?: string;
}

/** The full setup snapshot pushed to the renderer on `deps:onStatus`. */
export interface SetupStatus {
  /** True while the initial detection sweep or an install run is in flight. */
  busy: boolean;
  /** All tracked dependencies, in display order. */
  items: DependencyState[];
}

/** Per-step install progress, pushed on `deps:onProgress`. */
export interface DependencyProgress {
  /** Which {@link DependencyState.id} this line belongs to. */
  id: string;
  /** A short status line streamed from the running installer. */
  message: string;
}

/** Non-secret project-scoped execution grant metadata exposed to Settings. */
export interface ProjectExecutionConsentGrant {
  id: string;
  adapterId: string;
  targetId: string;
  launchScope: 'local' | 'remote';
  createdAt: number;
  expiresAt?: number;
}
