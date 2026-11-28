/**
 * Renderer-local channel that lets another surface (the Explorer tree) put
 * path mentions into a mounted prompt composer without importing it.
 *
 * A composer registers while it is mounted and usable; the most recently
 * registered composer for a project receives the paths. The channel carries
 * path strings only and never authorizes anything: the agent reads file
 * content later under its own confinement.
 */
export interface ComposerPathEntry {
  /** Absolute path as shown in the Explorer. */
  path: string;
  kind: 'file' | 'directory';
}

type PathInsertHandler = (entries: readonly ComposerPathEntry[]) => boolean;

const targets = new Map<string, PathInsertHandler[]>();

/** Register a composer for a project. Returns the unregister function. */
export function registerComposerPathTarget(projectId: string, handler: PathInsertHandler): () => void {
  if (!projectId) return () => {};
  targets.set(projectId, [...(targets.get(projectId) ?? []), handler]);
  return () => {
    const next = (targets.get(projectId) ?? []).filter((candidate) => candidate !== handler);
    if (next.length > 0) targets.set(projectId, next);
    else targets.delete(projectId);
  };
}

/** Insert paths into the newest accepting composer. False when none took them. */
export function insertComposerPaths(projectId: string, entries: readonly ComposerPathEntry[]): boolean {
  if (entries.length === 0) return false;
  const handlers = targets.get(projectId) ?? [];
  for (let index = handlers.length - 1; index >= 0; index -= 1) {
    if (handlers[index]!(entries)) return true;
  }
  return false;
}
