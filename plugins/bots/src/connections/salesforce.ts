// Only this server adapter handles provider credentials. Requests and response shapes are fixed here.
export type AccountMode = 'service' | 'delegated';
export interface Grant {
  bot: string;
  mode: AccountMode;
  origin: string;
  clientId: string;
  clientSecret?: string;
  refreshToken?: string;
  principal: string;
}
export interface DeviceLogin {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  interval: number;
}
export class AuthorizationPending extends Error {
  constructor(readonly slowDown: boolean) {
    super('Waiting for Salesforce authorization.');
  }
}

export function domain(raw: unknown) {
  if (typeof raw !== 'string' || raw.length > 255) throw new Error('Enter your Salesforce My Domain URL.');
  let url: URL;
  try {
    url = new URL(raw.includes('://') ? raw.trim() : 'https://' + raw.trim());
  } catch {
    throw new Error('Enter your Salesforce My Domain URL.');
  }
  if (!/^https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.my\.salesforce\.com\/$/.test(url.href))
    throw new Error('Use an HTTPS Salesforce My Domain without a path.');
  return url.origin;
}
function textField(raw: unknown, max = 8192): string {
  if (typeof raw !== 'string' || !raw || raw.length > max || /[\s\x00-\x1f]/.test(raw))
    throw new Error('Salesforce credentials are missing or invalid.');
  return raw;
}
export const appId = (value: unknown) => textField(value, 512);
export const appSecret = (value: unknown) => textField(value, 2048);

async function boundedJson(response: Response): Promise<Record<string, unknown>> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 128 * 1024) throw new Error();
      chunks.push(value);
    }
    const data = JSON.parse(Buffer.concat(chunks).toString());
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } finally {
    await reader.cancel().catch(() => {});
  }
}
export class SalesforceConnection {
  constructor(private request: typeof fetch = (...args) => fetch(...args)) {}
  private async call(url: string, init: RequestInit, signal: AbortSignal) {
    try {
      const response = await this.request(url, {
        ...init,
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.any([signal, AbortSignal.timeout(12000)])
      });
      return { status: response.status, data: await boundedJson(response) };
    } catch {
      throw new Error('Salesforce could not be reached. Try again.');
    }
  }
  private async oauth(origin: string, body: Record<string, string>, signal: AbortSignal) {
    const { status, data } = await this.call(
      domain(origin) + '/services/oauth2/token',
      { method: 'POST', body: new URLSearchParams(body) },
      signal
    );
    if (status === 400 && (data.error === 'authorization_pending' || data.error === 'slow_down'))
      throw new AuthorizationPending(data.error === 'slow_down');
    if (status !== 200)
      throw new Error(
        status >= 500 || status === 429
          ? 'Salesforce is temporarily unavailable.'
          : 'Salesforce declined authorization. Check your app configuration or reconnect the account.'
      );
    return data;
  }
  async begin(origin: string, clientId: string, signal: AbortSignal): Promise<DeviceLogin> {
    const data = await this.oauth(
      origin,
      {
        response_type: 'device_code',
        client_id: clientId,
        redirect_uri: 'https://localhost',
        scope: 'api refresh_token'
      },
      signal
    );
    if (data.verification_uri !== origin + '/setup/connect')
      throw new Error('Salesforce returned an unexpected verification page.');
    return {
      deviceCode: textField(data.device_code),
      userCode: textField(data.user_code, 64),
      verificationUrl: data.verification_uri,
      interval: Math.max(5, Math.min(60, Number(data.interval) || 5))
    };
  }
  async authorize(grant: Grant, signal: AbortSignal, deviceCode?: string) {
    const body: Record<string, string> = { client_id: grant.clientId };
    if (grant.clientSecret) body.client_secret = grant.clientSecret;
    if (deviceCode) {
      body.grant_type = 'device';
      body.code = deviceCode;
    } else if (grant.mode === 'delegated') {
      body.grant_type = 'refresh_token';
      body.refresh_token = textField(grant.refreshToken);
    } else body.grant_type = 'client_credentials';
    const data = await this.oauth(grant.origin, body, signal);
    // Salesforce can report its instance (e.g. na123.salesforce.com) for a My Domain login.
    // Keep all subsequent requests pinned to the configured My Domain, including after refresh.
    const instance = data.instance_url;
    const pod = typeof instance === 'string' && /^https:\/\/[a-z][a-z0-9-]*\.salesforce\.com\/?$/.test(instance);
    if (!pod && domain(instance) !== grant.origin)
      throw new Error('Salesforce returned a different org. Reconnect the account.');
    const identity =
      typeof data.id === 'string' &&
      /^https:\/\/[a-z0-9.-]+\/id\/(00D[a-zA-Z0-9]{12}(?:[a-zA-Z0-9]{3})?)\/(005[a-zA-Z0-9]{12}(?:[a-zA-Z0-9]{3})?)$/.exec(
        data.id
      );
    if (!identity || (grant.principal && grant.principal !== identity[1] + '/' + identity[2]))
      throw new Error('Could not verify the Salesforce account. Reconnect the account.');
    const refreshToken =
      grant.mode === 'delegated' ? textField(data.refresh_token ?? grant.refreshToken) : undefined;
    return {
      access: textField(data.access_token),
      grant: { ...grant, principal: identity[1] + '/' + identity[2], refreshToken }
    };
  }
  async cases(grant: Grant, access: string, signal: AbortSignal) {
    const user = grant.principal.split('/')[1];
    const soql = `SELECT Id,CaseNumber,Subject,Status FROM Case WHERE OwnerId = '${user}' AND IsClosed = false ORDER BY LastModifiedDate DESC LIMIT 20`;
    const { status, data } = await this.call(
      grant.origin + '/services/data/v64.0/query?' + new URLSearchParams({ q: soql }),
      { headers: { Authorization: 'Bearer ' + access } },
      signal
    );
    if (status !== 200 || !Array.isArray(data.records))
      throw new Error('Could not read assigned cases. Check Case read access in Salesforce.');
    return {
      cases: data.records.slice(0, 20).map((row) => {
        const safe = (key: string) => (typeof row?.[key] === 'string' ? row[key].slice(0, 500) : '');
        return { id: safe('Id'), number: safe('CaseNumber'), subject: safe('Subject'), status: safe('Status') };
      })
    };
  }
}
