const pendingByProject = new Map<string, string>();

export function queueAgentScriptOpen(projectId: string, path: string): void {
  const id = projectId.trim();
  const next = path.trim();
  if (!id || !next) return;
  pendingByProject.set(id, next);
}

export function takeQueuedAgentScriptOpen(projectId: string): string | null {
  const id = projectId.trim();
  if (!id) return null;
  const path = pendingByProject.get(id) ?? null;
  if (path) pendingByProject.delete(id);
  return path;
}
