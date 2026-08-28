import { errResult, type CliResult } from '../cli-result.js';
import { productRequest, renderOrJson, type ProductHttpDeps } from '../product-http.js';

interface HostRow {
  id?: string;
  name?: string;
  connected?: boolean;
  lastSeenAt?: number | null;
  status?: string;
}

function rowsFrom(data: unknown): HostRow[] {
  if (Array.isArray(data)) return data as HostRow[];
  if (data && typeof data === 'object' && Array.isArray((data as { hosts?: unknown }).hosts)) {
    return (data as { hosts: HostRow[] }).hosts;
  }
  return [];
}

function formatHost(row: HostRow): string {
  const connected = row.connected === true ? 'connected' : (row.status ?? 'offline');
  return `${row.id ?? '?'}\t${row.name ?? '?'}\t${connected}`;
}

export async function runMachineCommand(
  subcommand: string | undefined,
  rest: string[],
  json: boolean,
  deps?: ProductHttpDeps
): Promise<CliResult> {
  if (!subcommand || subcommand === 'list' || subcommand === 'ls') {
    const listed = await productRequest<unknown>('GET', '/api/v1/hosts', { deps });
    if (!listed.ok) return listed.result;
    const hosts = rowsFrom(listed.data);
    if (json) return renderOrJson(true, listed.data, '');
    if (hosts.length === 0) return renderOrJson(false, listed.data, 'No machines\n');
    return renderOrJson(false, listed.data, `${hosts.map(formatHost).join('\n')}\n`);
  }

  if (subcommand === 'show') {
    const id = rest[0];
    if (!id) return errResult('machine show requires <id-or-name>', 2);
    const shown = await productRequest<HostRow>('GET', `/api/v1/hosts/${encodeURIComponent(id)}`, { deps });
    if (!shown.ok) return shown.result;
    return renderOrJson(json, shown.data, `${formatHost(shown.data)}\n`);
  }

  if (subcommand === 'join-code') {
    const minted = await productRequest<unknown>('POST', '/api/v1/hosts/join-codes', { deps, body: {} });
    if (!minted.ok) return minted.result;
    return renderOrJson(json, minted.data, `${JSON.stringify(minted.data, null, 2)}\n`);
  }

  if (subcommand === 'rename') {
    const id = rest[0];
    const name = rest.slice(1).join(' ').trim();
    if (!id || !name) return errResult('machine rename requires <id> <name>', 2);
    const renamed = await productRequest<HostRow>('PATCH', `/api/v1/hosts/${encodeURIComponent(id)}`, {
      deps,
      body: { name }
    });
    if (!renamed.ok) return renamed.result;
    return renderOrJson(json, renamed.data, `${formatHost(renamed.data)}\n`);
  }

  if (subcommand === 'remove') {
    const id = rest[0];
    if (!id) return errResult('machine remove requires <id>', 2);
    const removed = await productRequest<unknown>('DELETE', `/api/v1/hosts/${encodeURIComponent(id)}`, { deps });
    if (!removed.ok) return removed.result;
    return renderOrJson(json, removed.data, `${id} removed\n`);
  }

  if (subcommand === 'provider-cli') {
    const action = rest[0];
    const id = rest[1];
    if ((action !== 'status' && action !== 'install') || !id) {
      return errResult('machine provider-cli status|install <id> [provider]', 2);
    }
    if (action === 'status') {
      const status = await productRequest<unknown>(
        'GET',
        `/api/v1/hosts/${encodeURIComponent(id)}/provider-clis/status`,
        { deps }
      );
      if (!status.ok) return status.result;
      return renderOrJson(json, status.data, `${JSON.stringify(status.data, null, 2)}\n`);
    }
    const provider = rest[2];
    if (!provider) return errResult('machine provider-cli install requires a provider id', 2);
    const installed = await productRequest<unknown>(
      'POST',
      `/api/v1/hosts/${encodeURIComponent(id)}/provider-clis/install`,
      { deps, body: { provider } }
    );
    if (!installed.ok) return installed.result;
    return renderOrJson(json, installed.data, `${JSON.stringify(installed.data, null, 2)}\n`);
  }

  return errResult(
    `unknown machine command '${subcommand}'. Try list, show, join-code, rename, remove, provider-cli.`,
    2
  );
}
