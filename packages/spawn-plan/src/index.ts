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
 * What remains here are the PURE helpers both the local (`pty.ts`) path and
 * the provider remote path share so they can't drift: guidance / allowed-tools
 * builders, `buildWorktreeGuidance`, `applyHeapCeiling`, and
 * `extractPinnedSessionId`. Claude-specific argv (`personaArgs_build`,
 * project-settings flags) and `cleanExtraArgs` (which also resolves `--model`
 * aliases) live next to their callers. Keeping these pure makes the launch
 * path VERIFIABLE and testable without Electron or a real pty.
 */
import {
  SESSION_MEMORY_DEFAULTS,
  type AppConfig,
  type SessionWorktree
} from '@zana-ai/zcc-domain/product';

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
   'clone a new Git project (rather than work inside this one), use `clone_project`',
   'instead of raw `git clone`: it places the repo under the configured clone root',
   'using its repository name and registers it immediately. For a scaffolded',
   'project, call `register_project` with the resulting directory once it exists —',
   'that is the ONLY way it appears in the user’s sidebar; leaving it unregistered',
   'means the work is effectively invisible to them. Do this immediately after the',
   'clone/scaffold succeeds, not at the end of a longer task. Local projects you',
  'can read directly with your file/shell tools; remote (SSH) projects are',
  'reached through the app, not plain shell, so treat their path as a handle —',
  'to run a command on a remote project’s box, use `remote_exec` (server:',
  'zcc-inbox) with that project’s id (never a raw host); the app resolves the SSH',
  'target and runs your command in the project root. Its first use asks the user',
  'for permission.',
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
    // register_project is project-confined by main and is the documented way
    // to land a completed scaffold in the sidebar without a prompt.
    'mcp__zcc-inbox__register_project'
  ];
  const core = [
    'mcp__zcc-inbox__inbox_push',
    'mcp__zcc-inbox__inbox_ask',
    'mcp__zcc-inbox__inbox_search',
    'mcp__zcc-inbox__schedule_list',
    'mcp__zcc-inbox__preview_file',
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
