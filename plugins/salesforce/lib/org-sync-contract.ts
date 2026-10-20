/** Fetch latest: compare org metadata with local source, then pull chosen components. */
export const SYNC_TYPES = ['AiAuthoringBundle', 'ApexClass', 'ApexTrigger', 'LightningComponentBundle', 'Flow', 'GenAiPromptTemplate', 'LightningTypeBundle'] as const;
export type SyncType = (typeof SYNC_TYPES)[number];

export const SYNC_SCOPES = ['agentforce', 'apex', 'all'] as const;
export type SyncScope = (typeof SYNC_SCOPES)[number];
export const SCOPE_TYPES: Record<SyncScope, readonly SyncType[]> = {
  agentforce: ['AiAuthoringBundle'],
  apex: ['ApexClass', 'ApexTrigger', 'LightningComponentBundle'],
  all: SYNC_TYPES,
};
export const SCOPE_LABELS: Record<SyncScope, string> = { agentforce: 'Agents', apex: 'Apex & LWC', all: 'Everything' };
export const TYPE_LABELS: Record<SyncType, string> = {
  AiAuthoringBundle: 'Agent',
  ApexClass: 'Apex class',
  ApexTrigger: 'Apex trigger',
  LightningComponentBundle: 'LWC',
  Flow: 'Flow',
  GenAiPromptTemplate: 'Prompt template',
  LightningTypeBundle: 'Lightning type',
};

/** Agent Script action target schemes (`apex://Name`) that name a component this fetch can retrieve. */
export const TARGET_TYPES: Readonly<Record<string, SyncType>> = { apex: 'ApexClass', flow: 'Flow', generatePromptResponse: 'GenAiPromptTemplate' };

/** Most components one fetch retrieves; the job retrieves them in batches. */
export const SYNC_FETCH_MAX = 5000;

/**
 * changed: the org is newer than the last fetch and local files are untouched.
 * conflict: the org is newer and local files changed since the last fetch.
 * unknown: on disk and in the org, never fetched here, so the newer side is unknown.
 * new: in the org only. deleted: fetched before, no longer in the org.
 */
export const SYNC_STATES = ['changed', 'conflict', 'unknown', 'new', 'deleted'] as const;
export type SyncState = (typeof SYNC_STATES)[number];

export interface SyncComponent {
  /** `Type:fullName` */
  key: string;
  type: SyncType;
  fullName: string;
  state: SyncState;
  modifiedAt: string | null;
  modifiedBy: string | null;
  /** For a new agent version: the newest org version of an agent this project already has. */
  latest?: boolean;
}

export interface SyncCheck {
  org: { alias: string; orgId: string };
  scope: SyncScope;
  checkedAt: number;
  /** Components that need attention; up-to-date ones are only counted. */
  components: SyncComponent[];
  counts: Record<SyncState | 'current', number>;
  truncated: boolean;
  /** Set when the check covers one agent: its bundle, its newest org version and what its actions call. */
  agent?: SyncAgent;
  /** Up-to-date components, so a picker can list every org component; `sync.check` returns it only with `current: true`. */
  current?: SyncCurrent[];
}

export type SyncCurrent = Omit<SyncComponent, 'state' | 'latest'>;

export interface SyncAgent {
  name: string;
  /** Related components already up to date, listed so the operator sees the whole agent. */
  current: SyncCurrent[];
  /** Referenced by the agent but neither in the org nor in this project. */
  missing: string[];
}

/** same: identical. update: safe to replace (unchanged since the last fetch). create: not on disk. conflict: local edits would be lost. */
export type SyncFileAction = 'same' | 'update' | 'create' | 'conflict';

export interface SyncPlanFile {
  /** Project-relative POSIX path. */
  path: string;
  key: string;
  action: SyncFileAction;
  added?: number;
  removed?: number;
}

export type SyncJob =
  /** `retrieve` while the org copies download, then `compare` while they are matched against the project. */
  | { state: 'running'; phase: 'retrieve' | 'compare'; done: number; total: number }
  | { state: 'ready'; org: { alias: string; orgId: string }; files: SyncPlanFile[]; components: number; missing: string[] }
  | { state: 'failed'; error: string }
  | { state: 'applied'; written: number; kept: number; skipped: Array<{ path: string; reason: string }> };

export interface SyncDiff {
  path: string;
  local: string;
  org: string;
  /** Either side was longer than the preview limit, so only the start is shown. */
  truncated?: boolean;
}

export const SYNC_RPC = {
  check: 'sync.check',
  start: 'sync.fetch.start',
  status: 'sync.fetch.status',
  diff: 'sync.diff',
  apply: 'sync.apply',
  cancel: 'sync.cancel',
} as const;

/** Agent bundle versions are `<Agent>_<n>`; the bare name is the local working copy. */
export function agentVersion(name: string): { base: string; version: number } {
  const match = name.match(/^(.*?)_([1-9][0-9]*)$/);
  return match ? { base: match[1]!, version: Number(match[2]) } : { base: name, version: 0 };
}

export const isSyncScope = (value: unknown): value is SyncScope => SYNC_SCOPES.includes(value as SyncScope);
