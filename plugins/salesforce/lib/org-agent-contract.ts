/** Public Agent Script inventory; credentials and CLI output never cross RPC. */
export interface OrgAgentVersion {
  fullName: string;
  version: number | null;
  modifiedAt: string | null;
}
export interface OrgAgent {
  name: string;
  versions: OrgAgentVersion[];
}
export interface OrgAgentCatalog {
  org: { alias: string; orgId: string };
  agents: OrgAgent[];
  truncated: boolean;
}
export interface RetrievedOrgAgent {
  path: string;
  orgId: string;
  fullName: string;
  existing: boolean;
}
export type OrgAgentRetrieval =
  | { state: 'running' }
  | { state: 'done'; file: RetrievedOrgAgent }
  | { state: 'failed'; error: string };
