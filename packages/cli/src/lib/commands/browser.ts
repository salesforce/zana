import { writeFile } from 'node:fs/promises';
import { errResult, type CliResult } from '../cli-result.js';
import { flagValue, hasFlag, stripFlags } from '../flag-parse.js';
import { productRequest, renderOrJson, type ProductHttpDeps } from '../product-http.js';

const SCOPE_FLAGS = ['--host', '--instance', '--generation', '--thread'] as const;

type Scope = {
  hostId: string;
  instanceId: string;
  generation: string;
  threadId: string;
};

function missing(...flags: string[]): CliResult {
  return errResult(`missing ${flags.join(', ')}`, 2);
}

function requireScope(args: string[]): { ok: true; scope: Scope } | { ok: false; result: CliResult } {
  const hostId = flagValue(args, '--host');
  const instanceId = flagValue(args, '--instance');
  const generation = flagValue(args, '--generation');
  const threadId = flagValue(args, '--thread');
  const absent = [
    hostId ? null : '--host',
    instanceId ? null : '--instance',
    generation ? null : '--generation',
    threadId ? null : '--thread'
  ].filter((flag): flag is string => flag !== null);
  if (absent.length > 0) return { ok: false, result: missing(...absent) };
  return {
    ok: true,
    scope: { hostId: hostId!, instanceId: instanceId!, generation: generation!, threadId: threadId! }
  };
}

function requireInstance(args: string[]):
  | { ok: true; scope: { hostId: string; instanceId: string; generation: string } }
  | { ok: false; result: CliResult } {
  const hostId = flagValue(args, '--host');
  const instanceId = flagValue(args, '--instance');
  const generation = flagValue(args, '--generation');
  const absent = [
    hostId ? null : '--host',
    instanceId ? null : '--instance',
    generation ? null : '--generation'
  ].filter((flag): flag is string => flag !== null);
  if (absent.length > 0) return { ok: false, result: missing(...absent) };
  return { ok: true, scope: { hostId: hostId!, instanceId: instanceId!, generation: generation! } };
}

function parseImportTarget(
  value: string | undefined
): { kind: 'personal' } | { kind: 'automation'; id: string } | CliResult {
  if (value === undefined || value === 'personal') return { kind: 'personal' };
  const match = /^automation:(.+)$/.exec(value);
  if (!match) return errResult('Expected --into personal or --into automation:<profile-id>', 2);
  return { kind: 'automation', id: match[1]! };
}

interface TabRow {
  tabId?: string;
  title?: string;
  url?: string;
  control?: { controllerLabel?: string } | null;
}

function formatTabs(tabs: TabRow[]): string {
  return tabs
    .map((tab) => `${tab.tabId ?? '?'}  ${tab.title || tab.url || ''}  ${tab.control?.controllerLabel ?? 'Available'}`)
    .join('\n') || 'No browser tabs in this thread';
}

export function formatImportSources(result: {
  sources?: Array<{
    id?: string;
    unavailable?: string;
    profiles?: Array<{ directory?: string; name?: string; cookieCount?: number }>;
  }>;
}): string {
  const lines = (result.sources ?? []).map((source) => {
    const status = source.unavailable ?? 'ready';
    const profiles = (source.profiles ?? [])
      .map((profile) => {
        const directory = profile.directory ?? '';
        const name = profile.name === directory ? '' : ` "${profile.name}"`;
        const count = profile.cookieCount === undefined ? '' : ` (${profile.cookieCount})`;
        return `${directory}${name}${count}`;
      })
      .join(', ');
    return `${source.id ?? '?'}  ${status}  ${profiles}`.trimEnd();
  });
  return lines.join('\n') || 'No importable browsers found';
}

export function formatImportOutcome(outcome: {
  ok?: boolean;
  imported?: number;
  skipped?: number;
  skippedDomains?: string[];
  reason?: string;
}): string {
  if (!outcome.ok) return `Import failed: ${outcome.reason ?? 'unknown'}`;
  const skipped = (outcome.skipped ?? 0) > 0
    ? `, skipped ${outcome.skipped}${
      outcome.skippedDomains && outcome.skippedDomains.length > 0
        ? ` (${outcome.skippedDomains.join(', ')})`
        : ''
    }`
    : '';
  return `Imported ${outcome.imported ?? 0} cookies${skipped}`;
}

async function postJson<T>(
  path: string,
  body: unknown,
  json: boolean,
  deps: ProductHttpDeps | undefined,
  human: (data: T) => string
): Promise<CliResult> {
  const result = await productRequest<T>('POST', path, { deps, body });
  if (!result.ok) return result.result;
  return renderOrJson(json, result.data, `${human(result.data)}\n`);
}

export async function runBrowserCommand(
  subcommand: string | undefined,
  rest: string[],
  json: boolean,
  deps?: ProductHttpDeps
): Promise<CliResult> {
  if (!subcommand || subcommand === 'help') {
    return errResult(
      'browser requires a verb. Try instances, tabs, create, acquire, connection, release, reveal, capture, close, watch, import-sources, import-cookies.',
      2
    );
  }

  if (subcommand === 'instances') {
    const hostId = flagValue(rest, '--host');
    if (!hostId) return missing('--host');
    return postJson(
      '/api/v1/desktop-browsers/instances',
      { hostId },
      json,
      deps,
      (data: { instances?: Array<{ instanceId?: string; generation?: string; label?: string }> }) =>
        (data.instances ?? [])
          .map((instance) => `${instance.instanceId ?? '?'}  ${instance.generation ?? '?'}  ${instance.label ?? ''}`)
          .join('\n') || 'No connected desktop windows'
    );
  }

  if (subcommand === 'import-sources') {
    const scoped = requireInstance(rest);
    if (!scoped.ok) return scoped.result;
    return postJson(
      '/api/v1/desktop-browsers/import-sources',
      scoped.scope,
      json,
      deps,
      formatImportSources
    );
  }

  if (subcommand === 'import-cookies') {
    const scoped = requireInstance(rest);
    if (!scoped.ok) return scoped.result;
    const sourceId = flagValue(rest, '--from');
    const sourceProfileDirectory = flagValue(rest, '--profile');
    if (!sourceId || !sourceProfileDirectory) return missing('--from', '--profile');
    const profile = parseImportTarget(flagValue(rest, '--into'));
    if ('exitCode' in profile) return profile;
    const result = await productRequest<{
      ok?: boolean;
      imported?: number;
      skipped?: number;
      skippedDomains?: string[];
      reason?: string;
    }>('POST', '/api/v1/desktop-browsers/import-cookies', {
      deps,
      body: { ...scoped.scope, sourceId, sourceProfileDirectory, profile }
    });
    if (!result.ok) return result.result;
    const printed = renderOrJson(json, result.data, `${formatImportOutcome(result.data)}\n`);
    if (result.data.ok === false) return { ...printed, exitCode: 1 };
    return printed;
  }

  const scoped = requireScope(rest);
  if (!scoped.ok) return scoped.result;
  const positional = stripFlags(rest, [...SCOPE_FLAGS, '--url', '--controller', '--ttl-ms', '--output'], [
    '--reveal',
    '--allow-personal'
  ]);

  if (subcommand === 'tabs') {
    return postJson('/api/v1/desktop-browsers/tabs', scoped.scope, json, deps, (data: { tabs?: TabRow[] }) =>
      formatTabs(data.tabs ?? []));
  }

  if (subcommand === 'create') {
    const url = flagValue(rest, '--url');
    const reveal = hasFlag(rest, '--reveal');
    return postJson(
      '/api/v1/desktop-browsers/create',
      {
        ...scoped.scope,
        ...(url ? { url } : {}),
        ...(reveal ? { presentation: 'reveal' } : {})
      },
      json,
      deps,
      (data: { tab?: { tabId?: string } }) => `Created tab ${data.tab?.tabId ?? '?'}`
    );
  }

  if (subcommand === 'acquire') {
    const controllerLabel = flagValue(rest, '--controller');
    if (!controllerLabel) return missing('--controller');
    const ttlRaw = flagValue(rest, '--ttl-ms');
    const ttlMs = ttlRaw === undefined ? undefined : Number(ttlRaw);
    if (ttlRaw !== undefined && (!Number.isInteger(ttlMs) || (ttlMs ?? 0) < 1000)) {
      return errResult('--ttl-ms must be an integer millisecond duration', 2);
    }
    return postJson(
      '/api/v1/desktop-browsers/acquire',
      {
        ...scoped.scope,
        tabIds: positional,
        controllerLabel,
        ...(ttlMs === undefined ? {} : { ttlMs }),
        ...(hasFlag(rest, '--allow-personal') ? { allowPersonal: true } : {})
      },
      json,
      deps,
      (data: { leaseId?: string; expiresAt?: number }) =>
        `Control lease ${data.leaseId ?? '?'} expires ${data.expiresAt ? new Date(data.expiresAt).toISOString() : '?'}`
    );
  }

  if (subcommand === 'connection') {
    const leaseId = positional[0];
    const output = flagValue(rest, '--output');
    if (!leaseId || !output) return missing('<leaseId>', '--output');
    const result = await productRequest<{ hostId: string; wsEndpoint: string; expiresAt: number }>(
      'POST',
      '/api/v1/desktop-browsers/connection',
      { deps, body: { ...scoped.scope, leaseId } }
    );
    if (!result.ok) return result.result;
    try {
      await writeFile(output, JSON.stringify(result.data), { mode: 0o600, flag: 'wx' });
    } catch (error) {
      return errResult(error instanceof Error ? error.message : String(error));
    }
    return renderOrJson(
      json,
      { path: output, hostId: result.data.hostId, expiresAt: result.data.expiresAt },
      `Wrote private connection to ${output}\n`
    );
  }

  if (subcommand === 'release') {
    const leaseId = positional[0];
    if (!leaseId) return missing('<leaseId>');
    return postJson('/api/v1/desktop-browsers/release', { ...scoped.scope, leaseId }, json, deps, () =>
      'Released browser control');
  }

  if (subcommand === 'reveal' || subcommand === 'close') {
    const tabId = positional[0];
    if (!tabId) return missing('<tabId>');
    return postJson(
      `/api/v1/desktop-browsers/${subcommand}`,
      { ...scoped.scope, tabId },
      json,
      deps,
      () => `${subcommand === 'close' ? 'Closed' : 'Revealed'} tab ${tabId}`
    );
  }

  if (subcommand === 'capture') {
    const tabId = positional[0];
    const output = flagValue(rest, '--output');
    if (!tabId || !output) return missing('<tabId>', '--output');
    const result = await productRequest<{ base64: string; mimeType?: string }>(
      'POST',
      '/api/v1/desktop-browsers/capture',
      { deps, body: { ...scoped.scope, tabId } }
    );
    if (!result.ok) return result.result;
    try {
      await writeFile(output, Buffer.from(result.data.base64, 'base64'), { flag: 'wx', mode: 0o600 });
    } catch (error) {
      return errResult(error instanceof Error ? error.message : String(error));
    }
    return renderOrJson(
      json,
      { path: output, mimeType: result.data.mimeType ?? 'image/jpeg' },
      `Saved screenshot to ${output}\n`
    );
  }

  if (subcommand === 'watch') {
    let previous = '';
    for (;;) {
      const result = await productRequest<{ tabs?: TabRow[] }>('POST', '/api/v1/desktop-browsers/tabs', {
        deps,
        body: scoped.scope
      });
      if (!result.ok) return result.result;
      const serialized = JSON.stringify(result.data);
      if (serialized !== previous) {
        previous = serialized;
        const printed = renderOrJson(json, result.data, `${formatTabs(result.data.tabs ?? [])}\n`);
        process.stdout.write(printed.stdout);
      }
      await (deps?.sleep ?? ((ms: number) => new Promise((resolve) => {
        setTimeout(resolve, ms);
      })))(2000);
    }
  }

  return errResult(
    `unknown browser command '${subcommand}'. Try instances, tabs, create, acquire, connection, release, reveal, capture, close, watch, import-sources, import-cookies.`,
    2
  );
}
