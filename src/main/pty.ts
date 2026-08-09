import * as pty from 'node-pty';
import { randomUUID } from 'node:crypto';
import { controlCredentialForSession } from './control-credential.js';
import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { realpathSync } from 'node:fs';
import { isWithin } from './extensions/path-util.js';
import type { LaunchProfileId, TerminalSession, AppConfig, ProjectSettings, ProjectRemote, InboxNotifyLevel, Persona, SessionCohort, SessionWorktree } from '../shared/types.js';
import { SESSION_MEMORY_DEFAULTS } from '../shared/types.js';
import { computeMaxLiveSessions, resolveMaxLiveSessions } from './launch/capacity.js';
export { computeMaxLiveSessions, resolveMaxLiveSessions } from './launch/capacity.js';
import { isClaudeProfile } from '../shared/launch-provider.js';
import { ensureMcpConfigForProjectSync } from './mcp-config.js';
import { stripInheritedClaudeSession } from './env.js';
import { isTmuxAvailable, buildLocalTmuxCommand, wrapRemoteTmux, tmuxSessionName } from './tmux.js';
import { providerFor } from './harness/registry.js';
import type { HarnessAuthInjection, ProviderHookUrls } from './harness/launch-provider.js';
import { getHarnessAuth } from './harness-auth.js';
import { resolveExecutionState, resolveModelTarget, resolveRoleTarget } from './harness/target-resolution.js';
import {
  environmentFor,
  type ExecEnvId,
  type ExecEnvContext,
  type ExecutionSession
} from './harness/execution-environment.js';
import { personaArgs_build } from './harness/claude-code-provider.js';
import { shellQuote } from './harness/shell-quote.js';
import { cleanExtraArgs, mergeAllowedTools, mergeDisallowedTools } from './harness/argv-utils.js';
import { buildWorktreeGuidance } from './harness/spawn-plan.js';

interface Live {
  session: TerminalSession;
  /**
   * The process this session is driven through. Usually a real `node-pty`
   * `IPty` (local/sandbox/remote spawns). For an async, handle-owning execution
   * environment (a microVM/container), it's an {@link ExecutionSession} — the
   * pty layer only touches the surface both types share (`pid`/`onData`/
   * `onExit`/`write`/`resize`/`kill`/`destroy`), so `write`/`reply`/`resize`/
   * `close`/`finalizeExit` need no per-type branching. See
   * {@link PtyManager.attachExecutionSession} for how the async handle is
   * swapped in after the backend boots.
   */
  proc: pty.IPty | ExecutionSession;
  /** Local tmux owns the inner process; app shutdown should drop only our client. */
  localTmuxBacked?: boolean;
  /**
   * Present only for a tmux-backed REMOTE session — the recipe to re-open the
   * ssh link and re-attach the (still-live) remote tmux session after an
   * unexpected drop. See {@link PtyManager.tryReattachRemote}.
   */
  reattach?: RemoteReattach;
  /** Remote tmux teardown is awaiting SSH confirmation; suppress reconnect races. */
  remoteTerminationInFlight?: boolean;
}

/**
 * Everything needed to transparently re-establish a dropped remote ssh link and
 * re-attach its persistent tmux session, keeping the SAME zcc session id so the
 * UI and `reply()` reconnect seamlessly. Only populated when the session was
 * wrapped in remote tmux (`wrapRemoteTmux`) — that's the only case where the
 * remote agent actually survived the drop and can be re-attached; a non-tmux
 * remote reconnect would start a fresh conversation, so we don't auto-reconnect
 * it.
 */
interface RemoteReattach {
  /** `ssh` argv (keepalive opts + `-t <target> <remoteCmd>`), reused verbatim. */
  sshArgs: string[];
  cols: number;
  rows: number;
  spawnEnv: Record<string, string>;
  /** How many reconnect attempts have been made since the last stable stretch. */
  attempts: number;
  /** Timer handle for a pending reconnect (so a manual close can cancel it). */
  timer?: ReturnType<typeof setTimeout>;
  /**
   * `ssh` target (`user@host` or `host`) and the tmux session name — the inputs
   * to the out-of-band liveness probe that distinguishes a dropped link from a
   * remote agent that genuinely finished. See {@link PtyManager.probeRemoteSession}.
   */
  target: string;
  tmuxName: string;
  /** Keepalive/-o opts to reuse on the probe ssh (a subset of sshArgs, no `-t`). */
  probeOpts: string[];
}

/**
 * Result of the pre-reconnect remote liveness probe (`tmux has-session`):
 *  - `alive`     — the tmux session still exists ⇒ a real dropped link ⇒ reattach.
 *  - `gone`      — ssh connected but tmux reports no such session ⇒ the remote
 *                  agent genuinely ended ⇒ finalize, do NOT relaunch a fresh one.
 *  - `unknown`   — ssh itself failed/timed out ⇒ can't tell ⇒ treat as transient
 *                  and let the backoff/budget decide (fail-safe toward reconnect).
 */
type RemoteLiveness = 'alive' | 'gone' | 'unknown';

/**
 * A placeholder {@link ExecutionSession} used while an async, handle-owning
 * execution environment (microVM/container) boots its backend. The session is
 * registered `starting` immediately so its tab lights up with a spinner; any
 * input the user types (or an inbox `reply()` injects) in that window is
 * BUFFERED here and replayed — in submit order — once the real handle is
 * attached (see {@link PtyManager.attachExecutionSession}). `onData`/`onExit`
 * are never wired on the deferred handle (the pty layer only calls
 * `wireSessionIo` on the real handle), so callbacks registered here would never
 * fire — we keep no-op registrars for surface-compatibility only.
 */
class DeferredExecSession implements ExecutionSession {
  readonly pid = undefined;
  private pending: string[] = [];
  private killed = false;
  onData(): void {
    /* the real handle carries output; nothing streams before it attaches */
  }
  onExit(): void {
    /* finalized by attachExecutionSession on failure, not via this handle */
  }
  write(data: string): void {
    if (this.killed) return;
    this.pending.push(data);
  }
  resize(): void {
    /* no tty yet — the real handle picks up the session's dims on attach */
  }
  kill(): void {
    // Closed mid-boot: drop buffered input so it can't leak to the guest once
    // it (briefly) exists. attachExecutionSession sees no live session and
    // tears the freshly-booted guest down.
    this.killed = true;
    this.pending = [];
  }
  /** Replay buffered input into the real handle, in submit order. */
  drainInto(real: ExecutionSession): void {
    if (this.killed) return;
    for (const data of this.pending) real.write(data);
    this.pending = [];
  }
}

/**
 * Timeout (ms) for the out-of-band `ssh … tmux has-session` liveness probe.
 * Kept short — it's a single round-trip; a slow/hung link resolves to `unknown`
 * (transient) so a genuinely dropped-but-recovering link still reconnects.
 */
const REMOTE_PROBE_TIMEOUT_MS = 12_000;

function remoteCommandExitCode(error: unknown): number | undefined {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return typeof code === 'number' ? code : undefined;
}

/**
 * Reconnect budget for a dropped tmux-backed remote link. Attempts use an
 * exponential backoff capped at REMOTE_REATTACH_MAX_DELAY_MS; the counter
 * resets to 0 once a re-attached link streams data (proving it's stable again).
 */
const REMOTE_REATTACH_MAX_ATTEMPTS = 6;
const REMOTE_REATTACH_BASE_DELAY_MS = 1_000;
const REMOTE_REATTACH_MAX_DELAY_MS = 15_000;

/**
 * Coalesce window (ms) for PTY output before it crosses IPC. A chatty command
 * (`npm install`, `git log`) makes node-pty fire `onData` dozens of times a
 * second in tiny chunks; forwarding each as its own IPC message floods the
 * main→renderer pipe. We buffer per-session and flush on this timer, so a burst
 * collapses into one message per window while idle output still arrives within
 * ~one frame. Small enough to feel instant, large enough to absorb a burst.
 */
const PTY_DATA_FLUSH_MS = 8;

/**
 * Per-session output backlog cap (characters). A renderer subscribes to a
 * session's `onData` only once its `TerminalView` mounts — which, for an agent
 * launched straight into the inspector modal / List-view monitor, happens
 * AFTER the pty has already spawned and printed its startup banner. Those early
 * bytes are broadcast to no listener and would be lost, leaving a blank
 * viewport with only a cursor (a "Working" Claude then emits nothing more for
 * seconds). So we retain a bounded tail of recent output and replay it to a
 * late subscriber (see {@link PtyManager.getBacklog}). 256 KB comfortably holds
 * a full-screen Claude TUI plus a healthy scrollback while staying tiny next to
 * xterm's own 50k-line client cap; the oldest bytes are trimmed once exceeded.
 */
const PTY_BACKLOG_MAX_CHARS = 256 * 1024;

/**
 * Hard ceiling on concurrently-live ptys this manager will hold open. Every
 * live session is a real OS process plus an open pty file descriptor (and, for
 * claude sessions, a child node tree whose heap can reach multiple GB on a
 * large-context model); leave the count unbounded and a programmatic caller —
 * the scheduler spawning headless runs whose intervals align, or a runaway
 * create() loop — can exhaust file descriptors AND memory, taking the whole app
 * down (an OS memory-pressure / jetsam kill) rather than failing one launch.
 *
 * The cap is no longer a flat 50. A claude session on a large-context model
 * holds GBs of conversation in V8 heap, so 50 of them can dwarf a 16–64GB box's
 * RAM long before fd exhaustion is the concern. {@link computeMaxLiveSessions}
 * derives a memory-aware default from physical RAM (≈ half of RAM /
 * {@link SESSION_MEMORY_DEFAULTS.perSessionBudgetMB} steady-state per session),
 * clamped to a safe [min, defaultLiveSessions] band, so a roomy box lands on the
 * {@link SESSION_MEMORY_DEFAULTS.defaultLiveSessions} default while the cap still
 * scales DOWN on smaller machines instead of inviting an OOM. The operator can
 * override it via {@link AppConfig.maxLiveSessions} up to the fd-era ceiling
 * (50), which survives as the hard upper bound for an explicit value.
 *
 * The cap counts the live map directly, so an exited session (which deletes
 * itself from the map in onExit) immediately frees a slot. Headless / scheduled
 * sessions count exactly like visible tabs: they spawn the same process + fd +
 * heap, so exempting them would defeat the cap precisely in the unattended
 * fan-out case it exists to guard against.
 *
 * NOTE: this cap counts only the ptys THIS manager spawns. Subagents an agent
 * fans out (the Agent tool, teams, workflows) are grandchildren of a claude
 * session and are NOT counted here — the per-session heap ceiling
 * ({@link buildSessionEnv}) is the backstop for that tree, since NODE_OPTIONS
 * is inherited by those child node processes.
 */
/** Per-session output buffer + its pending flush timer. */
interface DataBuffer {
  chunks: string[];
  timer: ReturnType<typeof setTimeout> | null;
}

/** Profiles that run a Claude-family CLI (i.e. an MCP host). */
// Re-export isClaudeProfile for backward compatibility with existing imports.
// New code should import directly from ../shared/launch-provider.js.
export { isClaudeProfile };
// personaArgs_build moved to the ClaudeCodeProvider during the LaunchProvider
// seam extraction; re-export it for existing tests. New code should import from
// ./harness/claude-code-provider.js.
export { personaArgs_build };

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

export class PtyManager extends EventEmitter {
  private live = new Map<string, Live>();
  /** Base URL of the local MCP server, set after the http listener boots. */
  private mcpBaseUrl: string | null = null;
  /**
   * Registered project roots supplier for the spawn-time cwd re-check (0.4 /
   * Rule 2). Injected once at boot from `index.ts` (`store.listProjects()`).
   * Returns the canonical (realpath'd) roots a local spawn cwd must resolve
   * inside; a spawn whose cwd escapes them all is rejected. Left null in unit
   * tests, where the check is skipped (no store) — the IPC/control-plane path
   * still confines via `createTerminalConfined`, so this is defence-in-depth at
   * the last chokepoint before `pty.spawn`, catching direct core callers
   * (scheduler/goal-manager) that pass a raw `project.path`.
   */
  private projectRoots: (() => string[]) | null = null;
  /**
   * Session ids the launcher itself asked to close (e.g. a scheduler
   * auto-close Stop hook). On exit we report code 0 for these so the run is
   * logged as a clean "success" rather than the non-zero code `proc.kill()`
   * actually yields. See `closeExpected`.
   */
  private expectedClose = new Set<string>();
  /**
   * Per-session output buffers. node-pty `onData` pushes here; a short timer
   * (PTY_DATA_FLUSH_MS) drains each buffer into a single `data` emit. See
   * {@link bufferData} / {@link flushData}.
   */
  private dataBuffers = new Map<string, DataBuffer>();
  /**
   * Per-session output backlog — a bounded tail of the bytes already emitted on
   * `data`, retained so a renderer that subscribes late (agent launched into
   * the inspector modal / List-view monitor, whose TerminalView mounts after
   * the pty has spawned and printed) can replay it into a fresh xterm instead
   * of showing an empty buffer. Trimmed to {@link PTY_BACKLOG_MAX_CHARS};
   * dropped in {@link clearDataBuffer} on exit teardown.
   */
  private backlogs = new Map<string, string>();

  /**
   * Buffer a PTY chunk and arm a flush. All output for a session funnels
   * through here so a burst of small chunks collapses into one IPC message
   * per ~frame instead of one per chunk. The agent-status detector reads the
   * SAME coalesced stream (it only cares about OSC titles / spinner glyphs,
   * which survive coalescing intact), so batching doesn't blind it.
   */
  private bufferData(sessionId: string, data: string): void {
    let buf = this.dataBuffers.get(sessionId);
    if (!buf) {
      buf = { chunks: [], timer: null };
      this.dataBuffers.set(sessionId, buf);
    }
    buf.chunks.push(data);
    if (buf.timer === null) {
      buf.timer = setTimeout(() => this.flushData(sessionId), PTY_DATA_FLUSH_MS);
    }
  }

  /**
   * Drain a session's buffered output into one `data` event. Idempotent and
   * safe to call when nothing is buffered (used on exit to flush the tail
   * before the `exit` event, so no final bytes are dropped).
   */
  private flushData(sessionId: string): void {
    const buf = this.dataBuffers.get(sessionId);
    if (!buf) return;
    if (buf.timer !== null) {
      clearTimeout(buf.timer);
      buf.timer = null;
    }
    if (buf.chunks.length === 0) return;
    const data = buf.chunks.join('');
    buf.chunks = [];
    this.appendBacklog(sessionId, data);
    this.emit('data', sessionId, data);
  }

  /**
   * Append emitted output to the session's replay backlog, trimming the oldest
   * bytes past the cap. Trimming at a raw char boundary can bisect a multi-byte
   * escape sequence, but xterm tolerates a leading partial sequence on replay
   * (it's just discarded), and the subsequent live stream re-establishes state
   * — so a slightly-lossy head is acceptable for a best-effort replay.
   */
  private appendBacklog(sessionId: string, data: string): void {
    const prev = this.backlogs.get(sessionId) ?? '';
    const next = prev + data;
    this.backlogs.set(
      sessionId,
      next.length > PTY_BACKLOG_MAX_CHARS ? next.slice(next.length - PTY_BACKLOG_MAX_CHARS) : next
    );
  }

  /**
   * The retained output tail for a session, for a late-subscribing renderer to
   * replay into a fresh xterm. Empty string when nothing is buffered (unknown
   * session, or one that has produced no output yet).
   */
  getBacklog(sessionId: string): string {
    return this.backlogs.get(sessionId) ?? '';
  }

  /** Drop a session's buffer + pending timer (on exit, after a final flush). */
  private clearDataBuffer(sessionId: string): void {
    const buf = this.dataBuffers.get(sessionId);
    if (buf?.timer != null) clearTimeout(buf.timer);
    this.dataBuffers.delete(sessionId);
    this.backlogs.delete(sessionId);
  }

  list(projectId: string): TerminalSession[] {
    return [...this.live.values()]
      .filter((l) => l.session.projectId === projectId)
      .map((l) => l.session);
  }

  /**
   * Every live session across all projects. Used by the menu-bar popover, which
   * surfaces the whole fleet rather than one project's tabs. Includes headless
   * (background/scheduled) sessions — a blocked scheduled run is exactly what
   * the popover wants to surface.
   */
  listAll(): TerminalSession[] {
    return [...this.live.values()].map((l) => l.session);
  }

  /** Look up a single live session by id, or null if it isn't running. */
  getSession(sessionId: string): TerminalSession | null {
    return this.live.get(sessionId)?.session ?? null;
  }

  /** Resolve only after an async backend owns a real execution handle. */
  waitForReady(sessionId: string): Promise<TerminalSession> {
    const current = this.getSession(sessionId);
    if (!current) return Promise.reject(new Error('terminal failed before execution handle was ready'));
    if (current.status === 'running') return Promise.resolve(current);
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        this.off('sessionUpdated', onUpdate);
        this.off('exit', onExit);
      };
      const onUpdate = (session: TerminalSession) => {
        if (session.id !== sessionId || session.status !== 'running') return;
        cleanup();
        resolve(session);
      };
      const onExit = (id: string, code: number) => {
        if (id !== sessionId) return;
        cleanup();
        reject(new Error(`terminal failed before execution handle was ready (exit ${code})`));
      };
      this.on('sessionUpdated', onUpdate);
      this.on('exit', onExit);
    });
  }

  /** Count of live ptys still running (used for the quit-confirmation prompt). */
  liveCount(): number {
    return this.live.size;
  }

  /**
   * Throw if we're already at the resolved live-session cap. Called at the top
   * of every spawn path (local + remote) so we fail BEFORE allocating any
   * process or fd. The cap is resolved per-call from the launch config
   * ({@link resolveMaxLiveSessions}) so an operator override / a smaller machine
   * takes effect without a restart. Counts `this.live.size` directly — exited
   * sessions have already removed themselves from the map (see onExit), so a
   * freed slot is available on the very next create. Throwing (rather than
   * returning null) is deliberate: the IPC create handler already surfaces
   * create errors to the renderer, and the scheduler's fire() wraps create in
   * try/catch and records the failure as an errored run — so the cap is visible,
   * never a silent drop.
   */
  private assertCapacity(config?: AppConfig): void {
    const cap = resolveMaxLiveSessions(config);
    if (this.live.size >= cap) {
      throw new Error(
        `live-session cap reached (${this.live.size}/${cap}); ` +
          `close a session before opening another`
      );
    }
  }

  /**
   * Set the base URL of the local MCP server. Called once at boot from
   * `index.ts` after `startMcpServer()` resolves. Re-callable for tests.
   */
  setMcpBaseUrl(url: string | null) {
    this.mcpBaseUrl = url;
  }

  /**
   * The local TCP port the MCP/hook http server is bound to, parsed from
   * `mcpBaseUrl` (`http://127.0.0.1:<port>`). Used by the remote path to build
   * the `ssh -R <remotePort>:127.0.0.1:<localPort>` reverse forward. Returns
   * null when the server isn't up or the URL carries no explicit port — in which
   * case the remote spawn falls through to the historical no-hooks behaviour.
   */
  private localMcpPort(): number | null {
    if (!this.mcpBaseUrl) return null;
    try {
      const port = Number(new URL(this.mcpBaseUrl).port);
      return Number.isInteger(port) && port > 0 ? port : null;
    } catch {
      return null;
    }
  }

  /**
   * Inject the registered-project-roots supplier for the spawn-time cwd
   * re-check (0.4 / Rule 2). Called once at boot from `index.ts`. When unset
   * (unit tests), {@link assertCwdConfined} is a no-op.
   */
  setProjectRoots(roots: (() => string[]) | null) {
    this.projectRoots = roots;
  }

  /**
   * Resolver for the operator's layered RULES.md guidance (WARP-C5), keyed by
   * projectId. Injected once at boot from `index.ts`, where `store.listProjects()`
   * is available to map the id to a confined project root and read
   * `~/.zcc/RULES.md` + `<root>/.zcc/RULES.md`. Kept as an injected closure so
   * PtyManager stays free of file I/O and Rule-2 concerns (those live at the
   * wiring site + `rules-file.ts`). Returns the composed system-prompt block, or
   * null when there's nothing to inject (a launch then stays byte-identical).
   * Null in unit tests (no wiring) → no rules layer, argv unchanged.
   */
  private rulesResolver: ((projectId: string) => string | null) | null = null;

  /** Inject the RULES.md guidance resolver (WARP-C5). Called once at boot. */
  setRulesResolver(resolver: ((projectId: string) => string | null) | null) {
    this.rulesResolver = resolver;
  }

  /**
   * Re-confine a LOCAL spawn cwd at the moment of spawn (Rule 2): a path is
   * only trusted after `realpath`-matching a registered project root. Upstream
   * confinement (`createTerminalConfined`) resolves cwd when the terminal is
   * first requested, but a symlink swapped afterwards — or a raw `project.path`
   * handed straight to `create()` by a core caller (scheduler/goal-manager) —
   * could still point outside every registered root by spawn time. We realpath
   * the cwd AND each root here and reject an escape, so a symlinked project
   * path (e.g. `~/.zcc/projects.json` hand-edited to a link → `/`) can't spawn
   * an agent outside the confined tree.
   *
   * Skipped when no roots supplier is injected (unit tests). Remote spawns are
   * exempt — their cwd lives on the remote host, never realpath-able locally.
   */
  private assertCwdConfined(cwd: string): void {
    if (!this.projectRoots) return; // no store wired (tests) → skip
    let realCwd: string;
    try {
      realCwd = realpathSync(cwd);
    } catch {
      throw new Error(`spawn cwd does not resolve: ${cwd}`);
    }
    const roots = this.projectRoots();
    const ok = roots.some((root) => {
      try {
        return isWithin(realCwd, realpathSync(root));
      } catch {
        return false;
      }
    });
    if (!ok) {
      throw new Error(`spawn cwd escapes every registered project root: ${cwd}`);
    }
  }

  /**
   * Ensure the per-project `.mcp.json` exists on disk and return its path,
   * or null if the write failed. Null makes the caller skip MCP injection
   * entirely (terminal still opens) rather than launch claude with a
   * `--mcp-config` that points at nothing.
   * @param extraServerNames Optional persona mcpServers to merge into the config.
   */
  private safeEnsureMcpConfig(projectId: string, extraServerNames?: string[]): string | null {
    try {
      return ensureMcpConfigForProjectSync(projectId, extraServerNames);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[pty] ensureMcpConfigForProjectSync(${projectId}) failed:`, err);
      return null;
    }
  }

  create(opts: {
    /** Main coordinator-owned identity, allocated before authorization/commit. */
    preallocatedSessionId?: string;
    projectId: string;
    profile: LaunchProfileId;
    cwd: string;
    cols: number;
    rows: number;
    config: AppConfig;
    projectSettings?: ProjectSettings;
    extraArgs?: string[];
    harnessRouting?: import('../shared/types.js').HarnessModelRoutingV1;
    title?: string;
    remote?: ProjectRemote;
    /**
     * Optional persona to launch as. When set, the persona's flag layer is
     * inserted between AppConfig globals and per-project settings, and
     * `persona.baseProfile` (if present) overrides `profile` as the base command.
     * The resolved persona sits at: base → AppConfig globals → MCP → PERSONA →
     * ProjectSettings → per-tab extraArgs (lowest → highest precedence).
     */
    persona?: Persona;
    /**
     * Inject a Stop hook so the session auto-closes when Claude finishes its
     * response. Used by scheduler fires that opt into `autoCloseOnFinish`.
     * Ignored for non-claude profiles (shell has no Stop event) and when the
     * local callback server URL isn't known yet.
     */
    autoCloseOnFinish?: boolean;
    /**
     * Spawn the session already detached from the tab strip. The pty runs
     * normally; `visibleTerminals()` in the renderer filters it out until the
     * user promotes it (e.g. the inbox "Open in session" deep-link). Used by
     * scheduler fires so background runs don't pile up visible tabs — yet stay
     * alive and replyable from the inbox.
     */
    headless?: boolean;
    /**
     * Marks this spawn as a scheduled run. When set (and the profile is
     * claude-family), we append `SCHEDULE_REPORT_GUIDANCE` to the system prompt
     * so the agent knows to file a run report via `schedule_report`. Off for
     * user-opened tabs so they aren't nagged to report.
     */
    scheduled?: boolean;
    /**
     * Mark this spawn as part of an AUTONOMOUS team run (agents must act
     * unattended). Full bypass (`--dangerously-skip-permissions`) is NOT used —
     * an enterprise-managed Claude Code policy (`managed-settings.json:
     * disableBypassPermissionsMode`) forbids it org-wide and silently falls back
     * to prompting. Instead this forces `--permission-mode acceptEdits` (the most
     * autonomy the policy permits): file edits + MCP tools auto-accept; only raw
     * Bash still prompts. It also pre-approves `agent_send` (peer messaging) and
     * disallows `AskUserQuestion` (an unattended agent must decide, not ask).
     * MAIN-only (never settable from the renderer `CreateTerminalRequest`); set by
     * `launchTeam` for autonomous launches.
     */
    autonomous?: boolean;
    /**
     * Scheduled inbox loudness, baked onto the session so an agent `inbox_push`
     * during this run is stamped (or, when `silent`, dropped) accordingly.
     */
    inboxLevel?: InboxNotifyLevel;
    /**
     * Isolated git worktree this session was launched into (the launcher's
     * "Isolate in a worktree" option). Set by `createTerminalConfined` after the
     * `terminals:create` handler minted/adopted the checkout; `cwd` above already
     * points at `worktree.path`. Recorded verbatim on the session so the Agents
     * board can badge the branch and the on-close prune can find the checkout.
     * Absent on a normal launch. Drives the WORKTREE guidance in the spawn plan.
     */
    worktree?: SessionWorktree;
    /**
     * Team-launch cohort stamp (set only by `launchTeam`). Carried verbatim onto
     * the session record so the Agents board can group the launch's tabs and
     * mark the orchestrator. Absent on every other spawn.
     */
    cohort?: SessionCohort;
    /**
     * Wake-from-sleep reconnect (REMOTE only): the original session id whose
     * dead `ssh` proxy we're replacing. Re-attaches the live `cc-<id>` tmux
     * session on the box. See {@link createRemote}. Ignored on local spawns.
     */
    reconnectTmuxId?: string;
    /** Reconnect resume: fold `--continue` into a remote claude spawn so a
     *  create-fresh reconnect resumes the prior conversation. See {@link createRemote}. */
    resume?: boolean;
    /**
     * Provider-native EXACT-session resume target — the id to reopen instead of
     * the profile's blunt most-recent resume. Used by session restore for a
     * profile whose resume dialect is a POSITIONAL subcommand the launcher can't
     * append (codex: `resume <uuid>`). Claude's per-tab resume rides `extraArgs`
     * (`--resume <claudeSessionId>`) instead, so this is codex-only today. Passed
     * straight to `provider.resolveLaunch`; a provider that resumes by flag
     * ignores it. Renderer-supplied on restore, but it only selects WHICH prior
     * session the CLI reopens (the CLI validates it) — never a path/trust anchor.
     */
    resumeSessionId?: string;
    /**
     * Execution environment — WHERE the agent runs (local vs kernel-sandbox),
     * orthogonal to `profile` (WHAT agent runs). Defaults to `'local'` (verbatim
     * spawn, byte-identical to before this field existed). `'sandbox'` runs the
     * agent process under an OS kernel sandbox (Seatbelt on macOS), inherited by
     * every child it spawns; it degrades to a verbatim spawn with an honest
     * `isolationStatus` when the kernel can't enforce it. See
     * {@link environmentFor}. LOCAL only — ignored on the remote path.
     */
    environment?: ExecEnvId;
    /**
     * Deny outbound network from the sandboxed agent (sandbox env only). Off by
     * default — a pty agent needs the LLM API + local MCP callbacks. Set for
     * untrusted/no-egress work. Ignored when `environment` isn't `'sandbox'`.
     */
    sandboxDenyNetwork?: boolean;
    /**
     * microVM-only ADVISORY hints (env `'microvm'`). `microVmImage` is an
     * allowlist key or an allowlisted ref; cpus/memory are clamped — all
     * re-authorized in the microVM builder (Rule 1). Ignored by other envs.
     */
    microVmImage?: string;
    microVmCpus?: number;
    microVmMemoryMib?: number;
  }): TerminalSession {
    if (opts.remote) {
      return this.createRemote({ ...opts, remote: opts.remote });
    }
    // Live-session cap: refuse cleanly before spawning anything. Checked here
    // (after the remote delegation, so the remote path is guarded by
    // createRemote's own check and never double-counted) and before we mint
    // ids / write the MCP config, so a rejected launch leaves no residue. The
    // thrown error surfaces to the renderer via the create IPC handler and is
    // caught by the scheduler's fire() try/catch (recorded as an errored run,
    // then skipped) — never a silent drop.
    this.assertCapacity(opts.config);
    // Rule 2: re-confine the LOCAL spawn cwd at spawn time. A symlink-escape cwd
    // (or a raw project.path handed in by a core caller) is rejected here,
    // before any id/MCP-config residue. No-op in tests (no roots injected).
    this.assertCwdConfined(opts.cwd);
    // When a persona is present, its baseProfile (if any) overrides the
    // opts.profile as the base command. This lets a persona declare "I always
    // run as claude-yolo" without the caller needing to know.
    const personaOrOptsProfile = opts.persona?.baseProfile ?? opts.profile;
    // AUTONOMOUS squad runs launch on the `claude-yolo` base (full bypass —
    // `--dangerously-skip-permissions`, no per-tool prompts at all) so an
    // unattended team never stalls on an approval. This deliberately OVERRIDES a
    // claude-family persona's baseProfile (the built-in orchestrator/worker
    // personas pin `claude`), because the operator opted the whole squad into
    // yolo at launch — a per-persona base must not quietly downgrade it. Only
    // claude-family bases are switched: a cursor/codex persona keeps its own
    // profile (yolo is a claude-only concept), and a non-autonomous launch is
    // untouched. CAVEAT: an enterprise `managed-settings.json:
    // disableBypassPermissionsMode` policy, if present on this fleet, makes
    // claude ignore the bypass flag and silently fall back to prompting — the
    // known trade-off of choosing the yolo base.
    const effectiveProfile: LaunchProfileId =
      opts.autonomous && isClaudeProfile(personaOrOptsProfile)
        ? 'claude-yolo'
        : personaOrOptsProfile;
    // Resolve the launch provider for this profile (Rule 6: the profile → provider
    // mapping lives in the registry; PtyManager dispatches through the seam and
    // never names a provider in its launch logic).
    const provider = providerFor(effectiveProfile);
    const caps = provider.capabilities(effectiveProfile);
    // Auto mode (Claude Code's native classifier-backed --permission-mode auto)
    // is the default for interactive claude launches. Resolve it up front: it
    // decides the base permission flag (resolveLaunch), whether the Overseer hook
    // is installed (they're mutually exclusive — auto mode is a superset), the
    // CLAUDE_CODE_ENABLE_AUTO_MODE env var, and the classifier --settings block.
    const preCleanedExtra = cleanExtraArgs(opts.extraArgs);
    const autoModeActive = provider.computeAutoModeActive({
      profile: effectiveProfile,
      config: opts.config,
      persona: opts.persona,
      projectSettings: opts.projectSettings,
      harnessRouting: opts.harnessRouting,
      extraArgs: preCleanedExtra
    });
    const modelTarget = resolveModelTarget(provider, {
      config: opts.config,
      persona: opts.persona,
      projectSettings: opts.projectSettings,
      perTabRouting: opts.harnessRouting,
      profile: effectiveProfile,
      extraArgs: preCleanedExtra,
      scope: 'local'
    });
    const roleTarget = resolveRoleTarget(provider, {
      config: opts.config,
      persona: opts.persona,
      projectSettings: opts.projectSettings,
      perTabRouting: opts.harnessRouting,
      profile: effectiveProfile,
      extraArgs: preCleanedExtra,
      scope: 'local'
    });
    const execution = resolveExecutionState(provider, {
      config: opts.config,
      persona: opts.persona,
      projectSettings: opts.projectSettings,
      perTabRouting: opts.harnessRouting,
      profile: effectiveProfile,
      extraArgs: preCleanedExtra,
      scope: 'local'
    });
    const combinationError = provider.validateRoutingCombination?.({
      roleTargetId: roleTarget.targetId,
      executionOrigin: execution.origin
    });
    if (combinationError) throw new Error(`${combinationError}.`);

    const { command, args } = provider.resolveLaunch(
      effectiveProfile,
      opts.config,
      autoModeActive,
      opts.resumeSessionId
    );
    // Mint the session id up front so we can bake it into the per-session
    // MCP + hook URLs the agent/CLI connect back on. This lets `inbox_push`
    // stamp the originating terminal onto each entry and lets a Stop hook
    // name the exact tab to close — without it, callbacks can only target
    // the project, not the specific session.
    const sessionId = opts.preallocatedSessionId ?? randomUUID();
    // The per-session zcc-inbox MCP server URL, with the project + session
    // identity baked into the path so callbacks (inbox_push, hooks) can stamp the
    // exact originating terminal. Null until the local MCP server has a base URL.
    // Used two ways below: claude env-substitutes it into its `--mcp-config` file
    // via `ZCC_MCP_URL`; a provider whose CLI carries MCP as ARGS (codex) bakes it
    // straight into `provider.mcpArgs`.
    const sessionCredential = controlCredentialForSession(sessionId);
    const mcpServerUrl = this.mcpBaseUrl
      ? `${this.mcpBaseUrl}/mcp/${opts.projectId}/${sessionId}/${sessionCredential}`
      : null;
    // For claude-family profiles, point the CLI at the launcher-owned
    // .mcp.json so the agent picks up the zcc-inbox server. The URL in
    // that file is `${ZCC_MCP_URL}`, which Claude evaluates against the
    // env we inject below — keeps the per-project config file static
    // (just one file per project) but identity-bearing at spawn time.
    //
    // Guarantee the file exists *now*, synchronously, rather than trusting an
    // earlier async write to have landed. The async writers race app boot;
    // pointing `--mcp-config` at a not-yet-written file would silently drop
    // the inbox server. If even the sync write fails, fall back to no MCP
    // injection so the terminal still opens. When a persona requests extra MCP
    // servers, merge them into the config (resolved against the registry;
    // unknown names are silently ignored).
    const mcpConfigPath =
      caps.injectsClaudeMcpConfig && this.mcpBaseUrl
        ? this.safeEnsureMcpConfig(opts.projectId, opts.persona?.mcpServers)
        : null;
    // The inbox/mesh/report GUIDANCE text — one assembled string, delivered two
    // ways below. Teaches the agent when to use inbox_push (and, for scheduled
    // runs, to file a run report), how to discover peers (the mesh tools are
    // pre-approved below, so using them never prompts), and how to resolve
    // sibling projects / the zana orchestration surface + library without being
    // handed paths. Scheduled runs get the extra schedule-report block; user-
    // opened tabs get only the inbox guidance. Built once so the claude
    // `--append-system-prompt` path and the codex `-c developer_instructions`
    // path (guidanceArgs) deliver IDENTICAL guidance.
    const guidanceText = opts.scheduled
      ? `${INBOX_USAGE_GUIDANCE}\n\n${SCHEDULE_REPORT_GUIDANCE}\n\n${AGENT_MESH_GUIDANCE}\n\n${PROJECT_AWARENESS_GUIDANCE}\n\n${PROJECT_LIBRARY_GUIDANCE}\n\n${FOLLOWUP_USAGE_GUIDANCE}`
      : `${INBOX_USAGE_GUIDANCE}\n\n${AGENT_MESH_GUIDANCE}\n\n${PROJECT_AWARENESS_GUIDANCE}\n\n${PROJECT_LIBRARY_GUIDANCE}\n\n${FOLLOWUP_USAGE_GUIDANCE}`;
    // Operator RULES.md (WARP-C5): the composed global + project standing
    // instructions, or null when neither file exists. Resolved via the injected
    // resolver (file I/O + Rule-2 confinement live in `rules-file.ts` + the boot
    // wiring). Layered as its own additive --append-system-prompt block below;
    // absent on every launch with no rules files, so the argv stays byte-identical.
    const rulesText = this.rulesResolver ? this.rulesResolver(opts.projectId) : null;
    const claudeMcpArgs = mcpConfigPath
      ? [
          '--mcp-config',
          mcpConfigPath,
          // Appended to the system prompt at spawn so it doesn't pollute the
          // user's global claude config — the guidance only applies to
          // launcher-spawned tabs.
          '--append-system-prompt',
          guidanceText,
          // An isolated-worktree launch layers a SECOND --append-system-prompt
          // block (additive: claude concatenates them) teaching the agent it's
          // on its own branch/checkout. Only when `worktree` is set — a normal
          // launch's argv is byte-identical to before. The path/branch come from
          // the app-managed worktree record (a realpath under ~/zcc-worktrees),
          // never raw user free-text.
          ...(opts.worktree
            ? ['--append-system-prompt', buildWorktreeGuidance(opts.worktree)]
            : []),
          // Operator RULES.md block: another additive layer, present ONLY when a
          // global/project RULES.md contributed text. Placed AFTER the worktree
          // block so a project's standing rules read as the latest word. Absent
          // otherwise (byte-identical argv).
          ...(rulesText ? ['--append-system-prompt', rulesText] : [])
        ]
      : [];
    // MCP wiring for providers whose CLI carries MCP config as ARGS rather than
    // as claude's `--mcp-config` file (codex takes `-c mcp_servers.zcc-inbox.url=…`).
    // The provider owns the concrete flag (Rule 6): claude/cursor/shell return []
    // here — claude uses the file+env path above, cursor can't be bridged (its CLI
    // reads MCP only from off-limits project/global config), shell has no MCP.
    // Gated on a live server URL, same as the claude file path.
    const providerMcpArgs = mcpServerUrl
      ? provider.mcpArgs(effectiveProfile, mcpServerUrl)
      : [];
    // MCP wiring for providers whose CLI carries MCP config as an ENV VAR rather
    // than a file (claude) or `-c` arg (codex): OpenCode reads
    // `OPENCODE_CONFIG_CONTENT` (inline config JSON, deep-merged last over its own
    // config), so the provider returns `{ OPENCODE_CONFIG_CONTENT: … }` with the
    // zcc-inbox server + identity-bearing URL baked in — no file touched (Rule 2),
    // and the deep merge preserves the user's own MCP servers. Merged into the
    // child env below. claude/codex/cursor/pi/shell return `{}` (they use the
    // file+env, `-c`-arg, or no MCP surface). Gated on a live server URL, same as
    // the claude file path + providerMcpArgs. Rule 6: the concrete
    // `OPENCODE_CONFIG_CONTENT` string lives only in the OpenCode provider.
    const providerMcpEnv = mcpServerUrl
      ? provider.mcpEnv(effectiveProfile, mcpServerUrl)
      : {};
    // GUIDANCE wiring for providers whose CLI carries system-prompt guidance as
    // ARGS (codex takes `-c developer_instructions=…`). The counterpart to
    // providerMcpArgs for the *instructions* channel: only meaningful when we
    // actually wired the inbox server in, so gate it on the SAME live-URL check —
    // teaching an agent to use inbox_push it doesn't have would be noise. claude
    // returns [] (its guidance rides on --append-system-prompt above); cursor/
    // shell return [] (no flag-level guidance channel). Rule 6: the concrete
    // `-c developer_instructions` string lives only in the codex provider.
    // codex has ONE `developer_instructions` value (not claude's stack of
    // additive `--append-system-prompt` blocks), so fold the SAME worktree +
    // RULES.md blocks the claude path layers onto `claudeMcpArgs` into a single
    // composed guidance string here. Order mirrors the claude path (base →
    // worktree → rules) so a codex tab reads the identical standing instructions
    // as a claude tab. Both extras are absent on a normal launch, so the composed
    // string collapses to `guidanceText` (byte-identical argv, golden-argv net).
    const composedGuidanceText = [
      guidanceText,
      ...(opts.worktree ? [buildWorktreeGuidance(opts.worktree)] : []),
      ...(rulesText ? [rulesText] : [])
    ].join('\n\n');
    const providerGuidanceArgs = mcpServerUrl
      ? provider.guidanceArgs(effectiveProfile, composedGuidanceText)
      : [];
    // HOOK wiring for providers whose CLI carries lifecycle hooks as ARGS (codex
    // takes `-c hooks.<Event>=[…]` + the global `--dangerously-bypass-hook-trust`
    // flag). The lifecycle counterpart to providerMcpArgs/providerGuidanceArgs: it
    // registers `command` hooks that curl the SAME identity-baked `/hook/*` URLs
    // the claude path bakes into its `ZCC_*_URL` env, so codex's signals land on
    // the same provider-AGNOSTIC handlers (onStopHook / onNotifyHook /
    // onFirstPromptHook / onSubagentHook). Per-hook wanted-ness mirrors the claude
    // gates (below) but is expressed provider-neutrally from `opts` (the claude
    // `wantsStopHook`/… are defined later and gated on `claudeWithCallback`, which
    // is false for codex): stop rides auto-close/scheduled, first-prompt is
    // interactive-only, notify + subagent ride every callback-bearing tab.
    // claude returns [] here (its hooks ride the launcher-owned `--settings` JSON
    // gated on `injectsClaudeMcpConfig`); cursor/shell return []. Rule 6: the
    // concrete `-c hooks.…` strings + bypass flag live ONLY in the codex provider.
    const providerHookBase =
      this.mcpBaseUrl && !opts.headless
        ? `${this.mcpBaseUrl}/hook`
        : null;
    const providerHookUrls: ProviderHookUrls = providerHookBase
      ? {
          stop:
            opts.autoCloseOnFinish || opts.scheduled
              ? `${providerHookBase}/stop/${opts.projectId}/${sessionId}`
              : undefined,
          notify: `${providerHookBase}/notify/${opts.projectId}/${sessionId}`,
          firstPrompt: opts.scheduled
            ? undefined
            : `${providerHookBase}/firstprompt/${opts.projectId}/${sessionId}`,
          subagent: `${providerHookBase}/subagent/${opts.projectId}/${sessionId}`
        }
      : {};
    const providerHookArgs = providerHookBase
      ? provider.hookArgs(effectiveProfile, providerHookUrls)
      : [];
    // Per-harness AUTH override (Settings → Harness): a stored base URL + token
    // for this profile's credential family, letting the operator point the CLI at
    // a gateway/proxy or supply a key WITHOUT running the CLI's own `login`. The
    // provider owns the profile→family map (`authKey`, Rule 6) and its CLI's auth
    // dialect (`authInjection`): claude/cursor emit env only, codex also emits a
    // `-c model_providers.*` block. `getHarnessAuth` reads main's own encrypted
    // store (Rule 1 — never renderer-supplied) and returns `{}` when nothing is
    // stored, so `authInjection` returns `{}` and a plain launch stays
    // byte-identical (guarded by the golden-argv net). `env` is merged into the
    // child env below; `args` splice into fullArgs alongside the other `-c` args.
    const authFamily = provider.authKey(effectiveProfile);
    const providerAuth: HarnessAuthInjection = authFamily
      ? provider.authInjection(effectiveProfile, getHarnessAuth(authFamily))
      : {};
    const providerAuthArgs = providerAuth.args ?? [];
    // Persona flags: inserted AFTER claudeMcpArgs so the persona's
    // append-system-prompt layers on TOP of the inbox guidance (personas can
    // build on the baseline inbox behavior), and BEFORE projectSettings so
    // per-project overrides still win. The provider owns whether it honours
    // personas: the shell provider returns [] (a persona on a shell tab is a
    // no-op), so no profile branch is needed here.
    const personaArgs = opts.persona
      ? provider.personaArgs(opts.persona, effectiveProfile)
      : [];
    const psArgs = opts.projectSettings
      ? provider.projectSettingsArgs(opts.projectSettings, effectiveProfile)
      : [];


    // Stop hook: inject a `--settings` hook (additive — merges with, never
    // replaces, the user's own settings files) that pings our local callback
    // server when the agent finishes its turn. We want this for EVERY scheduled
    // run, not only auto-close ones: a non-auto-close scheduled session stays
    // open at the prompt after finishing, and the hook is how the scheduler
    // learns the turn ended (so the UI can show "done" instead of "running"
    // forever). `autoClose` only decides whether the callback *kills* the pty
    // (handled in index.ts via the task's autoCloseOnFinish flag). Claude
    // profiles only, and only when we know the callback URL.
    //
    // Gated on `injectsClaudeMcpConfig` (the claude-family flag that also gates
    // the `--mcp-config` file), NOT `supportsHooks`: codex ALSO supports hooks
    // now, but it carries them as `-c hooks.…` ARGS via `providerHookArgs` above —
    // it must NOT get claude's `--settings` JSON + `ZCC_*_URL` env, which its CLI
    // doesn't understand. So this whole block stays claude-only. (Byte-identical
    // for every profile today: `injectsClaudeMcpConfig === hasTranscript`; the
    // flags were de-conflated so a future transcript-bearing non-Claude provider
    // won't inherit these Claude-only injections.)
    const claudeWithCallback = caps.injectsClaudeMcpConfig && !!this.mcpBaseUrl;
    const autoClose = !!opts.autoCloseOnFinish && claudeWithCallback;
    const wantsStopHook = claudeWithCallback && (autoClose || !!opts.scheduled);
    // Notification hook: light a "blocked — needs you" status when the agent
    // is waiting on the user (permission prompt / interactive question). This
    // is the ONLY reliable signal for that — the OSC title shows the same `✳`
    // glyph whether idle or blocked. Wanted for EVERY interactive claude tab,
    // not just scheduled ones, so it rides on claudeWithCallback alone.
    const wantsNotifyHook = claudeWithCallback;
    // First-prompt hook: forward the user's first instruction so the main
    // process can name the tab via an LLM micro-call. Rides on the same
    // callback gate as notify (interactive claude tabs). Scheduled runs deliver
    // their prompt as positional argv (no UserPromptSubmit), so this only ever
    // fires for interactive sessions — exactly the ones with a tab to name.
    const wantsFirstPromptHook = claudeWithCallback && !opts.scheduled;
    // Sub-agent (Task tool) live-count hook: a PreToolUse(Task)/SubagentStop
    // pair that POSTs start/stop so the UI can badge "N sub-agents running" on
    // the parent. Wanted for every claude tab with a callback — a fanned-out
    // scheduled run is exactly where this visibility matters most.
    const wantsSubagentHook = claudeWithCallback;
    // Overseer auto-approval hook (experimental, off by default). A synchronous
    // PreToolUse hook that lets the local server auto-approve provably-safe tool
    // calls (see {@link Overseer}). Installed ONLY when the feature is armed
    // (`overseerMode` is dryRun/on) — when off, no hook is emitted, so the
    // feature is completely inert and disabling it fully restores stock
    // behaviour. Interactive claude tabs only: a scheduled/headless run has no
    // human to spare prompts for, and bypassPermissions runs don't prompt at all
    // — so we skip both, and skip the `claude-yolo` profile, which already runs
    // with --dangerously-skip-permissions (no prompts to intercept).
    // Overseer and auto mode are mutually exclusive per launch: auto mode's
    // server-side classifier is a strict superset of the Overseer's fail-open
    // local cascade (it both allows AND blocks, and doesn't burn tokens on the
    // Overseer's own LLM tier), so installing both would double-gate every tool
    // call for no gain. When auto mode is active the Overseer hook is suppressed;
    // the Overseer remains the fallback whenever auto mode is off/unavailable.
    const overseerMode = opts.config.overseerMode ?? 'off';
    const wantsOverseerHook =
      claudeWithCallback &&
      overseerMode !== 'off' &&
      !autoModeActive &&
      !opts.scheduled &&
      !opts.headless &&
      // Skip the yolo profile: it runs --dangerously-skip-permissions, so there
      // are no prompts for the Overseer to intercept. `acceptsPermissionMode` is
      // false exactly for that profile.
      caps.acceptsPermissionMode;
    // Content Screen (experimental, off by default) — inbound prompt-injection
    // defense, the counterpart to the Overseer above but on the OTHER hook
    // (PostToolUse, screening a tool's RESULT rather than gating its call — see
    // {@link ContentScreen}). None of the Overseer's exclusions apply here,
    // deliberately: this hook never touches a permission prompt, so it's just
    // as relevant to a scheduled/headless run (no human present to notice a
    // hijacked follow-up action) and to the yolo profile
    // (--dangerously-skip-permissions has the LARGEST blast radius from a
    // hijacked agent, since there's no prompt left to catch the bad follow-up
    // either), and it screens a different axis than auto mode's outbound
    // classifier, so it isn't suppressed when auto mode is active either.
    const contentScreenMode = opts.config.contentScreenMode ?? 'off';
    const wantsContentScreenHook = claudeWithCallback && contentScreenMode !== 'off';
    // Auto-mode classifier trust config → the `autoMode` settings block. Only
    // built when auto mode is active AND the operator configured at least one
    // rule list / classifyAllShell — the bare `--permission-mode auto` flag is
    // what enables auto mode; this block only tunes what the classifier trusts.
    // Each list is spliced after Claude Code's built-in `"$defaults"` so operator
    // entries are additive and never discard the built-in guardrails.
    const autoModeSettings = autoModeActive
      ? buildAutoModeSettings(opts.config)
      : undefined;
    const wantsAnyHook =
      wantsStopHook ||
      wantsNotifyHook ||
      wantsFirstPromptHook ||
      wantsSubagentHook ||
      wantsOverseerHook ||
      wantsContentScreenHook;
    const hookArgs =
      wantsAnyHook || autoModeSettings
        ? [
            '--settings',
            buildHookSettings({
              stop: wantsStopHook,
              notify: wantsNotifyHook,
              firstPrompt: wantsFirstPromptHook,
              subagents: wantsSubagentHook,
              overseer: wantsOverseerHook,
              // When the deep "think harder" tier is on, an escalated call blocks
              // the agent while a stronger model reasons — widen the curl ceiling
              // to sit just above the server's deep decision guard (24s). Fast
              // path keeps the default 10s. Kept in lockstep with
              // OVERSEER_DEEP_DECISION_TIMEOUT_MS in index.ts.
              overseerCurlMaxSec:
                overseerMode !== 'off' && opts.config.overseerDeepTierEnabled === true ? 28 : 10,
              contentScreen: wantsContentScreenHook,
              autoMode: autoModeSettings
            })
          ]
        : [];
    // Pre-approve the inbox push tool so the agent can use it without
    // prompting. We merge into the allowedTools list (rather than emit a
    // second --allowedTools flag) because some claude-cli versions take
    // last-occurrence-wins, which would silently drop this permission when
    // the project also configures allowedTools.
    // Gate the inbox allowlist on the config file actually being in place
    // (mcpConfigPath), not just mcpBaseUrl — no point pre-approving a tool
    // whose server we failed to wire up.
    // Agent-mesh tools. The discovery tools (register/list/find) and the
    // read-only `agent_inbox` are safe to pre-approve so they never raise a
    // prompt. `agent_send` is normally NOT here — sending a message to a peer is
    // a human-in-the-loop action, so the first send surfaces a permission prompt
    // the user blesses once (prompt-on-first-send, Q6).
    //
    // EXCEPTION — autonomous team runs (`autonomous`): the whole point is agents
    // messaging each other to reach a goal unattended, so prompt-on-first-send
    // would block every agent on its first hand-off. For these (and only these)
    // spawns we pre-approve `agent_send` too, so the team runs with zero
    // approvals. Non-autonomous agents keep the deliberate one-time prompt.
    const meshAllow = [
      'mcp__zcc-inbox__register_agent',
      'mcp__zcc-inbox__list_agents',
      'mcp__zcc-inbox__find_agent',
      'mcp__zcc-inbox__agent_inbox',
      ...(opts.autonomous ? ['mcp__zcc-inbox__agent_send'] : [])
    ];
    // Agent-data tools — follow-ups, library, and goals. Same host-confined trust
    // model as `inbox_push`: the `projectId`/`sessionId` they operate on is closed
    // over from the MCP URL route (`/mcp/:projectId/:sessionId`), never agent
    // free-text, and writes are provenance-stamped + confined to the `.zcc/`
    // agent-data subtree (mirrors the overseer's `ZCC_AGENT_DATA_DIRS` carve-out).
    // So parking a question / note / goal mid-run never raises a prompt. Reads and
    // creates/writes are pre-approved; `library_remove` (a DELETE) is deliberately
    // NOT — destructive ops still surface a first-use prompt.
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
    // `remote_exec` runs an arbitrary shell command on a registered remote (SSH)
    // project — a privileged action, so like `agent_send` it is NOT pre-approved
    // for a normal agent (the first call raises a permission prompt the user
    // blesses once). The ONE exception is an autonomous team run, where a blocking
    // prompt would stall an unattended fleet — mirroring the `agent_send`
    // carve-out in `meshAllow`.
    const remoteExecAllow = opts.autonomous ? ['mcp__zcc-inbox__remote_exec'] : [];
    // `microvm_exec` runs an arbitrary shell command inside a SANDBOXED microVM
    // playground (isolated guest, no host mount). It's safer than `remote_exec`
    // (the blast radius is a throwaway VM, not a real box), but it's still a
    // privileged "run code" action, so it follows the SAME pre-approval posture:
    // NOT pre-approved for a normal agent (first call prompts), auto-allowed ONLY
    // on an autonomous team run where a blocking prompt would stall the fleet.
    // `microvm_reset` just wipes a guest — harmless — so it rides the same gate.
    const microvmExecAllow = opts.autonomous
      ? ['mcp__zcc-inbox__microvm_exec', 'mcp__zcc-inbox__microvm_reset']
      : [];
    // "Trust all ZCC tools" (AppConfig.trustZccToolsEnabled) short-circuits the
    // narrow per-tool allow-list to the whole-server wildcard `mcp__zcc-inbox`
    // (claude treats an `mcp__<server>` entry with no `__tool` suffix as "pre-
    // approve all its tools"), so agents are never prompted for ANY zcc tool —
    // including the ones normally withheld behind a first-use prompt
    // (`agent_send`, `remote_exec`, `microvm_exec`, `library_remove`). Covers
    // future tools too, with no list to maintain. Still gated on `mcpConfigPath`
    // (no zcc-inbox server is even wired into the session without it, so allowing
    // it is moot).
    const trustAllZcc = opts.config.trustZccToolsEnabled === true;
    // `inbox_search` is read-only (never mutates the inbox), so it's safe to
    // pre-approve alongside the other read tools — same rationale as `agent_inbox`.
    const inboxAllow = !mcpConfigPath
      ? []
      : trustAllZcc
        ? ['mcp__zcc-inbox']
        : opts.scheduled
          ? [
              'mcp__zcc-inbox__inbox_push',
              'mcp__zcc-inbox__inbox_ask',
              'mcp__zcc-inbox__inbox_search',
              'mcp__zcc-inbox__schedule_report',
              ...meshAllow,
              ...agentDataAllow,
              ...remoteExecAllow,
              ...microvmExecAllow
            ]
          : [
              'mcp__zcc-inbox__inbox_push',
              'mcp__zcc-inbox__inbox_ask',
              'mcp__zcc-inbox__inbox_search',
              ...meshAllow,
              ...agentDataAllow,
              ...remoteExecAllow,
              ...microvmExecAllow
            ];
    // Per-tab Claude session id. Forcing `--session-id <uuid>` at first launch
    // gives each claude tab a *stable, distinct* transcript id, so restore can
    // resume that exact conversation (`--resume <id>`) rather than the blunt
    // `--continue`, which only reopens the single most-recent conversation in
    // the cwd — collapsing every tab onto one. We mint it ONLY when we own the
    // id: skip when the caller already pins a session (resume-picker / restore
    // tabs carry `--resume`/`--continue`/`--session-id` in extraArgs, and the
    // `claude-resume` profile carries `--resume` in its base args), since adding
    // a second `--session-id` would conflict.
    const cleanedExtra = preCleanedExtra;
    const callerPinsSession =
      provider.baseArgsPinSession(effectiveProfile) ||
      cleanedExtra.some(
        (a) =>
          a === '--resume' ||
          a === '-r' ||
          a === '--continue' ||
          a === '-c' ||
          a === '--session-id' ||
          a.startsWith('--resume=') ||
          a.startsWith('--continue=') ||
          a.startsWith('--session-id=')
      );
    // When WE mint the id, remember it so restore can `--resume` this exact
    // conversation. When the CALLER pins one (restore re-launches carry
    // `--resume <uuid>`), surface that same uuid as the session's
    // claudeSessionId so the resume chain survives repeated relaunches — else
    // the second restore would lose the id and fall back to blunt `--continue`.
    const minted =
      caps.acceptsSessionId && !callerPinsSession ? randomUUID() : undefined;
    const claudeSessionId = minted ?? extractPinnedSessionId(cleanedExtra);
    const sessionIdArgs = minted ? ['--session-id', minted] : [];
    // Invariant: an empty / whitespace-only opening prompt must NEVER reach
    // argv as a positional. `claude ''` is a stray empty first-turn that the
    // CLI may misinterpret; callers (LaunchPanel, GUS, scheduler) mostly guard
    // this, but we enforce it once at the choke point so no current or future
    // caller can leak a dangling positional. See cleanExtraArgs.
    // Autonomous-run argv layer, applied only for `autonomous` spawns (normal
    // agents are untouched). The permission lever depends on the effective base
    // profile:
    //  1a. `claude-yolo` base (the "yolo" squad launch) already carries
    //      `--dangerously-skip-permissions` from resolveLaunch — full bypass, no
    //      per-tool prompts at all (raw Bash included). We must NOT also emit
    //      `--permission-mode`: the CLI rejects combining it with skip-permissions,
    //      and skip-permissions is strictly broader anyway. NOTE: an enterprise
    //      `managed-settings.json: disableBypassPermissionsMode` policy, if present
    //      on this fleet, makes claude ignore the flag and silently fall back to
    //      prompting — chosen deliberately by the operator who selects the yolo
    //      base for a squad.
    //  1b. non-yolo base → `--permission-mode acceptEdits`, the autonomy lever a
    //      managed policy PERMITS: auto-accepts file edits + MCP tools with no
    //      prompt; only raw Bash still prompts. Placed AFTER personaArgs/psArgs so
    //      it wins over any persona/project permissionMode (claude CLI: last
    //      --permission-mode occurrence wins).
    //  2. `--disallowedTools AskUserQuestion` (both bases) — that built-in tool
    //     pops an interactive prompt and waits for the user; neither acceptEdits
    //     nor skip-permissions suppresses it (it's a question, not a permission).
    //     An unattended agent must decide, not ask, so we remove the tool entirely.
    // The orchestrator prompt also instructs them to decide autonomously.
    const autonomousPermissionArgs =
      effectiveProfile === 'claude-yolo' ? [] : ['--permission-mode', 'acceptEdits'];
    const autonomousArgs = opts.autonomous
      ? [...autonomousPermissionArgs, '--disallowedTools', 'AskUserQuestion']
      : [];
    // Precedence order (lowest → highest):
    //   base profile args → AppConfig globals (already in `args`)
    //   → claudeMcpArgs → providerMcpArgs → providerGuidanceArgs → providerHookArgs
    //   → projectSettings → PERSONA → autonomousArgs → hookArgs → extraArgs
    // providerMcpArgs + providerGuidanceArgs + providerHookArgs sit with the MCP/
    // guidance/hook layer (right after claudeMcpArgs); they're non-empty only for a
    // provider whose CLI carries those as args (codex), and empty for claude (which
    // uses the file path + --append-system-prompt + --settings above) — so at most
    // one delivery path is ever active. `hookArgs` (near the end) is claude's
    // `--settings` block, distinct from codex's `providerHookArgs`. autonomousArgs
    // sits right before hookArgs so its `--permission-mode acceptEdits` wins over
    // any persona/project permissionMode (claude CLI: last occurrence wins).
    // --disallowedTools can come from persona.deniedTools, projectSettings.deniedTools,
    // autonomousArgs' `AskUserQuestion` suppression, AND per-tab extraArgs — fold
    // every occurrence into one union (same rationale as mergeAllowedTools above;
    // no external `extras`, since all the sources are already inline in this argv).
    const fullArgs = mergeDisallowedTools(
      mergeAllowedTools(
        [
          ...args,
          ...(!modelTarget.structuredSelected ? (modelTarget.contribution.args ?? []) : []),
          ...sessionIdArgs,
          ...claudeMcpArgs,
          ...providerMcpArgs,
          ...providerGuidanceArgs,
          ...providerHookArgs,
          ...providerAuthArgs,
          ...psArgs,
          ...personaArgs,
          ...(modelTarget.structuredSelected ? (modelTarget.contribution.args ?? []) : []),
          ...(roleTarget.contribution.args ?? []),
          ...(execution.contribution.args ?? []),
          ...autonomousArgs,
          ...hookArgs,
          ...cleanedExtra
        ],
        inboxAllow
      ),
      []
    );
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      TERM: 'xterm-256color',
      // Server-bound control-plane identity. The id alone is advisory; this MAC
      // proves main minted the identity for this exact session. It cannot mint a
      // sibling/orchestrator credential because main keeps the boot secret.
      ZCC_SESSION_ID: sessionId,
      ZCC_SESSION_TOKEN: sessionCredential
    };
    // Drop Claude Code's own nested-session markers before they reach a claude
    // WE spawn. When ZCC itself runs inside a Claude session (e.g. `npm run dev`
    // from a Claude shell), `...process.env` above carries CLAUDECODE /
    // CLAUDE_CODE_SESSION_ID / … into the child, which then behaves as a NESTED
    // child session and writes no interactive transcript — silently breaking
    // every transcript-derived feature (Slack answer-relay, idle-triage, close
    // summaries). A Finder-launched app has a clean env, so this only bites in
    // dev, but sanitizing at the source removes the footgun for good. See
    // stripInheritedClaudeSession.
    stripInheritedClaudeSession(env);
    // Per-harness auth env override: merge AFTER stripInheritedClaudeSession (it
    // touches only CLAUDE* session markers, never our auth vars) and AFTER the
    // ambient `...process.env` copy, so a stored gateway/token deliberately WINS
    // over any ambient value for that family (the operator asked for this
    // endpoint). Empty when nothing is stored, so the ambient env is untouched.
    if (providerAuth.env) {
      Object.assign(env, providerAuth.env);
    }
    // Per-harness MCP-via-env override (OpenCode's `OPENCODE_CONFIG_CONTENT`):
    // merge AFTER the ambient env copy so the launcher-owned zcc-inbox config wins,
    // and after the auth env (disjoint keys). Empty `{}` for every other provider,
    // so a claude/codex/cursor/pi/shell launch is byte-identical. This is the
    // env-var twin of the claude `ZCC_MCP_URL` set below (which claude
    // env-substitutes into its `--mcp-config` file) — OpenCode instead reads the
    // whole zcc-inbox server block from this var, deep-merged over its own config.
    Object.assign(env, providerMcpEnv);
    // Per-session V8 heap ceiling: bound a runaway claude (and its subagent
    // node subtree, which inherits NODE_OPTIONS) so it aborts its own turn at
    // the ceiling instead of growing until the OS memory-pressure killer takes
    // the whole app down. Claude-family only — a plain shell has no node heap to
    // bound, and forcing the flag on every `node` it runs would be surprising.
    applyHeapCeiling(env, caps.injectsClaudeMcpConfig, opts.config);
    if (caps.injectsClaudeMcpConfig) {
      // Pre-trust the workspace so a claude WE spawn never blocks on the
      // interactive "Do you trust the files in this folder?" dialog. Every cwd
      // we launch into is a path main already realpath-confined against a
      // registered project (Rule 1/2), so the folder is trusted by
      // construction — the dialog would only ever stall an otherwise-authorized
      // agent (and headless/scheduled runs have no one to answer it). This
      // suppresses ONLY the folder-trust prompt; tool-permission gating
      // (permissionMode / --allowedTools / the Overseer hook) is unaffected.
      // Claude-family only — a plain shell has no such dialog.
      env.CLAUDE_CODE_TRUST_ALL_WORKSPACES = '1';
    }
    if (autoModeActive) {
      // Auto mode is off-by-default on Bedrock / Vertex / Foundry / signed-in
      // Claude-apps-gateway sessions until this is set; it's a harmless no-op on
      // the Anthropic API (where auto mode is available without it). Setting it
      // here — only when we actually launch in auto mode — keeps the flag and the
      // env in lockstep regardless of the operator's ambient shell env.
      env.CLAUDE_CODE_ENABLE_AUTO_MODE = '1';
    }
    if (mcpConfigPath && mcpServerUrl) {
      // Claude env-substitutes `${ZCC_MCP_URL}` into its `--mcp-config` file at
      // spawn. (codex bakes the same URL directly into `providerMcpArgs` instead,
      // so it needs no env var here.)
      env.ZCC_MCP_URL = mcpServerUrl;
    }
    if (wantsStopHook) {
      // The Stop hook command reads this — full URL with identity baked in,
      // so the agent never sees (or could forge) the session id in a schema.
      env.ZCC_HOOK_URL = `${this.mcpBaseUrl}/hook/stop/${opts.projectId}/${sessionId}`;
    }
    if (wantsNotifyHook) {
      // The Notification/UserPromptSubmit hooks POST here. Same identity-in-URL
      // pattern as the stop hook; the path's trailing segment selects the
      // event (`blocked` vs `unblocked`) so one base URL serves both.
      env.ZCC_NOTIFY_URL = `${this.mcpBaseUrl}/hook/notify/${opts.projectId}/${sessionId}`;
    }
    if (wantsFirstPromptHook) {
      // The first-prompt UserPromptSubmit hook POSTs the prompt JSON here so the
      // main process can name the tab. Identity baked into the URL, same as the
      // others — the agent never sees (or could forge) the session id.
      env.ZCC_FIRSTPROMPT_URL = `${this.mcpBaseUrl}/hook/firstprompt/${opts.projectId}/${sessionId}`;
    }
    if (wantsSubagentHook) {
      // The PreToolUse(Task)/SubagentStop hooks POST here. Same identity-in-URL
      // pattern as the notify hook; the trailing path segment selects the event
      // (`start` vs `stop`) so one base URL serves both.
      env.ZCC_SUBAGENT_URL = `${this.mcpBaseUrl}/hook/subagent/${opts.projectId}/${sessionId}`;
    }
    if (wantsOverseerHook) {
      // The synchronous PreToolUse Overseer hook POSTs the tool-call event here
      // and prints our decision. Identity baked into the URL like the others —
      // the server resolves the session's cwd from this id, never trusting the
      // agent-supplied event body for it.
      env.ZCC_OVERSEER_URL = `${this.mcpBaseUrl}/hook/overseer/${opts.projectId}/${sessionId}`;
    }
    if (wantsContentScreenHook) {
      // The synchronous PostToolUse Content Screen hook POSTs the tool-result
      // event here and prints our decision. Identity baked into the URL like
      // the others — the server resolves the session's cwd from this id, never
      // trusting the agent-supplied event body for it.
      env.ZCC_CONTENTSCREEN_URL = `${this.mcpBaseUrl}/hook/contentscreen/${opts.projectId}/${sessionId}`;
    }
    // tmux persistence (opt-in, Phase 2): back the session with a tmux session
    // so it survives an app restart and can be re-attached. We only WRAP the
    // command — node-pty stays the client, so onData/write/resize/coalescing/
    // the live-cap are all unchanged, and env still injects (the tmux pane's
    // child inherits it). Gated on: the scope covering LOCAL sessions ('all' —
    // 'remote' deliberately excludes local, the common case, since the extra
    // tmux server/client buys nothing for a session that never leaves the
    // box), tmux actually present (silently falls back to a plain spawn
    // otherwise — never an error), and NOT a scheduled/unrelated headless run
    // (those are short-lived/auto-closed, so persistence buys nothing and would
    // leak tmux servers). Addressable Team workers are lifecycle-managed and
    // survive for startup reconciliation. `new-session -A -s cc-<id>` attaches
    // if the session exists (restore re-attach) or creates it.
    const useTmux =
      opts.config.tmuxScope === 'all' &&
      !opts.scheduled &&
      (!opts.headless || opts.cohort?.role === 'worker') &&
      isTmuxAvailable();
    // Session-scoped vars must be handed to tmux via `new-session -e` — a tmux
    // pane inherits the SERVER-global env (snapshotted from the first session),
    // not this client's env, so without `-e` the 2nd+ agent would inherit the
    // 1st agent's hook URLs and mis-route its first-prompt / sub-agent hooks
    // (wrong card named, wrong card flipped to Delegating). Host/global env
    // (PATH, HOME, …) still inherits normally; only these per-session ZCC_*
    // vars need the override.
    const sessionEnv: Record<string, string | undefined> = {
      ZCC_MCP_URL: env.ZCC_MCP_URL,
      ZCC_HOOK_URL: env.ZCC_HOOK_URL,
      ZCC_NOTIFY_URL: env.ZCC_NOTIFY_URL,
      ZCC_FIRSTPROMPT_URL: env.ZCC_FIRSTPROMPT_URL,
      ZCC_SUBAGENT_URL: env.ZCC_SUBAGENT_URL,
      ZCC_OVERSEER_URL: env.ZCC_OVERSEER_URL,
      ZCC_CONTENTSCREEN_URL: env.ZCC_CONTENTSCREEN_URL,
      // OpenCode's inline MCP config carries the per-session zcc-inbox URL, so it's
      // session-scoped exactly like the ZCC_*_URL vars: without the `-e` override a
      // 2nd+ tmux-backed OpenCode agent would inherit the 1st's baked-in session URL
      // and mis-route its inbox callbacks. Undefined (omitted) for every non-OpenCode
      // launch. See providerMcpEnv above.
      OPENCODE_CONFIG_CONTENT: env.OPENCODE_CONFIG_CONTENT
    };
    // Execution environment (WHERE it runs) — resolve, then wrap the inner launch
    // and rewrite the per-session callback env. `local` is the identity (both
    // no-ops), so a launch without `environment` is byte-identical to before this
    // seam existed (guarded by the golden-argv net). `sandbox` wraps the agent
    // process under an OS kernel sandbox; because the wrap sits INSIDE the tmux
    // wrap, the tmux server stays trusted infra while the agent subtree is
    // confined. Comms are unchanged for Tier 1 (rewriteCallbackEnv is identity —
    // a sandboxed process shares the host loopback), but the hook is applied here
    // so a future container/VM env (whose loopback ≠ host) plugs in with no caller
    // change.
    const execEnv = environmentFor(opts.environment);
    const envCtx: ExecEnvContext = {
      sessionId,
      projectId: opts.projectId,
      cwd: opts.cwd,
      allowNetwork: !opts.sandboxDenyNetwork,
      // microVM advisory hints (re-authorized in the microVM builder — Rule 1);
      // ignored by local/sandbox.
      microVmImage: opts.microVmImage,
      microVmCpus: opts.microVmCpus,
      microVmMemoryMib: opts.microVmMemoryMib
    };
    const inner = execEnv.wrap({ command, args: fullArgs }, envCtx);
    const isolationStatus = execEnv.status(envCtx);
    // Callback-env rewrite: identity for local/sandbox (a sandboxed process shares
    // the host loopback, so the 127.0.0.1 callbacks resolve unchanged). Invoked
    // here so a future container/VM env — whose loopback ≠ the host's — plugs in
    // with no caller change. NOTE for that future env: `sessionEnv` (the tmux `-e`
    // overrides built above) is captured PRE-rewrite; a non-identity rewrite must
    // rebuild `sessionEnv` from `env` after this Object.assign, or tmux panes would
    // carry the un-rewritten URLs.
    // NOTE for a non-identity rewrite (async/VM env, below): `sessionEnv` (the
    // tmux `-e` overrides) is captured PRE-rewrite, but tmux is disabled for the
    // async path (a guest process has no host PID for tmux to wrap), so the
    // rewritten env only needs to reach the guest via `createSession`. We pass
    // the post-rewrite `sessionEnv` explicitly there.
    const rewrittenCallbackEnv = execEnv.rewriteCallbackEnv(
      Object.fromEntries(
        Object.entries(sessionEnv).filter(([, v]) => v !== undefined) as [string, string][]
      ),
      envCtx
    );
    Object.assign(env, rewrittenCallbackEnv);

    // Session record, shared by both launch paths.
    const session: TerminalSession = {
      id: sessionId,
      projectId: opts.projectId,
      // Title tracks the REQUESTED profile (matching the old titleFor(opts.profile)),
      // not the persona's effective baseProfile.
      title: opts.title ?? providerFor(opts.profile).title(opts.profile),
      profile: opts.profile,
      cwd: opts.cwd,
      // pid is set by the sync spawn below, or by attachExecutionSession once an
      // async backend (microVM/container) has booted its guest process.
      pid: undefined,
      // `starting` for an async handle-owning env (the VM is still booting — the
      // UI shows a "Preparing…" spinner and buffers input); `running` for the
      // sync path, byte-identical to before this branch existed.
      status: execEnv.createSession ? 'starting' : 'running',
      createdAt: Date.now(),
      extraArgs: opts.extraArgs,
      claudeSessionId,
      headless: opts.headless || undefined,
      scheduled: opts.scheduled || undefined,
      inboxLevel: opts.scheduled ? opts.inboxLevel : undefined,
      personaId: opts.persona?.id,
      cohort: opts.cohort,
      worktree: opts.worktree,
      // Record WHERE it runs + whether isolation is actually in force, so the
      // Agents board can badge a sandboxed session and surface an honest posture
      // when the kernel couldn't enforce it (warn-and-run). Omitted for a plain
      // local launch (the common case) to keep the record lean.
      environment: opts.environment && opts.environment !== 'local' ? opts.environment : undefined,
      isolationStatus: isolationStatus.isolated || isolationStatus.reason ? isolationStatus : undefined
    };

    // ASYNC, HANDLE-OWNING ENV (microVM/container) — the backend boot is async
    // and the SDK owns the guest process, so there is no `{command,args}` to
    // hand node-pty. Register the session immediately in `starting` with a
    // deferred handle (buffers `write`s until the guest is up), broadcast it so
    // the tab lights up with a spinner, then boot the backend in the background
    // and swap in the real ExecutionSession when ready (see attachExecutionSession).
    // create() itself STAYS synchronous — no caller pays the boot latency.
    if (execEnv.createSession) {
      const deferred = new DeferredExecSession();
      this.live.set(session.id, { session, proc: deferred });
      this.emit('sessionUpdated', session);
      void this.attachExecutionSession(session, execEnv, inner, envCtx, rewrittenCallbackEnv, opts, caps);
      return session;
    }

    // SYNC ENV (local / sandbox, optionally tmux-wrapped) — byte-identical to
    // before the async branch existed (guarded by the golden-argv net).
    const spawnCmd = useTmux
      ? buildLocalTmuxCommand(sessionId, inner.command, inner.args, sessionEnv)
      : inner;
    const proc = pty.spawn(spawnCmd.command, spawnCmd.args, {
      name: 'xterm-256color',
      cols: opts.cols,
      rows: opts.rows,
      cwd: opts.cwd,
      env
    });
    session.pid = proc.pid;

    this.live.set(session.id, { session, proc, localTmuxBacked: useTmux || undefined });
    // Broadcast every newly-created session so scheduler-spawned tabs (which
    // bypass the renderer's create() return path) still light up the tab strip.
    this.emit('sessionUpdated', session);
    this.wireSessionIo(session, proc, opts, caps);

    return session;
  }

  /**
   * Wire a live process's I/O into the session: output buffering, the optional
   * autonomous-capture tee, persona `initialPrompt` injection, and the exit
   * finalizer. Shared by the sync `pty.spawn` path and the async
   * {@link attachExecutionSession} path so both a real `pty.IPty` and an
   * {@link ExecutionSession} are driven identically. `proc` is the union type;
   * only the surface both share is touched.
   */
  private wireSessionIo(
    session: TerminalSession,
    proc: pty.IPty | ExecutionSession,
    opts: { autonomous?: boolean; persona?: Persona; scheduled?: boolean },
    caps: { injectsClaudeMcpConfig: boolean }
  ): void {
    proc.onData((data) => {
      this.bufferData(session.id, data);
    });
    // TEMP DIAGNOSTIC (gated on ZCC_DEBUG_YOLO_CAPTURE): tee an autonomous
    // session's raw output to a file so we can read the ACTUAL on-screen prompt
    // an agent stalls on. Off unless the env var is set; remove after debugging.
    if (opts.autonomous && process.env.ZCC_DEBUG_YOLO_CAPTURE) {
      try {
        const fs = require('node:fs');
        const dir = process.env.ZCC_DEBUG_YOLO_CAPTURE;
        fs.mkdirSync(dir, { recursive: true });
        const file = `${dir}/${session.id}.log`;
        proc.onData((d: string) => {
          try {
            fs.appendFileSync(file, d);
          } catch {
            /* best-effort */
          }
        });
      } catch {
        /* best-effort */
      }
    }
    // Persona initialPrompt: when a persona declares an opening prompt AND this
    // is an interactive claude-family spawn (not scheduled — the scheduler
    // delivers prompts as positional argv for non-interactive runs), write the
    // prompt to the pty after the first data event (the agent's ready signal).
    // This mirrors how the scheduler fires non-interactive prompts, but as a pty
    // write so interactive sessions can actually run it.
    if (opts.persona?.initialPrompt && caps.injectsClaudeMcpConfig && !opts.scheduled) {
      let promptWritten = false;
      const writePrompt = () => {
        if (promptWritten) return;
        promptWritten = true;
        // Write on next tick so the agent is fully ready. The scheduler-style
        // positional argv would have landed before the agent starts; for
        // interactive we wait for first data (the welcome banner) then inject.
        setTimeout(() => {
          const live = this.live.get(session.id);
          if (live && opts.persona?.initialPrompt) {
            live.proc.write(`${opts.persona.initialPrompt}\r`);
          }
        }, 100);
      };
      proc.onData(writePrompt);
    }
    proc.onExit(({ exitCode }) => {
      // A launcher-initiated close (auto-close Stop hook) reports as a clean
      // exit so the scheduler logs the run as success, not a kill-signal error.
      const expected = this.expectedClose.delete(session.id);
      this.finalizeExit(session.id, expected ? 0 : exitCode);
    });
  }

  /**
   * Boot an async, handle-owning execution environment (microVM/container) and
   * attach its {@link ExecutionSession} as the session's `proc`. Runs in the
   * background off {@link create} so no caller pays the VM-boot / image-pull
   * latency; the session already exists in `starting` with a
   * {@link DeferredExecSession} buffering any input the user/reply sends.
   *
   * On success: swap the real handle in, flush buffered input, wire I/O, stamp
   * the pid, flip to `running`, broadcast. On failure: FAIL-CLOSED — finalize
   * the session with a non-zero exit so the UI surfaces an honest error rather
   * than silently falling back to an unisolated local spawn (design §5).
   */
  private async attachExecutionSession(
    session: TerminalSession,
    execEnv: ReturnType<typeof environmentFor>,
    inner: { command: string; args: string[] },
    envCtx: ExecEnvContext,
    sessionEnv: Record<string, string>,
    opts: { autonomous?: boolean; persona?: Persona; scheduled?: boolean; cols: number; rows: number },
    caps: { injectsClaudeMcpConfig: boolean }
  ): Promise<void> {
    let exec: ExecutionSession;
    try {
      // createSession is present (checked by the caller); assert for the type.
      exec = await execEnv.createSession!(inner, {
        ...envCtx,
        cols: opts.cols,
        rows: opts.rows,
        sessionEnv
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[pty] createSession for ${session.id} failed:`, err);
      const live = this.live.get(session.id);
      // The session may have been closed while the backend was booting.
      if (!live) return;
      // Surface an honest failure line in the terminal, then fail-closed.
      const reason = err instanceof Error ? err.message : String(err);
      this.bufferData(
        session.id,
        `\r\n\x1b[31m[zcc] isolated environment failed to start: ${reason}\x1b[0m\r\n`
      );
      this.finalizeExit(session.id, 1);
      return;
    }
    const live = this.live.get(session.id);
    if (!live) {
      // Closed mid-boot — tear the freshly-booted guest down immediately.
      try {
        exec.kill();
      } catch {
        /* best-effort */
      }
      return;
    }
    // Swap the deferred handle for the real one, then flush any input buffered
    // while the guest was booting (in submit order).
    const deferred = live.proc;
    live.proc = exec;
    live.session.pid = exec.pid;
    live.session.status = 'running';
    if (deferred instanceof DeferredExecSession) deferred.drainInto(exec);
    this.wireSessionIo(session, exec, opts, caps);
    this.emit('sessionUpdated', session);
  }

  /**
   * Shared teardown for a session whose process has ended (or vanished). Flushes
   * the buffered output tail BEFORE the `exit` event — otherwise a burst that
   * landed right as the process exited would be dropped on the floor — then
   * marks the session exited, emits `exit`, and drops it from the live map so
   * its cap slot frees immediately. Idempotent: a no-op once the session is
   * gone, so the onExit callback and {@link reapDeadSessions} can't double-fire.
   */
  private finalizeExit(sessionId: string, exitCode: number): void {
    this.flushData(sessionId);
    this.clearDataBuffer(sessionId);
    const live = this.live.get(sessionId);
    if (!live) return;
    live.session.status = 'exited';
    live.session.exitCode = exitCode;
    this.emit('exit', sessionId, exitCode);
    this.live.delete(sessionId);
    // Release node-pty's master /dev/ptmx fd. On a normal `onExit`, node-pty's
    // own socket-close path already frees it — but reapDeadSessions() finalizes
    // sessions whose `onExit` was LOST (child reaped across sleep/wake), and for
    // those the master fd is still open and would otherwise leak for the life of
    // the process. macOS caps PTYs at kern.tty.ptmx_max (default 511); a slow
    // leak here eventually makes EVERY new pty.spawn throw the misleading
    // "posix_spawnp failed." (node-pty reports a failed posix_openpt() with that
    // same message). destroy() is idempotent + caught, so it's a harmless no-op
    // on the normal path and the load-bearing cleanup on the reap path.
    // `destroy()` lives on the concrete Unix/Windows terminal, not the public
    // `IPty` type — reach for it defensively so a node-pty version without it
    // (or a Windows build) is a no-op rather than a type error.
    const disposable = live.proc as pty.IPty & { destroy?: () => void };
    try {
      disposable.destroy?.();
    } catch {
      /* socket already torn down (normal exit) — nothing to release */
    }
  }

  /**
   * Sweep live sessions for any whose OS process has already exited without
   * node-pty delivering an `onExit`. Observed after the machine sleeps/wakes:
   * the child gets reaped by the OS but the pty's exit event is lost, leaving
   * the session pinned `running` forever — a zombie that holds a live-session
   * slot AND a scheduler concurrency slot indefinitely (the scheduler's overlap
   * and concurrency-cap guards read liveness from here, so enough zombies
   * deadlock every schedule with "previous run still active" / "concurrency-cap"
   * skips). Probes each pid with signal `0` (sends nothing — just an
   * existence + permission check) and finalizes the ones that are gone via the
   * same path as a clean exit. Returns the reaped session ids. Cheap enough to
   * call on demand before a liveness-sensitive decision.
   */
  reapDeadSessions(): string[] {
    const dead: string[] = [];
    for (const [id, live] of this.live) {
      if (live.session.status === 'exited') continue; // already torn down
      const pid = live.session.pid;
      if (pid === undefined) continue; // nothing to probe — leave it alone
      try {
        process.kill(pid, 0);
      } catch (err) {
        // ESRCH: no such process → it's gone, reap it. EPERM: alive but owned
        // by another uid (pid reused) → treat as alive, do NOT reap.
        if ((err as NodeJS.ErrnoException).code === 'ESRCH') dead.push(id);
      }
    }
    // Finalize after the scan so we don't mutate `this.live` mid-iteration.
    // -1 marks an unclean disappearance (vs a real exit code), so the
    // scheduler records the interrupted run as an error rather than success.
    for (const id of dead) this.finalizeExit(id, -1);
    return dead;
  }

  /**
   * Spawn a local `ssh` subprocess that allocates a PTY on the remote host
   * (`-t`) and runs either the user's login shell or a claude CLI session.
   *
   * For claude-family profiles we apply the same global / per-project
   * flag stack as local spawns, but we deliberately skip MCP injection
   * (`--mcp-config`, `ZCC_MCP_URL`, the inbox allowlist) — those point at
   * our local http listener and aren't reachable from the remote without
   * a reverse tunnel. Inbox push is a local-only feature in v1.
   */
  private createRemote(opts: {
    /** Main coordinator-owned identity, allocated before authorization/commit. */
    preallocatedSessionId?: string;
    projectId: string;
    profile: LaunchProfileId;
    cwd: string;
    cols: number;
    rows: number;
    config: AppConfig;
    projectSettings?: ProjectSettings;
    extraArgs?: string[];
    title?: string;
    remote: ProjectRemote;
    persona?: Persona;
    headless?: boolean;
    scheduled?: boolean;
    inboxLevel?: InboxNotifyLevel;
    /** See {@link create}'s `autonomous` — forces acceptEdits + AskUserQuestion deny. */
    autonomous?: boolean;
    cohort?: SessionCohort;
    /**
     * Wake-from-sleep reconnect: the ORIGINAL session id of a remote tab whose
     * local `ssh` proxy died when the machine slept. We name the remote tmux
     * session `cc-<reconnectTmuxId>` so `tmux new -A -s` RE-ATTACHES the live
     * agent that's still running detached on the box (attach-or-create). The NEW
     * local pty always gets a fresh `sessionId` (below) so a late `onExit` from
     * the dead proxy can't finalize this replacement. Ignored unless it's a
     * valid UUID (renderer-supplied → untrusted; it flows into the tmux command
     * string, so a non-UUID could otherwise inject shell metacharacters).
     */
    reconnectTmuxId?: string;
    /**
     * Fold `--continue` into the remote claude argv. Set on reconnect so that if
     * the remote tmux session is GONE (tmux create-fresh branch — box rebooted,
     * or persistence was off), the fresh pane resumes the prior conversation from
     * the on-disk transcript instead of starting cold. No-op for shell profiles.
     */
    resume?: boolean;
  }): TerminalSession {
    const { remote } = opts;
    // Same live-session cap as the local path — a remote ssh pty is still a
    // local subprocess + fd held in this.live, so it counts identically.
    this.assertCapacity(opts.config);
    // Defense in depth: addRemoteProject already rejects leading-dash values,
    // but reject again here so a hand-edited projects.json can't smuggle
    // `-oProxyCommand=...` into ssh's argv as a flag.
    if (remote.host.startsWith('-')) throw new Error(`refusing ssh host starting with '-': ${remote.host}`);
    if (remote.user && remote.user.startsWith('-')) throw new Error(`refusing ssh user starting with '-': ${remote.user}`);
    if (remote.proxyJump && remote.proxyJump.startsWith('-')) {
      throw new Error(`refusing ssh proxyJump starting with '-': ${remote.proxyJump}`);
    }
    const target = remote.user ? `${remote.user}@${remote.host}` : remote.host;
    // Mint a FRESH id for the new local pty. A reconnect keeps the OLD id only
    // for the tmux session NAME (so `new -A -s` re-attaches the still-live
    // agent) — never for the local session id, else a late `onExit` from the
    // dead proxy could finalize (kill) this replacement.
    const sessionId = opts.preallocatedSessionId ?? randomUUID();
    // The tmux session name reuses the reconnect id when it's a valid UUID; an
    // invalid value (renderer-supplied, flows into the tmux command string) is
    // ignored and we fall back to a plain new session under the fresh id.
    const tmuxId =
      opts.reconnectTmuxId && UUID_RE.test(opts.reconnectTmuxId)
        ? opts.reconnectTmuxId
        : sessionId;
    // Whether this spawn is actually wrapped in a persistent tmux session on the
    // box — stamped onto the session below so a wake-reconnect knows the STABLE
    // `cc-<id>` name to re-attach (the pty id is minted fresh each reconnect).
    let wrappedTmuxId: string | undefined;
    // Resolve the provider by the REQUESTED profile (not the persona's
    // baseProfile): the old buildRemoteCmd branched shell-vs-claude on
    // `opts.profile`, and the claude provider re-derives the effective profile
    // from persona.baseProfile internally — preserving that exact behaviour.
    const remoteProvider = providerFor(opts.profile);
    const remoteEffectiveProfile = opts.persona?.baseProfile ?? opts.profile;
    // Per-harness auth (Settings → Harness) is DELIBERATELY local-only: the
    // credential lives in this machine's encrypted `~/.zcc/harness-auth.enc`, and
    // pushing a decrypted token over the ssh command line / env would leak it to
    // the remote box's process table and shell history. A remote agent
    // authenticates with the remote CLI's own login (`~/.claude`, `codex login`,
    // …) on that host — so `create()` injects `authInjection`, `createRemote`
    // does not. If remote auth override is ever wanted, forward it over the same
    // `ssh -R` tunnel as the hooks, never as argv/env.
    // Reverse-tunnel + hook wiring (remote live-status / auto-naming parity).
    // The remote claude's hook commands `curl` a loopback URL; an `ssh -R`
    // reverse forward maps that remote loopback port back to our LOCAL MCP/hook
    // http server (bound to 127.0.0.1:<mcpPort>). Only for interactive claude
    // profiles once the MCP server is up — a shell tab, a scheduled/headless
    // run, or a boot before the server binds all fall through to the historical
    // no-hooks remote spawn. Overseer (synchronous, blocks the agent) and the
    // MCP/inbox server (a larger reachable surface) are deliberately NOT wired
    // over the tunnel in this pass — only the async, fire-and-forget status /
    // auto-naming hooks.
    const wantsRemoteHooks =
      remoteProvider.capabilities(remoteEffectiveProfile).supportsHooks &&
      !!this.mcpBaseUrl &&
      !opts.headless;
    let remoteForward: { remotePort: number; reverse: string } | null = null;
    let hookEnv: Record<string, string> | undefined;
    let hookSettingsJson: string | undefined;
    let remoteHookUrls: ProviderHookUrls | undefined;
    // Opt-in MCP forwarding (`remoteMcpEnabled`): the reverse tunnel already
    // reaches our local MCP/hook http server, so once it's wired we can also
    // point the remote agent's `--mcp-config` at the SAME loopback port to give
    // it the zcc-inbox surface. Set below, inside the tunnel block, only when the
    // flag is on. Overseer stays excluded regardless.
    let remoteMcpUrl: string | undefined;
    if (wantsRemoteHooks) {
      const localPort = this.localMcpPort();
      if (localPort !== null) {
        // Deterministic per-session remote loopback port so a reconnect reuses
        // the SAME `-R` forward, and concurrent agents on one host don't collide
        // (session ids are unique → distinct ports). Confined to a high
        // ephemeral band. A stale forward from a crashed agent that reused the
        // same port is harmless: sshd rejects the duplicate bind and the hook
        // curl just fails closed (exit 0), never blocking the agent.
        const remotePort = remotePortForSession(sessionId);
        remoteForward = { remotePort, reverse: `${remotePort}:127.0.0.1:${localPort}` };
        const base = `http://127.0.0.1:${remotePort}`;
        // Same identity-in-URL contract as the local path: the session id is
        // baked into the URL so the server resolves it, and the agent can never
        // forge it. Only the async hooks (no MCP, no Overseer).
        //
        // ONE per-event URL set drives BOTH remote wirings from the same gates:
        //  - claude consumes `hookEnv` + the `--settings` JSON (below), and
        //  - a `-c`-hooks provider (codex) consumes `remoteHookUrls` in
        //    `buildRemoteCommand` → `hookArgs`.
        // So codex remote reaches the identical `/hook/*` routes as claude remote.
        // Stop/first-prompt only where they earn their keep (mirror local): a
        // scheduled run wants the turn-END stop hook but no first-prompt (its
        // opening prompt rides argv, never firing UserPromptSubmit); interactive
        // is the reverse.
        remoteHookUrls = {
          notify: `${base}/hook/notify/${opts.projectId}/${sessionId}`,
          subagent: `${base}/hook/subagent/${opts.projectId}/${sessionId}`,
          ...(opts.scheduled
            ? { stop: `${base}/hook/stop/${opts.projectId}/${sessionId}` }
            : { firstPrompt: `${base}/hook/firstprompt/${opts.projectId}/${sessionId}` })
        };
        // Claude's env-based twin of the same URLs (keys are the claude contract).
        hookEnv = {
          ZCC_NOTIFY_URL: remoteHookUrls.notify!,
          ZCC_SUBAGENT_URL: remoteHookUrls.subagent!
        };
        if (opts.scheduled) {
          hookEnv.ZCC_HOOK_URL = remoteHookUrls.stop!;
        } else {
          hookEnv.ZCC_FIRSTPROMPT_URL = remoteHookUrls.firstPrompt!;
        }
        hookSettingsJson = buildHookSettings({
          stop: !!opts.scheduled,
          notify: true,
          firstPrompt: !opts.scheduled,
          subagents: true
        });
        // MCP over the same reverse tunnel (opt-in). Same identity-in-URL
        // contract as the local `mcpServerUrl` and the hook URLs above: the
        // project + session ids are baked into the path so the server resolves
        // the route and the agent can't forge it. The provider embeds this URL
        // inline in `--mcp-config` (no remote file). Gated behind the config
        // flag; absent ⇒ the historical MCP-cut-off remote agent.
        if (opts.config.remoteMcpEnabled) {
          remoteMcpUrl = `${base}/mcp/${opts.projectId}/${sessionId}/${controlCredentialForSession(sessionId)}`;
        }
      }
    }
    // Mint + inject a stable `--session-id` (remote twin of the local path) so a
    // remote claude conversation is resumable via `--resume <id>`. `randomUUID`
    // is passed as a thunk — the provider calls it only when it decides to own
    // the id (interactive claude family, no caller-pinned resume). The recovered
    // id is stamped onto the session below, closing the parity gap that left
    // remote `claudeSessionId` permanently undefined.
    const { cmd: builtCmd, claudeSessionId: remoteClaudeSessionId } = remoteProvider.buildRemoteCommand({
      ...opts,
      hookEnv,
      hookSettingsJson,
      remoteHookUrls,
      remoteMcpUrl,
      scheduled: opts.scheduled,
      mintClaudeSessionId: randomUUID
    });
    let remoteCmd = builtCmd;
    // tmux persistence on the REMOTE (opt-in, Phase 2): this is the strongest
    // use case — survive a flaky `ssh -t` link by re-attaching the live remote
    // session. Gated on the scope covering REMOTE sessions ('remote' or 'all')
    // + non-scheduled/headless. We can't probe the remote's PATH from here, so
    // we rely on `tmux` being on the remote PATH; a missing remote tmux
    // surfaces as a normal command error in the terminal (no worse than any
    // other missing remote binary). The wrap goes OUTSIDE the cd/exec the
    // remote cmd already builds, so the whole login command runs inside tmux.
    //
    // On a WAKE RECONNECT we force this wrap on even if tmuxScope has since
    // been narrowed to 'off': the original spawn (when the box's `cc-<id>`
    // session was created) required a remote-covering scope to be active, so
    // the only way the agent is still alive to re-attach is via tmux. Skipping
    // the wrap here would spawn a bare second agent instead of re-attaching
    // the live one.
    //
    // `tmuxBacked` also gates upstream's auto-reconnect recipe below: only a
    // tmux-backed remote can be transparently re-attached after a dropped link
    // (the remote agent keeps running in its detached tmux session). A
    // wake-reconnect spawn is tmux-backed by construction, so folding
    // `reconnectTmuxId` in here arms auto-reconnect for it too.
    const tmuxBacked =
      ((opts.config.tmuxScope === 'remote' || opts.config.tmuxScope === 'all') ||
        !!opts.reconnectTmuxId) &&
      !opts.scheduled &&
      !opts.headless;
    if (tmuxBacked) {
      // Pass the whole compound login command (`cd … && exec …`) to tmux as a
      // SINGLE shell-quoted token so tmux runs it via `sh -c` (honoring the
      // `&&`) inside the persistent pane, rather than exec'ing a bare argv.
      remoteCmd = wrapRemoteTmux(tmuxId, shellQuote(remoteCmd));
      wrappedTmuxId = tmuxId;
    }
    // SSH keepalives so an idle link isn't silently reaped by a NAT/proxy hop
    // (the common "agent died after X minutes of no traffic" cause). ssh sends
    // a probe every 30s and gives up after 4 unanswered (~2 min) — at which
    // point the pty exits and, for a tmux-backed session, our onExit
    // auto-reconnects. We add ONLY keepalive opts here, never touching
    // auth/host resolution, so interactive auth is unchanged.
    const keepaliveOpts = [
      '-o', 'ServerAliveInterval=30',
      '-o', 'ServerAliveCountMax=4',
      '-o', 'TCPKeepAlive=yes'
    ];
    // Bastion / jump host (`ProjectRemote.proxyJump`): `-J <spec>` so the whole
    // connection — INCLUDING the `-R` reverse tunnel below — traverses the hop
    // and the forward terminates on the FINAL host. Without expressing the jump
    // to the local ssh, a bastion setup silently breaks remote hooks/MCP. Flag-
    // shaped values were rejected above. Kept in `probeOpts` too so the cheap
    // reattach liveness check reaches the box through the same hop.
    const jumpOpts = remote.proxyJump ? ['-J', remote.proxyJump] : [];
    // Reverse-tunnel forward for remote hooks (`remoteForward`, wired above) is
    // folded in here so it rides on the SAME argv the reattach recipe captures —
    // a reconnect re-establishes the `-R` forward for free. Guarded so a
    // hooks-off spawn adds nothing.
    const forwardOpts = remoteForward ? ['-R', remoteForward.reverse] : [];
    const sshArgs = [...keepaliveOpts, ...jumpOpts, ...forwardOpts, '-t', target, remoteCmd];
    const spawnEnv: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ZCC_SESSION_ID: sessionId,
      ZCC_SESSION_TOKEN: controlCredentialForSession(sessionId),
      TERM: 'xterm-256color'
    };

    const proc = pty.spawn('ssh', sshArgs, {
      name: 'xterm-256color',
      cols: opts.cols,
      rows: opts.rows,
      cwd: process.env.HOME ?? '/',
      env: spawnEnv
    });

    const session: TerminalSession = {
      id: sessionId,
      projectId: opts.projectId,
      title: opts.title ?? `${remoteProvider.title(opts.profile)} · ${remote.host}`,
      profile: opts.profile,
      cwd: opts.cwd,
      pid: proc.pid,
      status: 'running',
      createdAt: Date.now(),
      extraArgs: opts.extraArgs,
      claudeSessionId: remoteClaudeSessionId,
      headless: opts.headless || undefined,
      scheduled: opts.scheduled || undefined,
      inboxLevel: opts.scheduled ? opts.inboxLevel : undefined,
      personaId: opts.persona?.id,
      cohort: opts.cohort,
      remoteTmuxId: wrappedTmuxId,
      // Honest reverse-tunnel posture. Optimistic-until-proven-failed: if we wired
      // an `-R` forward, assume it bound (the common case) and let the ssh output
      // stream downgrade it if the remote bind fails (see `bindRemoteProc`). Absent
      // when no tunnel was requested (plain remote shell / scheduled / headless).
      remoteTunnel: remoteForward ? { ok: true } : undefined
    };

    // Arm auto-reconnect only for tmux-backed remotes: the remote agent lives
    // in a detached tmux session that outlives the ssh link, so re-running the
    // SAME `new -A -s cc-<id>` argv re-attaches the running conversation. A
    // non-tmux remote can't be re-attached (its child dies with the link), so
    // we leave `reattach` undefined and it finalizes as exited like today.
    const reattach: RemoteReattach | undefined = tmuxBacked
      ? {
          sshArgs,
          cols: opts.cols,
          rows: opts.rows,
          spawnEnv,
          attempts: 0,
          // Probe inputs: the keepalive opts (NOT the `-t`, which is
          // interactive-only) PLUS the jump opts (so the probe reaches the box
          // through the same bastion hop as the spawn), plus the target and tmux
          // session name, so the liveness check is a cheap non-tty
          // `ssh <opts> [-J jump] <target> tmux has-session`.
          target,
          // Probe the id we ACTUALLY wrapped (`tmuxId`), not the fresh
          // `sessionId`: on a wake-reconnect these differ (`tmuxId` is the
          // reused `reconnectTmuxId`), and the sshArgs re-attach `cc-<tmuxId>`.
          // For a normal spawn `tmuxId === sessionId`, so this is a no-op there.
          tmuxName: tmuxSessionName(tmuxId),
          probeOpts: [...keepaliveOpts, ...jumpOpts]
        }
      : undefined;
    this.bindRemoteProc(session, proc, reattach);
    this.emit('sessionUpdated', session);

    return session;
  }

  /**
   * Wire a remote ssh pty's data/exit handlers and register it live. Factored
   * out of {@link createRemote} so a reconnect can rebind a FRESH `proc` onto
   * the SAME session id (and its accumulated buffers/backlog) without going
   * through the full spawn/cap/env path again.
   */
  private bindRemoteProc(session: TerminalSession, proc: pty.IPty, reattach?: RemoteReattach): void {
    this.live.set(session.id, { session, proc, reattach });
    proc.onData((data) => {
      // Any streamed byte proves the (re-)attached link is stable — reset the
      // reconnect budget so a long, occasionally-flaky session isn't starved.
      const live = this.live.get(session.id);
      if (live?.reattach) live.reattach.attempts = 0;
      // Honest tunnel posture: if a reverse forward was requested and still reads
      // as ok, watch the ssh output for OpenSSH's "remote port forwarding failed"
      // warning and downgrade the session so the UI stops implying the remote
      // agent can reach back. Checked only while still ok (cheap: one regex until
      // it either fails or the session ends still-ok).
      if (live && session.remoteTunnel?.ok) {
        const failedPort = detectRemoteForwardFailure(data);
        if (failedPort !== null) {
          session.remoteTunnel = {
            ok: false,
            reason: `ssh could not bind remote port ${failedPort} — hooks and forwarded MCP won't reach this app (port in use, or AllowTcpForwarding/GatewayPorts disallow it on the remote)`
          };
          this.emit('sessionUpdated', session);
        }
      }
      this.bufferData(session.id, data);
    });
    proc.onExit(({ exitCode }) => {
      const expected = this.expectedClose.delete(session.id);
      const live = this.live.get(session.id);
      if (live?.remoteTerminationInFlight) {
        // tmux teardown can close this SSH proxy before terminateSession calls
        // closeExpected(). Keep the close request as teardown owner, not reconnect.
        live.session.pid = undefined;
        return;
      }
      if (!expected && this.tryReattachRemote(session.id)) return; // reconnecting
      this.finalizeExit(session.id, expected ? 0 : exitCode);
    });
  }

  /**
   * A tmux-backed remote pty exited unexpectedly (dropped link). If there's
   * reconnect budget left, schedule a re-attach of the still-live remote tmux
   * session with exponential backoff and return true (caller must NOT finalize
   * — the session stays live). Returns false when the session isn't
   * reconnectable or the budget is exhausted, so the caller finalizes it exited.
   */
  private tryReattachRemote(sessionId: string): boolean {
    const live = this.live.get(sessionId);
    if (!live?.reattach) return false;
    const r = live.reattach;
    if (r.attempts >= REMOTE_REATTACH_MAX_ATTEMPTS) return false;
    r.attempts += 1;
    // Backoff: 1s, 2s, 4s… capped. `attempts` was just incremented, so the
    // first retry (attempts=1) waits the base delay.
    const delay = Math.min(
      REMOTE_REATTACH_BASE_DELAY_MS * 2 ** (r.attempts - 1),
      REMOTE_REATTACH_MAX_DELAY_MS
    );
    // Keep the tab visible as reconnecting rather than dead. We reuse the
    // 'starting' status (a transient, non-terminal state the UI already knows)
    // so no new enum value is needed downstream.
    live.session.status = 'starting';
    live.session.pid = undefined;
    this.emit('sessionUpdated', live.session);
    r.timer = setTimeout(() => {
      // Re-resolve: a manual close during the delay drops the entry.
      const cur = this.live.get(sessionId);
      if (!cur?.reattach || cur.remoteTerminationInFlight) return;
      // Liveness probe BEFORE relaunching: `new -A -s` is attach-OR-CREATE, so
      // if the remote agent already finished (its tmux session is gone) a blind
      // reconnect would silently spawn a FRESH conversation — a zombie reconnect.
      // Probe first; only reattach when the session still exists (or when we
      // can't tell — fail-safe toward reconnect so a flaky link still recovers).
      void this.probeRemoteSession(cur.reattach).then((liveness) => {
        // Re-resolve again: the async probe took a round-trip.
        const live2 = this.live.get(sessionId);
        if (!live2?.reattach || live2.remoteTerminationInFlight) return; // closed during the probe
        if (liveness === 'gone') {
          // The remote agent genuinely ended — finalize instead of relaunching.
          this.disarmReattach(live2);
          this.finalizeExit(sessionId, 0);
          return;
        }
        let proc: pty.IPty;
        try {
          proc = pty.spawn('ssh', live2.reattach.sshArgs, {
            name: 'xterm-256color',
            cols: live2.reattach.cols,
            rows: live2.reattach.rows,
            cwd: process.env.HOME ?? '/',
            env: live2.reattach.spawnEnv
          });
        } catch {
          // Spawn itself failed — treat as another failed attempt; retry or give
          // up per the same budget by recursing through the exit path.
          if (!this.tryReattachRemote(sessionId)) this.finalizeExit(sessionId, -1);
          return;
        }
        live2.session.status = 'running';
        live2.session.pid = proc.pid;
        // A reattach re-establishes the `-R` forward from scratch, so reset a
        // previously-failed tunnel posture back to optimistic — the fresh proc's
        // output stream will re-downgrade it if the bind fails again. Only when a
        // tunnel was in play (leave an absent posture absent).
        if (live2.session.remoteTunnel) live2.session.remoteTunnel = { ok: true };
        this.bindRemoteProc(live2.session, proc, live2.reattach);
        this.emit('sessionUpdated', live2.session);
      });
    }, delay);
    return true;
  }

  /**
   * Out-of-band remote liveness probe: `ssh <keepaliveOpts> <target> tmux
   * has-session -t <name>` (non-tty, no `-t`). Distinguishes a dropped link
   * (tmux session still alive → reattach) from a remote agent that genuinely
   * ended (ssh connects, tmux reports no session → finalize). Never throws;
   * resolves to `unknown` on any ssh failure/timeout so an undecidable case
   * fails safe toward reconnect. See {@link RemoteLiveness}.
   */
  private probeRemoteSession(r: RemoteReattach): Promise<RemoteLiveness> {
    // Reject a target that could be read as an ssh flag — mirrors createRemote's
    // leading-dash guard, since we build a fresh argv here.
    if (r.target.startsWith('-')) return Promise.resolve('unknown');
    const args = [
      ...r.probeOpts,
      '-o', 'BatchMode=yes', // never block on an auth prompt in a background probe
      r.target,
      'tmux', 'has-session', '-t', r.tmuxName
    ];
    return new Promise<RemoteLiveness>((resolve) => {
      execFile('ssh', args, { timeout: REMOTE_PROBE_TIMEOUT_MS }, (err) => {
        if (!err) return resolve('alive'); // exit 0 → session exists
        // ssh's own failures (connect refused/timeout, auth) exit 255; a killed
        // (timed-out) probe has err.killed. Both are "can't tell" → transient.
        const e = err as { code?: number | string; killed?: boolean };
        if (e.killed || e.code === 255 || e.code === 'ETIMEDOUT') {
          return resolve('unknown');
        }
        // ssh connected and ran tmux, which exited non-zero (1) → no such
        // session ⇒ the remote agent ended.
        return resolve('gone');
      });
    });
  }

  /** Cancel a pending reconnect timer and clear the reattach recipe. */
  private disarmReattach(l: Live): void {
    if (!l.reattach) return;
    if (l.reattach.timer) clearTimeout(l.reattach.timer);
    l.reattach = undefined;
  }

  write(id: string, data: string) {
    const live = this.live.get(id);
    if (!live) return;
    // Stamp the human-activity clock. This method backs ONLY the
    // `terminals.write` IPC (renderer keystrokes); agent-injected input goes
    // through `reply()`, which writes to `proc` directly and never lands here —
    // so this timestamp stays a true "a person was typing" signal that
    // AutoCloseIdleService uses to spare an actively-used tab.
    live.session.lastInputAt = Date.now();
    live.proc.write(data);
  }

  /**
   * Send a line of input to a session — the text, then a carriage return, as
   * if the user typed it and hit Enter. Backs `terminals.reply`, used by the
   * inbox to answer a question an agent pushed via `inbox_push` without
   * leaving the inbox. Returns false when no live pty matches (e.g. the
   * session exited), so callers can surface a "session ended" message.
   *
   * The CR is sent as a SEPARATE, deferred write rather than appended to the
   * body. Claude Code's TUI watches for input that arrives as one fast burst
   * and treats it as a paste — buffering the whole chunk (trailing CR
   * included) as literal text instead of submitting. That's why an inbox
   * reply would land in the prompt box but never run. Writing the CR on its
   * own, a tick later, makes the TUI register it as a discrete Enter keypress.
   */
  reply(id: string, text: string): boolean {
    const live = this.live.get(id);
    if (!live) return false;
    // Mid-reconnect gap: when a tmux-backed remote drops, the old proc may be
    // dead while the detached agent still runs in tmux. In this window
    // (`reattach` armed, no live pid yet), send input via out-of-band
    // `tmux send-keys` over one-shot ssh so inbox replies still reach the agent.
    if (live.reattach && !live.session.pid) {
      this.sendKeysRemote(live.reattach, text);
      return true;
    }
    live.proc.write(text);
    setTimeout(() => {
      // Re-resolve: the session may have exited during the delay.
      this.live.get(id)?.proc.write('\r');
    }, 50);
    return true;
  }

  /**
   * Best-effort out-of-band delivery to a detached remote tmux session.
   * Sends body literally (`-l`) and only then a discrete Enter keypress.
   */
  private sendKeysRemote(r: RemoteReattach, text: string): void {
    if (r.target.startsWith('-')) return;
    const send = (keys: string, literal: boolean, then?: () => void) => {
      const remoteCmd =
        `tmux send-keys -t ${shellQuote(r.tmuxName)}` +
        (literal ? ' -l' : '') +
        ` ${shellQuote(keys)}`;
      const args = [...r.probeOpts, '-o', 'BatchMode=yes', r.target, remoteCmd];
      execFile('ssh', args, { timeout: REMOTE_PROBE_TIMEOUT_MS }, (err) => {
        if (!err) then?.();
      });
    };
    send(text, true, () => send('Enter', false));
  }

  resize(id: string, cols: number, rows: number) {
    const l = this.live.get(id);
    if (!l) return;
    try {
      l.proc.resize(cols, rows);
    } catch {
      /* pty may have exited */
    }
  }

  /** Kill the persistent remote tmux process before closing its local SSH proxy. */
  killRemoteTmux(id: string): Promise<boolean> {
    const live = this.live.get(id);
    const reattach = live?.reattach;
    if (!reattach || reattach.target.startsWith('-')) return Promise.resolve(false);
    live.remoteTerminationInFlight = true;
    // Keep recipe for recovery if teardown fails, but cancel any pending attach:
    // `tmux new -A` would otherwise recreate the session we are closing.
    if (reattach.timer) {
      clearTimeout(reattach.timer);
      reattach.timer = undefined;
    }
    const args = [
      ...reattach.probeOpts,
      '-o', 'BatchMode=yes',
      reattach.target,
      'tmux', 'kill-session', '-t', reattach.tmuxName
    ];
    return new Promise((resolve) => {
      execFile('ssh', args, { timeout: REMOTE_PROBE_TIMEOUT_MS }, (error) => {
        if (!error) {
          const current = this.live.get(id);
          if (current) current.remoteTerminationInFlight = false;
          return resolve(true);
        }
        // Agent may exit between close click and kill request. `kill-session`
        // then exits 1 although there is nothing left to terminate.
        if (remoteCommandExitCode(error) !== 1) {
          this.finishRemoteTerminationFailure(id);
          return resolve(false);
        }
        const probeArgs = [
          ...reattach.probeOpts,
          '-o', 'BatchMode=yes',
          reattach.target,
          'tmux', 'has-session', '-t', reattach.tmuxName
        ];
        execFile('ssh', probeArgs, { timeout: REMOTE_PROBE_TIMEOUT_MS }, (probeError) => {
          if (remoteCommandExitCode(probeError) === 1) {
            const current = this.live.get(id);
            if (current) current.remoteTerminationInFlight = false;
            resolve(true);
            return;
          }
          this.finishRemoteTerminationFailure(id);
          resolve(false);
        });
      });
    });
  }

  private finishRemoteTerminationFailure(sessionId: string): void {
    const live = this.live.get(sessionId);
    if (!live) return;
    live.remoteTerminationInFlight = false;
    if (!live.session.pid && !this.tryReattachRemote(sessionId)) {
      this.finalizeExit(sessionId, -1);
    }
  }

  close(id: string) {
    const l = this.live.get(id);
    if (!l) return;
    // A user/host close must win over a pending remote reconnect: disarm the
    // reattach recipe (and any scheduled timer) BEFORE killing, so the pty's
    // onExit finalizes the session instead of scheduling another re-attach.
    this.disarmReattach(l);
    try {
      l.proc.kill();
    } catch {
      /* ignore */
    }
    // If the kill lands during a reconnect backoff there's no live proc to fire
    // onExit, so finalize here — disarmReattach already ensured we won't loop.
    if (!l.session.pid) this.finalizeExit(id, 0);
  }

  /**
   * Close a session the launcher itself decided to end (the auto-close Stop
   * hook fired). Marks the exit as expected so `onExit` reports code 0 — a
   * scheduled run that finished cleanly shouldn't log as an error just
   * because `proc.kill()` delivers a signal. Returns false if already gone.
   */
  closeExpected(id: string): boolean {
    const l = this.live.get(id);
    if (!l) return false;
    this.expectedClose.add(id);
    this.disarmReattach(l);
    try {
      l.proc.kill();
    } catch {
      /* already dead — the onExit (if any) will still clear the flag */
    }
    if (!l.session.pid) this.finalizeExit(id, 0);
    return true;
  }

  killAll(opts?: { preserveLocalTmux?: boolean }) {
    for (const [id, live] of this.live) {
      if (opts?.preserveLocalTmux && live.localTmuxBacked) continue;
      this.close(id);
    }
  }

  /**
   * Toggle the headless flag on a live session. Headless tabs stay visible
   * to `list()` but the renderer hides them from the tab strip — used when
   * the user detaches a tab to the background ("Send to background"; the pty
   * keeps running). Returns the updated session, or null if missing.
   */
  setHeadless(id: string, headless: boolean): TerminalSession | null {
    const live = this.live.get(id);
    if (!live) return null;
    if (live.session.headless === headless) return live.session;
    live.session.headless = headless || undefined;
    this.emit('sessionUpdated', live.session);
    return live.session;
  }

  /**
   * Toggle the per-agent Heartbeat opt-in on a live session (the idle-nudge
   * feature; see {@link HeartbeatService}). Mirrors {@link setHeadless}: stores
   * the flag on the session and emits `sessionUpdated` so the renderer reflects
   * it without a separate channel. Returns the updated session, or null if
   * missing. Background agents (scheduled/headless) shouldn't be enabled — the
   * UI hides the toggle for them and the service re-checks before nudging.
   */
  setHeartbeat(id: string, on: boolean): TerminalSession | null {
    const live = this.live.get(id);
    if (!live) return null;
    if ((live.session.heartbeat ?? false) === on) return live.session;
    live.session.heartbeat = on || undefined;
    this.emit('sessionUpdated', live.session);
    return live.session;
  }

  /**
   * Stamp a DETECTED Codex rollout session id onto a live session. Codex mints
   * its own UUID (unlike claude's forced `--session-id`), so it's resolved after
   * spawn on the first transcript read (see `CodexSessionResolver`) and reported
   * here so the record carries it — restore then does `codex resume <id>` to
   * reopen THIS conversation. Idempotent + main-authoritative: the id comes from
   * main's own rollout scan, never renderer/agent free-text (Rule 1). Emits
   * `sessionUpdated` so the renderer snapshot picks it up. No-op if unknown or
   * already set.
   */
  setCodexSessionId(id: string, codexSessionId: string): TerminalSession | null {
    const live = this.live.get(id);
    if (!live) return null;
    if (live.session.codexSessionId === codexSessionId) return live.session;
    live.session.codexSessionId = codexSessionId;
    this.emit('sessionUpdated', live.session);
    return live.session;
  }

  /**
   * Stamp a DETECTED OpenCode session id onto a live session. OpenCode mints
   * its own id server-side (unlike claude's forced `--session-id`), so it's
   * resolved after spawn via `OpenCodeSessionResolver` and reported here so
   * the record carries it — restore then does `opencode --session <id>` to
   * reopen THIS conversation. Idempotent + main-authoritative: the id comes
   * from main's own `opencode session list` query, never renderer/agent
   * free-text (Rule 1). Emits `sessionUpdated` so the renderer snapshot picks
   * it up. No-op if unknown or already set.
   */
  setOpenCodeSessionId(id: string, openCodeSessionId: string): TerminalSession | null {
    const live = this.live.get(id);
    if (!live) return null;
    if (live.session.openCodeSessionId === openCodeSessionId) return live.session;
    live.session.openCodeSessionId = openCodeSessionId;
    this.emit('sessionUpdated', live.session);
    return live.session;
  }

  /** Stamp opaque main-owned restore authority onto a live session. */
  setRestoreCapabilityId(id: string, restoreCapabilityId: string): TerminalSession | null {
    const live = this.live.get(id);
    if (!live) return null;
    live.session.restoreCapabilityId = restoreCapabilityId;
    this.emit('sessionUpdated', live.session);
    return live.session;
  }
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
// `cleanExtraArgs` + `mergeAllowedTools` now live in `./harness/argv-utils.js`
// (shared by the local assembly here AND every provider's remote path, so the
// two can't drift). `cleanExtraArgs` also resolves bare `--model` family aliases
// (Bedrock/Vertex/Foundry) at that single funnel point — see argv-utils.js.
// Re-exported here to preserve the historical import surface
// (`import { cleanExtraArgs } from '../pty.js'` in tests + callers).
export { cleanExtraArgs, mergeAllowedTools, mergeDisallowedTools };

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
 * Deterministic per-session remote loopback port for the reverse-tunnel hook
 * forward. Hashing the session id (unique) gives a stable port so a reconnect
 * reuses the SAME `-R` forward and concurrent agents on one host don't collide,
 * confined to a high ephemeral band [49200, 51200).
 */
export function remotePortForSession(sessionId: string): number {
  const REMOTE_HOOK_PORT_BASE = 49_200;
  const REMOTE_HOOK_PORT_RANGE = 2_000; // → [49200, 51200)
  let h = 0;
  for (let i = 0; i < sessionId.length; i++) {
    h = (h * 31 + sessionId.charCodeAt(i)) >>> 0;
  }
  return REMOTE_HOOK_PORT_BASE + (h % REMOTE_HOOK_PORT_RANGE);
}

/**
 * Detect ssh's remote-port-forwarding failure warning in a chunk of the ssh
 * output stream. When an `ssh -R` reverse forward can't bind on the remote (the
 * loopback port is already taken, or the sshd's `AllowTcpForwarding`/`GatewayPorts`
 * disallow it), OpenSSH prints, to the session's stderr (which our pty merges
 * into the data stream):
 *
 *   Warning: remote port forwarding failed for listen port 49999
 *
 * This is the ONLY honest, self-contained signal that the tunnel didn't come up:
 * a second ssh connection can't observe the `-R` binding (it lives inside the
 * interactive session), so an out-of-band probe would be meaningless. We match
 * the warning to downgrade the session's optimistic `remoteTunnel` posture to a
 * failed one with a human-readable reason. Pure + exported for tests. Returns the
 * listen port when matched (for the reason string), else null.
 */
export function detectRemoteForwardFailure(chunk: string): number | null {
  const m = chunk.match(/remote port forwarding failed for listen port (\d+)/i);
  return m ? Number(m[1]) : null;
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
 *  - `contentScreen` (experimental, opt-in): a SYNCHRONOUS match-all PostToolUse
 *    that POSTs the tool-RESULT event and ECHOES the server's verdict as
 *    `additionalContext` — screens inbound content rather than gating an
 *    outbound call, so there's no permission decision, only an optional
 *    warning. Fail-open, same posture as `overseer`. See {@link ContentScreen}.
 */
function buildHookSettings(opts: {
  stop: boolean;
  notify: boolean;
  firstPrompt?: boolean;
  subagents?: boolean;
  overseer?: boolean;
  /**
   * curl `-m` (max seconds) for the synchronous Overseer hook. Must sit just
   * above the server's decision-timeout guard. Default 10 (fast path); widened
   * by the caller when the deep "think harder" tier is enabled.
   */
  overseerCurlMaxSec?: number;
  /**
   * Content Screen (experimental, opt-in) — the synchronous PostToolUse
   * counterpart to `overseer`. See {@link ContentScreen}.
   */
  contentScreen?: boolean;
  /**
   * curl `-m` (max seconds) for the synchronous Content Screen hook. Mirrors
   * `overseerCurlMaxSec`: must sit just above the server's
   * `contentScreenDecisionTimeoutMs` guard. Defaults to 10.
   */
  contentScreenCurlMaxSec?: number;
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

  if (opts.subagents) {
    // Sub-agent (Task tool) live-count + per-child identity. PreToolUse matched
    // to `Task` fires the instant a sub-agent is dispatched; SubagentStop fires
    // when one finishes. The trailing path segment (`start`/`stop`) selects the
    // event. Best-effort, exit 0, never blocks.
    //
    // `start` FORWARDS the event JSON on stdin (it carries `tool_input`'s
    // `description`/`subagent_type`, which main parses into the child node) —
    // same `printf | curl --data-binary @-` idiom as the firstprompt hook, no
    // jq. The 5 s curl timeout + `|| true; exit 0` + main's 64 KB server-side
    // cap bound every failure mode, so a large/slow payload can never stall the
    // Task spawn. Even an empty/garbage body still POSTs `/start`, so the COUNT
    // stays exact regardless of whether identity parsed.
    const postStart =
      'ZCC_IN=$(cat); ' +
      '[ -n "$ZCC_SUBAGENT_URL" ] && ' +
      'printf "%s" "$ZCC_IN" | ' +
      'curl -s -m 5 -X POST --data-binary @- "$ZCC_SUBAGENT_URL/start" >/dev/null 2>&1 || true; exit 0';
    // `stop` (SubagentStop) carries no `tool_input` — nothing to forward, so it
    // keeps discarding stdin. Start→stop correlation is solved in main (FIFO),
    // not by the stop payload.
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

  if (opts.contentScreen) {
    // Experimental inbound content screen. Like `overseer` this is SYNCHRONOUS
    // and PRINTS its output, but on PostToolUse: it pipes the tool-RESULT event
    // JSON (stdin, carries `tool_response`) to our local server and echoes the
    // reply, which Claude Code parses as a `{hookSpecificOutput:
    // {additionalContext}}` warning injected into the agent's context — there is
    // no permission decision to make this late, so this is the only lever left.
    // Fail-open by construction, same posture as the overseer command: no URL /
    // curl error / non-2xx / empty reply → empty stdout → no warning is added,
    // the tool result reaches the agent exactly as it would have anyway.
    // `-m <sec>` sits just above the server's decision-timeout guard, same
    // rationale as the overseer command's ceiling.
    const contentScreenCurlMaxSec = opts.contentScreenCurlMaxSec ?? 10;
    const contentScreenCmd =
      'ZCC_IN=$(cat); ' +
      'if [ -n "$ZCC_CONTENTSCREEN_URL" ]; then ' +
      'printf "%s" "$ZCC_IN" | ' +
      `curl -s -m ${contentScreenCurlMaxSec} -X POST --data-binary @- "$ZCC_CONTENTSCREEN_URL" 2>/dev/null || true; ` +
      'fi; exit 0';
    // Match-all (empty matcher): every tool's result is offered to the cascade,
    // which decides per-call whether the tool is even screenable (see
    // isScreenableTool). Appended to any existing PostToolUse entries (notify's
    // AskUserQuestion) — each gets its own stdin copy and only this one emits
    // `additionalContext`, so they don't interfere.
    const contentScreenHook = { matcher: '', hooks: [{ type: 'command', command: contentScreenCmd }] };
    if (Array.isArray(hooks.PostToolUse)) {
      hooks.PostToolUse.push(contentScreenHook);
    } else {
      hooks.PostToolUse = [contentScreenHook];
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
