/**
 * Which registered window is the unscoped main window. Project and plugin view
 * windows carry a `projectId`; a thread view window may not, so it is ruled out
 * on its own. Only the main window gates renderer readiness and session restore.
 */
export interface RegisteredWindow<W> {
  win: W;
  projectId?: string;
  threadView?: unknown;
}

export function isUnscopedEntry(entry: Omit<RegisteredWindow<unknown>, 'win'>): boolean {
  return !entry.projectId && !entry.threadView;
}

/** Whether `win` is registered as the unscoped main window. */
export function isUnscopedRegistration<W>(registered: RegisteredWindow<W> | undefined, win: W): boolean {
  return !!registered && registered.win === win && isUnscopedEntry(registered);
}

/** The first live unscoped window, or null if only scoped ones exist. */
export function findUnscopedWindow<W extends { isDestroyed(): boolean }>(
  entries: Iterable<RegisteredWindow<W>>
): W | null {
  for (const entry of entries) {
    if (isUnscopedEntry(entry) && !entry.win.isDestroyed()) return entry.win;
  }
  return null;
}
