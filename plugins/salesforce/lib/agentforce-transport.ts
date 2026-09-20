import type { ResolvedOrg } from './types.js';

const HOSTS = ['api.salesforce.com', 'test.api.salesforce.com', 'dev.api.salesforce.com'] as const;
export type SfapHost = typeof HOSTS[number];
const MAX_BYTES = 2 * 1024 * 1024;

/** No caller-supplied URL, redirects, unbounded bodies, or replay after an ambiguous POST failure. */
export class AgentforceTransport {
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  private async json(url: string, init: RequestInit, signal?: AbortSignal): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await this.fetcher(url, { ...init, redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000) });
    if (Number(response.headers.get('content-length')) > MAX_BYTES) {
      await response.body?.cancel();
      throw new Error('Salesforce response exceeds the 2 MiB limit.');
    }
    const reader = response.body?.getReader();
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > MAX_BYTES) { await reader.cancel(); throw new Error('Salesforce response exceeds the 2 MiB limit.'); }
        chunks.push(value);
      }
    } finally { reader?.releaseLock(); }
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* HTTP status is sufficient for failures. */ }
    return { status: response.status, body: body && typeof body === 'object' ? body : {} };
  }

  async bootstrap(org: ResolvedOrg, signal?: AbortSignal): Promise<string> {
    const url = new URL(org.instanceUrl);
    if (url.protocol !== 'https:' || !/(^|\.)(salesforce\.com|force\.com|salesforce\.mil)$/.test(url.hostname) || url.port || url.username || url.password) throw new Error('Agentforce requires an HTTPS Salesforce org.');
    const result = await this.json(`${url.origin}/agentforce/bootstrap/nameduser`, { headers: { Cookie: `sid=${org.accessToken}`, Accept: 'application/json' } }, signal);
    if (result.status !== 200 || typeof result.body.access_token !== 'string' || !result.body.access_token) throw new Error(`Agentforce authentication failed (HTTP ${result.status}). Reconnect the org and check Agentforce access.`);
    return result.body.access_token;
  }

  async request(token: string, path: string, body?: unknown, host?: SfapHost, signal?: AbortSignal): Promise<{ host: SfapHost; body: Record<string, unknown> }> {
    if (!/^\/einstein\/(ai-agent\/v1\.1\/|platform\/v1\/models\/)/.test(path) || /[?#]/.test(path)) throw new Error('Unsupported Agentforce endpoint.');
    if (host && !HOSTS.includes(host)) throw new Error('Unsupported Agentforce host.');
    for (const candidate of host ? [host] : HOSTS) {
      const result = await this.json(`https://${candidate}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json', 'x-client-name': 'zana', 'x-attributed-client': 'no-builder', 'x-sfdc-app-context': 'EinsteinGPT', 'x-client-feature-id': 'ai-platform-models-connected-app' },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {})
      }, signal);
      if (result.status === 404 && !host && candidate !== HOSTS.at(-1)) continue;
      if (result.status < 200 || result.status >= 300) throw new Error(`Salesforce ${path.includes('/models/') ? 'Models' : 'Preview'} API returned HTTP ${result.status}. ${result.status === 401 || result.status === 403 ? 'Check org authentication, API scopes, and feature permissions.' : result.status === 404 ? 'This org or model does not support the requested API.' : 'The request was not retried; start a fresh run before continuing.'}`);
      return { host: candidate, body: result.body };
    }
    throw new Error('Agentforce endpoint unavailable.');
  }
}
