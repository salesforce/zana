import { deprecation, errResult, type CliResult } from '../cli-result.js';
import { flagValue, hasFlag, stripFlags } from '../flag-parse.js';
import {
  nowMs,
  productRequest,
  renderOrJson,
  sleepMs,
  type ProductHttpDeps
} from '../product-http.js';

interface TerminalRow {
  id?: string;
  projectId?: string;
  title?: string;
  status?: string;
  cwd?: string;
  pid?: number;
  launchCommand?: string;
  exitCode?: number;
}

function sessionsFrom(data: unknown): TerminalRow[] {
  if (Array.isArray(data)) return data as TerminalRow[];
  if (data && typeof data === 'object' && Array.isArray((data as { sessions?: unknown }).sessions)) {
    return (data as { sessions: TerminalRow[] }).sessions;
  }
  return [];
}

function formatSession(row: TerminalRow): string {
  return `${row.id ?? '?'}\t${row.status ?? '?'}\t${row.projectId ?? '-'}\t${row.title ?? ''}`;
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

export async function runTerminalCommand(
  subcommand: string | undefined,
  rest: string[],
  json: boolean,
  deps?: ProductHttpDeps
): Promise<CliResult> {
  if (!subcommand || subcommand === 'list' || subcommand === 'ls') {
    const projectId = flagValue(rest, '--project');
    const listed = await productRequest<unknown>('GET', '/api/v1/terminals', { deps });
    if (!listed.ok) return listed.result;
    let sessions = sessionsFrom(listed.data);
    if (projectId) sessions = sessions.filter((row) => row.projectId === projectId);
    if (json) return renderOrJson(true, sessions, '');
    if (sessions.length === 0) return renderOrJson(false, sessions, 'No terminals\n');
    return renderOrJson(false, sessions, `${sessions.map(formatSession).join('\n')}\n`);
  }

  if (subcommand === 'create') {
    const projectId = flagValue(rest, '--project') ?? flagValue(rest, '--thread');
    const command = flagValue(rest, '--command');
    const title = flagValue(rest, '--title');
    if (!projectId) return errResult('terminal create requires --project <id>', 2);
    const created = await productRequest<{ ok?: boolean; value?: TerminalRow }>('POST', '/api/v1/terminals', {
      deps,
      body: { projectId, title, command, prompt: command, profile: 'shell' }
    });
    if (!created.ok) return created.result;
    const row = created.data.value;
    return renderOrJson(json, created.data, row ? `${formatSession(row)}\n` : 'ok\n');
  }

  if (subcommand === 'show') {
    const id = rest[0];
    if (!id) return errResult('terminal show requires <id>', 2);
    const shown = await productRequest<{ session?: TerminalRow }>(
      'GET',
      `/api/v1/terminals/${encodeURIComponent(id)}`,
      { deps }
    );
    if (!shown.ok) return shown.result;
    const row = shown.data.session ?? (shown.data as TerminalRow);
    return renderOrJson(json, row, `${formatSession(row)}\n`);
  }

  if (subcommand === 'output') {
    const tailBytes = flagValue(rest, '--tail-bytes');
    const id = stripFlags(rest, ['--tail-bytes'], [])[0];
    if (!id) return errResult('terminal output requires <id>', 2);
    const output = await productRequest<{ text?: string; truncated?: boolean }>(
      'GET',
      `/api/v1/terminals/${encodeURIComponent(id)}/output`,
      { deps, query: { tailBytes } }
    );
    if (!output.ok) return output.result;
    if (json) return renderOrJson(true, output.data, '');
    return renderOrJson(false, output.data, output.data.text ?? '');
  }

  if (subcommand === 'wait') {
    const timeoutRaw = flagValue(rest, '--timeout') ?? '2m';
    const timeoutMs = parseDuration(timeoutRaw);
    if (timeoutMs === undefined) return errResult(`invalid --timeout '${timeoutRaw}'`, 2);
    const contains = flagValue(rest, '--contains');
    const waitExit = hasFlag(rest, '--exit') || !contains;
    const id = stripFlags(rest, ['--timeout', '--contains'], ['--exit'])[0];
    if (!id) return errResult('terminal wait requires <id>', 2);
    const deadline = nowMs(deps) + timeoutMs;
    let sawContains = !contains;
    let last: TerminalRow | undefined;
    while (nowMs(deps) < deadline) {
      const shown = await productRequest<{ session?: TerminalRow }>(
        'GET',
        `/api/v1/terminals/${encodeURIComponent(id)}`,
        { deps }
      );
      if (!shown.ok) {
        if (shown.result.exitCode === 3) return shown.result;
        await sleepMs(500, deps);
        continue;
      }
      last = shown.data.session ?? (shown.data as TerminalRow);
      if (contains && !sawContains) {
        const output = await productRequest<{ text?: string }>(
          'GET',
          `/api/v1/terminals/${encodeURIComponent(id)}/output`,
          { deps }
        );
        if (output.ok && (output.data.text ?? '').includes(contains)) {
          sawContains = true;
        }
      }
      const exited = last.status === 'exited';
      if (sawContains && (!waitExit || exited)) {
        return renderOrJson(json, last, `${id} ${last.status ?? ''}\n`);
      }
      if (exited && contains && !sawContains) {
        return errResult(`terminal ${id} exited without matching output`, 1);
      }
      await sleepMs(500, deps);
    }
    return {
      exitCode: 124,
      stdout: '',
      stderr: `Error: timed out waiting for terminal ${id}\n`
    };
  }

  if (subcommand === 'send') {
    const id = rest[0];
    const text = flagValue(rest, '--text') ?? rest.slice(1).join(' ').trim();
    if (!id || !text) return errResult('terminal send requires <id> and --text', 2);
    const sent = await productRequest<unknown>('POST', `/api/v1/terminals/${encodeURIComponent(id)}/input`, {
      deps,
      body: { data: text }
    });
    if (!sent.ok) return sent.result;
    return renderOrJson(json, sent.data, 'ok\n');
  }

  if (subcommand === 'close') {
    const id = rest[0];
    if (!id) return errResult('terminal close requires <id>', 2);
    const closed = await productRequest<unknown>('POST', `/api/v1/terminals/${encodeURIComponent(id)}/close`, {
      deps,
      body: {}
    });
    if (!closed.ok) return closed.result;
    return renderOrJson(json, closed.data, `${id} closed\n`);
  }

  return errResult(
    `unknown terminal command '${subcommand}'. Try list, create, show, output, wait, send, close.`,
    2
  );
}

export async function runTermListAlias(
  rest: string[],
  json: boolean,
  deps?: ProductHttpDeps
): Promise<CliResult> {
  const result = await runTerminalCommand('list', rest, json, deps);
  return deprecation('`zcc term` is deprecated; use `zcc terminal`', result);
}

export async function runTermCloseAlias(
  id: string | undefined,
  json: boolean,
  deps?: ProductHttpDeps
): Promise<CliResult> {
  const result = await runTerminalCommand('close', id ? [id] : [], json, deps);
  return deprecation('`zcc term close` is deprecated; use `zcc terminal close`', result);
}
