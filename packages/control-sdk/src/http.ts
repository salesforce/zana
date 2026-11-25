import { ControlError } from './errors.js';
import { trimTrailingSlashes } from './trim-slashes.js';

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
    this.serverUrl = trimTrailingSlashes(serverUrl);
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.nowMs = opts.nowMs ?? (() => Date.now());
    this.sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async request<T>(
    method: string,
    path: string,
    opts?: { body?: unknown; query?: Record<string, string | undefined>; signal?: AbortSignal; timeoutMs?: number }
  ): Promise<T> {
    if (!opts?.signal && opts?.timeoutMs === undefined) return this.performRequest<T>(method, path, opts);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectAbort: (reason: unknown) => void = () => {};
    const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
    const abort = () => {
      const error = new ControlError('TIMEOUT', 'HTTP request cancelled or timed out');
      rejectAbort(error);
      controller.abort(error);
    };
    opts.signal?.addEventListener('abort', abort, { once: true });
    if (opts.signal?.aborted) abort();
    if (opts.timeoutMs !== undefined) timer = setTimeout(abort, Math.max(0, opts.timeoutMs));
    try {
      // Race as well as abort: injected fetch/body implementations may ignore signals.
      return await Promise.race([this.performRequest<T>(method, path, { ...opts, signal: controller.signal }), aborted]);
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', abort);
    }
  }

  private async performRequest<T>(
    method: string,
    path: string,
    opts?: { body?: unknown; query?: Record<string, string | undefined>; signal?: AbortSignal }
  ): Promise<T> {
    if (opts?.signal?.aborted) throw new ControlError('TIMEOUT', 'HTTP request cancelled or timed out');
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
        signal: opts?.signal,
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
    const response = await fetchImpl(new URL('/api/v1/health', `${trimTrailingSlashes(serverUrl)}/`), {
      method: 'GET'
    });
    if (!response.ok) return false;
    const body = await response.json() as { ok?: unknown };
    return body.ok === true;
  } catch {
    return false;
  }
}
