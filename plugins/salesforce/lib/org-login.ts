export const SF_ORG_LOGIN_TIMEOUT_MS = 10 * 60 * 1000;

export const ORG_LOGIN_INSTANCE_URLS = {
  production: 'https://login.salesforce.com',
  sandbox: 'https://test.salesforce.com'
} as const;

export type OrgLoginInstance = keyof typeof ORG_LOGIN_INSTANCE_URLS;

export type OrgLoginInput =
  | { ok: true; instance: OrgLoginInstance; instanceUrl: string; alias: string | null }
  | { ok: false; code: 'invalid_input'; error: string };

export function parseOrgLoginInput(args: unknown): OrgLoginInput {
  const row = args && typeof args === 'object' ? (args as Record<string, unknown>) : {};
  const instanceRaw = typeof row.instance === 'string' ? row.instance.trim() : 'production';
  if (instanceRaw !== 'production' && instanceRaw !== 'sandbox') {
    return { ok: false, code: 'invalid_input', error: 'Pick Production or Sandbox.' };
  }
  const alias = typeof row.alias === 'string' ? row.alias.trim() : '';
  if (alias.includes('\0') || alias.includes('/') || alias.includes('\\') || alias === '.' || alias === '..') {
    return { ok: false, code: 'invalid_input', error: 'Alias cannot contain path separators.' };
  }
  return {
    ok: true,
    instance: instanceRaw,
    instanceUrl: ORG_LOGIN_INSTANCE_URLS[instanceRaw],
    alias: alias || null
  };
}

export function orgLoginArgs(input: Extract<OrgLoginInput, { ok: true }>): string[] {
  const args = ['org', 'login', 'web', '--instance-url', input.instanceUrl];
  if (input.alias) args.push('--alias', input.alias);
  return args;
}
