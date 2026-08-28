import { deprecation, errResult, type CliResult } from '../cli-result.js';
import { flagValue } from '../flag-parse.js';
import { productRequest, renderOrJson, type ProductHttpDeps } from '../product-http.js';

interface TerminalRow {
  id?: string;
  projectId?: string;
  title?: string;
  status?: string;
  cwd?: string;
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
      body: { projectId, title, prompt: command, profile: 'shell' }
    });
    if (!created.ok) return created.result;
    const row = created.data.value;
    return renderOrJson(json, created.data, row ? `${formatSession(row)}\n` : 'ok\n');
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
    `unknown terminal command '${subcommand}'. Try list, create, send, close.`,
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
