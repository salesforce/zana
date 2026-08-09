/**
 * Testing utilities for `@zana-ai/zcc-extension-sdk` (`@zana-ai/zcc-extension-sdk/testing`).
 *
 * Pure mock helpers for unit-testing extension panels and main modules without
 * spinning up the full host. Never ships in the SDK bundle — dev dependency only.
 */

import type { ModuleHost, HostEvents, ProjectInfo, PersonaInfo, SessionInfo } from './renderer.js';
import type { MainModuleContext, ExecRequest, ExecResult, BrokeredFetchInit, BrokeredFetchResponse } from './main.js';

/**
 * Create a fully-typed fake `ModuleHost` for testing extension renderers.
 * All methods default to sensible no-op/empty returns; storage and cache are
 * backed by real in-memory Maps so get-after-set works. Pass `overrides` to
 * stub specific methods the test exercises.
 *
 * @example
 * ```ts
 * const host = createMockHost({
 *   moduleId: 'test-ext',
 *   listProjects: () => [{ id: 'p1', name: 'Project 1', path: '/path' }]
 * });
 *
 * const Panel = entry.activate({ React, host });
 * render(<Panel host={host} />);
 * ```
 */
/**
 * Relaxed override type for createMockHost - allows concrete return types on call()
 * since test mocks typically return specific values, not generic T.
 */
type MockHostOverrides = Partial<Omit<ModuleHost, 'call'>> & {
  call?: (capability: string, ...args: unknown[]) => Promise<unknown>;
};

export function createMockHost(overrides?: MockHostOverrides): ModuleHost {
  const storageMap = new Map<string, unknown>();
  const cacheMap = new Map<string, unknown>();
  const subscriptions = new Map<string, Set<(payload: any) => void>>();
  // W1-6: collect ctx/host.register disposables so a test can assert they were
  // registered and drain them (simulating unmount/teardown). Exposed off the
  // returned host as a non-enumerable `__disposables` for assertions.
  const disposables: Array<() => void> = [];

  const base: ModuleHost = {
    moduleId: 'mock-module',

    call: (async <T = unknown>(_capability: string, ..._args: unknown[]): Promise<T> => {
      return undefined as T;
    }) as ModuleHost['call'],

    storage: {
      async get<T = unknown>(key: string): Promise<T | undefined> {
        return storageMap.get(key) as T | undefined;
      },
      async set(key: string, value: unknown): Promise<void> {
        storageMap.set(key, value);
      }
    },

    openExternal(_url: string): void {
      // no-op
    },

    async pushInbox(_msg: {
      projectId?: string;
      comments?: string;
      docs?: Array<{ path: string }>;
    }): Promise<{ id: string }> {
      return { id: 'mock-inbox-entry' };
    },

    toast(_message: string, _kind?: 'info' | 'error'): void {
      // no-op
    },

    async relaunchSelf(): Promise<boolean> {
      return false; // Mock doesn't restart
    },

    getActiveProject(): ProjectInfo | null {
      return null;
    },

    getScopedProjectId(): string | null {
      return null;
    },

    listProjects(): ProjectInfo[] {
      return [];
    },

    async ensureQuickAgent(): Promise<ProjectInfo | null> {
      return {
        id: 'quick-agent',
        name: 'Quick Agent',
        path: '~/.zcc-workspace'
      };
    },

    selectProject(_projectId: string | null): void {
      // no-op
    },

    async launchSession(_opts: {
      projectId: string;
      personaId?: string;
      extraArgs?: string[];
      title?: string;
      cwd?: string;
    }): Promise<{ id: string } | null> {
      return { id: 'mock-session' };
    },

    listPersonas(): PersonaInfo[] {
      return [];
    },

    async replyToSession(_sessionId: string, _text: string): Promise<boolean> {
      return true;
    },

    async writeToSession(_sessionId: string, _data: string): Promise<boolean> {
      return true;
    },

    on<E extends keyof HostEvents>(event: E, cb: (payload: HostEvents[E]) => void): () => void {
      let subs = subscriptions.get(event);
      if (!subs) {
        subs = new Set();
        subscriptions.set(event, subs);
      }
      subs.add(cb);

      // Return unsubscribe function
      return () => {
        subs?.delete(cb);
      };
    },

    subscribe(
      _subId: string,
      _onFrame: (frame: unknown) => void,
      _onDone?: (reason: { ok: boolean; error?: string }) => void
    ): () => void {
      // Return unsubscribe function
      return () => {
        // no-op
      };
    },

    cache: {
      get<T = unknown>(key: string): T | undefined {
        return cacheMap.get(key) as T | undefined;
      },
      set(key: string, value: unknown): void {
        cacheMap.set(key, value);
      },
      delete(key: string): void {
        cacheMap.delete(key);
      },
      refreshBadge(): void {
        // No UI shell in SDK unit tests.
      }
    },

    // W1-6 auto-disposing registry. The mock collects disposables into an array
    // (exposed as `__disposables` below) a test can inspect or drain.
    register(disposable: () => void): void {
      disposables.push(disposable);
    },

    // W1-5 host UX primitives. Defaults mirror the spec: confirm→false,
    // quickPick/prompt→null, alert→null (no-op), withProgress→runs the task
    // (passing a never-aborted signal). Override to drive a specific answer.
    async confirm(_opts): Promise<boolean> {
      return false;
    },
    async quickPick<T = unknown>(
      _items: Array<{ label: string; description?: string; value: T }>,
      _opts?: { title?: string; placeholder?: string }
    ): Promise<T | null> {
      return null;
    },
    async prompt(_opts): Promise<string | null> {
      return null;
    },
    async alert(_opts): Promise<string | null> {
      return null;
    },
    async withProgress<T>(
      task: (signal: AbortSignal) => Promise<T>,
      _opts: { title: string; cancellable?: boolean }
    ): Promise<T> {
      return task(new AbortController().signal);
    }
  };

  // Shallow merge overrides (cast because call override is relaxed to Promise<unknown>)
  const host = (overrides ? { ...base, ...overrides } : base) as ModuleHost;
  // Expose the collected disposables for assertions without widening the public
  // ModuleHost type — a test reads `(host as any).__disposables`.
  Object.defineProperty(host, '__disposables', {
    value: disposables,
    enumerable: false,
    configurable: true
  });
  return host;
}

/**
 * Create a fully-typed fake `MainModuleContext` for testing main modules.
 * Storage is backed by a real in-memory Map. Brokered capabilities (exec/fs/
 * fetch/mcp/llm/stream) are omitted by default (so tests that check `if (!ctx.exec)`
 * pass); override them individually to stub.
 *
 * @example
 * ```ts
 * const ctx = createMockMainContext({
 *   exec: async (req) => ({
 *     stdout: 'mock output',
 *     stderr: '',
 *     code: 0,
 *     signal: null
 *   })
 * });
 *
 * const caps = await module.setup(ctx);
 * const result = await caps.runCommand('git', ['status']);
 * ```
 */
export function createMockMainContext(overrides?: Partial<MainModuleContext>): MainModuleContext {
  const storageMap = new Map<string, unknown>();
  // W1-6: collect ctx.register disposables (exposed as `__disposables` below).
  const disposables: Array<() => void> = [];

  const base: MainModuleContext = {
    storage: {
      get<T = unknown>(key: string): T | undefined {
        return storageMap.get(key) as T | undefined;
      },
      set(key: string, value: unknown): void {
        storageMap.set(key, value);
      }
    },

    log(_message: string, _err?: unknown): void {
      // no-op (could console.log in verbose mode)
    },

    register(disposable: () => void): void {
      disposables.push(disposable);
    },

    // fs capability with all six methods as no-op stubs
    fs: {
      async readFile(_path: string, _encoding?: 'utf-8'): Promise<string> {
        return '';
      },
      async writeFile(_path: string, _data: string): Promise<void> {
        // no-op
      },
      async rm(_path: string): Promise<void> {
        // no-op
      },
      async readdir(_path: string): Promise<string[]> {
        return [];
      },
      async stat(_path: string): Promise<{ size: number; mtimeMs: number; isFile: boolean; isDirectory: boolean }> {
        return { size: 0, mtimeMs: 0, isFile: false, isDirectory: false };
      },
      async exists(_path: string): Promise<boolean> {
        return false;
      }
    }

    // Brokered caps (other than fs) omitted by default — override to stub:
    // exec?: ...
    // fetch?: ...
    // mcp?: ...
    // llm?: ...
    // stream?: ...
    // resolveProjectRoot?: ...
    // personas?: ...
    // teams?: ...
    // summarizeSession?: ...
  };

  // Shallow merge overrides
  const ctx = overrides ? { ...base, ...overrides } : base;
  Object.defineProperty(ctx, '__disposables', {
    value: disposables,
    enumerable: false,
    configurable: true
  });
  return ctx;
}

/**
 * Helper to flush the microtask queue (pending Promises). Useful in tests
 * when asserting state after an async operation that hasn't visibly awaited yet.
 *
 * @example
 * ```ts
 * host.call('someCapability'); // fire-and-forget
 * await flushMicrotasks();
 * // Now any .then() handlers have run
 * ```
 */
export async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}
