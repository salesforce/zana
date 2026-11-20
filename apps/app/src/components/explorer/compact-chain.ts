import type { FsEntry } from '@zana-ai/zcc-domain/product';

/**
 * The single-child folder chain starting at `head`: `head` plus each sole
 * folder child while the parent is expanded and its listing is loaded. A
 * folder with any sibling (or a file child) ends the chain. Never contains
 * files; a non-folder head is a chain of one.
 */
export function compactChain(
  head: FsEntry,
  entries: ReadonlyMap<string, FsEntry[]>,
  expanded: ReadonlyMap<string, boolean>
): FsEntry[] {
  const chain = [head];
  if (head.kind !== 'dir') return chain;
  let tail = head;
  while (expanded.get(tail.path) === true) {
    const children = entries.get(tail.path);
    const only = children?.length === 1 ? children[0] : undefined;
    if (!only || only.kind !== 'dir') break;
    chain.push(only);
    tail = only;
  }
  return chain;
}

/**
 * Folders that should be auto-expanded so a chain can keep compacting: the
 * sole folder child of an expanded folder that the user has not toggled yet
 * (`expanded` has no entry for it). A folder the user collapsed stays collapsed.
 */
export function compactAutoExpand(
  entries: ReadonlyMap<string, FsEntry[]>,
  expanded: ReadonlyMap<string, boolean>,
  loading: ReadonlySet<string>
): string[] {
  const paths: string[] = [];
  for (const [path, children] of entries) {
    if (expanded.get(path) !== true || children.length !== 1) continue;
    const only = children[0]!;
    if (only.kind !== 'dir' || expanded.has(only.path) || loading.has(only.path)) continue;
    paths.push(only.path);
  }
  return paths;
}
