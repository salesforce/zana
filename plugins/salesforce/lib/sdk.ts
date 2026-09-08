/**
 * Host factory for {@link SalesforceSdk}. Consumer plugins must not import this
 * file — they `import type` from `./sdk-contract.js` (`@zcc-ext/salesforce/sdk`).
 *
 * Portable with the session kernel listed in `SDK.md`. Do not import `@zana-ai/*` here.
 */
import type { ConnectionManager } from './connection.js';
import { runDoctor } from './doctor.js';
import type { Guardrail } from './guardrail.js';
import { publicOrgView } from './org-resolution.js';
import {
  type OrgChangeListener,
  type SalesforceAliasOptions,
  type SalesforceDescribeSObjectOptions,
  type SalesforceQueryOptions,
  type SalesforceSdk
} from './sdk-contract.js';
import { asQueryPage, confineQueryMorePath } from './soql-query-more.js';
import type {
  PluginSettingsValues,
  SalesforceDeps,
  SalesforceRequestInit,
  SalesforceResponse,
  PublicOrgView
} from './types.js';

export type { SalesforceSdk } from './sdk-contract.js';
export type {
  DoctorReport,
  EnvelopeKind,
  ExecResult,
  ExecSfOptions,
  GuardrailDecision,
  OrgChangeListener,
  OrgKind,
  PublicListedOrg,
  PublicOrgView,
  QueryPage,
  SafetyEnvelope,
  SalesforceAliasOptions,
  SalesforceApiError,
  SalesforceDescribeGlobalResult,
  SalesforceDescribeSObjectOptions,
  SalesforceDescribeSObjectResult,
  SalesforceHttpMethod,
  SalesforceLimitsResult,
  SalesforceQueryOptions,
  SalesforceQueryResult,
  SalesforceRequestInit,
  SalesforceResponse
} from './sdk-contract.js';
export { isAbortError, parseApiError, parseSoqlApiError, QueryMoreError } from './sdk-contract.js';

function queryPath(opts: SalesforceQueryOptions): '/query' | '/queryAll' | '/tooling/query' {
  if (opts.tooling) return '/tooling/query';
  return opts.allRows ? '/queryAll' : '/query';
}

function sobjectsOf(json: unknown): unknown {
  if (json && typeof json === 'object' && 'sobjects' in json) {
    return (json as { sobjects: unknown }).sobjects;
  }
  return [];
}

function parseDailyApiRequests(json: unknown): { max: number; remaining: number } | null {
  const rec = json && typeof json === 'object' ? (json as Record<string, unknown>) : {};
  const daily =
    rec.DailyApiRequests && typeof rec.DailyApiRequests === 'object'
      ? (rec.DailyApiRequests as Record<string, unknown>)
      : null;
  if (!daily) return null;
  return {
    max: typeof daily.Max === 'number' ? daily.Max : 0,
    remaining: typeof daily.Remaining === 'number' ? daily.Remaining : 0
  };
}

export function createSalesforceSdk(opts: {
  connections: ConnectionManager;
  guardrail: Guardrail;
  deps: SalesforceDeps;
  readSettings: () => Promise<PluginSettingsValues>;
}): { sdk: SalesforceSdk; emitOrgChange: () => void } {
  const orgListeners = new Set<OrgChangeListener>();

  async function request(
    path: string,
    init: SalesforceRequestInit = {}
  ): Promise<{ org: PublicOrgView; response: SalesforceResponse }> {
    const { org, response } = await opts.connections.request(path, init);
    return { org: publicOrgView(org), response };
  }

  const sdk: SalesforceSdk = {
    async doctor() {
      return runDoctor(opts.deps, await opts.readSettings());
    },
    listOrgs() {
      return opts.connections.listOrgs();
    },
    resolveAlias() {
      return opts.connections.resolveAlias();
    },
    async connect(connectOpts) {
      return publicOrgView(await opts.connections.connect(connectOpts));
    },
    request,
    async query(soql, queryOpts: SalesforceQueryOptions = {}) {
      const { org, response } = await request(queryPath(queryOpts), {
        method: 'GET',
        query: { q: soql },
        alias: queryOpts.alias,
        signal: queryOpts.signal
      });
      return { org, response, ...asQueryPage(response.json) };
    },
    async queryMore(nextRecordsUrl, moreOpts: SalesforceAliasOptions = {}) {
      const org = await sdk.connect({ alias: moreOpts.alias });
      const path = confineQueryMorePath(org.instanceUrl, nextRecordsUrl);
      const { org: fromRequest, response } = await request(path, {
        method: 'GET',
        alias: moreOpts.alias,
        signal: moreOpts.signal
      });
      return { org: fromRequest, response, ...asQueryPage(response.json) };
    },
    async describeGlobal(describeOpts: SalesforceDescribeSObjectOptions = {}) {
      const path = describeOpts.tooling ? '/tooling/sobjects' : '/sobjects';
      const { org, response } = await request(path, {
        method: 'GET',
        alias: describeOpts.alias,
        signal: describeOpts.signal
      });
      return { org, response, sobjects: sobjectsOf(response.json) };
    },
    async describeSObject(name, describeOpts: SalesforceDescribeSObjectOptions = {}) {
      const encoded = encodeURIComponent(name);
      const path = describeOpts.tooling
        ? `/tooling/sobjects/${encoded}/describe`
        : `/sobjects/${encoded}/describe`;
      const { org, response } = await request(path, {
        method: 'GET',
        alias: describeOpts.alias,
        signal: describeOpts.signal
      });
      return { org, response, describe: response.json };
    },
    async limits(limitsOpts: SalesforceAliasOptions = {}) {
      const { org, response } = await request('/limits', {
        method: 'GET',
        alias: limitsOpts.alias,
        signal: limitsOpts.signal
      });
      return { org, response, dailyApiRequests: parseDailyApiRequests(response.json) };
    },
    execSf(args, execOpts) {
      return opts.deps.execSf(args, execOpts);
    },
    confirm(envelope, threadId) {
      return opts.guardrail.mediate({
        threadId,
        orgAlias: envelope.orgAlias,
        orgId: envelope.orgId,
        orgKind: envelope.orgKind,
        kind: envelope.kind,
        summary: envelope.summary,
        fingerprint: envelope.fingerprint,
        preview: envelope.preview
      });
    },
    onOrgChange(listener) {
      orgListeners.add(listener);
      return () => {
        orgListeners.delete(listener);
      };
    }
  };
  return {
    sdk,
    emitOrgChange() {
      void opts.connections.connect().then(
        (org) => {
          const view = publicOrgView(org);
          for (const listener of [...orgListeners]) listener(view);
        },
        () => {
          for (const listener of [...orgListeners]) listener(null);
        }
      );
    }
  };
}

export function assertPublicOrg(org: PublicOrgView): void {
  if ('accessToken' in org) {
    throw new Error('Salesforce SDK must not expose accessToken');
  }
}
