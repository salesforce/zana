import { deprecation, errResult, type CliResult } from '../cli-result.js';
import { flagValue, hasFlag, splitSentinel, stripFlags } from '../flag-parse.js';
import {
  nowMs,
  productRequest,
  renderOrJson,
  sleepMs,
  type ProductHttpDeps
} from '../product-http.js';

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

async function waitForThread(
  id: string,
  timeoutMs: number,
  json: boolean,
  deps?: ProductHttpDeps
): Promise<CliResult> {
  const deadline = nowMs(deps) + timeoutMs;
  while (nowMs(deps) < deadline) {
    const shown = await productRequest<{ thread: ThreadRow }>(
      'GET',
      `/api/v1/threads/${encodeURIComponent(id)}`,
      { deps }
    );
    if (!shown.ok) {
      if (shown.result.exitCode === 3) return shown.result;
      await sleepMs(500, deps);
      continue;
    }
    const status = shown.data.thread?.status ?? '';
    if (status === 'idle' || status === 'error') {
      return renderOrJson(json, shown.data.thread, `${id} ${status}\n`);
    }
    await sleepMs(500, deps);
  }
  return {
    exitCode: 124,
    stdout: '',
    stderr: `Error: timed out waiting for thread ${id}; it is still running\n`
  };
}

async function spawnThread(
  args: string[],
  json: boolean,
  deps?: ProductHttpDeps
): Promise<CliResult> {
  const { head, tail } = splitSentinel(args);
  const wait = hasFlag(head, '--wait');
  const detach = hasFlag(head, '--detach');
  if (wait && detach) return errResult('--wait and --detach are mutually exclusive', 2);
  const timeoutRaw = flagValue(head, '--timeout') ?? '5m';
  const timeoutMs = parseDuration(timeoutRaw);
  if (timeoutMs === undefined) return errResult(`invalid --timeout '${timeoutRaw}'`, 2);
  const projectId = flagValue(head, '--project')
    ?? stripFlags(head, [
      '--project', '--prompt', '--provider', '--model', '--host', '--permission-mode', '--title', '--timeout'
    ], ['--wait', '--detach', '--json'])[0];
  const promptFromFlag = flagValue(head, '--prompt');
  const positional = stripFlags(head, [
    '--project', '--prompt', '--provider', '--model', '--host', '--permission-mode', '--title', '--timeout'
  ], ['--wait', '--detach', '--json']);
  const promptParts = tail.length > 0
    ? tail
    : promptFromFlag
      ? [promptFromFlag]
      : positional.slice(projectId && positional[0] === projectId ? 1 : (flagValue(head, '--project') ? 0 : 1));
  const prompt = promptParts.join(' ').trim();
  if (!projectId) return errResult('thread spawn requires --project <id> (or a project positional)', 2);
  if (!prompt) return errResult('thread spawn requires --prompt or a prompt positional', 2);
  const created = await productRequest<{ ok?: boolean; thread?: ThreadRow; value?: ThreadRow }>(
    'POST',
    '/api/v1/threads',
    {
      deps,
      body: {
        projectId,
        prompt,
        providerId: flagValue(head, '--provider') ?? 'claude-code',
        model: flagValue(head, '--model'),
        hostId: flagValue(head, '--host'),
        permissionMode: flagValue(head, '--permission-mode'),
        title: flagValue(head, '--title')
      }
    }
  );
  if (!created.ok) return created.result;
  const row = created.data.thread ?? created.data.value;
  if (!row?.id) return errResult('thread spawn did not return an id');
  if (!wait) {
    return renderOrJson(json, row, `${row.id}\t${row.status ?? 'starting'}\n`);
  }
  return waitForThread(row.id, timeoutMs, json, deps);
}

export async function runThreadCommand(
  subcommand: string | undefined,
  rest: string[],
  json: boolean,
  deps?: ProductHttpDeps
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

  if (subcommand === 'spawn') return spawnThread(rest, json, deps);

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
    const id = rest[0];
    if (!id) return errResult('thread wait requires a <threadId>', 2);
    const timeoutRaw = flagValue(rest, '--timeout') ?? '20m';
    const timeoutMs = parseDuration(timeoutRaw);
    if (timeoutMs === undefined) return errResult(`invalid --timeout '${timeoutRaw}'`, 2);
    return waitForThread(id, timeoutMs, json, deps);
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
    const id = rest[0];
    if (!id) return errResult('thread open requires a <threadId>', 2);
    const opened = await productRequest<unknown>(
      'POST',
      `/api/v1/threads/${encodeURIComponent(id)}/open`,
      { deps, body: {} }
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
    `unknown thread command '${subcommand}'. Try list, spawn, show, log, tell, wait, stop, fork, archive, unarchive, open, interactions.`,
    2
  );
}

export async function runSpawnAlias(
  rest: string[],
  json: boolean,
  deps?: ProductHttpDeps
): Promise<CliResult> {
  const result = await spawnThread(rest, json, deps);
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
