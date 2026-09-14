import { errResult, type CliResult } from '../cli-result.js';
import { flagValue, flagValues } from '../flag-parse.js';
import { productRequest, renderOrJson, type ProductHttpDeps } from '../product-http.js';

function formatProcess(row: { pid?: number; command?: string; cwd?: string }): string {
  return `${row.pid ?? '?'}\t${row.command || '-'}\t${row.cwd ?? ''}`;
}

export async function runEnvironmentCommand(
  subcommand: string | undefined,
  rest: string[],
  json: boolean,
  deps?: ProductHttpDeps
): Promise<CliResult> {
  if (subcommand === 'processes') {
    const action = rest[0] === 'kill' || rest[0] === 'list' ? rest[0] : 'list';
    const id = rest[0] === 'kill' || rest[0] === 'list' ? rest[1] : rest[0];
    if (!id) return errResult('environment processes requires <id>', 2);
    if (action === 'kill') {
      const pids = flagValues(rest, '--pid')
        .map((value) => Number(value))
        .filter((pid) => Number.isInteger(pid) && pid > 0);
      if (pids.length === 0) return errResult('environment processes kill requires --pid <pid>', 2);
      const killed = await productRequest<{ killed?: Array<{ pid?: number; command?: string; cwd?: string }> }>(
        'POST',
        `/api/v1/environments/${encodeURIComponent(id)}/processes/kill`,
        { deps, body: { pids } }
      );
      if (!killed.ok) return killed.result;
      const rows = killed.data.killed ?? [];
      if (json) return renderOrJson(true, killed.data, '');
      if (rows.length === 0) return renderOrJson(false, killed.data, 'No matching processes\n');
      return renderOrJson(false, killed.data, `${rows.map(formatProcess).join('\n')}\n`);
    }
    const listed = await productRequest<{
      processes?: Array<{ pid?: number; command?: string; cwd?: string }>;
      supported?: boolean;
    }>('GET', `/api/v1/environments/${encodeURIComponent(id)}/processes`, { deps });
    if (!listed.ok) return listed.result;
    if (json) return renderOrJson(true, listed.data, '');
    if (listed.data.supported === false) {
      return renderOrJson(false, listed.data, 'Process listing is not available on this host\n');
    }
    const rows = listed.data.processes ?? [];
    if (rows.length === 0) return renderOrJson(false, listed.data, 'No running processes\n');
    return renderOrJson(false, listed.data, `${rows.map(formatProcess).join('\n')}\n`);
  }

  const id = rest[0];
  if (!id) return errResult('environment commands require <id>', 2);

  if (subcommand === 'status' || subcommand === 'show') {
    const status = await productRequest<unknown>(
      'GET',
      `/api/v1/environments/${encodeURIComponent(id)}/status`,
      { deps }
    );
    if (!status.ok) return status.result;
    return renderOrJson(json, status.data, `${JSON.stringify(status.data, null, 2)}\n`);
  }

  if (subcommand === 'diff' || subcommand === 'diff-files') {
    const path = subcommand === 'diff-files'
      ? `/api/v1/environments/${encodeURIComponent(id)}/diff/files`
      : `/api/v1/environments/${encodeURIComponent(id)}/diff`;
    const diff = await productRequest<unknown>('GET', path, {
      deps,
      query: { target: flagValue(rest, '--target') }
    });
    if (!diff.ok) return diff.result;
    return renderOrJson(json, diff.data, `${JSON.stringify(diff.data, null, 2)}\n`);
  }

  if (subcommand === 'pull-request') {
    const pr = await productRequest<unknown>(
      'GET',
      `/api/v1/environments/${encodeURIComponent(id)}/pull-request`,
      { deps }
    );
    if (!pr.ok) return pr.result;
    return renderOrJson(json, pr.data, `${JSON.stringify(pr.data, null, 2)}\n`);
  }

  return errResult(
    `unknown environment command '${subcommand}'. Try status, diff, diff-files, pull-request, processes.`,
    2
  );
}
