/**
 * Public plugin SDK types vendored for authors who cannot resolve unpublished
 * workspace packages. `zcc plugin types` copies a host-stamped variant of this
 * contract into a plugin's `types/` dir.
 */

declare module '@zana-ai/zcc-plugin-sdk' {
  export type { ZccPluginApi, PluginSettingValue, PluginProviderDeclaration, PluginProviderHandle, PluginProviderCapabilities, PluginProviderReasoningLevel, PluginProviderStrings } from '@zana-ai/zcc-plugin-sdk/server';

  export type { PluginSdk, PluginSdkInbox, PluginSdkInboxEntry, PluginSdkInboxSearchArgs, PluginSdkInboxSearchResult, PluginSdkInboxReport, PluginSdkAssistant } from '@zana-ai/zcc-plugin-sdk/server';
  export type { PluginNotificationSoundProviderRegistration, PluginAgentsViewProps, PluginFleetMember, PluginFleetSchedule, PluginFleetExecution } from '@zana-ai/zcc-plugin-sdk/app';

/** A JSON-safe path segment reported by a Standard Schema validation issue. */
export type PluginRpcIssuePathSegment = string | number;

/** Validator-neutral validation detail carried by an RPC error envelope. */
export interface PluginRpcValidationIssue {
  message: string;
  path?: PluginRpcIssuePathSegment[];
}

/** Stable wire error categories for plugin RPC. */
export type PluginRpcErrorCode =
  | "invalid_json"
  | "invalid_input"
  | "handler_error"
  | "invalid_output"
  | "non_json_result"
  | "unknown_method";

/** Structured RPC failure returned as `{ ok: false, error }`. */
export interface PluginRpcError {
  code: PluginRpcErrorCode;
  message: string;
  issues?: PluginRpcValidationIssue[];
}

/**
 * The validator-neutral subset of Standard Schema v1 used by plugin contracts.
 * Zod 4 schemas implement this interface directly; other validators can do
 * the same without becoming part of ZCC's public protocol.
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown,
    ) =>
      | StandardSchemaV1Result<Output>
      | Promise<StandardSchemaV1Result<Output>>;
    readonly types?: {
      readonly input: Input;
      readonly output: Output;
    };
  };
}

export type StandardSchemaV1Result<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: readonly StandardSchemaV1Issue[] };

export interface StandardSchemaV1Issue {
  readonly message: string;
  readonly path?:
    | PropertyKey
    | readonly (PropertyKey | { readonly key: PropertyKey })[];
}

export type StandardSchemaV1InferInput<Schema extends StandardSchemaV1> =
  NonNullable<Schema["~standard"]["types"]>["input"];

export type StandardSchemaV1InferOutput<Schema extends StandardSchemaV1> =
  NonNullable<Schema["~standard"]["types"]>["output"];

export interface PluginRpcMethodContract<
  InputSchema extends StandardSchemaV1 = StandardSchemaV1,
  OutputSchema extends StandardSchemaV1 = StandardSchemaV1,
> {
  readonly input: InputSchema;
  readonly output: OutputSchema;
}

export type PluginRpcContract = Readonly<
  Record<string, PluginRpcMethodContract>
>;

/** Define a shared RPC contract while preserving exact method/schema types. */
export function defineRpcContract<const Contract extends PluginRpcContract>(
  contract: Contract,
): Contract;


  export const PROJECT_ICONS: readonly ['Circle', 'Cloud', 'Folder', 'Code', 'Database', 'Globe', 'Package', 'Rocket', 'Briefcase', 'Terminal', 'Layers', 'Wrench'];
  export type ProjectIcon = (typeof PROJECT_ICONS)[number];
  export const PLUGIN_SDK_VERSION: string;
  export const PLUGIN_SDK_API_MAJOR: number;
  export function derivePluginId(packageName: string): string;
  export function definePluginApp(
    setup: (app: { slots: Record<string, (registration: Record<string, unknown>) => void> }) => void
  ): unknown;
  export function callPluginRpc(pluginId: string, method: string, args?: unknown): Promise<unknown>;
}

declare module '@zana-ai/zcc-plugin-sdk/server' {

  import type { StandardSchemaV1 } from '@zana-ai/zcc-plugin-sdk';
  type ProviderFork = 'none' | 'tip' | 'checkpoint';
  type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
  export type PluginSettingValue = string | number | boolean;
  export type PluginProviderNativeRootEntry = string | { path: string; recursive?: boolean; ancestors?: boolean; namePrefix?: string; skipIfManifest?: string };
  export interface PluginProviderNativeRoots { readonly user?: readonly PluginProviderNativeRootEntry[]; readonly project?: readonly PluginProviderNativeRootEntry[]; }
export type PluginProviderReasoningLevel =
  | "none"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "ultracode"
  | "max"
  | "ultra";
export interface PluginProviderStrings {
  /** How to sign in on the host ("Run `claude` on the machine to sign in."). */
  signInHint: string;
  /** Shown when a session's credentials expired. */
  expiredHint: string;
  /** Where to install the agent. */
  installUrl: string;
  /** Brand prefix stripped from model display names ("Claude "). */
  brandPrefix?: string;
  /** Plan-mode banner copy for providers that declare the `plan` action. */
  planModeCopy?: string;
  /** Per-theme tint for the provider icon. */
  iconTint?: { light: string; dark: string };
}
export interface PluginProviderOptionDescriptor {
  id: string;
  label: string;
  description?: string;
}
export interface PluginProviderExtensionKindDeclaration {
  item?: StandardSchemaV1;
  state?: StandardSchemaV1;
}
export type PluginProviderModelCatalogScope = "host" | "workspace";
export interface PluginProviderFallbackModel {
  id: string;
  /** Picker display name ("Opus 5 (1M)"). */
  displayName: string;
  description: string;
  /** Reasoning levels this model supports, lowest to highest. Non-empty. */
  supportedReasoningEfforts: readonly {
    reasoningEffort: PluginProviderReasoningLevel;
    description: string;
  }[];
  /** Must be one of `supportedReasoningEfforts`. */
  defaultReasoningEffort: PluginProviderReasoningLevel;
  /** Exactly one entry in the list is the default. */
  isDefault: boolean;
}
export interface PluginProviderMaintenance {
  /** `provider/health`: host-local readiness, never a network health check. */
  health?: boolean;
  /** `provider/usage`: subscription usage windows. False means usage settings
   * omit the provider. A shared bridge that declares true may still report
   * usage unavailable for one provider id or return no windows. */
  usage?: boolean;
  /** `provider/installation/status` and `provider/installation/run`:
   * host-local installation management. */
  installation?: boolean;
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

export type PluginSdk = ZccPluginApi['sdk'];
export type PluginSdkInbox = PluginSdk['inbox'];

  export { PROJECT_ICONS, type ProjectIcon } from '@zana-ai/zcc-plugin-sdk';
  export const PLUGIN_CLI_OUTPUT_MAX_BYTES: number;
  export function enforcePluginCliOutputLimit(result: {
    exitCode: number;
    stdout?: string;
    stderr?: string;
  }): {
    exitCode: number;
    stdout: string;
    stderr: string;
    error?: { code: 'plugin_cli_output_too_large'; message: string; maxBytes: number };
  };

  export interface PluginSettingsSnapshot {
    descriptors: Record<string, {
      type: string;
      label: string;
      default?: string | number | boolean;
      min?: number;
      max?: number;
    }>;
    values: Record<string, string | number | boolean | undefined>;
  }

  export interface PluginDatabase {
    runScript(sql: string): void;
    prepare(sql: string): {
      all(...params: unknown[]): unknown[];
      get(...params: unknown[]): unknown;
      run(...params: unknown[]): { changes: number };
    };
    /** Append-only. Already-applied statements are skipped on later plugin loads. */
    migrate(statements: readonly string[]): void;
    transaction<T>(fn: () => T): T;
  }

  export interface PluginDatabaseBackupOptions {
    name: string;
    maxBytes?: number;
    signal?: AbortSignal;
  }

  export interface PluginDatabaseBackup {
    backupId: string;
    name: string;
    path: string;
    bytes: number;
    sha256: string;
    createdAt: number;
  }

  export type PluginThreadEventName =
    | 'thread.created'
    | 'thread.active'
    | 'thread.idle'
    | 'thread.failed'
    | 'thread.archived'
    | 'thread.deleted';

  /** Bump when a breaking shape change lands on {@link PluginThreadEvent}; additive fields do not require a bump. */
  export const PLUGIN_THREAD_EVENT_SCHEMA_VERSION: number;

  export interface PluginThreadEvent {
    /** Host-generated event id. Do not derive identity from event content. */
    id: string;
    schemaVersion: number;
    /** Host-assigned, process-local ordering sequence. */
    sequence: number;
    /** Host clock timestamp in epoch milliseconds. */
    timestamp: number;
    name: PluginThreadEventName;
    /** The thread record, or for a PTY session with no thread binding, the session id (see `surface`). */
    threadId: string;
    projectId?: string;
    /** Which execution surface produced the event. Absent on older hosts and on some Modern events. */
    surface?: 'modern' | 'pty';
    /** The PTY session id; present when `surface` is `pty`. Modern events carry no `sessionId`. */
    sessionId?: string;
    thread?: {
      id: string;
      title?: string | null;
      projectId: string;
      hostId: string;
      environmentId: string | null;
      providerId: string;
      status: string;
      [key: string]: unknown;
    };
    lastAssistantText?: string | null;
    error?: string | null;
    providerId?: string;
    model?: string;
    reasoningLevel?: string;
    executionState?: string;
    hadAttachments?: boolean;
  }

  /** Where a dispatch lands: a Modern thread or a PTY Electron main owns. */
  export type DispatchSurface = 'pty' | 'modern';
  /** Which input path produced the dispatch. */
  export type DispatchEntry = 'initial' | 'reply' | 'fork' | 'squad-member-start' | 'job-team-dispatch';
  /** Who produced the text: a person, another agent, or Zana itself. */
  export type DispatchOrigin = 'user' | 'agent' | 'system';

  /**
   * Host-owned identity for one dispatch. Prompt content is absent unless the
   * plugin declares `zcc.promptAccess: true`. A PTY
   * dispatch carries no `threadId` (an unbound PTY is not a thread), and an
   * initial dispatch may name neither before the target exists.
   */
  export interface PluginDispatchAdmissionRequest {
    dispatchId: string;
    threadId?: string;
    sessionId?: string;
    projectId: string;
    generation: number;
    surface: DispatchSurface;
    entry: DispatchEntry;
    origin: DispatchOrigin;
    /** Only with `zcc.promptAccess: true`, and only where the dispatch carries text (not a fork). */
    prompt?: DispatchAdmissionPrompt;
  }

  /** Redacted, capped prompt text of a dispatch. Attachment content is never provided. */
  export interface DispatchAdmissionPrompt {
    /** Secret-shaped spans replaced with `[REDACTED]`, then cut to 32 KiB of UTF-8. */
    text: string;
    truncated: boolean;
    attachmentCount: number;
  }

  /** Terminal state of one native tool invocation. */
  export type ToolSettledState = 'succeeded' | 'failed' | 'cancelled';

  /**
   * Best-effort, observational completion of a native tool call, correlated to
   * the policy request by `invocationId`. Subscribing with
   * `events.on('tool.settled', ...)` opts in to metadata-only events;
   * `outputPreview` (secret-shaped spans redacted, capped at 4 KiB of UTF-8) is
   * present only when the manifest declares `zcc.toolResults: 'preview'`.
   */
  export interface ToolSettledEvent {
    invocationId: string;
    /** PTY session id; present on the PTY surface. */
    sessionId?: string;
    /** Thread id; present on the Modern surface. */
    threadId?: string;
    projectId: string;
    providerId: string;
    toolName: string;
    state: ToolSettledState;
    durationMs: number;
    exitCode?: number;
    outputBytes?: number;
    outputPreview?: string;
  }

  export type DispatchAdmissionDecision =
    | { action: 'proceed' }
    | { action: 'wait'; reason: string; overrideable: boolean; pluginId?: string }
    | { action: 'reject'; message: string };

  /** Host-owned native-tool invocation identity exposed to policy handlers. Input is redacted before it reaches a plugin. */
  export interface PluginToolPolicyRequest {
    invocationId: string;
    /**
     * The thread the call belongs to. For `surface: 'pty'` with no thread binding this
     * is the PTY session id, which is not a thread record: `getThread` finds nothing for it.
     */
    threadId: string;
    /** The terminal session id for a `'pty'` call; absent on `'modern'`. */
    sessionId?: string;
    surface?: 'pty' | 'modern';
    projectId: string;
    providerId: string;
    toolName: string;
    input: Record<string, unknown>;
  }

  /**
   * `allow` means "no plugin objects", never approval. `deny` blocks the call
   * before it runs (reason capped at 1024 characters). `ask` holds the call while
   * the host shows `prompt` to the user and a human decides; only an explicit human
   * allow continues. A deny, cancel, timeout, session end, missing UI or any answer
   * that is not from a human blocks the call; the plugin cannot answer its own ask.
   * `timeoutMs` is clamped to 10000-120000 ms and defaults to 60000 ms; `prompt` is
   * plain text capped at 2000 characters.
   */
  export type PluginToolPolicyDecision =
    | { action: 'allow' }
    | { action: 'deny'; reason: string }
    | { action: 'ask'; prompt: string; timeoutMs?: number };

  export interface PluginHooks {
    /** One message-dispatch admission handler per plugin. */
    on(handler: (request: PluginDispatchAdmissionRequest) => DispatchAdmissionDecision | Promise<DispatchAdmissionDecision>): void;
    /** Needs `zcc.toolPolicy: true` in the manifest; register during activation. Single handler per plugin. */
    onToolPolicy(handler: (request: PluginToolPolicyRequest) => PluginToolPolicyDecision | Promise<PluginToolPolicyDecision>): void;
  }

  export type PluginInteractionActor = 'human' | 'cli' | 'agent' | 'unknown';
  export type PluginInteractionCancelReason =
    | 'user' | 'request-aborted' | 'thread-stopped' | 'thread-deleted' | 'plugin-disposed' | 'server-restarted' | 'timeout';
  export type PluginInteractionResult =
    | { outcome: 'submitted'; value: unknown; actor: PluginInteractionActor }
    | { outcome: 'cancelled'; reason: PluginInteractionCancelReason };
  /**
   * `threadId` may be a PTY session id for a session shown in the Agents monitor
   * (see the `interactions` capability). Headless sessions cannot present it.
   */
  export interface PluginInteractionRequest {
    threadId: string;
    rendererId: string;
    title: string;
    payload: unknown;
    timeoutMs?: number;
    /**
     * Default false. `true` requires a single-use response proof from a human in
     * the Zana window or on a native sheet. `'native-sheet'` requires a sheet
     * drawn by the desktop main process itself.
     */
    requireHuman?: boolean | 'native-sheet';
  }

  export interface PluginApprovalBinding {
    threadId?: string;
    invocationId?: string;
    action: string;
    target: string;
    targetLabel: string;
    subject: string;
    revision?: string;
    confirmText?: string;
  }
  export interface PluginApprovalRequest {
    binding: PluginApprovalBinding;
    title: string;
    summary?: string;
    details?: string[];
    confirmLabel?: string;
    tone?: 'default' | 'danger';
  }
  export interface PluginToolApprovalRequest extends PluginApprovalRequest {
    threadId?: string;
    invocationId?: string;
    detail?: string;
    timeoutMs?: number;
  }
  export type PluginApprovalResult =
    | { approved: true; token: string; expiresAt: number }
    | { approved: false; reason: 'cancelled' | 'denied' | 'timeout' | 'unavailable' | 'busy' | 'invalid' };

  export interface PluginInteractionContract {
    id: string;
    pluginId: string;
    projectId: string;
    correlationId: string;
    kind: string;
    payload: unknown;
    status: string;
    generation: number;
    createdAt: number;
    updatedAt: number;
    acknowledgedAt: number | null;
    terminalAt: number | null;
    expiresAt: number | null;
  }
  export interface PluginInteractions {
    get(interactionId: string): Promise<PluginInteractionContract | null>;
    upsert(input: { projectId: string; correlationId: string; kind: string; payload: unknown }): Promise<PluginInteractionContract>;
    acknowledge(request: { interactionId: string; generation: number }): Promise<PluginInteractionContract>;
    cancel(request: { interactionId: string; generation: number }): Promise<PluginInteractionContract>;
  }

  /** Live descriptor from main's registered wiring; an unwired surface reports `available: false` with a reason. */
  export interface PluginCapabilityDescriptor { id: string; available: boolean; reason?: string }
  export interface PluginCapabilityIntrospection {
    forThread(args: { threadId: string }): Promise<{ capabilities: readonly PluginCapabilityDescriptor[] }>;
    forExecution(args: { executionId: string }): Promise<{ capabilities: readonly PluginCapabilityDescriptor[] }>;
  }

  /** Loosely typed persona/team contribution; the host validates and namespaces the id as `ext:<pluginId>:<slug>`. */
  export type PluginPersonaInput = { id?: string; [key: string]: unknown };
  export type PluginTeamInput = { id?: string; [key: string]: unknown };

  export interface ZccPluginApi {
    readonly pluginId: string;
    readonly log: { debug(m: string): void; info(m: string): void; warn(m: string): void; error(m: string): void };
    readonly settings: {
      define(descriptors: Record<string, {
        type: string;
        label: string;
        description?: string;
        secret?: true;
        multiline?: true;
        options?: string[];
        default?: string | number | boolean;
        min?: number;
        max?: number;
      }>): {
        get(): Promise<Record<string, string | number | boolean | undefined>>;
        onChange(listener: (next: Record<string, string | number | boolean | undefined>) => void): void;
      };
    };
    readonly http: {
      route(
        method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
        path: string,
        handler: (request: {
          method: string;
          path: string;
          query: Record<string, string>;
          body: unknown;
          rawBody?: Uint8Array;
          headers?: Record<string, string>;
        }) => { status?: number; json?: unknown; body?: string | Uint8Array; headers?: Record<string, string> } | Promise<{
          status?: number;
          json?: unknown;
          body?: string | Uint8Array;
          headers?: Record<string, string>;
        }>
      ): void;
    };
    readonly storage: {
      kv: {
        get<T>(key: string): Promise<T | undefined>;
        set(key: string, value: unknown): Promise<void>;
        delete(key: string): Promise<void>;
        list(prefix?: string): Promise<string[]>;
      };
      database(): PluginDatabase;
      /** Consistent online 0600 copy of this plugin's database under its own data folder. */
      backupDatabase(options: PluginDatabaseBackupOptions): Promise<PluginDatabaseBackup>;
    };
    readonly rpc: { method(name: string, handler: (args: unknown) => unknown | Promise<unknown>): void };
    readonly realtime: { publish(event: string, payload: unknown): void };
    readonly background: {
      service(name: string, start: () => void | (() => void) | Promise<void | (() => void)>): void;
      schedule(cron: string, job: () => void | Promise<void>): void;
    };
    /**
     * Host-tracked child processes. Each child runs in its own process group with output discarded and no shell.
     * The host stops every live child (SIGTERM, a short wait, then SIGKILL of the group) when the plugin is disposed,
     * deactivated, or its worker crashes. At most 8 children per plugin may be live. On Windows there are no process
     * groups, so only the direct child is stopped. A raw `node:child_process` spawn is NOT tracked and is never reaped.
     */
    readonly process: {
      spawn(
        command: string,
        args: string[],
        options?: { cwd?: string; env?: Record<string, string> }
      ): Promise<{ readonly pid: number; readonly exited: Promise<number | null> }>;
    };
    /** Environment for sessions on non-primary machines. Needs `zcc.extra.remoteEnvironment` in the manifest. */
    readonly remoteEnvironment: {
      provide(
        resolve: () =>
          | ReadonlyArray<{ name: string; value: string; group?: string; requires?: readonly string[] }>
          | Promise<ReadonlyArray<{ name: string; value: string; group?: string; requires?: readonly string[] }>>
      ): void;
      refresh(): void;
    };
    readonly cli: {
      register(registration: {
        name: string;
        summary: string;
        commands?: Array<{ name: string; summary: string; usage: string }>;
        run(
          argv: string[],
          ctx: { pluginId: string; argv: string[]; projectId?: string; threadId?: string; cwd?: string }
        ): { exitCode: number; stdout?: string; stderr?: string } | Promise<{
          exitCode: number;
          stdout?: string;
          stderr?: string;
        }>;
      }): void;
    };
    readonly agents: {
      contributeInstructions(text: string | ((ctx: { threadId: string; projectId: string }) => string | null)): void;
      contributeSkills(rootPaths: string[]): void;
      registerPersonas(personas: readonly PluginPersonaInput[]): void;
      registerTeams(teams: readonly PluginTeamInput[]): void;
      registerTool(registration: {
        desktopOnly?: boolean | readonly string[];
        name: string;
        description: string;
        parameters?: unknown;
        inputSchema?: unknown;
        instructions?: string;
        execute(input: unknown, ctx: { desktopPresentation?: boolean; threadId: string; projectId: string; signal: AbortSignal }): unknown | Promise<unknown>;
      }): void;
      experimental_registerProvider(declaration: PluginProviderDeclaration): PluginProviderHandle;
      experimental_registerPtyHarness(declaration: {
        id: string;
        displayName: string;
        icon?: string;
        profiles: Array<{ id: string; label: string }>;
        alwaysEnabled?: boolean;
        enableConfigKey?: string;
      }): { id: string; unregister(): void };
      configure(
        provider: (ctx: {
          desktopPresentation?: boolean;
          /** `'pty'` for a PTY launch (Claude, Codex, OpenCode); absent on Modern threads. */
          surface?: 'pty';
          /** The PTY session id when `surface` is `pty`; then `threadId` equals it and is not a thread record. */
          sessionId?: string;
          threadId?: string;
          projectId?: string;
          pluginMetadata?: Record<string, unknown>;
          origin?: { kind?: 'fork' | null; pluginId?: string | null };
          thread?: {
            id: string;
            projectId: string;
            hostId: string;
            environmentId: string | null;
            providerId: string;
            status: string;
            originPluginId?: string | null;
            visibility?: string;
            title?: string | null;
            parentThreadId?: string | null;
          };
          project?: { id: string; kind?: 'standard' | 'personal'; name?: string; gitRemoteUrl?: string | null };
          environment?: {
            id: string;
            name?: string | null;
            path?: string | null;
            workspaceProvisionType?: 'unmanaged' | 'managed-worktree' | 'personal';
            branchName?: string | null;
          };
          host?: { id: string; name: string };
          provider?: { id: string; model?: string; capabilities?: { supportsNativeUserQuestion?: boolean } };
        }) =>
          | { tools?: Array<string | { name: string; parameters?: unknown }>; skills?: string[]; instructions?: string }
          | void
          | Promise<{ tools?: Array<string | { name: string; parameters?: unknown }>; skills?: string[]; instructions?: string } | void>
      ): void;
    };
    readonly events: {
      /** Observational completion of native tool calls; `outputPreview` only with `zcc.toolResults: 'preview'`. */
      on(name: 'tool.settled', handler: (event: ToolSettledEvent) => void | Promise<void>): void;
      on(name: PluginThreadEventName, handler: (event: PluginThreadEvent) => void | Promise<void>): void;
    };
    /** Server-owned dispatch admission and native tool policy handlers. */
    readonly hooks: PluginHooks;
    readonly ui: {
      /** Await main's human approval sheet during an active registered server tool. Fails closed (`unavailable`) without a desktop. */
      requestToolApproval(request: PluginToolApprovalRequest): Promise<PluginApprovalResult>;
      requestApproval(request: PluginToolApprovalRequest): Promise<PluginApprovalResult>;
      /** @deprecated Use requestToolApproval. */
      experimental_requestApproval(request: PluginToolApprovalRequest): Promise<PluginApprovalResult>;
      /** Consume a token once, for this plugin, within five minutes, when the rebuilt binding matches what the user approved. */
      consumeApproval(request: { token: string; binding: PluginApprovalBinding }): Promise<boolean>;
      /** @deprecated Use consumeApproval. */
      experimental_consumeApproval(request: { token: string; binding: PluginApprovalBinding }): Promise<boolean>;
      requestInput(request: PluginInteractionRequest, options?: { signal?: AbortSignal }): Promise<PluginInteractionResult>;
      registerProjectTabAvailability(registration: {
        tabId: string;
        evaluate(ctx: { projectId: string }): { available: boolean; reason?: string } | Promise<{ available: boolean; reason?: string }>;
      }): void;
      readonly interactions: PluginInteractions;
      registerMentionProvider(registration: {
        id: string;
        label: string;
        trigger?: string;
        triggers?: Array<'@' | '#' | '$' | '!' | '~'>;
        search(ctx: { query: string; trigger?: string; projectId?: string; threadId?: string } | string):
          | Array<{ id: string; label: string; insertText?: string }>
          | Promise<Array<{ id: string; label: string; insertText?: string }>>;
        resolve(itemId: string): { context: string } | Promise<{ context: string }>;
      }): void;
    };
    readonly status: { needsConfiguration(message: string): void; configured(): void };
    readonly sdk: {
      system: { defaultHost(): Promise<{ id: string } | null> };
      threads: {
        search(args: { query: string; archived?: boolean; limit?: number }): Promise<Array<NonNullable<Awaited<ReturnType<ZccPluginApi['sdk']['threads']['get']>>>>>;
        spawn(args: {
          projectId: string;
          prompt: string;
          /** Exact thread provider id; wins over `harness`. With neither, the host's first provider is used (legacy). */
          providerId?: string;
          /**
           * `'project-default'`: the project's effective AI harness and its AI-harness overrides (Settings → AI Harness).
           * Rejects when none is usable or an override cannot apply to a thread.
           */
          harness?: 'project-default';
          parentThreadId?: string;
          title?: string;
          model?: string;
          reasoningLevel?: string;
          serviceTier?: 'default' | 'fast';
          hostId?: string;
          permissionMode?: string;
          visibility?: 'visible' | 'hidden';
          environment?: { kind: 'reuse'; environmentId: string } | { kind: 'unmanaged' | 'personal' } | { kind: 'worktree'; branchSlug?: string; baseBranch?: string };
        }): Promise<{ id: string }>;
        get(args: { threadId: string }): Promise<{
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
          originPluginId?: string | null;
          visibility?: string;
        } | null>;
        events: {
          list(args: {
            threadId: string;
            limit?: number;
            types?: readonly string[];
            order?: 'asc' | 'desc';
          }): Promise<Array<{ seq: number; type: string; payload: unknown }>>;
        };
        send(args: {
          threadId: string;
          prompt: string;
          visibility?: 'visible' | 'agent-only';
          mode?: string;
        }): Promise<{ id: string }>;
        stop(args: { threadId: string }): Promise<{ ok: true }>;
        output(args: { threadId: string }): Promise<{ output: string }>;
        defaultExecutionOptions(args: { threadId: string }): Promise<{
          model: string;
          reasoningLevel: string;
          permissionMode: string;
        }>;
        archive(args: { threadId: string }): Promise<{ id: string }>;
        fork(args: { threadId: string; visibility?: 'visible' | 'hidden' }): Promise<{ id: string }>;
        unarchive(args: { threadId: string }): Promise<{ id: string }>;
      };
      environments: {
        pullRequest(args: { environmentId: string }): Promise<{
          pullRequest: { number: number; title: string; url: string; state: string; isDraft: boolean; updatedAt: string | null; baseRefName: string; headRefName: string; reviewDecision: string | null; mergeStateStatus: string | null; mergeable: string | null } | null;
          unavailableReason?: string;
        }>;
        get(args: { environmentId: string }): Promise<{
          id: string;
          projectId: string;
          hostId: string;
          path: string | null;
        }>;
      };
      files: {
        read(args: { hostId?: string; path: string; rootPath?: string }): Promise<{
          content: string;
          contentEncoding: 'utf8' | 'base64';
          sizeBytes: number;
        }>;
        write(args: { hostId?: string; path: string; rootPath?: string; content: string; contentEncoding?: 'utf8' | 'base64'; createParents?: boolean }): Promise<void>;
      };
      providers: {
        list(args?: { environmentId?: string }): Promise<Array<{
          id: string;
          available: boolean;
          displayName?: string;
          logoUrl?: string | null;
          icon?: string | null;
          strings?: { iconTint?: string | null };
          capabilities?: { permissionModes?: string[]; supportsServiceTier?: boolean };
        }>>;
        models(args: { providerId: string; environmentId?: string; hostId?: string }): Promise<{
          models: Array<{ id: string; model: string; supportedReasoningEfforts: Array<{ reasoningEffort: string }> }>;
          selectedOnlyModels: Array<{ id: string; model: string; supportedReasoningEfforts: Array<{ reasoningEffort: string }> }>;
          modelLoadError: { providerId: string; code: string; detail?: string | null } | null;
        }>;
      };
      assistant: PluginSdkAssistant;
      inbox: {
        search(args: PluginSdkInboxSearchArgs): Promise<PluginSdkInboxSearchResult>;
        read(args: { projectIds: string[]; entryId: string; documentIndex?: number }): Promise<PluginSdkInboxReport>;
        push(args: { projectId: string; comments: string }): Promise<{ id: string }>;
      };
      capabilities: PluginCapabilityIntrospection;
      projects: {
        list(): Promise<Array<{ id: string; name: string; path?: string; icon?: import('@zana-ai/zcc-plugin-sdk').ProjectIcon; color?: '#2f81f7' | '#3fb950' | '#d4a017' | '#bc8cff' | '#39c5cf' | '#f85149' | '#ff7b72' | '#8b949e' }>>;
        setIcon(args: { projectId: string; icon: import('@zana-ai/zcc-plugin-sdk').ProjectIcon }): Promise<void>;
      };
    };
    readonly host: {
      experimental_call(method: string, input?: unknown): Promise<unknown>;
      /**
       * Project-bound host call. Main resolves `projectId` to a machine and root: the machine is
       * `hostId ?? the project's machine ?? the primary machine`. A project registered only on another
       * machine runs there, confined on that machine's own project catalogue.
       */
      projectCall(request: { projectId: string; hostId?: string; method: string; input?: unknown }): Promise<{ result: unknown }>;
    };
    readonly services: {
      provide(implementation: object): void;
      use<T extends object>(pluginId: string): T;
      has(pluginId: string): boolean;
    };
    onDispose(hook: () => void | Promise<void>): void;
  }
}

declare module '@zana-ai/zcc-plugin-sdk/app' {
  export function useRpc(): { call<T = unknown>(method: string, input?: unknown): Promise<T> };
  export function useRealtime(channel: string, handler: (payload: unknown) => void): void;
  export interface PluginAgentActivity {
    id: string;
    kind: 'thread' | 'cli';
    state: 'working' | 'idle' | 'needs-you' | 'unknown';
  }
  export interface PluginAgentActivitySnapshot {
    ready: boolean;
    agents: readonly PluginAgentActivity[];
  }
  export interface PluginContentScriptContext {
    readonly pluginId: string;
    readonly generation: number;
    readonly signal: AbortSignal;
    /** Main-shell initial snapshot and changes; scoped windows remain unready. */
    readonly experimental_observeAgents?: (listener: (snapshot: PluginAgentActivitySnapshot) => void) => () => void;
    readonly experimental_onSignal?: (channel: string, listener: (payload: unknown) => void) => () => void;
  }
  export interface ContextReference {
  version: 1;
  comment?: string;
  label: string;
  text: string;
  source?:
    | { kind: 'thread'; threadId: string; messageId: string; sourceSeqEnd: number }
    | { kind: 'file'; path: string; startLine?: number; endLine?: number; projectId?: string; hostId?: string }
    | { kind: 'plugin'; pluginId: string; resourceId: string; path?: string; revision?: string; heading?: string };
}

  export interface PluginBrowserPage {
    evaluate(expression: string, options?: { world?: 'main' | 'isolated' }): Promise<unknown>;
    onMessage(listener: (data: unknown) => void): () => void;
  }
  export interface PluginBrowserComposer {
    insert(reference: ContextReference): boolean;
    update(resourceId: string, reference: ContextReference | null): boolean;
    onSubmitted(listener: () => void): () => void;
    focus(): void;
  }
  export interface PluginBrowserToolbarActionProps {
    pluginId: string; threadId: string; tabId: string; url: string;
    page: PluginBrowserPage | null; composer: PluginBrowserComposer;
  }
  export const CONTEXT_REFERENCE_MIME: 'application/x-zcc-context-reference';
  export const MAX_CONTEXT_REFERENCE_TEXT: 100000;
  export const MAX_CONTEXT_REFERENCES: 24;
  export const MAX_CONTEXT_REFERENCES_TEXT: 400000;
  export function parseContextReference(value: unknown): ContextReference | null;
  export function parseContextReferences(value: unknown): ContextReference[] | null;
  export function contextReferenceLocation(reference: ContextReference): string;
  export function contextReferencePrompt(reference: ContextReference): string;
  export function contextReferenceFromClipboard(data: Pick<DataTransfer, 'getData'> | null): ContextReference | null;
  export function writeContextReference(event: Pick<ClipboardEvent, 'clipboardData' | 'preventDefault'>, reference: ContextReference): boolean;
  export function copyContextSelection(event: Pick<ClipboardEvent, 'clipboardData' | 'preventDefault'>, root: HTMLElement, metadata: Omit<ContextReference, 'text'>): boolean;

  export function contextReferenceFromEditorSelection(selection: { version: 1; path: string; text: string; startLine?: number; endLine?: number }): ContextReference;
  export interface PluginComposerApi {
    readonly text: string;
    setText(next: string): void;
    updateText(updater: (current: string) => string): void;
    clear(): void;
    focus(): void;
    insertContextReference?(reference: ContextReference): boolean;
  }
  export type ZccPanelAgentOptions =
    | { threadId: string; title?: string }
    | { draft: { prompt: string; projectId?: string; view?: string; references?: readonly ContextReference[]; selection?: { version: 1; path: string; text: string; startLine?: number; endLine?: number } }; title?: string };
  /** Lightweight identity beside an assistant; IDs and paths grant no access. */
  export interface ZccPageContext {
    title: string;
    resourceId?: string;
    path?: string;
    view?: string;
    /** Reference for a live server read with page_context_read when needed. */
    mention?: { providerId: string; itemId: string };
  }
  export interface ZccNavigate {
    toThread(threadId: string): void;
    toProject(projectId: string, options?: { tabId?: string; inMainWindow?: boolean }): void;
    toPluginPanel(path: string, options?: { subPath?: string; replace?: boolean }): void;
    toCompose(options?: { initialPrompt?: string; focusPrompt?: boolean }): void;
    supportsContextReferences?: true;
    addThreadContext?(reference: ContextReference): boolean;
    openPanelAgent(options: ZccPanelAgentOptions): boolean;
    /** Update on navigation; clear with null on unmount. Each message retains
     * identity/reference for queueing and retries; the agent fetches live content
     * on demand with page_context_read through the owning plugin. */
    setPageContext?(context: ZccPageContext | null): void;
  }
  export function useComposer(): PluginComposerApi;
  export function useZccNavigate(): ZccNavigate;

  /** Read-only fleet projection shared with the built-in Agents views. */
  export interface PluginFleetMember {
    /** Opaque, kind-qualified key. Pass this to onInspect. */
    key: string;
    kind: 'agent' | 'thread';
    title: string;
    projectId: string;
    status: 'working' | 'needs-you' | 'idle' | 'done' | 'error' | 'unknown';
    /** Done means the process exited, not that its task succeeded. */
    detail: string;
    live: boolean;
    scheduled: boolean;
    /** Display name of the session harness. */
    harness?: string;
    teamId?: string;
  }
  export interface PluginFleetSchedule {
    key: string;
    title: string;
    projectId: string;
    enabled: boolean;
    nextRunAt: string | null;
    running: boolean;
    /** Configured launch harness; a plan is not a live session. */
    harness?: string;
  }
  export interface PluginFleetExecution {
    key: string;
    projectId: string;
    title: string;
    state: string;
    needsAttention: boolean;
  }
  export interface PluginAgentsViewProps {
    projectId: string | null;
    projects: readonly { id: string; name: string; color?: string }[];
    members: readonly PluginFleetMember[];
    schedules: readonly PluginFleetSchedule[];
    executions: readonly PluginFleetExecution[];
    /** Full scoped population, before search. Use for stable spatial layouts; older hosts omit it. */
    population?: {
      members: readonly PluginFleetMember[];
      schedules: readonly PluginFleetSchedule[];
      executions: readonly PluginFleetExecution[];
    };
    includeScheduled: boolean;
    searchQuery: string;
    /** Host resolves only keys in the current scoped population, including search-hidden items. */
    onInspect(key: string): void;
  }

  /** Settings → Notifications contribution; mounted only while selected and enabled. */
  export interface PluginNotificationSoundProviderRegistration {
    id: string;
    title: string;
    description?: string;
    component: import('react').ComponentType<{ pluginId: string }>;
    mount(context: PluginContentScriptContext): void | (() => void | Promise<void>) | Promise<void | (() => void | Promise<void>)>;
  }
  export function definePluginApp(
    setup: (app: {
      slots: Record<string, (registration: Record<string, unknown>) => void> & {
        notificationSoundProvider(registration: PluginNotificationSoundProviderRegistration): void;
      };
      contentScripts: { register(registration: { id: string; mount(context: PluginContentScriptContext): void | (() => void | Promise<void>) | Promise<void | (() => void | Promise<void>)> }): void };
    }) => void
  ): unknown;
  export function isPluginAppDefinition(value: unknown): boolean;
  export type { PluginApprovalBinding, PluginApprovalRequest, PluginApprovalResult } from '@zana-ai/zcc-plugin-sdk/server';
  /** Ask the host to draw an approval sheet for an action started from this plugin's UI. Resolves `unavailable` without a desktop host; fail closed. */
  export function requestApproval(pluginId: string, request: import('@zana-ai/zcc-plugin-sdk/server').PluginApprovalRequest): Promise<import('@zana-ai/zcc-plugin-sdk/server').PluginApprovalResult>;
  /** @deprecated Use requestApproval. */
  export const experimental_requestApproval: typeof requestApproval;
  export function callPluginRpc(pluginId: string, method: string, args?: unknown): Promise<unknown>;
  export function getPluginSettings(pluginId: string): Promise<{
    descriptors: Record<string, { type: string; label: string }>;
    values: Record<string, string | boolean | undefined>;
  }>;
  export function setPluginSettings(
    pluginId: string,
    values: Record<string, string | boolean | undefined>
  ): Promise<void>;
}

declare module '@zana-ai/zcc-plugin-sdk/testing' {
  export function createFakePluginHost(options?: { pluginId?: string; setProjectIcon?: import('@zana-ai/zcc-plugin-sdk/server').ZccPluginApi['sdk']['projects']['setIcon'] }): {
    zcc: import('@zana-ai/zcc-plugin-sdk/server').ZccPluginApi;
    harness: {
      callRpc(name: string, args?: unknown): Promise<unknown>;
      runCli(argv: string[]): Promise<{
        exitCode: number;
        stdout: string;
        stderr: string;
      }>;
      setSettings(values: Record<string, string | boolean | undefined>): void;
      providers: import('@zana-ai/zcc-plugin-sdk/server').PluginProviderDeclaration[];
      settings: Record<string, { type: string; label: string; description?: string; default?: string | number | boolean }>;
      extraInstructions: string[];
      cli: { name: string; run: (...args: never[]) => unknown } | null;
      agentTools: Array<{ name: string }>;
      dispose(): Promise<void>;
    };
  };
}

declare module '@zana-ai/zcc-plugin-sdk/testing/app' {
  export function collectTestPluginApp(
    definition: unknown,
    pluginId?: string,
    generation?: number
  ): {
    pluginId: string;
    generation: number;
    providerIcons: Array<{ pluginId: string; generation: number; providerId: string; icon: unknown }>;
    navPanels: Array<{ id: string; title: string; component: unknown }>;
    browserToolbarActions: Array<{ id: string; title: string; component: unknown }>;
    settingsSections: Array<{ id: string; title?: string }>;
    notificationSoundProviders: Array<import('@zana-ai/zcc-plugin-sdk/app').PluginNotificationSoundProviderRegistration>;
    pendingInteractions: Array<{ id: string }>;
  };
  export function installTestPluginRuntime(options?: {
    rpc?: Record<string, (input: unknown) => unknown | Promise<unknown>>;
  }): {
    rpcCalls: Array<{ method: string; input: unknown }>;
    navigateCalls: Array<{ method: string }>;
    emitRealtime(channel: string, payload?: unknown): void;
  };
  export function loadPluginApp(
    source: unknown | (() => Promise<unknown>),
    pluginId?: string,
    generation?: number
  ): Promise<{
    pluginId: string;
    navPanels: Array<{ id: string; title: string; component: unknown }>;
    browserToolbarActions: Array<{ id: string; title: string; component: unknown }>;
  }>;
  export function renderSlot(
    registration: { component: unknown },
    props: object,
    options?: {
      rpc?: Record<string, (input: unknown) => unknown | Promise<unknown>>;
    }
  ): import('@testing-library/react').RenderResult & {
    findByText: (text: string | RegExp) => Promise<unknown>;
    inspection: {
      rpcCalls: Array<{ method: string; input: unknown }>;
      navigateCalls: Array<{ method: string }>;
    };
    lifecycle: { unmount(): void };
  };
}
