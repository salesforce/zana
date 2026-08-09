/**
 * Pure CLI runner — returns a result object, never calls process.exit or
 * writes to console directly. Makes it testable with golden files.
 */

import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Project, Persona, PersonaSummary, ScheduledTask, InboxEntry } from './types.js';

/**
 * The default data dir, preferring the post-rebrand `~/.zcc`. If that does not
 * yet exist but a legacy `~/.cc-center` does (the desktop app hasn't run its
 * migration since the rename), read the legacy dir so the CLI doesn't silently
 * report an empty store. The app's one-time migrate-data-dir.ts renames the
 * legacy dir on next launch, after which `~/.zcc` wins.
 */
function defaultDataDir(): string {
  const next = join(homedir(), '.zcc');
  const legacy = join(homedir(), '.cc-center');
  if (!existsSync(next) && existsSync(legacy)) return legacy;
  return next;
}
import {
  readProjects,
  readPersonas,
  readSchedules,
  readInbox,
  readFollowUps
} from './store-readers.js';
import { callControlPlane, isAppRunning } from './control-client.js';

export interface CliDeps {
  dataDir: string;
}

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr?: string;
}

const VERSION = '0.1.0';

/**
 * Pull `--data-dir <path>` (or `--data-dir=<path>`) out of the arg list,
 * returning the resolved value (if any) and the remaining args with the flag
 * and its value removed. Pure — no env / fs access. Last occurrence wins.
 *
 * A value-less `--data-dir` (trailing, or immediately followed by another
 * `--flag`) is a usage error rather than a silent fallback: returns an `error`
 * string the caller maps to exit 2. The `--data-dir=` equals-form with an empty
 * value is likewise an error.
 */
function extractDataDir(args: string[]): { dataDir?: string; rest: string[]; error?: string } {
  const rest: string[] = [];
  let dataDir: string | undefined;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--data-dir') {
      // value is the next token (if present and not another flag)
      const next = args[i + 1];
      if (next === undefined || next.startsWith('--')) {
        return { rest, error: '--data-dir requires a path' };
      }
      dataDir = next;
      i += 1;
      continue;
    }
    if (a.startsWith('--data-dir=')) {
      const v = a.slice('--data-dir='.length);
      if (v === '') {
        return { rest, error: '--data-dir requires a path' };
      }
      dataDir = v;
      continue;
    }
    rest.push(a);
  }
  return { dataDir, rest };
}

export async function runCli(argv: string[], deps?: Partial<CliDeps>): Promise<CliResult> {
  const args = argv.slice(2); // Strip 'node' and script path

  // Split at the FIRST bare `--` at the top level, BEFORE any global-flag
  // handling. Everything from the `--` onward is the literal prompt tail and
  // must NEVER be scanned for global flags (--data-dir / --json / --help /
  // --version). Tokens before `--` keep normal global-flag handling. We keep
  // the `--` + tail intact and re-append them to the command args so that
  // runCommand's own `rest.indexOf('--')` logic still fires (no double-consume).
  const sentinelIdx = args.indexOf('--');
  const head = sentinelIdx === -1 ? args : args.slice(0, sentinelIdx);
  const tailWithSentinel = sentinelIdx === -1 ? [] : args.slice(sentinelIdx); // includes the `--`

  // Resolve the `--data-dir <path>` flag (and its `--data-dir=<path>` form)
  // out of the head so it doesn't get parsed as a positional. Precedence:
  // injected deps.dataDir → --data-dir flag → ZCC_CENTER_DIR env → default ~/.zcc.
  const extracted = extractDataDir(head);
  if (extracted.error) {
    return errResult(extracted.error, 2);
  }
  const flagDataDir = extracted.dataDir;
  const argsNoData = extracted.rest;
  const dataDir = deps?.dataDir ||
                  flagDataDir ||
                  process.env.ZCC_CENTER_DIR ||
                  defaultDataDir();

  if (argsNoData.length === 0 || argsNoData.includes('--help') || argsNoData.includes('-h')) {
    return help();
  }

  if (argsNoData.includes('--version') || argsNoData.includes('-v')) {
    return { exitCode: 0, stdout: `zcc version ${VERSION}\n` };
  }

  const jsonOutput = argsNoData.includes('--json');
  // Strip `--json` from the head only; the literal tail (after `--`) is
  // preserved verbatim, then re-appended so command dispatch sees `-- tail`.
  const filteredArgs = [...argsNoData.filter(a => a !== '--json'), ...tailWithSentinel];

  const [command, subcommand, ...rest] = filteredArgs;

  try {
    // ---- File-backed reads (work whether the app is up or down) ----
    if (command === 'projects' && subcommand === 'ls') {
      return await projectsList(dataDir, jsonOutput);
    } else if (command === 'personas' && subcommand === 'ls') {
      return await personasList(dataDir, jsonOutput);
    } else if (command === 'schedule' && subcommand === 'ls') {
      return await scheduleList(dataDir, jsonOutput);
    } else if (command === 'inbox' && subcommand === 'ls') {
      return await inboxList(dataDir, rest, jsonOutput);
    } else if (command === 'inbox' && subcommand === 'show') {
      const id = rest[0];
      if (!id) {
        return errResult('inbox show requires an entry id', 2);
      }
      return await inboxShow(dataDir, id, jsonOutput);
    } else if (command === 'followup' && subcommand === 'ls') {
      return await followupList(dataDir, rest, jsonOutput);
    }

    // ---- Live commands (require the running app's control plane) ----
    else if (command === 'status') {
      return await statusDashboard(dataDir, jsonOutput);
    } else if (command === 'agent' && subcommand === 'ls') {
      return await live(dataDir, 'agent.list', {}, jsonOutput);
    } else if (command === 'team' && subcommand === 'ls') {
      return await live(dataDir, 'team.list', {}, jsonOutput);
    } else if (command === 'agent' && subcommand === 'send') {
      const to = rest[0];
      const message = rest.slice(1).join(' ');
      if (!to || !message) {
        return errResult('agent send requires <handle> and a message', 2);
      }
      return await live(dataDir, 'agent.send', { to, message }, jsonOutput);
    } else if (command === 'term' && subcommand === 'ls') {
      const projectId = flagValue(rest, '--project');
      return await live(dataDir, 'term.list', projectId ? { projectId } : {}, jsonOutput);
    } else if (command === 'term' && subcommand === 'close') {
      const id = rest[0];
      if (!id) return errResult('term close requires a <sessionId>', 2);
      return await live(dataDir, 'term.close', { sessionId: id }, jsonOutput);
    } else if (command === 'term' && subcommand === 'reply') {
      // Inject a follow-up turn at a live session's prompt — the operator-side
      // "interact" primitive (maps to the control plane's term.reply op).
      const id = rest[0];
      const text = rest.slice(1).join(' ');
      if (!id || !text) return errResult('term reply requires a <sessionId> and a message', 2);
      return await live(dataDir, 'term.reply', { sessionId: id, text }, jsonOutput);
    } else if (command === 'term' && subcommand === 'close-summary') {
      // term close-summary <projectId> <sid1> [<sid2> ...] [--no-summary]
      const noSummary = rest.includes('--no-summary');
      const positional = rest.filter((a) => !a.startsWith('--'));
      const projectId = positional[0];
      const sessionIds = positional.slice(1);
      if (!projectId || sessionIds.length === 0) {
        return errResult(
          'term close-summary requires <projectId> and at least one <sessionId>',
          2
        );
      }
      return await live(
        dataDir,
        'term.close-summary',
        { projectId, sessionIds, summarize: !noSummary },
        jsonOutput
      );
    } else if (command === 'run') {
      // `run` has no subcommand — the first positional is the project, which the
      // top-level destructure captured as `subcommand`. Rejoin it with `rest`.
      return await runCommand(dataDir, subcommand ? [subcommand, ...rest] : rest, jsonOutput);
    } else if (command === 'schedule' && subcommand === 'run-now') {
      const id = rest[0];
      if (!id) return errResult('schedule run-now requires a <scheduleId>', 2);
      return await live(dataDir, 'sched.runNow', { id }, jsonOutput);
    } else if (command === 'schedule' && (subcommand === 'enable' || subcommand === 'disable')) {
      const id = rest[0];
      if (!id) return errResult(`schedule ${subcommand} requires a <scheduleId>`, 2);
      return await live(dataDir, 'sched.setEnabled', { id, enabled: subcommand === 'enable' }, jsonOutput);
    } else {
      return {
        exitCode: 1,
        stdout: '',
        stderr: `Error: unknown command '${command}${subcommand ? ' ' + subcommand : ''}'\nRun 'zcc --help' for usage.\n`
      };
    }
  } catch (err) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `Error: ${(err as Error).message}\n`
    };
  }
}

function help(): CliResult {
  const text = `zcc - Zana Command Center CLI

USAGE:
  zcc <command> [options]

READ COMMANDS (work whether the app is running or not):
  status                   Live dashboard: projects, agents, schedules
  projects ls              List projects
  personas ls              List personas
  schedule ls              List scheduled tasks
  inbox ls [--project ID]  List inbox entries
  inbox show <id>          Show full inbox entry
  followup ls              List follow-ups (parked questions/decisions)
       [--project ID] [--status open|resolved|dismissed] [--all]
       Defaults to open only; --all shows every state.

LIVE COMMANDS (require the app to be running):
  agent ls                 List live agents + their state
  team ls                  List the team catalogue (builtins + files + extensions)
  agent send <h> <msg>     Send a message to agent <handle>
  term ls [--project ID]   List live terminal sessions
  term close <sessionId>   Close a live session
  term reply <sessionId> <message>
                           Inject a follow-up turn at a live session's prompt
  term close-summary <projectId> <sessionId...>
                           Summarize the sessions' work to the inbox, then close
                           them. Add --no-summary to close without summarizing.
  run <project> <prompt>   Spawn a claude agent in a project
       [--persona NAME|ID] [--profile P] [--wait | --detach] [--timeout 5m]
       --persona resolves by id, name, or unique prefix (e.g. 'reviewer').
       Use '--' before a prompt that contains flag-like tokens:
         zcc run myproj -- review the --wait handler
  schedule run-now <id>    Fire a schedule once now
  schedule enable <id>     Enable a schedule
  schedule disable <id>    Disable a schedule

OPTIONS:
  --json                   Output as JSON (machine-readable)
  --data-dir <path>        Override data directory (takes precedence over ZCC_CENTER_DIR)
  --help, -h               Show this help
  --version, -v            Show version

ENVIRONMENT:
  ZCC_CENTER_DIR            Override data directory (default: ~/.zcc)
  ZCC_SESSION_ID            Set by the app inside agent terminals. When present,
                            the CLI is treated as an AGENT caller (read-only) —
                            mutating commands are refused. Do not set by hand.

EXIT CODES:
  0 success · 1 error · 2 bad usage · 3 not found/ambiguous
  4 resource limit · 5 refused by guard · 124 --wait timeout

EXAMPLES:
  zcc status
  zcc followup ls --project my-proj
  zcc run my-proj "review the diff in src/auth" --persona reviewer --wait
  zcc term reply sess-abc "also check the error paths"
  zcc agent send reviewer "PR #214 is ready"
  zcc term close-summary my-proj sess-abc sess-def
  zcc schedule run-now nightly-review
`;
  return { exitCode: 0, stdout: text };
}

// ---- helpers for live commands ----------------------------------------------

function errResult(message: string, exitCode = 1): CliResult {
  return { exitCode, stdout: '', stderr: `Error: ${message}\n` };
}

/**
 * Pull the value after a `--flag` token out of a positional list. An empty
 * value (`--flag=` or a trailing flag) is treated as absent (returns undefined)
 * so callers' `?? default` logic — which only catches undefined — still fires.
 */
function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i !== -1 && args[i + 1] !== undefined && !args[i + 1].startsWith('--')) {
    return args[i + 1] === '' ? undefined : args[i + 1];
  }
  const eq = args.find((a) => a.startsWith(`${flag}=`));
  if (!eq) return undefined;
  const v = eq.slice(flag.length + 1);
  return v === '' ? undefined : v;
}

/** Map a control-plane error code to a CLI exit code (mirrors the help table). */
function exitCodeForControl(code?: string): number {
  switch (code) {
    case 'FORBIDDEN_AGENT':
      return 5; // refused by guard
    case 'NOT_FOUND':
      return 3; // not found / ambiguous
    case 'BAD_ARGS':
    case 'BAD_OP':
      return 2; // bad usage
    case 'RESOURCE_LIMIT':
      return 4; // 50-pty cap (or similar)
    case 'TIMEOUT':
      return 124; // wait/transport timeout
    case 'APP_NOT_RUNNING':
    case 'UNAUTHORIZED':
    case 'STALE':
    default:
      return 1; // generic error
  }
}

/** Run one control-plane op and render its result (json or a compact summary). */
async function live(
  dataDir: string,
  op: string,
  args: Record<string, unknown>,
  json: boolean
): Promise<CliResult> {
  const resp = await callControlPlane({ dataDir, op, args });
  if (!resp.ok) {
    return { exitCode: exitCodeForControl(resp.code), stdout: '', stderr: `Error: ${resp.message ?? resp.code}\n` };
  }
  if (json) {
    return { exitCode: 0, stdout: JSON.stringify(resp.value, null, 2) + '\n' };
  }
  return { exitCode: 0, stdout: renderValue(op, resp.value) };
}

/** Human-friendly one-liners for the common live ops; falls back to JSON. */
function renderValue(op: string, value: unknown): string {
  if (op === 'agent.list' && Array.isArray(value)) {
    if (value.length === 0) return 'No live agents.\n';
    return (
      value
        .map(
          (a: any) =>
            `${a.handle ?? a.displayName ?? '?'}\t${a.state ?? '?'}\t${a.sessionId?.slice(0, 8) ?? ''}\t${a.role ?? ''}`
        )
        .join('\n') + '\n'
    );
  }
  if (op === 'term.list' && Array.isArray(value)) {
    if (value.length === 0) return 'No live sessions.\n';
    return (
      value
        .map((s: any) => `${s.id?.slice(0, 8) ?? ''}\t${s.profile ?? ''}\t${s.status ?? ''}\t${s.title ?? ''}`)
        .join('\n') + '\n'
    );
  }
  if (op === 'team.list' && Array.isArray(value)) {
    if (value.length === 0) return 'No teams.\n';
    return (
      value
        .map(
          (t: any) =>
            `${t.id ?? '?'}\t${t.name ?? '?'}\t${t.slotCount ?? 0} slot${t.slotCount === 1 ? '' : 's'}`
        )
        .join('\n') + '\n'
    );
  }
  if (op === 'agent.send' && value && typeof value === 'object') {
    const v = value as any;
    return `${v.delivered ? 'Delivered' : 'Queued'} to @${v.handle} (id=${v.id})\n`;
  }
  if (op === 'term.close') {
    return 'Closed.\n';
  }
  return JSON.stringify(value, null, 2) + '\n';
}

/** Bare `zcc status` — a compact live dashboard. */
async function statusDashboard(dataDir: string, json: boolean): Promise<CliResult> {
  const resp = await callControlPlane({ dataDir, op: 'status', args: {} });
  if (!resp.ok) {
    return { exitCode: exitCodeForControl(resp.code), stdout: '', stderr: `Error: ${resp.message ?? resp.code}\n` };
  }
  if (json) return { exitCode: 0, stdout: JSON.stringify(resp.value, null, 2) + '\n' };
  // Default-destructure so a future/partial server shape can't crash the render
  // (an unguarded v.agents.length would throw and surface as an opaque exit 1).
  const { projects = 0, agents = [], enabledSchedules = [] } = (resp.value ?? {}) as {
    projects?: number;
    agents?: Array<{ handle?: string; state?: string; role?: string }>;
    enabledSchedules?: Array<{ name?: string; every?: string }>;
  };
  let out = `Zana Command Center — live\n`;
  out += `Projects: ${projects}\n`;
  out += `\nAgents (${agents.length}):\n`;
  if (agents.length === 0) out += '  none\n';
  else for (const a of agents) out += `  ${a.handle ?? '?'}\t${a.state ?? '?'}\t${a.role ?? ''}\n`;
  out += `\nEnabled schedules (${enabledSchedules.length}):\n`;
  if (enabledSchedules.length === 0) out += '  none\n';
  else for (const s of enabledSchedules) out += `  ${s.name ?? '?'}\tevery ${s.every ?? '?'}\n`;
  return { exitCode: 0, stdout: out };
}

/**
 * `zcc run <project> <prompt...>` — spawn a claude agent in a project.
 *   --wait      poll until the agent returns to idle/done (or --timeout)
 *   --detach    return the session id immediately (the default; explicit for docs)
 *   --persona / --profile / --timeout    value flags
 *
 * Flag-vs-prompt disambiguation: everything after a literal `--` is the prompt
 * verbatim, so `zcc run proj -- review the --wait handler` keeps `--wait` as
 * prompt text. Without `--`, flags may appear anywhere (back-compat), so a
 * prompt containing a real flag token should use the `--` sentinel.
 */
async function runCommand(dataDir: string, rest: string[], json: boolean): Promise<CliResult> {
  if (!isAppRunning(dataDir)) {
    return errResult('Zana Command Center is not running (no control socket). Open the app and retry.', 1);
  }
  // Split at the first `--`: tokens before it are the flag zone (+ project),
  // tokens after it are the literal prompt and are NEVER parsed as flags.
  const sentinel = rest.indexOf('--');
  const flagZone = sentinel === -1 ? rest : rest.slice(0, sentinel);
  const promptZone = sentinel === -1 ? [] : rest.slice(sentinel + 1);

  const wait = flagZone.includes('--wait');
  const detach = flagZone.includes('--detach');
  if (wait && detach) return errResult('run: --wait and --detach are mutually exclusive', 2);
  const persona = flagValue(flagZone, '--persona');
  const profile = (flagValue(flagZone, '--profile') ?? 'claude') as string;
  const timeoutRaw = flagValue(flagZone, '--timeout');
  if (timeoutRaw !== undefined && parseDuration(timeoutRaw) === undefined) {
    return errResult(`run: invalid --timeout '${timeoutRaw}' (use e.g. 30s, 5m, 2h)`, 2);
  }
  const timeoutMs = parseDuration(timeoutRaw) ?? 5 * 60_000;

  const positionals = stripFlags(flagZone, ['--persona', '--profile', '--timeout'], ['--wait', '--detach']);
  const projectRef = positionals[0];
  // Prompt is the `--` tail when present, else the positionals after <project>.
  const prompt = (promptZone.length ? promptZone : positionals.slice(1)).join(' ');
  if (!projectRef || !prompt) {
    return errResult('run requires <project> and a <prompt>', 2);
  }
  const { data: projects } = readProjects(dataDir);
  const resolved = resolveProject(projects, projectRef);
  if (resolved.kind === 'none') return errResult(`project '${projectRef}' not found`, 3);
  if (resolved.kind === 'ambiguous') {
    return errResult(`project '${projectRef}' is ambiguous: ${resolved.candidates.join(', ')}`, 3);
  }
  const project = resolved.project;

  // Resolve `--persona <name|id|prefix>` against the LIVE catalogue (built-ins
  // included — the file reader can't see those). Only when one was given; a bare
  // `run` launches the plain profile. The resolved id is what main re-validates.
  let personaId: string | undefined;
  if (persona !== undefined) {
    const list = await callControlPlane({ dataDir, op: 'persona.list', args: {} });
    if (!list.ok) {
      return { exitCode: exitCodeForControl(list.code), stdout: '', stderr: `Error: ${list.message ?? list.code}\n` };
    }
    const pr = resolvePersona((list.value as PersonaSummary[]) ?? [], persona);
    if (pr.kind === 'none') return errResult(`persona '${persona}' not found`, 3);
    if (pr.kind === 'ambiguous') {
      return errResult(`persona '${persona}' is ambiguous: ${pr.candidates.join(', ')}`, 3);
    }
    personaId = pr.persona.id;
  }

  const spawn = await callControlPlane({
    dataDir,
    op: 'term.create',
    args: { projectId: project.id, profile, personaId, prompt }
  });
  if (!spawn.ok) {
    return { exitCode: exitCodeForControl(spawn.code), stdout: '', stderr: `Error: ${spawn.message ?? spawn.code}\n` };
  }
  const sessionId = (spawn.value as { id?: string } | undefined)?.id;
  if (!sessionId) return errResult('spawn returned no session id', 1);

  if (!wait) {
    if (json) return { exitCode: 0, stdout: JSON.stringify({ sessionId }, null, 2) + '\n' };
    return { exitCode: 0, stdout: `${sessionId}\n` };
  }

  // Poll session.status until idle/done or timeout. State comes from the app's
  // own OSC/hook detection — we never scrape the pane. A SINGLE failed poll must
  // not abort the wait (a transient busy app / dropped RPC is not a timeout):
  // tolerate a run of consecutive failures, only giving up after enough of them.
  const start = nowMs();
  let state = 'unknown';
  let consecutiveFailures = 0;
  const MAX_CONSECUTIVE_FAILURES = 5;
  while (nowMs() - start < timeoutMs) {
    await sleep(1500);
    const st = await callControlPlane({ dataDir, op: 'session.status', args: { sessionId } });
    if (!st.ok) {
      consecutiveFailures += 1;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        return {
          exitCode: 1,
          stdout: json ? JSON.stringify({ sessionId, state, error: st.code }, null, 2) + '\n' : `${sessionId}\n`,
          stderr: `Error: lost contact with the app while waiting (${st.code ?? 'unknown'}); session left running\n`
        };
      }
      continue;
    }
    consecutiveFailures = 0;
    state = (st.value as { state?: string } | undefined)?.state ?? 'unknown';
    if (state === 'idle' || state === 'done') {
      if (json) return { exitCode: 0, stdout: JSON.stringify({ sessionId, state }, null, 2) + '\n' };
      return { exitCode: 0, stdout: `${sessionId} ${state}\n` };
    }
  }
  // Timed out still working — leave the session running, signal 124.
  return {
    exitCode: 124,
    stdout: json ? JSON.stringify({ sessionId, state, timedOut: true }, null, 2) + '\n' : `${sessionId} (still ${state}, timed out)\n`,
    stderr: 'Warning: --wait timed out; session left running\n'
  };
}

type ResolveResult =
  | { kind: 'found'; project: Project }
  | { kind: 'none' }
  | { kind: 'ambiguous'; candidates: string[] };

/**
 * Resolve a project by exact id → exact tag → exact name → unique name prefix
 * (case-insensitive). A prefix matching >1 project is `ambiguous` (not silently
 * "not found"), so the caller can list candidates — per the design doc's id/name
 * resolution contract (exit 3 with candidates).
 */
function resolveProject(projects: Project[], ref: string): ResolveResult {
  const exact =
    projects.find((p) => p.id === ref) ??
    projects.find((p) => p.tag === ref) ??
    projects.find((p) => p.name === ref);
  if (exact) return { kind: 'found', project: exact };
  const prefix = projects.filter((p) => p.name.toLowerCase().startsWith(ref.toLowerCase()));
  if (prefix.length === 1) return { kind: 'found', project: prefix[0] };
  if (prefix.length > 1) return { kind: 'ambiguous', candidates: prefix.map((p) => p.name) };
  return { kind: 'none' };
}

type ResolvePersonaResult =
  | { kind: 'found'; persona: PersonaSummary }
  | { kind: 'none' }
  | { kind: 'ambiguous'; candidates: string[] };

/**
 * Resolve a persona by exact id → exact name → unique name/id prefix
 * (case-insensitive). Mirrors {@link resolveProject}: a prefix matching >1
 * persona is `ambiguous` (exit 3 with candidate names) rather than a silent
 * miss. Lets `--persona reviewer` find `builtin:reviewer`.
 */
export function resolvePersona(personas: PersonaSummary[], ref: string): ResolvePersonaResult {
  const exact =
    personas.find((p) => p.id === ref) ??
    personas.find((p) => p.name === ref);
  if (exact) return { kind: 'found', persona: exact };
  const lower = ref.toLowerCase();
  const prefix = personas.filter(
    (p) => p.id.toLowerCase().startsWith(lower) || p.name.toLowerCase().startsWith(lower)
  );
  if (prefix.length === 1) return { kind: 'found', persona: prefix[0] };
  if (prefix.length > 1) {
    // De-dupe candidate labels (id + name prefix can both match one persona).
    const candidates = Array.from(new Set(prefix.map((p) => p.name)));
    if (candidates.length === 1) return { kind: 'found', persona: prefix[0] };
    return { kind: 'ambiguous', candidates };
  }
  return { kind: 'none' };
}

/** Drop known value-flags (+ their values) and boolean-flags from a positional list. */
function stripFlags(args: string[], valueFlags: string[], boolFlags: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (boolFlags.includes(a)) continue;
    if (valueFlags.includes(a)) {
      i += 1; // skip its value
      continue;
    }
    if (valueFlags.some((f) => a.startsWith(`${f}=`))) continue;
    out.push(a);
  }
  return out;
}

/**
 * Parse "5m"/"30s"/"2h" → ms. Returns undefined on bad input, including a
 * zero/non-positive duration (`0s`, `0ms`): a zero timeout would make `--wait`
 * exit 124 without ever polling once, so it's a usage error, not a real bound.
 */
function parseDuration(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const m = /^(\d+)(ms|s|m|h)$/.exec(s.trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  const unit = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[m[2]]!;
  const ms = n * unit;
  return ms > 0 ? ms : undefined;
}

// Date.now / setTimeout wrappers kept tiny so the rest stays pure-ish + testable.
function nowMs(): number {
  return Date.now();
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function projectsList(dataDir: string, json: boolean): Promise<CliResult> {
  const { data: projects, warnings } = readProjects(dataDir);

  if (json) {
    return {
      exitCode: 0,
      stdout: JSON.stringify(projects, null, 2) + '\n',
      stderr: warnings.length > 0 ? warnings.join('\n') + '\n' : undefined
    };
  }

  let output = '';
  if (projects.length === 0) {
    output = 'No projects found.\n';
  } else {
    // Human table: id, name, tag, path
    const rows = projects.map(p => ({
      id: p.id.slice(0, 8),
      name: p.name,
      tag: p.tag || '-',
      path: p.path
    }));

    const colWidths = {
      id: Math.max(2, ...rows.map(r => r.id.length)),
      name: Math.max(4, ...rows.map(r => r.name.length)),
      tag: Math.max(3, ...rows.map(r => r.tag.length)),
      path: Math.max(4, ...rows.map(r => r.path.length))
    };

    const header = `${'ID'.padEnd(colWidths.id)}  ${'NAME'.padEnd(colWidths.name)}  ${'TAG'.padEnd(colWidths.tag)}  PATH\n`;
    const separator = `${'-'.repeat(colWidths.id)}  ${'-'.repeat(colWidths.name)}  ${'-'.repeat(colWidths.tag)}  ----\n`;
    const body = rows.map(r =>
      `${r.id.padEnd(colWidths.id)}  ${r.name.padEnd(colWidths.name)}  ${r.tag.padEnd(colWidths.tag)}  ${r.path}`
    ).join('\n') + '\n';

    output = header + separator + body;
  }

  return {
    exitCode: 0,
    stdout: output,
    stderr: warnings.length > 0 ? warnings.join('\n') + '\n' : undefined
  };
}

async function personasList(dataDir: string, json: boolean): Promise<CliResult> {
  const { data: projects } = readProjects(dataDir);
  const { data: personas, warnings } = readPersonas(dataDir, projects);

  if (json) {
    return {
      exitCode: 0,
      stdout: JSON.stringify(personas, null, 2) + '\n',
      stderr: warnings.length > 0 ? warnings.join('\n') + '\n' : undefined
    };
  }

  let output = '';
  if (personas.length === 0) {
    output = 'No personas found. Note: builtin personas (builtin:reviewer, builtin:architect) are not file-backed.\n';
  } else {
    const rows = personas.map(p => ({
      id: p.id,
      name: p.name,
      baseProfile: p.baseProfile || 'claude',
      source: formatPersonaSource(p.source)
    }));

    const colWidths = {
      id: Math.max(2, ...rows.map(r => r.id.length)),
      name: Math.max(4, ...rows.map(r => r.name.length)),
      baseProfile: Math.max(7, ...rows.map(r => r.baseProfile.length)),
      source: Math.max(6, ...rows.map(r => r.source.length))
    };

    const header = `${'ID'.padEnd(colWidths.id)}  ${'NAME'.padEnd(colWidths.name)}  ${'PROFILE'.padEnd(colWidths.baseProfile)}  SOURCE\n`;
    const separator = `${'-'.repeat(colWidths.id)}  ${'-'.repeat(colWidths.name)}  ${'-'.repeat(colWidths.baseProfile)}  ------\n`;
    const body = rows.map(r =>
      `${r.id.padEnd(colWidths.id)}  ${r.name.padEnd(colWidths.name)}  ${r.baseProfile.padEnd(colWidths.baseProfile)}  ${r.source}`
    ).join('\n') + '\n';

    output = header + separator + body;
  }

  return {
    exitCode: 0,
    stdout: output,
    stderr: warnings.length > 0 ? warnings.join('\n') + '\n' : undefined
  };
}

function formatPersonaSource(source: Persona['source']): string {
  if (!source) return 'unknown';
  if (source === 'user') return 'global';
  if (source === 'builtin') return 'builtin';
  return source.projectName || source.projectId.slice(0, 8);
}

async function scheduleList(dataDir: string, json: boolean): Promise<CliResult> {
  const { data: projects } = readProjects(dataDir);
  const { data: schedules, warnings } = readSchedules(dataDir, projects);

  if (json) {
    return {
      exitCode: 0,
      stdout: JSON.stringify(schedules, null, 2) + '\n',
      stderr: warnings.length > 0 ? warnings.join('\n') + '\n' : undefined
    };
  }

  let output = '';
  if (schedules.length === 0) {
    output = 'No scheduled tasks found.\n';
  } else {
    const rows = schedules.map(s => {
      const project = projects.find(p => p.id === s.projectId);
      return {
        id: s.id.slice(0, 8),
        name: s.name,
        enabled: s.enabled ? 'yes' : 'no',
        every: s.schedule.every,
        project: project?.name || s.projectId.slice(0, 8),
        lastResult: s.status.lastRunResult || '-'
      };
    });

    const colWidths = {
      id: Math.max(2, ...rows.map(r => r.id.length)),
      name: Math.max(4, ...rows.map(r => r.name.length)),
      enabled: 7,
      every: Math.max(5, ...rows.map(r => r.every.length)),
      project: Math.max(7, ...rows.map(r => r.project.length)),
      lastResult: Math.max(6, ...rows.map(r => r.lastResult.length))
    };

    const header = `${'ID'.padEnd(colWidths.id)}  ${'NAME'.padEnd(colWidths.name)}  ${'ENABLED'.padEnd(colWidths.enabled)}  ${'EVERY'.padEnd(colWidths.every)}  ${'PROJECT'.padEnd(colWidths.project)}  LAST-RUN\n`;
    const separator = `${'-'.repeat(colWidths.id)}  ${'-'.repeat(colWidths.name)}  ${'-'.repeat(colWidths.enabled)}  ${'-'.repeat(colWidths.every)}  ${'-'.repeat(colWidths.project)}  --------\n`;
    const body = rows.map(r =>
      `${r.id.padEnd(colWidths.id)}  ${r.name.padEnd(colWidths.name)}  ${r.enabled.padEnd(colWidths.enabled)}  ${r.every.padEnd(colWidths.every)}  ${r.project.padEnd(colWidths.project)}  ${r.lastResult}`
    ).join('\n') + '\n';

    output = header + separator + body;
  }

  return {
    exitCode: 0,
    stdout: output,
    stderr: warnings.length > 0 ? warnings.join('\n') + '\n' : undefined
  };
}

async function inboxList(dataDir: string, rest: string[], json: boolean): Promise<CliResult> {
  let projectId: string | undefined;

  // Parse --project <id|tag>
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--project' && rest[i + 1]) {
      projectId = rest[i + 1];
      break;
    }
  }

  // If projectId looks like a tag (lowercase alphanumeric), resolve it
  const { data: projects } = readProjects(dataDir);
  if (projectId) {
    const byTag = projects.find(p => p.tag === projectId);
    if (byTag) {
      projectId = byTag.id;
    }
  }

  const { data: entries, warnings } = readInbox(dataDir, { limit: 20, projectId });

  if (json) {
    return {
      exitCode: 0,
      stdout: JSON.stringify(entries, null, 2) + '\n',
      stderr: warnings.length > 0 ? warnings.join('\n') + '\n' : undefined
    };
  }

  let output = '';
  if (entries.length === 0) {
    output = 'No inbox entries found.\n';
  } else {
    const rows = entries.map(e => {
      const project = projects.find(p => p.id === e.projectId);
      const firstLine = e.comments?.split('\n')[0] || '';
      return {
        id: e.id.slice(0, 8),
        ts: new Date(e.ts).toISOString().replace('T', ' ').slice(0, 19),
        project: e.projectLabel || project?.name || e.projectId.slice(0, 8),
        preview: firstLine.slice(0, 50) + (firstLine.length > 50 ? '...' : '')
      };
    });

    const colWidths = {
      id: Math.max(2, ...rows.map(r => r.id.length)),
      ts: 19,
      project: Math.max(7, ...rows.map(r => r.project.length)),
      preview: Math.max(7, ...rows.map(r => r.preview.length))
    };

    const header = `${'ID'.padEnd(colWidths.id)}  ${'TIMESTAMP'.padEnd(colWidths.ts)}  ${'PROJECT'.padEnd(colWidths.project)}  PREVIEW\n`;
    const separator = `${'-'.repeat(colWidths.id)}  ${'-'.repeat(colWidths.ts)}  ${'-'.repeat(colWidths.project)}  -------\n`;
    const body = rows.map(r =>
      `${r.id.padEnd(colWidths.id)}  ${r.ts.padEnd(colWidths.ts)}  ${r.project.padEnd(colWidths.project)}  ${r.preview}`
    ).join('\n') + '\n';

    output = header + separator + body;
  }

  return {
    exitCode: 0,
    stdout: output,
    stderr: warnings.length > 0 ? warnings.join('\n') + '\n' : undefined
  };
}

async function inboxShow(dataDir: string, id: string, json: boolean): Promise<CliResult> {
  const { data: entries, warnings } = readInbox(dataDir);
  // Prefer an exact id match; otherwise accept a unique prefix. entries are
  // ts-descending, so an ambiguous prefix would silently pick the newest —
  // warn instead so the user knows to disambiguate.
  const exact = entries.find(e => e.id === id);
  const prefixMatches = exact ? [exact] : entries.filter(e => e.id.startsWith(id));
  const entry = exact ?? prefixMatches[0];

  if (!entry) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `Error: inbox entry '${id}' not found\n`
    };
  }
  if (!exact && prefixMatches.length > 1) {
    warnings.push(
      `Warning: '${id}' matches ${prefixMatches.length} entries; showing the most recent. ` +
        `Use a longer id prefix to disambiguate.`
    );
  }

  if (json) {
    return {
      exitCode: 0,
      stdout: JSON.stringify(entry, null, 2) + '\n',
      stderr: warnings.length > 0 ? warnings.join('\n') + '\n' : undefined
    };
  }

  const { data: projects } = readProjects(dataDir);
  const project = projects.find(p => p.id === entry.projectId);

  let output = `Inbox Entry: ${entry.id}\n`;
  output += `Project: ${entry.projectLabel || project?.name || entry.projectId}\n`;
  output += `Timestamp: ${new Date(entry.ts).toISOString()}\n`;

  if (entry.docs && entry.docs.length > 0) {
    output += `\nDocuments:\n`;
    for (const doc of entry.docs) {
      output += `  - ${doc.path}\n`;
    }
  }

  if (entry.comments) {
    output += `\nComments:\n${entry.comments}\n`;
  }

  return {
    exitCode: 0,
    stdout: output,
    stderr: warnings.length > 0 ? warnings.join('\n') + '\n' : undefined
  };
}

/**
 * `followup ls [--project ID|tag] [--status open|resolved|dismissed] [--all]`.
 * File-backed read (works whether the app is up or not), matching `inbox ls`.
 * Defaults to open follow-ups only; `--all` (or an explicit `--status`) widens it.
 */
async function followupList(dataDir: string, rest: string[], json: boolean): Promise<CliResult> {
  let projectId = flagValue(rest, '--project');
  const statusRaw = flagValue(rest, '--status');
  const showAll = rest.includes('--all');

  const VALID_STATUS = ['open', 'resolved', 'dismissed'] as const;
  if (statusRaw && !VALID_STATUS.includes(statusRaw as (typeof VALID_STATUS)[number])) {
    return errResult(`followup ls: --status must be one of ${VALID_STATUS.join(', ')}`, 2);
  }

  const { data: projects } = readProjects(dataDir);
  if (projectId) {
    const byTag = projects.find((p) => p.tag === projectId);
    if (byTag) projectId = byTag.id;
  }

  // Default view is open-only; --status pins a state; --all shows every state.
  const status = statusRaw
    ? (statusRaw as (typeof VALID_STATUS)[number])
    : showAll
      ? undefined
      : 'open';

  const { data: followups, warnings } = readFollowUps(dataDir, projects, { projectId, status });

  if (json) {
    return {
      exitCode: 0,
      stdout: JSON.stringify(followups, null, 2) + '\n',
      stderr: warnings.length > 0 ? warnings.join('\n') + '\n' : undefined
    };
  }

  let output = '';
  if (followups.length === 0) {
    output = 'No follow-ups found.\n';
  } else {
    const rows = followups.map((f) => {
      const project = projects.find((p) => p.id === f.projectId);
      return {
        id: f.id.slice(0, 8),
        status: f.status,
        kind: f.kind,
        project: project?.name || f.projectId.slice(0, 8),
        title: f.title.length > 56 ? f.title.slice(0, 53) + '...' : f.title
      };
    });

    const w = {
      id: Math.max(2, ...rows.map((r) => r.id.length)),
      status: Math.max(6, ...rows.map((r) => r.status.length)),
      kind: Math.max(4, ...rows.map((r) => r.kind.length)),
      project: Math.max(7, ...rows.map((r) => r.project.length))
    };

    const header = `${'ID'.padEnd(w.id)}  ${'STATUS'.padEnd(w.status)}  ${'KIND'.padEnd(w.kind)}  ${'PROJECT'.padEnd(w.project)}  TITLE\n`;
    const sep = `${'-'.repeat(w.id)}  ${'-'.repeat(w.status)}  ${'-'.repeat(w.kind)}  ${'-'.repeat(w.project)}  -----\n`;
    const body =
      rows
        .map(
          (r) =>
            `${r.id.padEnd(w.id)}  ${r.status.padEnd(w.status)}  ${r.kind.padEnd(w.kind)}  ${r.project.padEnd(w.project)}  ${r.title}`
        )
        .join('\n') + '\n';

    output = header + sep + body;
  }

  return {
    exitCode: 0,
    stdout: output,
    stderr: warnings.length > 0 ? warnings.join('\n') + '\n' : undefined
  };
}
