import type { ProjectIcon } from '@zana-ai/zcc-domain';
export { PROJECT_ICONS, type ProjectIcon } from '@zana-ai/zcc-domain';
/**
 * Server-side plugin API — the `zcc` object handed to a plugin's server factory:
 * `export default function plugin(zcc: ZccPluginApi)`.
 *
 * Types only. The host implements this in `apps/server` PluginService.
 * Plugins are full-trust in the server process after install; they never
 * receive host-daemon tokens or signing keys.
 */

import {
  parsePluginAgentToolPresentation,
  type PluginAgentToolPresentation
} from './plugin-agent-tool-presentation.js';
import type {
  DispatchAdmissionContract,
  PluginCapabilityIntrospection,
  PluginInteractions,
  ProjectTabAvailabilityContract
} from './contracts.js';

import type { PluginDatabaseBackup, PluginDatabaseBackupOptions } from './database-backup.js';

export {
  PLUGIN_DATABASE_BACKUP_DEFAULT_MAX_BYTES,
  PLUGIN_DATABASE_BACKUP_HARD_MAX_BYTES,
  PLUGIN_DATABASE_BACKUP_MARKER_TABLE,
  PLUGIN_DATABASE_BACKUP_NAME_PATTERN,
  PLUGIN_DATABASE_BACKUP_RETENTION,
  PluginDatabaseBackupError,
  normalizePluginDatabaseBackupOptions,
  type PluginDatabaseBackup,
  type PluginDatabaseBackupOptions
} from './database-backup.js';

export {
  PLUGIN_AGENT_STATUS_LABEL_MAX_CHARS,
  parsePluginAgentToolPresentation,
  type PluginAgentToolPresentation
} from './plugin-agent-tool-presentation.js';

export interface PluginLogger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export type PluginSettingDescriptor =
  | {
      type: 'string';
      label: string;
      description?: string;
      secret?: true;
      multiline?: true;
      default?: string;
    }
  | { type: 'boolean'; label: string; description?: string; default?: boolean }
  | {
      type: 'number';
      label: string;
      description?: string;
      default?: number;
      min?: number;
      max?: number;
    }
  | {
      type: 'select';
      label: string;
      description?: string;
      options: string[];
      default?: string;
    }
  | { type: 'project'; label: string; description?: string; default?: string };

export type PluginSettingValue = string | number | boolean;
export type PluginSettingDescriptors = Record<string, PluginSettingDescriptor>;

export interface PluginSettingsHandle {
  get(): Promise<Record<string, PluginSettingValue | undefined>>;
  onChange(listener: (next: Record<string, PluginSettingValue | undefined>) => void): void;
}

export interface PluginSettingsSnapshot {
  descriptors: Record<string, PluginSettingDescriptor>;
  values: Record<string, PluginSettingValue | undefined>;
}

export interface PluginSettings {
  define(descriptors: Record<string, PluginSettingDescriptor>): PluginSettingsHandle;
}

export interface PluginKvStorage {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
}

export interface PluginDatabaseStatement {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): { changes: number };
}

export interface PluginDatabase {
  runScript(sql: string): void;
  prepare(sql: string): PluginDatabaseStatement;
  /** Append-only. Already-applied statements are skipped on later plugin loads. */
  migrate(statements: readonly string[]): void;
  transaction<T>(fn: () => T): T;
}

export interface PluginStorage {
  kv: PluginKvStorage;
  database(): PluginDatabase;
  /**
   * Consistent online copy of this plugin's own database (SQLite backup API),
   * written atomically as a 0600 file under the plugin's data folder. Writes
   * made while it runs are either fully in the copy or not at all. One backup
   * runs at a time per plugin; later calls wait. The copy carries a
   * `_zcc_backup` marker row (see PLUGIN_DATABASE_BACKUP_MARKER_TABLE).
   */
  backupDatabase(options: PluginDatabaseBackupOptions): Promise<PluginDatabaseBackup>;
}

export interface PluginRpc {
  method(name: string, handler: (args: unknown) => unknown | Promise<unknown>): void;
  /** Typed-contract twin of `method`. Handlers are registered by name; schema is advisory. */
  register(
    contract: unknown,
    handlers: Record<string, (args: never) => unknown>
  ): void;
}

export interface PluginRealtime {
  publish(event: string, payload: unknown): void;
}

export type PluginHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface PluginHttpRequest {
  method: PluginHttpMethod;
  path: string;
  query: Record<string, string>;
  body: unknown;
  /** Bounded raw body for binary uploads; JSON routes continue to receive `body`. */
  rawBody?: Uint8Array;
  headers?: Record<string, string>;
}

export interface PluginHttpResponse {
  status?: number;
  json?: unknown;
  body?: string | Uint8Array;
  headers?: Record<string, string>;
}

export interface PluginHttp {
  route(
    method: PluginHttpMethod,
    path: string,
    handler: (request: PluginHttpRequest) => PluginHttpResponse | Promise<PluginHttpResponse>
  ): void;
}

export const PLUGIN_CLI_OUTPUT_MAX_BYTES = 1024 * 1024;

export interface PluginCliContext {
  pluginId: string;
  argv: string[];
  projectId?: string;
  threadId?: string;
  cwd?: string;
  signal?: AbortSignal;
}

export interface PluginCliResult {
  exitCode: number;
  stdout?: string;
  stderr?: string;
}

export interface PluginCliCommandInfo {
  name: string;
  summary: string;
  usage: string;
}

export interface PluginCliOutputLimitError {
  code: 'plugin_cli_output_too_large';
  message: string;
  maxBytes: number;
  stdoutBytes: number;
  stderrBytes: number;
  totalBytes: number;
}

export interface PluginCliExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  error?: PluginCliOutputLimitError;
}

export interface PluginCliRegistration {
  name: string;
  summary: string;
  commands?: PluginCliCommandInfo[];
  run(argv: string[], ctx: PluginCliContext): PluginCliResult | Promise<PluginCliResult>;
}

export interface PluginCli {
  register(registration: PluginCliRegistration): void;
}

export type PluginThreadEventName =
  | 'thread.created'
  | 'thread.active'
  | 'thread.idle'
  | 'thread.failed'
  | 'thread.archived'
  | 'thread.deleted';

/** Bump when a breaking shape change lands on {@link PluginThreadEvent}; additive fields do not require a bump. */
export const PLUGIN_THREAD_EVENT_SCHEMA_VERSION = 1;

export interface PluginThreadEvent {
  /** Host-generated event id. Do not derive identity from event content. */
  id: string;
  /** {@link PLUGIN_THREAD_EVENT_SCHEMA_VERSION} at emission time, so a consumer can detect a future breaking shape change. */
  schemaVersion: number;
  /** Host-assigned, process-local ordering sequence. */
  sequence: number;
  /** Host clock timestamp in epoch milliseconds. */
  timestamp: number;
  name: PluginThreadEventName;
  threadId: string;
  projectId?: string;
  thread?: PluginSdkThreadSummary;
  lastAssistantText?: string | null;
  error?: string | null;
  /** The thread's harness/provider id (e.g. claude-code/codex/shell), when known. */
  providerId?: string;
  /** The model used for this turn/thread, when known. */
  model?: string;
  /** The reasoning-effort level for this turn/thread (e.g. medium/high), when known. */
  reasoningLevel?: string;
  /** Coarse execution mode — plan vs an actual agent run (see PORTABLE_EXECUTION_STATES). */
  executionState?: string;
  /** Whether the triggering turn/create input included an attachment. Presence only, never content. */
  hadAttachments?: boolean;
}

/** Input accepted by core before it adds trusted lifecycle metadata. */
export type PluginThreadEventInput = Omit<PluginThreadEvent, 'id' | 'schemaVersion' | 'sequence' | 'timestamp'>;

export interface PluginEvents {
  on(name: PluginThreadEventName, handler: (event: PluginThreadEvent) => void | Promise<void>): void;
}

/** Host-owned dispatch identity exposed to admission handlers. Never includes prompt content. */
export type PluginDispatchAdmissionRequest = DispatchAdmissionContract;

export interface PluginHooks {
  on(handler: (
    request: PluginDispatchAdmissionRequest
  ) => import('@zana-ai/zcc-domain').DispatchAdmissionDecision | Promise<import('@zana-ai/zcc-domain').DispatchAdmissionDecision>): void;
  /**
   * Register this plugin's native-tool-policy decision handler. Plugins must
   * declare `zcc.toolPolicy: true` beside `zcc.server`, and register during
   * activation before the host seals the active generation. Fires
   * for every native-provider (Claude/Codex) tool invocation on a thread this
   * plugin can see, before the tool's side effect starts. Only one handler per
   * plugin — same single-handler contract as {@link on}.
   */
  onToolPolicy(handler: (
    request: PluginToolPolicyRequest
  ) => PluginToolPolicyDecision | Promise<PluginToolPolicyDecision>): void;
}

/** Host-owned native-tool invocation identity exposed to policy handlers. Input is redacted (secrets stripped) before it ever reaches a plugin. */
export interface PluginToolPolicyRequest {
  invocationId: string;
  threadId: string;
  projectId: string;
  providerId: string;
  toolName: string;
  input: Record<string, unknown>;
}

/**
 * A tool policy's answer for one native tool call. `allow` means "no plugin
 * objects", never approval: the provider's own permission flow still decides.
 * `deny` blocks the call before it runs and its `reason` is shown to the
 * agent; a blank or ill-formed reason is replaced and reasons are capped at
 * 1024 characters.
 */
export type PluginToolPolicyDecision =
  | { action: 'allow' }
  | { action: 'deny'; reason: string };

export interface PluginSdkThreadSummary {
  id: string;
  title?: string | null;
  titleFallback?: string | null;
  updatedAt?: number;
  deletedAt?: number | null;
  projectId: string;
  hostId: string;
  environmentId: string | null;
  providerId: string;
  status: string;
  originKind?: string | null;
  originPluginId?: string | null;
  visibility?: string;
  archivedAt?: number | null;
  /** Epoch ms the user pinned the thread, or null when it is not pinned. */
  pinnedAt?: number | null;
  createdAt?: number;
  parentThreadId?: string | null;
}

export interface PluginSdkThreadEventRow {
  seq: number;
  type: string;
  payload: unknown;
}

export interface PluginSdkThreadEventListArgs {
  threadId: string;
  limit?: number;
  types?: readonly string[];
  order?: 'asc' | 'desc';
}

export interface PluginSdkThreadSendArgs {
  threadId: string;
  prompt: string;
  visibility?: 'visible' | 'agent-only';
  mode?: 'start' | 'auto' | 'steer' | 'queue-if-active' | 'steer-if-active';
}

/** How `threads.spawn` picks a harness when no `providerId` is given. */
export type PluginSdkThreadSpawnHarness = 'project-default';

export interface PluginSdkThreadSpawnArgs {
  projectId: string;
  prompt: string;
  /**
   * Exact thread provider id. Wins over `harness`; an unknown id rejects.
   * With neither `providerId` nor `harness`, the host uses its first
   * registered provider (legacy behaviour, kept for older plugins).
   */
  providerId?: string;
  /**
   * `'project-default'`: run the project's effective AI harness, exactly as a
   * new agent launch would (Settings → AI Harness global default, then the
   * project's override), with the same AI-harness overrides (model, execution
   * state, native role, Codex sandbox/approval) mapped onto the thread. An
   * override the thread cannot honor rejects; explicit `model` /
   * `permissionMode` still win. A yolo/unrestricted default also implies
   * `permissionMode: 'full'` unless one is passed. Rejects with an actionable
   * message when no usable harness resolves; never falls back silently.
   */
  harness?: PluginSdkThreadSpawnHarness;
  parentThreadId?: string;
  title?: string;
  model?: string;
  reasoningLevel?: string;
  serviceTier?: string;
  hostId?: string;
  permissionMode?: 'accept-edits' | 'auto' | 'full';
  visibility?: 'visible' | 'hidden';
  environment?: import('@zana-ai/zcc-domain').SpawnEnvironmentChoice;
  pluginMetadata?: JsonObject;
}

export interface PluginSdkThreadOutput {
  output: string;
}

export interface PluginSdkExecutionOptions {
  model: string;
  reasoningLevel: string;
  permissionMode: string;
}

export interface PluginSdkEnvironment {
  id: string;
  projectId: string;
  hostId: string;
  path: string | null;
}

export interface PluginSdkFileReadArgs {
  hostId?: string;
  path: string;
  rootPath?: string;
  signal?: AbortSignal;
}

export interface PluginSdkFileReadResult {
  content: string;
  contentEncoding: 'utf8' | 'base64';
  sizeBytes: number;
}

export interface PluginSdkProviderInfo {
  id: string;
  displayName?: string;
  logoUrl?: string | null;
  icon?: string | null;
  strings?: { iconTint?: string | null };
  available: boolean;
  capabilities?: {
    permissionModes: string[];
    supportsServiceTier?: boolean;
  };
}

export interface PluginSdkProviderModel {
  id: string;
  model: string;
  supportedReasoningEfforts: Array<{ reasoningEffort: string }>;
}

export interface PluginSdkModelCatalog {
  models: PluginSdkProviderModel[];
  selectedOnlyModels: PluginSdkProviderModel[];
  modelLoadError: { providerId: string; code: string; detail?: string | null } | null;
}

export interface PluginSdkThreadIdArgs {
  threadId: string;
}

export interface PluginSdkAgentContextSeed {
  type: 'text';
  text: string;
  mentions: unknown[];
  visibility: 'agent-only';
}

export interface PluginSdkThreadForkArgs {
  threadId?: string;
  sourceThreadId?: string;
  sourceSeqEnd?: number;
  visibility?: 'visible' | 'hidden';
  workspace?: 'reuse' | 'isolated';
  agentContextSeed?: readonly PluginSdkAgentContextSeed[];
  title?: string;
}

export interface PluginSdkThreadListArgs {
  includeHidden?: boolean;
  originKind?: 'fork';
  originPluginId?: string;
  archived?: boolean;
  limit?: number;
  offset?: number;
}

export interface PluginSdkQueuedMessage {
  id: string;
}

export interface PluginSdkThreads {
  spawn(args: PluginSdkThreadSpawnArgs): Promise<{ id: string }>;
  get(args: { threadId: string }): Promise<PluginSdkThreadSummary | null>;
  list(args?: PluginSdkThreadListArgs): Promise<PluginSdkThreadSummary[]>;
  /** Search visible saved threads by title/message, newest first, including archives unless filtered. */
  search(args: { query: string; archived?: boolean; limit?: number }): Promise<PluginSdkThreadSummary[]>;
  events: {
    list(args: PluginSdkThreadEventListArgs): Promise<PluginSdkThreadEventRow[]>;
  };
  send(args: PluginSdkThreadSendArgs): Promise<{ id: string }>;
  stop(args: PluginSdkThreadIdArgs): Promise<{ ok: true }>;
  output(args: PluginSdkThreadIdArgs): Promise<PluginSdkThreadOutput>;
  defaultExecutionOptions(args: PluginSdkThreadIdArgs): Promise<PluginSdkExecutionOptions>;
  archive(args: PluginSdkThreadIdArgs): Promise<{ id: string }>;
  fork(args: PluginSdkThreadForkArgs | PluginSdkThreadIdArgs): Promise<{ id: string }>;
  unarchive(args: PluginSdkThreadIdArgs): Promise<{ id: string }>;
  getPluginMetadata(args: { threadId: string; pluginId?: string }): Promise<JsonObject>;
  updatePluginMetadata(args: {
    threadId: string;
    pluginId?: string;
    set?: JsonObject;
    remove?: readonly string[];
  }): Promise<JsonObject>;
  queuedMessages: {
    list(args: PluginSdkThreadIdArgs): Promise<PluginSdkQueuedMessage[]>;
    create(args: {
      threadId: string;
      input: unknown[];
      senderThreadId?: string;
    }): Promise<PluginSdkQueuedMessage>;
  };
}

export interface PluginSdkEnvironments {
  get(args: { environmentId: string }): Promise<PluginSdkEnvironment>;
  pullRequest(args: { environmentId: string }): Promise<{
    pullRequest: import('@zana-ai/zcc-domain').GitHostPullRequest | null;
    unavailableReason?: string;
  }>;
}

export interface PluginSdkFiles {
  /** Resolve a file opener's saved project/source/environment on its owner host. */
  readProject(args: { path: string; source: import('./app-contract.js').PluginFileOpenerSource }): Promise<PluginSdkFileReadResult & { sha256: string }>;
  writeProject(args: { path: string; source: import('./app-contract.js').PluginFileOpenerSource; content: string; expectedSha256: string | null }): Promise<
    { outcome: 'written'; sha256: string } | { outcome: 'conflict'; currentSha256: string | null }
  >;
  read(args: PluginSdkFileReadArgs): Promise<PluginSdkFileReadResult>;
  write(args: {
    hostId?: string; path: string; rootPath?: string; content: string;
    contentEncoding?: 'utf8' | 'base64'; createParents?: boolean;
  }): Promise<void>;
}

export type PluginSdkLibraryScope = 'project' | 'global';

export interface PluginSdkLibraryDoc {
  id: string;
  relPath: string;
  title: string;
  summary?: string;
  tags?: string[];
  scope: PluginSdkLibraryScope;
  projectId?: string;
}

export interface PluginSdkLibraryListArgs {
  projectId?: string;
  hostId?: string;
}

export interface PluginSdkLibraryReadArgs {
  scope: PluginSdkLibraryScope;
  relPath: string;
  projectId?: string;
  hostId?: string;
}

export interface PluginSdkLibraryWriteArgs {
  scope: PluginSdkLibraryScope;
  relPath: string;
  content: string;
  expectedSha256?: string;
  projectId?: string;
  hostId?: string;
}

export interface PluginSdkLibrary {
  list(args?: PluginSdkLibraryListArgs): Promise<PluginSdkLibraryDoc[]>;
  read(
    args: PluginSdkLibraryReadArgs
  ): Promise<{ ok: true; content: string; sha256?: string } | { ok: false; message: string }>;
  write(args: PluginSdkLibraryWriteArgs): Promise<{ ok: true; sha256?: string } | { ok: false; message: string }>;
}

export interface PluginSdkProviders {
  list(args?: { environmentId?: string }): Promise<PluginSdkProviderInfo[]>;
  models(args: { environmentId?: string; hostId?: string; providerId: string }): Promise<PluginSdkModelCatalog>;
}

export interface PluginSdkInboxPushArgs {
  projectId: string;
  comments: string;
}

export interface PluginSdkInbox {
  push(args: PluginSdkInboxPushArgs): Promise<{ id: string }>;
  /** Read-only, explicitly scoped to registered Projects; never marks entries read. */
  search(args: PluginSdkInboxSearchArgs): Promise<PluginSdkInboxSearchResult>;
  /** Read only a document attached to the named inbox entry. */
  read(args: { projectIds: string[]; entryId: string; documentIndex?: number }): Promise<PluginSdkInboxReport>;
}

export interface PluginSdkInboxSearchArgs {
  projectIds: string[];
  query?: string;
  before?: string;
  limit?: number;
  unreadOnly?: boolean;
  reportsOnly?: boolean;
}
export interface PluginSdkInboxEntry {
  id: string;
  ts: number;
  projectId: string;
  projectName: string;
  subject: string;
  comments: string;
  documents: number;
  unread: boolean;
}
export interface PluginSdkInboxSearchResult {
  entries: PluginSdkInboxEntry[];
  hasMore: boolean;
  nextBefore?: string;
}
export interface PluginSdkInboxReport extends PluginSdkInboxEntry {
  documentIndex?: number;
  content: string;
  truncated: boolean;
}
export interface PluginSdkAssistant {
  /** Bounded text-only inference, without agent tools or Project access. */
  complete(args: { instructions: string; prompt: string; signal?: AbortSignal }): Promise<{ text: string }>;
}

export interface PluginSdkProject {
  /** Host attestation that this path belongs to the local execution host. Absence means unknown. */
  local?: boolean;
  icon?: ProjectIcon;
  /** Host-owned marker for the built-in Default Project; independent of its name. */
  quickAgent?: boolean;
  id: string;
  name: string;
  path?: string;
}

export interface PluginSdkProjects {
  list(): Promise<PluginSdkProject[]>;
  /** Persist a project glyph from PROJECT_ICONS. Circle restores the ordinary dot. */
  setIcon(args: { projectId: string; icon: ProjectIcon }): Promise<void>;
}

export interface PluginPeerRequest {
  peerId: string;
  body: unknown;
  scope: string;
  grantEpoch: number;
  signal: AbortSignal;
  /** Fence a synchronous transaction against revocation; callback must not await. */
  commitSync<T>(commit: () => T extends PromiseLike<unknown> ? never : T): Promise<T>;
}

/** Pair-authorized app identities. Enrollment alone never grants plugin access. */
export interface PluginPeerGrant {
  id: string;
  pairId: string;
  proposalId: string;
  scope: string;
  grantEpoch: number;
}

export interface PluginEnrolledPeer {
  id: string;
  hostId: string;
  name: string;
  connected: boolean;
}


export type PluginInvitationState = 'open' | 'redeeming' | 'reserved' | 'consented' | 'connecting' | 'ready' | 'denied' | 'cancelled' | 'expired' | 'failed';
export type PluginInvitationDecision = 'pending' | 'approved' | 'denied';
/**
 * Stable, secret-free failure codes. The `ssh_*` codes mean the secure shell (SSH) link between the two computers
 * cannot be set up: Zana's connection service could not start on the inviting computer, it is unreachable, it refused the key or the
 * forwarding, or its host key changed.
 */
export type PluginInvitationReason =
  | 'invalid_invitation' | 'own_invitation' | 'wrong_plugin' | 'expired' | 'denied' | 'cancelled'
  | 'already_redeemed' | 'already_connected' | 'attempt_limit' | 'identity_mismatch' | 'unreachable' | 'not_found' | 'capacity' | 'replay'
  | 'stale_generation' | 'owner_proof_required' | 'not_ready' | 'fenced' | 'unavailable' | 'unknown_connection' | 'use_unavailable'
  | 'ssh_remote_login_off' | 'ssh_unreachable' | 'ssh_auth_refused' | 'ssh_forwarding_refused' | 'ssh_host_key_mismatch';

/** Redacted projection of one of this plugin's invitations. Never carries a token, key, locator or credential. */
export interface PluginInvitationStatus {
  invitationId: string;
  role: 'inviter' | 'redeemer';
  scope: string;
  state: PluginInvitationState;
  reason?: PluginInvitationReason;
  localFingerprint: string;
  /** The other computer once discovered; `fingerprint` is for out-of-band confirmation. */
  peer?: { instanceId: string; name: string; fingerprint: string };
  inviterDecision: PluginInvitationDecision;
  redeemerDecision: PluginInvitationDecision;
  pairingId?: string;
  generation: number;
  expiresAt: number;
  consentExpiresAt?: number;
}

/** Transport state of one invitation-founded peer link. Secret-free. */
export interface PluginPeerLink {
  pairingId: string;
  peerInstanceId: string;
  /** The peer's display name from pairing. Absent on links made before names were kept: fall back to another label, never show the id. */
  peerName?: string;
  scope: string;
  role: 'inviter' | 'redeemer';
  phase: 'pending' | 'exchanged' | 'enrolled' | 'linked' | 'failed' | 'removed';
  state: 'connected' | 'reconnecting' | 'disconnected';
  reason?: 'ssh-down' | 'credential-expired' | 'peer-offline' | 'paused' | 'revoked';
  failure?: 'expired' | 'fenced' | 'conflict' | 'unreachable';
  retryInMs?: number;
  /** @deprecated Never set: a link rides an SSH tunnel with a per-link key that has no expiry; it is rotated by `reconnectPeer`. */
  credentialExpiresAt?: number;
}

/** `label` is 1-40 characters, `detail` at most 200; no control characters. `attention` renders amber. */
export interface PluginPeerLinkNote {
  state: 'ok' | 'attention';
  label: string;
  detail?: string;
}

/** Opaque id of a connected computer; stable for the life of the connection. */
export type PeerComputerId = string;

/** One computer connected to this one. Carries nothing about other plugins' uses, keys or addresses. */
export interface PeerConnection {
  computerId: PeerComputerId;
  /** Display label only; two computers can share it. */
  hostname: string;
  state: 'connected' | 'reconnecting' | 'disconnected';
  /** True once the owner approved this plugin's use of the connection. */
  usedByThisPlugin: boolean;
}

/**
 * Core-owned computer connections. A plugin sees every connected computer, asks to use one, and cleans up when one
 * is being removed. Optional on older hosts. Failures use the fixed `PluginInvitationReason` codes.
 */
export interface PluginSdkPeerConnections {
  /** Every connected computer, including ones no plugin uses yet. */
  list(args?: { signal?: AbortSignal }): Promise<PeerConnection[]>;
  /** Ask the owner to let this plugin use the connection. `pending` until both computers' owners have decided. */
  requestUse(computerId: PeerComputerId, args?: { signal?: AbortSignal }): Promise<{ status: 'pending' | 'approved' | 'denied' }>;
  /** Stop this plugin's use. A recent successful transfer gets a core-owned Stop anyway confirmation. The connection always stays; only the owner removes it in Settings. */
  stopUsing(computerId: PeerComputerId, args?: { signal?: AbortSignal }): Promise<void>;
  /** Called after any connection changes, with the current list. Returns the unsubscribe; released when the plugin stops. */
  onChange(callback: (connections: PeerConnection[]) => void): () => void;
  /**
   * One handler per plugin. Runs when the owner removes a connection, in parallel with other plugins' handlers, and
   * is given 5 seconds. A throw or timeout never blocks the removal: the owner is offered Retry or Remove anyway.
   * Make the handler idempotent. Returns the unsubscribe.
   */
  onConnectionRemoving(handler: (computerId: PeerComputerId) => Promise<void>): () => void;
  /** Short status (at most 200 characters) shown beside this plugin's use. `null` clears. In memory only. */
  setStatus(computerId: PeerComputerId, note: string | null): void;
}

export interface PluginSdkPeers {
  /** Core-owned connections. Absent on older hosts. */
  connections?: PluginSdkPeerConnections;
  localIdentity(): Promise<{ id: string }>;
  /**
   * This plugin's app-level storage epoch, held by core outside the plugin's data folder so restoring or copying
   * that folder cannot roll it back. `null` when this host cannot provide the fence. Optional on older hosts.
   */
  storageEpoch?(): Promise<number | null>;
  /** Compare-and-advance the storage epoch by one; rejects when `expected` is not current. Optional on older hosts. */
  advanceStorageEpoch?(expected: number): Promise<number>;
  /** Verified reachable app/host mappings, not plugin grants or credentials. */
  enrolled(args?: { signal?: AbortSignal }): Promise<PluginEnrolledPeer[]>;
  features(): Promise<{ lifecycle: boolean; introductions: boolean; installer: boolean; /** Absent on older hosts. */ invitations?: boolean }>;
  /** Core verifies mutual execution enrollment. Domain consent remains the plugin's responsibility. */
  enable(peerId: string, args: { scope: string; signal?: AbortSignal }): Promise<PluginPeerGrant>;
  /** Releases this plugin scope's use of the peer's link. The link itself stays (zero uses is normal); the owner removes it in Settings. */
  revoke(peerId: string, args: { scope: string }): Promise<void>;
  /*
   * Invitations: optional because older hosts lack them (test `typeof peers.createInvitation === 'function'`).
   * Every call is bound to the calling plugin; a plugin only sees its own invitations and links. Errors carry fixed,
   * secret-free messages. The token is returned once, by `createInvitation`, and never again.
   */
  /**
   * Open a one-time invitation for `scope`, valid for 10 minutes. Refuses with an `ssh_*` reason when this computer
   * cannot accept the SSH link (for example its connection service could not start). A second invitation between the same two apps is refused with `already_connected` while a link exists.
   */
  createInvitation?(args: { scope: string; signal?: AbortSignal }): Promise<{ invitationId: string; token: string; expiresAt: number; code: string }>;
  /**
   * Redeem a pasted token. `code` is the approval code the inviter's owner reads aloud; it unseals the invitation's
   * bootstrap seed, so a token on its own cannot connect. Re-pasting the same token (with the same code) resumes the same attempt.
   */
  redeemInvitation?(args: { token: string; code: string; signal?: AbortSignal }): Promise<PluginInvitationStatus>;
  /** `refresh` makes a redeemer poll the inviter now instead of waiting for backoff, at most once per 10 s per invitation (else the stored status). */
  invitationStatus?(args: { invitationId: string; refresh?: boolean; signal?: AbortSignal }): Promise<PluginInvitationStatus>;
  /** Newest first, bounded. */
  listInvitations?(args?: { limit?: number; signal?: AbortSignal }): Promise<PluginInvitationStatus[]>;
  /** The core-rendered approval sheet for a reserved invitation; pass it to `experimental_requestApproval`. */
  invitationApproval?(args: { invitationId: string; signal?: AbortSignal }): Promise<PluginApprovalRequest>;
  /** `approved` needs `ownerProof` (the single-use token from that sheet); `denied` needs none. */
  decideInvitation?(args: { invitationId: string; decision: 'approved' | 'denied'; ownerProof?: string; signal?: AbortSignal }): Promise<PluginInvitationStatus>;
  /** Owner cancel; no proof needed. Idempotent. */
  cancelInvitation?(args: { invitationId: string; signal?: AbortSignal }): Promise<void>;
  /** Transport state of this plugin's invitation-founded links, optionally for one peer. */
  peerLinks?(args?: { peerId?: string; signal?: AbortSignal }): Promise<PluginPeerLink[]>;
  /**
   * Attach a short status to one of this plugin's peer links; core shows it beside this plugin's row in Settings → Peers.
   * `note: null` clears it. Refused (`not_found`) unless this plugin owns a link to `peerId` in `scope`. In memory only:
   * dropped when the plugin stops or the link/use goes, so re-report on every poll. Optional on older hosts.
   */
  setPeerLinkNote?(peerId: string, args: { scope: string; note: PluginPeerLinkNote | null; signal?: AbortSignal }): Promise<void>;
  /** Rotate the link credential (a fresh forward-only join code over the live link) and reopen the link. Linked peers only. */
  reconnectPeer?(peerId: string, args?: { signal?: AbortSignal }): Promise<PluginPeerLink[]>;
  /** Queue a scoped introduction; does not install or enroll a daemon. Both peers need current grants. */
  introduce(peerId: string, args: { sponsorPeerId: string; scope: string; signal?: AbortSignal }): Promise<{ introductionId: string; status: 'pending' | 'complete' | 'blocked' }>;
  list(args?: { signal?: AbortSignal }): Promise<Array<{ id: string; name: string; scope: string; grantEpoch: number; connected: boolean }>>;
  call(peerId: string, method: string, body: unknown, args?: { signal?: AbortSignal; timeoutMs?: number; scope?: string }): Promise<unknown>;
  /** Register a private, pair-authenticated peer protocol method. */
  handle(method: string, handler: (request: PluginPeerRequest) => unknown | Promise<unknown>): void;
}

export interface PluginSdk {
  experimental_promptHistory: {
    list(args: { scope: 'thread' | 'project' | 'all'; threadId?: string; projectId?: string; cursor?: string; query?: string }): Promise<{
      entries: Array<{id:string; createdAt:number; input: import('@zana-ai/zcc-domain/thread-runtime').PromptInput[]; threadId:string; projectId:string; hostId:string; sequence:number}>;
      nextCursor: string | null;
    }>;
  };
  system: { defaultHost(): Promise<{ id: string } | null> };
  /** Enrolled machine identity only; no host credentials or connection metadata. */
  hosts: {
    /** Execution machines only (Settings → Machines). Forward-only peer links never appear here. */
    list(args?: { signal?: AbortSignal }): Promise<Array<{ id: string; name: string }>>;
  };
  peers: PluginSdkPeers;
  threads: PluginSdkThreads;
  inbox: PluginSdkInbox;
  assistant: PluginSdkAssistant;
  projects: PluginSdkProjects;
  environments: PluginSdkEnvironments;
  files: PluginSdkFiles;
  library: PluginSdkLibrary;
  providers: PluginSdkProviders;
  experimental_desktopBrowsers: PluginSdkDesktopBrowsers;
  capabilities: PluginCapabilityIntrospection;
}

export interface PluginSdkDesktopBrowserScope {
  hostId: string;
  instanceId: string;
  generation: string;
  threadId: string;
}

export interface PluginSdkDesktopBrowserTab {
  tabId: string;
  threadId?: string;
  url?: string;
  title?: string;
  profile: { kind: 'personal' } | { kind: 'automation'; id: string };
  control?: { leaseId: string } | null;
}

export interface PluginSdkDesktopBrowsers {
  listInstances(input: { hostId: string }): Promise<{
    instances: Array<{ instanceId: string; generation: string; label: string; hostId: string }>;
  }>;
  listTabs(input: PluginSdkDesktopBrowserScope): Promise<{ tabs: PluginSdkDesktopBrowserTab[] }>;
  createTab(
    input: PluginSdkDesktopBrowserScope & { url?: string; presentation?: 'hidden' | 'reveal' }
  ): Promise<{ tab: PluginSdkDesktopBrowserTab }>;
  acquireControl(
    input: PluginSdkDesktopBrowserScope & {
      tabIds: string[];
      controllerLabel: string;
      ttlMs?: number;
      allowPersonal?: boolean;
    }
  ): Promise<{
    hostId: string;
    instanceId: string;
    generation: string;
    threadId: string;
    leaseId: string;
    tabIds: string[];
    controllerLabel: string;
    expiresAt: number;
  }>;
  openConnection(
    input: PluginSdkDesktopBrowserScope & { leaseId: string }
  ): Promise<{ hostId: string; wsEndpoint: string; expiresAt: number }>;
  releaseControl(input: PluginSdkDesktopBrowserScope & { leaseId: string }): Promise<{ ok: true }>;
  revealTab(input: PluginSdkDesktopBrowserScope & { tabId: string }): Promise<{ ok: true }>;
  closeTab(input: PluginSdkDesktopBrowserScope & { tabId: string }): Promise<{ ok: true }>;
  captureTab(input: PluginSdkDesktopBrowserScope & { tabId: string }): Promise<{ base64: string; mimeType: string }>;
  listImportSources(input: {
    hostId: string;
    instanceId: string;
    generation: string;
  }): Promise<{ sources: unknown[] }>;
  importCookies(input: {
    hostId: string;
    instanceId: string;
    generation: string;
    sourceId: string;
    sourceProfileDirectory: string;
    profile?: { kind: 'personal' } | { kind: 'automation'; id: string };
  }): Promise<unknown>;
  subscribe(
    input: PluginSdkDesktopBrowserScope & {
      onChange: (result: { tabs: PluginSdkDesktopBrowserTab[] }) => void;
      onError: (error: Error) => void;
    }
  ): { dispose(): void };
}

export interface PluginHostClient {
  experimental_onSignal(signal: string, handler: (event: { readonly hostId: string; readonly payload: unknown }) => void | Promise<void>): () => void;
  call(
    method: string,
    input?: unknown,
    options?: { hostId?: string; signal?: AbortSignal; timeoutMs?: number }
  ): Promise<unknown>;
  experimental_onWorkerExit(
    handler: (event: { readonly hostId: string }) => void | Promise<void>
  ): () => void;
}

export interface PluginHostApi {
  experimental_call(method: string, input?: unknown): Promise<unknown>;
  projectCall(request: import('@zana-ai/zcc-domain').HostRpcContract): Promise<import('@zana-ai/zcc-domain').HostRpcResultContract>;
  experimental_client(args?: { contract?: unknown }): PluginHostClient;
}

export interface PluginAgentToolContext {
  /** Host-resolved; false when the controlling user cannot see desktop UI. */
  desktopPresentation?: boolean;
  threadId: string;
  projectId: string;
  signal: AbortSignal;
}

export interface PluginAgentToolRegistration {
  /** Hide/gate desktop-only tools, or gate the listed top-level action values. */
  desktopOnly?: boolean | readonly string[];
  name: string;
  description: string;
  /**
   * Zod schema (validated per call) or a JSON-schema object. Preferred over
   * `inputSchema`.
   */
  parameters?: unknown;
  /** @deprecated Alias for `parameters`. */
  inputSchema?: unknown;
  /** Optional usage snippet appended to the session when this tool is selected. */
  instructions?: string;
  presentation?: PluginAgentToolPresentation;
  execute(input: unknown, ctx: PluginAgentToolContext): unknown | Promise<unknown>;
}

/** Stored record after `registerTool` — JSON schema plus parse/execute. */
export interface PluginAgentToolRecord {
  /** Hide/gate desktop-only tools, or gate the listed top-level action values. */
  desktopOnly?: boolean | readonly string[];
  name: string;
  description: string;
  presentation: PluginAgentToolPresentation | null;
  instructions: string | null;
  inputSchema: unknown;
  parse(input: unknown): { ok: true; value: unknown } | { ok: false; error: string };
  execute(input: unknown, ctx: PluginAgentToolContext): unknown | Promise<unknown>;
}

export function enforcePluginCliOutputLimit(result: PluginCliResult): PluginCliExecutionResult {
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const stdoutBytes = utf8ByteLength(stdout);
  const stderrBytes = utf8ByteLength(stderr);
  const totalBytes = stdoutBytes + stderrBytes;
  if (totalBytes <= PLUGIN_CLI_OUTPUT_MAX_BYTES) {
    return { exitCode: result.exitCode, stdout, stderr };
  }
  return {
    exitCode: 1,
    stdout: '',
    stderr: '',
    error: {
      code: 'plugin_cli_output_too_large',
      message: `plugin CLI output is ${totalBytes} bytes, exceeding the ${PLUGIN_CLI_OUTPUT_MAX_BYTES}-byte limit. Narrow the query, request a smaller page, or use a file/streaming command.`,
      maxBytes: PLUGIN_CLI_OUTPUT_MAX_BYTES,
      stdoutBytes,
      stderrBytes,
      totalBytes
    }
  };
}

function utf8ByteLength(value: string): number {
  const encoder = new TextEncoder();
  const chunkChars = 16 * 1024;
  let bytes = 0;
  for (let start = 0; start < value.length;) {
    let end = Math.min(start + chunkChars, value.length);
    if (end < value.length && isHighSurrogate(value.charCodeAt(end - 1))) end -= 1;
    bytes += encoder.encode(value.slice(start, end)).byteLength;
    start = end;
  }
  return bytes;
}

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

export interface PluginBackground {
  service(name: string, start: () => void | (() => void) | Promise<void | (() => void)>): void;
  schedule(cron: string, job: () => void | Promise<void>): void;
  schedule(name: string, cron: string, job: () => void | Promise<void>): void;
}

/** One variable a plugin asks the host to set for sessions that run on non-primary machines. */
export interface PluginRemoteEnvironmentEntry {
  name: string;
  value: string;
  /** Entries that share a group are applied together or not at all. */
  group?: string;
  /** Apply only when every named variable is non-empty on the machine (after this push is applied). */
  requires?: readonly string[];
}

/**
 * Contribute environment for sessions on non-primary (remote) machines.
 *
 * The manifest must list the variable names it may set in
 * `zcc.extra.remoteEnvironment` (exact names or a `PREFIX_*` pattern); anything
 * else, and names that redirect execution (`PATH`, `LD_*`, ...), is dropped.
 * Values are held in memory by the host and the target daemon and are never
 * persisted. A value the machine user already set always wins. Spawning never
 * waits on `resolve`: the host calls it in the background.
 */
export interface PluginRemoteEnvironment {
  /** Register the single provider for this plugin. Throws when called twice. */
  provide(
    resolve: () => readonly PluginRemoteEnvironmentEntry[] | Promise<readonly PluginRemoteEnvironmentEntry[]>
  ): void;
  /** Ask the host to call the provider again soon (for example after a setting changed). Fire-and-forget. */
  refresh(): void;
}

export interface PluginProviderCapabilities {
  supportsServiceTier: boolean;
  supportsNativeUserQuestion?: boolean;
  fork: ProviderFork;
  supportsManualCompaction?: boolean;
  supportsThreadArchive: boolean;
  supportsThreadRename: boolean;
  supportsWorkflows?: boolean;
  permissionModes: string[];
  reasoningLevels?: string[];
}

export type PluginProviderVisibility = 'always' | 'installed';

export interface PluginProviderOptionsContext {
  threadId: string;
  projectId: string;
  model?: string;
  permissionMode: string;
  promptMode?: 'plan';
  settings: Readonly<Record<string, PluginSettingValue | undefined>>;
}

export interface PluginProviderDeclaration {
  id: string;
  displayName: string;
  family?: string;
  icon?: string;
  capabilities: PluginProviderCapabilities;
  composerActions?: string[];
  /** Hide from the picker until CLI health reports the binary is installed. */
  visibility?: PluginProviderVisibility;
  experimental_visibility?: PluginProviderVisibility;
  experimental_bridgeOptions?: Readonly<Record<string, JsonValue>>;
  maintenance?: PluginProviderMaintenance;
  strings?: PluginProviderStrings;
  serviceTiers?: readonly PluginProviderOptionDescriptor[];
  reasoningLevels?: readonly PluginProviderOptionDescriptor[];
  extensionKinds?: Readonly<Record<string, PluginProviderExtensionKindDeclaration>>;
  models?: {
    fallback?: readonly PluginProviderFallbackModel[];
    scope?: PluginProviderModelCatalogScope;
  };
  env?: { passthrough: readonly string[] };
  experimental_nativeSkillRoots?: PluginProviderNativeRoots;
  experimental_nativeCommandRoots?: PluginProviderNativeRoots;
  experimental_resolvesNativeRoots?: boolean;
  deriveProviderOptions?: (
    context: PluginProviderOptionsContext
  ) => Record<string, unknown> | void;
}

export interface PluginProviderHandle {
  id: string;
  unregister(): void;
}

export interface PluginPtyHarnessProfile {
  id: string;
  label: string;
}

export interface PluginPtyHarnessDeclaration {
  id: string;
  displayName: string;
  icon?: string;
  profiles: PluginPtyHarnessProfile[];
  alwaysEnabled?: boolean;
  enableConfigKey?: string;
}

export interface PluginAgentConfigureContext {
  desktopPresentation?: boolean;
  threadId?: string;
  projectId?: string;
  origin?: { kind?: 'fork' | null; pluginId?: string | null };
  /**
   * This plugin's thread namespace, or `{}` when absent. Deep-frozen for the
   * configure call. Treat values as untrusted.
   */
  pluginMetadata?: JsonObject;
  thread?: PluginSdkThreadSummary & {
    title?: string | null;
    parentThreadId?: string | null;
    sourceThreadId?: string | null;
  };
  project?: {
    id: string;
    kind?: 'standard' | 'personal';
    name?: string;
    gitRemoteUrl?: string | null;
  };
  environment?: {
    id: string;
    name?: string | null;
    path?: string | null;
    workspaceProvisionType?: 'unmanaged' | 'managed-worktree' | 'personal';
    branchName?: string | null;
  };
  host?: { id: string; name: string };
  provider?: {
    id: string;
    model?: string;
    capabilities?: { supportsNativeUserQuestion?: boolean };
  };
}

export type PluginAgentConfiguredTool =
  | string
  | { name: string; parameters?: unknown };

export interface PluginAgentConfigureResult {
  tools?: PluginAgentConfiguredTool[];
  skills?: string[];
  instructions?: string;
}

export interface PluginAgents {
  contributeInstructions(
    textOrProvider: string | ((ctx: { threadId: string; projectId: string }) => string | null)
  ): void;
  contributeSkills(rootPaths: string[]): void;
  registerTool(registration: PluginAgentToolRegistration): void;
  registerPersonas(personas: readonly import('@zana-ai/zcc-domain/product').PersonaInput[]): void;
  registerTeams(teams: readonly import('@zana-ai/zcc-domain/product').TeamInput[]): void;
  experimental_registerProvider(declaration: PluginProviderDeclaration): PluginProviderHandle;
  experimental_registerPtyHarness(declaration: PluginPtyHarnessDeclaration): PluginProviderHandle;
  configure(
    provider: (
      ctx: PluginAgentConfigureContext
    ) => PluginAgentConfigureResult | void | Promise<PluginAgentConfigureResult | void>
  ): void;
}

import type { JsonObject, JsonValue, ProviderFork } from '@zana-ai/zcc-domain/thread-runtime';
import type { PluginApprovalBinding, PluginApprovalRequest } from './approval-contract.js';
export type { PluginApprovalBinding, PluginApprovalRequest, PluginApprovalResult } from './approval-contract.js';
import type { PluginServices } from './plugin-services.js';
import type {
  PluginProviderExtensionKindDeclaration,
  PluginProviderFallbackModel,
  PluginProviderMaintenance,
  PluginProviderModelCatalogScope,
  PluginProviderNativeRoots,
  PluginProviderOptionDescriptor,
  PluginProviderStrings
} from './backend-contract.js';

export {
  PLUGIN_SERVICE_UNAVAILABLE,
  PluginServiceUnavailableError,
  bindPluginServices,
  createLiveServiceProxy,
  createPluginServicesRegistry,
  type PluginServices,
  type PluginServicesRegistry
} from './plugin-services.js';

export type PluginInteractionCancelReason =
  | 'user'
  | 'request-aborted'
  | 'thread-stopped'
  | 'thread-deleted'
  | 'plugin-disposed'
  | 'server-restarted'
  | 'timeout';

export type PluginInteractionResult =
  | { outcome: 'submitted'; value: JsonValue }
  | { outcome: 'cancelled'; reason: PluginInteractionCancelReason };

export interface PluginInteractionRequest {
  threadId: string;
  rendererId: string;
  title: string;
  payload: JsonValue;
  timeoutMs?: number;
}

export interface PluginMentionSuggestion {
  id: string;
  label: string;
  insertText?: string;
}

export const PLUGIN_MENTION_TRIGGERS = ['@', '#', '$', '!', '~'] as const;
export type PluginMentionTrigger = (typeof PLUGIN_MENTION_TRIGGERS)[number];

export interface PluginMentionSearchContext {
  query: string;
  trigger?: string;
  projectId?: string;
  threadId?: string;
}

export interface PluginMentionResolveResult {
  context: string;
}

export interface PluginMentionProviderRegistration {
  id: string;
  label: string;
  /** @deprecated Prefer `triggers`. A single character still treated as `triggers: [trigger]`. */
  trigger?: string;
  triggers?: readonly PluginMentionTrigger[];
  search(
    ctx: PluginMentionSearchContext | string
  ): PluginMentionSuggestion[] | Promise<PluginMentionSuggestion[]>;
  resolve(itemId: string): PluginMentionResolveResult | Promise<PluginMentionResolveResult>;
}

/** Main supplies `projectId`; the plugin's own `tabId` is never ambiguous across plugins. */
export interface PluginProjectTabAvailabilityContext {
  projectId: string;
}

export interface PluginProjectTabAvailabilityRegistration {
  /** Must match the `id` of a tab registered via a project-tab slot. */
  tabId: string;
  evaluate(
    ctx: PluginProjectTabAvailabilityContext
  ): ProjectTabAvailabilityContract | Promise<ProjectTabAvailabilityContract>;
}

export interface PluginUi {
  requestInput(
    request: PluginInteractionRequest,
    options?: { signal?: AbortSignal }
  ): Promise<PluginInteractionResult>;
  /**
   * Consume a token the app obtained with `experimental_requestApproval`.
   * Pass the binding rebuilt from your own sources: it resolves true once,
   * for this plugin, within five minutes, when every field matches what the
   * user approved. Anything else, including a host without a desktop signer,
   * resolves false.
   */
  experimental_consumeApproval(request: { token: string; binding: PluginApprovalBinding }): Promise<boolean>;
  registerMentionProvider(registration: PluginMentionProviderRegistration): void;
  registerProjectTabAvailability(registration: PluginProjectTabAvailabilityRegistration): void;
  readonly interactions: PluginInteractions;
}

export interface PluginStatusApi {
  needsConfiguration(message: string): void;
}

export interface ZccPluginApi {
  readonly pluginId: string;
  readonly log: PluginLogger;
  readonly settings: PluginSettings;
  readonly http: PluginHttp;
  readonly rpc: PluginRpc;
  readonly realtime: PluginRealtime;
  readonly storage: PluginStorage;
  readonly background: PluginBackground;
  /** Environment for sessions on non-primary machines. Needs `zcc.extra.remoteEnvironment` in the manifest. */
  readonly remoteEnvironment: PluginRemoteEnvironment;
  readonly cli: PluginCli;
  readonly agents: PluginAgents;
  readonly events: PluginEvents;
  /** Server-owned dispatch checkpoint. Only an explicit human Send-now bypasses a wait. */
  readonly hooks: PluginHooks;
  readonly ui: PluginUi;
  readonly status: PluginStatusApi;
  readonly sdk: PluginSdk;
  readonly host: PluginHostApi;
  /**
   * Experimental plugin-to-plugin SDK registry. `provide` is keyed by this
   * plugin's id; `use(id)` returns a live proxy that throws
   * `service_unavailable` until that plugin is running and has provided.
   * `has(id)` is true after that plugin has called `provide`.
   */
  readonly services: PluginServices;
  onDispose(hook: () => void | Promise<void>): void;
}

export type ZccPluginFactory = (zcc: ZccPluginApi) => void | Promise<void>;

export interface PluginHostMethodApi {
  methods: {
    register(name: string, handler: (input: unknown) => unknown | Promise<unknown>): void;
  };
}

export interface PluginHostEntryDefinition {
  readonly __zccPluginHost: true;
  readonly setup: (api: PluginHostMethodApi) => void | Promise<void>;
}

export function experimental_defineHostEntry(
  setup: (api: PluginHostMethodApi) => void | Promise<void>
): PluginHostEntryDefinition {
  return { __zccPluginHost: true, setup };
}

export function isPluginHostEntryDefinition(value: unknown): value is PluginHostEntryDefinition {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as PluginHostEntryDefinition).__zccPluginHost === true &&
    typeof (value as PluginHostEntryDefinition).setup === 'function'
  );
}
