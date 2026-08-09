/**
 * Node-builtin DENYLIST for the per-extension child (P3-HARDEN, the headline
 * residual of design §2e).
 *
 * The child (`host-child.ts`) is a real Node `utilityProcess`, so a malicious
 * disk extension can try to obtain raw Node builtins (`child_process`, `fs`,
 * `net`, …) *inside its own child* and bypass the broker entirely. The broker
 * (exec/fs/fetch over the MessagePort) is the ONLY sanctioned capability path;
 * this guard makes the brokered path the only *practical* path by denying the
 * raw builtins that would skip it.
 *
 * ## Mechanism (three layers — defense-in-depth, all JS-level)
 *
 * The child is ESM (`"type":"module"`), so the untrusted extension is loaded via
 * `await import()`. Three independent reach-paths to a raw builtin exist, and we
 * close each:
 *
 *   1. **ESM `import` (static + dynamic)** — `import 'node:fs'` /
 *      `await import('node:fs')`. Closed by an **ESM loader hook** registered via
 *      `module.register()`. The hook's `resolve` throws on a denied specifier, so
 *      it fires for the entire untrusted module graph (the entry and everything
 *      it statically/dynamically imports). Registered as a `data:` URL so the
 *      denylist stays in this one file and needs no separate build entry.
 *   2. **CJS `require`** — reachable from ESM via `module.createRequire(...)('fs')`.
 *      The ESM loader hook does NOT see CJS `require`, so we additionally patch
 *      `Module._load` to throw on a denied request. This also covers any
 *      transitive CJS dependency the ext bundles.
 *   3. **`process.binding` / `process._linkedBinding`** — the internal native
 *      binding escape (e.g. `process.binding('spawn_sync')`). We replace both
 *      with throwing stubs before the untrusted import.
 *
 * `installChildBuiltinGuard()` does layers 2+3 synchronously (unit-testable in
 * isolation); `denylistLoaderHookUrl()` returns the `data:` URL for layer 1,
 * which `host-child.ts` passes to `module.register()` before importing the ext.
 *
 * ## HONEST RESIDUAL — what this does NOT stop
 *
 * This is **JS-level capability deprivation, not an OS sandbox.** A determined,
 * native-capable attacker still has avenues we do not seal here:
 *   - **`process.dlopen`** can load a native `.node` addon directly (an addon can
 *     then do anything the process can). We leave `dlopen` in place because the
 *     `vm`/addon-build surface for a *pure-JS* disk extension is exotic, and
 *     stubbing it risks breaking legit native deps of a well-behaved ext; this is
 *     an explicitly accepted residual, not an oversight.
 *   - **`node:vm`** is on the denylist, but a sufficiently clever escape via other
 *     reflective globals is not provably impossible — JS-level guards are
 *     bypassable in principle by code running in the same realm.
 *   - The TRUE seal is the **OS/process boundary** (Node's `--permission` model,
 *     or seccomp/sandbox at spawn) which is the documented "evaluate when stable"
 *     follow-up (design §2e-c). This guard raises the bar from "trivial one-liner
 *     bypass" to "requires a native-addon or realm-escape exploit", which is the
 *     strongest *practical* mitigation without that OS boundary.
 *
 * The win that always holds: a well-behaved extension using only the broker `ctx`
 * (exec/fs/fetch/storage/log over the port) is unaffected — none of those touch a
 * raw builtin in the child.
 */

import module from 'node:module';

/**
 * Bare specifiers denied to untrusted extension code. Each is matched in both
 * its bare (`fs`) and `node:`-prefixed (`node:fs`) form. These are the builtins
 * that would let an ext perform exec / file / network / code-eval / threading
 * OUTSIDE the broker. `node:module` is denied to UNTRUSTED code too: the
 * bootstrap's own `import 'node:module'` resolves at top-level BEFORE the loader
 * hook registers, so denying it here only affects the untrusted graph — it
 * removes the reflective foothold of handing the ext the live `Module` namespace
 * (`Module._cache`, `createRequire`, etc.). `node:url` / `node:path` / `node:os`
 * etc. remain available as inert helpers.
 */
export const DENIED_BUILTINS: readonly string[] = [
  'child_process',
  'fs',
  'fs/promises',
  'net',
  'dgram',
  'http',
  'https',
  'http2',
  'tls',
  'dns',
  'vm',
  'worker_threads',
  'cluster',
  'inspector',
  'repl',
  'v8',
  'module'
];

/** Normalize `node:fs` → `fs` for set membership. */
function stripNodePrefix(spec: string): string {
  return spec.startsWith('node:') ? spec.slice(5) : spec;
}

/**
 * True if `specifier` names a denied builtin (in bare or `node:` form). A
 * subpath like `fs/promises` matches its exact denylist entry; `node:fs/promises`
 * normalizes to `fs/promises`.
 */
export function isDeniedBuiltin(specifier: unknown): boolean {
  if (typeof specifier !== 'string') return false;
  const bare = stripNodePrefix(specifier);
  return DENIED_BUILTINS.includes(bare);
}

/**
 * Layer 2+3 of the guard (synchronous; the unit-testable core):
 *   - patch `Module._load` so CJS `require('child_process')` — reachable from
 *     ESM via `createRequire` — throws.
 *   - replace `process.binding` / `process._linkedBinding` with throwing stubs.
 *
 * Idempotent: a second call is a no-op (we tag the patched `_load`). Call ONCE,
 * before importing the untrusted extension. Returns nothing; throws only if the
 * Node internals are shaped unexpectedly (never in practice).
 */
export function installChildBuiltinGuard(): void {
  // `module` default export is the Module constructor/namespace; `_load` is the
  // CJS resolver entry every `require` funnels through.
  const Mod = module as unknown as {
    _load?: (request: string, parent: unknown, isMain: boolean) => unknown;
    __zccGuarded?: boolean;
  };
  if (Mod.__zccGuarded) return;
  const realLoad = Mod._load;
  if (typeof realLoad === 'function') {
    Mod._load = function patchedLoad(request: string, parent: unknown, isMain: boolean) {
      if (isDeniedBuiltin(request)) {
        throw new Error(`ExtensionDenied: require("${request}") is blocked in the extension host`);
      }
      return realLoad.call(this, request, parent, isMain);
    };
    Mod.__zccGuarded = true;
  }

  // Neutralize the internal native-binding escape hatches. These are not part of
  // the public API; replacing them denies `process.binding('spawn_sync')` etc.
  const proc = process as unknown as {
    binding?: (name: string) => unknown;
    _linkedBinding?: (name: string) => unknown;
  };
  const denyBinding = (name: string): never => {
    throw new Error(`ExtensionDenied: process binding "${name}" is blocked in the extension host`);
  };
  try {
    proc.binding = denyBinding;
  } catch {
    /* frozen in some builds — best-effort */
  }
  try {
    proc._linkedBinding = denyBinding;
  } catch {
    /* best-effort */
  }
}

/**
 * Layer 1: a `data:`-URL ESM loader module whose `resolve` hook throws on a
 * denied specifier. Pass the returned URL to `module.register()` BEFORE the
 * untrusted `import()`. As a `data:` URL the denylist is inlined from
 * {@link DENIED_BUILTINS}, so there is no second build artifact to ship/resolve.
 *
 * The hook fires for every resolution in the untrusted graph (static + dynamic
 * `import`), throwing an `ExtensionDenied:` error the child surfaces as a
 * `setup-error`.
 */
export function denylistLoaderHookUrl(): string {
  const denied = JSON.stringify(DENIED_BUILTINS);
  // NOTE: this source runs in the loader-hook thread, NOT this module's scope —
  // it must be self-contained (no closure over `DENIED_BUILTINS`).
  const src = `
const DENIED = new Set(${denied});
function isDenied(spec) {
  if (typeof spec !== 'string') return false;
  const bare = spec.startsWith('node:') ? spec.slice(5) : spec;
  return DENIED.has(bare);
}
export async function resolve(specifier, context, nextResolve) {
  if (isDenied(specifier)) {
    throw new Error('ExtensionDenied: import of "' + specifier + '" is blocked in the extension host');
  }
  return nextResolve(specifier, context);
}
`;
  return 'data:text/javascript,' + encodeURIComponent(src);
}
