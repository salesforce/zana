/**
 * Local (in-app authored) plugins — the "create your own plugin" feature.
 *
 * A local plugin is one the user builds INSIDE the app with the Creator agent,
 * without ever publishing it. After install it is full-trust in-process on the
 * server (same as a path/git/npm plugin). What makes it "local" is only a
 * pointer — an entry in `local.json` (see `discovery.markLocal`) recording the
 * SOURCE dir the Creator agent works in, so the hub can offer "Continue building"
 * / "Reload from source".
 *
 * The trust story (why this is safe):
 *   - The agent writes SOURCE into a scratch working dir (`workingDirFor`), which
 *     is under `~/zcc-workspace/extensions/<id>` — NEVER HOME, never a registered
 *     project, never the app data dir. Its file output there is completely INERT.
 *   - New scaffolds are `package.json` `zcc` plugins. `packAndInstallLocal`
 *     path-installs them through PluginService. A leftover `extension.json` dir
 *     still packs through the one-release shim (`installFromDir`).
 *   - The agent NEVER writes the install dir. `reinstallLocal` re-derives the
 *     working dir from `local.json` (main's own record — Rule 1). The renderer
 *     only ever passes an id.
 *
 * This module owns the pure/main-side mechanics (mint id, scaffold template,
 * pack). Deliberately electron-free so it's unit-testable (paths come in as
 * args).
 */

import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, cp, rm, writeFile, readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { derivePluginId } from '@zana-ai/zcc-domain';
import type { Result } from '@zana-ai/zcc-domain/product';
import {
  clampPluginStarterKind,
  scaffoldPlugin,
  VALID_PLUGIN_STARTER_KINDS,
  type PluginStarterKind
} from '@zana-ai/zcc-plugin-templates';

/**
 * Id shape a local extension may claim — the SAME containment gate as
 * `extension-installer.ts` `VALID_ID` (leading alphanumeric, then
 * `[a-z0-9._-]`). Kept in lockstep: the minted id becomes the install dir name,
 * so it must pass the installer's gate too or the install would reject.
 */
const VALID_ID = /^[a-z0-9][a-z0-9._-]*$/i;

/**
 * The kinds of starter template the Creator can scaffold:
 *  - `panel`        — app slot only.
 *  - `main-panel`   — server factory + app slot.
 *  - `mcp-consumer` — declares `zcc.mcpServers`.
 *  - `agent-preset` — skills / agent instructions, no panel.
 */
export type LocalExtensionKind = PluginStarterKind;

/** The allowlist main clamps a renderer-supplied `kind` against (Rule 1). */
export const VALID_LOCAL_KINDS: ReadonlySet<LocalExtensionKind> = VALID_PLUGIN_STARTER_KINDS;

/** Clamp an untrusted `kind` to a known template, defaulting to `panel`. */
export function clampLocalKind(kind: unknown): LocalExtensionKind {
  return clampPluginStarterKind(kind);
}

export interface MintIdOptions {
  /** Human name the user typed (seeds the slug). */
  name: string;
  /** Ids already taken — installed extension ids ∪ reserved built-in ids. */
  taken: ReadonlySet<string>;
}

/**
 * Mint a unique, containment-clean extension id from a human name. Slugifies the
 * name (lowercase ascii, dash-separated), clamps it, and appends a short random
 * hex suffix so two extensions named "My Tool" don't collide. Retries the suffix
 * until the id is free of `taken` and passes {@link VALID_ID}. Pure (randomness
 * from crypto); no I/O.
 *
 * The suffix is ALWAYS appended (never a bare slug) so the id is visibly minted
 * and collision-resistant even on the first try — matching the design's
 * "unique name (apiName)" requirement.
 */
export function mintLocalId(opts: MintIdOptions): string {
  const slug = slugifyId(opts.name);
  for (let attempt = 0; attempt < 1000; attempt++) {
    const suffix = randomBytes(2).toString('hex'); // 4 hex chars
    const candidate = `${slug}-${suffix}`;
    if (VALID_ID.test(candidate) && !opts.taken.has(candidate)) return candidate;
  }
  // Astronomically unlikely fallback — a longer suffix is still id-clean.
  return `${slug}-${randomBytes(8).toString('hex')}`;
}

/**
 * Slugify a human name into the id STEM (before the random suffix). Lowercases,
 * strips diacritics, collapses unsupported runs to `-`, trims, clamps to 24
 * chars, and falls back to `ext` for empty/garbage input so the result always
 * starts with an alphanumeric (VALID_ID's leading-char rule).
 */
function slugifyId(name: string): string {
  const base = (name || '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .replace(/-+$/g, '');
  return base && /^[a-z0-9]/.test(base) ? base : 'ext';
}

/**
 * The SOURCE working dir a local extension's id maps to, under the scratch
 * workspace. Built ONLY from the caller-provided `scratchRoot` + the id — never
 * from renderer/agent free-text (Rule 1/2). `scratchRoot` is
 * `store.scratchWorkspaceRoot()`; the layout is `<scratchRoot>/extensions/<id>`.
 */
export function workingDirFor(scratchRoot: string, id: string): string {
  return join(scratchRoot, 'extensions', id);
}

/**
 * True when `workingDir` is a `package.json` `zcc` plugin (the current
 * authoring model). Legacy `extension.json` dirs return false.
 */
export function isZccPluginWorkingDir(workingDir: string): boolean {
  try {
    const raw = JSON.parse(readFileSync(join(workingDir, 'package.json'), 'utf-8')) as {
      zcc?: unknown;
    };
    return raw['zcc'] !== null && typeof raw['zcc'] === 'object';
  } catch {
    return false;
  }
}

export interface ScaffoldOptions {
  id: string;
  /** Display title for the manifest. */
  name: string;
  /** One-line description surfaced in the hub. */
  description?: string;
  kind: LocalExtensionKind;
}

/**
 * Write a plugin starter into `workingDir` (created if absent). Idempotent-ish:
 * it never clobbers files the user/agent has since edited. Returns the
 * package.json path on success.
 */
export async function scaffoldLocalExtension(
  workingDir: string,
  opts: ScaffoldOptions
): Promise<Result<{ manifestPath: string }>> {
  try {
    await scaffoldPlugin({
      targetDir: workingDir,
      id: opts.id,
      name: opts.name,
      description: opts.description,
      kind: opts.kind,
      skipExisting: true
    });
    return { ok: true, value: { manifestPath: join(workingDir, 'package.json') } };
  } catch (err) {
    return {
      ok: false,
      code: 'SCAFFOLD_FAILED',
      message: err instanceof Error ? err.message : String(err)
    };
  }
}

/**
 * Pack a local extension's SOURCE working dir into a fresh staging dir holding
 * ONLY the installable bytes — the manifest plus the built `dist/` tree. Source
 * clutter (README, package.json, node_modules, src/, .git) is intentionally left
 * behind: the installed copy is the minimal runnable artifact, and packing a
 * curated allowlist (rather than the whole dir) means a stray secret the agent
 * dropped in the working dir never rides into `~/.zcc/extensions`.
 *
 * Returns the staging dir path; the caller hands it to `installFromDir` and then
 * removes it. The manifest must exist (fail-closed) — an unbuilt/empty working
 * dir yields a typed error rather than installing an id-less husk.
 */
export async function packLocalExtension(workingDir: string): Promise<Result<{ stagingDir: string }>> {
  const manifestSrc = join(workingDir, 'extension.json');
  if (!existsSync(manifestSrc)) {
    return { ok: false, code: 'NO_MANIFEST', message: `No extension.json in ${workingDir}` };
  }
  const staging = join(
    tmpdir(),
    `zcc-local-pack-${process.pid}-${randomBytes(4).toString('hex')}`
  );
  try {
    await mkdir(staging, { recursive: true });
    await copyInstallableInto(workingDir, staging);
    return { ok: true, value: { stagingDir: staging } };
  } catch (err) {
    await rm(staging, { recursive: true, force: true }).catch(() => {});
    return {
      ok: false,
      code: 'PACK_FAILED',
      message: err instanceof Error ? err.message : String(err)
    };
  }
}

/**
 * Copy the curated INSTALLABLE bytes from a source working dir into `dest` — the
 * manifest plus the built `dist/` tree, nothing else. Shared by
 * {@link packLocalExtension} (install staging) and {@link prepareShareDir}
 * (git-ready export) so the two can't drift on WHAT ships: source clutter
 * (README, package.json, node_modules, src/, .git, share/) is always left behind.
 * `dest` must already exist. The manifest must exist (callers check first).
 */
async function copyInstallableInto(workingDir: string, dest: string): Promise<void> {
  // Manifest: always. Copy verbatim (installFromDir re-validates it).
  await cp(join(workingDir, 'extension.json'), join(dest, 'extension.json'));
  // Built output: the only code that ships. Absent dist/ is allowed (a
  // manifest-only ext), but the manifest's entry.renderer must then resolve —
  // installFromDir + discovery enforce that downstream.
  const distSrc = join(workingDir, 'dist');
  if (existsSync(distSrc)) {
    await cp(distSrc, join(dest, 'dist'), { recursive: true });
  }
}

/**
 * Produce a clean, git-ready export of a local extension under
 * `<workingDir>/share` — the curated installable bytes (manifest + `dist/`) plus
 * a generated README with the "Install from Git" one-liner a peer uses to install
 * it via Track A. This is NOT a git init/commit/push — it just assembles a
 * shareable dir the user can commit and push themselves.
 *
 * Idempotent: the `share/` dir is removed and rebuilt each call, so re-running
 * after an edit always reflects the current source. `share/` is deliberately a
 * sibling of the installable set and is NEVER picked up by scaffold or pack
 * (`copyInstallableInto` copies only the manifest + `dist/`), so a prepared export
 * can't recursively pack itself.
 *
 * Returns the absolute `share/` dir path on success.
 */
export async function prepareShareDir(workingDir: string): Promise<Result<{ shareDir: string }>> {
  const plugin = isZccPluginWorkingDir(workingDir);
  const manifestSrc = join(workingDir, plugin ? 'package.json' : 'extension.json');
  if (!existsSync(manifestSrc)) {
    return { ok: false, code: 'NO_MANIFEST', message: `No plugin manifest in ${workingDir}` };
  }
  const shareDir = join(workingDir, 'share');
  try {
    await rm(shareDir, { recursive: true, force: true });
    await mkdir(shareDir, { recursive: true });
    if (plugin) {
      await cp(manifestSrc, join(shareDir, 'package.json'));
      for (const rel of ['server.mjs', 'app.js', 'server.ts', 'app.tsx', 'CLAUDE.md']) {
        const src = join(workingDir, rel);
        if (existsSync(src)) await cp(src, join(shareDir, rel));
      }
      const skills = join(workingDir, 'skills');
      if (existsSync(skills)) await cp(skills, join(shareDir, 'skills'), { recursive: true });
      const id = await readWorkingDirId(workingDir);
      await writeFile(join(shareDir, 'README.md'), pluginShareReadme(id ?? 'plugin'), 'utf-8');
    } else {
      await copyInstallableInto(workingDir, shareDir);
      const manifest = JSON.parse(await readFile(manifestSrc, 'utf-8')) as {
        id?: string;
        title?: string;
        description?: string;
        version?: string;
      };
      await writeFile(join(shareDir, 'README.md'), shareReadme(manifest), 'utf-8');
    }
    return { ok: true, value: { shareDir } };
  } catch (err) {
    await rm(shareDir, { recursive: true, force: true }).catch(() => {});
    return {
      ok: false,
      code: 'SHARE_FAILED',
      message: err instanceof Error ? err.message : String(err)
    };
  }
}

function pluginShareReadme(id: string): string {
  return [
    `# ${id}`,
    '',
    '## Install',
    '',
    'In Zana Command Center: **Plugins → Browse**, then Install from folder or',
    '`zcc plugin install path:' + id + '`.',
    '',
    'Plugins run in-process on the server after install (full trust). Host-daemon tokens stay on the server.',
    ''
  ].join('\n');
}

/** Generate the README shipped in a share export, with the install one-liner. */
function shareReadme(m: { id?: string; title?: string; description?: string; version?: string }): string {
  const title = m.title || m.id || 'Extension';
  const lines = [
    `# ${title}`,
    '',
    m.description ? m.description : '',
    m.version ? `\nVersion: ${m.version}` : '',
    '',
    '## Install',
    '',
    'In Zana Command Center: **Settings → Extensions → Marketplace → Install from repo…**,',
    'then paste this repository’s URL (and a subfolder, if the manifest is not at the root).',
    '',
    'The code is not reviewed by Zana — you’ll be asked to approve what it can do before it runs.',
    ''
  ];
  return lines.filter((l) => l !== undefined).join('\n');
}

/**
 * Read the `id` a working dir's manifest declares (for reinstall path sanity —
 * the packed id must match the registry key). Null on any read/parse failure.
 */
export async function readWorkingDirId(workingDir: string): Promise<string | null> {
  try {
    const pkg = JSON.parse(await readFile(join(workingDir, 'package.json'), 'utf-8')) as {
      name?: unknown;
      zcc?: unknown;
    };
    if (pkg['zcc'] && typeof pkg.name === 'string' && pkg.name) {
      return derivePluginId(pkg.name);
    }
  } catch {
    /* fall through to the one-release extension.json shim */
  }
  try {
    const raw = JSON.parse(await readFile(join(workingDir, 'extension.json'), 'utf-8')) as {
      id?: unknown;
    };
    return typeof raw.id === 'string' && raw.id ? raw.id : null;
  } catch {
    return null;
  }
}
