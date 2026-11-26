/**
 * Which registered window is the unscoped main window. Project and plugin view
 * windows carry a `projectId`; a thread view window may not, so it is ruled out
 * on its own. Only the main window gates renderer readiness and session restore.
 */
export interface RegisteredWindow<W> {
  win: W;
  projectId?: string;
  view?: unknown;
  threadView?: unknown;
  secondary?: boolean;
}

export function isUnscopedEntry(entry: Omit<RegisteredWindow<unknown>, 'win'>): boolean {
  return !entry.secondary && !entry.projectId && !entry.threadView;
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

/** Leave only the calling project shell. Detached plugin and thread windows keep their scope. */
export async function leaveProjectWindow(
  entry: RegisteredWindow<{
    loadURL(url: string): Promise<void>;
    webContents: { navigationHistory: { clear(): void } };
  }> | undefined,
  destination: unknown,
  origin: string | null
): Promise<boolean> {
  if (!entry?.projectId || entry.view || entry.threadView || !origin) return false;
  if (destination !== 'projects' && destination !== 'settings') return false;
  const target = new URL(destination === 'settings' ? '/settings' : '/agents', origin);
  // Clear the saved project lock before the next renderer starts its subscriptions.
  target.searchParams.set('projectId', '');
  const previous = entry.projectId;
  entry.projectId = undefined;
  try {
    await entry.win.loadURL(target.href);
  } catch (error) {
    entry.projectId = previous;
    throw error;
  }
  entry.win.webContents.navigationHistory.clear();
  return true;
}
