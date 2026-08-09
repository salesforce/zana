/**
 * Seed bundled first-party disk extensions into `~/.zcc/extensions/<id>` so
 * users always run the latest SHIPPED version and are never stuck on a stale
 * install. The companion to `skill-installer.ts` (same boot-time, best-effort,
 * never-throws posture), for extensions instead of skills.
 *
 * The app ships each canonical extension artifact under `resources/extensions/<id>/`
 * (electron-builder `extraResources`, sourced from the committed
 * `examples/extensions/<id>/`). On boot — BEFORE discovery — we compare the
 * bundled `version` to the installed copy and reseed when the bundled one is
 * newer (or nothing is installed). We NEVER downgrade: a user/dev who hand-
 * installed a newer build (e.g. via the dev watcher) keeps it.
 *
 * Reseed is gated by `checkApiCompat` — we never replace a working install with
 * a bundled artifact this host can't run.
 *
 * Extension-agnostic (engineering rule #6): iterates whatever dirs ship under
 * resources/extensions; never names a concrete id in logic.
 *
 * Mirrors discovery's resolution habits: `ZCC_EXTENSIONS_DIR` override, lazy
 * dir resolution, `existsSync` guards, atomic writes, skip-on-equal.
 */

import { homedir, tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, lstatSync } from 'node:fs';
import { readFile, readdir, cp, mkdir, rm, rename, writeFile, realpath, stat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { checkApiCompat, compareVersions } from '@zana-ai/zcc-extension-sdk';
import type { Result } from '../shared/types.js';
import { decodeArchive, ARCHIVE_MAX_BYTES } from './extension-registry.js';
import { isWithin, resolveContained, resolveContainedReal } from './extensions/path-util.js';
import { cloneProject, type CloneOptions, type CloneResult } from './git-clone.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const MANIFEST_NAME = 'extension.json';

type LogFn = (context: string, err?: unknown) => void;

/** Runtime install root the discovery scanner reads. Honors the test override. */
function installRoot(): string {
  return process.env.ZCC_EXTENSIONS_DIR ?? join(homedir(), '.zcc', 'extensions');
}

/**
 * Resolve the bundled-extensions root. Test override (`ZCC_BUNDLED_EXTENSIONS_DIR`)
 * wins; packaged: `process.resourcesPath/extensions` (electron-builder
 * `extraResources`); dev: the committed `examples/extensions` (electron-vite runs
 * with `__dirname = out/main`, so source is `../../examples/...`). Returns the
 * first that exists, or null.
 */
function bundledRoot(): string | null {
  // An explicit override is AUTHORITATIVE — if set, never fall back to the
  // packaged/dev defaults (a test pointing it at a missing dir must resolve to
  // "no bundled extensions", not the repo's real examples/extensions).
  const override = process.env.ZCC_BUNDLED_EXTENSIONS_DIR;
  if (override) return existsSync(override) ? override : null;
  const candidates = [
    process.resourcesPath ? join(process.resourcesPath, 'extensions') : null,
    join(__dirname, '../../examples/extensions')
  ].filter((p): p is string => !!p);
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

interface SeedManifest {
  id?: unknown;
  version?: unknown;
  title?: unknown;
  icon?: unknown;
  description?: unknown;
  author?: unknown;
  permissions?: unknown;
  engines?: { zccApi?: unknown };
  entry?: { main?: unknown };
}

/** Read + minimally parse a manifest's id / version / api range. Null on failure. */
async function readManifest(
  dir: string
): Promise<{ id: string; version: string; apiRange: string; mainEntry?: string } | null> {
  const file = join(dir, MANIFEST_NAME);
  if (!existsSync(file)) return null;
  try {
    const m = JSON.parse(await readFile(file, 'utf-8')) as SeedManifest;
    if (typeof m.id !== 'string' || !m.id) return null;
    const version = typeof m.version === 'string' && m.version ? m.version : '0.0.0';
    const apiRange =
      m.engines && typeof m.engines.zccApi === 'string' ? m.engines.zccApi : '';
    const mainEntry = m.entry && typeof m.entry.main === 'string' && m.entry.main
      ? m.entry.main
      : undefined;
    return { id: m.id, version, apiRange, mainEntry };
  } catch {
    return null;
  }
}

/**
 * A disk extension's main module runs in an isolated utility process, so the
 * installer must not import it just to validate it. Check the emitted ESM shape
 * instead: it needs a default export, a setup method, and the manifest's id.
 */
async function validateMainEntry(dir: string, entry: string, id: string): Promise<string | null> {
  const contained = await resolveContainedReal(dir, entry);
  if (!contained) return `Main entry escapes the extension directory: ${entry}`;
  try {
    const source = await readFile(contained, 'utf-8');
    const hasDefaultExport = /export\s*(?:default|\{[^}]*\bas\s+default\b)/.test(source);
    const hasSetup = /\bsetup\s*(?:\(|:)/.test(source);
    const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const hasId = new RegExp(`\\bid\\s*:\\s*['\"]${escapedId}['\"]`).test(source);
    if (hasDefaultExport && hasSetup && hasId) return null;
    return `Main entry must default-export a MainModule with id "${id}" and setup()`;
  } catch {
    return `Main entry is not readable: ${entry}`;
  }
}

/**
 * Catalog metadata for one bundled (first-party, app-shipped) extension — the
 * fields the marketplace browse row needs. A superset of {@link readManifest}'s
 * id/version/api triple: also the display title/icon/permissions so a bundled
 * row renders like a remote one, no network involved.
 */
export interface BundledCatalogEntry {
  id: string;
  version: string;
  apiRange: string;
  title: string;
  icon?: string;
  description?: string;
  author?: string;
  permissions: string[];
}

/** Read a bundled manifest with the extra catalog fields. Null on failure. */
async function readCatalogManifest(dir: string): Promise<BundledCatalogEntry | null> {
  const file = join(dir, MANIFEST_NAME);
  if (!existsSync(file)) return null;
  try {
    const m = JSON.parse(await readFile(file, 'utf-8')) as SeedManifest;
    if (typeof m.id !== 'string' || !m.id) return null;
    return {
      id: m.id,
      version: typeof m.version === 'string' && m.version ? m.version : '0.0.0',
      apiRange: m.engines && typeof m.engines.zccApi === 'string' ? m.engines.zccApi : '',
      title: typeof m.title === 'string' && m.title ? m.title : m.id,
      icon: typeof m.icon === 'string' ? m.icon : undefined,
      description: typeof m.description === 'string' ? m.description : undefined,
      author: typeof m.author === 'string' ? m.author : undefined,
      permissions: Array.isArray(m.permissions)
        ? m.permissions.filter((p): p is string => typeof p === 'string')
        : []
    };
  } catch {
    return null;
  }
}

/**
 * Enumerate the first-party extensions the app ships in its bundle, as catalog
 * rows. This is the LOCAL, zero-network default the marketplace shows even when
 * no remote registry is configured — the analogue of an editor shipping with a
 * set of recommended/first-party extensions. Extension-agnostic (Rule #6): it
 * iterates whatever dirs ship under the bundled root; never names a concrete id.
 * Returns `[]` when nothing is bundled. Never throws.
 */
export async function listBundledCatalog(log?: LogFn): Promise<BundledCatalogEntry[]> {
  const out: BundledCatalogEntry[] = [];
  try {
    const root = bundledRoot();
    if (!root) return out;
    const names = (await readdir(root, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name);
    for (const name of names) {
      const entry = await readCatalogManifest(join(root, name));
      if (entry) out.push(entry);
    }
  } catch (err) {
    log?.('listBundledCatalog', err);
  }
  return out;
}

/**
 * Install a first-party extension straight from the app bundle — no network, no
 * picker. Main owns the trust decision (Rule #1): the renderer passes only an
 * id, and main maps it to the app-OWNED bundled dir (never a renderer path).
 * `VALID_ID` blocks any `..`/`/` traversal in the id before it becomes a dir
 * name, and the resolved dir must actually be a bundled extension whose manifest
 * id matches. The shipped dir is then handed to {@link installFromDir}, which
 * re-runs the same manifest/id/api/reserved gates as every other install path.
 *
 * The primary use is REINSTALLING a bundled extension the user removed: the
 * boot-time reseed only refreshes what's present or newer, so a deleted bundled
 * extension stays gone until the user asks for it back — this is that path.
 */
export async function installFromBundled(
  id: string,
  opts: InstallOpts
): Promise<Result<{ id: string }>> {
  if (!VALID_ID.test(id)) {
    return { ok: false, code: 'BAD_ID', message: `Invalid extension id: ${id}` };
  }
  const root = bundledRoot();
  if (!root) {
    return { ok: false, code: 'NOT_FOUND', message: 'No bundled extensions available' };
  }
  const srcDir = join(root, id);
  const manifest = await readManifest(srcDir);
  // Guard: the dir must exist AND its manifest id must equal the requested id,
  // so a mismatched/absent bundle can't be smuggled in under another id.
  if (!manifest || manifest.id !== id) {
    return { ok: false, code: 'NOT_FOUND', message: `No bundled extension "${id}"` };
  }
  return installFromDir(srcDir, opts);
}

/** Atomic-ish dir replace: copy into a temp sibling, then swap into place. */
async function replaceDir(srcDir: string, destDir: string): Promise<void> {
  const parent = dirname(destDir);
  await mkdir(parent, { recursive: true });
  const tmp = `${destDir}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  await cp(srcDir, tmp, { recursive: true });
  // rename onto an existing dir fails on some platforms — clear it first. The
  // window between rm and rename is tiny and boot-only (no concurrent reader).
  if (existsSync(destDir)) await rm(destDir, { recursive: true, force: true });
  await rename(tmp, destDir);
}

/**
 * Reseed all bundled extensions whose shipped version is newer than (or absent
 * from) the install dir. Best-effort + idempotent: returns the ids actually
 * reseeded (for logging). Never throws — a failure here must not block boot.
 */
export async function seedBundledExtensions(log?: LogFn): Promise<string[]> {
  const reseeded: string[] = [];
  try {
    const root = bundledRoot();
    if (!root) return reseeded;

    const names = (await readdir(root, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name);

    const dest = installRoot();

    for (const name of names) {
      const srcDir = join(root, name);
      const bundled = await readManifest(srcDir);
      if (!bundled) {
        log?.('seedBundledExtensions', new Error(`bundled ${name}: unreadable manifest — skipping`));
        continue;
      }

      // Never install a bundled artifact this host can't run.
      if (bundled.apiRange && !checkApiCompat(bundled.apiRange)) {
        log?.(
          'seedBundledExtensions',
          new Error(`bundled ${name} v${bundled.version}: engines.zccApi "${bundled.apiRange}" incompatible — skipping`)
        );
        continue;
      }

      const destDir = join(dest, name);
      const installed = await readManifest(destDir);

      // Reseed when nothing's installed or the bundled version is strictly newer.
      // Equal or older installed → leave it (respects a dev/user-newer override).
      const shouldSeed = !installed || compareVersions(bundled.version, installed.version) > 0;
      if (!shouldSeed) continue;

      await replaceDir(srcDir, destDir);
      reseeded.push(name);
      log?.(
        'seedBundledExtensions',
        // Not an error — using the log channel for an info line.
        `reseeded ${name} → v${bundled.version}${installed ? ` (was v${installed.version})` : ' (fresh install)'}`
      );
    }
  } catch (err) {
    log?.('seedBundledExtensions', err);
  }
  return reseeded;
}

/**
 * Extension ids that may install. Mirrors discovery's containment + namespace
 * rule: a leading alphanumeric then `[a-z0-9._-]`. This is the install-dir
 * CONTAINMENT gate — it blocks `..`, `/`, `\`, and absolute-path ids that would
 * let a hostile manifest escape `installRoot()` (rule #2). Case-insensitive to
 * match discovery; the id is used verbatim as the install dir name.
 */
const VALID_ID = /^[a-z0-9][a-z0-9._-]*$/i;

export interface InstallOpts {
  /** Built-in ids an install must not shadow (discovery enforces the same). */
  reservedIds: ReadonlySet<string>;
  log?: LogFn;
}

/**
 * Install (or upgrade-in-place) an extension from a local source DIRECTORY into
 * `~/.zcc/extensions/<id>`. Main owns every trust decision here (rule #1): the
 * renderer never passes a path — it asks main to open a picker, and main hands
 * the chosen dir straight to this function. Validation, in order, fail-closed:
 *   1. readable manifest (id present)            → BAD_MANIFEST
 *   2. id matches {@link VALID_ID}               → BAD_ID  (blocks dir escape)
 *   3. id not reserved by a built-in             → RESERVED_ID
 *   4. `engines.zccApi` compatible with this host → VERSION_MISMATCH
 *   5. declared main entry has the MainModule contract → BAD_MAIN_MODULE
 *   6. atomic {@link replaceDir} into the install root (rule #4)
 *
 * Returns the installed id on success. The caller runs a disk-sync afterward so
 * the new extension is discovered/spawned (and, if it declares permissions,
 * surfaces the consent overlay before it can run — P3-D).
 */
export async function installFromDir(
  srcDir: string,
  opts: InstallOpts
): Promise<Result<{ id: string }>> {
  const manifest = await readManifest(srcDir);
  if (!manifest) {
    return { ok: false, code: 'BAD_MANIFEST', message: `No readable ${MANIFEST_NAME} in ${srcDir}` };
  }
  const { id, apiRange } = manifest;
  if (!VALID_ID.test(id)) {
    return { ok: false, code: 'BAD_ID', message: `Invalid extension id: ${id}` };
  }
  if (opts.reservedIds.has(id)) {
    return { ok: false, code: 'RESERVED_ID', message: `"${id}" is a reserved built-in id` };
  }
  if (apiRange && !checkApiCompat(apiRange)) {
    return {
      ok: false,
      code: 'VERSION_MISMATCH',
      message: `"${id}" requires zccApi "${apiRange}", incompatible with this host`
    };
  }
  if (manifest.mainEntry) {
    const mainError = await validateMainEntry(srcDir, manifest.mainEntry, id);
    if (mainError) return { ok: false, code: 'BAD_MAIN_MODULE', message: mainError };
  }
  try {
    await replaceDir(srcDir, join(installRoot(), id));
    opts.log?.('installFromDir', `installed ${id} v${manifest.version}`);
    return { ok: true, value: { id } };
  } catch (err) {
    return {
      ok: false,
      code: 'WRITE_FAILED',
      message: err instanceof Error ? err.message : String(err)
    };
  }
}

/**
 * Install an extension from a local ARCHIVE file — the same dependency-free
 * JSON file-bundle the marketplace serves (`{ files: { name: base64 } }`).
 * {@link decodeArchive} rejects path-escaping names + requires `extension.json`
 * (fail-closed), so one decode path guards both local and remote archives. The
 * decoded files are written to a temp dir, then handed to {@link installFromDir}
 * for the same manifest/id/api/reserved gates. One archive format end to end.
 */
export async function installFromArchiveFile(
  archiveFile: string,
  opts: InstallOpts
): Promise<Result<{ id: string }>> {
  let files: Record<string, Uint8Array>;
  try {
    // Bound the read with the SAME cap as the marketplace download path so a
    // huge/hostile local file can't balloon main-process memory (Rule #5). stat
    // before readFile — fail closed without ever loading the bytes.
    const info = await stat(archiveFile);
    if (info.size > ARCHIVE_MAX_BYTES) {
      return {
        ok: false,
        code: 'BAD_ARCHIVE',
        message: `archive is ${info.size} bytes, over the ${ARCHIVE_MAX_BYTES}-byte limit`
      };
    }
    const bytes = await readFile(archiveFile);
    files = decodeArchive(new Uint8Array(bytes));
  } catch (err) {
    return {
      ok: false,
      code: 'BAD_ARCHIVE',
      message: err instanceof Error ? err.message : String(err)
    };
  }
  const tmp = join(tmpdir(), `zcc-ext-install-${process.pid}-${randomBytes(4).toString('hex')}`);
  try {
    await mkdir(tmp, { recursive: true });
    for (const [name, data] of Object.entries(files)) {
      await writeFile(join(tmp, name), data);
    }
    return await installFromDir(tmp, opts);
  } catch (err) {
    return {
      ok: false,
      code: 'WRITE_FAILED',
      message: err instanceof Error ? err.message : String(err)
    };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/**
 * Provenance recorded for a git install, credential-stripped, ready to persist
 * to `git.json` by the caller (main). The url NEVER carries `user:token@`.
 */
export interface GitProvenance {
  url: string;
  ref?: string;
  sha?: string;
}

/** Result of a successful git install: the installed id + its provenance. */
export interface GitInstallResult {
  id: string;
  provenance: GitProvenance;
}

/** Options for {@link installFromGit}. */
export interface InstallFromGitOpts {
  /** Optional branch/tag/SHA. Validated by `safeRef` inside `cloneProject`. */
  ref?: string;
  /** Optional path INSIDE the repo where `extension.json` lives. Advisory —
   *  realpath-confined against the clone root before use (Rule 2). */
  subdir?: string;
  /** Progress lines from the underlying `git clone`. */
  onProgress?: (line: string) => void;
}

/**
 * Strip credentials from a clone url for storage/display WITHOUT lowercasing the
 * path (unlike `canonicalRemote`, which is lossy + comparison-only). Parses with
 * `URL` and clears `username`/`password`; falls back to a regex strip for
 * scp-style / unparseable specs. Never throws.
 */
export function stripCreds(url: string): string {
  const raw = (url ?? '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw);
    u.username = '';
    u.password = '';
    return u.toString();
  } catch {
    // scp-style (git@host:owner/repo) or otherwise not URL-parseable: strip only
    // an embedded `:password`, PRESERVING the SSH login user — `git@` is the
    // login identity, not a secret, and dropping it yields a spec
    // `normalizeRepoUrl` can no longer parse, breaking update-from-repo.
    return raw.replace(/^([^@/:]+)(?::[^@/]+)?@/, '$1@');
  }
}

/**
 * Locate the directory containing `extension.json` within a freshly-cloned repo.
 * Fail-closed + bounded (Rule 5 — never recurses past one level, so a repo's
 * `node_modules` can't be scanned):
 *   1. explicit `subdir` → realpath-confined against `cloneRoot` (Rule 2);
 *      escape → BAD_SUBDIR, no manifest there → MANIFEST_NOT_FOUND.
 *   2. manifest at the repo root → cloneRoot.
 *   3. scan IMMEDIATE subdirs: exactly one with a manifest → that dir;
 *      zero → MANIFEST_NOT_FOUND; more than one → AMBIGUOUS_MANIFEST (the caller
 *      surfaces "specify a subfolder").
 */
export async function locateManifestDir(
  cloneRoot: string,
  subdir?: string
): Promise<Result<string>> {
  const hasManifest = (dir: string): boolean => existsSync(join(dir, MANIFEST_NAME));

  if (subdir && subdir.trim()) {
    const contained = resolveContained(cloneRoot, subdir.trim());
    if (!contained) {
      return { ok: false, code: 'BAD_SUBDIR', message: `Subfolder escapes the repository: ${subdir}` };
    }
    // realpath-confine too: a committed symlink subdir could resolve outside.
    try {
      const [realTarget, realRoot] = await Promise.all([realpath(contained), realpath(cloneRoot)]);
      if (realTarget !== realRoot && !isWithin(realTarget, realRoot)) {
        return { ok: false, code: 'BAD_SUBDIR', message: `Subfolder escapes the repository: ${subdir}` };
      }
    } catch {
      return { ok: false, code: 'MANIFEST_NOT_FOUND', message: `Subfolder not found: ${subdir}` };
    }
    if (!hasManifest(contained)) {
      return { ok: false, code: 'MANIFEST_NOT_FOUND', message: `No ${MANIFEST_NAME} in ${subdir}` };
    }
    return { ok: true, value: contained };
  }

  if (hasManifest(cloneRoot)) return { ok: true, value: cloneRoot };

  // Scan one level of immediate subdirs.
  let entries: string[];
  try {
    entries = (await readdir(cloneRoot, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && e.name !== '.git' && !e.name.startsWith('.'))
      .map((e) => e.name);
  } catch {
    return { ok: false, code: 'MANIFEST_NOT_FOUND', message: 'Could not read repository contents' };
  }
  const withManifest = entries.filter((name) => hasManifest(join(cloneRoot, name)));
  if (withManifest.length === 1) return { ok: true, value: join(cloneRoot, withManifest[0]) };
  if (withManifest.length === 0) {
    return { ok: false, code: 'MANIFEST_NOT_FOUND', message: `No ${MANIFEST_NAME} in the repository` };
  }
  return {
    ok: false,
    code: 'AMBIGUOUS_MANIFEST',
    message: `Multiple extensions found (${withManifest.join(', ')}) — specify a subfolder`
  };
}

/**
 * Copy the manifest subtree into a fresh staging dir, SCRUBBING it before it can
 * reach the trusted `installFromDir` seam. `replaceDir`'s `cp(recursive:true)`
 * preserves symlinks verbatim and would copy `.git/`, so an attacker-controlled
 * repo could ship a symlink that reads past containment or bloat the install
 * with git history/hooks. The `cp` filter here:
 *   - REFUSES any symlink anywhere in the tree (→ UNSAFE_TREE), and
 *   - excludes `.git/`
 * Returns the staging dir on success; the caller removes it in a `finally`.
 */
export async function stageInstallable(srcDir: string): Promise<Result<string>> {
  const staging = join(tmpdir(), `zcc-ext-stage-${process.pid}-${randomBytes(4).toString('hex')}`);
  let unsafe = false;
  try {
    await cp(srcDir, staging, {
      recursive: true,
      // `cp`'s filter runs per source entry; returning false skips it (and, for
      // a dir, its whole subtree). `verbatimSymlinks` isn't enough — we must
      // REJECT symlinks, not follow them, so we lstat and flag.
      filter: (source: string): boolean => {
        const base = source.slice(srcDir.length).replace(/^[/\\]/, '');
        // Exclude the git dir and anything under it.
        if (base === '.git' || base.startsWith('.git/') || base.startsWith('.git\\')) return false;
        try {
          if (base && lstatSync(source).isSymbolicLink()) {
            unsafe = true;
            return false;
          }
        } catch {
          /* stat race — treat as skip */
          return false;
        }
        return true;
      }
    });
  } catch (err) {
    await rm(staging, { recursive: true, force: true }).catch(() => {});
    return { ok: false, code: 'WRITE_FAILED', message: err instanceof Error ? err.message : String(err) };
  }
  if (unsafe) {
    await rm(staging, { recursive: true, force: true }).catch(() => {});
    return { ok: false, code: 'UNSAFE_TREE', message: 'Repository contains a symlink — refusing to install' };
  }
  return { ok: true, value: staging };
}

/**
 * Install an extension from a remote git repository. Main owns every trust
 * decision (Rule 1): it normalizes + clones the url, validates the ref, locates
 * and CONFINES the manifest dir, SCRUBS the tree (symlinks/.git), then funnels
 * the staged copy through the single trusted {@link installFromDir} seam — so
 * consent + the deny-by-default broker fire exactly as for a local dir. A repo
 * cannot choose its install location (installFromDir derives it from the
 * manifest id). The temp clone + staging dir are ALWAYS removed.
 *
 * `clone` is a DI seam for tests: `normalizeRepoUrl` rejects `file://`/local
 * paths, so offline tests inject a fake clone (or a real `git clone -- <bare>`).
 */
export async function installFromGit(
  url: string,
  gitOpts: InstallFromGitOpts,
  opts: InstallOpts,
  deps?: { clone?: (o: CloneOptions) => Promise<CloneResult> }
): Promise<Result<GitInstallResult>> {
  const clone = deps?.clone ?? cloneProject;
  const tmp = join(tmpdir(), `zcc-ext-git-${process.pid}-${randomBytes(4).toString('hex')}`);
  let staged: string | undefined;
  try {
    const cloned = await clone({
      url,
      destBase: tmp,
      ref: gitOpts.ref,
      shallow: true,
      onProgress: gitOpts.onProgress
    });
    if (!cloned.ok || !cloned.path) {
      // BAD_INPUT (url/ref rejected) → BAD_SOURCE; anything else → CLONE_FAILED.
      const code = cloned.code === 'BAD_INPUT' ? 'BAD_SOURCE' : 'CLONE_FAILED';
      return { ok: false, code, message: cloned.message ?? 'git clone failed' };
    }

    const located = await locateManifestDir(cloned.path, gitOpts.subdir);
    if (!located.ok) return located;

    const stagedRes = await stageInstallable(located.value);
    if (!stagedRes.ok) return stagedRes;
    staged = stagedRes.value;

    const res = await installFromDir(staged, opts);
    if (!res.ok) return res;

    return {
      ok: true,
      value: {
        id: res.value.id,
        provenance: {
          url: stripCreds(cloned.cloneUrl ?? url),
          ...(gitOpts.ref ? { ref: gitOpts.ref } : {}),
          ...(cloned.resolvedSha ? { sha: cloned.resolvedSha } : {})
        }
      }
    };
  } catch (err) {
    return { ok: false, code: 'INSTALL_FAILED', message: err instanceof Error ? err.message : String(err) };
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
    if (staged) await rm(staged, { recursive: true, force: true }).catch(() => {});
  }
}

export interface UninstallOpts {
  /** Built-in ids that must never be uninstalled (they aren't on disk anyway). */
  reservedIds: ReadonlySet<string>;
  log?: LogFn;
}

/**
 * Remove an installed extension from `~/.zcc/extensions/<id>` — the inverse of
 * {@link installFromDir}. Main owns the trust decision (Rule #1): the renderer
 * passes only an id, never a path, and we re-derive + CONFINE the target dir
 * before deleting anything (Rule #2). Validation, fail-closed:
 *   1. id matches {@link VALID_ID}     → BAD_ID (no `..`/`/` to escape the root)
 *   2. id not reserved (built-in)      → RESERVED_ID
 *   3. the dir exists                  → NOT_FOUND (idempotent caller can ignore)
 *   4. its REALPATH is inside the install root's realpath → else BAD_PATH (a
 *      symlinked id dir pointing outside the tree can't trick us into `rm`-ing
 *      an arbitrary location)
 *   5. also clears the `<id>.prev` rollback backup left by an update, if any.
 *
 * The caller is responsible for tearing down the live child + forgetting consent
 * BEFORE/AFTER this (see the `extensions:uninstall` handler); this function owns
 * only the on-disk removal so it stays unit-testable without the process host.
 */
export async function uninstallExtension(
  id: string,
  opts: UninstallOpts
): Promise<Result<true>> {
  if (!VALID_ID.test(id)) {
    return { ok: false, code: 'BAD_ID', message: `Invalid extension id: ${id}` };
  }
  if (opts.reservedIds.has(id)) {
    return { ok: false, code: 'RESERVED_ID', message: `"${id}" is a built-in and cannot be removed` };
  }
  const root = installRoot();
  const dir = join(root, id);
  if (!existsSync(dir)) {
    return { ok: false, code: 'NOT_FOUND', message: `Extension not installed: ${id}` };
  }
  try {
    // Confinement (Rule #2): realpath BOTH sides so a symlinked id dir that
    // points outside the install root can't smuggle the delete elsewhere.
    const [realDir, realRoot] = await Promise.all([realpath(dir), realpath(root)]);
    if (realDir !== realRoot && !isWithin(realDir, realRoot)) {
      return { ok: false, code: 'BAD_PATH', message: `Refusing to remove out-of-tree path for ${id}` };
    }
    await rm(realDir, { recursive: true, force: true });
    // Best-effort: drop the update rollback backup so it isn't rediscovered.
    await rm(`${dir}.prev`, { recursive: true, force: true });
    opts.log?.('uninstallExtension', `removed ${id}`);
    return { ok: true, value: true };
  } catch (err) {
    return {
      ok: false,
      code: 'REMOVE_FAILED',
      message: err instanceof Error ? err.message : String(err)
    };
  }
}
