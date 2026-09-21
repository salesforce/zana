import { getAppSurface } from './app-surface.js';

export const APP_SURFACE_HEADER = 'x-zcc-app-surface';

export async function fetchWithAppSurface(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set(APP_SURFACE_HEADER, getAppSurface());
  return fetch(input, { ...init, headers });
}

export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes((init.method ?? 'GET').toUpperCase());
  if ((init.body !== undefined || isMutation) && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const response = await fetchWithAppSurface(`/api/v1${path}`, { ...init, headers });
  if (!response.ok) {
    let detail = `${response.status}`;
    let code: string | undefined;
    try {
      const body = (await response.json()) as { error?: string; code?: string; message?: string };
      detail = body.message ?? body.error ?? detail;
      code = body.code ?? body.error;
    } catch {
      /* keep status text */
    }
    throw Object.assign(new Error(detail), { status: response.status, code });
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
