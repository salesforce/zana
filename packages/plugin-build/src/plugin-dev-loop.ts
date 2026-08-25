const DEFAULT_DEBOUNCE_MS = 300;
const IGNORED_SEGMENTS = new Set(['dist', 'node_modules', '.git', 'share']);

export function isIgnoredPluginDevPath(relativePath: string): boolean {
  return relativePath.split(/[\\/]/).some((segment) => IGNORED_SEGMENTS.has(segment));
}

export interface PluginDevLoopDeps {
  pluginId: string;
  hasApp: boolean;
  hasServer: boolean;
  buildApp: () => Promise<void>;
  buildServer: () => Promise<void>;
  reloadPlugin: () => Promise<void>;
  log: (line: string) => void;
  debounceMs?: number;
  now?: () => number;
}

export interface PluginDevLoop {
  handleChange: (relativePath: string) => void;
  settled: () => Promise<void>;
  dispose: () => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createPluginDevLoop(deps: PluginDevLoopDeps): PluginDevLoop {
  const debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const now = deps.now ?? (() => Date.now());
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let queueTail: Promise<void> = Promise.resolve();

  async function runCycle(files: readonly string[]): Promise<void> {
    if (disposed) return;
    const parts = [`${files.length} file${files.length === 1 ? '' : 's'} changed`];
    if (deps.hasServer) {
      const startedAt = now();
      try {
        await deps.buildServer();
        parts.push(`rebuilt server in ${Math.max(0, Math.round(now() - startedAt))}ms`);
      } catch (error) {
        parts.push(`server build failed: ${errorMessage(error)}`);
        deps.log(`${parts.join(' · ')} — fix and save to retry`);
        return;
      }
    }
    if (deps.hasApp) {
      const startedAt = now();
      try {
        await deps.buildApp();
        parts.push(`rebuilt app in ${Math.max(0, Math.round(now() - startedAt))}ms`);
      } catch (error) {
        parts.push(`app build failed: ${errorMessage(error)}`);
        deps.log(`${parts.join(' · ')} — fix and save to retry`);
        return;
      }
    }
    try {
      await deps.reloadPlugin();
      parts.push(`reloaded ${deps.pluginId}`);
    } catch (error) {
      parts.push(`reload failed: ${errorMessage(error)}`);
    }
    deps.log(parts.join(' · '));
  }

  function flush(): void {
    timer = null;
    if (pending.size === 0) return;
    const files = [...pending];
    pending.clear();
    queueTail = queueTail.then(() => runCycle(files));
  }

  return {
    handleChange(relativePath) {
      if (disposed || isIgnoredPluginDevPath(relativePath)) return;
      pending.add(relativePath);
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, debounceMs);
    },
    settled() {
      return queueTail;
    },
    dispose() {
      disposed = true;
      if (timer) clearTimeout(timer);
      timer = null;
      pending.clear();
    }
  };
}
