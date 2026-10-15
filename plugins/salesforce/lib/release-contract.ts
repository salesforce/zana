/**
 * The Studio Release lane. A person starts each step from a button; the host
 * draws the approval sheet and signs it, and the server rebuilds the same
 * binding before it acts. Agents keep using sf_agent and the thread guardrail.
 */
export type ReleaseAction = 'agent.publish' | 'agent.activate' | 'agent.deactivate' | 'org.read';
export const RELEASE_ACTIONS: readonly ReleaseAction[] = ['agent.publish', 'agent.activate', 'agent.deactivate', 'org.read'];

/** The host's approval binding, mirrored so lib files stay free of SDK imports. Every field is signed. */
export interface ReleaseApprovalBinding {
  action: string;
  target: string;
  targetLabel: string;
  subject: string;
  revision?: string;
  confirmText?: string;
}

/** The host's approval sheet request; only `binding` is signed. */
export interface ReleaseApprovalRequest {
  binding: ReleaseApprovalBinding;
  title: string;
  summary?: string;
  details?: string[];
  confirmLabel?: string;
  tone?: 'default' | 'danger';
}

export const RELEASE_RPC = {
  state: 'release.state',
  prepare: 'release.prepare',
  run: 'release.run',
  versionSource: 'release.versionSource'
} as const;

/** How long one "Load versions" approval lets the Studio read a production or unknown org. */
export const RELEASE_READ_GRANT_MS = 30 * 60_000;

export interface ReleaseEvalEvidence {
  passed: boolean;
  at: number;
}

export interface ReleaseVersion {
  /** The BotVersion record id. */
  id: string;
  versionNumber: number;
  active: boolean;
  modifiedAt: string | null;
  /** Eval evidence recorded for exactly this version, if any. */
  evidence: ReleaseEvalEvidence | null;
}

export interface ReleaseState {
  org: { alias: string; orgId: string; kind: string };
  agent: {
    apiName: string;
    path: string;
    /** SHA-256 of the source on disk. */
    revision: string;
    /** A retrieved org version cannot be published; create a local draft from it first. */
    versioned: boolean;
    lastPublish: { revision: string; at: number } | null;
  };
  /** Production and unknown orgs need one approval before the Studio reads their versions. */
  needsReadApproval: boolean;
  /** When the current read approval ends, for production and unknown orgs. */
  readUntil: number | null;
  /** Newest first. Empty until read, or when the agent was never published. */
  versions: ReleaseVersion[];
  /** A failed version read does not block publishing the saved draft. */
  versionsError?: string;
}

/** One org version's Agent Script, read into a temp folder and never written to the project. */
export interface ReleaseVersionSource {
  apiName: string;
  versionNumber: number;
  active: boolean;
  /** The authoring bundle the source came from. */
  fullName: string;
  content: string;
}

export interface ReleasePrepared {
  request: ReleaseApprovalRequest;
}
