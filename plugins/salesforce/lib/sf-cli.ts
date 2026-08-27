import { execFile as execFileCb } from 'node:child_process';
import {
  DEFAULT_API_VERSION,
  SF_CLI_TIMEOUT_MS,
  SF_REST_TIMEOUT_MS,
  type ExecResult,
  type ExecSfOptions,
  type ResolvedOrg,
  type SalesforceRequest,
  type SalesforceResponse
} from './types.js';
import { classifyOrgKind } from './org-resolution.js';
import { readJsonObject } from './dx-project.js';

const MAX_BUFFER = 2_000_000;

export function createExecSf(): (args: string[], opts?: ExecSfOptions) => Promise<ExecResult> {
  return (args, opts) =>
    new Promise((resolve) => {
      execFileCb(
        'sf',
        args,
        {
          timeout: opts?.timeoutMs ?? SF_CLI_TIMEOUT_MS,
          maxBuffer: MAX_BUFFER,
          windowsHide: true,
          ...(opts?.cwd ? { cwd: opts.cwd } : {})
        },
        (error, stdout, stderr) => {
          resolve({
            code: execCode(error),
            stdout: stdout ?? '',
            stderr: stderr ?? ''
          });
        }
      );
    });
}

function execCode(error: Error | null): number {
  if (!error) return 0;
  const raw = (error as NodeJS.ErrnoException).code;
  if (raw === 'ENOENT') return 127;
  if (typeof raw === 'number') return raw;
  const status = (error as { status?: unknown }).status;
  if (typeof status === 'number') return status;
  return 1;
}

export function createContainedSpawner(): (
  bin: string,
  argv: string[],
  cwd: string
) => Promise<ExecResult> {
  return (bin, argv, cwd) =>
    new Promise((resolve) => {
      execFileCb(
        bin,
        argv,
        { timeout: SF_CLI_TIMEOUT_MS, maxBuffer: MAX_BUFFER, windowsHide: true, cwd },
        (error, stdout, stderr) => {
          resolve({
            code: execCode(error),
            stdout: stdout ?? '',
            stderr: stderr ?? ''
          });
        }
      );
    });
}

export async function salesforceRestRequest(
  conn: ResolvedOrg,
  req: SalesforceRequest
): Promise<SalesforceResponse> {
  const path = req.path.startsWith('/') ? req.path : `/${req.path}`;
  const version = (req.apiVersion || conn.apiVersion).replace(/^v/i, '') || DEFAULT_API_VERSION;
  const url = new URL(`/services/data/v${version}${path}`, conn.instanceUrl);
  for (const [key, value] of Object.entries(req.query ?? {})) {
    url.searchParams.set(key, value);
  }
  const res = await fetch(url, {
    method: req.method,
    headers: {
      Authorization: `Bearer ${conn.accessToken}`,
      Accept: 'application/json',
      ...(req.body !== undefined ? { 'Content-Type': 'application/json' } : {})
    },
    body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
    signal: AbortSignal.timeout(SF_REST_TIMEOUT_MS)
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

function stringField(row: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function boolField(row: Record<string, unknown>, key: string): boolean | undefined {
  const value = row[key];
  return typeof value === 'boolean' ? value : undefined;
}

export interface ListedOrg {
  alias: string;
  username: string;
  kind: ReturnType<typeof classifyOrgKind>;
  isDefault: boolean;
}

export function parseOrgList(stdout: string): ListedOrg[] {
  const root = readJsonObject(stdout);
  const result = root?.result;
  const buckets: unknown[] = [];
  if (Array.isArray(result)) {
    buckets.push(...result);
  } else if (result && typeof result === 'object') {
    for (const value of Object.values(result as Record<string, unknown>)) {
      if (Array.isArray(value)) buckets.push(...value);
    }
  }
  const out: ListedOrg[] = [];
  for (const entry of buckets) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const username = stringField(row, 'username', 'userName');
    const alias = stringField(row, 'alias') || username;
    if (!username && !alias) continue;
    out.push({
      alias,
      username,
      kind: classifyOrgKind({
        isScratchOrg: boolField(row, 'isScratchOrg'),
        isScratch: boolField(row, 'isScratch'),
        isSandbox: boolField(row, 'isSandbox'),
        instanceUrl: stringField(row, 'instanceUrl', 'loginUrl')
      }),
      isDefault: boolField(row, 'isDefaultUsername') === true || boolField(row, 'isDefaultDevHubUsername') === true
    });
  }
  return out;
}

export function parseCliVersion(stdout: string): string | null {
  const line = stdout.trim().split('\n')[0]?.trim() ?? '';
  return line || null;
}

export function parseOrgDisplay(stdout: string, fallbackAlias: string, fallbackApiVersion: string): ResolvedOrg | null {
  const root = readJsonObject(stdout);
  const result = root?.result;
  if (!result || typeof result !== 'object') return null;
  const row = result as Record<string, unknown>;
  const username = stringField(row, 'username');
  const instanceUrl = stringField(row, 'instanceUrl');
  const accessToken = stringField(row, 'accessToken');
  if (!username || !instanceUrl || !accessToken) return null;
  const alias = stringField(row, 'alias') || fallbackAlias || username;
  const orgId = stringField(row, 'orgId', 'id');
  const apiVersion = stringField(row, 'apiVersion') || fallbackApiVersion || DEFAULT_API_VERSION;
  return {
    alias,
    username,
    orgId,
    instanceUrl: instanceUrl.replace(/\/+$/, ''),
    accessToken,
    apiVersion: apiVersion.replace(/^v/i, ''),
    kind: classifyOrgKind({
      isScratchOrg: boolField(row, 'isScratchOrg'),
      isScratch: boolField(row, 'isScratch'),
      isSandbox: boolField(row, 'isSandbox'),
      instanceUrl
    }),
    isDefault: boolField(row, 'isDefaultUsername') === true
  };
}

export function defaultCliAlias(listed: ListedOrg[]): string | null {
  return listed.find((row) => row.isDefault)?.alias ?? listed[0]?.alias ?? null;
}
