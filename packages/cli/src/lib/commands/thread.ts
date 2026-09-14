import { deprecation, errResult, type CliResult } from '../cli-result.js';
import { flagValue, hasFlag, splitSentinel, stripFlags } from '../flag-parse.js';
import {
  productRequest,
  renderOrJson,
  resolveServerUrl,
  sleepMs,
  type ProductHttpDeps
} from '../product-http.js';
import {
  ControlError,
  ProductHttpClient,
  spawnThread as sdkSpawnThread,
  exitCodeForControlError,
  waitForThreadStatus,
  type PermissionMode
} from '@zana-ai/zcc-control';

interface ThreadRow {
  id: string;
  projectId?: string;
  status?: string;
  title?: string | null;
  providerId?: string;
  hostId?: string;
  environmentId?: string | null;
  parentThreadId?: string | null;
  archivedAt?: number | null;
  activity?: { activeBackgroundCommandCount?: number };
}

function formatThread(row: ThreadRow): string {
  const title = row.title?.trim() || '(untitled)';
  return `${row.id}\t${row.status ?? '?'}\t${row.projectId ?? '-'}\t${title}`;
}

function parseDuration(raw: string): number | undefined {
  const match = /^(\d+)(ms|s|m|h)?$/.exec(raw.trim());
  if (!match) return undefined;
  const n = Number(match[1]);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const unit = match[2] ?? 's';
  if (unit === 'ms') return n;
  if (unit === 's') return n * 1000;
  if (unit === 'm') return n * 60_000;
  return n * 3_600_000;
}

type WaitUntil = 'turn' | 'quiet';

async function waitForThread(
  id: string,
  timeoutMs: number,
  json: boolean,
  deps: ProductHttpDeps | undefined,
  until: WaitUntil
): Promise<CliResult> {
  const http = new ProductHttpClient(resolveServerUrl(deps), {
    fetchImpl: deps?.fetchImpl,
    nowMs: deps?.nowMs ?? (() => Date.now()),
    sleep: deps?.sleep ?? ((ms) => sleepMs(ms, deps))
  });
  try {
    const row = await waitForThreadStatus(http, id, {
      until: until === 'quiet' ? 'quiet' : 'idle',
      timeoutMs,
      onInteraction: 'fail'
    });
    return renderOrJson(json, row, `${id} ${row.status ?? ''}\n`);
  } catch (error) {
    if (error instanceof ControlError && error.code === 'TIMEOUT') {
      return {
        exitCode: 124,
        stdout: '',
        stderr: `Error: timed out waiting for thread ${id}; it is still running\n`
      };
    }
    if (error instanceof ControlError) {
      return errResult(error.message, exitCodeForControlError(error));
    }
    throw error;
  }
}

async function spawnThreadCommand(
  args: string[],
  json: boolean,
  deps: ProductHttpDeps | undefined,
  dataDir: string
): Promise<CliResult> {
  const { head, tail } = splitSentinel(args);
  const wait = hasFlag(head, '--wait');
  const detach = hasFlag(head, '--detach');
  if (wait && detach) return errResult('--wait and --detach are mutually exclusive', 2);
  const timeoutRaw = flagValue(head, '--timeout') ?? '5m';
  const timeoutMs = parseDuration(timeoutRaw);
  if (timeoutMs === undefined) return errResult(`invalid --timeout '${timeoutRaw}'`, 2);
  const extraFlags = [
    '--project', '--prompt', '--provider', '--model', '--host', '--permission-mode', '--title', '--timeout',
    '--acp-mode', '--reasoning-level', '--visibility', '--parent'
  ];
  const projectId = flagValue(head, '--project')
    ?? stripFlags(head, extraFlags, ['--wait', '--detach', '--json'])[0];
  const promptFromFlag = flagValue(head, '--prompt');
  const positional = stripFlags(head, extraFlags, ['--wait', '--detach', '--json']);
  const promptParts = tail.length > 0
    ? tail
    : promptFromFlag
      ? [promptFromFlag]
      : positional.slice(projectId && positional[0] === projectId ? 1 : (flagValue(head, '--project') ? 0 : 1));
  const prompt = promptParts.join(' ').trim();
  if (!projectId) return errResult('thread spawn requires --project <id> (or a project positional)', 2);
  if (!prompt) return errResult('thread spawn requires --prompt or a prompt positional', 2);
  const permissionModeRaw = flagValue(head, '--permission-mode');
  if (permissionModeRaw && permissionModeRaw !== 'accept-edits' && permissionModeRaw !== 'auto' && permissionModeRaw !== 'full') {
    return errResult(`invalid --permission-mode '${permissionModeRaw}'`, 2);
  }
  const visibilityRaw = flagValue(head, '--visibility');
  if (visibilityRaw && visibilityRaw !== 'visible' && visibilityRaw !== 'hidden') {
    return errResult(`invalid --visibility '${visibilityRaw}'`, 2);
  }
  const http = new ProductHttpClient(resolveServerUrl(deps), {
    fetchImpl: deps?.fetchImpl,
    nowMs: deps?.nowMs ?? (() => Date.now()),
    sleep: deps?.sleep ?? ((ms) => sleepMs(ms, deps))
  });
  try {
    const handle = await sdkSpawnThread(http, {
      projectId,
      prompt,
      providerId: flagValue(head, '--provider') ?? 'claude-code',
      model: flagValue(head, '--model'),
      acpMode: flagValue(head, '--acp-mode'),
      hostId: flagValue(head, '--host'),
      permissionMode: permissionModeRaw as PermissionMode | undefined,
      reasoningLevel: flagValue(head, '--reasoning-level'),
      visibility: visibilityRaw as 'visible' | 'hidden' | undefined,
      parentThreadId: flagValue(head, '--parent'),
      title: flagValue(head, '--title')
    }, { runId: 'operator', dataDir, tagged: false });
    const row = handle.snapshot();
    if (!wait) {
      return renderOrJson(json, row, `${row.id}\t${row.status ?? 'starting'}\n`);
    }
    const waited = await handle.wait({ until: 'idle', timeoutMs, onInteraction: 'fail' });
    return renderOrJson(json, waited, `${waited.id}\t${waited.status ?? ''}\n`);
  } catch (error) {
    if (error instanceof ControlError && error.code === 'TIMEOUT') {
      return {
        exitCode: 124,
        stdout: '',
        stderr: `Error: timed out waiting for thread; it is still running\n`
      };
    }
    if (error instanceof ControlError) {
      return errResult(error.message, exitCodeForControlError(error));
    }
    throw error;
  }
}

interface BackgroundCommandRow {
  itemId?: string;
  id?: string;
  description?: string;
  taskType?: string;
}

function formatBackgroundCommand(row: BackgroundCommandRow): string {
  const id = row.itemId ?? row.id ?? '?';
  const taskType = row.taskType ?? '?';
  const description = row.description?.trim() || '(no description)';
  return `${id}\t${taskType}\t${description}`;
}

function backgroundStopPrompt(commands: BackgroundCommandRow[]): string {
  const names = commands
    .map((row) => row.description?.trim())
    .filter((name): name is string => Boolean(name));
  const listed = names.length > 0 ? names.join('; ') : 'the running background shells';
  return (
    `Stop these running background shells now: ${listed}. ` +
    'Use KillShell (or the equivalent tool) so they exit. Do not start new ones.'
  );
}

async function runThreadBackground(
  rest: string[],
  json: boolean,
  deps?: ProductHttpDeps
): Promise<CliResult> {
  const force = hasFlag(rest, '--force');
  const timeoutRaw = flagValue(rest, '--timeout') ?? '2m';
  const positional = stripFlags(rest, ['--timeout'], ['--force']);
  const action = positional[0];
  const id = positional[1];
  if (action !== 'list' && action !== 'stop') {
    return errResult('thread background requires list or stop <threadId>', 2);
  }
  if (!id) return errResult(`thread background ${action} requires a <threadId>`, 2);

  if (action === 'list') {
    const timeline = await productRequest<{
      activeBackgroundCommands?: BackgroundCommandRow[];
    }>(
      'GET',
      `/api/v1/threads/${encodeURIComponent(id)}/timeline`,
      { deps, query: { summaryOnly: 'true' } }
    );
    if (!timeline.ok) return timeline.result;
    const commands = timeline.data.activeBackgroundCommands ?? [];
    if (json) return renderOrJson(true, commands, '');
    if (commands.length === 0) return renderOrJson(false, commands, 'No background commands\n');
    return renderOrJson(false, commands, `${commands.map(formatBackgroundCommand).join('\n')}\n`);
  }

  if (force) {
    const stopped = await productRequest<unknown>(
      'POST',
      `/api/v1/threads/${encodeURIComponent(id)}/stop`,
      { deps, body: {} }
    );
    if (!stopped.ok) return stopped.result;
    return renderOrJson(json, stopped.data, `${id} stopped\n`);
  }

  const timeoutMs = parseDuration(timeoutRaw);
  if (timeoutMs === undefined) return errResult(`invalid --timeout '${timeoutRaw}'`, 2);
  const timeline = await productRequest<{
    activeBackgroundCommands?: BackgroundCommandRow[];
  }>(
    'GET',
    `/api/v1/threads/${encodeURIComponent(id)}/timeline`,
    { deps, query: { summaryOnly: 'true' } }
  );
  if (!timeline.ok) return timeline.result;
  const commands = timeline.data.activeBackgroundCommands ?? [];
  if (commands.length === 0) {
    return renderOrJson(json, commands, 'No background commands\n');
  }
  const sent = await productRequest<{ thread?: ThreadRow }>(
    'POST',
    `/api/v1/threads/${encodeURIComponent(id)}/send`,
    { deps, body: { text: backgroundStopPrompt(commands), mode: 'auto' } }
  );
  if (!sent.ok) return sent.result;
  return waitForThread(id, timeoutMs, json, deps, 'quiet');
}

export async function runThreadCommand(
  subcommand: string | undefined,
  rest: string[],
  json: boolean,
  deps?: ProductHttpDeps,
  dataDir = '.'
): Promise<CliResult> {
  if (!subcommand || subcommand === 'list' || subcommand === 'ls') {
    const projectId = flagValue(rest, '--project');
    const listed = await productRequest<{ threads: ThreadRow[] }>('GET', '/api/v1/threads', {
      deps,
      query: { projectId }
    });
    if (!listed.ok) return listed.result;
    const threads = listed.data.threads ?? [];
    if (json) return renderOrJson(true, threads, '');
    if (threads.length === 0) return renderOrJson(false, threads, 'No threads\n');
    return renderOrJson(false, threads, `${threads.map(formatThread).join('\n')}\n`);
  }

  if (subcommand === 'spawn') return spawnThreadCommand(rest, json, deps, dataDir);

  if (subcommand === 'show') {
    const id = rest[0];
    if (!id) return errResult('thread show requires a <threadId>', 2);
    const shown = await productRequest<{ thread: ThreadRow }>(
      'GET',
      `/api/v1/threads/${encodeURIComponent(id)}`,
      { deps }
    );
    if (!shown.ok) return shown.result;
    const row = shown.data.thread;
    return renderOrJson(
      json,
      row,
      `${formatThread(row)}\thost ${row.hostId ?? '-'}\tenv ${row.environmentId ?? '-'}\n`
    );
  }

  if (subcommand === 'log') {
    const id = rest[0];
    if (!id) return errResult('thread log requires a <threadId>', 2);
    const timeline = await productRequest<unknown>(
      'GET',
      `/api/v1/threads/${encodeURIComponent(id)}/timeline`,
      { deps }
    );
    if (!timeline.ok) return timeline.result;
    return renderOrJson(json, timeline.data, `${JSON.stringify(timeline.data, null, 2)}\n`);
  }

  if (subcommand === 'tell') {
    const id = rest[0];
    const message = rest.slice(1).join(' ').trim();
    if (!id || !message) return errResult('thread tell requires a <threadId> and a message', 2);
    const sent = await productRequest<{ thread?: ThreadRow }>(
      'POST',
      `/api/v1/threads/${encodeURIComponent(id)}/send`,
      { deps, body: { text: message, mode: 'auto' } }
    );
    if (!sent.ok) return sent.result;
    const row = sent.data.thread;
    return renderOrJson(json, sent.data, row ? `${formatThread(row)}\n` : 'ok\n');
  }

  if (subcommand === 'wait') {
    const timeoutRaw = flagValue(rest, '--timeout') ?? '20m';
    const timeoutMs = parseDuration(timeoutRaw);
    if (timeoutMs === undefined) return errResult(`invalid --timeout '${timeoutRaw}'`, 2);
    const untilRaw = flagValue(rest, '--until') ?? 'turn';
    if (untilRaw !== 'turn' && untilRaw !== 'quiet') {
      return errResult("thread wait --until must be 'turn' or 'quiet'", 2);
    }
    const id = stripFlags(rest, ['--timeout', '--until'], [])[0];
    if (!id) return errResult('thread wait requires a <threadId>', 2);
    return waitForThread(id, timeoutMs, json, deps, untilRaw);
  }

  if (subcommand === 'background') {
    return runThreadBackground(rest, json, deps);
  }

  if (subcommand === 'stop') {
    const id = rest[0];
    if (!id) return errResult('thread stop requires a <threadId>', 2);
    const stopped = await productRequest<unknown>(
      'POST',
      `/api/v1/threads/${encodeURIComponent(id)}/stop`,
      { deps, body: {} }
    );
    if (!stopped.ok) return stopped.result;
    return renderOrJson(json, stopped.data, `${id} stopped\n`);
  }

  if (subcommand === 'fork') {
    const id = rest[0];
    if (!id) return errResult('thread fork requires a <threadId>', 2);
    const forked = await productRequest<{ thread?: ThreadRow; value?: ThreadRow }>(
      'POST',
      `/api/v1/threads/${encodeURIComponent(id)}/fork`,
      { deps, body: {} }
    );
    if (!forked.ok) return forked.result;
    const row = forked.data.thread ?? forked.data.value;
    return renderOrJson(json, forked.data, row ? `${formatThread(row)}\n` : 'ok\n');
  }

  if (subcommand === 'archive' || subcommand === 'unarchive') {
    const id = rest[0];
    if (!id) return errResult(`thread ${subcommand} requires a <threadId>`, 2);
    const done = await productRequest<unknown>(
      'POST',
      `/api/v1/threads/${encodeURIComponent(id)}/${subcommand}`,
      { deps, body: {} }
    );
    if (!done.ok) return done.result;
    return renderOrJson(json, done.data, `${id} ${subcommand}d\n`);
  }

  if (subcommand === 'open') {
    const pathFlag = flagValue(rest, '--file');
    const sourceFlag = flagValue(rest, '--source');
    const lineFlag = flagValue(rest, '--line');
    const positional = stripFlags(rest, ['--file', '--source', '--line'], []);
    const id = positional[0];
    if (!id) return errResult('thread open requires a <threadId>', 2);
    if (sourceFlag && !pathFlag) return errResult('thread open --source requires --file', 2);
    if (lineFlag && !pathFlag) return errResult('thread open --line requires --file', 2);
    if (sourceFlag && sourceFlag !== 'workspace' && sourceFlag !== 'thread-storage') {
      return errResult("thread open --source must be 'workspace' or 'thread-storage'", 2);
    }
    const lineNumber = lineFlag ? Number(lineFlag) : null;
    if (lineFlag && (!Number.isInteger(lineNumber) || (lineNumber ?? 0) < 1)) {
      return errResult('thread open --line must be a positive integer', 2);
    }
    const opened = await productRequest<unknown>(
      'POST',
      `/api/v1/threads/${encodeURIComponent(id)}/open`,
      {
        deps,
        body: pathFlag
          ? {
              file: {
                source: sourceFlag === 'thread-storage' ? 'thread-storage' : 'workspace',
                path: pathFlag,
                lineNumber
              }
            }
          : {}
      }
    );
    if (!opened.ok) return opened.result;
    return renderOrJson(json, opened.data, `${id} opened\n`);
  }

  if (subcommand === 'interactions') {
    const id = rest[0];
    if (!id) return errResult('thread interactions requires a <threadId>', 2);
    const listed = await productRequest<unknown>(
      'GET',
      `/api/v1/threads/${encodeURIComponent(id)}/interactions`,
      { deps }
    );
    if (!listed.ok) return listed.result;
    return renderOrJson(json, listed.data, `${JSON.stringify(listed.data, null, 2)}\n`);
  }

  return errResult(
    `unknown thread command '${subcommand}'. Try list, spawn, show, log, tell, wait, background, stop, fork, archive, unarchive, open, interactions.`,
    2
  );
}

export async function runSpawnAlias(
  rest: string[],
  json: boolean,
  deps?: ProductHttpDeps,
  dataDir = '.'
): Promise<CliResult> {
  const result = await spawnThreadCommand(rest, json, deps, dataDir);
  return deprecation('`zcc run` is deprecated; use `zcc thread spawn`', result);
}

export async function runTellAlias(
  handle: string | undefined,
  message: string,
  json: boolean,
  deps?: ProductHttpDeps
): Promise<CliResult> {
  if (!handle || !message) return errResult('agent send requires <threadId> and a message', 2);
  const result = await runThreadCommand('tell', [handle, message], json, deps);
  return deprecation('`zcc agent send` is deprecated; use `zcc thread tell`', result);
}
