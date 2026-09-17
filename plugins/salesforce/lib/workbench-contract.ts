import type { PublicListedOrg, PublicOrgView, DoctorReport } from "./types.js";

export type WorkbenchView =
  | "overview"
  | "data"
  | "apex"
  | "deployments"
  | "agentforce";
export interface WorkbenchStatus {
  ok?: boolean;
  error?: string;
  projectId?: string | null;
  projectName?: string | null;
  projectRoot?: string;
  targetSource?: "override" | "project" | "shared";
  defaultOrg?: string;
  selectedAlias?: string | null;
  apiVersion?: string;
  dxProject?: boolean;
  orgs?: PublicListedOrg[];
  lastDoctor?: DoctorReport | null;
}
export interface SalesforceResource {
  version?: 1;
  projectId?: string;
  orgAlias?: string;
  objectName?: string;
  recordId?: string;
  query?: string;
  logId?: string;
  operationId?: string;
  path?: string;
}
export type OperationKind =
  | "apex.test"
  | "apex.anonymous"
  | "lwc.test"
  | "deploy.preview"
  | "deploy.validate"
  | "deploy.start"
  | "retrieve.preview"
  | "retrieve.start";
export interface SalesforceOperation {
  id: string;
  kind: OperationKind;
  projectId: string | null;
  org: PublicOrgView;
  title: string;
  at: number;
  state: "running" | "submitted" | "succeeded" | "failed" | "interrupted";
  jobId?: string;
  summary?: string;
  data?: unknown;
}
