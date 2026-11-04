import type { FsEntry } from '@zana-ai/zcc-domain/product';
import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';

interface ExplorerFileRevealOptions {
  /** Shared directory loader instance (e.g. from `useDirectoryLoader`). */
  loadDir: (path: string, force?: boolean) => Promise<FsEntry[]>;
  setExpanded: React.Dispatch<React.SetStateAction<Map<string, boolean>>>;
  treeBodyRef: React.RefObject<HTMLDivElement | null>;
  /** The tree's current root; a walk for an older root stops. */
  activeRoot: React.RefObject<string>;
  treeMode: string;
}

// "Reveal the open file" for the Explorer tree, like VS Code's reveal active file.
// `revealFile` walks down from the root through the listed entries using `loadDir`,
// expanding each ancestor folder, then the row scrolls into the tree pane once
// it renders. Matching listed entries (instead of splicing path strings) keeps
// Windows `\` paths working and stops at anything the listing hides (denied folders,
// the per-directory entry cap, or a path outside the root).
export function useExplorerFileReveal({ loadDir, setExpanded, treeBodyRef, activeRoot, treeMode }: ExplorerFileRevealOptions) {
  const loadDirRef = useRef(loadDir);
  loadDirRef.current = loadDir;
  const revealSeqRef = useRef(0);
  const pendingScrollRef = useRef<string | null>(null);
  // Bumped when a walk finds its row, so the layout effect below runs even if
  // every ancestor was already expanded and loaded (no other state changed).
  const [, setRevealTick] = useState(0);

  const cancelReveal = useCallback(() => {
    revealSeqRef.current++;
    pendingScrollRef.current = null;
  }, []);

  // Each step is one capped listDir, and a newer open cancels an older walk.
  // The walk only ever descends into an entry that is a strict path prefix of
  // the target, so it ends within the target's segment count at any depth.
  const revealFile = useCallback(async (filePath: string, root: string) => {
    const seq = ++revealSeqRef.current;
    pendingScrollRef.current = null;
    const target = slashPath(filePath);
    let dir = root;
    let dirKey = slashPath(root).replace(/\/+$/, '');
    if (!target.startsWith(dirKey + '/')) return;
    for (;;) {
      const list = await loadDirRef.current(dir);
      if (seq !== revealSeqRef.current || activeRoot.current !== root) return;
      const match = list.find((entry) => {
        const path = slashPath(entry.path);
        return path === target || target.startsWith(path + '/');
      });
      if (!match) return;
      if (match.kind === 'file') {
        pendingScrollRef.current = match.path;
        setRevealTick((n) => n + 1);
        return;
      }
      const next = match.path;
      const nextKey = slashPath(next);
      // Only descend: an entry that isn't deeper than its folder would loop.
      if (nextKey.length <= dirKey.length) return;
      setExpanded((s) => {
        if (s.get(next) === true) return s;
        const copy = new Map(s);
        copy.set(next, true);
        return copy;
      });
      dir = next;
      dirKey = nextKey;
    }
  }, [activeRoot, setExpanded]);

  // Scroll the revealed row into view inside the tree pane only (not the
  // window or outer panes), and never move keyboard focus: focus stays in the
  // viewer / picker that opened the file. A row already in view doesn't move.
  // The Changes list keeps the request until the file tree shows again; the
  // file tree drops it if the row isn't there (the user collapsed an ancestor),
  // so a later expand never scrolls to an old reveal.
  useLayoutEffect(() => {
    const path = pendingScrollRef.current;
    const body = treeBodyRef.current;
    if (!path || !body || treeMode !== 'files') return;
    pendingScrollRef.current = null;
    const row = Array.from(body.querySelectorAll<HTMLElement>('.tree-row.file')).find((el) => el.dataset.path === path);
    if (!row) return;
    const view = body.getBoundingClientRect();
    const box = row.getBoundingClientRect();
    if (box.top >= view.top && box.bottom <= view.bottom) return;
    body.scrollTop += box.top - view.top - (view.height - box.height) / 2;
  });

  return { revealFile, cancelReveal };
}

// Compare paths with `/` separators. Local Windows paths come back from listDir
// with `\`, remote and POSIX ones with `/`; the tree keys rows by the exact
// listed path, so this is only used to match, never to build a key.
function slashPath(path: string): string {
  return path.replace(/\\/g, '/');
}
