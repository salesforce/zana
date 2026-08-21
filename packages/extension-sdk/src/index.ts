/**
 * Process-agnostic entry for `@zana-ai/zcc-extension-sdk`. Holds the API version,
 * the permission vocabulary, and small `define*` helpers. Safe to import from
 * either process (no React, no Node).
 *
 * Subpath entries:
 *   - `@zana-ai/zcc-extension-sdk/renderer` — AppModule, ModuleHost (React peer dep)
 *   - `@zana-ai/zcc-extension-sdk/main`     — MainModule, MainModuleContext
 *   - `@zana-ai/zcc-extension-sdk/helpers`  — pure runtime helpers (markdown, …)
 */

import type {
  AppModule,
  ModuleHost,
  RendererEntry,
  ActivateResult,
  HostEvents,
  SessionInfo,
  ProjectInfo,
  ExtensionCommand,
  ConfirmOptions,
  PromptOptions,
  QuickPickItem,
  QuickPickOptions,
  NotifyAction,
  NotifyOptions,
  ProgressOptions,
} from './renderer.js';
import type { MainModule, MainModuleContext, ProjectRootResolution } from './main.js';

/**
 * Integer contract version. Bumped only on a breaking change to the extension
 * contract. An extension's manifest declares the range it supports; the host
 * compares against this constant at load and refuses to mount on a mismatch.
 */
export const SDK_API_VERSION = 1;

/**
 * Capabilities an extension may declare it intends to use.
 *
 * As of Phase 3-B these are **ENFORCED deny-by-default for DISK extensions**:
 * a brokered capability or gated host method whose permission is absent from
 * the extension's granted set is rejected. Built-in modules shipped with the app
 * are TRUSTED and bypass enforcement entirely — the trust tier is
 * PROVENANCE, not capability.
 *
 * The `exec` / `fs:read` / `fs:write` / `net` tokens gate the brokered
 * {@link MainModuleContext} capabilities (P3-B); their scoping (which bins /
 * paths / hosts) is declared alongside in {@link ExtensionManifest.permissionScopes}.
 */
export type ExtensionPermission =
  | 'storage'
  | 'projects:read'
  | 'projects:select'
  | 'session:launch'
  | 'session:reply'
  | 'external:open'
  | 'inbox:push'
  // Lets an extension request installation from a declared, allowlisted git
  // repository. The host still owns cloning, validation, consent, and loading.
  | 'extensions:install'
  // Lets an extension read and update the global fallback path used for remote
  // projects that do not set an explicit start path.
  | 'remote:defaults'
  // Lets an extension participate in the host-owned remote-project SSH picker.
  // The extension receives structured SSH entries only through `ctx.sshHosts`;
  // it never receives raw filesystem access to `~/.ssh`.
  | 'ssh:hosts'
  // Brokered main-side capabilities (P3-B), scoped via `permissionScopes`:
  | 'exec'
  | 'fs:read'
  | 'fs:write'
  | 'net'
  // Brokered access to a HOST-MANAGED MCP server (stdio JSON-RPC), scoped by
  // `mcpAllowlist` (which server ids). The persistent stdio child + its
  // workspace routing live in core (an extension's one-shot brokered `exec`
  // can't hold a long-lived session); the extension only names a server id +
  // tool. Generic on purpose — no concrete server/extension id in the SDK.
  | 'mcp'
  // Brokered LLM micro-call via the host's own `LlmService` (`ctx.llm.run`). A
  // NET-NEW data-egress + cost surface, so it is its OWN token, SEPARATE from
  // `net`/`egressAllowlist`: the vendor is APP-configured (the operator's chosen
  // provider), never extension-chosen, so there is no arbitrary-endpoint reach to
  // scope. Host-clamped (model→haiku, input+output char ceilings, rate/concurrency)
  // and globally gated by `AppConfig.extensionLlmEnabled` (ships OFF). Prompts leave
  // the machine → the consent screen renders this LOUD.
  | 'llm:invoke'
  // Brokered consumption of a HOST-MANAGED live push source (SSE / socket tail),
  // scoped by `streamAllowlist` (which endpoint HANDLEs). The extension names an
  // opaque endpoint handle + receives frames; the persistent connection, the
  // real socket/URL behind the handle, and per-frame validation all live in CORE
  // (the extension never supplies a raw URL — Rule 1/2). EGRESS-shaped like `net`
  // (a live off-machine data feed), so `streamAllowlist` supports the `"*"`
  // wildcard and the consent screen renders it LOUD.
  | 'stream'
  // Gates BOTH `ExtensionManifest.skills` and `ExtensionManifest.mcpServers` —
  // an extension handing an AGENT new autonomous capabilities (a skill file
  // every Claude Code session on the machine can load; an MCP server
  // DEFINITION the extension itself owns, not merely a host-managed server it
  // calls via `mcp`). One token, not two: from the user's POV it's the same
  // trust question ("does this extension get to expand what my agents can do
  // without me approving each invocation"), asked once. Deliberately separate
  // from `mcp` (which only lets `ctx.mcp` CALL a server CORE already manages —
  // pure consumption) because a self-owned server definition can name an
  // arbitrary `command`/`args`/`url`, closer in shape to `exec`+`net` combined.
  // See docs/extension-agent-capabilities-plan.md §4.
  | 'agent:contribute';

/**
 * The permission vocabulary as a runtime array — the single source of truth a
 * consumer can iterate or validate against (the union type above erases at
 * compile time). Keep in sync with {@link ExtensionPermission}; the satisfies
 * check makes a drift a type error. Used to validate a user/Doctor-supplied
 * permission before writing it into a manifest, and to populate the
 * "add permission" picker in the Extensions hub.
 */
export const EXTENSION_PERMISSIONS = [
  'storage',
  'projects:read',
  'projects:select',
  'session:launch',
  'session:reply',
  'external:open',
  'inbox:push',
  'extensions:install',
  'remote:defaults',
  'ssh:hosts',
  'exec',
  'fs:read',
  'fs:write',
  'net',
  'mcp',
  'llm:invoke',
  'stream',
  'agent:contribute'
] as const satisfies readonly ExtensionPermission[];

/** Runtime guard: is `s` a known permission token? Narrows to ExtensionPermission. */
export function isExtensionPermission(s: string): s is ExtensionPermission {
  return (EXTENSION_PERMISSIONS as readonly string[]).includes(s);
}

/**
 * Per-permission SCOPING an extension declares alongside its `permissions`.
 * The permission token says "may exec / read / reach"; the scope says **what**.
 * Deny-by-default: an empty/absent scope means the gate rejects every concrete
 * request even if the bare permission is granted. Surfaced verbatim to the P3-D
 * consent screen so the user sees exactly what an extension may run/read/reach.
 *
 * WILDCARD: the two OPAQUE allowlists — `execAllowlist` and `egressAllowlist` —
 * accept a single `"*"` element meaning "any bin" / "any host". It's the honest
 * "I can't enumerate these ahead of time" grant (a generic terminal, an
 * arbitrary-URL fetcher). It's still deny-by-default (you must opt in by adding
 * `"*"`), the exec basename guard still holds (a `"*"` widens WHICH bins, never
 * HOW they're named — no `sh -c` path/shell injection), and the consent screen
 * renders it as an explicit "Any tool" / "Any host" so the user sees the breadth.
 * `fsRoots` intentionally has NO wildcard: a filesystem "read/write anywhere"
 * grant defeats path confinement (Rule 2) and the sensitive-root blocklist, so
 * fs access is always an enumerated, canonical-prefix list.
 */
export interface ExtensionPermissionScopes {
  /**
   * Allowed executable basenames for `ctx.exec` (e.g. `["sf","git"]`). No paths,
   * no shell. `["*"]` grants any basename (the basename-only guard still applies).
   */
  execAllowlist?: string[];
  /**
   * Filesystem roots `ctx.fs.*` may touch, as absolute paths or `~`-prefixed
   * home paths. A request is allowed only if its canonical path is within one
   * granted root. The extension's OWN dir is always implicitly readable. No
   * wildcard — fs access is always an enumerated, confined list (Rule 2).
   */
  fsRoots?: string[];
  /**
   * Allowed egress hosts for `ctx.fetch` (hostname only, e.g. `["api.github.com"]`).
   * `["*"]` grants any host.
   */
  egressAllowlist?: string[];
  /**
   * Allowed HOST-MANAGED MCP server ids for `ctx.mcp` (e.g. `["zana"]`). Each id
   * maps — in CORE, never here — to a resolved server binary the host spawns and
   * keeps alive. Like `execAllowlist` this is an opaque allowlist; `["*"]` grants
   * any registered server. Deny-by-default: an absent/empty list rejects every
   * `ctx.mcp` call even when the bare `mcp` permission is granted.
   */
  mcpAllowlist?: string[];
  /**
   * Allowed HOST-MANAGED stream endpoint HANDLES for `ctx.stream` (e.g.
   * `["zana:events"]`). Each handle maps — in CORE, never here — to a resolved
   * socket path / URL the host tails; the extension never supplies the real
   * endpoint (Rule 1/2). EGRESS-shaped like `egressAllowlist`: `["*"]` grants any
   * registered handle, and the consent screen renders the breadth LOUD.
   * Deny-by-default: an absent/empty list rejects every `ctx.stream` call even
   * when the bare `stream` permission is granted.
   */
  streamAllowlist?: string[];
  /**
   * Git repository URLs an extension may request to install. Every requested URL
   * must exactly match this list; the host owns all clone and consent checks.
   */
  extensionInstallAllowlist?: string[];
}

/**
 * Static description of a runtime-loaded extension, authored in
 * `extension.json`. The host's disk loader reads this to register the extension's
 * nav entry, locate its bundles, and gate it against the contract version
 * before mounting.
 *
 * The installable manifest shape is:
 * ```jsonc
 * {
 *   "id": "my-extension", "title": "My Extension", "icon": "Sparkles",
 *   "entry": { "renderer": "renderer.js", "main": "main.js" },
 *   "engines": { "zccApi": ">=1 <2" },
 *   "permissions": ["storage", "projects:read"]
 * }
 * ```
 */
export interface ExtensionManifest {
  /** Stable, URL-safe id. Doubles as NavId and storage namespace; matches `AppModule.id` / `MainModule.id`. */
  id: string;
  /**
   * Extension's own release version (SemVer, e.g. `"0.2.0"`). ORTHOGONAL to
   * `engines.zccApi`: that gates host-contract COMPATIBILITY, this ORDERS
   * releases. The boot-time auto-reseed compares this between the app-bundled
   * artifact and the installed copy to decide whether to refresh (never
   * downgrades). Absent ⇒ treated as `"0.0.0"`. */
  version?: string;
  /**
   * Build provenance, stamped into the PACKAGED manifest at package time (the
   * source manifest omits it). Lets the hub show "built <at>" and the dev
   * staleness check compare a loaded bundle's age to source. Never authored by
   * hand. */
  build?: { sha?: string | null; at?: string };
  /** Sidebar label. */
  title: string;
  /** Lucide icon name, resolved by core against `lucide-react`. */
  icon: string;
  /** Window-title suffix when active; defaults to `title`. */
  titleLabel?: string;
  /**
   * Bundle entry points relative to the extension root. Both optional: a
   * renderer-only extension omits `main`; a headless/main-only one omits
   * `renderer`.
   */
  entry: { renderer?: string; main?: string };
  /** Contract-version requirement (see {@link checkApiCompat}), e.g. `">=1 <2"`. */
  engines: { zccApi: string };
  /**
   * Capabilities the extension intends to use. ENFORCED deny-by-default for disk
   * extensions (built-ins bypass). The granted set is the intersection of this
   * list and the user's explicit consent.
   */
  permissions?: ExtensionPermission[];
  /**
   * Scoping for the brokered permissions (`exec`/`fs:*`/`net`). Optional; an
   * absent scope means the corresponding capability rejects every concrete
   * request (deny-by-default) even when the bare permission is granted.
   */
  permissionScopes?: ExtensionPermissionScopes;
  /**
   * Opt-in to mounting the extension's renderer panel as a PER-PROJECT TAB (see
   * {@link ProjectTabContribution}). The extension's global panel is opened
   * from the Extensions hub by default. Present ⇒ core also adds a tab to each
   * project's workspace; selecting it mounts the same `renderer` panel scoped
   * to the active project.
   */
  projectTab?: ProjectTabContribution;
  /**
   * Framework-aware agent preset contributed to the host's Advanced Quick-Agent
   * launcher (see {@link AgentPreset}). Absent ⇒ no preset. Core reads this
   * generically and injects the primer through the standard persona path — no
   * extension id appears in core launch logic (Rule 6).
   */
  agentPreset?: AgentPreset;
  /**
   * Skills contributed to Claude Code's skill catalogue (see
   * {@link ExtensionSkillContribution}). Each names a `SKILL.md` relative to
   * the extension's own install dir; core deploys it into a NAMESPACED
   * directory under `~/.claude/skills/` (never the bare skill name) so two
   * extensions can't collide or shadow a bundled/user skill. Requires the
   * `agent:contribute` permission — parsed regardless (so consent can show
   * what WOULD be granted) but only deployed when that permission is granted.
   * Absent ⇒ no skills contributed (the default).
   */
  skills?: ExtensionSkillContribution[];
  /**
   * MCP server DEFINITIONS this extension owns — as opposed to the `mcp`
   * permission + `mcpAllowlist`, which only let `ctx.mcp` CALL a server core
   * already manages. Each becomes a candidate entry mergeable into a
   * project's `.mcp.json`, namespaced `ext:<id>:<name>` so it can never
   * collide with a core-managed server id. Requires `agent:contribute`.
   * Absent ⇒ no servers contributed (the default).
   */
  mcpServers?: ExtensionMcpServerContribution[];
}

/**
 * One skill an extension contributes to Claude Code's skill catalogue (see
 * {@link ExtensionManifest.skills}).
 */
export interface ExtensionSkillContribution {
  /**
   * Path to the `SKILL.md`, relative to the extension's install root. Rejected
   * at discovery if it resolves outside that root (Rule 2 — a manifest is
   * still untrusted input; `path` is not exempt from path confinement just
   * because it was authored, not supplied at runtime).
   */
  path: string;
  /**
   * Slug for the deployed directory name (`ext-<id>-<slug>`). Defaults to a
   * kebab-cased basename of `path` when omitted. Keep stable across versions —
   * renaming orphans the previously-deployed directory; the installer only
   * prunes slugs it has a prior deploy record for.
   */
  slug?: string;
}

/**
 * One MCP server definition an extension contributes (see
 * {@link ExtensionManifest.mcpServers}). Same shape a project's `.mcp.json`
 * already accepts.
 */
export interface ExtensionMcpServerContribution {
  /** Name agents/personas reference; namespaced `ext:<id>:<name>` at registration. */
  name: string;
  type: 'stdio' | 'streamable-http' | 'sse';
  /** Required when `type: 'stdio'`. Basename-only — no shell, no path (same guard as `execAllowlist`). */
  command?: string;
  args?: string[];
  /** Required when `type` is not `'stdio'`. */
  url?: string;
  env?: Record<string, string>;
  /**
   * When true, this server is merged into EVERY spawn in a project where the
   * extension is enabled — no persona opt-in needed. Default false: most
   * servers should be opt-in per persona (via `Persona.mcpServers` naming this
   * server), keeping ambient agent tool-surface growth deliberate rather than
   * automatic.
   */
  alwaysOn?: boolean;
}

/**
 * Declares that an extension's renderer {@link AppModule.panel} should ALSO be
 * mounted as a **per-project tab** (alongside the core Terminals / Explorer /
 * Tickets / … tabs), in addition to its optional global panel opened from the
 * Extensions hub.
 *
 * The same panel surfaces in two scopes:
 *   - the **global Extensions-hub launch** — cross-project; {@link ModuleHost.getScopedProjectId}
 *     returns `null`.
 *   - the **per-project tab** — bound to one project; core mounts the panel with
 *     a host whose {@link ModuleHost.getScopedProjectId} returns THAT project's
 *     id (and {@link ModuleHost.getActiveProject} is that project).
 *
 * A project-aware panel reads `getScopedProjectId()` to decide whether to filter
 * its data to a single project. Reading it is OPT-IN: a panel that ignores it
 * renders identically in both surfaces. So opting into a project tab needs no
 * panel change — and a panel that DOES filter gets a global view + a focused
 * per-project view from the one component.
 *
 * Core stays decoupled: it discovers this from the manifest and drives the tab
 * generically, never naming a concrete extension id in its tab logic.
 */
export interface ProjectTabContribution {
  /**
   * Tab label shown in the project tab strip / per-project rail. Defaults to the
   * module's {@link AppModule.title} when omitted.
   */
  label?: string;
  /**
   * Lucide icon name for the tab, resolved by core against `lucide-react`.
   * Defaults to the module's {@link AppModule.icon} when omitted.
   */
  icon?: string;
  /**
   * Ordering hint among project tabs. Core appends extension tabs AFTER its
   * built-in tabs; among extension tabs they sort ascending by `order` (default
   * 100), then by id for a stable tie-break. Keep small for "earlier".
   */
  order?: number;
  /**
   * Whether the extension ALSO exposes a global panel from the Extensions hub
   * (the default dual-surface behaviour). `true`/absent ⇒ the panel surfaces
   * BOTH globally (cross-project, scoped id `null`) and as a per-project tab.
   * `false` ⇒ project-tab ONLY: the panel is reachable solely from a project's
   * tab strip (scoped id always a project id).
   * Use `false` for inherently project-scoped data that has no meaningful
   * cross-project view. Core reads this generically — no extension id appears in
   * its placement logic (Rule 6).
   */
  global?: boolean;
}

/**
 * Declares a **framework-aware agent preset** an extension contributes to the
 * host's Advanced Quick-Agent launcher. When a user picks this preset, core
 * spawns a Claude session with the extension's {@link systemPrompt} injected via
 * `--append-system-prompt`, so the agent boots already understanding that
 * framework's concepts and capabilities (e.g. Zana's orchestration surface).
 *
 * DECOUPLING (engineering Rule 6 — core never names a concrete extension in
 * logic): the primer text, model, and label all live HERE, in the extension's
 * own manifest. Core discovers presets generically by scanning installed
 * manifests, and injects the primer through the SAME audited persona →
 * `--append-system-prompt` path any persona uses — never a bespoke per-framework
 * code path. main re-reads the primer from its own copy of the manifest at
 * launch (never trusting renderer-supplied text — Rule 1), keyed only by the
 * extension id the renderer passes.
 *
 * Absent ⇒ the extension contributes no launcher preset (the default).
 */
export interface AgentPreset {
  /**
   * Short label shown on the preset chip in the Advanced launcher. Defaults to
   * the module's {@link ExtensionManifest.title} when omitted.
   */
  label?: string;
  /** One-line description shown under the chip / as a tooltip. */
  description?: string;
  /**
   * Lucide icon name for the preset chip, resolved by core against
   * `lucide-react`. Defaults to the module's {@link ExtensionManifest.icon}.
   */
  icon?: string;
  /**
   * The framework primer. Injected verbatim as `--append-system-prompt` so the
   * spawned agent understands this framework's concepts, tools, and
   * conventions. REQUIRED — a preset with no primer is dropped at discovery
   * (it would be indistinguishable from a bare launch).
   */
  systemPrompt: string;
  /**
   * Optional opening prompt written to the session after spawn (claude-family
   * only), e.g. "You're now in the Zana cockpit — run /zana:status to orient."
   * Mirrors {@link Persona.initialPrompt}.
   */
  initialPrompt?: string;
  /** Model hint → `--model`. Same domain as a persona's model. */
  model?: 'opus' | 'sonnet' | 'haiku' | 'default';
  /**
   * Which base profile the preset launches on (`claude` or `claude-yolo`).
   * Defaults to `claude`. `shell`/`claude-resume` are ignored (a framework
   * primer only makes sense on a fresh claude session).
   */
  baseProfile?: 'claude' | 'claude-yolo';
}

/**
 * Identity helper for an extension's renderer declaration. Gives editors full
 * type inference at the definition site and acts as a forward-compat seam if
 * the contract gains required fields later.
 */
export function defineModule(m: AppModule): AppModule {
  return m;
}

/** Identity helper for an extension's main-process declaration. */
export function defineMainModule(m: MainModule): MainModule {
  return m;
}

/**
 * Check an extension manifest's `engines.zccApi` range against the host's
 * contract version. The host calls this at load and refuses to mount on a
 * mismatch. Deliberately **no semver dependency** — the parser is a small
 * hand-rolled subset covering both the host-facing integer-comparator grammar
 * and the semver-ish forms extension authors naturally write.
 *
 * Two token grammars are accepted (intermixable across space-separated tokens,
 * all of which must hold — logical AND):
 *
 *   1. Integer comparators: `>=N`, `<=N`, `>N`, `<N`, `=N`, or a bare `N`
 *      (treated as `=N`). `N` is a non-negative integer (the contract version
 *      is an integer, not SemVer).
 *   2. Semver-ish "major pin" forms — `^1.0.0`, `~1.2.0`, `1.x`, `1.2.x`,
 *      `1`, `1.2`, `1.2.3`. Because the contract version is a single integer,
 *      every one of these is interpreted as "major version === leading
 *      number". So `^1.0.0`, `~1.2`, `1.x`, and `1.2.3` all mean "major 1" and
 *      are satisfied when `current === 1`.
 *
 * Empty/whitespace-only ranges accept anything → `true`. Any token that
 * matches neither grammar fails closed → `false`.
 *
 * @param manifestRange the `engines.zccApi` string (e.g. `">=1 <2"`, `"^1.0.0"`, `"1.x"`).
 * @param current the host contract version; defaults to {@link SDK_API_VERSION}.
 * @returns `true` when `current` satisfies every comparator in the range.
 *
 * @example
 * checkApiCompat('>=1 <2', 1); // true
 * checkApiCompat('>=1 <2', 2); // false
 * checkApiCompat('^1.0.0', 1); // true  (caret → major 1)
 * checkApiCompat('^1.0.0', 2); // false
 * checkApiCompat('~1.2', 1);   // true  (tilde → major 1)
 * checkApiCompat('1.x', 1);    // true
 * checkApiCompat('1', 1);      // true  (bare N === =N)
 * checkApiCompat('>=2');       // false when SDK_API_VERSION === 1
 */
export function checkApiCompat(manifestRange: string, current: number = SDK_API_VERSION): boolean {
  const tokens = manifestRange.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true; // no constraint → accept

  for (const token of tokens) {
    if (!tokenSatisfied(token, current)) return false;
  }
  return true;
}

/**
 * Compare two SemVer-ish version strings. No semver dependency — a small
 * hand-rolled parser matching the project's no-extra-deps habit (see
 * {@link checkApiCompat}). Compares the dotted numeric core (`major.minor.patch`,
 * missing segments → 0); any pre-release/build suffix after `-`/`+` is ignored.
 * A non-numeric or empty version parses as `0.0.0`, so a missing manifest
 * `version` sorts below any real release.
 *
 * @returns negative if `a < b`, 0 if equal, positive if `a > b`.
 * @example compareVersions('0.2.0', '0.1.9') // > 0
 * @example compareVersions('1.0', '1.0.0')   // 0
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): number[] => {
    const core = String(v ?? '').trim().split(/[-+]/)[0];
    const parts = core.split('.').map((s) => {
      const n = Number(s);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    });
    while (parts.length < 3) parts.push(0);
    return parts.slice(0, 3);
  };
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

/**
 * One downloadable release of an extension, as listed in a remote registry
 * index (P4 — remote update channel). The host downloads `url`, verifies its
 * bytes against `sha256` (and, when present, the detached `signature`), and
 * only then stages it into `~/.zcc/extensions/<id>`.
 */
export interface RegistryRelease {
  /** Extension id (matches the manifest `id` / install dir name). */
  id: string;
  /** SemVer of this release (compared via {@link compareVersions}). */
  version: string;
   /** Host-contract range this release needs (gated by {@link checkApiCompat}). */
   zccApi: string;
   /** Absolute URL of the release archive (the host's JSON file archive). */
  url: string;
  /** Lowercase hex sha256 of the archive bytes — integrity gate (required). */
  sha256: string;
  /**
   * Base64 detached signature of the archive bytes, verified against the host's
   * pinned public key when both are present. Optional during rollout; a host
   * MAY require it (reject unsigned) via policy.
   */
  signature?: string;
  /** Declared permissions of this release — used to detect a consent-widening. */
  permissions?: ExtensionPermission[];
  // --- Optional catalog metadata for the marketplace browse view. Purely
  // additive: the index schema stays `1`, `fetchRegistryIndex` validation and
  // `pickBestRelease` ignore these, so an older host reads them as undefined.
  // A publish tool populates them from the source manifest so a not-yet-installed
  // extension can be shown with a name/blurb before any code is downloaded.
  /** Display name; falls back to `id` when absent. */
  title?: string;
  /** One-line summary shown in the browse list. */
  description?: string;
  /** Author / publisher attribution. */
  author?: string;
  /** Lucide icon name, resolved renderer-side (same convention as the manifest). */
  icon?: string;
}

/**
 * The remote registry index: a map of extension id → its available releases.
 * Fetched as JSON from a configured registry URL. The host picks, per id, the
 * highest {@link compareVersions} release whose `zccApi` satisfies the host.
 */
export interface RegistryIndex {
  /** Index schema version, for forward-compat. */
  schema: 1;
  releases: RegistryRelease[];
}

/**
 * Select the best installable release for one id from a registry index: the
 * highest-version release that (a) matches `id` and (b) is API-compatible with
 * this host. Returns null when nothing qualifies. Pure — no I/O.
 */
export function pickBestRelease(
  index: RegistryIndex,
  id: string,
  current: number = SDK_API_VERSION
): RegistryRelease | null {
  let best: RegistryRelease | null = null;
  for (const r of index.releases) {
    if (r.id !== id) continue;
    if (!checkApiCompat(r.zccApi, current)) continue;
    if (!best || compareVersions(r.version, best.version) > 0) best = r;
  }
  return best;
}

/** Evaluate one range token against `current`. Fails closed on unparseable input. */
function tokenSatisfied(token: string, current: number): boolean {
  // Semver-ish "major pin" forms: `^1.0.0`, `~1.2.0`, `1.x`, `1.2.x`, `1.2.3`,
  // `1.2`, `1`. Any leading `^`/`~`, plus a dotted version where the segment(s)
  // after the major may be numbers or an `x`/`X` wildcard. The contract version
  // is a single integer, so all of these collapse to "major === current".
  const semverish = /^[\^~]?(\d+)(?:\.(?:\d+|[xX*]))*$/.exec(token);
  if (semverish) {
    // Disambiguate from the integer-comparator grammar: a bare `N` with no
    // caret/tilde/dot is handled identically below (`=N`), so it doesn't matter
    // which branch claims it. Here we only own tokens that are unmistakably
    // semver-ish (have a `^`/`~` or a `.`), or a bare integer.
    return current === Number(semverish[1]);
  }

  // Integer comparators: `>=N`, `<=N`, `>N`, `<N`, `=N`, bare `N` — and their
  // dotted-version spellings (`>=1.0.0`, `<2.0.0`), the most natural npm-style
  // form an author writes. The contract version is a single integer, so the
  // dotted tail is ignored and the comparison is by MAJOR (`cmp[2]`), matching
  // how the semver-ish branch above already collapses `^1.0.0` → major 1.
  // Without the `(?:\.\d+)*` tail a `>=1.0.0` range matches NEITHER grammar and
  // fails closed, silently refusing to mount a compatible extension.
  const cmp = /^(>=|<=|>|<|=)?(\d+)(?:\.\d+)*$/.exec(token);
  if (cmp) {
    const op = cmp[1] ?? '=';
    const n = Number(cmp[2]);
    return (
      op === '>=' ? current >= n :
      op === '<=' ? current <= n :
      op === '>'  ? current > n :
      op === '<'  ? current < n :
      current === n // '=' or bare N
    );
  }

  return false; // unparseable → fail closed
}

export type {
  AppModule,
  ModuleHost,
  RendererEntry,
  ActivateResult,
  HostEvents,
  SessionInfo,
  ProjectInfo,
  ExtensionCommand,
  // Host UX primitive option/item types (W1-5).
  ConfirmOptions,
  PromptOptions,
  QuickPickItem,
  QuickPickOptions,
  NotifyAction,
  NotifyOptions,
  ProgressOptions,
  MainModule,
  MainModuleContext,
  ProjectRootResolution,
};
