import { ControlError } from './errors.js';
import type { ProductHttpClient } from './http.js';
import { hostIsConnected, listHosts } from './hosts.js';

export interface HarnessVerifyRow {
  family?: string;
  label?: string;
  enabled?: boolean;
  installed?: boolean;
  binary?: string;
}

export async function listHarnessVerify(http: ProductHttpClient, hostId?: string): Promise<HarnessVerifyRow[]> {
  const listed = await http.request<{ results?: HarnessVerifyRow[] }>(
    'GET',
    '/api/v1/harness/verify',
    {query:{hostId}}
  );
  return listed.results ?? [];
}

export async function preflight(
  http: ProductHttpClient,
  opts: { surface: 'thread' | 'cli-agent'; providerId?: string; profile?: string; hostId?: string }
): Promise<HarnessVerifyRow> {
  let results: HarnessVerifyRow[];
  try { results = await listHarnessVerify(http, opts.hostId); }
  catch (error) {
    if (opts.hostId || !(error instanceof ControlError) || !/ambiguous.host/i.test(error.message)) throw error;
    const primary = (await listHosts(http)).find(host => host.isPrimary);
    if (!primary) throw error;
    results = await listHarnessVerify(http, primary.id);
  }
  const needle = (opts.profile ?? opts.providerId ?? '').toLowerCase();
  const family = needle.replace(/^acp-/, '').replace(/-code$/, '').split('-')[0];
  const row = results.find((entry) =>
    (entry.family ?? '').toLowerCase() === family
    || (entry.label ?? '').toLowerCase().includes(family)
  );
  if (!row) {
    throw new ControlError('PREFLIGHT', `no harness descriptor for ${needle || opts.surface}`, {
      details: results
    });
  }
  if (row.enabled === false || row.installed === false) {
    throw new ControlError(
      'PREFLIGHT',
      `${row.family ?? needle} is not available (enabled=${row.enabled} installed=${row.installed})`,
      { details: row }
    );
  }
  return row;
}

export async function health(http: ProductHttpClient): Promise<{ ok: boolean; hostConnected: boolean }> {
  const ping = await http.request<{ ok?: boolean }>('GET', '/api/v1/health');
  let hostConnected = false;
  try {
    hostConnected = (await listHosts(http)).some(hostIsConnected);
  } catch {
    hostConnected = false;
  }
  return { ok: ping.ok === true, hostConnected };
}
