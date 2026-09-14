/**
 * Public plugin SDK types vendored for authors who cannot resolve unpublished
 * workspace packages. `zcc plugin types` copies a host-stamped variant of this
 * contract into a plugin's `types/` dir.
 */

declare module '@zana-ai/zcc-plugin-sdk' {
  export const PLUGIN_SDK_VERSION: string;
  export const PLUGIN_SDK_API_MAJOR: number;
  export function definePluginApp(
    setup: (app: { slots: Record<string, (registration: Record<string, unknown>) => void> }) => void
  ): unknown;
  export function callPluginRpc(pluginId: string, method: string, args?: unknown): Promise<unknown>;
}

declare module '@zana-ai/zcc-plugin-sdk/server' {
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
        }) => { status?: number; json?: unknown; body?: string; headers?: Record<string, string> } | Promise<{
          status?: number;
          json?: unknown;
          body?: string;
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
      experimental_registerProvider(declaration: {
        id: string;
        displayName: string;
        icon?: string;
        visibility?: 'always' | 'installed';
        capabilities: Record<string, unknown>;
        composerActions?: string[];
        deriveProviderOptions?: (context: {
          threadId: string;
          projectId: string;
          model?: string;
          permissionMode: string;
          promptMode?: 'plan';
          settings: Record<string, string | boolean | undefined>;
        }) => Record<string, unknown> | void;
      }): { id: string; unregister(): void };
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
      threads: {
        spawn(args: {
          projectId: string;
          prompt: string;
          providerId?: string;
          parentThreadId?: string;
          title?: string;
          model?: string;
          reasoningLevel?: string;
          permissionMode?: string;
          visibility?: 'visible' | 'hidden';
          environment?: { kind: 'reuse'; environmentId: string };
        }): Promise<{ id: string }>;
        get(args: { threadId: string }): Promise<{
          id: string;
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
        get(args: { environmentId: string }): Promise<{
          id: string;
          projectId: string;
          hostId: string;
          path: string | null;
        }>;
      };
      files: {
        read(args: { hostId: string; path: string; rootPath: string }): Promise<{
          content: string;
          contentEncoding: 'utf8' | 'base64';
          sizeBytes: number;
        }>;
      };
      providers: {
        list(args?: { environmentId?: string }): Promise<Array<{
          id: string;
          available: boolean;
          capabilities?: { permissionModes?: string[] };
        }>>;
        models(args: { providerId: string; environmentId?: string }): Promise<{
          models: Array<{ id: string; model: string; supportedReasoningEfforts: Array<{ reasoningEffort: string }> }>;
          selectedOnlyModels: Array<{ id: string; model: string; supportedReasoningEfforts: Array<{ reasoningEffort: string }> }>;
          modelLoadError: { providerId: string; code: string } | null;
        }>;
      };
      inbox: {
        push(args: { projectId: string; comments: string }): Promise<{ id: string }>;
      };
      projects: {
        list(): Promise<Array<{ id: string; name: string; path?: string }>>;
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
  export function createFakePluginHost(options?: { pluginId?: string }): {
    zcc: import('@zana-ai/zcc-plugin-sdk/server').ZccPluginApi;
    harness: {
      callRpc(name: string, args?: unknown): Promise<unknown>;
      runCli(argv: string[]): Promise<{
        exitCode: number;
        stdout: string;
        stderr: string;
      }>;
      setSettings(values: Record<string, string | boolean | undefined>): void;
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
