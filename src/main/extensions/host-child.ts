/**
 * Per-extension child bootstrap (P3-A) — runs INSIDE an Electron
 * `utilityProcess`, one process per untrusted DISK extension. This is the file
 * `ExtensionProcessHost.spawn()` forks. It is **core-owned, trusted** code; the
 * untrusted extension main module is `import()`'d *by this bootstrap, inside the
 * child*, so its `setup()` and capabilities never execute in the Electron main
 * process. That import is the line that used to be `loader.ts:114-115` — it
 * moves here verbatim.
 *
 * Lifecycle:
 *   1. The host forks this file and posts ONE `MessagePort` via
 *      `process.parentPort`. We grab that port and speak the `host-protocol`
 *      JSON-RPC over it; we do not use `parentPort` for anything else.
 *   2. On `{type:'init', entryPath, moduleId}` we `import(pathToFileURL(entryPath))`,
 *      take `default` as a `MainModule`, and call `setup(proxyCtx)`.
 *   3. `proxyCtx.storage`/`log` are PROXY stubs: each call posts a `broker`
 *      request to the host and (for storage.get) awaits the reply. The real
 *      store lives host-side, keyed by the AUTHENTICATED id (design §3d) — the
 *      child cannot read another extension's namespace.
 *   4. We answer `{type:'call'}` by invoking the matching capability,
 *      `{type:'lifecycle'}` by invoking the module's `onInstall?()` /
 *      `onUninstall?()` hook, and `{type:'teardown'}` by calling `teardown?()`.
 *
 * CAPABILITY DEPRIVATION (P3-HARDEN): before the untrusted `import()`, the child
 * installs a Node-builtin denylist (`host-child-guard.ts`): an ESM loader hook +
 * a `Module._load` patch + neutered `process.binding`, so the ext cannot reach
 * raw `child_process`/`fs`/`net`/… and skip the broker. The brokered ctx
 * (exec/fs/fetch/storage/log over the port) is the only practical capability
 * path. See `host-child-guard.ts` for the honest residual (this is JS-level, not
 * an OS sandbox; `process.dlopen`/native addons remain). The other WIN
 * (from P3-A): untrusted code no longer runs in MAIN (no BrowserWindow, no app
 * state, no sibling modules' memory) and a crash/hang is contained to this child.
 */

import module from 'node:module';
import { pathToFileURL } from 'node:url';
import {
  installChildBuiltinGuard,
  denylistLoaderHookUrl
} from './host-child-guard.js';
import type {
  MainModule,
  MainModuleContext,
  ModuleCapability,
  ExecRequest,
  ExecResult,
  BrokeredFetchInit,
  BrokeredFetchResponse,
  ExtensionLlmRequest,
  LlmInvokeResult,
  HostLaunchSpec,
  HostRequestLaunchResult,
  HostConfirmSpec,
  HostNotifySpec,
  SdkPersona,
  SdkPersonaInput,
  SdkTeam,
  SdkTeamInput
} from '../../shared/module-main.js';
import {
  errToString,
  type BrokerMethod,
  type ChildToHost,
  type HostToChild,
  type LifecycleHook
} from './host-protocol.js';

/**
 * Electron injects `process.parentPort` (a MessagePortMain) into a
 * utilityProcess child. It's not in @types/node, so narrow it locally.
 */
interface ParentPortLike {
  on(event: 'message', listener: (e: { data: unknown; ports: PortLike[] }) => void): void;
  postMessage(message: unknown): void;
  start?(): void;
}
interface PortLike {
  on(event: 'message', listener: (e: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
  start(): void;
}

function getParentPort(): ParentPortLike {
  const pp = (process as unknown as { parentPort?: ParentPortLike }).parentPort;
  if (!pp) {
    throw new Error('host-child must run inside an Electron utilityProcess (no parentPort)');
  }
  return pp;
}

/** Structural MainModule check — mirrors loader.ts `isMainModule`. */
function isMainModule(v: unknown): v is MainModule {
  if (!v || typeof v !== 'object') return false;
  const m = v as Record<string, unknown>;
  return typeof m.id === 'string' && !!m.id && typeof m.setup === 'function';
}

/**
 * Install the Node-builtin denylist (P3-HARDEN) BEFORE any untrusted code can
 * run. The bootstrap's own imports (above) are already resolved at top-level, so
 * registering the ESM loader hook now only affects the *untrusted* graph imported
 * later in {@link handleInit}. CJS `require` + `process.binding` are patched
 * synchronously. Failure to install is fatal — we must not import an extension
 * unguarded.
 */
function installBuiltinDenylist(): void {
  installChildBuiltinGuard();
  module.register(denylistLoaderHookUrl());
}

function start(): void {
  installBuiltinDenylist();
  const parentPort = getParentPort();

  // The host's data port arrives on the FIRST `zcc-port` parentPort message
  // (sent by spawn-child.ts). Bind exactly once: a second port-bearing message
  // must NOT spin up a second module instance / broker sequence. Everything
  // after the handoff flows over `port`, not parentPort.
  let bound = false;
  parentPort.on('message', (e) => {
    if (bound) return;
    const data = e.data as { type?: string } | undefined;
    if (data?.type !== 'zcc-port') return;
    const port = e.ports?.[0];
    if (!port) return;
    bound = true;
    runWithPort(port);
  });
  parentPort.start?.();
}

function runWithPort(port: PortLike): void {
  /** Pending broker requests (storage.get) awaiting the host's reply. */
  const brokerWaiters = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  let brokerSeq = 0;
  let capabilities: Record<string, ModuleCapability> = {};
  let moduleInstance: MainModule | null = null;

  /**
   * W1-6 — auto-disposing cleanup registry for `ctx.register`. Disposables run
   * on teardown, AFTER the module's own `teardown()`. Idempotent per disposable
   * (a ran-flag), and safe against a throwing disposable (swallowed so the rest
   * of the sweep still runs). Runs exactly once — a second teardown is a no-op.
   */
  const disposables = new Set<() => void>();
  let disposed = false;
  function runDisposables(): void {
    if (disposed) return;
    disposed = true;
    for (const d of [...disposables]) {
      disposables.delete(d);
      try {
        d();
      } catch (err) {
        void broker('log', ['ctx.register disposable threw', errToString(err)]);
      }
    }
  }

  const send = (msg: ChildToHost) => port.postMessage(msg);

  /** Post a broker request to the host and await its reply (storage.get/set). */
  function broker(method: BrokerMethod, args: unknown[]): Promise<unknown> {
    const reqId = ++brokerSeq;
    return new Promise<unknown>((resolve, reject) => {
      brokerWaiters.set(reqId, { resolve, reject });
      send({ type: 'broker', reqId, method, args });
    });
  }

  // The proxy ctx. storage.get is async over the wire, but the SDK's
  // `storage.get` is declared sync. We expose a sync-looking shape backed by a
  // host round-trip via a cached read on first touch is overkill for P3-A — the
  // current built-ins use storage synchronously, but DISK extensions go through
  // this proxy where get returns a Promise. We keep the SDK type and document
  // that disk-ext storage.get resolves a Promise. (Built-ins keep the real sync
  // store in-process via MainModuleHost; they never hit this proxy.)
  const proxyCtx: MainModuleContext = {
    storage: {
      get: (<T = unknown>(key: string) => broker('storage.get', [key]) as Promise<T | undefined>) as MainModuleContext['storage']['get'],
      set: (key: string, value: unknown) => {
        // Fire-and-forget from the module's perspective; the host persists.
        void broker('storage.set', [key, value]);
      }
    },
    log: (message: string, err?: unknown) => {
      void broker('log', [message, err === undefined ? undefined : errToString(err)]);
    },
    // W1-6: register a teardown disposable, run on teardown after the module's
    // own teardown(). Local to the child (no broker round-trip) — the host's
    // teardown RPC drives the sweep. Idempotent + throw-isolated (see runDisposables).
    register: (disposable: () => void) => {
      if (typeof disposable !== 'function') return;
      if (disposed) {
        try {
          disposable();
        } catch {
          /* a late registration's throw is swallowed like the sweep's */
        }
        return;
      }
      disposables.add(disposable);
    },
    // Brokered capabilities (P3-B). Each forwards over the port; the host gates
    // it against this extension's granted permissions + scopes BEFORE acting and
    // rejects (PermissionDenied) if ungranted. The child gets only the result —
    // never a raw fd / socket / child_process handle.
    exec: (req: ExecRequest) => broker('exec', [req]) as Promise<ExecResult>,
    fs: {
      readFile: (path: string, encoding?: 'utf-8') =>
        broker('fs.readFile', [path, encoding]) as Promise<string>,
      writeFile: (path: string, data: string) =>
        broker('fs.writeFile', [path, data]) as Promise<void>,
      rm: (path: string) => broker('fs.rm', [path]) as Promise<void>,
      readdir: (path: string) => broker('fs.readdir', [path]) as Promise<string[]>,
      stat: (path: string) =>
        broker('fs.stat', [path]) as Promise<{ size: number; mtimeMs: number; isFile: boolean; isDirectory: boolean }>,
      exists: (path: string) => broker('fs.exists', [path]) as Promise<boolean>
    },
    fetch: (url: string, init?: BrokeredFetchInit) =>
      broker('fetch', [url, init]) as Promise<BrokeredFetchResponse>,
    // Brokered call to a host-managed MCP server. Forwards over the port; the
    // host gates it (`mcp` perm + `mcpAllowlist`) and confines the workspace hint
    // before touching the pool. The child gets only the parsed tool result.
    mcp: (
      serverId: string,
      tool: string,
      args?: Record<string, unknown>,
      opts?: { projectPath?: string; useGlobal?: boolean }
    ) => broker('mcp', [serverId, tool, args, opts]) as Promise<unknown>,
    // Explicit, user-initiated `.zana/` skeleton creation for a workspace that
    // has none yet — the "Init Zana" button's mechanism. Same gate as `mcp`.
    mcpInitWorkspace: (opts?: { projectPath?: string; useGlobal?: boolean }) =>
      broker('mcp.initWorkspace', [opts]) as Promise<{ created: boolean }>,
    // Read-only counterpart: whether `.zana/` is already initialized, no write.
    mcpIsWorkspaceInitialized: (opts?: { projectPath?: string; useGlobal?: boolean }) =>
      broker('mcp.isWorkspaceInitialized', [opts]) as Promise<boolean>,
    // Brokered subscribe to a host-managed live push source (SSE/socket tail).
    // Forwards over the port; the host gates it (`stream` perm + `streamAllowlist`)
    // and resolves the endpoint HANDLE to a confined transport before opening the
    // relay connection. `stream.open` resolves the opaque subId; the FRAMES do NOT
    // return here — the relay pushes them core→renderer directly. `close()` sends
    // `stream.close` (ownership-checked host-side). The child holds no socket.
    stream: async (endpoint: string, opts?: Record<string, unknown>) => {
      const subId = (await broker('stream.open', [endpoint, opts])) as string;
      return {
        subId,
        close: () => broker('stream.close', [subId]) as Promise<void>
      };
    },
    // Brokered LLM micro-call (Epic C). Forwards over the port; the host gates it
    // (`llm:invoke` perm + the global kill switch), clamps input/output/model/
    // rate/concurrency, and runs it on its own LlmService at a single contained
    // choke-point. The child gets only a stripped {ok,text,error?,ms} — never a
    // provider name, model, or token usage.
    llm: (req: ExtensionLlmRequest) => broker('llm.run', [req]) as Promise<LlmInvokeResult>,
    // W1-3: fire-and-forget push main→renderer. Forwards over the port; the host
    // namespaces the topic (`ext:<moduleId>:<topic>` stamped from the authenticated
    // moduleId) and bounds frames (≤128KiB, ~50fps). Frames go core→renderer via
    // the StreamSink relay, NOT back over this port. Fire-and-forget: no return.
    emit: (topic: string, payload: unknown) => {
      broker('emit', [topic, payload]); // No await — fire-and-forget.
    },
    // W1-4 trust inversion. Each forwards over the port; the host performs the
    // renderer-only action (or PARKS a launch) keyed to the AUTHENTICATED
    // moduleId. toast/navigate/selectProject are fire-and-forget; requestLaunch
    // awaits the host's {parked, requestId} verdict. The gate (session:launch /
    // projects:select) is enforced host-side before the action.
    host: {
      toast: (message: string, kind?: 'info' | 'error') => {
        broker('host.toast', [message, kind]); // No await — fire-and-forget.
      },
      navigate: (target: string) => {
        broker('host.navigate', [target]); // No await — fire-and-forget.
      },
      selectProject: (projectId: string | null) => {
        broker('host.selectProject', [projectId]); // No await — fire-and-forget.
      },
      requestLaunch: (spec: HostLaunchSpec) =>
        broker('host.requestLaunch', [spec]) as Promise<HostRequestLaunchResult>,
      // W1-5 main-reachable host UX. Round-trip (awaited): the host renders the
      // dialog, the human answers, and the answer resolves this Promise. Fails
      // closed (false / null) when no renderer can receive it.
      confirm: (spec: HostConfirmSpec) => broker('host.confirm', [spec]) as Promise<boolean>,
      alert: (spec: HostNotifySpec) => broker('host.alert', [spec]) as Promise<string | null>
    },
    // Phase B: `ctx.inbox.push`. Forwards over the port; the host gates
    // `inbox:push` + the target projectId and stamps `extensionSource` from
    // the AUTHENTICATED moduleId bound to this port (the child cannot forge it).
    inbox: {
      push: (input: {
        projectId: string;
        comments?: string;
        docs?: Array<{ path: string }>;
        target?: { moduleId: string };
      }) => broker('inbox.push', [input]) as Promise<{ id: string }>
    },
    // Persona/team contribution. Each forwards over the port; the host stamps
    // provenance from the AUTHENTICATED moduleId it bound to this port (the
    // child cannot forge it) and runs the shared sanitize gate. The child gets
    // back the accepted (sanitized, namespaced, stamped) list.
    personas: {
      register: (list: SdkPersonaInput[]) =>
        broker('personas.register', [list]) as Promise<SdkPersona[]>,
      clear: () => broker('personas.clear', []) as Promise<void>
    },
    teams: {
      register: (list: SdkTeamInput[]) => broker('teams.register', [list]) as Promise<SdkTeam[]>,
      clear: () => broker('teams.clear', []) as Promise<void>
    },
    sshHosts: {
      register: () => broker('sshHosts.register', []) as Promise<void>,
      clear: () => broker('sshHosts.clear', []) as Promise<void>,
      list: () => broker('sshHosts.list', []) as Promise<Array<{ alias: string; hostname?: string; user?: string; proxyJump?: string }>>
    },
    remoteDefaults: {
      get: () => broker('remoteDefaults.get', []) as Promise<{ remoteDefaultPath?: string }>,
      set: (input: { remoteDefaultPath?: string }) =>
        broker('remoteDefaults.set', [input]) as Promise<{ remoteDefaultPath?: string }>
    },
    extensions: {
      installFromGit: (input: { url: string }) =>
        broker('extensions.installFromGit', [input]) as Promise<{ id: string }>
    }
  };

  async function handleInit(entryPath: string, moduleId: string): Promise<void> {
    try {
      const url = pathToFileURL(entryPath).href;
      // THE untrusted import — runs HERE in the child, never in main.
      const imported = (await import(/* @vite-ignore */ url)) as { default?: unknown };
      const candidate = imported.default;
      if (!isMainModule(candidate)) {
        send({ type: 'setup-error', moduleId, error: 'main entry has no valid default MainModule export' });
        return;
      }
      moduleInstance = candidate;
      const caps = await candidate.setup(proxyCtx);
      capabilities = caps && typeof caps === 'object' ? caps : {};
      send({ type: 'ready', moduleId, capabilities: Object.keys(capabilities) });
    } catch (err) {
      send({ type: 'setup-error', moduleId, error: errToString(err) });
    }
  }

  async function handleCall(callId: number, capability: string, args: unknown[]): Promise<void> {
    const fn = capabilities[capability];
    if (typeof fn !== 'function') {
      send({ type: 'result', callId, ok: false, error: `Unknown capability: ${capability}` });
      return;
    }
    try {
      const result = await fn(...args);
      send({ type: 'result', callId, ok: true, result });
    } catch (err) {
      send({ type: 'result', callId, ok: false, error: errToString(err) });
    }
  }

  /**
   * Fire a host-driven lifecycle hook (`onInstall` / `onUninstall`). Same
   * proxy ctx as `setup`, so the hook is capability-gated. An absent hook is a
   * clean no-op (`ok:true`) — most modules define neither. A throw is reported
   * as `ok:false`; the host logs+isolates it and proceeds (an install/uninstall
   * must never be blocked by a misbehaving hook).
   */
  async function handleLifecycle(callId: number, hook: LifecycleHook): Promise<void> {
    try {
      const fn = moduleInstance?.[hook];
      if (typeof fn === 'function') await fn.call(moduleInstance, proxyCtx);
      send({ type: 'result', callId, ok: true });
    } catch (err) {
      send({ type: 'result', callId, ok: false, error: errToString(err) });
    }
  }

  async function handleTeardown(callId: number): Promise<void> {
    try {
      if (moduleInstance?.teardown) await moduleInstance.teardown();
      // W1-6: run ctx.register disposables AFTER the module's own teardown, so a
      // disposable can still observe state teardown() cleaned up. Isolated: a
      // throwing disposable can't fail the teardown result.
      runDisposables();
      send({ type: 'result', callId, ok: true });
    } catch (err) {
      // teardown() threw — still run disposables so registered cleanup isn't lost.
      runDisposables();
      send({ type: 'result', callId, ok: false, error: errToString(err) });
    }
  }

  port.on('message', (e) => {
    const msg = e.data as HostToChild;
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'init':
        void handleInit(msg.entryPath, msg.moduleId);
        break;
      case 'call':
        void handleCall(msg.callId, msg.capability, msg.args);
        break;
      case 'lifecycle':
        void handleLifecycle(msg.callId, msg.hook);
        break;
      case 'teardown':
        void handleTeardown(msg.callId);
        break;
      case 'broker-result': {
        const waiter = brokerWaiters.get(msg.reqId);
        if (waiter) {
          brokerWaiters.delete(msg.reqId);
          if (msg.ok) waiter.resolve(msg.result);
          else waiter.reject(new Error(msg.error ?? 'broker request failed'));
        }
        break;
      }
    }
  });
  port.start();
}

start();
