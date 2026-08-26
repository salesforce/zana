/**
 * Server-side plugin API — the `zcc` object handed to a plugin's server factory:
 * `export default function plugin(zcc: ZccPluginApi)`.
 *
 * Types only. The host implements this in `apps/server` PluginService.
 * Plugins are full-trust in the server process after install; they never
 * receive host-daemon tokens or signing keys.
 */

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
      default?: string;
    }
  | { type: 'boolean'; label: string; description?: string; default?: boolean }
  | {
      type: 'select';
      label: string;
      description?: string;
      options: string[];
      default?: string;
    }
  | { type: 'project'; label: string; description?: string; default?: string };

export type PluginSettingValue = string | boolean;

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
  migrate(statements: readonly string[]): void;
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
    handlers: Record<string, (args: unknown) => unknown | Promise<unknown>>
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
}

export interface PluginHttpResponse {
  status?: number;
  json?: unknown;
  body?: string;
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
}

export interface PluginEvents {
  on(name: PluginThreadEventName, handler: (event: PluginThreadEvent) => void | Promise<void>): void;
}

export interface PluginSdkThreads {
  spawn(args: { projectId: string; prompt: string; providerId?: string }): Promise<{ id: string }>;
}

export interface PluginSdk {
  threads: PluginSdkThreads;
}

export interface PluginHostClient {
  call(method: string, input: unknown, options: { hostId: string }): Promise<unknown>;
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
  inputSchema?: unknown;
  execute(input: unknown, ctx: PluginAgentToolContext): unknown | Promise<unknown>;
}

export function enforcePluginCliOutputLimit(result: PluginCliResult): PluginCliExecutionResult {
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const stdoutBytes = Buffer.byteLength(stdout, 'utf8');
  const stderrBytes = Buffer.byteLength(stderr, 'utf8');
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

export interface PluginBackground {
  service(name: string, start: () => void | (() => void) | Promise<void | (() => void)>): void;
  schedule(cron: string, job: () => void | Promise<void>): void;
  schedule(name: string, cron: string, job: () => void | Promise<void>): void;
}

export interface PluginProviderCapabilities {
  supportsServiceTier: boolean;
  supportsNativeUserQuestion?: boolean;
  fork: string;
  supportsManualCompaction?: boolean;
  supportsThreadArchive: boolean;
  supportsThreadRename: boolean;
  supportsWorkflows?: boolean;
  permissionModes: string[];
  reasoningLevels?: string[];
}

export interface PluginProviderDeclaration {
  id: string;
  displayName: string;
  icon?: string;
  capabilities: PluginProviderCapabilities;
  composerActions?: string[];
}

export interface PluginProviderHandle {
  id: string;
  unregister(): void;
}

export interface PluginAgentConfigureContext {
  threadId?: string;
  projectId?: string;
}

export interface PluginAgentConfigureResult {
  tools?: string[];
  skills?: string[];
  instructions?: string;
}

export interface PluginAgents {
  contributeInstructions(text: string): void;
  contributeSkills(rootPaths: string[]): void;
  registerTool(registration: PluginAgentToolRegistration): void;
  experimental_registerProvider(declaration: PluginProviderDeclaration): PluginProviderHandle;
  configure(
    provider: (
      ctx: PluginAgentConfigureContext
    ) => PluginAgentConfigureResult | void | Promise<PluginAgentConfigureResult | void>
  ): void;
}

import type { JsonValue } from '@zana-ai/zcc-domain/thread-runtime';

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

export interface PluginMentionProviderRegistration {
  id: string;
  trigger?: string;
  search(query: string): PluginMentionSuggestion[] | Promise<PluginMentionSuggestion[]>;
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
