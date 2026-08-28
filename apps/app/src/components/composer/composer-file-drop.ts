import { FS_ENTRY_DRAG_MIME, parseFsEntryDrag } from '../../lib/fs-entry-drag.js';
import { mentionAttrsForSuggestion } from './mention-attrs.js';
import type { PathEntryKind } from './types.js';

export interface DroppedPath {
  path: string;
  name: string;
  entryKind: PathEntryKind;
}

export interface DroppedPathTransfer {
  types: readonly string[];
  files: readonly File[];
  items?: ArrayLike<{ kind: string; webkitGetAsEntry?: () => { isDirectory: boolean } | null }>;
  getData: (type: string) => string;
  pathForFile: (file: File) => string;
  projectRoot?: string | null;
}

function basename(path: string): string {
  const trimmed = path.replace(/\/+$/u, '');
  const parts = trimmed.split('/').filter(Boolean);
  return parts.at(-1) ?? path;
}

function normalizeDroppedPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/u, '') || path;
}

export function workspaceRelativeDroppedPath(
  path: string,
  projectRoot?: string | null
): { path: string; name: string } {
  const normalized = normalizeDroppedPath(path);
  const name = basename(normalized);
  if (!projectRoot) return { path: normalized, name };
  const root = normalizeDroppedPath(projectRoot);
  if (normalized === root) return { path: '.', name };
  if (normalized.startsWith(`${root}/`)) {
    return { path: normalized.slice(root.length + 1), name };
  }
  return { path: normalized, name };
}

export function isComposerPathDrag(types: readonly string[]): boolean {
  return types.includes('Files') || types.includes(FS_ENTRY_DRAG_MIME);
}

function safePathForFile(file: File, pathForFile: (file: File) => string): string {
  try {
    return pathForFile(file) || '';
  } catch {
    return '';
  }
}

function fileEntryKinds(items: DroppedPathTransfer['items']): PathEntryKind[] {
  if (!items) return [];
  const kinds: PathEntryKind[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item?.kind !== 'file') continue;
    kinds.push(item.webkitGetAsEntry?.()?.isDirectory ? 'directory' : 'file');
  }
  return kinds;
}

function toDroppedPath(
  absolutePath: string,
  entryKind: PathEntryKind,
  projectRoot?: string | null
): DroppedPath | null {
  if (!absolutePath) return null;
  const relative = workspaceRelativeDroppedPath(absolutePath, projectRoot);
  if (!relative.path) return null;
  return { ...relative, entryKind };
}

function uniqueDroppedPaths(rows: DroppedPath[]): DroppedPath[] {
  const seen = new Set<string>();
  const unique: DroppedPath[] = [];
  for (const row of rows) {
    const key = `${row.entryKind}:${row.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }
  return unique;
}

export function droppedPathsFromDataTransfer(transfer: DroppedPathTransfer): DroppedPath[] {
  const kinds = fileEntryKinds(transfer.items);
  const fromFiles = transfer.files.flatMap((file, index) => {
    const dropped = toDroppedPath(
      safePathForFile(file, transfer.pathForFile),
      kinds[index] ?? 'file',
      transfer.projectRoot
    );
    return dropped ? [dropped] : [];
  });
  if (transfer.files.length > 0) return uniqueDroppedPaths(fromFiles);

  const fromExplorer = parseFsEntryDrag(transfer.getData(FS_ENTRY_DRAG_MIME)).flatMap((entry) => {
    const dropped = toDroppedPath(
      entry.path,
      entry.kind === 'dir' ? 'directory' : 'file',
      transfer.projectRoot
    );
    return dropped ? [dropped] : [];
  });
  if (fromExplorer.length > 0) return uniqueDroppedPaths(fromExplorer);

  const fromText = transfer.getData('text/plain')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('/'))
    .flatMap((line) => {
      const dropped = toDroppedPath(line, 'file', transfer.projectRoot);
      return dropped ? [dropped] : [];
    });
  return uniqueDroppedPaths(fromText);
}

export function droppedPathsFromAbsolutePaths(
  paths: readonly string[],
  projectRoot?: string | null
): DroppedPath[] {
  return uniqueDroppedPaths(paths.flatMap((path) => {
    const dropped = toDroppedPath(path.trim(), 'file', projectRoot);
    return dropped ? [dropped] : [];
  }));
}

export function mentionContentForDroppedPaths(paths: DroppedPath[]) {
  return paths.flatMap((row) => [
    {
      type: 'mention',
      attrs: mentionAttrsForSuggestion({
        kind: 'path',
        path: row.path,
        name: row.name,
        entryKind: row.entryKind
      })
    },
    { type: 'text', text: ' ' }
  ]);
}
