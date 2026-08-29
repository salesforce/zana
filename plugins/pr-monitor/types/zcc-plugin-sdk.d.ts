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
    descriptors: Record<string, { type: string; label: string; default?: string | boolean }>;
    values: Record<string, string | boolean | undefined>;
  }

  export interface PluginDatabase {
    runScript(sql: string): void;
    prepare(sql: string): {
      all(...params: unknown[]): unknown[];
      get(...params: unknown[]): unknown;
      run(...params: unknown[]): { changes: number };
    };
    migrate(statements: readonly string[]): void;
  }

  export interface ZccPluginApi {
    readonly pluginId: string;
    readonly log: { debug(m: string): void; info(m: string): void; warn(m: string): void; error(m: string): void };
    readonly settings: {
      define(descriptors: Record<string, { type: string; label: string; default?: string | boolean }>): {
        get(): Promise<Record<string, string | boolean | undefined>>;
        onChange(listener: (next: Record<string, string | boolean | undefined>) => void): void;
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
          ctx: { pluginId: string; argv: string[] }
        ): { exitCode: number; stdout?: string; stderr?: string } | Promise<{
          exitCode: number;
          stdout?: string;
          stderr?: string;
        }>;
      }): void;
    };
    readonly agents: {
      contributeInstructions(text: string): void;
      contributeSkills(rootPaths: string[]): void;
      registerTool(registration: {
        name: string;
        description: string;
        inputSchema?: unknown;
        execute(input: unknown, ctx: { threadId: string; projectId: string; signal: AbortSignal }): unknown | Promise<unknown>;
      }): void;
      experimental_registerProvider(declaration: {
        id: string;
        displayName: string;
        capabilities: Record<string, unknown>;
      }): { id: string; unregister(): void };
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
        spawn(args: { projectId: string; prompt: string; providerId?: string }): Promise<{ id: string }>;
        get(args: { threadId: string }): Promise<{
          id: string;
          projectId: string;
          hostId: string;
          environmentId: string | null;
          providerId: string;
          status: string;
        } | null>;
        events: {
          list(args: {
            threadId: string;
            limit?: number;
            types?: readonly string[];
            order?: 'asc' | 'desc';
          }): Promise<Array<{ seq: number; type: string; payload: unknown }>>;
        };
        send(args: { threadId: string; prompt: string }): Promise<{ id: string }>;
        archive(args: { threadId: string }): Promise<{ id: string }>;
        fork(args: { threadId: string }): Promise<{ id: string }>;
        unarchive(args: { threadId: string }): Promise<{ id: string }>;
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
    navPanels: Array<{ id: string; title: string }>;
    settingsSections: Array<{ id: string; title?: string }>;
    pendingInteractions: Array<{ id: string }>;
  };
}
