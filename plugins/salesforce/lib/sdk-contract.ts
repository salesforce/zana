/**
 * Public Salesforce session contract.
 *
 * Consumer plugins `import type` this module (`@zcc-ext/salesforce/sdk`) and
 * call `zcc.services.use<SalesforceSdk>('salesforce')`. They must not import
 * the host factory, `ConnectionManager`, or any module that holds org credentials.
 *
 * This file is the portable surface for a future standalone package. Keep it
 * free of `@zana-ai/*` and of DX UI (Explorer, Agentforce, Apex/LWC tools).
 */
import type { QueryPage } from './soql-query-more.js';
import type {
  DoctorReport,
  EnvelopeKind,
  ExecResult,
  ExecSfOptions,
  GuardrailDecision,
  OrgKind,
  PublicListedOrg,
  PublicOrgView,
  SafetyEnvelope,
  SalesforceHttpMethod,
  SalesforceRequestInit,
  SalesforceResponse
} from './types.js';

export type {
  DoctorReport,
  EnvelopeKind,
  ExecResult,
  ExecSfOptions,
  GuardrailDecision,
  OrgKind,
  PublicListedOrg,
  PublicOrgView,
  QueryPage,
  SafetyEnvelope,
  SalesforceHttpMethod,
  SalesforceRequestInit,
  SalesforceResponse
};

export { parseApiError, parseSoqlApiError, isAbortError } from './soql-api-error.js';
export type { SalesforceApiError, SoqlApiError } from './soql-api-error.js';
export { QueryMoreError } from './soql-query-more.js';

export type SalesforceQueryOptions = {
  tooling?: boolean;
  allRows?: boolean;
  alias?: string;
  signal?: AbortSignal;
};

export type SalesforceAliasOptions = {
  alias?: string;
  signal?: AbortSignal;
};

export type SalesforceDescribeSObjectOptions = SalesforceAliasOptions & {
  tooling?: boolean;
};

export type SalesforceQueryResult = {
  org: PublicOrgView;
  response: SalesforceResponse;
} & QueryPage;

export type SalesforceDescribeGlobalResult = {
  org: PublicOrgView;
  response: SalesforceResponse;
  sobjects: unknown;
};

export type SalesforceDescribeSObjectResult = {
  org: PublicOrgView;
  response: SalesforceResponse;
  describe: unknown;
};

export type SalesforceLimitsResult = {
  org: PublicOrgView;
  response: SalesforceResponse;
  dailyApiRequests: { max: number; remaining: number } | null;
};

export type OrgChangeListener = (org: PublicOrgView | null) => void;

/**
 * Shared CLI + REST session. Returned org views never include credentials.
 * Experimental until a second in-tree consumer exists.
 */
export interface SalesforceSdk {
  doctor(): Promise<DoctorReport>;
  listOrgs(): Promise<PublicListedOrg[]>;
  resolveAlias(): Promise<string | null>;
  connect(opts?: { alias?: string; forceRefresh?: boolean }): Promise<PublicOrgView>;
  request(
    path: string,
    init?: SalesforceRequestInit
  ): Promise<{ org: PublicOrgView; response: SalesforceResponse }>;
  query(soql: string, opts?: SalesforceQueryOptions): Promise<SalesforceQueryResult>;
  queryMore(nextRecordsUrl: string, opts?: SalesforceAliasOptions): Promise<SalesforceQueryResult>;
  describeGlobal(opts?: SalesforceDescribeSObjectOptions): Promise<SalesforceDescribeGlobalResult>;
  describeSObject(name: string, opts?: SalesforceDescribeSObjectOptions): Promise<SalesforceDescribeSObjectResult>;
  limits(opts?: SalesforceAliasOptions): Promise<SalesforceLimitsResult>;
  execSf(args: string[], opts?: ExecSfOptions): Promise<ExecResult>;
  confirm(
    envelope: Omit<SafetyEnvelope, 'kind'> & { kind?: EnvelopeKind },
    threadId: string
  ): Promise<GuardrailDecision>;
  onOrgChange(listener: OrgChangeListener): () => void;
}
