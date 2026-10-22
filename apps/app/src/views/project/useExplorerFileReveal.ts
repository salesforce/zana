import type { FsEntry } from '@zana-ai/zcc-domain/product';
import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';

interface ExplorerFileRevealOptions {
  /** Lists one folder and stores it in the tree's `entries` state. */
  fetchDir: (path: string) => Promise<FsEntry[]>;
  entries: Map<string, FsEntry[]>;
  setExpanded: React.Dispatch<React.SetStateAction<Map<string, boolean>>>;
  treeBodyRef: React.RefObject<HTMLDivElement | null>;
  /** The tree's current root; a walk for an older root stops. */
  activeRoot: React.RefObject<string>;
  treeMode: string;
}

// Lazy folder loading plus "reveal the open file" for the Explorer tree, like
// VS Code's reveal active file. `loadDir` lists a folder at most once (cached
// or joined while in flight); `revealFile` walks down from the root through the
// *listed* entries, expanding each ancestor folder, then the row scrolls into
// the tree pane once it renders. Matching listed entries (instead of splicing
// path strings) keeps Windows `\` paths working and stops at anything the
// listing hides (denied folders like node_modules, the per-directory entry cap,
// or a path outside the root), so the tree never expands a phantom folder.
export function useExplorerFileReveal({ fetchDir, entries, setExpanded, treeBodyRef, activeRoot, treeMode }: ExplorerFileRevealOptions) {
  // Listings by path: the committed `entries` plus any listing that resolved
  // since the last render, so a folder is never listed twice in that window.
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  // In-flight listings by path, so a reveal that walks a folder the mount or a
  // click is already listing joins that request instead of listing it twice.
  const pendingDirsRef = useRef(new Map<string, Promise<FsEntry[]>>());
  const loadDir = useCallback(
    (path: string, force = false): Promise<FsEntry[]> => {
      if (!force) {
        const cached = entriesRef.current.get(path);
        if (cached) return Promise.resolve(cached);
        const pending = pendingDirsRef.current.get(path);
        if (pending) return pending;
      }
      const root = activeRoot.current;
      const request: Promise<FsEntry[]> = fetchDir(path)
        .then((list) => {
          // fetchDir drops listings for a root the tree has left; match that.
          if (activeRoot.current === root) entriesRef.current = new Map(entriesRef.current).set(path, list);
          return list;
        })
        .finally(() => {
          if (pendingDirsRef.current.get(path) === request) pendingDirsRef.current.delete(path);
        });
      pendingDirsRef.current.set(path, request);
      return request;
    },
    [activeRoot, fetchDir]
  );

  const loadDirRef = useRef(loadDir);
  loadDirRef.current = loadDir;
  const revealSeqRef = useRef(0);
  const pendingScrollRef = useRef<string | null>(null);
  // Bumped when a walk finds its row, so the layout effect below runs even if
  // every ancestor was already expanded and loaded (no other state changed).
  const [, setRevealTick] = useState(0);
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

  return { loadDir, revealFile };
}

// Compare paths with `/` separators. Local Windows paths come back from listDir
// with `\`, remote and POSIX ones with `/`; the tree keys rows by the exact
// listed path, so this is only used to match, never to build a key.
function slashPath(path: string): string {
  return path.replace(/\\/g, '/');
}
