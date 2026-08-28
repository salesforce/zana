import { errResult, jsonResult, textResult, type CliResult } from './cli-result.js';

export const DEFAULT_SERVER_URL = 'http://127.0.0.1:8780';

export interface ProductHttpDeps {
  fetchImpl?: typeof fetch;
  serverUrl?: string;
  nowMs?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export function resolveServerUrl(deps?: ProductHttpDeps): string {
  const raw = (deps?.serverUrl ?? process.env.ZCC_SERVER_URL ?? DEFAULT_SERVER_URL).trim();
  return raw.replace(/\/+$/, '');
}

function exitCodeForStatus(status: number, code?: string): number {
  if (code === 'FORBIDDEN_AGENT' || status === 403) return 5;
  if (status === 404) return 3;
  if (status === 400 || status === 422) return 2;
  if (status === 429) return 4;
  return 1;
}

export async function productRequest<T>(
  method: string,
  path: string,
  opts?: {
    body?: unknown;
    query?: Record<string, string | undefined>;
    deps?: ProductHttpDeps;
  }
): Promise<{ ok: true; status: number; data: T } | { ok: false; result: CliResult }> {
  const base = resolveServerUrl(opts?.deps);
  const url = new URL(path.startsWith('/') ? path : `/${path}`, `${base}/`);
  for (const [key, value] of Object.entries(opts?.query ?? {})) {
    if (value !== undefined && value !== '') url.searchParams.set(key, value);
  }
  const fetchImpl = opts?.deps?.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method,
      headers: opts?.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: opts?.body === undefined ? undefined : JSON.stringify(opts.body)
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      result: errResult(
        `Zana Command Center is not running (${detail}). Open the app and retry.`,
        1
      )
    };
  }
  let data: unknown = null;
  const raw = await response.text();
  if (raw.length > 0) {
    try {
      data = JSON.parse(raw) as unknown;
    } catch {
      data = raw;
    }
  }
  if (!response.ok) {
    const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
    const code = typeof record.code === 'string' ? record.code : typeof record.error === 'string' ? record.error : undefined;
    const message =
      typeof record.message === 'string'
        ? record.message
        : typeof record.error === 'string'
          ? record.error
          : `HTTP ${response.status}`;
    return {
      ok: false,
      result: errResult(code ? `${code}: ${message}` : message, exitCodeForStatus(response.status, code))
    };
  }
  return { ok: true, status: response.status, data: data as T };
}

export function renderOrJson(json: boolean, value: unknown, human: string): CliResult {
  return json ? jsonResult(value) : textResult(human);
}

export async function sleepMs(ms: number, deps?: ProductHttpDeps): Promise<void> {
  if (deps?.sleep) {
    await deps.sleep(ms);
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function nowMs(deps?: ProductHttpDeps): number {
  return deps?.nowMs?.() ?? Date.now();
}
