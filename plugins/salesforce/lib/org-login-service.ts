import { readJsonObject } from './dx-project.js';
import { orgLoginArgs, parseOrgLoginInput, SF_ORG_LOGIN_TIMEOUT_MS } from './org-login.js';
import type { PublicListedOrg, SalesforceDeps } from './types.js';

/** One browser callback listener at a time; CLI auth output never crosses RPC. */
export class OrgLoginService {
  private pending: AbortController | null = null;

  constructor(private readonly deps: {
    execSf: SalesforceDeps['execSf'];
    listOrgs(): Promise<PublicListedOrg[]>;
    invalidate(): void;
  }) {}

  dispose(): void { this.pending?.abort(); }

  async run(args: unknown, options: {
    cwd?: string;
    onConnected?(alias: string, orgs: PublicListedOrg[]): Promise<void>;
  } = {}) {
    const parsed = parseOrgLoginInput(args);
    if (!parsed.ok) return parsed;
    if (this.pending) return { ok: false as const, code: 'login_busy', error: 'Another org sign-in is in progress. Complete it in your browser, then retry.' };
    const controller = new AbortController();
    this.pending = controller;
    try {
      const result = await this.deps.execSf(orgLoginArgs(parsed), {
        cwd: options.cwd, timeoutMs: SF_ORG_LOGIN_TIMEOUT_MS, signal: controller.signal,
      });
      if (result.code === 127) return { ok: false as const, code: 'cli_missing', error: 'Salesforce CLI was not found. Install sf on this host, then retry.' };
      if (result.code !== 0 || controller.signal.aborted) return { ok: false as const, code: 'login_failed', error: 'Sign-in did not finish or timed out. Try again and complete sign-in in your browser within 10 minutes.' };
      this.deps.invalidate();
      // Whitelist only the identity; older CLIs can return access/refresh tokens.
      const auth = readJsonObject(result.stdout)?.result;
      const username = auth && typeof auth === 'object' && 'username' in auth && typeof auth.username === 'string'
        ? auth.username : null;
      let orgs: PublicListedOrg[];
      try { orgs = await this.deps.listOrgs(); }
      catch { return { ok: false as const, code: 'orgs_failed', error: 'Signed in, but could not refresh your orgs. Refresh the list to select the org.' }; }
      if (controller.signal.aborted) return { ok: false as const, code: 'login_failed', error: 'Sign-in was cancelled.' };
      const org = username ? orgs.find(row => row.username === username) : undefined;
      const connectedAlias = org ? org.alias || org.username : null;
      let warning: string | undefined;
      if (!connectedAlias) warning = 'Signed in. Refresh the list and select the org to use.';
      else if (options.onConnected) {
        try { await options.onConnected(connectedAlias, orgs); }
        catch { warning = 'Signed in, but could not select the org for this project. Select it from the org list.'; }
      }
      return { ok: true as const, orgs, connectedAlias, warning };
    } catch {
      return { ok: false as const, code: 'login_failed', error: 'Could not start Salesforce sign-in. Check that sf is installed and a browser is available on this host, then retry.' };
    } finally { this.pending = null; }
  }
}
