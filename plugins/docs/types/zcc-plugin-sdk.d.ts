/**
 * Public plugin SDK types vendored for authors who cannot resolve unpublished
 * workspace packages. `zcc plugin types` copies a host-stamped variant of this
 * contract into a plugin's `types/` dir.
 */

declare module '@zana-ai/zcc-plugin-sdk' {
  export type { ZccPluginApi, PluginSettingValue, PluginProviderDeclaration, PluginProviderHandle, PluginProviderCapabilities, PluginProviderReasoningLevel, PluginProviderStrings } from '@zana-ai/zcc-plugin-sdk/server';

  export type { PluginSdk, PluginSdkInbox, PluginSdkInboxEntry, PluginSdkInboxSearchArgs, PluginSdkInboxSearchResult, PluginSdkInboxReport, PluginSdkAssistant } from '@zana-ai/zcc-plugin-sdk/server';
  export type { PluginAgentsViewProps, PluginFleetMember, PluginFleetSchedule, PluginFleetExecution } from '@zana-ai/zcc-plugin-sdk/app';

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
    };
    readonly rpc: { method(name: string, handler: (args: unknown) => unknown | Promise<unknown>): void };
    readonly realtime: { publish(event: string, payload: unknown): void };
    readonly background: {
      service(name: string, start: () => void | (() => void) | Promise<void | (() => void)>): void;
      schedule(cron: string, job: () => void | Promise<void>): void;
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
      registerTool(registration: {
        name: string;
        description: string;
        parameters?: unknown;
        inputSchema?: unknown;
        instructions?: string;
        execute(input: unknown, ctx: { threadId: string; projectId: string; signal: AbortSignal }): unknown | Promise<unknown>;
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
          threadId?: string;
          projectId?: string;
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
      on(
        name:
          | 'thread.created'
          | 'thread.active'
          | 'thread.idle'
          | 'thread.failed'
          | 'thread.archived'
          | 'thread.deleted',
        handler: (event: { name: string; threadId: string; projectId?: string }) => void | Promise<void>
      ): void;
    };
    readonly ui: {
      requestInput(request: { threadId: string; rendererId: string; title: string; payload: unknown }): Promise<unknown>;
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
    readonly status: { needsConfiguration(message: string): void };
    readonly sdk: {
      system: { defaultHost(): Promise<{ id: string } | null> };
      threads: {
        search(args: { query: string; archived?: boolean; limit?: number }): Promise<Array<NonNullable<Awaited<ReturnType<ZccPluginApi['sdk']['threads']['get']>>>>>;
        spawn(args: {
          projectId: string;
          prompt: string;
          providerId?: string;
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
      projects: {
        list(): Promise<Array<{ id: string; name: string; path?: string; icon?: import('@zana-ai/zcc-plugin-sdk').ProjectIcon }>>;
        setIcon(args: { projectId: string; icon: import('@zana-ai/zcc-plugin-sdk').ProjectIcon }): Promise<void>;
      };
    };
    readonly host: {
      experimental_call(method: string, input?: unknown): Promise<unknown>;
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

  export function definePluginApp(
    setup: (app: { slots: Record<string, (registration: Record<string, unknown>) => void> }) => void
  ): unknown;
  export function isPluginAppDefinition(value: unknown): boolean;
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
    settingsSections: Array<{ id: string; title?: string }>;
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
  }>;
  export function renderSlot(
    registration: { component: unknown },
    props: object,
    options?: {
      rpc?: Record<string, (input: unknown) => unknown | Promise<unknown>>;
    }
  ): {
    findByText: (text: string | RegExp) => Promise<unknown>;
    inspection: {
      rpcCalls: Array<{ method: string; input: unknown }>;
      navigateCalls: Array<{ method: string }>;
    };
    lifecycle: { unmount(): void };
  };
}
