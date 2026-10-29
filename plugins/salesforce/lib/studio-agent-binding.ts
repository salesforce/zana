/** Project-relative navigation context only; file RPCs still authorize access. */
export function isSafeStudioPath(path: unknown): path is string {
  return typeof path === 'string' && path.length > 0 && path.length <= 500
    && !path.startsWith('/') && !/[\\\0-\x1f:]/.test(path) && !path.split('/').some(part => !part || part === '.' || part === '..');
}

/** The immutable AgentScript context recorded when a panel conversation starts. */
export function panelAgentPath(pluginMetadata: unknown): string | null {
  const binding = (pluginMetadata as { panelAgent?: unknown } | null | undefined)?.panelAgent;
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)) return null;
  const view = (binding as { view?: unknown }).view;
  return isSafeStudioPath(view) ? view : null;
}

export function studioThreadPath(pluginMetadata: unknown): string | null {
  const path = panelAgentPath(pluginMetadata);
  const spawnedPath = (pluginMetadata as { sfAgentPath?: unknown } | null | undefined)?.sfAgentPath;
  return path ?? (isSafeStudioPath(spawnedPath) ? spawnedPath : null);
}
