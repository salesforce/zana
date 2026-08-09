/**
 * Harness ACTION protocol — the harness-agnostic vocabulary of things an agent
 * turn can ask the host to do, and what each returns.
 *
 * This is the seam's request/response contract, distinct from the EVENT stream
 * (the host's internal event protocol in shared/types.ts, which is what the agent
 * EMITS as it works). An `AgentAction` is what the agent wants EXECUTED — a
 * read, a grep, a command, an MCP call. In the CLI harness these are executed
 * inside the `claude` subprocess and never surface here; the native harness
 * (PR3+) routes every action through `HarnessAuthz` + the broker-gated executor
 * BEFORE running it. PR1 only defines the shapes + an exhaustive-match guard;
 * no executor consumes them yet.
 *
 * Every action is a discriminated union on `kind`. Keep this list aligned with
 * the MVP tool catalog (PR3 `catalog.ts`): `read_file`/`grep`/`glob`/`mcp_call`/
 * `run_command` are the read-only MVP-5; `writeFile`/`editFiles` are defined
 * here but gated hard behind the writes decision (Step 9). `spawnChild` and
 * `askUser` round out the delegation + interaction verbs.
 */

/** Discriminant literals for {@link AgentAction}. One per action verb. */
export type AgentActionKind =
  | 'exec'
  | 'readFiles'
  | 'writeFile'
  | 'editFiles'
  | 'grep'
  | 'glob'
  | 'mcpCall'
  | 'readMcpResource'
  | 'spawnChild'
  | 'askUser';

/** Run a shell command. Native routes through the denylist + approval gate. */
export interface ExecAction {
  kind: 'exec';
  /** The command line as the agent proposed it (pre-gate, unsplit). */
  command: string;
  /** Working directory hint (advisory — the host re-confines to a project root). */
  cwd?: string;
  /** Wall-clock timeout in ms (host clamps to its own ceiling). */
  timeoutMs?: number;
}

/** Read one or more files. Read-only; auto-allowed by default in native. */
export interface ReadFilesAction {
  kind: 'readFiles';
  /** Absolute or project-relative paths (host re-confines each — Rule 2). */
  paths: string[];
}

/** Write a whole file (create/overwrite). Gated hard behind the writes decision. */
export interface WriteFileAction {
  kind: 'writeFile';
  path: string;
  content: string;
}

/** Apply one or more edits to existing files. Gated hard behind the writes decision. */
export interface EditFilesAction {
  kind: 'editFiles';
  edits: Array<{ path: string; oldText: string; newText: string }>;
}

/** Content search (ripgrep-shaped). Read-only. */
export interface GrepAction {
  kind: 'grep';
  pattern: string;
  /** Path/glob to scope the search (advisory — host re-confines). */
  path?: string;
  /** Passed through to the searcher (e.g. `-i`, `-n`) — host sanitizes. */
  flags?: string[];
}

/** Filename search (fd/glob-shaped). Read-only. */
export interface GlobAction {
  kind: 'glob';
  pattern: string;
  path?: string;
}

/** Call an MCP tool over the brokered pool (namespaced `server__tool`). */
export interface McpCallAction {
  kind: 'mcpCall';
  /** Namespaced tool id, e.g. `zana__zana_spawn_agent`, `zcc-inbox__inbox_push`. */
  tool: string;
  /** JSON args for the tool (host validates against the tool schema). */
  args: Record<string, unknown>;
}

/** Read an MCP resource (`resources/read`) over the brokered pool. */
export interface ReadMcpResourceAction {
  kind: 'readMcpResource';
  server: string;
  uri: string;
}

/** Delegate to a child agent (wired to the orchestrator when that work lands). */
export interface SpawnChildAction {
  kind: 'spawnChild';
  /** Free-text task for the child. */
  prompt: string;
  /** Optional persona / profile hint (host authorizes). */
  profile?: string;
  /** Optional project scope hint (host re-confines — Rule 1/2). */
  projectId?: string;
}

/** Ask the user a question and block the turn on their answer. */
export interface AskUserAction {
  kind: 'askUser';
  question: string;
  /** Optional lettered choices; free-text when omitted. */
  options?: string[];
}

/**
 * The full request vocabulary. A native turn emits these; the host gates +
 * executes each and replies with the matching {@link AgentActionResult}.
 */
export type AgentAction =
  | ExecAction
  | ReadFilesAction
  | WriteFileAction
  | EditFilesAction
  | GrepAction
  | GlobAction
  | McpCallAction
  | ReadMcpResourceAction
  | SpawnChildAction
  | AskUserAction;

/**
 * The result of executing an {@link AgentAction}. A uniform envelope so the loop
 * can feed tool results back to the model without a per-kind branch: `ok`
 * signals success, `output` is the (string) payload fed back to the model, and
 * `error` carries a short message when `ok` is false. `denied` marks the action
 * as rejected by the gate (vs. failed while running) so the loop can surface it
 * distinctly.
 */
export interface AgentActionResult {
  /** Echo of the action kind this result answers. */
  kind: AgentActionKind;
  ok: boolean;
  /** Model-facing payload (tool output / read content / command stdout). */
  output?: string;
  /** Short human/error message when `ok` is false. */
  error?: string;
  /** true when refused by the authz gate rather than failing during execution. */
  denied?: boolean;
}

/**
 * Exhaustive-match helper. Switch over `action.kind` and pass the fall-through
 * `default` case here — a compile error surfaces the moment a new
 * {@link AgentActionKind} is added without a handler. Throws at runtime as a
 * defensive backstop (should be unreachable when the switch is exhaustive).
 */
export function assertNeverAction(action: never): never {
  throw new Error(
    `Unhandled AgentAction kind: ${(action as { kind?: string })?.kind ?? String(action)}`
  );
}
