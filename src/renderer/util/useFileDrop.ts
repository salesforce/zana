import { useState } from 'react';
import { posixQuote } from './quote';

/**
 * Optional hook to transform the dropped LOCAL absolute paths before they reach
 * `onPaths`. The default (local projects) just shell-quotes each path and joins
 * with spaces. A remote project supplies a resolver that first uploads each
 * local file to the devbox and returns the (quoted) REMOTE paths — so a path
 * dropped onto a remote terminal/Explorer is one the remote shell can actually
 * read. Returning an empty string drops the contribution silently.
 */
export type DropPathResolver = (localPaths: string[]) => Promise<string> | string;

const defaultResolver: DropPathResolver = (localPaths) =>
  localPaths.map(posixQuote).join(' ');

/**
 * Shared drag-and-drop affordance for "drop a file to add its path" surfaces
 * (the terminal, every agent launcher's prompt box, the `#`-launch input).
 *
 * Accepts either real files (resolved to absolute paths via Electron's
 * `webUtils` bridge) or a plain-text path drag (only honored when it looks
 * absolute, i.e. starts with `/`). By default each resolved path is shell-quoted
 * so it can be pasted straight onto a command line, and multiple files join with
 * spaces. Pass `resolver` to remap the local paths first — e.g. upload them to a
 * remote host and yield the remote paths (see {@link DropPathResolver}).
 *
 * The consumer supplies `onPaths`, the sink for the assembled string — insert
 * it at a textarea caret, or write it to a pty. The hook owns only the
 * drag-detection, the `dropOver` highlight flag, and the path extraction.
 *
 * ```tsx
 * const { dropOver, dropHandlers } = useFileDrop(insertIntoPrompt);
 * <textarea className={dropOver ? 'drop-over' : ''} {...dropHandlers} />
 * ```
 *
 * Note: the global window `drop`/`dragover` handlers (main.tsx) only
 * `preventDefault` to stop the OS navigating to a dropped file — they don't
 * `stopPropagation`, so these element-level handlers still fire.
 */
export function useFileDrop(onPaths: (paths: string) => void, resolver: DropPathResolver = defaultResolver) {
  const [dropOver, setDropOver] = useState(false);

  const onDragOver = (e: React.DragEvent) => {
    const types = Array.from(e.dataTransfer.types);
    if (!types.includes('Files') && !types.includes('text/plain')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!dropOver) setDropOver(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget === e.target) setDropOver(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDropOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      const localPaths = files
        .map((f) => window.cc.files.pathForFile(f))
        .filter(Boolean);
      if (localPaths.length === 0) return;
      void Promise.resolve(resolver(localPaths)).then((paths) => {
        if (paths) onPaths(paths);
      });
      return;
    }
    const text = e.dataTransfer.getData('text/plain');
    if (text && text.startsWith('/')) {
      void Promise.resolve(resolver([text])).then((paths) => {
        if (paths) onPaths(paths);
      });
    }
  };

  return { dropOver, dropHandlers: { onDragOver, onDragLeave, onDrop } };
}
