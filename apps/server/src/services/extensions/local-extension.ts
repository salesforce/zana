/**
 * Local (in-app authored) extensions — the "create your own extension" feature.
 *
 * A local extension is one the user builds INSIDE the app with the Extension
 * Creator agent, without ever publishing it. It is NOT a special trust tier: it
 * lives in the same `~/.zcc/extensions/<id>` dir as any disk extension and is
 * subject to the SAME P3-D consent + broker gates. What makes it "local" is only
 * a pointer — an entry in `local.json` (see `discovery.markLocal`) recording the
 * SOURCE dir the Creator agent works in, so the hub can offer "Continue building"
 * / "Reload from source".
 *
 * The trust story (why this is safe):
 *   - The agent writes SOURCE into a scratch working dir (`workingDirFor`), which
 *     is under `~/zcc-workspace/extensions/<id>` — NEVER HOME, never a registered
 *     project, never any `~/.zcc` path. Its file output there is completely INERT.
 *   - Nothing runs until main PACKS the source into a staging dir (manifest +
 *     `dist/` only) and hands it to the SINGLE trusted install seam
 *     (`installFromDir`), which re-runs every manifest/id/api/reserved gate.
 *   - The agent NEVER writes the install dir. `reinstallLocal` re-derives the
 *     working dir from `local.json` (main's own record — Rule 1), re-packs, and
 *     re-installs. The renderer only ever passes an id.
 *
 * This module owns the pure/main-side mechanics (mint id, scaffold template,
 * pack). The IPC handlers in index.ts wire it to consent/discovery + the agent
 * launch. Deliberately electron-free so it's unit-testable (paths come in as
 * args); it honors the `ZCC_EXTENSIONS_DIR` override the rest of the extension
 * pipeline uses.
 */

import { join, dirname, relative } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, cp, rm, writeFile, readFile, readdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { SDK_API_VERSION } from '@zana-ai/zcc-extension-sdk';
import type { Result } from '@zana-ai/zcc-domain/product';

/**
 * Id shape a local extension may claim — the SAME containment gate as
 * `extension-installer.ts` `VALID_ID` (leading alphanumeric, then
 * `[a-z0-9._-]`). Kept in lockstep: the minted id becomes the install dir name,
 * so it must pass the installer's gate too or the install would reject.
 */
const VALID_ID = /^[a-z0-9][a-z0-9._-]*$/i;

/**
 * The kinds of starter template the Creator can scaffold, along the trust ladder:
 *  - `panel`        — renderer-only, no permissions (default).
 *  - `main-panel`   — main + renderer; declares `exec` (git) — trips consent.
 *  - `mcp-consumer` — declares `mcp`; ships a placeholder allowlist + TODO.
 *  - `agent-preset` — a framework Quick Agent preset; no main, no permissions.
 */
export type LocalExtensionKind = 'panel' | 'main-panel' | 'mcp-consumer' | 'agent-preset';

/** The allowlist main clamps a renderer-supplied `kind` against (Rule 1). */
export const VALID_LOCAL_KINDS: ReadonlySet<LocalExtensionKind> = new Set<LocalExtensionKind>([
  'panel',
  'main-panel',
  'mcp-consumer',
  'agent-preset'
]);

/** Clamp an untrusted `kind` to a known template, defaulting to `panel`. */
export function clampLocalKind(kind: unknown): LocalExtensionKind {
  return typeof kind === 'string' && VALID_LOCAL_KINDS.has(kind as LocalExtensionKind)
    ? (kind as LocalExtensionKind)
    : 'panel';
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
 * Resolve the editable starter-template root for a given `kind` — the
 * repo-committed `templates/extension-starter/<kind>` dir that
 * {@link scaffoldLocalExtension} copies and token-substitutes. Mirrors
 * `extension-installer.ts` `bundledRoot`: a test override
 * (`ZCC_EXTENSION_TEMPLATE_DIR`) is authoritative; packaged builds read
 * `process.resourcesPath/extension-template` (electron-builder `extraResources`);
 * dev reads the committed source (`__dirname = out/main`, so `../../templates/…`).
 *
 * For each base we prefer the per-kind subdir (`<base>/<kind>`) and fall back to
 * the FLAT `<base>` layout when the subdir is absent, so an older packaged build
 * (single flat `panel` template) still scaffolds a panel without regressing.
 * Returns the first that exists, or null (caller falls back to the inline minimal
 * scaffold so a missing template never blocks creation).
 */
function templateRoot(kind: LocalExtensionKind): string | null {
  const override = process.env.ZCC_EXTENSION_TEMPLATE_DIR;
  const bases = override
    ? [override]
    : [
        process.resourcesPath ? join(process.resourcesPath, 'extension-template') : null,
        join(__dirname, '../../templates/extension-starter')
      ].filter((p): p is string => !!p);
  for (const base of bases) {
    const perKind = join(base, kind);
    if (existsSync(perKind)) return perKind;
    // Back-compat: a flat base is the old panel-only layout. Only honor it for
    // the panel kind so a non-panel kind never silently scaffolds a panel.
    if (kind === 'panel' && existsSync(join(base, 'extension.json'))) return base;
  }
  return null;
}

/**
 * The token → value map applied to every template file's TEXT contents. Kept
 * tiny and literal so the template stays a normal, runnable project a maintainer
 * can open and edit directly. `__EXT_API_MAJOR__` is the SDK's major so the
 * scaffolded manifest's `engines.zccApi` tracks the shipped SDK.
 */
function templateTokens(opts: ScaffoldOptions): Record<string, string> {
  const apiMajor = String(SDK_API_VERSION);
  return {
    __EXT_ID__: opts.id,
    __EXT_TITLE__: opts.name.replace(/["\\]/g, ''),
    __EXT_DESCRIPTION__: (opts.description || `${opts.name} — a local extension.`).replace(
      /["\\]/g,
      ''
    ),
    __EXT_API_MAJOR__: apiMajor
  };
}

/** Apply the token map to a template file's text (all occurrences, literal). */
function applyTokens(text: string, tokens: Record<string, string>): string {
  let out = text;
  for (const [token, value] of Object.entries(tokens)) {
    out = out.split(token).join(value);
  }
  return out;
}

export interface ScaffoldOptions {
  id: string;
  /** Display title for the manifest. */
  name: string;
  /** One-line description surfaced in the hub + consent screen. */
  description?: string;
  kind: LocalExtensionKind;
}

/**
 * Write a starter template into `workingDir` (created if absent). Idempotent-ish:
 * it never clobbers files the user/agent has since edited — an existing file is
 * left as-is (so re-scaffolding a dir the agent already worked in is safe). The
 * template is renderer-only (no `main`, no build step): `dist/renderer.js` is
 * plain ESM the host blob-imports, so the extension activates live with no
 * relaunch. It declares NO permissions — the user/agent adds them deliberately,
 * and each addition re-triggers consent.
 *
 * Returns the manifest path on success.
 */
export async function scaffoldLocalExtension(
  workingDir: string,
  opts: ScaffoldOptions
): Promise<Result<{ manifestPath: string }>> {
  try {
    const manifestPath = join(workingDir, 'extension.json');
    const root = templateRoot(opts.kind);
    if (root) {
      // Preferred path: copy the editable repo template, substituting tokens in
      // every file's text. A maintainer enhances the starter by editing files
      // under `templates/extension-starter/` — no code change here needed.
      await scaffoldFromTemplate(root, workingDir, templateTokens(opts));
    } else {
      // Fallback: the template dir wasn't found (e.g. a stripped build). Emit a
      // minimal renderer-only scaffold inline so creation never hard-fails.
      await scaffoldMinimal(workingDir, opts);
    }
    return { ok: true, value: { manifestPath } };
  } catch (err) {
    return {
      ok: false,
      code: 'SCAFFOLD_FAILED',
      message: err instanceof Error ? err.message : String(err)
    };
  }
}

/**
 * Copy every file under `root` into `workingDir`, applying {@link applyTokens} to
 * each file's TEXT. Never clobbers a file the agent/user already edited
 * (writeIfAbsent), so re-scaffolding a worked-in dir is safe. Directory structure
 * is preserved (so `dist/renderer.js` lands under `dist/`).
 */
async function scaffoldFromTemplate(
  root: string,
  workingDir: string,
  tokens: Record<string, string>
): Promise<void> {
  const files = await listTemplateFiles(root);
  for (const abs of files) {
    const rel = relative(root, abs);
    const dest = join(workingDir, rel);
    if (existsSync(dest)) continue; // never clobber
    const raw = await readFile(abs, 'utf-8');
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, applyTokens(raw, tokens), 'utf-8');
  }
}

/** Recursively list every file (not dir) under `dir`, absolute paths. */
async function listTemplateFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const e of entries) {
    const abs = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listTemplateFiles(abs)));
    else if (e.isFile()) out.push(abs);
  }
  return out;
}

/**
 * Fallback scaffold when the editable template dir is absent — the smallest
 * runnable renderer-only extension. Deliberately minimal (no projectTab, no
 * CLAUDE.md prose) so it can't drift from the real template; the real template
 * (`templates/extension-starter/`) is the maintained one.
 */
async function scaffoldMinimal(workingDir: string, opts: ScaffoldOptions): Promise<void> {
  await mkdir(join(workingDir, 'dist'), { recursive: true });
  const manifest = {
    id: opts.id,
    version: '0.1.0',
    title: opts.name,
    icon: 'Puzzle',
    description: opts.description || `${opts.name} — a local extension.`,
    author: 'You',
    entry: { renderer: 'dist/renderer.js' },
    engines: { zccApi: `^${SDK_API_VERSION}.0.0` },
    permissions: [] as string[]
  };
  // title is emitted via JSON.stringify below (double-quoted, backtick-safe), so
  // no need to sanitize it for the surrounding template literal.
  const title = opts.name;
  const renderer = `export default {
  activate({ React, host }) {
    const { createElement: h, useState } = React;
    return function Panel() {
      const [count, setCount] = useState(0);
      return h(
        'div',
        { style: { padding: 24, fontFamily: 'system-ui, sans-serif' } },
        h('h2', { style: { marginTop: 0 } }, ${JSON.stringify(title)}),
        h(
          'p',
          { style: { color: 'var(--text-muted, #8b949e)', fontSize: 13 } },
          'Your local extension is live. Edit dist/renderer.js and reload.'
        ),
        h(
          'button',
          {
            className: 'btn',
            onClick: () => {
              setCount((n) => n + 1);
              host.toast && host.toast('Hello from ' + host.moduleId);
            }
          },
          'Clicked ' + count + ' times'
        )
      );
    };
  }
};
`;
  await writeIfAbsent(join(workingDir, 'extension.json'), JSON.stringify(manifest, null, 2) + '\n');
  await writeIfAbsent(join(workingDir, 'dist', 'renderer.js'), renderer);
}

/** Write `contents` to `file` only if it doesn't already exist (never clobber). */
async function writeIfAbsent(file: string, contents: string): Promise<void> {
  if (existsSync(file)) return;
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, contents, 'utf-8');
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
  const manifestSrc = join(workingDir, 'extension.json');
  if (!existsSync(manifestSrc)) {
    return { ok: false, code: 'NO_MANIFEST', message: `No extension.json in ${workingDir}` };
  }
  const shareDir = join(workingDir, 'share');
  try {
    await rm(shareDir, { recursive: true, force: true }); // idempotent — rebuild
    await mkdir(shareDir, { recursive: true });
    await copyInstallableInto(workingDir, shareDir);
    const manifest = JSON.parse(await readFile(manifestSrc, 'utf-8')) as {
      id?: string;
      title?: string;
      description?: string;
      version?: string;
    };
    await writeFile(shareDir + '/README.md', shareReadme(manifest), 'utf-8');
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
    const raw = JSON.parse(await readFile(join(workingDir, 'extension.json'), 'utf-8')) as {
      id?: unknown;
    };
    return typeof raw.id === 'string' && raw.id ? raw.id : null;
  } catch {
    return null;
  }
}
