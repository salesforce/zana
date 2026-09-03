/**
 * Permission enforcement for extensions (P3-B). Turns the DECLARED
 * `ExtensionPermission` union into ENFORCED, deny-by-default gates.
 *
 * Trust tier is PROVENANCE, not capability:
 *   - BUILT-IN modules (the `MAIN_MODULES` ids) ship with the app
 *     and are TRUSTED. `can()` always returns true for them; they never hit the
 *     broker (they run in-process with raw Node) — but if a built-in id is ever
 *     asked, it is allowed.
 *   - DISK extensions are UNTRUSTED. A capability is allowed only if its
 *     permission is in that extension's GRANTED set (+ scope checks for
 *     exec bins / fs paths / fetch hosts). Anything not granted → denied.
 *
 * Deny-by-default everywhere: an unknown id, an extension with no manifest, an
 * ungranted permission, or an out-of-scope concrete request all reject.
 *
 * P3-D SEAM: `grantedPermissions(moduleId)` is the single source of truth for
 * what a disk ext may do. Today it returns `declared = manifest.permissions`.
 * P3-D will swap the *provider* to return `declared ∩ user-consented` (the
 * consent screen's stored grant) WITHOUT changing the broker or any gate — they
 * only ever consult this function. Inject a different `GrantProvider` to do so.
 */

import { basename } from 'node:path';
import { homedir } from 'node:os';
import { realpathSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import { isWithin } from '@zana-ai/zcc-path-confine';
import type { ExtensionPermission } from '@zana-ai/zcc-extension-sdk';

/**
 * Realpath a path, tolerating non-existence (returns the lexical input). Used so
 * granted roots + sensitive roots are stored in their REAL on-disk form — the
 * symlink-safe fs check in broker-caps re-asserts with a `realpath()`'d target,
 * and that target only `isWithin` a root if the root is itself canonicalized the
 * same way (e.g. macOS `/var` → `/private/var`). Without this, a legit read of a
 * file under a symlinked-prefix root (the common case on macOS) would be denied.
 */
function realpathOrSelf(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/** Scope arg for a concrete request, interpreted per-permission. */
export type PermissionScope =
  | { kind: 'exec'; bin: string }
  | { kind: 'fs'; path: string }
  | { kind: 'net'; host: string }
  | { kind: 'mcp'; serverId: string }
  | { kind: 'stream'; endpoint: string }
  | { kind: 'extensions:install'; url: string };

/** What the broker needs to know about ONE disk extension. */
export interface ExtensionGrant {
  /** Granted permission tokens (for P3-B: the declared manifest permissions). */
  permissions: ReadonlySet<ExtensionPermission>;
  /** Allowed exec basenames. */
  execAllowlist: ReadonlySet<string>;
  /** Canonicalized fs roots the ext may touch (its own dir is added by the host). */
  fsRoots: readonly string[];
  /** Allowed egress hostnames. */
  egressAllowlist: ReadonlySet<string>;
  /** Allowed host-managed MCP server ids for `ctx.mcp` (`'*'` = any). */
  mcpAllowlist: ReadonlySet<string>;
  /** Allowed host-managed stream endpoint handles for `ctx.stream` (`'*'` = any). */
  streamAllowlist: ReadonlySet<string>;
  /** Git repository URLs an extension may request to install. */
  extensionInstallAllowlist: ReadonlySet<string>;
}

/**
 * Provides the live grant for a disk-ext id, or null if it is unknown / not a
 * disk ext. P3-D replaces the implementation (declared ∩ consented) without the
 * broker changing.
 */
export type GrantProvider = (moduleId: string) => ExtensionGrant | null;

/**
 * Roots that are NEVER writable even if a granted fsRoot would cover them.
 * Realpath'd so the block holds against a `realpath()`'d target (broker-caps
 * re-checks the real path; a symlink → ~/.ssh resolves here too).
 */
export function sensitiveRoots(): string[] {
  const home = homedir();
  const roots = [
    realpathOrSelf(resolve(home, '.ssh')),
    realpathOrSelf(resolve(home, '.aws')),
    realpathOrSelf(resolve(home, '.zcc')),
    realpathOrSelf(resolve(home, '.zcc-dev')),
    // Provider auth/session caches (0.4): a coding-agent CLI stores credentials
    // and transcripts here, none covered by the three above. `~/.codex` holds
    // OpenAI Codex's `auth.json`; `~/.config/gcloud` holds Google's OAuth
    // keyring; `~/.claude/sessions` holds Claude transcripts (which can contain
    // a pasted secret). Block writes to all three so a granted `~`-wide fsRoot
    // can't tamper with or corrupt provider credentials.
    realpathOrSelf(resolve(home, '.codex')),
    // `~/.cursor` holds the Cursor agent CLI's auth token + JSONL chat
    // transcripts (same class as `~/.codex` / `~/.claude/sessions`).
    realpathOrSelf(resolve(home, '.cursor')),
    realpathOrSelf(resolve(home, '.config', 'gcloud')),
    realpathOrSelf(resolve(home, '.claude', 'sessions'))
  ];
  const extra = process.env.ZCC_DATA_DIR?.trim();
  if (extra) {
    const real = realpathOrSelf(resolve(extra));
    if (!roots.includes(real)) roots.push(real);
  }
  return roots;
}

export interface AuditEntry {
  ts: number;
  moduleId: string;
  permission: string;
  scope?: string;
  allow: boolean;
}

export interface PermissionBrokerDeps {
  /** Ids that are built-in (trusted) — always allowed. */
  builtinIds: ReadonlySet<string>;
  /** Live grant lookup for disk exts (the P3-D seam). */
  grants: GrantProvider;
  /** Audit sink (allow + deny lines). */
  audit?: (entry: AuditEntry) => void;
  /**
   * Roots that are NEVER writable even if a granted fsRoot would cover them.
   * Defaults to {@link sensitiveRoots} (~/.ssh, ~/.aws, ~/.zcc). Injectable so
   * a test can point it at a temp dir that's guaranteed to exist on a clean CI
   * runner — the real ~/.ssh may be absent there, which would make a symlink
   * dangle (ENOENT) instead of resolving into a sensitive root.
   */
  sensitiveRoots?: () => string[];
}

/** Thrown (or its message used) when a gate rejects. The renderer/child sees this text. */
export class PermissionDenied extends Error {
  constructor(moduleId: string, permission: string, detail?: string) {
    super(`PermissionDenied: ${moduleId} lacks "${permission}"${detail ? ` (${detail})` : ''}`);
    this.name = 'PermissionDenied';
  }
}

export class PermissionBroker {
  constructor(private readonly deps: PermissionBrokerDeps) {}

  /** True if this id is a trusted built-in (bypasses all enforcement). */
  isBuiltin(moduleId: string): boolean {
    return this.deps.builtinIds.has(moduleId);
  }

  /**
   * Deny-by-default decision. Built-ins: always true. Disk exts: the permission
   * must be granted AND (for scoped perms) the concrete scope must pass.
   * Audits both allow and deny.
   */
  can(moduleId: string, permission: ExtensionPermission, scope?: PermissionScope): boolean {
    const allow = this.decide(moduleId, permission, scope);
    this.deps.audit?.({
      ts: Date.now(),
      moduleId,
      permission,
      scope: scope ? scopeToString(scope) : undefined,
      allow
    });
    return allow;
  }

  /** Like {@link can} but throws {@link PermissionDenied} instead of returning false. */
  assert(moduleId: string, permission: ExtensionPermission, scope?: PermissionScope): void {
    if (!this.can(moduleId, permission, scope)) {
      throw new PermissionDenied(moduleId, permission, scope ? scopeToString(scope) : undefined);
    }
  }

  private decide(moduleId: string, permission: ExtensionPermission, scope?: PermissionScope): boolean {
    if (this.isBuiltin(moduleId)) return true; // trusted by provenance

    const grant = this.deps.grants(moduleId);
    if (!grant) return false; // unknown / not a disk ext → deny
    if (!grant.permissions.has(permission)) return false; // bare permission ungranted

    if (!scope) return true; // unscoped permission, granted

    switch (scope.kind) {
      case 'exec':
        // basename only — never accept a path or a shell string. The `'*'`
        // wildcard means "any bin", but the basename guard is NON-NEGOTIABLE:
        // `*` widens WHICH bins, never HOW they're named, so a path/shell string
        // is still rejected (no arbitrary `sh -c` via a wildcard grant).
        if (scope.bin !== basename(scope.bin)) return false;
        return grant.execAllowlist.has('*') || grant.execAllowlist.has(scope.bin);
      case 'fs': {
        // This check is LEXICAL (sync, no fs touch): `resolve()` collapses
        // `..`/`.` but does NOT follow symlinks. A symlink inside a granted root
        // pointing outside it would pass here. broker-caps.ts therefore calls
        // this gate TWICE — once on the lexical path, then again on the
        // `realpath()`'d path (P3-HARDEN) — so a symlink escape is caught on the
        // second pass. Keeping this gate lexical+sync preserves its use as a pure
        // policy predicate (the renderer-facing `can()` has no fs to await).
        if (!isAbsolute(scope.path)) return false;
        const canonical = resolve(scope.path);
        const inRoot = grant.fsRoots.some((root) => isWithin(canonical, root));
        if (!inRoot) return false;
        // Writes additionally never touch a sensitive root.
        if (permission === 'fs:write') {
          const sensitive = this.deps.sensitiveRoots ?? sensitiveRoots;
          if (sensitive().some((s) => isWithin(canonical, s))) return false;
        }
        return true;
      }
      case 'net':
        // `'*'` means "any host". No confinement analogue to worry about here
        // (unlike fs, there's no sensitive-root blocklist), so a bare wildcard is
        // the honest "reach anywhere" grant — surfaced loudly on the consent
        // screen so the user opts in with eyes open.
        return grant.egressAllowlist.has('*') || grant.egressAllowlist.has(scope.host.toLowerCase());
      case 'mcp':
        // Opaque allowlist of host-managed MCP server ids (like exec bins).
        // `'*'` = any registered server. The workspace CONFINEMENT (which
        // `.zana` root a call touches) is enforced separately, host-side, by the
        // MCP pool's realpath project match — this gate only decides WHICH server.
        return grant.mcpAllowlist.has('*') || grant.mcpAllowlist.has(scope.serverId);
      case 'stream':
        // Opaque allowlist of host-managed stream endpoint HANDLES (like MCP
        // server ids). `'*'` = any registered handle. The real socket/URL behind
        // the handle is resolved + confined host-side by the stream relay — this
        // gate only decides WHICH endpoint handle the ext may subscribe to.
        return grant.streamAllowlist.has('*') || grant.streamAllowlist.has(scope.endpoint);
      case 'extensions:install':
        return grant.extensionInstallAllowlist.has(scope.url);
      default:
        return false;
    }
  }
}

function scopeToString(scope: PermissionScope): string {
  switch (scope.kind) {
    case 'exec':
      return `bin=${scope.bin}`;
    case 'fs':
      return `path=${scope.path}`;
    case 'net':
      return `host=${scope.host}`;
    case 'mcp':
      return `server=${scope.serverId}`;
    case 'stream':
      return `endpoint=${scope.endpoint}`;
    case 'extensions:install':
      return `url=${scope.url}`;
  }
}

/**
 * Build an {@link ExtensionGrant} from a disk ext's declared manifest view.
 * P3-B: granted = declared. `~`-prefixed / relative fsRoots are canonicalized;
 * the extension's own dir is added so it can always read its bundle.
 *
 * P3-D will wrap/replace this to intersect with the stored user consent.
 */
export function grantFromManifest(
  permissions: readonly string[] | undefined,
  scopes:
    | {
        execAllowlist?: string[];
        fsRoots?: string[];
        egressAllowlist?: string[];
        mcpAllowlist?: string[];
        streamAllowlist?: string[];
        extensionInstallAllowlist?: string[];
      }
    | undefined,
  extDir: string
): ExtensionGrant {
  // Realpath the roots so the symlink-safe check in broker-caps (which re-asserts
  // with a realpath'd target) compares like-for-like (macOS /var → /private/var).
  const fsRoots = [realpathOrSelf(resolve(extDir))];
  for (const root of scopes?.fsRoots ?? []) {
    fsRoots.push(realpathOrSelf(canonicalizeRoot(root)));
  }
  return {
    permissions: new Set((permissions ?? []) as ExtensionPermission[]),
    execAllowlist: new Set(scopes?.execAllowlist ?? []),
    fsRoots,
    egressAllowlist: new Set((scopes?.egressAllowlist ?? []).map((h) => h.toLowerCase())),
    mcpAllowlist: new Set(scopes?.mcpAllowlist ?? []),
    streamAllowlist: new Set(scopes?.streamAllowlist ?? []),
    extensionInstallAllowlist: new Set(scopes?.extensionInstallAllowlist ?? [])
  };
}

/** Resolve a `~`-prefixed or relative root to an absolute canonical path. */
function canonicalizeRoot(root: string): string {
  if (root === '~' || root.startsWith('~/')) {
    return resolve(homedir(), root.slice(root === '~' ? 1 : 2));
  }
  return resolve(root);
}
