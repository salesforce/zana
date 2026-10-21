/**
 * Windows resolution for the external-editor openers ("Open in VS Code" etc.).
 *
 * On Windows the editors' CLI shims are batch files (`code.cmd`, `cursor.cmd`,
 * `idea.bat`). Node's `spawn` can't start them without a shell: a bare `code`
 * misses PATHEXT (ENOENT) and `code.cmd` is refused outright (EINVAL, the
 * CVE-2024-27980 fix). Going through `cmd.exe` would re-parse project paths as
 * shell syntax, so instead we resolve what the shim runs and spawn that
 * directly: `Code.exe` / `Cursor.exe` as Node on their `cli.js` (like the
 * shim), or `idea64.exe` with the path.
 *
 * Resolution order: the configured binary (absolute path or PATH lookup with
 * PATHEXT) → the `.exe` it names (itself, a quoted `.exe` inside the shim, or a
 * sibling `<name>64.exe`) → the editor's default install folders. Filesystem
 * access is injected so the logic is testable on any host OS, and async so a
 * slow PATH entry (an unreachable network share, say) never blocks the event
 * loop.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { win32 as path } from 'node:path';
import type { EditorTarget } from '@zana-ai/zcc-domain/product';

export interface WindowsEditorFs {
  env: NodeJS.ProcessEnv;
  isFile(p: string): Promise<boolean>;
  /** File text, or null when unreadable or larger than `maxBytes`. */
  readText(p: string, maxBytes: number): Promise<string | null>;
  /** Directory entry names, or [] when unreadable. */
  listDir(p: string): Promise<string[]>;
}

/** Shims are tiny; anything bigger isn't a launcher we can parse. */
const MAX_SHIM_BYTES = 64 * 1024;
/** IntelliJ's `product-info.json` lists every bundled plugin, so it can pass 64 KiB. */
const MAX_JSON_BYTES = 4 * 1024 * 1024;

export const realWindowsEditorFs: WindowsEditorFs = {
  env: process.env,
  isFile: async (p) => {
    try {
      return (await stat(p)).isFile();
    } catch {
      return false;
    }
  },
  readText: async (p, maxBytes) => {
    try {
      if ((await stat(p)).size > maxBytes) return null;
      return await readFile(p, 'utf8');
    } catch {
      return null;
    }
  },
  listDir: async (p) => {
    try {
      return await readdir(p);
    } catch {
      return [];
    }
  }
};

/**
 * Completes "install it (…)" in Settings → Editor and "Install it … in
 * Settings → Editor." in the opener's failure toast.
 */
export const WINDOWS_INSTALL_HINTS: Record<EditorTarget, string> = {
  cursor: 'from cursor.com, or set its CLI launcher to the full path of Cursor.exe',
  code: 'from code.visualstudio.com, or set its CLI launcher to the full path of Code.exe',
  intellij: 'from jetbrains.com, or set its CLI launcher to the full path of idea64.exe'
};

function envDir(env: NodeJS.ProcessEnv, key: string): string | null {
  // Windows env names are case-insensitive; Node preserves the original case.
  const hit = Object.keys(env).find((k) => k.toUpperCase() === key);
  const value = hit ? env[hit]?.trim() : '';
  return value || null;
}

/** The first of `paths` that is an existing file, checked in order. */
async function firstFile(paths: string[], fs: WindowsEditorFs): Promise<string | null> {
  for (const p of paths) if (await fs.isFile(p)) return p;
  return null;
}

/** Find `binary` the way cmd.exe would: as a path, else on PATH with PATHEXT. */
async function findOnPath(binary: string, fs: WindowsEditorFs): Promise<string | null> {
  // Like cmd.exe, an extensionless name only matches PATHEXT files — VS Code's
  // `bin` folder also holds an extensionless `code` script for POSIX shells.
  const exts = path.extname(binary)
    ? ['']
    : (envDir(fs.env, 'PATHEXT') ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).map((e) => e.toLowerCase());
  const withExts = (base: string) => exts.map((e) => base + e);
  if (path.isAbsolute(binary) || /[\\/]/.test(binary)) {
    return firstFile(withExts(binary), fs);
  }
  const dirs = (envDir(fs.env, 'PATH') ?? '').split(';').map((d) => d.trim().replace(/^"|"$/g, '')).filter(Boolean);
  for (const dir of dirs) {
    const hit = await firstFile(withExts(path.join(dir, binary)), fs);
    if (hit) return hit;
  }
  return null;
}

/**
 * Existing files a shim names in double quotes with extension `ext`, e.g.
 * `"%~dp0..\Code.exe"` (VS Code / Cursor) or an absolute `"C:\…\idea64.exe"`
 * (JetBrains Toolbox scripts). `%~dp0` is the shim's own folder.
 */
async function quotedFiles(shim: string, ext: string, fs: WindowsEditorFs): Promise<string[]> {
  const dir = path.dirname(shim);
  const text = (await fs.readText(shim, MAX_SHIM_BYTES)) ?? '';
  const found: string[] = [];
  for (const match of text.matchAll(new RegExp(`"([^"\\r\\n]+?\\${ext})"`, 'gi'))) {
    const raw = match[1].replace(/%~dp0/gi, dir + path.sep);
    if (raw.includes('%')) continue;
    const file = path.resolve(dir, raw);
    if (await fs.isFile(file)) found.push(file);
  }
  return found;
}

/** The GUI executable a shim launches: a quoted `.exe` it names, else a sibling. */
async function exeFromShim(shim: string, fs: WindowsEditorFs): Promise<string | null> {
  if (path.extname(shim).toLowerCase() === '.exe') return shim;
  const [named] = await quotedFiles(shim, '.exe', fs);
  if (named) return named;
  const dir = path.dirname(shim);
  const base = path.basename(shim, path.extname(shim));
  return firstFile([`${base}64.exe`, `${base}.exe`].map((n) => path.join(dir, n)), fs);
}

/**
 * The `cli.js` that VS Code / Cursor's shim runs with the exe as Node
 * (`ELECTRON_RUN_AS_NODE=1 Code.exe …\out\cli.js %*`). Read from the shim that
 * named `exe`, else from the one shipped in the install (`bin\code.cmd`,
 * `resources\app\bin\cursor.cmd`), so an exe found directly gets it too.
 */
async function cliJsFor(
  target: EditorTarget,
  exe: string,
  shim: string | null,
  fs: WindowsEditorFs
): Promise<string | undefined> {
  if (target === 'intellij') return undefined;
  const dir = path.dirname(exe);
  const name = path.basename(exe, path.extname(exe)).toLowerCase();
  const shims = [shim, path.join(dir, 'bin', `${name}.cmd`), path.join(dir, 'resources', 'app', 'bin', `${name}.cmd`)];
  for (const candidate of shims) {
    // Only a shim that launches this very exe knows its matching cli.js.
    if (!candidate || !(await quotedFiles(candidate, '.exe', fs)).some((e) => e.toLowerCase() === exe.toLowerCase())) continue;
    const [cliJs] = await quotedFiles(candidate, '.js', fs);
    if (cliJs) return cliJs;
  }
  return undefined;
}

/** The trailing version in an install folder name: `IntelliJ IDEA Community Edition 2025.2` → [2025, 2]. */
function folderVersion(name: string): number[] {
  return name.match(/(\d+(?:\.\d+)*)\s*$/)?.[1].split('.').map(Number) ?? [];
}

/** Newest first; a name without a version sorts after every versioned one. */
function byVersionDesc(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (b[i] ?? -1) - (a[i] ?? -1);
    if (diff) return diff;
  }
  return 0;
}

/** Default per-user and machine-wide install locations, newest IntelliJ first. */
async function defaultInstalls(target: EditorTarget, fs: WindowsEditorFs): Promise<string[]> {
  const local = envDir(fs.env, 'LOCALAPPDATA');
  const programs = [envDir(fs.env, 'PROGRAMFILES'), envDir(fs.env, 'PROGRAMFILES(X86)')].filter((d): d is string => !!d);
  const under = (roots: (string | null)[], ...rel: string[]) =>
    roots.filter((r): r is string => !!r).map((r) => path.join(r, ...rel));
  switch (target) {
    case 'code':
      return [
        ...under([local], 'Programs', 'Microsoft VS Code', 'Code.exe'),
        ...under(programs, 'Microsoft VS Code', 'Code.exe')
      ];
    case 'cursor':
      return [...under([local], 'Programs', 'cursor', 'Cursor.exe'), ...under(programs, 'Cursor', 'Cursor.exe')];
    case 'intellij': {
      // Rank the folders of every root together, by version rather than name,
      // so neither the root order nor an edition name picks an older install.
      const parents = [...under([local], 'Programs'), ...under(programs, 'JetBrains')];
      const listed = await Promise.all(
        parents.map(async (parent) =>
          (await fs.listDir(parent)).filter((name) => /^IntelliJ IDEA/i.test(name)).map((name) => ({ parent, name }))
        )
      );
      return listed
        .flat()
        .sort((a, b) => byVersionDesc(folderVersion(a.name), folderVersion(b.name)) || b.name.localeCompare(a.name))
        .map(({ parent, name }) => path.join(parent, name, 'bin', 'idea64.exe'));
    }
  }
}

/** How to start an editor on Windows without a shell. */
export interface WindowsEditorLaunch {
  /** The editor's own executable. */
  exe: string;
  /**
   * VS Code / Cursor's CLI script. When set, run `exe cliJs …args` with
   * `ELECTRON_RUN_AS_NODE=1`, exactly as the shim does: launching the GUI exe
   * with `-n <folder>` while the editor is already running opens nothing.
   */
  cliJs?: string;
}

/**
 * Resolve how to launch `target` (directly, no shell), given the configured
 * CLI name or path (`code`, a user override, …). Null when the editor can't be
 * found.
 */
export async function resolveWindowsEditorLaunch(
  target: EditorTarget,
  binary: string,
  fs: WindowsEditorFs = realWindowsEditorFs
): Promise<WindowsEditorLaunch | null> {
  const shim = binary.trim() ? await findOnPath(binary.trim(), fs) : null;
  const viaShim = shim ? await exeFromShim(shim, fs) : null;
  const exe = viaShim ?? (await firstFile(await defaultInstalls(target, fs), fs));
  if (!exe) return null;
  const cliJs = await cliJsFor(target, exe, viaShim ? shim : null, fs);
  return cliJs ? { exe, cliJs } : { exe };
}

/** The editor's executable (see `resolveWindowsEditorLaunch`), or null. */
export async function resolveWindowsEditor(
  target: EditorTarget,
  binary: string,
  fs: WindowsEditorFs = realWindowsEditorFs
): Promise<string | null> {
  return (await resolveWindowsEditorLaunch(target, binary, fs))?.exe ?? null;
}

async function jsonField(file: string, fs: WindowsEditorFs, ...keys: string[]): Promise<string[]> {
  const text = await fs.readText(file, MAX_JSON_BYTES);
  if (!text) return [];
  try {
    const json = JSON.parse(text) as Record<string, unknown>;
    return keys.map((k) => (typeof json[k] === 'string' ? (json[k] as string).trim() : '')).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * The editor's version, read from its install files rather than by running it
 * (`Code.exe --version` would open a window). VS Code and Cursor report their
 * `resources\app\package.json` version, the same one `code --version` prints;
 * newer VS Code builds keep `resources` under a commit-named subfolder.
 * IntelliJ reports `product-info.json`'s name and version.
 */
export async function windowsEditorVersion(
  target: EditorTarget,
  exe: string,
  fs: WindowsEditorFs = realWindowsEditorFs
): Promise<string | undefined> {
  const dir = path.dirname(exe);
  if (target === 'intellij') {
    const parts = await jsonField(path.join(dir, '..', 'product-info.json'), fs, 'name', 'version');
    return parts.length === 2 ? parts.join(' ') : undefined;
  }
  const appDirs = [dir, ...(await fs.listDir(dir)).map((name) => path.join(dir, name))].map((d) =>
    path.join(d, 'resources', 'app', 'package.json')
  );
  for (const pkg of appDirs) {
    const [version] = await jsonField(pkg, fs, 'version');
    if (version) return version;
  }
  return undefined;
}
