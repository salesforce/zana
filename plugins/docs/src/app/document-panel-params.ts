export const LIBRARY_AUTOSAVE_MS = 700;

export function createLibraryAutosave(
  write: (content: string) => Promise<void>,
  delayMs = LIBRARY_AUTOSAVE_MS,
  onError: (error: unknown) => void = () => undefined
) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: string | null = null;
  let active = false;
  let failed = false;
  async function drain() {
    if (active || failed || pending === null) return;
    active = true;
    const content = pending; pending = null;
    try { await write(content); }
    catch (error) { failed = true; onError(error); }
    finally {
      active = false;
      // Only one write can use the current read revision. Coalesce later edits
      // and let the successful write advance that revision before continuing.
      if (timer === null && pending !== null && !failed) void drain();
    }
  }
  return {
    schedule(content: string) {
      pending = content;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; void drain(); }, delayMs);
    },
    flush() {
      if (timer) clearTimeout(timer);
      timer = null;
      void drain();
    },
    cancel() {
      pending = null;
      if (timer) clearTimeout(timer);
      timer = null;
    }
  };
}

export function parseDocumentPanelParams(params: unknown, ownerProjectId?: string | null): {
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
    typeof record.projectId === 'string' && record.projectId.trim() ? record.projectId.trim()
      : scope === 'project' ? ownerProjectId?.trim() || undefined : undefined;
  if (scope === 'project' && !projectId) return null;
  return { path, scope, title, ...(projectId ? { projectId } : {}) };
}

export function isHtmlLibraryPath(path: string): boolean {
  return /\.html?$/i.test(path);
}
