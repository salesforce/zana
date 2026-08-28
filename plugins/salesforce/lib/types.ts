export const DEFAULT_API_VERSION = '62.0';
export const QUERY_SAMPLE_LIMIT = 25;
export const QUERY_RUN_MAX_LIMIT = 200;
export const QUERY_HARD_CAP = 2000;
export const ARTIFACT_PREVIEW_ROWS = 20;
export const ARTIFACT_MAX_CHARS = 64_000;
export const LOG_BODY_PREVIEW_CHARS = 8_000;
export const ANON_APEX_MAX_CHARS = 8_000;
export const SF_CLI_TIMEOUT_MS = 30_000;
export const SF_AGENT_CLI_TIMEOUT_MS = 120_000;
export const SF_REST_TIMEOUT_MS = 30_000;
export const EVAL_API_VERSION = '63.0';
export const GUARDRAIL_RENDERER_ID = 'salesforce-guardrail';

export const SETTING_DEFAULT_ORG = 'defaultOrg';
export const SETTING_API_VERSION = 'apiVersion';
export const SETTING_PROJECT_ROOT = 'projectRoot';
export const SETTING_AGENT_SCRIPT_DIALECT = 'agentScriptDialect';
export const AGENT_SCRIPT_DIALECTS = ['agentforce', 'agentscript', 'agentfabric'] as const;
export type AgentScriptDialect = (typeof AGENT_SCRIPT_DIALECTS)[number];
export const DEFAULT_AGENT_SCRIPT_DIALECT: AgentScriptDialect = 'agentforce';

export function normalizeAgentScriptDialect(value: unknown): AgentScriptDialect {
  return AGENT_SCRIPT_DIALECTS.includes(value as AgentScriptDialect)
    ? (value as AgentScriptDialect)
    : DEFAULT_AGENT_SCRIPT_DIALECT;
}

export type OrgKind = 'production' | 'sandbox' | 'scratch' | 'unknown';

export type EnvelopeKind =
  | 'org.production.read'
  | 'org.unknown.read'
  | 'apex.anonymous'
  | 'soql.unbounded'
  | 'soql.export'
  | 'agent.publish'
  | 'agent.activate';

export type AgentCompilerKind = 'library' | 'cli' | 'missing';

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface SalesforceRequest {
  method: 'GET' | 'POST';
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  apiVersion?: string;
}

export interface SalesforceResponse {
  status: number;
  json: unknown;
  text: string;
}

export interface ResolvedOrg {
  alias: string;
  username: string;
  orgId: string;
  instanceUrl: string;
  accessToken: string;
  apiVersion: string;
  kind: OrgKind;
  isDefault: boolean;
}

export interface PublicOrgView {
  alias: string;
  username: string;
  orgId: string;
  instanceUrl: string;
  apiVersion: string;
  kind: OrgKind;
  isDefault: boolean;
}

export interface SafetyEnvelope {
  kind: EnvelopeKind;
  orgAlias: string;
  orgId?: string;
  orgKind: OrgKind;
  summary: string;
  fingerprint?: string;
  preview?: string;
}

export interface GuardrailDecision {
  approved: boolean;
  reason: 'submitted' | 'cancelled' | 'headless' | 'denied';
}

export interface ExecSfOptions {
  cwd?: string;
  timeoutMs?: number;
}

export interface SalesforceDeps {
  execSf(args: string[], opts?: ExecSfOptions): Promise<ExecResult>;
  request(conn: ResolvedOrg, req: SalesforceRequest): Promise<SalesforceResponse>;
  now(): number;
  exists(path: string): boolean;
  stat(path: string): 'file' | 'dir' | 'missing';
  readFile(path: string): string | null;
  readdir(path: string): string[];
  realpath(path: string): string;
  writeFile(path: string, content: string): void;
  spawnContained(
    bin: string,
    argv: string[],
    cwd: string
  ): Promise<ExecResult>;
  sleep?(ms: number): Promise<void>;
}

export interface PluginSettingsValues {
  defaultOrg: string;
  apiVersion: string;
  projectRoot: string;
  agentScriptDialect: AgentScriptDialect;
}

export interface DoctorReport {
  cliOk: boolean;
  cliVersion: string | null;
  cliError: string | null;
  defaultOrg: string | null;
  org: PublicOrgView | null;
  aliases: Array<{ alias: string; username: string; kind: OrgKind; isDefault: boolean }>;
  dxProject: boolean;
  projectRoot: string | null;
  agentCompiler: AgentCompilerKind;
  agentPluginOk: boolean;
  agentEvalOk: boolean;
  agentBundleCount: number;
  at: number;
}

export interface EvalEvidence {
  orgId: string;
  botVersionId: string;
  specFingerprint: string;
  passed: boolean;
  at: number;
}

export type ToolResult =
  | { ok: true; summary: string; data?: unknown; artifactId?: string }
  | { ok: false; error: string; code: string };
