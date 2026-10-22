import { redactMachineDiagnostic } from '@zana-ai/zcc-domain/machine-pairing';
import { errResult, type CliResult } from '../cli-result.js';
import { flagValue, stripFlags } from '../flag-parse.js';
import { productRequest, renderOrJson, type ProductHttpDeps } from '../product-http.js';

/** Uses the same main-authorized installation path as the desktop, including enrollment. */
export async function runMachineConnection(command: string, args: string[], json: boolean, deps?: ProductHttpDeps): Promise<CliResult> {
  let path: string;
  let body: unknown;
  if (command === 'repair') {
    if (args.length !== 1 || !args[0] || args[0].startsWith('-')) return errResult('machine repair requires <host-id>', 2);
    path = `/api/v1/hosts/${encodeURIComponent(args[0])}/repair`;
    body = {};
  } else {
    const projectId = flagValue(args, '--project');
    const host = flagValue(args, '--ssh');
    const user = flagValue(args, '--user');
    const extras = stripFlags(args, ['--project', '--ssh', '--user'], []);
    const missingValue = args.some(arg => ['--project', '--ssh', '--user'].includes(arg) && !flagValue(args, arg));
    if (extras.length || missingValue || Boolean(projectId) === Boolean(host) || (user && !host)) {
      return errResult('machine connect requires --project <id> or --ssh <alias> [--user <user>]', 2);
    }
    path = '/api/v1/hosts/bootstrap';
    body = projectId ? { projectId } : { ssh: { host, ...(user ? { user } : {}) } };
  }
  try {
    const response = await productRequest<unknown>('POST', path, { body, deps, signal: AbortSignal.timeout(360_000) });
    if (!response.ok) return response.result;
    const raw = typeof response.data === 'string'
      ? response.data.split('\n').filter(line => line.trim()).map(line => JSON.parse(line) as unknown)
      : [response.data];
    if (!raw.length || raw.some(row => !row || typeof row !== 'object' || !['log', 'stage', 'error', 'done'].includes((row as { type: string }).type))) {
      return errResult('Invalid machine connection response. Inspect the machine status before retrying.');
    }
    // Pairing commands contain one-time credentials; the CLI keeps them inside main.
    const events = raw.map(row => Object.fromEntries(Object.entries(row as Record<string, unknown>)
      .filter(([key]) => ['type', 'stage', 'status', 'reason', 'limitMs', 'message', 'text', 'code', 'hostId'].includes(key))
      .map(([key, value]) => [key, typeof value === 'string' ? redactMachineDiagnostic(value) : value])));
    const failure = events.find(row => row.type === 'error');
    const done = events.find(row => row.type === 'done' && typeof row.hostId === 'string');
    const ok = !failure && Boolean(done);
    const error = ok ? undefined : String(failure?.message ?? 'The machine did not finish connecting.');
    const result = renderOrJson(json, { ok, ...(done ? { hostId: done.hostId } : {}), ...(error ? { error } : {}), events: events.slice(-400) },
      events.map(row => row.type === 'log' ? row.text : row.type === 'stage' ? `${row.stage}: ${row.status}${row.reason ? ` — ${row.reason}` : ''}` : row.type === 'done' ? `Connected: ${row.hostId}` : row.message).join('\n'));
    return { ...result, exitCode: ok ? 0 : 1, ...(error ? { stderr: `Error: ${error}\n` } : {}) };
  } catch {
    return errResult('Invalid or interrupted machine connection response. Inspect the machine status before retrying.');
  }
}
