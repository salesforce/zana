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

export interface PluginThreadEvent {
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

export interface PluginEvents {
  on(name: PluginThreadEventName, handler: (event: PluginThreadEvent) => void | Promise<void>): void;
}

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

export interface PluginSdkThreadSpawnArgs {
  projectId: string;
  prompt: string;
  providerId?: string;
  parentThreadId?: string;
  title?: string;
  model?: string;
  reasoningLevel?: string;
  serviceTier?: 'default' | 'fast';
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
  projectId?: string;
  hostId?: string;
}

export interface PluginSdkLibrary {
  list(args?: PluginSdkLibraryListArgs): Promise<PluginSdkLibraryDoc[]>;
  read(
    args: PluginSdkLibraryReadArgs
  ): Promise<{ ok: true; content: string } | { ok: false; message: string }>;
  write(args: PluginSdkLibraryWriteArgs): Promise<{ ok: true } | { ok: false; message: string }>;
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
}

export interface PluginSdkProject {
  id: string;
  name: string;
  path?: string;
}

export interface PluginSdkProjects {
  list(): Promise<PluginSdkProject[]>;
}

export interface PluginSdk {
  system: { defaultHost(): Promise<{ id: string } | null> };
  /** Enrolled machine identity only; no host credentials or connection metadata. */
  hosts: {
    list(args?: { signal?: AbortSignal }): Promise<Array<{ id: string; name: string }>>;
  };
  threads: PluginSdkThreads;
  inbox: PluginSdkInbox;
  projects: PluginSdkProjects;
  environments: PluginSdkEnvironments;
  files: PluginSdkFiles;
  library: PluginSdkLibrary;
  providers: PluginSdkProviders;
  experimental_desktopBrowsers: PluginSdkDesktopBrowsers;
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
  experimental_client(args?: { contract?: unknown }): PluginHostClient;
}

export interface PluginAgentToolContext {
  threadId: string;
  projectId: string;
  signal: AbortSignal;
}

export interface PluginAgentToolRegistration {
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
  experimental_registerProvider(declaration: PluginProviderDeclaration): PluginProviderHandle;
  experimental_registerPtyHarness(declaration: PluginPtyHarnessDeclaration): PluginProviderHandle;
  configure(
    provider: (
      ctx: PluginAgentConfigureContext
    ) => PluginAgentConfigureResult | void | Promise<PluginAgentConfigureResult | void>
  ): void;
}

import type { JsonObject, JsonValue, ProviderFork } from '@zana-ai/zcc-domain/thread-runtime';
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

export interface PluginUi {
  requestInput(
    request: PluginInteractionRequest,
    options?: { signal?: AbortSignal }
  ): Promise<PluginInteractionResult>;
  registerMentionProvider(registration: PluginMentionProviderRegistration): void;
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
  readonly cli: PluginCli;
  readonly agents: PluginAgents;
  readonly events: PluginEvents;
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
