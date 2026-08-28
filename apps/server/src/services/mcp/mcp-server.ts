/**
 * Local MCP server for project-scoped agent -> user push.
 *
 * Bound to `127.0.0.1` on the requested port (or port 0 in isolated tests). The
 * URL path carries identity:
 *
 *   POST /mcp/:projectId               project-scoped surface
 *   POST /mcp/:projectId/:sessionId    session-scoped surface (preferred)
 *
 * Each request builds a fresh `McpServer` with the inbox tool whose
 * handler closes over `projectId` (and `sessionId` when present) parsed
 * from the URL — the agent never sees those ids in any tool schema, so
 * forgery is impossible. The session-scoped form lets `inbox_push` stamp
 * the originating terminal onto the entry so the inbox UI can route the
 * "Open" click back to that exact tab.
 *
 * Deliberately avoids Hono / `@hono/node-server` — Node's built-in `http`
 * listener is sufficient for two routes and avoids dragging another
 * dependency tree into the Electron main bundle.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { IInboxStore } from '../inbox/inbox-store.js';
import type { HeldQuestionGate } from '../inbox/held-questions.js';
import type { IAgentRegistryStore } from '../agents/agent-registry-store.js';
import type { IAgentMessageLog } from '../agents/agent-message-log.js';
import type {
  Project,
  InboxNotifyLevel,
  InboxOrigin,
  AgentState,
  PersonaSummary,
  ProjectSummary,
  TeamSummary,
  Result,
  CloneProjectResult
} from '@zana-ai/zcc-domain/product';
import { resolveDoc } from '../projects/fs.js';
import { registerInboxPushTool } from '../inbox/inbox-mcp-tool.js';
import { registerInboxAskTool } from '../inbox/inbox-ask-mcp-tool.js';
import { registerInboxSearchTool } from '../inbox/inbox-search-mcp-tool.js';
import { registerBrowserAutomationTools } from '../threads/browser-mcp-tools.js';
import { registerPreviewFileTool } from '../threads/preview-file-mcp-tool.js';
import { registerRemoteExecTool, type RegisterRemoteExecOpts } from '@zana-ai/zcc-host-daemon/remote-exec-mcp-tool';
import {
  registerRemoteFsTools,
  type RegisterRemoteFsToolsOpts
} from '@zana-ai/zcc-host-daemon/remote-fs-mcp-tools';
import { registerMicrovmExecTool, type RegisterMicrovmExecOpts } from '@zana-ai/zcc-host-daemon/microvm-exec-mcp-tool';
import { registerSuggestActionTool } from '../suggestions/suggest-action-mcp-tool.js';
import type { ISuggestionsStore } from '../suggestions/suggestions-store.js';
import { registerScheduleReportTool } from '../scheduler/schedule-report-mcp-tool.js';
import { registerRegisterProjectTool } from '../projects/register-project-mcp-tool.js';
import { registerCloneProjectTool } from '../projects/clone-project-mcp-tool.js';
import { registerCloseSessionTools } from '../followups/close-session-mcp-tool.js';
import { registerInstallLocalExtensionTool } from '../extensions/install-local-extension-mcp-tool.js';
import { registerCreateLocalExtensionTool } from '../extensions/create-local-extension-mcp-tool.js';
import { registerCompleteAutonomousRunTool } from '../agents/complete-autonomous-run-mcp-tool.js';
import {
  registerCloseIdleAgentsTools,
  type RegisterCloseIdleAgentsToolsOpts
} from '../followups/close-idle-agents-mcp-tool.js';
import { registerAgentRegistryTools } from '../agents/agent-registry-mcp-tools.js';
import { registerAgentMessagingTools } from '../agents/agent-messaging-mcp-tools.js';
import { registerListPersonasTool } from '../agents/register-personas-mcp-tool.js';
import { registerListTeamsTool } from '../agents/register-teams-mcp-tool.js';
import {
  registerLaunchTeamTool,
  type RegisterLaunchTeamToolOpts
} from '../agents/launch-team-mcp-tool.js';
import { registerListProjectsTool } from '../projects/list-projects-mcp-tool.js';
import { registerLibraryTools, type LibraryAgentApi } from '../library/library-mcp-tools.js';
import { registerGoalTools, type GoalAgentApi } from '../goals/goal-mcp-tools.js';
import { registerFollowUpTools, type FollowUpAgentApi } from '../followups/followup-mcp-tools.js';
import { verifySessionControlCredential } from '@zana-ai/zcc-host-daemon/control-credential';

interface ProjectLookup {
  /** Return the current project meta or null if unknown. Called per-request. */
  get(projectId: string): Project | null;
}

export interface McpServerOptions {
  inboxStore: IInboxStore;
  /** Stable app-owned listener port. Omit for an OS-assigned test port. */
  port?: number;
  /**
   * Optional suppress-while-working gate for question-bearing inbox pushes/asks.
   * When present, a BLOCKING question fired while its originating agent is still
   * working is parked and surfaces on the agent's next idle/blocked edge instead
   * of interrupting mid-run (see {@link HeldQuestionService}). Absent ⇒ questions
   * always append immediately.
   */
  heldQuestions?: HeldQuestionGate;
  /** Backing store for the Suggested Actions launcher (suggest_action tool). */
  suggestionsStore: ISuggestionsStore;
  projects: ProjectLookup;
  /** Logger used at startup; defaults to console. */
  log?: (msg: string) => void;
  /**
   * Called when a spawned session's Stop hook pings back (auto-close on
   * finish). The url path carries identity: `/hook/stop/:projectId/:sessionId`.
   * Implementations close the matching terminal. Best-effort — the route
   * always 200s so the hook stays fire-and-forget.
   */
  onStopHook?: (projectId: string, sessionId: string) => void;
  /**
   * Called when a session's Notification / UserPromptSubmit hook pings back.
   * `action` is `blocked` (agent is waiting on the user — permission prompt or
   * interactive question) or `unblocked` (user answered / turn ended). Drives
   * the live "blocked — needs you" agent status. The url path carries identity:
   * `/hook/notify/:projectId/:sessionId/:action`. Best-effort; always 200s.
   */
  onNotifyHook?: (projectId: string, sessionId: string, action: 'blocked' | 'unblocked') => void;
  /**
   * Called when a session's SYNCHRONOUS PreToolUse Overseer hook posts a tool
   * call (experimental auto-approval). Unlike the fire-and-forget hooks, the
   * agent BLOCKS on this response, so the handler returns a `PreToolUse`
   * permission decision (`allow`/`ask`) the route serializes to the JSON shape
   * Claude Code expects. Returning null (or this handler being absent) makes the
   * route answer with an empty body, which the hook treats as "no opinion" → the
   * agent's normal permission prompt. Fail-open by contract. `body` is the raw
   * PreToolUse event JSON from the hook's stdin. The url path carries identity:
   * `/hook/overseer/:projectId/:sessionId`.
   */
  onOverseerHook?: (
    projectId: string,
    sessionId: string,
    body: string
  ) => Promise<{ decision: 'allow' | 'ask'; reason: string } | null>;
  /**
   * Upper bound (ms) on the whole Overseer exchange, after which we fail open
   * with an empty body regardless of whether `onOverseerHook` has returned. The
   * guard that bounds a slow/hung decision (e.g. the LLM tier). Defaults to
   * 8_000 — kept just under the hook's own `curl -m 10`. May be a thunk so the
   * guard can track live config (the deep "think harder" tier needs a larger
   * ceiling than the fast path — read at request time, not frozen at boot).
   * Injectable for tests.
   */
  overseerDecisionTimeoutMs?: number | (() => number);
  /**
   * Called when a session's SYNCHRONOUS PostToolUse Content Screen hook posts a
   * tool call's RESULT (experimental inbound prompt-injection defense — the
   * counterpart to the Overseer, which screens outbound tool calls). Like
   * {@link onOverseerHook} the agent BLOCKS on this response, but the reply
   * shape differs: PostToolUse has no permissionDecision, so a flagged result
   * returns `additionalContext` (a warning injected into the agent's context)
   * rather than an allow/ask/deny. Returning null (or this handler being
   * absent) makes the route answer with an empty body — the hook treats that
   * as "no opinion" and the tool result reaches the agent completely
   * unmodified. Fail-open by contract. `body` is the raw PostToolUse event JSON
   * from the hook's stdin (carries `tool_response`). The url path carries
   * identity: `/hook/contentscreen/:projectId/:sessionId`.
   */
  onContentScreenHook?: (
    projectId: string,
    sessionId: string,
    body: string
  ) => Promise<{ additionalContext: string } | null>;
  /**
   * Upper bound (ms) on the whole Content Screen exchange, after which we fail
   * open with an empty body regardless of whether `onContentScreenHook` has
   * returned. Mirrors {@link overseerDecisionTimeoutMs}. Defaults to 8_000 —
   * kept just under the hook's own `curl -m 10`. Injectable for tests.
   */
  contentScreenDecisionTimeoutMs?: number | (() => number);
  /**
   * Called when a session's UserPromptSubmit hook forwards the prompt text.
   * Fires on EVERY prompt; the handler is responsible for acting at most once
   * per session (e.g. naming the tab from the first instruction). `text` is the
   * user's prompt, extracted from the hook's JSON stdin (or the raw body if it
   * isn't JSON). The url path carries identity:
   * `/hook/firstprompt/:projectId/:sessionId`. Best-effort; always 200s.
   */
  onFirstPromptHook?: (projectId: string, sessionId: string, text: string) => void;
  /**
   * EXPERIMENTAL (gated by {@link AppConfig.askUserQuestionUiEnabled}): called
   * when a session's `AskUserQuestion` PreToolUse hook forwards the raw tool-call
   * JSON. `body` is the hook's stdin verbatim (a PreToolUse event carrying
   * `tool_input.questions[]`); the handler maps it into the inbox question shape
   * and appends it so the app can render the picker. Best-effort; the route
   * always 200s and never blocks the agent (the terminal remains a working
   * fallback). The url path carries identity:
   * `/hook/question/:projectId/:sessionId`.
   */
  onQuestionHook?: (projectId: string, sessionId: string, body: string) => void;
  /**
   * Called when a session's sub-agent (Task tool) hook pings back. `action` is
   * `start` (a Task tool_use began — PreToolUse) or `stop` (a sub-agent
   * finished — SubagentStop). Drives the live "N sub-agents running" badge and
   * the per-child node records. `identity` (description / subagent_type) is
   * parsed from the PreToolUse(Task) payload and only ever passed on `'start'`;
   * absent/malformed payloads pass `undefined` (the count still increments). The
   * url path carries identity: `/hook/subagent/:projectId/:sessionId/:action`.
   * Best-effort; always 200s, like the other hook routes.
   */
  onSubagentHook?: (
    projectId: string,
    sessionId: string,
    action: 'start' | 'stop',
    identity?: { description?: string; subagentType?: string }
  ) => void;
  /**
   * Called when a session's generic tool-activity hook pings back — the
   * idle-veto signal. `action` is `start` (any tool's PreToolUse), `stop` (its
   * PostToolUse), or `clear` (the Stop hook's drift-guard reset). Unlike
   * {@link onSubagentHook} this is match-all (every tool, not just Task), and
   * DOES affect the resolved working/idle status (see `AgentStatusTracker`).
   * The url path carries identity: `/hook/toolactivity/:projectId/:sessionId/:action`.
   * Best-effort; always 200s, like the other hook routes.
   */
  onToolActivityHook?: (
    projectId: string,
    sessionId: string,
    action: 'start' | 'stop' | 'clear'
  ) => void;
  /**
   * Called when a scheduled agent files a run report via the `schedule_report`
   * tool. The url path carries identity (`/mcp/:projectId/:sessionId`), so the
   * summary is attributable to an exact session — the scheduler attaches it to
   * the matching run. Best-effort; the tool returns success regardless.
   */
  onReport?: (
    projectId: string,
    sessionId: string,
    summary: string,
    status?: 'success' | 'partial' | 'failure'
  ) => void;
  /**
   * Resolve a session's scheduled inbox loudness. Returns the owning schedule's
   * {@link InboxNotifyLevel} for a scheduled (background) run, or `null` when
   * the session is unknown / not scheduled. Used to stamp `scheduled` + `notify`
   * on `inbox_push` entries (so the sidebar can group/badge them) and to drop
   * pushes from `silent` schedules entirely.
   */
  resolveScheduledLevel?: (sessionId: string) => InboxNotifyLevel | null;
  /**
   * Resolve the originating agent's resume/reopen coordinates ({@link InboxOrigin})
   * from the live pty — its `claudeSessionId`, `profile`, `personaId`, `cwd`.
   * Resolved HERE (main is the authority, Rule 1), stamped onto `inbox_push`
   * entries so the inbox can reopen the agent's work after its tab is gone.
   * Returns `null` for an unknown/non-resumable session. Only consulted on the
   * session-scoped route (a project-only push has no originating session).
   */
  resolveOrigin?: (sessionId: string) => InboxOrigin | null;
  /**
   * Add a directory to the user's project list on the agent's behalf (the
   * `register_project` tool). Returns the resulting project and whether it
   * already existed; throws on a bad path. Absent disables the tool. The main
   * process also handles the side-effects (mcp config, live sidebar refresh).
   */
  registerProject?: (absPath: string) =>
    | { project: Project; alreadyExisted: boolean }
    | Promise<{ project: Project; alreadyExisted: boolean }>;
  /**
   * Clone and register a repository in the configured clone root. The main
   * process owns destination selection so a temporary session cwd never leaks
   * into the persisted project path.
   */
  cloneProject?: (input: { url: string; name?: string }) => Promise<CloneProjectResult>;
  /**
   * Scaffold + pack + install a brand-new local (in-app-authored) extension on
   * the agent's behalf (the `create_local_extension` tool). Mints a fresh id,
   * returns its working dir + dedicated project id. Identity-free — like
   * {@link registerProject}, there's no "whose extension is this" ambiguity to
   * resolve since create always mints something new. Absent disables the tool.
   */
  createLocalExtension?: (req: {
    name: string;
    description?: string;
    kind?: string;
  }) => Promise<Result<{ id: string; workingDir: string; projectId: string }>>;
  /**
   * The inter-agent discovery registry (Phase 0 of the agent mesh). When
   * present, the session-scoped route exposes `register_agent` / `list_agents` /
   * `find_agent` so an agent can announce itself and discover peers. Absent
   * disables those tools entirely (e.g. in tests that don't exercise the mesh).
   */
  agentRegistry?: IAgentRegistryStore;
  /**
   * Resolve a session's working directory (for the registry record's `cwd`).
   * Server-side, from the live pty — never trusted from the agent. Paired with
   * {@link agentRegistry}.
   */
  getSessionCwd?: (sessionId: string) => string | undefined;
  /**
   * Resolve a session's live agent state, fused into `list_agents` / `find_agent`
   * responses so the registry never stores a stale status. Paired with
   * {@link agentRegistry}. Also gates the best-effort inject in `agent_send`.
   */
  getAgentStatus?: (sessionId: string) => AgentState;
  /**
   * Resolve a session's team launch id (the squad it belongs to). When present,
   * the registry tools scope handle dedup and peer discovery to the same launch
   * so two squads in one project stay isolated. Paired with {@link agentRegistry}.
   */
  getTeamLaunchId?: (sessionId: string) => string | undefined;
  /**
   * The agent↔agent message channel (Phase 1 of the mesh). When present (with
   * {@link agentRegistry}), the session-scoped route exposes `agent_send` /
   * `agent_inbox`. This is NOT the user inbox — peer traffic is audited here,
   * never in {@link inboxStore}.
   */
  agentMessageLog?: IAgentMessageLog;
  /**
   * Inject a line into a session's pty (the `reply()` primitive), for
   * `agent_send`'s best-effort idle-inject. Returns true if the pty accepted it.
   * Paired with {@link agentMessageLog}.
   */
  injectToSession?: (sessionId: string, text: string) => boolean;
  /**
   * Close a session by id (the `close_session` / `close_session_with_summary`
   * tools — an agent ending its own session). Returns false on an unknown id.
   * Present ONLY when the `agentSelfCloseEnabled` config flag is on; absent ⇒
   * the self-close tools are not registered, so the agent doesn't see them.
   * The session-scoped route guarantees the agent can only close itself.
   */
  closeSession?: (sessionId: string) => boolean;
  /**
   * Pack + install the local extension owned by `sessionId`'s own working dir
   * (the `install_local_extension` tool — the Extension Creator agent applying
   * its own in-progress source so the user can try it without a manual
   * "Reload from source" click). main re-derives WHICH extension from the
   * session's live cwd against `local.json` — the agent supplies no id/path.
   * Always wired (no flag): the underlying lookup fails closed (an
   * unregistered cwd yields `NOT_LOCAL`), so there's nothing unsafe about
   * always registering the tool. The session-scoped route guarantees an agent
   * can only ever install the extension IT is working in.
   */
  installOwnExtension?: (sessionId: string) => Promise<Result<{ id: string }>>;
  /**
   * Mark the autonomous run owned by `sessionId` complete (the
   * `complete_autonomous_run` tool — an orchestrator declaring the goal met).
   * Returns true when the caller owned a running run; false otherwise. The
   * supervisor records the summary, closes the workers, posts the consolidated
   * inbox overview, and keeps the orchestrator's tab open. Present only when an
   * autonomous-capable build wires it; the per-call ownership check lives in the
   * supervisor (an agent can only complete the run it orchestrates).
   */
  completeAutonomousRun?: (orchestratorSessionId: string, summary: string) => boolean;
  /**
   * Resolve the idle peer agents to close for `close_idle_agents`, grouped by
   * project with the caller excluded (idle detection + per-project confinement
   * live in main, never trusted from the agent). Present ONLY when the
   * `closeIdlePeersEnabled` config flag is on; absent ⇒ the tool is not
   * registered, so the agent doesn't see it. Paired with
   * {@link summarizeAndCloseProject}.
   */
  findIdleAgents?: RegisterCloseIdleAgentsToolsOpts['findIdleAgents'];
  /**
   * Summarize (optionally) then close one project's idle sessions — the shared
   * CloseSummaryService path. Paired with {@link findIdleAgents}; both are wired
   * together when `closeIdlePeersEnabled` is on.
   */
  summarizeAndCloseProject?: RegisterCloseIdleAgentsToolsOpts['summarizeAndClose'];
  /**
   * Resolve the persona catalogue as non-sensitive {@link PersonaSummary}
   * metadata (the `list_personas` tool — agents discover the roles they can be
   * launched as). Read-only; wired once at app init. Absent ⇒ the tool isn't
   * registered. Available on both route shapes (it needs no sessionId).
   */
  listPersonas?: () => PersonaSummary[];
  /**
   * Resolve the team catalogue as non-sensitive {@link TeamSummary} metadata
   * (the `list_teams` tool — agents/operators discover the teams they can
   * launch). Read-only; wired once at app init. Absent ⇒ the tool isn't
   * registered. Available on both route shapes (it needs no sessionId).
   */
  listTeams?: () => TeamSummary[];
  /**
   * Launch a Team into a project for the `launch_team` tool (workers + an
   * orchestrator carrying the roster). main-authoritative — team lookup, project
   * validation, per-persona checks, and the Rule-5 tab cap all live behind it.
   * Present ONLY when the `teamLaunchEnabled` config flag is on; absent ⇒ the
   * tool is not registered, so the agent doesn't see it.
   */
  launchTeam?: RegisterLaunchTeamToolOpts['launchTeam'];
  authorizeTeamLaunch?: RegisterLaunchTeamToolOpts['authorizeTeamLaunch'];
  cancelTeamLaunch?: RegisterLaunchTeamToolOpts['cancelTeamLaunch'];
  getTeamLaunch?: RegisterLaunchTeamToolOpts['getTeamLaunch'];
  reportTeamTask?: RegisterLaunchTeamToolOpts['reportTeamTask'];
  validateTeamRouteIdentity?: RegisterLaunchTeamToolOpts['validateRouteIdentity'];
  /**
   * Resolve the project list as non-sensitive {@link ProjectSummary} metadata
   * (the `list_projects` tool — agents discover the projects they can scope work
   * to / resolve a name the user mentioned to an id). Read-only; wired once at
   * app init. Absent ⇒ the tool isn't registered. Available on both route shapes
   * (it needs no sessionId).
   */
  listProjects?: () => ProjectSummary[];
  /**
   * Run a shell command on a REGISTERED remote (SSH) project (the `remote_exec`
   * tool). The impl (in index.ts) resolves the project's `ProjectRemote` from
   * the store by the agent-supplied id and confines the command under its
   * realpath'd remote root — the agent never supplies host/creds (rule 1).
   * Absent ⇒ the tool isn't registered. Available on both route shapes (it needs
   * no sessionId). NOT pre-approved in pty.ts except on autonomous runs, so the
   * first use raises a permission prompt.
   */
  runRemoteCommand?: RegisterRemoteExecOpts['runRemoteCommand'];
  /**
   * Route-scoped remote file tools (`remote_read` / `remote_write` / `remote_edit`
   * / `remote_glob` / `remote_grep`). The MCP URL's projectId is closed over so
   * the model cannot pick an arbitrary host. Absent ⇒ tools aren't registered.
   * Keep `remote_exec` as Shell (agent-supplied projectId).
   */
  remoteFs?: Omit<RegisterRemoteFsToolsOpts, 'projectId'>;
  /**
   * Run a shell command inside a project's SANDBOXED microVM playground (the
   * `microvm_exec` tool). The impl (in index.ts) closes over the host-owned
   * `MicroVmPool`, which lazily boots + reuses a per-project guest, authorizes
   * the image against a closed allowlist, and confines execution to a VM with no
   * host filesystem access (rule 1/7). Absent ⇒ the tool isn't registered.
   * Available on both route shapes (needs no sessionId). NOT pre-approved in
   * pty.ts except on autonomous runs — first use raises a permission prompt.
   */
  runMicrovmCommand?: RegisterMicrovmExecOpts['runMicrovmCommand'];
  /**
   * Tear down + forget a project's playground guest (the `microvm_reset` tool).
   * Wired alongside `runMicrovmCommand`. Absent ⇒ the reset tool isn't registered.
   */
  resetMicrovm?: RegisterMicrovmExecOpts['resetMicrovm'];
  /**
   * Project-locked LibraryStore slice for the `library_*` tools — lets an agent
   * read/write/edit/delete docs in ITS OWN project's `.zcc/library`. The handlers
   * close over projectId/sessionId from the URL route; the store realpath-confines
   * every path and host-stamps `source:{kind:'agent'}`. Session-scoped only (a
   * write needs a sessionId). Absent ⇒ the tools aren't registered.
   */
  libraryAgentApi?: LibraryAgentApi;
  /**
   * Project-locked GoalManager slice for the `goal_*` tools — lets an agent
   * create/list persistent Goals in ITS OWN project. The handlers close over
   * projectId from the URL route and force `scope` to that project, so an agent
   * cannot target another project or the global directory. Session-scoped only.
   * Absent ⇒ the tools aren't registered.
   */
  goalAgentApi?: GoalAgentApi;
  /**
   * Project-locked FollowUpManager slice for the `followup_*` tools — lets an
   * agent file / list / resolve Follow-ups (parked questions / decisions) in ITS
   * OWN project. The handlers close over projectId/sessionId from the URL route
   * and host-stamp `origin:{source:'agent'}`, so an agent cannot target another
   * project or spoof provenance. Session-scoped only. Absent ⇒ tools not registered.
   */
  followupAgentApi?: FollowUpAgentApi;
  /**
   * Open a file in this session's visible side-panel preview. Session-scoped
   * only — identity is closed over from the MCP URL. The implementation confines
   * the path (Rule 2) and broadcasts `threads:open`. Absent disables the tool
   * (e.g. tests that don't exercise preview).
   */
  previewFile?: (input: {
    threadId: string;
    projectId: string;
    source: 'workspace' | 'thread-storage';
    path: string;
    lineNumber: number | null;
  }) => Promise<{ delivered: number; path: string; source: 'workspace' | 'thread-storage' }>;
}

export interface McpServerHandle {
  /** `http://127.0.0.1:<port>` — callers append `/mcp/:projectId`. */
  url: string;
  /** Bound port. Useful for tests. */
  port: number;
  /** Stop the listener; resolves once it's fully closed. */
  close(): Promise<void>;
}

/**
 * Build a per-request `McpServer` scoped to one projectId. Tools' handlers
 * close over the id from the URL path, never trusting any field the agent
 * supplies. We tolerate a missing project (renderer will tombstone the
 * entry) — the URL is still authoritative for the inbox key.
 */
function buildProjectMcpServer(opts: {
  projectId: string;
  projectLabel?: string;
  projectRoot?: string;
  sessionId?: string;
  sessionCredential?: string;
  inboxStore: IInboxStore;
  heldQuestions?: McpServerOptions['heldQuestions'];
  suggestionsStore: ISuggestionsStore;
  onReport?: McpServerOptions['onReport'];
  resolveScheduledLevel?: McpServerOptions['resolveScheduledLevel'];
  resolveOrigin?: McpServerOptions['resolveOrigin'];
  registerProject?: McpServerOptions['registerProject'];
  cloneProject?: McpServerOptions['cloneProject'];
  createLocalExtension?: McpServerOptions['createLocalExtension'];
  agentRegistry?: McpServerOptions['agentRegistry'];
  getSessionCwd?: McpServerOptions['getSessionCwd'];
  getAgentStatus?: McpServerOptions['getAgentStatus'];
  getTeamLaunchId?: McpServerOptions['getTeamLaunchId'];
  agentMessageLog?: McpServerOptions['agentMessageLog'];
  injectToSession?: McpServerOptions['injectToSession'];
  closeSession?: McpServerOptions['closeSession'];
  installOwnExtension?: McpServerOptions['installOwnExtension'];
  completeAutonomousRun?: McpServerOptions['completeAutonomousRun'];
  findIdleAgents?: McpServerOptions['findIdleAgents'];
  summarizeAndCloseProject?: McpServerOptions['summarizeAndCloseProject'];
  listPersonas?: McpServerOptions['listPersonas'];
  listTeams?: McpServerOptions['listTeams'];
  launchTeam?: McpServerOptions['launchTeam'];
  authorizeTeamLaunch?: McpServerOptions['authorizeTeamLaunch'];
  cancelTeamLaunch?: McpServerOptions['cancelTeamLaunch'];
  getTeamLaunch?: McpServerOptions['getTeamLaunch'];
  reportTeamTask?: McpServerOptions['reportTeamTask'];
  validateTeamRouteIdentity?: McpServerOptions['validateTeamRouteIdentity'];
  listProjects?: McpServerOptions['listProjects'];
  runRemoteCommand?: McpServerOptions['runRemoteCommand'];
  remoteFs?: McpServerOptions['remoteFs'];
  runMicrovmCommand?: McpServerOptions['runMicrovmCommand'];
  resetMicrovm?: McpServerOptions['resetMicrovm'];
  libraryAgentApi?: McpServerOptions['libraryAgentApi'];
  goalAgentApi?: McpServerOptions['goalAgentApi'];
  followupAgentApi?: McpServerOptions['followupAgentApi'];
  previewFile?: McpServerOptions['previewFile'];
}): McpServer {
  const mcp = new McpServer({ name: 'zcc-inbox', version: '0.1.0' });
  // Resolve scheduled-ness + loudness once at build time so inbox_push entries
  // from a background run carry the flag (for grouping) and the level (for
  // badge counting), and so `silent` pushes can be dropped.
  const scheduledLevel = opts.sessionId
    ? opts.resolveScheduledLevel?.(opts.sessionId) ?? null
    : null;
  // Resolve the originating agent's resume coordinates once, from the live pty,
  // so a push made while the tab is alive still carries a reopen target after it
  // dies. Session-scoped only — a project-only push has no originating agent.
  const origin = opts.sessionId ? opts.resolveOrigin?.(opts.sessionId) ?? undefined : undefined;
  // Fix-at-source doc-path normalizer: when we know the project root, rewrite a
  // reported doc path to its actual project-root-relative location (the agent
  // often `cd`s into a subdir and reports the path relative to there). Wired
  // only when a root is known; resolveDoc confines every candidate to it, so a
  // traversal can't escape. Never throws — falls back to the reported path.
  const projectRoot = opts.projectRoot;
  const normalizeDocPath = projectRoot
    ? (reportedPath: string): string => {
        try {
          const found = resolveDoc(projectRoot, reportedPath, origin?.cwd);
          return found.ok ? found.rel : reportedPath;
        } catch {
          return reportedPath;
        }
      }
    : undefined;
  registerInboxPushTool(mcp, {
    ...opts,
    origin,
    normalizeDocPath,
    scheduled: scheduledLevel !== null,
    notify: scheduledLevel ?? undefined,
    heldQuestions: opts.heldQuestions
  });
  // inbox_ask: the interactive sibling of inbox_push (structured multiple-choice
  // question + Skip/Continue). Session-scoped ONLY — the chosen answer is injected
  // back into THIS session's pty, so without a session there's nowhere to deliver.
  if (opts.sessionId) {
    registerInboxAskTool(mcp, {
      projectId: opts.projectId,
      projectLabel: opts.projectLabel,
      sessionId: opts.sessionId,
      scheduled: scheduledLevel !== null,
      notify: scheduledLevel ?? undefined,
      inboxStore: opts.inboxStore,
      heldQuestions: opts.heldQuestions
    });
  }
  // inbox_search: the READ counterpart to inbox_push. Available on both route
  // shapes (it reads, no originating session needed). projectId from the route is
  // the default, confined scope; the agent can widen to all projects explicitly.
  registerInboxSearchTool(mcp, {
    projectId: opts.projectId,
    inboxStore: opts.inboxStore
  });
  registerBrowserAutomationTools(mcp, { threadId: opts.sessionId ?? null });
  if (opts.sessionId) {
    registerPreviewFileTool(mcp, {
      threadId: opts.sessionId,
      projectId: opts.projectId,
      previewFile: opts.previewFile
    });
  }
  // suggest_action: propose a runnable next action for the operator's launcher.
  // Available on both route shapes (a suggestion needs no live originating
  // session); projectId/origin come from the route, never the agent (rule 1).
  registerSuggestActionTool(mcp, {
    projectId: opts.projectId,
    projectLabel: opts.projectLabel,
    sessionId: opts.sessionId,
    origin,
    suggestionsStore: opts.suggestionsStore
  });
  // schedule_report attaches an agent-authored summary to the originating
  // scheduled run. It needs a session to attach to, so we only register it on
  // the session-scoped route — otherwise the agent would see a tool in its
  // list that can only ever fail. Bind projectId into the callback so the
  // tool's handler only needs the (sessionId, summary, status) shape.
  if (opts.sessionId) {
    registerScheduleReportTool(mcp, {
      sessionId: opts.sessionId,
      onReport: opts.onReport
        ? (sessionId, summary, status) => opts.onReport!(opts.projectId, sessionId, summary, status)
        : undefined
    });
  }
  // Agent-registry discovery tools (register_agent / list_agents / find_agent).
  // Session-scoped only — like schedule_report, each needs a real originating
  // session so identity (sessionId/projectId/cwd) is filled from the URL route,
  // never the agent. Gated on the registry being wired (absent in mesh-less
  // tests). Live status is fused in via getAgentStatus at response time.
  if (opts.sessionId && opts.agentRegistry) {
    registerAgentRegistryTools(mcp, {
      sessionId: opts.sessionId,
      projectId: opts.projectId,
      cwd: opts.getSessionCwd?.(opts.sessionId),
      registry: opts.agentRegistry,
      getAgentStatus: opts.getAgentStatus ?? (() => 'unknown'),
      teamLaunchId: opts.getTeamLaunchId?.(opts.sessionId)
    });
    // Messaging tools (agent_send / agent_inbox) layer on the registry — only
    // wired when the message log + inject primitive are provided. Audit goes to
    // the AgentMessageLog, never the user inbox.
    if (opts.agentMessageLog && opts.injectToSession) {
      registerAgentMessagingTools(mcp, {
        sessionId: opts.sessionId,
        projectId: opts.projectId,
        registry: opts.agentRegistry,
        messageLog: opts.agentMessageLog,
        getAgentStatus: opts.getAgentStatus ?? (() => 'unknown'),
        injectToSession: opts.injectToSession
      });
    }
  }
  // close_session / close_session_with_summary: let the agent end its OWN
  // session. Session-scoped only (identity from the URL ⇒ can only close
  // itself) and gated on `closeSession` being wired, which index.ts does only
  // when the `agentSelfCloseEnabled` config flag is on.
  if (opts.sessionId && opts.closeSession) {
    registerCloseSessionTools(mcp, {
      sessionId: opts.sessionId,
      projectId: opts.projectId,
      projectLabel: opts.projectLabel,
      closeTerminal: opts.closeSession,
      inboxStore: opts.inboxStore
    });
  }
  // install_local_extension: let the Extension Creator agent pack + install its
  // OWN local extension so the user can try it without a manual "Reload from
  // source" click. Session-scoped only — `installOwnExtension` re-derives which
  // extension from the session's live cwd, never from agent input. Always wired
  // (no config flag): the injected callback itself fails closed when the
  // session's cwd isn't a known local extension.
  if (opts.sessionId && opts.installOwnExtension) {
    registerInstallLocalExtensionTool(mcp, {
      sessionId: opts.sessionId,
      installOwnExtension: opts.installOwnExtension
    });
  }
  // complete_autonomous_run: let an autonomous-team orchestrator declare the
  // goal met — closes the workers, posts the consolidated inbox overview, and
  // keeps the orchestrator's tab open. Session-scoped (identity from the URL);
  // the supervisor rejects the call when the caller isn't the run's orchestrator.
  if (opts.sessionId && opts.completeAutonomousRun) {
    registerCompleteAutonomousRunTool(mcp, {
      sessionId: opts.sessionId,
      completeRun: opts.completeAutonomousRun
    });
  }
  // close_idle_agents: let the agent close its OTHER idle peers (never itself).
  // Session-scoped (identity from the URL); idle detection + per-project
  // confinement live behind the injected resolver / summarizeAndClose, which
  // index.ts wires only when the `closeIdlePeersEnabled` config flag is on.
  if (opts.sessionId && opts.findIdleAgents && opts.summarizeAndCloseProject) {
    registerCloseIdleAgentsTools(mcp, {
      sessionId: opts.sessionId,
      projectId: opts.projectId,
      findIdleAgents: opts.findIdleAgents,
      summarizeAndClose: opts.summarizeAndCloseProject
    });
  }
  // register_project: lets the agent add a cloned/created dir to the project
  // list. Available on both route shapes — projectRoot (when known) only
  // resolves a relative path; an absolute path works regardless.
  if (opts.registerProject) {
    registerRegisterProjectTool(mcp, {
      projectRoot: opts.projectRoot,
      registerProject: opts.registerProject
    });
  }
  const cloneRouteAuthenticated = !!opts.sessionId
    && !!opts.sessionCredential
    && verifySessionControlCredential(opts.sessionId, opts.sessionCredential);
  if (cloneRouteAuthenticated && opts.cloneProject) {
    registerCloneProjectTool(mcp, { cloneProject: opts.cloneProject });
  }
  // create_local_extension: lets an agent scaffold a brand-new local extension
  // project (mints a fresh id — no identity ambiguity, so identity-free like
  // register_project). Available on both route shapes, gated only on the dep.
  if (opts.createLocalExtension) {
    registerCreateLocalExtensionTool(mcp, {
      createLocalExtension: opts.createLocalExtension
    });
  }
  // list_personas: read-only persona discovery. No sessionId needed (it's
  // identity-free), so it's available on both route shapes. Gated on the dep
  // being wired (absent in mesh-less tests).
  if (opts.listPersonas) {
    registerListPersonasTool(mcp, { listPersonas: opts.listPersonas });
  }
  // list_teams: read-only team discovery. Identity-free, available on both
  // routes, gated on the dep being wired.
  if (opts.listTeams) {
    registerListTeamsTool(mcp, { listTeams: opts.listTeams });
  }
  // launch_team: let the agent launch a Team. Session-scoped — identity from the
  // URL fills the default project (the agent launches "here" unless it names
  // another). Gated on `launchTeam` being wired, which index.ts does only when
  // the `teamLaunchEnabled` config flag is on.
  if (opts.sessionId && opts.launchTeam) {
    const routeAuthenticated = !!opts.sessionCredential
      && verifySessionControlCredential(opts.sessionId, opts.sessionCredential);
    registerLaunchTeamTool(mcp, {
      sessionId: opts.sessionId,
      projectId: opts.projectId,
      launchTeam: opts.launchTeam,
      authorizeTeamLaunch: opts.authorizeTeamLaunch,
      cancelTeamLaunch: opts.cancelTeamLaunch,
      getTeamLaunch: opts.getTeamLaunch,
      reportTeamTask: opts.reportTeamTask,
      validateRouteIdentity: (sessionId, projectId) => routeAuthenticated
        && (opts.validateTeamRouteIdentity?.(sessionId, projectId) ?? false)
    });
  }
  // list_projects: read-only project discovery. Identity-free (no sessionId
  // needed), so it's available on both route shapes. Gated on the dep being
  // wired (absent in mesh-less tests).
  if (opts.listProjects) {
    registerListProjectsTool(mcp, { listProjects: opts.listProjects });
  }
  // remote_exec: run a shell command on a registered remote (SSH) project.
  // Identity-free at this layer (the target project is an agent-supplied id that
  // the impl re-resolves from the store, never host/creds — rule 1), so it's
  // available on both route shapes. Gated on the dep being wired.
  if (opts.runRemoteCommand) {
    registerRemoteExecTool(mcp, { runRemoteCommand: opts.runRemoteCommand });
  }
  if (opts.remoteFs) {
    registerRemoteFsTools(mcp, { projectId: opts.projectId, ...opts.remoteFs });
  }
  // microvm_exec / microvm_reset: run a shell command inside a project's
  // SANDBOXED microVM playground (isolated guest, no host mount). Identity-free
  // at this layer (the target project is an agent-supplied id the pool binds a
  // guest to; image authz + confinement live in the host-owned pool — rule 1/7),
  // so it's available on both route shapes. Gated on the runner being wired
  // (absent unless the platform supports microVMs + the feature is enabled).
  if (opts.runMicrovmCommand) {
    registerMicrovmExecTool(mcp, {
      runMicrovmCommand: opts.runMicrovmCommand,
      resetMicrovm: opts.resetMicrovm
    });
  }
  // library_* (write/read/list/remove): let the agent keep durable docs in its
  // OWN project's .zcc/library. Session-scoped — the write stamps the originating
  // sessionId as source, and the projectId from the route locks the scope so an
  // agent can't reach global or another project. Gated on the store slice being
  // wired (absent in library-less tests).
  if (opts.sessionId && opts.libraryAgentApi) {
    registerLibraryTools(mcp, {
      projectId: opts.projectId,
      sessionId: opts.sessionId,
      libraryAgentApi: opts.libraryAgentApi
    });
  }
  // goal_* (create/list): let the agent define persistent Goals in its OWN
  // project. Session-scoped — the projectId from the route locks the scope (and
  // forces `scope` to this project), so an agent can't target another project or
  // the global directory. Gated on the GoalManager slice being wired.
  if (opts.sessionId && opts.goalAgentApi) {
    registerGoalTools(mcp, {
      projectId: opts.projectId,
      sessionId: opts.sessionId,
      goalAgentApi: opts.goalAgentApi
    });
  }
  // followup_* (create/list/resolve): let the agent park questions / decisions
  // for the human in its OWN project instead of blocking. Session-scoped — the
  // projectId from the route locks the scope and the sessionId is host-stamped as
  // provenance. Gated on the FollowUpManager slice being wired.
  if (opts.sessionId && opts.followupAgentApi) {
    registerFollowUpTools(mcp, {
      projectId: opts.projectId,
      sessionId: opts.sessionId,
      followupAgentApi: opts.followupAgentApi
    });
  }
  return mcp;
}

/**
 * `decodeURIComponent` throws a `URIError` on malformed percent-encoding
 * (e.g. `%FF`, a lone `%`). The route matchers below decode captured path
 * segments, so a hostile/buggy client could otherwise crash the request
 * handler with an uncaught exception (a cheap DoS). Decode defensively:
 * return `null` on malformed input so the matcher treats the route as
 * unmatched (404) rather than throwing.
 */
function safeDecode(seg: string): string | null {
  try {
    return decodeURIComponent(seg);
  } catch {
    return null;
  }
}

/**
 * Match `/mcp/:projectId` or `/mcp/:projectId/:sessionId`. Strict: any
 * other shape 404s. Returns null when no match. Exported for unit tests.
 */
export function matchMcpRoute(
  rawUrl: string | undefined
): { projectId: string; sessionId?: string; sessionCredential?: string } | null {
  if (!rawUrl) return null;
  let pathname: string;
  try {
    pathname = new URL(rawUrl, 'http://127.0.0.1').pathname;
  } catch {
    return null;
  }
  const m = /^\/mcp\/([^/]+)(?:\/([^/]+)(?:\/([^/]+))?)?$/.exec(pathname);
  if (!m) return null;
  const projectId = safeDecode(m[1]);
  const sessionId = m[2] ? safeDecode(m[2]) : undefined;
  const sessionCredential = m[3] ? safeDecode(m[3]) : undefined;
  if (projectId === null || sessionId === null || sessionCredential === null) return null;
  return {
    projectId,
    ...(sessionId ? { sessionId } : {}),
    ...(sessionCredential ? { sessionCredential } : {})
  };
}

/**
 * Match `/hook/stop/:projectId/:sessionId` — the auto-close Stop-hook
 * callback. Both ids are required (we always close a specific session).
 * Exported for unit tests.
 */
function matchStopHookRoute(
  rawUrl: string | undefined
): { projectId: string; sessionId: string } | null {
  if (!rawUrl) return null;
  let pathname: string;
  try {
    pathname = new URL(rawUrl, 'http://127.0.0.1').pathname;
  } catch {
    return null;
  }
  const m = /^\/hook\/stop\/([^/]+)\/([^/]+)$/.exec(pathname);
  if (!m) return null;
  const projectId = safeDecode(m[1]);
  const sessionId = safeDecode(m[2]);
  if (projectId === null || sessionId === null) return null;
  return { projectId, sessionId };
}

/**
 * Match `/hook/notify/:projectId/:sessionId/:action` where action is
 * `blocked` or `unblocked` — the live-status callback. Exported for unit tests.
 */
export function matchNotifyHookRoute(
  rawUrl: string | undefined
): { projectId: string; sessionId: string; action: 'blocked' | 'unblocked' } | null {
  if (!rawUrl) return null;
  let pathname: string;
  try {
    pathname = new URL(rawUrl, 'http://127.0.0.1').pathname;
  } catch {
    return null;
  }
  const m = /^\/hook\/notify\/([^/]+)\/([^/]+)\/(blocked|unblocked)$/.exec(pathname);
  if (!m) return null;
  const projectId = safeDecode(m[1]);
  const sessionId = safeDecode(m[2]);
  if (projectId === null || sessionId === null) return null;
  return {
    projectId,
    sessionId,
    action: m[3] as 'blocked' | 'unblocked'
  };
}

/**
 * Match `/hook/overseer/:projectId/:sessionId` — the SYNCHRONOUS PreToolUse
 * auto-approval callback (experimental). Unlike the other hook routes this one
 * reads the event body and answers with a permission decision the agent waits
 * on. Exported for unit tests.
 */
export function matchOverseerHookRoute(
  rawUrl: string | undefined
): { projectId: string; sessionId: string } | null {
  if (!rawUrl) return null;
  let pathname: string;
  try {
    pathname = new URL(rawUrl, 'http://127.0.0.1').pathname;
  } catch {
    return null;
  }
  const m = /^\/hook\/overseer\/([^/]+)\/([^/]+)$/.exec(pathname);
  if (!m) return null;
  const projectId = safeDecode(m[1]);
  const sessionId = safeDecode(m[2]);
  if (projectId === null || sessionId === null) return null;
  return { projectId, sessionId };
}

/**
 * Match `/hook/contentscreen/:projectId/:sessionId` — the SYNCHRONOUS
 * PostToolUse content-screen callback (experimental, inbound prompt-injection
 * defense). Like the overseer route this one reads the event body and blocks
 * the agent on the reply, but the event is a POST-tool result rather than a
 * pre-tool call. Exported for unit tests.
 */
export function matchContentScreenHookRoute(
  rawUrl: string | undefined
): { projectId: string; sessionId: string } | null {
  if (!rawUrl) return null;
  let pathname: string;
  try {
    pathname = new URL(rawUrl, 'http://127.0.0.1').pathname;
  } catch {
    return null;
  }
  const m = /^\/hook\/contentscreen\/([^/]+)\/([^/]+)$/.exec(pathname);
  if (!m) return null;
  const projectId = safeDecode(m[1]);
  const sessionId = safeDecode(m[2]);
  if (projectId === null || sessionId === null) return null;
  return { projectId, sessionId };
}


/**
 * Match `/hook/subagent/:projectId/:sessionId/:action` where action is `start`
 * or `stop` — the sub-agent (Task tool) live-count callback. Exported for unit
 * tests.
 */
export function matchSubagentHookRoute(
  rawUrl: string | undefined
): { projectId: string; sessionId: string; action: 'start' | 'stop' } | null {
  if (!rawUrl) return null;
  let pathname: string;
  try {
    pathname = new URL(rawUrl, 'http://127.0.0.1').pathname;
  } catch {
    return null;
  }
  const m = /^\/hook\/subagent\/([^/]+)\/([^/]+)\/(start|stop)$/.exec(pathname);
  if (!m) return null;
  const projectId = safeDecode(m[1]);
  const sessionId = safeDecode(m[2]);
  if (projectId === null || sessionId === null) return null;
  return {
    projectId,
    sessionId,
    action: m[3] as 'start' | 'stop'
  };
}

/**
 * Match `/hook/toolactivity/:projectId/:sessionId/:action` where action is
 * `start` (PreToolUse, match-all), `stop` (PostToolUse, match-all), or `clear`
 * (Stop — drift-guard reset) — the generic tool-in-flight idle-veto callback
 * (see `AgentStatusTracker.toolStarted`). Exported for unit tests.
 */
export function matchToolActivityHookRoute(
  rawUrl: string | undefined
): { projectId: string; sessionId: string; action: 'start' | 'stop' | 'clear' } | null {
  if (!rawUrl) return null;
  let pathname: string;
  try {
    pathname = new URL(rawUrl, 'http://127.0.0.1').pathname;
  } catch {
    return null;
  }
  const m = /^\/hook\/toolactivity\/([^/]+)\/([^/]+)\/(start|stop|clear)$/.exec(pathname);
  if (!m) return null;
  const projectId = safeDecode(m[1]);
  const sessionId = safeDecode(m[2]);
  if (projectId === null || sessionId === null) return null;
  return {
    projectId,
    sessionId,
    action: m[3] as 'start' | 'stop' | 'clear'
  };
}

/**
 * Match `/hook/firstprompt/:projectId/:sessionId` — the UserPromptSubmit
 * callback that forwards the prompt text (for auto-naming the tab). Both ids
 * required. Exported for unit tests.
 */

export function matchFirstPromptHookRoute(
  rawUrl: string | undefined
): { projectId: string; sessionId: string } | null {
  if (!rawUrl) return null;
  let pathname: string;
  try {
    pathname = new URL(rawUrl, 'http://127.0.0.1').pathname;
  } catch {
    return null;
  }
  const m = /^\/hook\/firstprompt\/([^/]+)\/([^/]+)$/.exec(pathname);
  if (!m) return null;
  const projectId = safeDecode(m[1]);
  const sessionId = safeDecode(m[2]);
  if (projectId === null || sessionId === null) return null;
  return { projectId, sessionId };
}

/**
 * Match `/hook/question/:projectId/:sessionId` — the EXPERIMENTAL PreToolUse
 * callback that forwards the `AskUserQuestion` tool-call JSON so the app can
 * render the question in its own Questions component. Follows the firstprompt
 * route exactly (forwards the body); both ids required. Exported for unit tests.
 */
export function matchQuestionHookRoute(
  rawUrl: string | undefined
): { projectId: string; sessionId: string } | null {
  if (!rawUrl) return null;
  let pathname: string;
  try {
    pathname = new URL(rawUrl, 'http://127.0.0.1').pathname;
  } catch {
    return null;
  }
  const m = /^\/hook\/question\/([^/]+)\/([^/]+)$/.exec(pathname);
  if (!m) return null;
  const projectId = safeDecode(m[1]);
  const sessionId = safeDecode(m[2]);
  if (projectId === null || sessionId === null) return null;
  return { projectId, sessionId };
}

/**
 * Pull the user's prompt out of a Claude UserPromptSubmit hook payload. The
 * hook posts the event JSON on stdin, which carries a `prompt` field. Caps the
 * input so a pathological prompt can't be forwarded wholesale to an LLM. Pure.
 *
 * Fallback policy: the raw body is only used when the payload isn't JSON at all
 * (parse threw) — a defensive escape hatch for a hook that posts plain text.
 * When the body parses as JSON but has no string `prompt` (an unexpected event
 * shape), we return '' rather than forwarding the whole event blob
 * (`session_id`, `cwd`, …) to the model, which would produce a garbage label.
 */
export function extractPromptFromHookBody(body: string): string {
  const MAX = 8_000;
  const trimmed = body.trim();
  if (!trimmed) return '';
  try {
    const parsed = JSON.parse(trimmed) as { prompt?: unknown };
    // Parsed as JSON: the prompt field is authoritative. Absent/non-string →
    // unexpected shape; return '' instead of leaking the raw event JSON.
    return parsed && typeof parsed.prompt === 'string'
      ? parsed.prompt.trim().slice(0, MAX)
      : '';
  } catch {
    // Not JSON at all — treat the raw body as the prompt.
    return trimmed.slice(0, MAX);
  }
}

/**
 * Pull a Task sub-agent's identity (`description` + `subagent_type`) out of a
 * PreToolUse(Task) hook payload. The hook POSTs the event JSON on stdin, whose
 * `tool_input` carries the two fields we surface as the child node's label/type.
 * Pure. Best-effort: any parse failure or unexpected shape returns `{}` — the
 * sub-agent COUNT still increments upstream regardless, so identity loss never
 * drifts the count (it only falls the UI back to the count badge). Fields are
 * length-capped so a pathological payload can't bloat the per-session store.
 */
export function extractSubagentIdentity(body: string): {
  description?: string;
  subagentType?: string;
} {
  const MAX_FIELD = 2_000;
  const trimmed = body.trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed) as {
      tool_input?: { description?: unknown; subagent_type?: unknown };
    };
    const ti = parsed?.tool_input ?? {};
    const description =
      typeof ti.description === 'string' ? ti.description.trim().slice(0, MAX_FIELD) : undefined;
    const subagentType =
      typeof ti.subagent_type === 'string' ? ti.subagent_type.trim().slice(0, MAX_FIELD) : undefined;
    const out: { description?: string; subagentType?: string } = {};
    if (description) out.description = description;
    if (subagentType) out.subagentType = subagentType;
    return out;
  } catch {
    return {};
  }
}

export async function startMcpServer(opts: McpServerOptions): Promise<McpServerHandle> {
  const log = opts.log ?? ((m) => console.log(m));

  const httpServer: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handleRequest(req, res, opts, log);
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(opts.port ?? 0, '127.0.0.1', () => {
      httpServer.off('error', reject);
      resolve();
    });
  });

  const addr = httpServer.address() as AddressInfo;
  const url = `http://127.0.0.1:${addr.port}`;
  log(`[mcp] listening on ${url}/mcp/:projectId`);

  return {
    url,
    port: addr.port,
    async close() {
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
        // closeAllConnections is Node 18.2+; safe to call optionally so
        // dangling SSE streams don't keep the listener alive on quit.
        const anyServer = httpServer as unknown as { closeAllConnections?: () => void };
        anyServer.closeAllConnections?.();
      });
    }
  };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: McpServerOptions,
  log: (msg: string) => void
) {
  // Stop-hook callback (auto-close). Fire-and-forget: drain the body, invoke
  // the handler, and always 200 so the agent's hook never blocks on us.
  const stopRoute = matchStopHookRoute(req.url);
  if (stopRoute) {
    req.resume(); // drain any POST body so the socket can close cleanly
    try {
      opts.onStopHook?.(stopRoute.projectId, stopRoute.sessionId);
    } catch (err) {
      log(`[mcp] stop-hook handler failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    res.statusCode = 200;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end('ok');
    return;
  }

  // Notification / UserPromptSubmit callback. Fire-and-forget, same contract
  // as the stop-hook route: drain the body, invoke the handler, always 200.
  const notifyRoute = matchNotifyHookRoute(req.url);
  if (notifyRoute) {
    req.resume();
    try {
      opts.onNotifyHook?.(notifyRoute.projectId, notifyRoute.sessionId, notifyRoute.action);
    } catch (err) {
      log(`[mcp] notify-hook handler failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    res.statusCode = 200;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end('ok');
    return;
  }

  // Generic tool-activity (idle-veto) callback. Fire-and-forget, same contract
  // as the notify-hook route: drain the body (start/stop/clear all discard the
  // event JSON — only the boundary matters, not the tool identity), invoke the
  // handler, always 200.
  const toolActivityRoute = matchToolActivityHookRoute(req.url);
  if (toolActivityRoute) {
    req.resume();
    try {
      opts.onToolActivityHook?.(
        toolActivityRoute.projectId,
        toolActivityRoute.sessionId,
        toolActivityRoute.action
      );
    } catch (err) {
      log(
        `[mcp] toolactivity-hook handler failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    res.statusCode = 200;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end('ok');
    return;
  }

  // Overseer auto-approval callback (experimental). SYNCHRONOUS: the agent's
  // PreToolUse hook blocks on our reply, so we read the event body, ask the
  // handler for a decision, and serialize it to the JSON shape Claude Code
  // parses from a PreToolUse hook's stdout. Fail-open at every turn — any error,
  // timeout, missing handler, or null decision yields a 200 with an EMPTY body,
  // which the hook treats as "no opinion" and falls back to the normal prompt.
  const overseerRoute = matchOverseerHookRoute(req.url);
  if (overseerRoute) {
    if (req.method !== 'POST') {
      req.resume();
      res.statusCode = 405;
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.end('method not allowed');
      return;
    }
    const chunks: Buffer[] = [];
    let total = 0;
    let done = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const CAP = 256 * 1024; // tool inputs (e.g. a big Write) can be sizeable
    // Answer with an empty body — the universal fail-open. The hook reads no
    // JSON and defers to the normal prompt. Clears the guard timer on every
    // exit path so a fired-and-forgotten timer can't linger after we've replied.
    const answerEmpty = () => {
      if (done) return;
      done = true;
      if (timeout) clearTimeout(timeout);
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end('');
    };
    // Slow-loris / hung-handler guard. Bound the WHOLE exchange so a stuck
    // decision (e.g. an LLM tier that never returns) can't pin the agent: we
    // give up and let it prompt normally. Shorter than the hook's own timeout.
    const decisionTimeoutMs =
      typeof opts.overseerDecisionTimeoutMs === 'function'
        ? opts.overseerDecisionTimeoutMs()
        : opts.overseerDecisionTimeoutMs ?? 8_000;
    timeout = setTimeout(answerEmpty, decisionTimeoutMs);
    const finish = async (body: string) => {
      if (done) return;
      // NB: do NOT clear `timeout` here. The decision below (the LLM tier) is
      // awaited, and clearing the guard before that await would leave the await
      // unbounded — defeating the 8s ceiling this timer exists to enforce. Let
      // it keep running: it races answerEmpty() against this handler, and the
      // `done` flag ensures only the winner replies. We clear it only once we
      // hold a decision and have won the race (below).
      try {
        const decision = opts.onOverseerHook
          ? await opts.onOverseerHook(overseerRoute.projectId, overseerRoute.sessionId, body)
          : null;
        if (done) return; // the timeout fired during the await → already answered
        if (!decision) {
          answerEmpty();
          return;
        }
        done = true;
        clearTimeout(timeout);
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(
          JSON.stringify({
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              permissionDecision: decision.decision,
              permissionDecisionReason: decision.reason
            }
          })
        );
      } catch (err) {
        log(
          `[mcp] overseer-hook handler failed: ${err instanceof Error ? err.message : String(err)}`
        );
        answerEmpty();
      }
    };
    req.on('data', (c: Buffer) => {
      if (done) return;
      total += c.length;
      if (total <= CAP) {
        chunks.push(c);
      } else {
        req.destroy();
        answerEmpty();
      }
    });
    req.on('end', () => void finish(Buffer.concat(chunks).toString('utf8')));
    req.on('error', answerEmpty);
    return;
  }

  // Content Screen callback (experimental, inbound prompt-injection defense).
  // SYNCHRONOUS like the overseer route, but on PostToolUse (a tool's RESULT,
  // not its call): the agent blocks on our reply, so we read the event body,
  // ask the handler whether the result looks like an embedded instruction, and
  // serialize its answer to the JSON shape Claude Code parses from a
  // PostToolUse hook's stdout. Fail-open at every turn — any error, timeout,
  // missing handler, or null decision yields a 200 with an EMPTY body, which
  // the hook treats as "no opinion" and the tool result reaches the agent
  // completely unmodified.
  const contentScreenRoute = matchContentScreenHookRoute(req.url);
  if (contentScreenRoute) {
    if (req.method !== 'POST') {
      req.resume();
      res.statusCode = 405;
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.end('method not allowed');
      return;
    }
    const chunks: Buffer[] = [];
    let total = 0;
    let done = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const CAP = 256 * 1024; // a fetched page / command output can be sizeable
    const answerEmpty = () => {
      if (done) return;
      done = true;
      if (timeout) clearTimeout(timeout);
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end('');
    };
    // Slow-loris / hung-handler guard, same rationale as the overseer route's.
    const decisionTimeoutMs =
      typeof opts.contentScreenDecisionTimeoutMs === 'function'
        ? opts.contentScreenDecisionTimeoutMs()
        : opts.contentScreenDecisionTimeoutMs ?? 8_000;
    timeout = setTimeout(answerEmpty, decisionTimeoutMs);
    const finish = async (body: string) => {
      if (done) return;
      // NB: do NOT clear `timeout` here — see the overseer route's identical
      // note; the classifier call below is awaited under the same guard.
      try {
        const decision = opts.onContentScreenHook
          ? await opts.onContentScreenHook(contentScreenRoute.projectId, contentScreenRoute.sessionId, body)
          : null;
        if (done) return; // the timeout fired during the await → already answered
        if (!decision) {
          answerEmpty();
          return;
        }
        done = true;
        clearTimeout(timeout);
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(
          JSON.stringify({
            hookSpecificOutput: {
              hookEventName: 'PostToolUse',
              additionalContext: decision.additionalContext
            }
          })
        );
      } catch (err) {
        log(
          `[mcp] content-screen-hook handler failed: ${err instanceof Error ? err.message : String(err)}`
        );
        answerEmpty();
      }
    };
    req.on('data', (c: Buffer) => {
      if (done) return;
      total += c.length;
      if (total <= CAP) {
        chunks.push(c);
      } else {
        req.destroy();
        answerEmpty();
      }
    });
    req.on('end', () => void finish(Buffer.concat(chunks).toString('utf8')));
    req.on('error', answerEmpty);
    return;
  }

  // Sub-agent (Task tool) start/stop callback. Fire-and-forget, always 200.
  //  - `stop` (SubagentStop) carries no useful tool_input → don't read the body;
  //    cheap `req.resume()`, same as before.
  //  - `start` (PreToolUse Task) carries the tool_input we parse for the child's
  //    name/type → bounded body read (the firstprompt-route model: 64 KB cap,
  //    5 s slow-loris timeout, always 200). Identity is best-effort; a lost
  //    payload still fires the handler (count parity) with no identity.
  const subagentRoute = matchSubagentHookRoute(req.url);
  if (subagentRoute) {
    const fire = (identity?: { description?: string; subagentType?: string }) => {
      try {
        opts.onSubagentHook?.(
          subagentRoute.projectId,
          subagentRoute.sessionId,
          subagentRoute.action,
          identity
        );
      } catch (err) {
        log(
          `[mcp] subagent-hook handler failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    };

    if (subagentRoute.action !== 'start' || req.method !== 'POST') {
      // No body to read (stop, or a stray non-POST) — fire immediately.
      req.resume();
      fire();
      res.statusCode = 200;
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.end('ok');
      return;
    }

    const chunks: Buffer[] = [];
    let total = 0;
    let done = false;
    const CAP = 64 * 1024;
    const timeout = setTimeout(() => {
      if (done) return;
      done = true;
      req.destroy();
      fire(); // payload never arrived — count still increments, no identity
      res.statusCode = 200;
      res.end('ok');
    }, 5_000);
    const finish = (body: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      fire(body !== null ? extractSubagentIdentity(body) : undefined);
      res.statusCode = 200;
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.end('ok');
    };
    req.on('data', (c: Buffer) => {
      if (done) return;
      total += c.length;
      if (total <= CAP) {
        chunks.push(c);
      } else {
        req.destroy();
        finish(null);
      }
    });
    req.on('end', () => finish(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => finish(null));
    return;
  }

  // First-prompt callback. Unlike the other hook routes we DO read the body —
  // it carries the user's prompt text we forward to the tab-namer. Cap the read
  // so a huge paste can't balloon memory; still always 200, fire-and-forget.
  const firstPromptRoute = matchFirstPromptHookRoute(req.url);
  if (firstPromptRoute) {
    // The hook only ever POSTs. Reject anything else cheaply so a stray GET (or
    // a local probe) can't make us hold a body-read open. 405, no body read.
    if (req.method !== 'POST') {
      req.resume();
      res.statusCode = 405;
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.end('method not allowed');
      return;
    }
    const chunks: Buffer[] = [];
    let total = 0;
    let done = false;
    const CAP = 64 * 1024;
    // Slow-loris guard: a local client that opens the connection and dribbles
    // (or never sends `end`) would otherwise pin this handler. Bound the whole
    // read to a few seconds, then close the socket.
    const timeout = setTimeout(() => {
      if (done) return;
      done = true;
      req.destroy();
      res.statusCode = 200;
      res.end('ok');
    }, 5_000);
    const finish = (body: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      try {
        if (body !== null) {
          const text = extractPromptFromHookBody(body);
          if (text) {
            opts.onFirstPromptHook?.(
              firstPromptRoute.projectId,
              firstPromptRoute.sessionId,
              text
            );
          }
        }
      } catch (err) {
        log(
          `[mcp] firstprompt-hook handler failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      res.statusCode = 200;
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.end('ok');
    };
    req.on('data', (c: Buffer) => {
      if (done) return;
      total += c.length;
      if (total <= CAP) {
        chunks.push(c);
      } else {
        // Over the cap — stop reading and close rather than buffer more.
        req.destroy();
        finish(null);
      }
    });
    req.on('end', () => finish(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => finish(null));
    return;
  }

  // Question callback (EXPERIMENTAL). Like firstprompt we DO read the body — it
  // carries the `AskUserQuestion` tool-call JSON we forward to the inbox. Same
  // cap + slow-loris timeout; always 200, fire-and-forget, fail-open (a failure
  // here must never block the agent — the terminal question stays live).
  const questionRoute = matchQuestionHookRoute(req.url);
  if (questionRoute) {
    // The hook only ever POSTs. Reject anything else cheaply so a stray GET (or
    // a local probe) can't make us hold a body-read open. 405, no body read.
    if (req.method !== 'POST') {
      req.resume();
      res.statusCode = 405;
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.end('method not allowed');
      return;
    }
    const chunks: Buffer[] = [];
    let total = 0;
    let done = false;
    const CAP = 64 * 1024;
    const timeout = setTimeout(() => {
      if (done) return;
      done = true;
      req.destroy();
      res.statusCode = 200;
      res.end('ok');
    }, 5_000);
    const finish = (body: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      try {
        // Defense-in-depth: no-op on an empty body (nothing to forward).
        if (body) {
          opts.onQuestionHook?.(
            questionRoute.projectId,
            questionRoute.sessionId,
            body
          );
        }
      } catch (err) {
        log(
          `[mcp] question-hook handler failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      res.statusCode = 200;
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.end('ok');
    };
    req.on('data', (c: Buffer) => {
      if (done) return;
      total += c.length;
      if (total <= CAP) {
        chunks.push(c);
      } else {
        // Over the cap — stop reading and close rather than buffer more.
        req.destroy();
        finish(null);
      }
    });
    req.on('end', () => finish(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => finish(null));
    return;
  }

  const route = matchMcpRoute(req.url);
  if (!route) {
    res.statusCode = 404;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end('not found');
    return;
  }
  const { projectId, sessionId } = route;

  // Look up the label at request time — a recently renamed project
  // gets its current label snapshotted into the inbox entry.
  const project = opts.projects.get(projectId);
  const projectLabel = project?.name ?? project?.tag;

  // Stateless mode: per-request transport, no session id retention. A
  // long-lived session would pin the projectId-from-URL identity to the
  // first request and let later requests forge through reuse.
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined
  });

  const mcp = buildProjectMcpServer({
    projectId,
    projectLabel,
    projectRoot: project?.path,
    sessionId,
    sessionCredential: route.sessionCredential,
    inboxStore: opts.inboxStore,
    heldQuestions: opts.heldQuestions,
    suggestionsStore: opts.suggestionsStore,
    onReport: opts.onReport,
    resolveScheduledLevel: opts.resolveScheduledLevel,
    resolveOrigin: opts.resolveOrigin,
    registerProject: opts.registerProject,
    cloneProject: opts.cloneProject,
    createLocalExtension: opts.createLocalExtension,
    agentRegistry: opts.agentRegistry,
    getSessionCwd: opts.getSessionCwd,
    getAgentStatus: opts.getAgentStatus,
    getTeamLaunchId: opts.getTeamLaunchId,
    agentMessageLog: opts.agentMessageLog,
    injectToSession: opts.injectToSession,
    closeSession: opts.closeSession,
    installOwnExtension: opts.installOwnExtension,
    completeAutonomousRun: opts.completeAutonomousRun,
    findIdleAgents: opts.findIdleAgents,
    summarizeAndCloseProject: opts.summarizeAndCloseProject,
    listPersonas: opts.listPersonas,
    listTeams: opts.listTeams,
    launchTeam: opts.launchTeam,
    authorizeTeamLaunch: opts.authorizeTeamLaunch,
    cancelTeamLaunch: opts.cancelTeamLaunch,
    getTeamLaunch: opts.getTeamLaunch,
    reportTeamTask: opts.reportTeamTask,
    validateTeamRouteIdentity: opts.validateTeamRouteIdentity,
    listProjects: opts.listProjects,
    runRemoteCommand: opts.runRemoteCommand,
    remoteFs: opts.remoteFs,
    runMicrovmCommand: opts.runMicrovmCommand,
    resetMicrovm: opts.resetMicrovm,
    libraryAgentApi: opts.libraryAgentApi,
    goalAgentApi: opts.goalAgentApi,
    followupAgentApi: opts.followupAgentApi,
    previewFile: opts.previewFile
  });

  // Ensure transport + mcp tear down once the response finishes, even on
  // client disconnect. Without this, a flapping client could leak
  // listeners across hot-reloads in dev.
  const cleanup = async () => {
    try {
      await transport.close();
    } catch {
      /* already closing */
    }
    try {
      await mcp.close();
    } catch {
      /* already closed */
    }
  };
  res.on('close', () => {
    void cleanup();
  });

  try {
    await mcp.connect(transport);
    await transport.handleRequest(req, res);
  } catch (err) {
    const message = err instanceof Error ? err.stack || err.message : String(err);
    log(`[mcp] request failed for ${projectId}: ${message}`);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.end('mcp request failed');
    } else {
      try {
        res.end();
      } catch {
        /* socket gone */
      }
    }
    await cleanup();
  }
}
