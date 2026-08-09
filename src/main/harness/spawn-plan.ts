/**
 * Pure spawn-plan HELPERS — the harness-agnostic building blocks of
 * {@link PtyManager.create} and the per-harness `LaunchProvider`s.
 *
 * HISTORY: this module once owned a monolithic `buildSpawnPlan(SpawnRequest):
 * SpawnPlan` that assembled the entire local argv/env in one pass. That builder
 * was RETIRED (Decision D3 / T5.3, codex-parity plan 2026-07-22): `create()` now
 * dispatches launch identity + arg layers through `provider.resolveLaunch(...)`
 * and the other `LaunchProvider` methods, and assembles the env inline — so the
 * one-pass builder had become a dead duplicate that re-inlined `isClaudeProfile`
 * gates the providers already own (plan risk #5). It's gone; the golden-argv net
 * (`pty-golden-argv.test.ts`) guards `create()` directly.
 *
 * What remains here are the PURE, widely-imported helpers both the local
 * (`pty.ts`) and the provider paths share so they can't drift: `projectSettingsArgs`,
 * `personaArgs_build`, `applyHeapCeiling`, `cleanExtraArgs`,
 * `extractPinnedSessionId`, `buildHookSettings`, `buildAutoModeSettings`, and the
 * guidance/allowed-tools builders. Keeping them pure is what makes the launch
 * path VERIFIABLE and testable without Electron or a real pty.
 */
import type {
  AppConfig,
  LaunchProfileId,
  Persona,
  ProjectSettings,
  SessionWorktree
} from '../../shared/types.js';
import { SESSION_MEMORY_DEFAULTS } from '../../shared/types.js';

/**
 * Appended to the agent's system prompt so it knows the `inbox_push` MCP
 * tool exists and *when* to call it. Kept short and concrete — the LLM
 * doesn't need a tutorial, just a list of triggers.
 */
const INBOX_USAGE_GUIDANCE = [
  'You are running inside Zana Command Center. The MCP tool',
  '`inbox_push` (server: zcc-inbox) sends an entry to the user’s inbox in',
  'this app. The user does not see your terminal output in real time —',
  '`inbox_push` is the only way to surface something proactively.',
  '',
  'Call inbox_push when ANY of these are true:',
  '- A long-running task you started has finished (link the report via `docs`).',
  '- You are blocked and need a decision or input from the user (use `comments`).',
  '- You hit an unexpected error you cannot recover from on your own.',
  '- You completed a multi-step plan and want to summarise the outcome.',
  '',
  'The user is NOT watching your terminal scrollback. Assume any of the',
  'four triggers above is, by default, something they would miss unless',
  'you push it — do not assume the user is watching the terminal.',
  '',
  'The ONE thing not to push is genuine noise: routine acknowledgements',
  '("ok, done"), mid-task progress with nothing for the user to act on, or',
  'a clarifying question you are about to answer yourself in the same turn.',
  '',
  'If you are asking a QUESTION and need an answer to continue, push it via',
  '`comments` and then WAIT for input on this same session rather than',
  'exiting — the user can reply directly from the inbox, and their answer',
  'arrives here as if typed at your prompt. Do not end your turn assuming',
  'the question was rhetorical.',
  '',
  'When the question is a CHOICE between concrete options (an approach, a',
  'config value, a go/no-go), prefer `inbox_ask` (server: zcc-inbox) over a',
  'free-text `comments` question: it renders a form with lettered options, an',
  'optional "Other…" row, and Skip/Continue. Pass `question` + `options[]`',
  '(set `allowOther`/`multiSelect` as needed); the user’s pick arrives here as',
  'if typed, just like a reply. Same rule applies — ask, then WAIT.',
  '',
  '`docs` are paths relative to this project root, rendered live (no',
  'snapshot). `comments` is short markdown — your voice to the user. At',
  'least one of `docs` or `comments` must be present.',
  '',
  'To READ the inbox, use `inbox_search` (server: zcc-inbox): list recent',
  'entries or substring-search them via `query`. It reads only THIS project',
  'by default; pass `allProjects: true` only when asked to search across all',
  'inboxes. Read-only — it never changes the inbox.'
].join(' ');

/**
 * Appended (in addition to INBOX_USAGE_GUIDANCE) for scheduled runs only.
 * Teaches the agent to leave a per-run summary via the `schedule_report` MCP
 * tool so the scheduler history shows what each run did.
 */
const SCHEDULE_REPORT_GUIDANCE = [
  'This is a SCHEDULED run. Before you finish, call the MCP tool',
  '`schedule_report` (server: zcc-inbox) with a short markdown `summary` of',
  'what this run did — what you checked, what you found or changed, and',
  'whether anything needs the user. Optionally set `status` to',
  "'success' | 'partial' | 'failure'. This summary is attached to the run in",
  'the scheduler history; it is a REPORT, not a log — summarize, don\'t paste',
  'raw output.',
  '',
  'File the report on EVERY scheduled run. It is separate from `inbox_push`:',
  'report = always-on per-run record; inbox = only when you need the user to',
  'act. If this session auto-closes when you finish, you MUST call',
  '`schedule_report` BEFORE ending your turn — the session is killed the',
  'moment you stop, so a report left for "later" never gets sent.',
  '',
  'Do ALL of your work INLINE, within this single turn. Do NOT dispatch',
  'background / run_in_background agents and do NOT hand work off to "finish',
  'later": this session is torn down the instant your turn ends, which kills',
  'the entire process tree and orphans any background agent mid-flight — its',
  'work is lost and never lands. If a task would normally be delegated to a',
  'background agent, perform it yourself and wait for the result before you',
  'call `schedule_report` and stop.'
].join(' ');

/**
 * Appended to the system prompt of interactive claude tabs so the agent knows
 * the inter-agent discovery tools exist (Phase 0 of the agent mesh). Kept short
 * — the agent only needs to know it CAN discover peers, not a tutorial. The
 * tools are pre-approved (see `inboxAllow`) so using them never prompts.
 */
const AGENT_MESH_GUIDANCE = [
  'Other Claude Code agents may be running in sibling tabs. MCP tools (server:',
  'zcc-inbox) let you discover and message them:',
  '- `register_agent` — announce yourself with a short `handle` (and optional',
  '  `role` / `capabilities`) so peers can find you. Optional but cheap; call it',
  '  once if your work might benefit from a peer noticing you.',
  '- `list_agents` — see which peer agents are running (handle, role, live',
  '  status), scoped to this project by default.',
  '- `find_agent` — resolve a specific peer by handle/role/capability.',
  '- `agent_send` — send a message to a peer (by handle or session id). The',
  '  first send asks the user for permission. Use it to hand off a finding or',
  '  ask a peer to do something.',
  '- `agent_inbox` — check for messages peers have sent you. Poll it while',
  '  coordinating (e.g. after messaging a peer, or while waiting on one); a',
  '  message from an idle peer also arrives directly at your prompt.',
  '',
  'This is opt-in collaboration — use it only when coordinating actually helps,',
  'and ignore it otherwise. You are one agent in a human-run cockpit, not an',
  'autonomous swarm.'
].join(' ');

/**
 * Appended to every claude tab so the agent knows it is one of several projects
 * the user manages, and can resolve sibling projects itself instead of asking
 * for paths. Same "short list, not a tutorial" spirit as the blocks above. The
 * zana pointer is intentionally a single sentence — the agent reads the actual
 * tool schemas on demand; this just tells it the surface exists.
 */
const PROJECT_AWARENESS_GUIDANCE = [
  'You are running in ONE project, but the user manages several. The MCP tool',
  '`list_projects` (server: zcc-inbox) returns every project — id, tag, name,',
  'and local path. When the user refers to another project by name ("check',
  'project B", "look at zana"), resolve it with `list_projects` and use its',
  'path directly instead of asking the user where it lives. If your task is to',
  'clone or scaffold a new project (rather than work inside this one), you MUST',
  'call `register_project` with the resulting directory once it exists — that is',
  'the ONLY way it appears in the user’s sidebar; leaving it unregistered means',
  'the work is effectively invisible to them. Do this immediately after the',
  'clone/scaffold succeeds, not at the end of a longer task. Local projects you',
  'can read directly with your file/shell tools; remote (SSH) projects are',
  'reached through the app, not plain shell, so treat their path as a handle.',
  '',
  'Beyond projects, the `zana` MCP server exposes the app’s orchestration',
  'surface — teams, tickets/sprints, agent spawning, and multi-agent',
  'deliberation (tools prefixed `zana_*`); reach for it when a task is bigger',
  'than a single session, and read the specific tool schema when you do.'
].join(' ');

/**
 * Appended to every claude tab so the agent knows this project has a durable
 * document library it can read and write — a place for findings, decisions, and
 * thoughts that outlive the session. Same terse "triggers, not a tutorial"
 * spirit; the agent reads the actual `library_*` schemas on demand. The library
 * is project-confined and host-attributed in main, so this guidance only needs
 * to teach WHEN to reach for it.
 */
const PROJECT_LIBRARY_GUIDANCE = [
  'This project has a durable document library at `.zcc/library` — a place for',
  'notes that should outlive your session and be visible to teammates and',
  'future agents. MCP tools (server: zcc-inbox), scoped to THIS project:',
  '- `library_write` — create or update a doc by relPath (e.g.',
  '  `findings/auth.md`); writing the same path again overwrites it.',
  '- `library_read` — read a doc’s full content + metadata by relPath.',
  '- `library_list` — list the docs already captured (relPath, title, tags).',
  '- `library_remove` — delete an agent-authored doc by relPath.',
  '',
  'Reach for `library_write` when you finish an investigation and want the',
  'findings to persist, when a peer or a future run should see your notes, or',
  'when you are building up a multi-run artifact (a decision log). `library_read`',
  'before you append. Use relPath prefixes like `findings/`, `decisions/`,',
  '`thoughts/` (or tags) as your cue to future you. This is the right home for',
  '"write this down" — prefer it over scattering markdown around the repo.'
].join(' ');

/**
 * Appended to every claude tab so the agent knows it can PARK a question or
 * decision as a durable Follow-up instead of blocking or silently going idle.
 * The `followup_*` tools are project-locked + provenance-stamped in main (the
 * agent supplies only the follow-up's fields — see followup-mcp-tools.ts), so
 * this guidance only needs to teach WHEN to reach for them. Pre-approved below
 * (see `inboxAllow`) so filing / resolving never prompts. Same terse spirit as
 * the blocks above; complements `inbox_push` (which pings the user) — a
 * follow-up is the durable, resolvable record that survives the session ending.
 */
const FOLLOWUP_USAGE_GUIDANCE = [
  'Occasionally you hit a question you genuinely cannot resolve yourself — one that',
  'truly needs the human, that reading the repo or running a command won’t settle,',
  'and that is worth surviving this session ending. For THAT, park a durable',
  'Follow-up instead of going idle or blocking.',
  'MCP tools (server: zcc-inbox), scoped to THIS project:',
  '- `followup_list` — see what is already parked. Call this FIRST: if an open',
  '  follow-up already covers your question, filing a similar one in the same',
  '  session just refreshes it (it does not pile up), so keep the wording consistent.',
  '- `followup_create` — file a follow-up: one-line `title` (the actual',
  '  question), a `detail` (markdown context — strongly recommended), `kind:',
  '  "question"` (default) or `"decision"`. It appears in the project’s Follow-ups',
  '  tab and SURVIVES this session ending.',
  '- `followup_resolve` — once answered or moot, close it: pass the `id`,',
  '  `status: "resolved"` (answered/decided) or `"dismissed"` (no longer',
  '  relevant), and an optional one-line `resolution`.',
  '',
  'This is a HIGH bar. Do NOT file for anything you can answer or try yourself, for',
  'routine choices (commit / test / lint / an obvious default), or for anything you',
  'are about to say in your response. A follow-up and `inbox_push` are EITHER/OR,',
  'not both: `inbox_push` pings the user now; a follow-up is the durable record that',
  'persists — if you already pushed it this session, don’t also file a follow-up.',
  'When in doubt, do NOT file — resolve it yourself.'
].join(' ');

/**
 * The system-prompt guidance blob appended after `--append-system-prompt` for a
 * claude-family MCP launch. Scheduled runs additionally learn to file a run
 * report; every claude tab gets the inbox / mesh / project-awareness / library /
 * follow-up guidance. Exported so the caller (and tests) share the exact text.
 */
export function buildSystemPromptGuidance(scheduled: boolean): string {
  return scheduled
    ? `${INBOX_USAGE_GUIDANCE}\n\n${SCHEDULE_REPORT_GUIDANCE}\n\n${AGENT_MESH_GUIDANCE}\n\n${PROJECT_AWARENESS_GUIDANCE}\n\n${PROJECT_LIBRARY_GUIDANCE}\n\n${FOLLOWUP_USAGE_GUIDANCE}`
    : `${INBOX_USAGE_GUIDANCE}\n\n${AGENT_MESH_GUIDANCE}\n\n${PROJECT_AWARENESS_GUIDANCE}\n\n${PROJECT_LIBRARY_GUIDANCE}\n\n${FOLLOWUP_USAGE_GUIDANCE}`;
}

/**
 * The pre-approved `zcc-inbox` MCP tools, folded into a single `--allowedTools`
 * flag so a project-configured `allowedTools` can't silently drop them via
 * last-wins. The remote-MCP-forwarding path (`claude-code-provider.
 * buildRemoteCommand`) calls this directly. `scheduled` adds `schedule_report`;
 * otherwise identical.
 *
 * CAUTION — the local spawn path (`PtyManager.create` in `pty.ts`) does NOT
 * call this function: it hand-maintains its own `agentDataAllow`/`meshAllow`
 * arrays (plus local-only carve-outs for `trustZccToolsEnabled` and autonomous
 * team runs that this helper knows nothing about). A tool added HERE — as
 * `register_project` found out the hard way, see the git blame on that entry —
 * does not reach local launches until the SAME entry is added to `pty.ts`'s
 * `agentDataAllow`/`meshAllow`. When you change this list, go change the local
 * one too (and vice versa); there is no automatic sync.
 *
 * Pure + exported for tests and the remote path.
 */
export function inboxAllowedTools(scheduled: boolean): string[] {
  const meshAllow = [
    'mcp__zcc-inbox__register_agent',
    'mcp__zcc-inbox__list_agents',
    'mcp__zcc-inbox__find_agent',
    'mcp__zcc-inbox__agent_inbox'
  ];
  const agentDataAllow = [
    'mcp__zcc-inbox__followup_create',
    'mcp__zcc-inbox__followup_list',
    'mcp__zcc-inbox__followup_resolve',
    'mcp__zcc-inbox__library_write',
    'mcp__zcc-inbox__library_read',
    'mcp__zcc-inbox__library_list',
    'mcp__zcc-inbox__goal_create',
    'mcp__zcc-inbox__goal_list',
    // register_project is the guidance's documented way to land a cloned/
    // created dir in the sidebar (PROJECT_AWARENESS_GUIDANCE below). Without
    // pre-approval it stalls on a permission prompt in an unattended Quick
    // Agent tab, and the clone is silently orphaned outside the project list.
    'mcp__zcc-inbox__register_project'
  ];
  const core = [
    'mcp__zcc-inbox__inbox_push',
    'mcp__zcc-inbox__inbox_ask',
    'mcp__zcc-inbox__inbox_search',
    'mcp__zcc-inbox__suggest_action'
  ];
  return scheduled
    ? [...core, 'mcp__zcc-inbox__schedule_report', ...meshAllow, ...agentDataAllow]
    : [...core, ...meshAllow, ...agentDataAllow];
}

/**
 * Self-awareness guidance for an agent launched into an ISOLATED GIT WORKTREE
 * (the launcher's "Isolate in a worktree" option). Injected as an EXTRA
 * `--append-system-prompt` block ONLY when a launch's `worktree` is set —
 * so a normal launch's argv is byte-identical (the golden-argv net snapshots the
 * no-worktree cases). Interpolates the checkout path + branch so the agent knows
 * exactly where it is and that its changes are isolated from the main checkout
 * and from sibling agents on the same repo.
 *
 * Pure + exported for tests. `branch`/`path` are app-derived (a git-legal slug +
 * a realpath under `~/zcc-worktrees`), never raw user free-text, so no injection
 * concern beyond the surrounding quoting.
 */
export function buildWorktreeGuidance(worktree: SessionWorktree): string {
  return [
    'ISOLATED WORKTREE: You are running in a dedicated git worktree, NOT the main',
    `checkout. Your working directory is \`${worktree.path}\` and you are on branch`,
    `\`${worktree.branch}\`. This is deliberate: several agents work on this repo`,
    'in parallel, and each gets its own worktree so your edits never collide with',
    'theirs. Work, commit, and push on THIS branch only — do NOT check out or reset',
    'other branches, and do NOT touch files in the main checkout or sibling',
    'worktrees. When your task is done, commit your changes so they can be reviewed',
    'and merged from this branch; leaving the worktree dirty is fine (it is',
    'preserved), but a clean commit is what makes your work mergeable.'
  ].join(' ');
}

/**
 * Build CLI flags derived from per-project ProjectSettings.
 * Inserted AFTER the global AppConfig flags (T2) and claudeMcpArgs so they
 * override globals, and BEFORE per-tab extraArgs so per-tab args win.
 *
 * Assembly order (lowest → highest precedence):
 *   base profile args → AppConfig globals → ProjectSettings flags +
 *   ProjectSettings.extraArgs → CreateTerminalRequest.extraArgs
 */
export function projectSettingsArgs(s: ProjectSettings, profile: LaunchProfileId): string[] {
  const args: string[] = [];
  if (s.appendSystemPrompt) {
    args.push('--append-system-prompt', s.appendSystemPrompt);
  }
  for (const dir of s.addDirs ?? []) {
    args.push('--add-dir', dir);
  }
  if ((s.allowedTools ?? []).length > 0) {
    args.push('--allowedTools', s.allowedTools!.join(','));
  }
  if ((s.deniedTools ?? []).length > 0) {
    args.push('--disallowedTools', s.deniedTools!.join(','));
  }
  // model / permissionMode appended last so they override any global value
  // (claude CLI: last occurrence wins for these flags).
  if (s.model) {
    args.push('--model', s.model);
  }
  if (s.permissionMode && profile !== 'claude-yolo') {
    args.push('--permission-mode', s.permissionMode);
  }
  if (s.extraArgs) {
    args.push(...s.extraArgs);
  }
  return args;
}

/**
 * Build CLI flags derived from a Persona. Mirrors {@link projectSettingsArgs}
 * in shape and flag style — same order, same yolo guard, same "model and
 * permissionMode last" convention. Inserted AFTER claudeMcpArgs (so persona
 * append-system-prompt layers on top of inbox guidance) and BEFORE
 * projectSettings (so per-project overrides still win).
 *
 * Precedence order:
 *   base profile args → AppConfig globals → claudeMcpArgs → PERSONA →
 *   projectSettings → hookArgs → per-tab extraArgs
 */
export function personaArgs_build(p: Persona, baseProfile: LaunchProfileId): string[] {
  const args: string[] = [];
  if (p.appendSystemPrompt) {
    args.push('--append-system-prompt', p.appendSystemPrompt);
  }
  for (const dir of p.addDirs ?? []) {
    args.push('--add-dir', dir);
  }
  if ((p.allowedTools ?? []).length > 0) {
    args.push('--allowedTools', p.allowedTools!.join(','));
  }
  if ((p.deniedTools ?? []).length > 0) {
    args.push('--disallowedTools', p.deniedTools!.join(','));
  }
  // model / permissionMode appended last so they override any global value
  // (claude CLI: last occurrence wins for these flags). permissionMode is
  // skipped when the effective base profile is claude-yolo — it forces
  // --dangerously-skip-permissions, which takes precedence.
  const modelValue = p.model || p.harnessRouting?.byAdapter?.claude?.modelTargetId || p.harnessRouting?.byAdapter?.claude?.compatibility?.model;
  if (modelValue) {
    args.push('--model', modelValue);
  }
  const permMode = p.permissionMode || p.harnessRouting?.byAdapter?.claude?.executionTargetId || p.harnessRouting?.byAdapter?.claude?.compatibility?.permissionMode;
  if (permMode && baseProfile !== 'claude-yolo') {
    args.push('--permission-mode', permMode);
  }
  return args;
}

/**
 * Inject a per-session V8 heap ceiling into `env.NODE_OPTIONS` for claude-family
 * spawns, in place. The flag (`--max-old-space-size=<MB>`) is inherited by every
 * node process the session spawns (the claude CLI itself AND any subagent node
 * trees it fans out), so it bounds the whole subtree — the backstop for the
 * fan-out the live-session cap can't see.
 *
 * Rules:
 *  - Non-claude profiles, or a ceiling of 0 (explicit "disable"), are a no-op:
 *    a plain shell has no node heap to bound, and 0 means "let V8 auto-size".
 *  - An existing `--max-old-space-size` already in the inherited NODE_OPTIONS
 *    wins — the operator (or a parent process) made an explicit choice we don't
 *    override. We only APPEND when the flag is absent, preserving any other
 *    NODE_OPTIONS the environment carries.
 *
 * Exported for unit tests.
 */
export function applyHeapCeiling(
  env: Record<string, string>,
  isClaude: boolean,
  config?: AppConfig
): void {
  if (!isClaude) return;
  const ceilingMB =
    config?.claudeMaxOldSpaceMB ?? SESSION_MEMORY_DEFAULTS.claudeMaxOldSpaceMB;
  if (!ceilingMB || ceilingMB <= 0) return; // 0 / absent-after-disable ⇒ don't inject
  const existing = env.NODE_OPTIONS ?? '';
  if (/--max[-_]old[-_]space[-_]size/.test(existing)) return; // respect an explicit choice
  const flag = `--max-old-space-size=${Math.round(ceilingMB)}`;
  env.NODE_OPTIONS = existing.trim() ? `${existing.trim()} ${flag}` : flag;
}

/**
 * Normalize per-tab `extraArgs` before they're spliced into argv. Drops
 * empty / whitespace-only entries so a blank opening prompt never lands as a
 * stray positional (`claude ''`). Non-empty args (including intentional flags
 * and the `--` end-of-options marker) pass through unchanged, in order.
 *
 * This enforces the empty-prompt invariant at the single point every launch
 * path funnels through, rather than trusting each caller to pre-filter. Pure.
 */
export function cleanExtraArgs(extraArgs: string[] | undefined): string[] {
  return (extraArgs ?? []).filter((a) => a.trim() !== '');
}

/**
 * Recover a UUID session id explicitly pinned in argv — `--resume <uuid>`,
 * `--session-id <uuid>`, or their `=`-joined forms. Used so a restore
 * re-launch (which carries `--resume <id>`) re-surfaces that same id as the
 * session's `claudeSessionId`, keeping the resume chain stable across repeated
 * relaunches. `--resume`/`-r` with no value (the resume *picker*) yields no id.
 * Returns undefined when none is present. Pure.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function extractPinnedSessionId(argv: string[]): string | undefined {
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if ((a === '--resume' || a === '-r' || a === '--session-id') && i + 1 < argv.length) {
      const v = argv[i + 1];
      if (UUID_RE.test(v)) return v;
    }
    const eq = a.match(/^(?:--resume|--session-id)=(.+)$/);
    if (eq && UUID_RE.test(eq[1])) return eq[1];
  }
  return undefined;
}

/**
 * Build the inline `--settings` JSON that registers our per-session hooks.
 * `--settings` MERGES with the user's settings files, so this adds hooks
 * without disturbing their config. Every command relies only on `sh` + `curl`
 * (both present on macOS) and exits 0 so it stays fire-and-forget — a hook
 * must never block the agent.
 *
 *  - `stop` (opt-in): a Stop hook that POSTs to `$ZCC_HOOK_URL` so the scheduler
 *    learns the turn ended (and, for auto-close tasks, the pty gets killed).
 *    Guards on `stop_hook_active` so a re-entrant Stop fire can't race the kill.
 *  - `notify` (opt-in): the live-status hooks that let the UI show
 *    "blocked — needs you". Two independent producers cover the two ways a
 *    Claude turn can stop for the user:
 *      · Notification → POST `/blocked`, but ONLY for the notification types
 *        that mean "waiting on the user" (permission_prompt / elicitation_dialog).
 *        idle_prompt / auth_success / elicitation_complete are skipped — idle is
 *        already covered by the OSC title, and treating it as blocked would make
 *        every finished turn look stuck.
 *      · PreToolUse/PostToolUse matched to `AskUserQuestion` → POST
 *        `/blocked` and `/unblocked`. AskUserQuestion is the built-in
 *        interactive multi-choice prompt (a TOOL, not a notification — it
 *        doesn't reliably fire Notification), so the tool boundary is the
 *        dependable signal: Pre fires as the prompt opens, Post when answered.
 *    Both are cleared by UserPromptSubmit / Stop → POST `/unblocked`, so the
 *    overlay drops the moment the user answers or the turn ends.
 *  - `subagents` (opt-in): a PreToolUse matched to `Task` → POST `/start` and a
 *    SubagentStop → POST `/stop`, so the UI can badge the live count of
 *    sub-agents (Task tool spawns) running under the parent session.
 *  - `overseer` (experimental, opt-in): a SYNCHRONOUS match-all PreToolUse that
 *    POSTs the tool-call event and ECHOES the server's permission decision —
 *    the one hook here that blocks the agent and prints output. Fail-open: any
 *    error / empty reply leaves the normal prompt intact. See {@link Overseer}.
 */
export function buildHookSettings(opts: {
  stop: boolean;
  notify: boolean;
  firstPrompt?: boolean;
  /**
   * EXPERIMENTAL (opt-in, gated by {@link AppConfig.askUserQuestionUiEnabled}):
   * a PreToolUse hook matched to `AskUserQuestion` that FORWARDS the tool-call
   * JSON (stdin) to `$ZCC_QUESTION_URL`, so the app can render the question in
   * its own Questions component. Follows the `firstPrompt` pattern exactly
   * (`curl --data-binary @-`, `-m 5`, best-effort, `exit 0`). ADDITIVE alongside
   * the notify `blocked`/`unblocked` AskUserQuestion entries — each hook gets its
   * OWN stdin copy, so this never consumes the notify hook's body. Registered
   * ONLY when the flag is on; when off the output is byte-identical to today.
   */
  question?: boolean;
  subagents?: boolean;
  overseer?: boolean;
  /**
   * curl `-m` (max seconds) for the synchronous Overseer hook. Must sit just
   * above the server's decision-timeout guard. Default 10 (fast path); widened
   * by the caller when the deep "think harder" tier is enabled.
   */
  overseerCurlMaxSec?: number;
  /**
   * Auto-mode classifier trust block (the `autoMode` settings key). When present
   * it's merged alongside `hooks` in the same `--settings` payload. Undefined ⇒
   * omitted entirely (the bare `--permission-mode auto` flag still enables auto
   * mode; this only tunes the classifier).
   */
  autoMode?: Record<string, unknown>;
}): string {
  // node-pty passes argv without a shell, so the whole JSON needs no shell
  // escaping — but each command itself runs under `sh -c`, hence the inner
  // quoting care (single-quoted literals embedded in a single-quoted argv).
  const hooks: Record<string, unknown[]> = {};

  if (opts.stop) {
    const stopCmd =
      'ZCC_IN=$(cat); ' +
      'case "$ZCC_IN" in *\'"stop_hook_active":true\'*) exit 0;; esac; ' +
      'if [ -n "$ZCC_HOOK_URL" ]; then ' +
      'curl -s -m 5 -X POST "$ZCC_HOOK_URL" >/dev/null 2>&1 || true; ' +
      'fi; exit 0';
    hooks.Stop = [{ matcher: '', hooks: [{ type: 'command', command: stopCmd }] }];
  }

  if (opts.notify) {
    // POST /blocked. Reads (and discards) the event JSON on stdin first so the
    // hook stays well-behaved, then pings the callback.
    const postBlocked =
      'cat >/dev/null 2>&1; ' +
      '[ -n "$ZCC_NOTIFY_URL" ] && ' +
      'curl -s -m 5 -X POST "$ZCC_NOTIFY_URL/blocked" >/dev/null 2>&1 || true; exit 0';
    // POST /unblocked — the user answered / the turn ended.
    const postUnblocked =
      'cat >/dev/null 2>&1; ' +
      '[ -n "$ZCC_NOTIFY_URL" ] && ' +
      'curl -s -m 5 -X POST "$ZCC_NOTIFY_URL/unblocked" >/dev/null 2>&1 || true; exit 0';
    // Notification: only the types that mean "waiting on the user". We match
    // notification_type substrings (no jq dependency) and deliberately list
    // them explicitly rather than match-all — elicitation_complete /
    // elicitation_response / idle_prompt / auth_success are NOT blocked states,
    // so a match-all would produce false reds.
    const notifyBlocked =
      'ZCC_IN=$(cat); ' +
      'case "$ZCC_IN" in ' +
      '*\'"permission_prompt"\'*|*\'"elicitation_dialog"\'*) ' +
      '[ -n "$ZCC_NOTIFY_URL" ] && ' +
      'curl -s -m 5 -X POST "$ZCC_NOTIFY_URL/blocked" >/dev/null 2>&1 || true;; ' +
      'esac; exit 0';

    hooks.Notification = [{ matcher: '', hooks: [{ type: 'command', command: notifyBlocked }] }];
    // AskUserQuestion is a built-in TOOL (the interactive multi-choice prompt),
    // not a notification — so we catch it at the tool boundary, which is the
    // reliable signal: PreToolUse fires just before the prompt is shown, and
    // PostToolUse fires once the user picks. The matcher scopes these to that
    // one tool, so no other tool call is touched.
    hooks.PreToolUse = [
      { matcher: 'AskUserQuestion', hooks: [{ type: 'command', command: postBlocked }] }
    ];
    hooks.PostToolUse = [
      { matcher: 'AskUserQuestion', hooks: [{ type: 'command', command: postUnblocked }] }
    ];
    // Submitting a prompt, and the turn ending, both mean we're no longer
    // waiting on the user.
    hooks.UserPromptSubmit = [
      { matcher: '', hooks: [{ type: 'command', command: postUnblocked }] }
    ];
    const stopUnblock = { type: 'command', command: postUnblocked };
    if (Array.isArray(hooks.Stop)) {
      (hooks.Stop[0] as { hooks: unknown[] }).hooks.push(stopUnblock);
    } else {
      hooks.Stop = [{ matcher: '', hooks: [stopUnblock] }];
    }
  }

  if (opts.firstPrompt) {
    // Forward the prompt JSON (stdin) so the main process can name the tab from
    // the first instruction. Distinct from the notify `/unblocked` command:
    // that one discards stdin and pings a fixed URL; this one sends the body so
    // we get the prompt text. Best-effort, exit 0 — a hook must never block the
    // agent. Idempotency lives in the main process (it names once per session),
    // so it's fine that this fires on every prompt.
    const postFirstPrompt =
      'ZCC_IN=$(cat); ' +
      '[ -n "$ZCC_FIRSTPROMPT_URL" ] && ' +
      'printf "%s" "$ZCC_IN" | ' +
      'curl -s -m 5 -X POST --data-binary @- "$ZCC_FIRSTPROMPT_URL" >/dev/null 2>&1 || true; exit 0';
    const firstPromptHook = { type: 'command', command: postFirstPrompt };
    if (Array.isArray(hooks.UserPromptSubmit)) {
      // Add as a second UserPromptSubmit entry so it coexists with the notify
      // `/unblocked` command without one consuming the other's stdin.
      (hooks.UserPromptSubmit as unknown[]).push({
        matcher: '',
        hooks: [firstPromptHook]
      });
    } else {
      hooks.UserPromptSubmit = [{ matcher: '', hooks: [firstPromptHook] }];
    }
  }

  if (opts.question) {
    // Forward the AskUserQuestion tool-call JSON (stdin) so the app can render
    // the question + options in its own Questions component (reusing the
    // inbox_ask loop). Distinct from the notify AskUserQuestion command, which
    // DISCARDS stdin and pings a fixed `/blocked` URL: this one sends the body
    // so we get the actual questions payload — exactly like `firstprompt`.
    // Best-effort, exit 0 — a hook must never block the agent. Registered ONLY
    // when the experimental flag is on, so the off path is byte-identical.
    const postQuestion =
      'ZCC_IN=$(cat); ' +
      '[ -n "$ZCC_QUESTION_URL" ] && ' +
      'printf "%s" "$ZCC_IN" | ' +
      'curl -s -m 5 -X POST --data-binary @- "$ZCC_QUESTION_URL" >/dev/null 2>&1 || true; exit 0';
    // ADDITIVE: append the AskUserQuestion matcher rather than clobber any
    // existing PreToolUse entries (notify's AskUserQuestion, subagents' Task).
    // Each entry is scoped and gets its OWN stdin copy, so this never consumes
    // the notify hook's body.
    const questionHook = {
      matcher: 'AskUserQuestion',
      hooks: [{ type: 'command', command: postQuestion }]
    };
    if (Array.isArray(hooks.PreToolUse)) {
      hooks.PreToolUse.push(questionHook);
    } else {
      hooks.PreToolUse = [questionHook];
    }
  }

  if (opts.subagents) {
    // Sub-agent (Task tool) live-count. PreToolUse matched to `Task` fires the
    // instant a sub-agent is dispatched; SubagentStop fires when one finishes.
    // Each discards stdin and pings a fixed URL — the trailing path segment
    // (`start`/`stop`) selects the event. Best-effort, exit 0, never blocks.
    const postStart =
      'cat >/dev/null 2>&1; ' +
      '[ -n "$ZCC_SUBAGENT_URL" ] && ' +
      'curl -s -m 5 -X POST "$ZCC_SUBAGENT_URL/start" >/dev/null 2>&1 || true; exit 0';
    const postStop =
      'cat >/dev/null 2>&1; ' +
      '[ -n "$ZCC_SUBAGENT_URL" ] && ' +
      'curl -s -m 5 -X POST "$ZCC_SUBAGENT_URL/stop" >/dev/null 2>&1 || true; exit 0';
    const taskStart = { matcher: 'Task', hooks: [{ type: 'command', command: postStart }] };
    // PreToolUse may already carry the notify AskUserQuestion entry — append the
    // Task matcher rather than clobber it. Each entry is scoped to its own tool.
    if (Array.isArray(hooks.PreToolUse)) {
      hooks.PreToolUse.push(taskStart);
    } else {
      hooks.PreToolUse = [taskStart];
    }
    // SubagentStop has no tool matcher (it's a lifecycle event, not a tool
    // boundary) — match-all is correct here.
    hooks.SubagentStop = [{ matcher: '', hooks: [{ type: 'command', command: postStop }] }];
  }

  if (opts.overseer) {
    // Experimental auto-approval. UNLIKE every other hook here, this one is
    // SYNCHRONOUS and PRINTS its output: it pipes the PreToolUse event JSON
    // (stdin) to our local server and echoes the server's reply to stdout, which
    // Claude Code parses as a `{hookSpecificOutput:{permissionDecision}}`
    // verdict. Fail-open by construction:
    //   · no URL / curl error / non-2xx → curl prints nothing → empty stdout →
    //     Claude Code sees no decision → the agent's normal prompt is unchanged.
    //   · `exit 0` always, so a failure is never a *blocking* hook error (that
    //     would need exit 2). The worst case is "no opinion".
    // `-m <sec>` bounds the wait just above the server's own decision timeout,
    // so a hung server still degrades to the normal prompt rather than wedging
    // the agent. The default 10s sits above the fast path's 8s guard; when the
    // deep "think harder" tier is on the caller widens this to sit above the
    // larger deep guard (the escalated call blocks a few extra seconds while a
    // stronger model reasons). `--data-binary @-` forwards the body verbatim.
    const curlMaxSec = opts.overseerCurlMaxSec ?? 10;
    const overseerCmd =
      'ZCC_IN=$(cat); ' +
      'if [ -n "$ZCC_OVERSEER_URL" ]; then ' +
      'printf "%s" "$ZCC_IN" | ' +
      `curl -s -m ${curlMaxSec} -X POST --data-binary @- "$ZCC_OVERSEER_URL" 2>/dev/null || true; ` +
      'fi; exit 0';
    // Match-all (empty matcher) so every tool call is offered to the cascade;
    // the server decides per call. Appended to any existing PreToolUse entries
    // (notify's AskUserQuestion, subagents' Task) — each entry is independent,
    // gets its own stdin copy, and only THIS one emits a decision, so they don't
    // interfere. When multiple PreToolUse hooks answer, Claude Code takes the
    // most restrictive, so our `allow` can never override another hook's block.
    const overseerHook = { matcher: '', hooks: [{ type: 'command', command: overseerCmd }] };
    if (Array.isArray(hooks.PreToolUse)) {
      hooks.PreToolUse.push(overseerHook);
    } else {
      hooks.PreToolUse = [overseerHook];
    }
  }

  const settings: Record<string, unknown> = { hooks };
  if (opts.autoMode) settings.autoMode = opts.autoMode;
  return JSON.stringify(settings);
}

/**
 * Build the `autoMode` settings block from AppConfig, or undefined when the
 * operator hasn't customized any classifier trust (the bare flag is enough). Each
 * rule list is prefixed with the literal `"$defaults"` so operator entries extend
 * — never replace — Claude Code's built-in guardrails (per the auto-mode-config
 * docs: an array without `"$defaults"` discards every built-in rule for that
 * section). Called only when the launch is actually in auto mode.
 */
export function buildAutoModeSettings(config: AppConfig): Record<string, unknown> | undefined {
  const block: Record<string, unknown> = {};
  const withDefaults = (arr?: string[]) =>
    arr && arr.length > 0 ? ['$defaults', ...arr] : undefined;
  const env = withDefaults(config.autoModeEnvironment);
  if (env) block.environment = env;
  const allow = withDefaults(config.autoModeAllow);
  if (allow) block.allow = allow;
  const soft = withDefaults(config.autoModeSoftDeny);
  if (soft) block.soft_deny = soft;
  const hard = withDefaults(config.autoModeHardDeny);
  if (hard) block.hard_deny = hard;
  if (config.autoModeClassifyAllShell === true) block.classifyAllShell = true;
  return Object.keys(block).length > 0 ? block : undefined;
}
