import { existsSync } from 'node:fs';
import { join } from 'node:path';

export type ResolveIconPathOpts = {
  /** `app.isPackaged`. Unpackaged (`pnpm dev`) uses the DEV-badged icon. */
  packaged: boolean;
  /** Directory of the calling module (`import.meta.url`). */
  moduleDir: string;
  /** Packaged `process.resourcesPath`. Ignored when unpackaged. */
  resourcesPath?: string | null;
  /** electron-vite's process cwd (repo root in `pnpm dev`). */
  cwd?: string | null;
  exists?: (path: string) => boolean;
};

const DEV_ICON = 'icon-dev.png';
const PACKAGED_ICONS = ['icon.icns', 'icon-1024.png'] as const;
const UNPACKAGED_ICONS = [DEV_ICON] as const;

/**
 * Candidate paths for the branded Zana icon.
 *
 * Unpackaged (`pnpm dev`) resolves only `icon-dev.png` (DEV-badged), never
 * the shipping artwork — running both side-by-side must stay visually
 * distinct. Packaged reads the extraResources / mac.icon copy at
 * `process.resourcesPath`. electron-vite emits main at `out/main` and
 * shared chunks at `out/main/chunks`, so unpackaged also walks those + cwd.
 */
export function iconPathCandidates(opts: {
  packaged: boolean;
  moduleDir: string;
  resourcesPath?: string | null;
  cwd?: string | null;
}): string[] {
  if (opts.packaged) {
    if (!opts.resourcesPath) return [];
    return PACKAGED_ICONS.map((file) => join(opts.resourcesPath!, file));
  }

  const roots = [
    join(opts.moduleDir, '../../resources'),
    // Shared chunks emit below out/main/chunks, unlike the main entry.
    join(opts.moduleDir, '../../../resources')
  ];
  if (opts.cwd) roots.push(join(opts.cwd, 'resources'));
  return roots.flatMap((root) => UNPACKAGED_ICONS.map((file) => join(root, file)));
}

function firstExisting(
  paths: readonly string[],
  exists: (path: string) => boolean
): string | null {
  for (const path of paths) {
    if (exists(path)) return path;
  }
  return null;
}

export function resolveIconPath(opts: ResolveIconPathOpts): string | null {
  const exists = opts.exists ?? existsSync;
  return firstExisting(iconPathCandidates(opts), exists);
}
