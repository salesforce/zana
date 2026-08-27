import { DEFAULT_API_VERSION, type ResolvedOrg, type SalesforceDeps } from './types.js';
import { envTargetOrg, resolveTargetOrgAlias } from './org-resolution.js';
import { defaultCliAlias, parseOrgDisplay, parseOrgList } from './sf-cli.js';

const CACHE_TTL_MS = 10 * 60 * 1000;

export class ConnectionManager {
  private cache = new Map<string, { org: ResolvedOrg; at: number }>();

  constructor(
    private readonly deps: SalesforceDeps,
    private readonly getSettings: () => Promise<{ defaultOrg: string; apiVersion: string }>
  ) {}

  invalidate(alias?: string): void {
    if (!alias) this.cache.clear();
    else this.cache.delete(alias);
  }

  async resolveAlias(): Promise<string | null> {
    const settings = await this.getSettings();
    let cliDefault: string | null = null;
    if (!settings.defaultOrg.trim() && !envTargetOrg()) {
      const listed = await this.listOrgs();
      cliDefault = defaultCliAlias(listed);
    }
    return resolveTargetOrgAlias({
      settingAlias: settings.defaultOrg,
      envAlias: envTargetOrg(),
      cliDefaultAlias: cliDefault ?? undefined
    });
  }

  async listOrgs() {
    const result = await this.deps.execSf(['org', 'list', '--json']);
    if (result.code !== 0) return [];
    return parseOrgList(result.stdout);
  }

  async connect(forceRefresh = false): Promise<ResolvedOrg> {
    const settings = await this.getSettings();
    const alias = await this.resolveAlias();
    if (!alias) {
      throw new ConnectionError(
        'No target org. Set defaultOrg under Plugins → Salesforce or SF_TARGET_ORG, then run zcc sf doctor.',
        'no_org'
      );
    }
    const cached = this.cache.get(alias);
    if (!forceRefresh && cached && this.deps.now() - cached.at < CACHE_TTL_MS) {
      return cached.org;
    }
    const org = await this.display(alias, settings.apiVersion || DEFAULT_API_VERSION);
    this.cache.set(alias, { org, at: this.deps.now() });
    return org;
  }

  async request(
    path: string,
    init: { method?: 'GET' | 'POST'; query?: Record<string, string>; body?: unknown; apiVersion?: string }
  ) {
    let org = await this.connect();
    const req = {
      method: init.method ?? ('GET' as const),
      path,
      query: init.query,
      body: init.body,
      apiVersion: init.apiVersion
    };
    let response = await this.deps.request(org, req);
    if (response.status === 401) {
      this.invalidate(org.alias);
      org = await this.connect(true);
      response = await this.deps.request(org, req);
    }
    return { org, response };
  }

  private async display(alias: string, apiVersion: string): Promise<ResolvedOrg> {
    const result = await this.deps.execSf(['org', 'display', '--json', '--target-org', alias]);
    if (result.code === 127) {
      throw new ConnectionError('Salesforce CLI (sf) was not found on PATH.', 'cli_missing');
    }
    if (result.code !== 0) {
      throw new ConnectionError(
        result.stderr.trim() || result.stdout.trim() || `sf org display failed (${result.code})`,
        'org_display_failed'
      );
    }
    const org = parseOrgDisplay(result.stdout, alias, apiVersion);
    if (!org) {
      throw new ConnectionError('sf org display returned no usable username/instanceUrl.', 'org_display_failed');
    }
    if (apiVersion.trim()) org.apiVersion = apiVersion.replace(/^v/i, '');
    return org;
  }
}

export class ConnectionError extends Error {
  constructor(
    message: string,
    readonly code: 'no_org' | 'cli_missing' | 'org_display_failed'
  ) {
    super(message);
    this.name = 'ConnectionError';
  }
}
