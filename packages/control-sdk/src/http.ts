import { ControlError } from './errors.js';

export interface ProductHttpOptions {
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class ProductHttpClient {
  readonly serverUrl: string;
  readonly fetchImpl: typeof fetch;
  readonly nowMs: () => number;
  readonly sleep: (ms: number) => Promise<void>;

  constructor(serverUrl: string, opts: ProductHttpOptions = {}) {
    this.serverUrl = serverUrl.replace(/\/+$/, '');
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.nowMs = opts.nowMs ?? (() => Date.now());
    this.sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async request<T>(
    method: string,
    path: string,
    opts?: { body?: unknown; query?: Record<string, string | undefined> }
  ): Promise<T> {
    const url = new URL(path.startsWith('/') ? path : `/${path}`, `${this.serverUrl}/`);
    for (const [key, value] of Object.entries(opts?.query ?? {})) {
      if (value !== undefined && value !== '') url.searchParams.set(key, value);
    }
    const headers: Record<string, string> = {};
    if (opts?.body !== undefined) headers['content-type'] = 'application/json';
    if (process.env.ZCC_SESSION_ID) headers['x-zcc-caller-session-id'] = process.env.ZCC_SESSION_ID;
    if (process.env.ZCC_SESSION_TOKEN) headers['x-zcc-caller-credential'] = process.env.ZCC_SESSION_TOKEN;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        body: opts?.body === undefined ? undefined : JSON.stringify(opts.body)
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new ControlError(
        'APP_NOT_RUNNING',
        `Zana Command Center is not running (${detail}). Open the app and retry.`
      );
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
      const code = typeof record.code === 'string'
        ? record.code
        : typeof record.error === 'string'
          ? record.error
          : undefined;
      const message = typeof record.message === 'string'
        ? record.message
        : typeof record.error === 'string'
          ? record.error
          : `HTTP ${response.status}`;
      throw new ControlError(
        code === 'FORBIDDEN_AGENT' ? 'FORBIDDEN_AGENT' : response.status === 404 ? 'NOT_FOUND' : 'HTTP_ERROR',
        code ? `${code}: ${message}` : message,
        { status: response.status, details: data }
      );
    }
    return data as T;
  }
}

export async function probeHealth(
  serverUrl: string,
  fetchImpl: typeof fetch = fetch
): Promise<boolean> {
  try {
    const response = await fetchImpl(new URL('/api/v1/health', `${serverUrl.replace(/\/+$/, '')}/`), {
      method: 'GET'
    });
    if (!response.ok) return false;
    const body = await response.json() as { ok?: unknown };
    return body.ok === true;
  } catch {
    return false;
  }
}
