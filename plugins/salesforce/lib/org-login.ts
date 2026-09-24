export const SF_ORG_LOGIN_TIMEOUT_MS = 10 * 60 * 1000;

export const ORG_LOGIN_INSTANCE_URLS = {
  production: 'https://login.salesforce.com',
  sandbox: 'https://test.salesforce.com'
} as const;

export type OrgLoginInstance = keyof typeof ORG_LOGIN_INSTANCE_URLS | 'custom';

export type OrgLoginInput =
  | { ok: true; instance: OrgLoginInstance; instanceUrl: string; alias: string | null }
  | { ok: false; code: 'invalid_input'; error: string };

export function parseOrgLoginInput(args: unknown): OrgLoginInput {
  const row = args && typeof args === 'object' ? (args as Record<string, unknown>) : {};
  const instanceRaw = typeof row.instance === 'string' ? row.instance.trim() : 'production';
  if (instanceRaw !== 'production' && instanceRaw !== 'sandbox' && instanceRaw !== 'custom') {
    return { ok: false, code: 'invalid_input', error: 'Pick Production, Sandbox, or My Domain.' };
  }
  let instanceUrl: string;
  if (instanceRaw === 'custom') {
    const raw = typeof row.instanceUrl === 'string' ? row.instanceUrl.trim() : '';
    try {
      const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
      if (raw.length > 255 || /[\s\\]/.test(raw) || url.protocol !== 'https:' ||
        !url.hostname.endsWith('.salesforce.com') || url.username || url.password ||
        url.port || url.pathname !== '/' || url.search || url.hash) throw new Error('Invalid URL');
      instanceUrl = url.origin;
    } catch {
      return { ok: false, code: 'invalid_input', error: 'Enter your HTTPS Salesforce My Domain URL, such as https://company.my.salesforce.com, without a page path or query.' };
    }
  } else instanceUrl = ORG_LOGIN_INSTANCE_URLS[instanceRaw];
  const alias = typeof row.alias === 'string' ? row.alias.trim() : '';
  if (alias.length > 255 || alias.startsWith('-') || /[\x00-\x1f\x7f/\\]/.test(alias) || alias === '.' || alias === '..') {
    return { ok: false, code: 'invalid_input', error: 'Use an alias of at most 255 characters without a leading dash, control characters, or path separators.' };
  }
  return {
    ok: true,
    instance: instanceRaw,
    instanceUrl,
    alias: alias || null
  };
}

export function orgLoginArgs(input: Extract<OrgLoginInput, { ok: true }>): string[] {
  const args = ['org', 'login', 'web', '--json', '--instance-url', input.instanceUrl];
  if (input.alias) args.push('--alias', input.alias);
  return args;
}
