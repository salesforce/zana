export const LIBRARY_AUTOSAVE_MS = 700;

export function createLibraryAutosave(
  write: (content: string) => Promise<void>,
  delayMs = LIBRARY_AUTOSAVE_MS
) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;
  let pending: string | null = null;
  return {
    schedule(content: string) {
      pending = content;
      if (timer) clearTimeout(timer);
      const token = ++generation;
      timer = setTimeout(() => {
        if (token !== generation) return;
        const next = pending;
        pending = null;
        if (next !== null) void write(next);
      }, delayMs);
    },
    flush() {
      if (timer) clearTimeout(timer);
      timer = null;
      generation += 1;
      const next = pending;
      pending = null;
      if (next !== null) void write(next);
    },
    cancel() {
      generation += 1;
      pending = null;
      if (timer) clearTimeout(timer);
      timer = null;
    }
  };
}

export function parseDocumentPanelParams(params: unknown): {
  path: string;
  scope: 'project' | 'global';
  title: string;
  projectId?: string;
} | null {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return null;
  const record = params as Record<string, unknown>;
  const path = typeof record.path === 'string' ? record.path.trim() : '';
  if (!path || path.split(/[/\\]/).includes('..') || path.startsWith('/')) return null;
  const scope = record.scope === 'global' ? 'global' : 'project';
  const title =
    typeof record.title === 'string' && record.title.trim()
      ? record.title.trim()
      : path.split('/').pop() || path;
  const projectId =
    typeof record.projectId === 'string' && record.projectId.trim() ? record.projectId.trim() : undefined;
  if (scope === 'project' && !projectId) return null;
  return { path, scope, title, ...(projectId ? { projectId } : {}) };
}

export function isHtmlLibraryPath(path: string): boolean {
  return /\.html?$/i.test(path);
}
