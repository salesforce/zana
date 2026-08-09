/**
 * P4 — remote update channel. Fetches a signed registry index, picks the
 * newest host-compatible release per installed extension, downloads + verifies
 * it (sha256, and a detached signature when a public key is configured), and
 * stages it into `~/.zcc/extensions/<id>` — so an extension can ship a fix
 * WITHOUT re-shipping the whole app.
 *
 * Relationship to the other phases:
 *   - P3 (`extension-installer.ts`) guarantees a FLOOR — the app-bundled version.
 *     This P4 channel raises the CEILING above it between app releases.
 *   - Both use {@link compareVersions} and never downgrade, and both reuse the
 *     same atomic dir-swap so a half-written update can't corrupt an install.
 *
 * Security posture (deny-by-default, fail-closed):
 *   - HTTPS only; index + archive sizes capped; request timeout.
 *   - Archive bytes MUST match the index's `sha256` or the update is rejected.
 *   - When a public key is configured, the detached `signature` MUST verify
 *     (Ed25519 over the archive bytes) or the update is rejected. `requireSignature`
 *     makes a missing signature fail too (recommended for production registries).
 *   - API-incompatible releases are never installed (`checkApiCompat`).
 *   - A release that WIDENS declared permissions vs. the installed manifest is
 *     surfaced (`needsConsent`) and NOT auto-applied — the user must re-consent.
 *
 * Dependency-free archive format: a release archive is a JSON FILE-BUNDLE
 * (`{ files: { "<name>": "<base64>" } }`), so no tar/zlib dependency. The
 * integrity hash + signature are taken over the archive's raw bytes.
 *
 * Pure core + injected I/O: `fetchBytes` (HTTPS GET → bytes) and `verifySignature`
 * are injected so the engine is unit-testable without network or a real key.
 */

import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir, cp, rm, rename } from 'node:fs/promises';
import { createHash, verify as cryptoVerify } from 'node:crypto';
import {
  checkApiCompat,
  compareVersions,
  pickBestRelease,
  type RegistryIndex,
  type RegistryRelease,
  type ExtensionPermission
} from '@zana-ai/zcc-extension-sdk';
import type { MarketplaceEntry } from '../shared/types.js';

/** Hard caps so a hostile/misconfigured registry can't exhaust memory. */
const INDEX_MAX_BYTES = 1 * 1024 * 1024; // 1 MiB index
/**
 * 16 MiB per release. Exported so the LOCAL archive-install path
 * (`installFromArchiveFile`) bounds a user-picked file with the SAME cap as the
 * marketplace download path — one archive size limit end to end (Rule #5).
 */
export const ARCHIVE_MAX_BYTES = 16 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30_000;

type LogFn = (message: string, err?: unknown) => void;
const noopLog: LogFn = () => {};

/** Runtime install root the discovery scanner reads. Honors the test override. */
function installRoot(): string {
  return process.env.ZCC_EXTENSIONS_DIR ?? join(homedir(), '.zcc', 'extensions');
}

/** Injected dependencies — replaced in tests with in-memory fakes. */
export interface RegistryDeps {
  /** HTTPS GET → raw bytes, capped at `maxBytes`. Throws on non-2xx / over-cap / timeout. */
  fetchBytes: (url: string, maxBytes: number) => Promise<Uint8Array>;
  /** Verify a detached signature over `data`. Absent ⇒ signatures are not checked. */
  verifySignature?: (data: Uint8Array, signatureB64: string) => boolean;
  /** Reject a release that carries no signature (production registries). Default false. */
  requireSignature?: boolean;
  log?: LogFn;
}

/** What an update check found for one extension. */
export interface UpdateOutcome {
  id: string;
  /** 'updated' applied a new version; 'skipped' nothing newer/compatible; 'needs-consent' held back. */
  status: 'updated' | 'skipped' | 'needs-consent' | 'error';
  fromVersion?: string;
  toVersion?: string;
  /** Populated for needs-consent: the permissions newly requested. */
  addedPermissions?: ExtensionPermission[];
  error?: string;
}

interface InstalledInfo {
  version: string;
  permissions: ExtensionPermission[];
}

/** Read an installed extension's version + declared permissions. Null if absent. */
async function readInstalled(id: string): Promise<InstalledInfo | null> {
  const file = join(installRoot(), id, 'extension.json');
  if (!existsSync(file)) return null;
  try {
    const m = JSON.parse(await readFile(file, 'utf-8')) as {
      version?: unknown;
      permissions?: unknown;
    };
    const version = typeof m.version === 'string' && m.version ? m.version : '0.0.0';
    const permissions = Array.isArray(m.permissions)
      ? (m.permissions.filter((p) => typeof p === 'string') as ExtensionPermission[])
      : [];
    return { version, permissions };
  } catch {
    return null;
  }
}

/** Lowercase hex sha256 of bytes. */
function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** A decoded release archive: file name → bytes. */
type ArchiveFiles = Record<string, Uint8Array>;

/**
 * Parse + validate the JSON file-bundle archive. Rejects path-escaping names
 * (`/`, `..`, absolute) so a malicious archive can't write outside the dir, and
 * requires an `extension.json`. Throws on any violation (fail-closed).
 */
export function decodeArchive(bytes: Uint8Array): ArchiveFiles {
  const parsed = JSON.parse(Buffer.from(bytes).toString('utf-8')) as { files?: unknown };
  if (!parsed.files || typeof parsed.files !== 'object' || Array.isArray(parsed.files)) {
    throw new Error('archive has no files map');
  }
  const out: ArchiveFiles = {};
  for (const [name, b64] of Object.entries(parsed.files as Record<string, unknown>)) {
    if (typeof b64 !== 'string') throw new Error(`archive file ${name} is not a base64 string`);
    if (name.includes('/') || name.includes('\\') || name.includes('..') || name.startsWith('.')) {
      throw new Error(`archive file name rejected (path escape): ${name}`);
    }
    out[name] = new Uint8Array(Buffer.from(b64, 'base64'));
  }
  if (!out['extension.json']) throw new Error('archive missing extension.json');
  return out;
}

/** Atomic-ish dir replace: write files into a temp sibling, then swap into place. */
async function stageFiles(destDir: string, files: ArchiveFiles): Promise<void> {
  const parent = dirname(destDir);
  await mkdir(parent, { recursive: true });
  const tmp = `${destDir}.tmp-${process.pid}-${sha256Hex(Buffer.from(String(Object.keys(files)))).slice(0, 8)}`;
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
  for (const [name, data] of Object.entries(files)) {
    await writeFile(join(tmp, name), data);
  }
  // Keep a one-step rollback: move the current install aside before swapping.
  if (existsSync(destDir)) {
    const backup = `${destDir}.prev`;
    await rm(backup, { recursive: true, force: true });
    await cp(destDir, backup, { recursive: true });
    await rm(destDir, { recursive: true, force: true });
  }
  await rename(tmp, destDir);
}

/**
 * Fetch the registry index from `registryUrl` (must be HTTPS), validate its
 * shape, and return it. Throws on a non-HTTPS URL, fetch failure, over-cap
 * body, or malformed JSON (fail-closed — caller treats a throw as "no updates").
 */
export async function fetchRegistryIndex(
  registryUrl: string,
  deps: RegistryDeps
): Promise<RegistryIndex> {
  if (!/^https:\/\//i.test(registryUrl)) {
    throw new Error(`registry URL must be HTTPS: ${registryUrl}`);
  }
  const bytes = await deps.fetchBytes(registryUrl, INDEX_MAX_BYTES);
  const parsed = JSON.parse(Buffer.from(bytes).toString('utf-8')) as Partial<RegistryIndex>;
  if (parsed.schema !== 1 || !Array.isArray(parsed.releases)) {
    throw new Error('registry index has unexpected shape');
  }
  return parsed as RegistryIndex;
}

/** Permissions in `next` that aren't already in `installed`. */
function widenedPermissions(
  installed: ExtensionPermission[],
  next: ExtensionPermission[] | undefined
): ExtensionPermission[] {
  if (!next) return [];
  const have = new Set(installed);
  return next.filter((p) => !have.has(p));
}

/**
 * Download, verify, and stage ONE release. Returns the outcome. Never throws —
 * a verification/IO failure is reported as `status:'error'` so one bad release
 * doesn't abort the others.
 */
export async function applyRelease(
  release: RegistryRelease,
  deps: RegistryDeps
): Promise<UpdateOutcome> {
  const log = deps.log ?? noopLog;
  const installed = await readInstalled(release.id);
  const fromVersion = installed?.version;

  try {
    // Compatible + actually newer? (pickBestRelease already gated compat, but
    // applyRelease may be called directly — re-check defensively.)
    if (!checkApiCompat(release.zccApi)) {
      return { id: release.id, status: 'skipped', fromVersion };
    }
    if (installed && compareVersions(release.version, installed.version) <= 0) {
      return { id: release.id, status: 'skipped', fromVersion, toVersion: installed.version };
    }

    // A permission widening on an UPDATE must be consented to — never silently
    // grant new powers to code the user already trusted at a narrower scope.
    // A FRESH install (nothing installed) has no prior grant to widen: stage it
    // and let the post-install consent flow (P3-D) gate execution — discovery
    // stamps the unconsented ext, the loader won't spawn it, and the consent
    // overlay prompts before any of its code runs (same model as installFromDir).
    const added = installed ? widenedPermissions(installed.permissions, release.permissions) : [];
    if (added.length > 0) {
      return {
        id: release.id,
        status: 'needs-consent',
        fromVersion,
        toVersion: release.version,
        addedPermissions: added
      };
    }

    // Download + integrity gate.
    if (!/^https:\/\//i.test(release.url)) throw new Error('release URL must be HTTPS');
    const bytes = await deps.fetchBytes(release.url, ARCHIVE_MAX_BYTES);
    const digest = sha256Hex(bytes);
    if (digest !== release.sha256.toLowerCase()) {
      throw new Error(`sha256 mismatch (expected ${release.sha256}, got ${digest})`);
    }

    // Signature gate (when a verifier is configured, or required by policy).
    if (deps.verifySignature) {
      if (!release.signature) {
        if (deps.requireSignature) throw new Error('release is unsigned and signatures are required');
      } else if (!deps.verifySignature(bytes, release.signature)) {
        throw new Error('signature verification failed');
      }
    } else if (deps.requireSignature) {
      throw new Error('signatures required but no verifier configured');
    }

    const files = decodeArchive(bytes);
    await stageFiles(join(installRoot(), release.id), files);
    log(`extension-registry: updated ${release.id} ${fromVersion ?? '∅'} → ${release.version}`);
    return { id: release.id, status: 'updated', fromVersion, toVersion: release.version };
  } catch (err) {
    log(`extension-registry: failed to apply ${release.id}@${release.version}`, err);
    return {
      id: release.id,
      status: 'error',
      fromVersion,
      toVersion: release.version,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

/**
 * Check the registry for updates to the given installed extension ids and apply
 * every compatible, newer, non-permission-widening release. Returns one outcome
 * per id. Never throws — a registry fetch failure yields an all-error result so
 * the caller (boot / a manual "check for updates") can log and move on.
 */
export async function checkAndApplyUpdates(
  registryUrl: string,
  installedIds: string[],
  deps: RegistryDeps
): Promise<UpdateOutcome[]> {
  const log = deps.log ?? noopLog;
  let index: RegistryIndex;
  try {
    index = await fetchRegistryIndex(registryUrl, deps);
  } catch (err) {
    log('extension-registry: index fetch failed', err);
    return installedIds.map((id) => ({
      id,
      status: 'error' as const,
      error: err instanceof Error ? err.message : String(err)
    }));
  }

  const outcomes: UpdateOutcome[] = [];
  for (const id of installedIds) {
    const best = pickBestRelease(index, id);
    if (!best) {
      outcomes.push({ id, status: 'skipped' });
      continue;
    }
    outcomes.push(await applyRelease(best, deps));
  }
  return outcomes;
}

/**
 * Default {@link RegistryDeps.fetchBytes} for the main process: HTTPS GET with a
 * timeout and a hard body cap (streams + aborts past `maxBytes`). Uses global
 * `fetch` (Node 18+/Electron) the same way the broker's trusted fetch does.
 */
export async function nodeFetchBytes(url: string, maxBytes: number): Promise<Uint8Array> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) throw new Error(`response exceeds ${maxBytes} bytes`);
    return buf;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Default Ed25519 signature verifier given a PEM/DER public key. Returns false
 * on any error (fail-closed). `publicKey` is the host's PINNED registry key.
 */
export function makeEd25519Verifier(publicKey: string | Buffer) {
  return (data: Uint8Array, signatureB64: string): boolean => {
    try {
      return cryptoVerify(null, data, publicKey, Buffer.from(signatureB64, 'base64'));
    } catch {
      return false;
    }
  };
}

/**
 * Remote-update channel config, read from `~/.zcc/extension-registry.json`:
 * ```jsonc
 * {
 *   "enabled": true,
 *   "registryUrl": "https://.../index.json",
 *   "publicKey": "-----BEGIN PUBLIC KEY-----\n…",   // PEM, optional
 *   "requireSignature": true                          // optional
 * }
 * ```
 * The channel is OFF unless this file exists with `enabled: true` and an HTTPS
 * `registryUrl` — so no host reaches out to a network by default.
 *
 * Deployment seam (council 2026-06-28): `ZCC_EXTENSION_REGISTRY_URL` supplies
 * the `registryUrl` when the on-disk config opts in (`enabled: true`) but omits
 * its own URL — so a packaged build can point the marketplace at the same static
 * object store / CDN base as the updater feed without editing per-user config.
 * It does NOT enable the channel on its own: the opt-in invariant
 * ("no host reaches out to a network by default") is preserved — a file with
 * `enabled: true` must still exist. An explicit `registryUrl` in the file always
 * wins over the env default.
 */
export interface RegistryConfig {
  enabled?: boolean;
  registryUrl?: string;
  publicKey?: string;
  requireSignature?: boolean;
}

/** Resolve + parse the registry config file. Null when absent/disabled/malformed. */
export async function readRegistryConfig(): Promise<(RegistryConfig & { registryUrl: string }) | null> {
  const file =
    process.env.ZCC_EXTENSION_REGISTRY_CONFIG ??
    join(homedir(), '.zcc', 'extension-registry.json');
  if (!existsSync(file)) return null;
  try {
    const cfg = JSON.parse(await readFile(file, 'utf-8')) as RegistryConfig;
    if (cfg.enabled !== true) return null;
    // Explicit file URL wins; otherwise fall back to the packaged default base.
    const envUrl = process.env.ZCC_EXTENSION_REGISTRY_URL?.trim();
    const registryUrl =
      typeof cfg.registryUrl === 'string' && cfg.registryUrl ? cfg.registryUrl : envUrl;
    if (typeof registryUrl !== 'string' || !/^https:\/\//i.test(registryUrl)) return null;
    return { ...cfg, registryUrl };
  } catch {
    return null;
  }
}

/**
 * Boot-time / on-demand orchestrator: read the (opt-in) registry config and,
 * when enabled, check + apply updates for the given installed ids. A no-op
 * (returns `[]`) when the channel isn't configured. Never throws. This is the
 * single call a host wires into boot (after the P3 reseed) or a "Check for
 * updates" action — it owns config resolution + the default fetch/verifier so
 * the caller passes only the installed ids and a logger.
 */
export async function maybeCheckRemoteUpdates(
  installedIds: string[],
  log: LogFn = noopLog
): Promise<UpdateOutcome[]> {
  const cfg = await readRegistryConfig();
  if (!cfg) return [];
  const verifySignature = cfg.publicKey ? makeEd25519Verifier(cfg.publicKey) : undefined;
  return checkAndApplyUpdates(cfg.registryUrl, installedIds, {
    fetchBytes: nodeFetchBytes,
    verifySignature,
    requireSignature: cfg.requireSignature === true,
    log
  });
}

/**
 * Resolve one marketplace release id to the best installable release, ready to
 * download. Reads the (opt-in) registry config, fetches the index, and picks the
 * highest compatible release for `id`. Returns null when the channel is off or
 * the id isn't offered. The caller passes the result to {@link applyRelease}
 * with deps built from the same config (see {@link buildRegistryDeps}).
 */
export async function resolveMarketplaceRelease(
  id: string,
  log: LogFn = noopLog
): Promise<{ release: RegistryRelease; deps: RegistryDeps } | null> {
  const cfg = await readRegistryConfig();
  if (!cfg) return null;
  let index: RegistryIndex;
  try {
    index = await fetchRegistryIndex(cfg.registryUrl, buildRegistryDeps(cfg, log));
  } catch (err) {
    log('extension-registry: index fetch failed', err);
    return null;
  }
  const release = pickBestRelease(index, id);
  if (!release) return null;
  return { release, deps: buildRegistryDeps(cfg, log) };
}

/** Build the injected `RegistryDeps` (fetch + verifier) from a resolved config. */
function buildRegistryDeps(
  cfg: RegistryConfig & { registryUrl: string },
  log: LogFn
): RegistryDeps {
  return {
    fetchBytes: nodeFetchBytes,
    verifySignature: cfg.publicKey ? makeEd25519Verifier(cfg.publicKey) : undefined,
    requireSignature: cfg.requireSignature === true,
    log
  };
}

/**
 * Browse the (opt-in) marketplace: fetch the registry index and project it onto
 * {@link MarketplaceEntry} rows joined with this host's install state. For each
 * id offered, picks the best COMPATIBLE release; entries with no compatible
 * release are still listed (`compatible:false`) so the UI can show "Incompatible"
 * rather than hiding them. Returns `[]` when the channel isn't configured — the
 * host never reaches the network by default. Never throws (a fetch failure logs
 * and yields `[]` so the caller surfaces an empty catalog, not a crash).
 *
 * `installedIds` is the host's currently-installed set (so a row that is offered
 * but not installed reads `installed:false`).
 */
export async function listMarketplace(
  installedIds: string[],
  log: LogFn = noopLog,
  /**
   * Test seam: inject `{ registryUrl, deps }` to bypass the on-disk config +
   * real network. Production callers omit it — config + the default
   * fetch/verifier are resolved from `~/.zcc/extension-registry.json`.
   */
  override?: { registryUrl: string; deps: RegistryDeps },
  /**
   * First-party extensions the app ships (from `listBundledCatalog`). These are
   * unioned in so the marketplace is NON-EMPTY by default without any remote
   * registry — the offline, zero-network catalog. A remote release for the same
   * id WINS (it can be newer): the remote entry replaces the bundled one and the
   * row reads `source: 'marketplace'`. Injected (not imported) so this module
   * stays free of the installer + unit-testable without a bundle on disk.
   */
  bundled: BundledMarketplaceInput[] = []
): Promise<MarketplaceEntry[]> {
  const byId = new Map<string, MarketplaceEntry>();
  const installedSet = new Set(installedIds);

  // 1. Bundled (offline) rows first. A bundled extension is compatible when its
  //    declared `zccApi` range satisfies this host (empty range ⇒ treat as ok,
  //    mirroring the seed path). It has no "update" concept here — the boot-time
  //    reseed owns refreshing bundled installs — so `hasUpdate` is always false.
  for (const b of bundled) {
    const installed = await readInstalled(b.id);
    const compatible = !b.apiRange || checkApiCompat(b.apiRange);
    byId.set(b.id, {
      id: b.id,
      version: b.version,
      title: b.title || b.id,
      description: b.description,
      author: b.author,
      icon: b.icon,
      permissions: b.permissions,
      installed: installedSet.has(b.id) || installed !== null,
      installedVersion: installed?.version,
      hasUpdate: false,
      compatible,
      source: 'bundled'
    });
  }

  // 2. Remote registry rows (opt-in). Absent config ⇒ skip entirely; the bundled
  //    rows already give a usable catalog. A remote release overrides its bundled
  //    twin ONLY when it's a genuine upgrade — compatible with this host AND at
  //    least as new. Otherwise the bundled (installable, offline) floor is kept:
  //    an incompatible or stale remote release must never mask the version the
  //    app actually ships, or the marketplace would show an un-installable row
  //    for an extension the user could install right now.
  const remote = await listRemoteMarketplace(installedIds, log, override);
  for (const r of remote) {
    const bundledTwin = byId.get(r.id);
    if (bundledTwin && bundledTwin.source === 'bundled') {
      const remotePreferred = r.compatible && compareVersions(r.version, bundledTwin.version) >= 0;
      if (!remotePreferred) continue; // keep the bundled floor
    }
    byId.set(r.id, r);
  }

  const entries = [...byId.values()];
  entries.sort((a, b) => a.title.localeCompare(b.title));
  return entries;
}

/**
 * The bundled-catalog shape `listMarketplace` accepts. Structurally matches
 * `BundledCatalogEntry` from the installer; re-declared here so this module has
 * no import dependency on the installer (which imports FROM this module).
 */
export interface BundledMarketplaceInput {
  id: string;
  version: string;
  apiRange: string;
  title: string;
  icon?: string;
  description?: string;
  author?: string;
  permissions: string[];
}

/**
 * Project the opt-in REMOTE registry index onto marketplace rows. Split out of
 * {@link listMarketplace} so the bundled union can layer on top. Returns `[]`
 * when the channel isn't configured (no network by default) or a fetch fails.
 */
async function listRemoteMarketplace(
  installedIds: string[],
  log: LogFn,
  override?: { registryUrl: string; deps: RegistryDeps }
): Promise<MarketplaceEntry[]> {
  let registryUrl: string;
  let deps: RegistryDeps;
  if (override) {
    ({ registryUrl, deps } = override);
  } else {
    const cfg = await readRegistryConfig();
    if (!cfg) return [];
    registryUrl = cfg.registryUrl;
    deps = buildRegistryDeps(cfg, log);
  }
  let index: RegistryIndex;
  try {
    index = await fetchRegistryIndex(registryUrl, deps);
  } catch (err) {
    log('extension-registry: marketplace index fetch failed', err);
    return [];
  }

  // Distinct ids in the index (a release may list several versions per id).
  const ids = [...new Set(index.releases.map((r) => r.id))];
  const installedSet = new Set(installedIds);

  const entries: MarketplaceEntry[] = [];
  for (const id of ids) {
    // Prefer the best COMPATIBLE release; fall back to the highest release of
    // any kind so an incompatible-only id is still shown (as incompatible).
    const compatible = pickBestRelease(index, id);
    const best =
      compatible ??
      index.releases
        .filter((r) => r.id === id)
        .reduce<RegistryRelease | null>(
          (acc, r) => (!acc || compareVersions(r.version, acc.version) > 0 ? r : acc),
          null
        );
    if (!best) continue;

    const installed = await readInstalled(id);
    const isInstalled = installedSet.has(id) || installed !== null;
    const hasUpdate =
      isInstalled && installed != null && compareVersions(best.version, installed.version) > 0;

    entries.push({
      id,
      version: best.version,
      title: best.title ?? id,
      description: best.description,
      author: best.author,
      icon: best.icon,
      permissions: best.permissions,
      installed: isInstalled,
      installedVersion: installed?.version,
      hasUpdate,
      compatible: compatible !== null,
      source: 'marketplace'
    });
  }
  return entries;
}
