/**
 * Runtime-extension discovery + enabled-map, scanning
 * `~/.zcc/extensions/<id>/extension.json`. Deliberately electron-free so
 * vitest can import it directly (no `app`/`shell` mock needed) — the Finder
 * `reveal` and the moduleHost wiring live in the loader / index.ts side.
 *
 * Mirrors the defensive habits of `plugin-fs.ts` + `plugins.ts`:
 *   - lazy dir resolution with an ENV OVERRIDE (`ZCC_EXTENSIONS_DIR`) so tests
 *     point it at a temp dir without caring about import order;
 *   - `existsSync` guards everywhere;
 *   - a bad/missing/malformed manifest is logged + skipped, never thrown;
 *   - an enabled-map that defaults to enabled-unless-explicitly-false
 *     (same `readEnabledMap` / `setExtensionEnabled` shape as plugins).
 */

import { existsSync } from 'node:fs';
import { readFile, readdir, rename, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { isWithin, resolveContained, resolveContainedReal } from '@zana-ai/zcc-path-confine';
import { readConsentMap, consentStateFor, type ConsentMap } from './consent.js';
import {
  checkApiCompat,
  isExtensionPermission,
  type ExtensionManifest,
  type ExtensionPermission
} from '@zana-ai/zcc-extension-sdk';
import type {
  ExtensionEntry,
  ExtensionLoadError,
  ExtensionManifestView,
  Result
} from '@zana-ai/zcc-domain/product';

/**
 * Tests inject a fake extensions dir via `ZCC_EXTENSIONS_DIR`. Resolution is
 * lazy (re-read on each call), so import order doesn't matter — beforeEach can
 * set the env after the module loads. Falls back to `~/.zcc/extensions`.
 */
export function getExtensionsDir(): string {
  const override = process.env.ZCC_EXTENSIONS_DIR;
  if (override) return override;
  return join(homedir(), '.zcc', 'extensions');
}

function getEnabledFile(): string {
  return join(getExtensionsDir(), 'enabled.json');
}

/**
 * The local-authored registry file. Sits BESIDE the extension dirs (never inside
 * one) so it's a private main-owned record, not part of any extension's packaged
 * bytes — a `local` extension the user later publishes carries none of this. Shape:
 * `{ "<id>": { "workingDir": "<abs path under the scratch workspace>" } }`.
 */
function getLocalFile(): string {
  return join(getExtensionsDir(), 'local.json');
}

/** Manifest file name inside each extension dir. */
const MANIFEST_NAME = 'extension.json';

/**
 * Built-in module ids a disk extension may NOT claim (isolation finding B).
 *
 * The SDK contract says `manifest.id` IS the module's namespace — it keys
 * consent, brokered-capability auth, and storage. The runtime moduleId, though,
 * is the on-disk DIRECTORY NAME. Two gaps follow if id and dir name are allowed
 * to diverge:
 *   1. a disk ext whose `id` equals a built-in's (e.g. `zana`) would SHADOW the
 *      trusted in-process module on the consent/storage/permission key path;
 *   2. renaming a consented ext's folder silently detaches it from its consent
 *      + storage records (those are keyed by the old name), re-prompting and
 *      orphaning data.
 * So discovery rejects (skip + log, like any invalid manifest) an ext whose
 * `id !== <dirName>` OR whose id collides with a reserved built-in.
 *
 * SOURCING THE BUILT-IN SET WITHOUT EDITING index.ts: the authoritative source
 * is `MAIN_MODULES.map(m => m.id)` in `src/main/modules/index.ts`, consumed by
 * index.ts as `builtinIds`. discovery.ts is deliberately electron-free and must
 * not import the module registry (it drags in electron-coupled module code),
 * and the ticket forbids editing index.ts to thread the set down. So callers
 * MAY pass their own reserved set (index.ts already owns `builtinIds` and can
 * forward it as the `reservedIds` arg), and absent that we fall back to this
 * documented constant.
 *
 * This constant is only a FALLBACK: the authoritative caller (host.ts) forwards
 * its live `builtinIds` (= `MAIN_MODULES.map(m => m.id)`) as `reservedIds`, so
 * the real reserved set always tracks `MAIN_MODULES`. Keep this list in lockstep
 * with `MAIN_MODULES` ids anyway, for callers that don't pass `reservedIds`.
 *
 * `MAIN_MODULES` is currently empty — first-party plugins load at runtime
 * (docs auto-installs from `plugins/docs`). Nothing is reserved here.
 */
export const RESERVED_BUILTIN_IDS: readonly string[] = [];

/** A discovered extension dir paired with its load outcome. */
export interface DiscoveredExtension extends ExtensionEntry {
  /** Resolved absolute path to the main entry, when present + loadable. */
  mainEntryPath?: string;
}

type LogFn = (message: string, err?: unknown) => void;

/** No-op logger default so the scanner works without wiring. */
const noopLog: LogFn = () => {};

/** Internal directory names that never hold an extension. */
function isInternalName(n: string): boolean {
  return (
    n === 'enabled.json' ||
    n.startsWith('.') ||
    n.startsWith('temp_') ||
    n.endsWith('.disabled')
  );
}

/** Best-effort directory listing of subdirectories. */
async function listDirs(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

/** Read the `enabled.json` map. Shape: `{ "<id>": boolean }`. Missing → {}. */
async function readEnabledMap(): Promise<Record<string, boolean>> {
  const file = getEnabledFile();
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(await readFile(file, 'utf-8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'boolean') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/** One entry in the local-authored registry. */
export interface LocalExtensionRecord {
  /** Absolute path to the source project the Creator agent builds in. */
  workingDir: string;
}

/**
 * Read the `local.json` map. Shape: `{ "<id>": { workingDir } }`. Missing → {}.
 * Malformed entries (non-object, missing/empty `workingDir`) are dropped, never
 * thrown — same defensive posture as {@link readEnabledMap}.
 */
async function readLocalMap(): Promise<Record<string, LocalExtensionRecord>> {
  const file = getLocalFile();
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(await readFile(file, 'utf-8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, LocalExtensionRecord> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
      const workingDir = (v as Record<string, unknown>).workingDir;
      if (typeof workingDir === 'string' && workingDir) out[k] = { workingDir };
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Read one local record by id (or null). Used by the reinstall/reload path to
 * RE-DERIVE the working dir from main's own record — never from renderer/agent
 * free-text (Rule 1). Exported for the IPC handlers in index.ts.
 */
export async function getLocalRecord(id: string): Promise<LocalExtensionRecord | null> {
  const map = await readLocalMap();
  return map[id] ?? null;
}

/**
 * Reverse lookup: find the local-authored extension whose `workingDir` contains
 * `cwd` (the session's OWN live pty cwd, from `ptys.getSession`) — never an
 * agent-supplied id. This is what lets the `install_local_extension` MCP tool
 * derive "which extension" with zero agent-supplied identity: the Creator
 * agent's session is always launched with its cwd set to that extension's
 * working dir (see `CreateExtensionDialog`), so a session can only ever resolve
 * to the ONE extension it was actually opened to build (Rule 1/2).
 */
export async function findLocalRecordByCwd(
  cwd: string
): Promise<{ id: string; record: LocalExtensionRecord } | null> {
  const map = await readLocalMap();
  for (const [id, record] of Object.entries(map)) {
    if (isWithin(cwd, record.workingDir)) return { id, record };
  }
  return null;
}

/**
 * Record `id` as a local-authored extension pointing at `workingDir`. Idempotent
 * overwrite. Atomic temp+rename write, mirroring {@link setExtensionEnabled}.
 * `workingDir` is stored verbatim (the caller — main — has already confined it to
 * the scratch workspace; this function is a dumb persistence seam).
 */
export async function markLocal(id: string, workingDir: string): Promise<Result<true>> {
  if (!id) return { ok: false, code: 'BAD_ID', message: 'Missing extension id' };
  if (!workingDir) return { ok: false, code: 'BAD_DIR', message: 'Missing working dir' };
  const root = getExtensionsDir();
  const file = getLocalFile();
  const map = await readLocalMap();
  map[id] = { workingDir };
  try {
    await mkdir(root, { recursive: true });
    await atomicWrite(file, JSON.stringify(map, null, 2) + '\n');
    return { ok: true, value: true };
  } catch (err) {
    return {
      ok: false,
      code: 'WRITE_FAILED',
      message: err instanceof Error ? err.message : String(err)
    };
  }
}

/**
 * Drop `id` from the local registry (on uninstall). No-op success when absent or
 * the file doesn't exist. Writes `{}` rather than deleting the file so the map
 * round-trips deterministically (same choice as {@link setExtensionEnabled}).
 */
export async function clearLocal(id: string): Promise<Result<true>> {
  if (!id) return { ok: false, code: 'BAD_ID', message: 'Missing extension id' };
  const file = getLocalFile();
  if (!existsSync(file)) return { ok: true, value: true };
  const map = await readLocalMap();
  if (!(id in map)) return { ok: true, value: true };
  delete map[id];
  try {
    await mkdir(getExtensionsDir(), { recursive: true });
    await atomicWrite(file, JSON.stringify(map, null, 2) + '\n');
    return { ok: true, value: true };
  } catch (err) {
    return {
      ok: false,
      code: 'WRITE_FAILED',
      message: err instanceof Error ? err.message : String(err)
    };
  }
}

/**
 * The git-provenance registry file. Like `local.json`, sits BESIDE the extension
 * dirs (never inside one) so it's a private main-owned record — a published
 * extension carries none of it. Shape:
 * `{ "<id>": { "url", "ref"?, "sha"?, "installedAt"? } }`, `url` credential-
 * stripped. Discovery reads it to stamp `source:'git'` + `remoteOrigin`; the
 * reinstall path re-derives `{url, ref}` from it (Rule 1, never renderer text).
 */
function getGitFile(): string {
  return join(getExtensionsDir(), 'git.json');
}

/** One entry in the git-provenance registry. */
export interface GitExtensionRecord {
  /** Credential-stripped clone url the extension came from. */
  url: string;
  /** Branch/tag/SHA that was requested, if any. */
  ref?: string;
  /** The commit SHA actually checked out at install time, if resolved. */
  sha?: string;
  /** ISO timestamp of the (most recent) install/update. */
  installedAt?: string;
}

/**
 * Read the `git.json` map. Malformed entries (non-object, missing/empty `url`)
 * are dropped, never thrown — same defensive posture as {@link readLocalMap}.
 */
async function readGitMap(): Promise<Record<string, GitExtensionRecord>> {
  const file = getGitFile();
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(await readFile(file, 'utf-8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, GitExtensionRecord> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
      const rec = v as Record<string, unknown>;
      const url = rec.url;
      if (typeof url !== 'string' || !url) continue;
      out[k] = {
        url,
        ...(typeof rec.ref === 'string' && rec.ref ? { ref: rec.ref } : {}),
        ...(typeof rec.sha === 'string' && rec.sha ? { sha: rec.sha } : {}),
        ...(typeof rec.installedAt === 'string' && rec.installedAt
          ? { installedAt: rec.installedAt }
          : {})
      };
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Read one git record by id (or null). The reinstall/update path re-derives
 * `{url, ref}` from this — never from renderer/agent free-text (Rule 1).
 */
export async function getGitRecord(id: string): Promise<GitExtensionRecord | null> {
  const map = await readGitMap();
  return map[id] ?? null;
}

/**
 * Serialize `git.json` read-modify-write. Per-write atomicity (temp+rename)
 * alone does NOT satisfy Rule 4's serialization half across the multi-minute
 * clone window: two overlapping git installs each read the map, then each
 * rename their own copy, and the second silently drops the first's entry. This
 * in-process mutex chains every mutation so the read always sees the prior
 * write. (Mirrors the inbox-store write-queue pattern.)
 */
let gitWriteChain: Promise<unknown> = Promise.resolve();
function withGitLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = gitWriteChain.then(fn, fn);
  // Keep the chain alive regardless of this op's outcome.
  gitWriteChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/**
 * Record (or update) `id`'s git provenance. Mutex-guarded RMW (see
 * {@link withGitLock}). `url` MUST already be credential-stripped by the caller.
 * Idempotent overwrite — the update-from-repo path calls this again to refresh
 * `sha`/`installedAt`.
 */
export async function markGit(id: string, rec: GitExtensionRecord): Promise<Result<true>> {
  if (!id) return { ok: false, code: 'BAD_ID', message: 'Missing extension id' };
  if (!rec?.url) return { ok: false, code: 'BAD_INPUT', message: 'Missing git url' };
  return withGitLock(async () => {
    const root = getExtensionsDir();
    const file = getGitFile();
    const map = await readGitMap();
    map[id] = {
      url: rec.url,
      ...(rec.ref ? { ref: rec.ref } : {}),
      ...(rec.sha ? { sha: rec.sha } : {}),
      ...(rec.installedAt ? { installedAt: rec.installedAt } : {})
    };
    try {
      await mkdir(root, { recursive: true });
      await atomicWrite(file, JSON.stringify(map, null, 2) + '\n');
      return { ok: true, value: true } as Result<true>;
    } catch (err) {
      return {
        ok: false,
        code: 'WRITE_FAILED',
        message: err instanceof Error ? err.message : String(err)
      } as Result<true>;
    }
  });
}

/** Drop `id` from the git registry (on uninstall). Mutex-guarded; no-op success
 *  when absent. Twin of {@link clearLocal}. */
export async function clearGit(id: string): Promise<Result<true>> {
  if (!id) return { ok: false, code: 'BAD_ID', message: 'Missing extension id' };
  return withGitLock(async () => {
    const file = getGitFile();
    if (!existsSync(file)) return { ok: true, value: true } as Result<true>;
    const map = await readGitMap();
    if (!(id in map)) return { ok: true, value: true } as Result<true>;
    delete map[id];
    try {
      await mkdir(getExtensionsDir(), { recursive: true });
      await atomicWrite(file, JSON.stringify(map, null, 2) + '\n');
      return { ok: true, value: true } as Result<true>;
    } catch (err) {
      return {
        ok: false,
        code: 'WRITE_FAILED',
        message: err instanceof Error ? err.message : String(err)
      } as Result<true>;
    }
  });
}

/**
 * Validate the raw parsed manifest into the shape we surface. Returns null when
 * required fields (`id`, `title`, `icon`, `engines.zccApi`, `entry`) are
 * missing or the wrong type. `entry.renderer` / `entry.main` are both optional.
 */
function validateManifest(raw: unknown): ExtensionManifest | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const m = raw as Record<string, unknown>;
  if (typeof m.id !== 'string' || !m.id) return null;
  if (typeof m.title !== 'string' || !m.title) return null;
  if (typeof m.icon !== 'string' || !m.icon) return null;
  if (!m.engines || typeof m.engines !== 'object') return null;
  const engines = m.engines as Record<string, unknown>;
  const apiRange =
    typeof engines.zccApi === 'string' && engines.zccApi ? engines.zccApi : null;
  if (!apiRange) return null;
  if (!m.entry || typeof m.entry !== 'object') return null;
  const entry = m.entry as Record<string, unknown>;
  const renderer = entry.renderer;
  const main = entry.main;
  if (renderer !== undefined && typeof renderer !== 'string') return null;
  if (main !== undefined && typeof main !== 'string') return null;
  // A useless extension declares neither entry — skip it.
  if (renderer === undefined && main === undefined) return null;

  const titleLabel = typeof m.titleLabel === 'string' ? m.titleLabel : undefined;
  // Optional release version (SemVer). A non-string/absent value is left
  // undefined; consumers treat that as 0.0.0 (sorts below any real release).
  const version = typeof m.version === 'string' && m.version ? m.version : undefined;
  const build = parseBuild(m.build);
  const permissions = Array.isArray(m.permissions)
    ? (m.permissions.filter((p) => typeof p === 'string') as ExtensionManifest['permissions'])
    : undefined;
  const permissionScopes = parsePermissionScopes(m.permissionScopes);
  const projectTab = parseProjectTab(m.projectTab);
  const agentPreset = parseAgentPreset(m.agentPreset);
  const skills = parseSkillContributions(m.skills);
  const mcpServers = parseMcpServerContributions(m.mcpServers);

  return {
    id: m.id,
    version,
    build,
    title: m.title,
    icon: m.icon,
    titleLabel,
    entry: {
      renderer: typeof renderer === 'string' ? renderer : undefined,
      main: typeof main === 'string' ? main : undefined
    },
    engines: { zccApi: apiRange },
    permissions,
    permissionScopes,
    projectTab,
    agentPreset,
    skills,
    mcpServers
  } satisfies ExtensionManifest;
}

/**
 * Parse the optional `skills` block (see SDK `ExtensionSkillContribution`).
 * Purely structural here (no fs access, no `dir` in scope at this call site) —
 * mirrors `entry.main`/`entry.renderer`: a bad/escaping `path` is caught later,
 * at the actual point of use, by `resolveContainedReal` against the extension's
 * real dir (deploySkillsForExtension). A malformed individual entry is dropped,
 * never lets one bad entry drop the whole array.
 */
function parseSkillContributions(raw: unknown): ExtensionManifest['skills'] {
  if (!Array.isArray(raw)) return undefined;
  const out: NonNullable<ExtensionManifest['skills']> = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    const path = typeof e.path === 'string' && e.path ? e.path : undefined;
    if (!path) continue;
    const slug = typeof e.slug === 'string' && e.slug ? e.slug : undefined;
    out.push({ path, slug });
  }
  return out.length ? out : undefined;
}

/**
 * Parse the optional `mcpServers` block (see SDK `ExtensionMcpServerContribution`).
 * `command` is left as-is here (structural parse only); the basename-only guard
 * — the same one `execAllowlist` enforces — is applied at the point of use
 * (rebuildExtensionServers), consistent with how `path` confinement for skills
 * defers to its point of use. A malformed individual entry is dropped, never
 * drops the whole array.
 */
function parseMcpServerContributions(raw: unknown): ExtensionManifest['mcpServers'] {
  if (!Array.isArray(raw)) return undefined;
  const out: NonNullable<ExtensionManifest['mcpServers']> = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    const name = typeof e.name === 'string' && e.name ? e.name : undefined;
    const type =
      e.type === 'stdio' || e.type === 'streamable-http' || e.type === 'sse' ? e.type : undefined;
    if (!name || !type) continue;
    const command = typeof e.command === 'string' && e.command ? e.command : undefined;
    const url = typeof e.url === 'string' && e.url ? e.url : undefined;
    // stdio requires a command; non-stdio requires a url. A definition
    // satisfying neither is meaningless — drop it (same "primer-less preset is
    // dropped" discipline as parseAgentPreset).
    if (type === 'stdio' && !command) continue;
    if (type !== 'stdio' && !url) continue;
    const args = Array.isArray(e.args)
      ? e.args.filter((a): a is string => typeof a === 'string')
      : undefined;
    const env =
      e.env && typeof e.env === 'object' && !Array.isArray(e.env)
        ? Object.fromEntries(
            Object.entries(e.env as Record<string, unknown>).filter(
              (pair): pair is [string, string] => typeof pair[1] === 'string'
            )
          )
        : undefined;
    const alwaysOn = typeof e.alwaysOn === 'boolean' ? e.alwaysOn : undefined;
    out.push({ name, type, command, args, url, env, alwaysOn });
  }
  return out.length ? out : undefined;
}

/**
 * Parse the optional `projectTab` opt-in (placement only — see
 * {@link ProjectTabContribution}). An object presence is enough to opt in; its
 * fields are sanitized (a malformed field is dropped, not trusted). A
 * non-object value yields `undefined` (no project tab). A project tab is only
 * meaningful with a renderer entry, but that pairing is enforced renderer-side
 * (the loader only carries `projectTab` onto a renderer-bearing module) — keep
 * this parser purely structural.
 */
function parseProjectTab(raw: unknown): ExtensionManifest['projectTab'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const p = raw as Record<string, unknown>;
  const label = typeof p.label === 'string' && p.label ? p.label : undefined;
  const icon = typeof p.icon === 'string' && p.icon ? p.icon : undefined;
  const order = typeof p.order === 'number' && Number.isFinite(p.order) ? p.order : undefined;
  // `global` opts the extension OUT of its global Extensions-hub launch
  // (project-tab only) when explicitly false; absent/true keeps dual surface.
  const global = typeof p.global === 'boolean' ? p.global : undefined;
  return { label, icon, order, global };
}

/**
 * Parse + sanitize the optional `agentPreset` block — a framework-aware Quick
 * Agent preset (see SDK `AgentPreset`). `systemPrompt` is the load-bearing field
 * (the primer core injects via `--append-system-prompt`); a preset without a
 * non-empty string primer is dropped (returns `undefined`), so a malformed block
 * never yields a preset that does nothing. Every other field is optional and
 * sanitized structurally — a bad field is dropped, never trusted. `model` and
 * `baseProfile` are narrowed to their enums so a typo can't smuggle an arbitrary
 * value into the persona/launch layer downstream.
 */
function parseAgentPreset(raw: unknown): ExtensionManifest['agentPreset'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const p = raw as Record<string, unknown>;
  const systemPrompt =
    typeof p.systemPrompt === 'string' && p.systemPrompt.trim() ? p.systemPrompt : undefined;
  if (!systemPrompt) return undefined; // a primer-less preset is meaningless
  const label = typeof p.label === 'string' && p.label ? p.label : undefined;
  const description =
    typeof p.description === 'string' && p.description ? p.description : undefined;
  const icon = typeof p.icon === 'string' && p.icon ? p.icon : undefined;
  const initialPrompt =
    typeof p.initialPrompt === 'string' && p.initialPrompt ? p.initialPrompt : undefined;
  const model =
    p.model === 'opus' || p.model === 'sonnet' || p.model === 'haiku' || p.model === 'default'
      ? p.model
      : undefined;
  const baseProfile =
    p.baseProfile === 'claude' || p.baseProfile === 'claude-yolo' ? p.baseProfile : undefined;
  return { label, description, icon, systemPrompt, initialPrompt, model, baseProfile };
}

/** Parse the optional `build` provenance block (stamped at package time). */
function parseBuild(raw: unknown): ExtensionManifest['build'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const b = raw as Record<string, unknown>;
  const sha = typeof b.sha === 'string' ? b.sha : undefined;
  const at = typeof b.at === 'string' ? b.at : undefined;
  if (!sha && !at) return undefined;
  return { sha, at };
}

/** Parse + sanitize the optional `permissionScopes` block (string[] fields only). */
function parsePermissionScopes(raw: unknown): ExtensionManifest['permissionScopes'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const s = raw as Record<string, unknown>;
  const strArray = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x) : undefined;
  const execAllowlist = strArray(s.execAllowlist);
  const fsRoots = strArray(s.fsRoots);
  const egressAllowlist = strArray(s.egressAllowlist);
  const mcpAllowlist = strArray(s.mcpAllowlist);
  const streamAllowlist = strArray(s.streamAllowlist);
  const extensionInstallAllowlist = strArray(s.extensionInstallAllowlist);
  if (!execAllowlist && !fsRoots && !egressAllowlist && !mcpAllowlist && !streamAllowlist && !extensionInstallAllowlist)
    return undefined;
  return { execAllowlist, fsRoots, egressAllowlist, mcpAllowlist, streamAllowlist, extensionInstallAllowlist };
}

/** Project an SDK manifest down to the renderer-safe view in shared/types. */
function toManifestView(m: ExtensionManifest): ExtensionManifestView {
  return {
    id: m.id,
    version: m.version,
    build: m.build ? { sha: m.build.sha, at: m.build.at } : undefined,
    title: m.title,
    icon: m.icon,
    titleLabel: m.titleLabel,
    entry: { renderer: m.entry.renderer, main: m.entry.main },
    engines: { zccApi: m.engines.zccApi },
    permissions: m.permissions ? [...m.permissions] : undefined,
    permissionScopes: m.permissionScopes
      ? {
          execAllowlist: m.permissionScopes.execAllowlist
            ? [...m.permissionScopes.execAllowlist]
            : undefined,
          fsRoots: m.permissionScopes.fsRoots ? [...m.permissionScopes.fsRoots] : undefined,
          egressAllowlist: m.permissionScopes.egressAllowlist
            ? [...m.permissionScopes.egressAllowlist]
            : undefined,
          mcpAllowlist: m.permissionScopes.mcpAllowlist
            ? [...m.permissionScopes.mcpAllowlist]
            : undefined,
          streamAllowlist: m.permissionScopes.streamAllowlist
            ? [...m.permissionScopes.streamAllowlist]
            : undefined,
          extensionInstallAllowlist: m.permissionScopes.extensionInstallAllowlist
            ? [...m.permissionScopes.extensionInstallAllowlist]
            : undefined
        }
      : undefined,
    projectTab: m.projectTab
      ? {
          label: m.projectTab.label,
          icon: m.projectTab.icon,
          order: m.projectTab.order,
          global: m.projectTab.global
        }
      : undefined,
    // The framework preset is renderer-safe: it's what the Advanced launcher
    // renders (label/description/icon) and picks by id. main re-reads the primer
    // from THIS same view at launch to build the synthetic persona, so the
    // renderer never has to carry the (potentially large) systemPrompt back.
    agentPreset: m.agentPreset
      ? {
          label: m.agentPreset.label,
          description: m.agentPreset.description,
          icon: m.agentPreset.icon,
          systemPrompt: m.agentPreset.systemPrompt,
          initialPrompt: m.agentPreset.initialPrompt,
          model: m.agentPreset.model,
          baseProfile: m.agentPreset.baseProfile
        }
      : undefined,
    skills: m.skills?.map((s) => ({ path: s.path, slug: s.slug })),
    // `env` VALUES never cross into the renderer view (may carry secrets) —
    // only the key names, so the consent screen can name what's declared
    // without leaking a token. See `ExtensionMcpServerContributionView`.
    mcpServers: m.mcpServers?.map((s) => ({
      name: s.name,
      type: s.type,
      command: s.command,
      args: s.args ? [...s.args] : undefined,
      url: s.url,
      envKeys: s.env ? Object.keys(s.env) : undefined,
      alwaysOn: s.alwaysOn
    }))
  };
}

/**
 * Scan the extensions dir and return one entry per `<id>` directory. Each entry
 * carries its parsed manifest (or null + an `error` reason), its enabled state,
 * and — for enabled, version-compatible extensions declaring a main entry — the
 * resolved absolute `mainEntryPath` the loader will import.
 *
 * `loaded` here reflects *discovery* success (valid + compatible + enabled). The
 * loader flips it to false and stamps `main-load-failed` if the main import
 * throws later.
 *
 * Never throws: a bad manifest is logged + skipped.
 */
export async function discoverExtensions(
  log: LogFn = noopLog,
  reservedIds: ReadonlySet<string> = new Set(RESERVED_BUILTIN_IDS)
): Promise<DiscoveredExtension[]> {
  const root = getExtensionsDir();
  if (!existsSync(root)) return [];

  const [dirs, enabledMap, consentMap, localMap, gitMap] = await Promise.all([
    listDirs(root),
    readEnabledMap(),
    readConsentMap(),
    readLocalMap(),
    readGitMap()
  ]);
  // The loop builds entries WITHOUT the consent fields; a single post-loop pass
  // stamps `consented`/`needsConsent` from `consentMap` so there's one place
  // that owns the consent decision (and the per-error literals stay terse).
  const out: RawDiscovered[] = [];

  for (const name of dirs) {
    if (isInternalName(name)) continue;
    const dir = join(root, name);
    const manifestPath = join(dir, MANIFEST_NAME);

    let manifest: ExtensionManifest | null = null;
    let error: ExtensionLoadError | undefined;

    if (!existsSync(manifestPath)) {
      log(`extension ${name}: missing ${MANIFEST_NAME} — skipping`);
      error = 'bad-manifest';
    } else {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readFile(manifestPath, 'utf-8'));
      } catch (err) {
        log(`extension ${name}: unparseable ${MANIFEST_NAME} — skipping`, err);
        out.push(badEntry(name, dir));
        continue;
      }
      manifest = validateManifest(parsed);
      if (!manifest) {
        log(`extension ${name}: invalid manifest shape — skipping`);
        error = 'bad-manifest';
      }
    }

    // Enabled defaults to true unless explicitly disabled in enabled.json.
    const enabled = enabledMap[name] !== false;

    if (!manifest) {
      out.push({
        id: name,
        path: dir,
        manifest: null,
        enabled,
        loaded: false,
        mainActive: false,
        error
      });
      continue;
    }

    // Namespace reconciliation (isolation finding B). manifest.id is the SDK
    // namespace (keys consent/storage/broker-auth), but the runtime moduleId is
    // the on-disk dir name. Reject the divergence cases — handled like any other
    // invalid manifest (skip + log + bad-manifest), with manifest:null so the
    // entry can't become a run candidate or carry a consent decision.
    //   a) id collides with a reserved built-in → would shadow a trusted module;
    //   b) id !== dir name → folder rename detaches consent/storage, and the
    //      directory name (not the claimed id) is what the rest of the pipeline
    //      actually uses as the moduleId.
    if (reservedIds.has(manifest.id)) {
      log(
        `extension ${name}: manifest id "${manifest.id}" collides with a built-in module — skipping`
      );
      out.push({
        id: name,
        path: dir,
        manifest: null,
        enabled,
        loaded: false,
        mainActive: false,
        error: 'bad-manifest'
      });
      continue;
    }
    if (manifest.id !== name) {
      log(
        `extension ${name}: manifest id "${manifest.id}" does not match directory name "${name}" — skipping`
      );
      out.push({
        id: name,
        path: dir,
        manifest: null,
        enabled,
        loaded: false,
        mainActive: false,
        error: 'bad-manifest'
      });
      continue;
    }

    const view = toManifestView(manifest);

    // Version gate — skip + warn on a contract mismatch.
    if (!checkApiCompat(manifest.engines.zccApi)) {
      log(
        `extension ${name}: engines.zccApi "${manifest.engines.zccApi}" incompatible with host — skipping`
      );
      out.push({
        id: name,
        path: dir,
        manifest: view,
        enabled,
        loaded: false,
        mainActive: false,
        error: 'version-mismatch'
      });
      continue;
    }

    if (!enabled) {
      out.push({
        id: name,
        path: dir,
        manifest: view,
        enabled,
        loaded: false,
        mainActive: false,
        error: 'disabled'
      });
      continue;
    }

    // Resolve the main entry path (if any), contained within the extension dir.
    // A manifest whose `entry.main` escapes the dir (e.g. `../../evil.js`) would
    // otherwise let the loader `import()` arbitrary code into the MAIN process —
    // same guard the renderer entry already has. On escape, skip with a bad
    // manifest and DO NOT set mainEntryPath. The loader imports it; until then
    // we mark loaded:true to mean "discovery-clean".
    let mainEntryPath: string | undefined;
    if (manifest.entry.main) {
      // realpath-confine: a committed symlink can pass the lexical containment
      // check yet resolve outside the dir — re-verify on the resolved path
      // before we ever import it into the MAIN process.
      const contained = await resolveContainedReal(dir, manifest.entry.main);
      if (!contained) {
        log(`extension ${name}: main entry escapes extension dir — refusing`);
        out.push({
          id: name,
          path: dir,
          manifest: view,
          enabled,
          loaded: false,
          mainActive: false,
          error: 'bad-manifest'
        });
        continue;
      }
      mainEntryPath = contained;
    }

    // Provisional mainActive: a renderer-only extension has no main side to
    // activate, so it's live the moment it's enabled (true). A main-bearing one
    // is NOT active from discovery alone — only the loader, after it imports +
    // the host registers the module, flips this to true. Left false here so a
    // re-enabled-but-not-relaunched main extension stays mainActive:false.
    const mainActive = !mainEntryPath;
    out.push({
      id: name,
      path: dir,
      manifest: view,
      enabled,
      loaded: true,
      mainActive,
      mainEntryPath
    });
  }

  // Stamp consent. Only an entry that is a live RUN CANDIDATE (loaded + has a
  // manifest, i.e. enabled + version-OK) carries a real consent decision; a
  // skipped/errored/disabled entry has nothing to run, so `needsConsent:null`
  // and `consented:false` (it isn't "consented", it's simply inactive).
  // `source` is stamped from `localMap` for EVERY entry (even a skipped/errored
  // one) — the provenance tag is independent of whether the ext currently runs,
  // so the hub can badge a broken local ext and still offer "Reload from source".
  const stamped: DiscoveredExtension[] = out.map((e) => {
    // `local` wins if an id somehow appears in both maps (a local ext never
    // should, but be deterministic). A git ext also carries `remoteOrigin` so
    // the consent screen can name the repo it came from.
    const gitRec = e.id in gitMap ? gitMap[e.id] : undefined;
    const source: 'local' | 'git' | undefined =
      e.id in localMap ? 'local' : gitRec ? 'git' : undefined;
    const remoteOrigin =
      source === 'git' && gitRec
        ? { url: gitRec.url, ...(gitRec.ref ? { ref: gitRec.ref } : {}) }
        : undefined;
    const declared = e.manifest?.permissions;
    const declaredScopes = e.manifest?.permissionScopes;
    const candidate = e.loaded && !!e.manifest;
    if (!candidate) return { ...e, source, remoteOrigin, consented: false, needsConsent: null };
    const { consented, needsConsent } = consentStateFor(declared, consentMap, e.id, declaredScopes);
    // Carry the approved snapshot so the consent overlay can distinguish the
    // newly-declared permissions from the already-approved ones on a `'widened'`
    // re-prompt. Undefined when there's no record yet (a `'new'` extension).
    const consentedPermissions = consentMap[e.id]
      ? [...consentMap[e.id].permissions]
      : undefined;
    return { ...e, source, remoteOrigin, consented, needsConsent, consentedPermissions };
  });

  stamped.sort((a, b) => a.id.localeCompare(b.id));
  return stamped;
}

/** A discovered entry before the consent fields are stamped on. */
type RawDiscovered = Omit<DiscoveredExtension, 'consented' | 'needsConsent'>;

function badEntry(id: string, dir: string): RawDiscovered {
  return {
    id,
    path: dir,
    manifest: null,
    enabled: true,
    loaded: false,
    mainActive: false,
    error: 'bad-manifest'
  };
}

/**
 * Read an extension's renderer entry file off disk and return its JS text, for
 * the renderer to blob-import (P1-C). Guards: the entry must resolve *within*
 * the extension's own dir (no `../` escape), the manifest must declare a
 * renderer entry, and the file must exist. Returns null otherwise.
 */
export async function readRendererEntry(id: string, log: LogFn = noopLog): Promise<string | null> {
  const root = getExtensionsDir();
  const dir = join(root, id);
  const manifestPath = join(dir, MANIFEST_NAME);
  if (!existsSync(manifestPath)) return null;

  let manifest: ExtensionManifest | null = null;
  try {
    manifest = validateManifest(JSON.parse(await readFile(manifestPath, 'utf-8')));
  } catch {
    return null;
  }
  if (!manifest?.entry.renderer) return null;

  // Contain the read to the extension's own dir — reject a renderer path that
  // resolves outside it (defends against a `../../etc/passwd`-style manifest).
  // realpath-confine (not just lexical): a committed symlink can pass the
  // lexical check yet resolve outside the dir. `resolveContainedReal` also
  // fails on a missing file, so no separate existsSync is needed.
  const target = await resolveContainedReal(dir, manifest.entry.renderer);
  if (!target) {
    log(`extension ${id}: renderer entry escapes extension dir or is missing — refusing`);
    return null;
  }
  try {
    return await readFile(target, 'utf-8');
  } catch (err) {
    log(`extension ${id}: failed reading renderer entry`, err);
    return null;
  }
}

/** Strip the loader-only `mainEntryPath` field for the renderer-facing list. */
export function toEntry(d: DiscoveredExtension): ExtensionEntry {
  return {
    id: d.id,
    path: d.path,
    manifest: d.manifest,
    enabled: d.enabled,
    loaded: d.loaded,
    mainActive: d.mainActive,
    error: d.error,
    consented: d.consented,
    needsConsent: d.needsConsent,
    consentedPermissions: d.consentedPermissions,
    source: d.source,
    remoteOrigin: d.remoteOrigin
  };
}

/**
 * Flip an extension's enabled state in `enabled.json`. Mirrors plugins'
 * `setPluginEnabled`: deletes the key on enable (treat absent === enabled,
 * keep the file tidy), writes `false` on disable. Creates the dir/file as
 * needed. Atomic write via temp + rename.
 */
export async function setExtensionEnabled(id: string, enabled: boolean): Promise<Result<true>> {
  if (!id) return { ok: false, code: 'BAD_ID', message: 'Missing extension id' };
  const root = getExtensionsDir();
  const file = getEnabledFile();
  const map = await readEnabledMap();
  if (enabled) delete map[id];
  else map[id] = false;

  try {
    await mkdir(root, { recursive: true });
    if (Object.keys(map).length === 0) {
      // Nothing to persist — write an empty object (rather than deleting the
      // file) so the map round-trips deterministically.
      await atomicWrite(file, '{}\n');
    } else {
      await atomicWrite(file, JSON.stringify(map, null, 2));
    }
    return { ok: true, value: true };
  } catch (err) {
    return {
      ok: false,
      code: 'WRITE_FAILED',
      message: err instanceof Error ? err.message : String(err)
    };
  }
}

async function atomicWrite(file: string, contents: string): Promise<void> {
  const tmp = `${file}.tmp.${randomBytes(4).toString('hex')}`;
  await writeFile(tmp, contents, 'utf-8');
  await rename(tmp, file);
}

/** Absolute dir of one extension (for the Finder `reveal` opener). */
export function extensionDir(id: string): string {
  return join(getExtensionsDir(), id);
}

/**
 * Declare an additional permission in an extension's on-disk `extension.json`
 * (the user's "add permission" action and the Doctor's repair both land here).
 *
 * This WIDENS the declared set only — it never grants consent: the next
 * discovery stamps `needsConsent:'widened'` and the user must approve it in the
 * consent prompt before the capability is effective (the trust boundary stays
 * intact — declaring a power and being granted it are separate steps).
 *
 * Defensive, mirroring the rest of this module:
 *  - the id must resolve to a manifest CONTAINED in the extensions dir
 *    (`resolveContained` blocks a `../` escape from a hostile id);
 *  - the permission must be a known token (deny an arbitrary string);
 *  - already-declared → no-op success (idempotent);
 *  - every other manifest field is preserved verbatim; atomic temp+rename write.
 */
export async function addExtensionPermission(
  id: string,
  permission: string
): Promise<Result<true>> {
  if (!id) return { ok: false, code: 'BAD_ID', message: 'Missing extension id' };
  if (!isExtensionPermission(permission)) {
    return { ok: false, code: 'BAD_PERMISSION', message: `Unknown permission: ${permission}` };
  }
  const dir = extensionDir(id);
  const file = resolveContained(dir, MANIFEST_NAME);
  if (!file || !existsSync(file)) {
    return { ok: false, code: 'NOT_FOUND', message: `Extension manifest not found: ${id}` };
  }
  let raw: Record<string, unknown>;
  try {
    const parsed = JSON.parse(await readFile(file, 'utf-8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, code: 'BAD_MANIFEST', message: `Malformed manifest: ${id}` };
    }
    raw = parsed as Record<string, unknown>;
  } catch (err) {
    return {
      ok: false,
      code: 'BAD_MANIFEST',
      message: err instanceof Error ? err.message : String(err)
    };
  }

  const current = Array.isArray(raw.permissions)
    ? (raw.permissions as unknown[]).filter((p): p is ExtensionPermission =>
        typeof p === 'string' && isExtensionPermission(p)
      )
    : [];
  if (current.includes(permission)) return { ok: true, value: true }; // already declared
  raw.permissions = [...current, permission];

  try {
    await atomicWrite(file, JSON.stringify(raw, null, 2) + '\n');
    return { ok: true, value: true };
  } catch (err) {
    return {
      ok: false,
      code: 'WRITE_FAILED',
      message: err instanceof Error ? err.message : String(err)
    };
  }
}

/**
 * Remove a declared permission from an extension's on-disk `extension.json` —
 * the inverse of `addExtensionPermission`. NARROWING the declared set is silent
 * (per `consentStateFor`, dropping a permission never re-prompts), so the caller
 * (`extensions:removePermission`) MUST also prune the token from the consent
 * record (`pruneConsentedPermission`) — otherwise a later re-add would be
 * silently covered by the stale approved snapshot, breaking the
 * re-prompt-on-readd guarantee.
 *
 * Same defensive posture as `addExtensionPermission`: contained-manifest guard
 * (blocks a `../` id escape), idempotent when the token is absent, every other
 * manifest field preserved verbatim, atomic temp+rename write.
 */
export async function removeExtensionPermission(
  id: string,
  permission: string
): Promise<Result<true>> {
  if (!id) return { ok: false, code: 'BAD_ID', message: 'Missing extension id' };
  const dir = extensionDir(id);
  const file = resolveContained(dir, MANIFEST_NAME);
  if (!file || !existsSync(file)) {
    return { ok: false, code: 'NOT_FOUND', message: `Extension manifest not found: ${id}` };
  }
  let raw: Record<string, unknown>;
  try {
    const parsed = JSON.parse(await readFile(file, 'utf-8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, code: 'BAD_MANIFEST', message: `Malformed manifest: ${id}` };
    }
    raw = parsed as Record<string, unknown>;
  } catch (err) {
    return {
      ok: false,
      code: 'BAD_MANIFEST',
      message: err instanceof Error ? err.message : String(err)
    };
  }

  // Operate on the RAW string list (not the validity-filtered set add uses):
  // removal must be able to drop an unknown/stale token too — that's a harmless
  // narrowing. Non-string entries are coerced away here as a side benefit.
  const current = Array.isArray(raw.permissions)
    ? (raw.permissions as unknown[]).filter((p): p is string => typeof p === 'string')
    : [];
  if (!current.includes(permission)) return { ok: true, value: true }; // not declared — no-op
  raw.permissions = current.filter((p) => p !== permission);

  try {
    await atomicWrite(file, JSON.stringify(raw, null, 2) + '\n');
    return { ok: true, value: true };
  } catch (err) {
    return {
      ok: false,
      code: 'WRITE_FAILED',
      message: err instanceof Error ? err.message : String(err)
    };
  }
}
