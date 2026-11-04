/**
 * Project id → name, so agent-facing text says "zana-command-center" rather
 * than a UUID. Names are fetched lazily and at most once per `ttlMs`; a failed
 * fetch keeps the last known names (ids are the fallback either way).
 */
export interface ProjectNames {
  name(projectId: string | null): string | null;
  /** Refresh when the cached list is older than the TTL. Never throws. */
  refresh(): Promise<void>;
}

export function createProjectNames(
  list: () => Promise<Array<{ id: string; name: string; tag?: string }>>,
  options: {
    ttlMs?: number;
    now?: () => number;
    /** After each successful fetch, so stored names and aliases stay current. Must not throw. */
    onRefresh?: (projects: Array<{ id: string; name: string; tag?: string }>) => void;
    /** Label for an id absent from the (successfully fetched) list, e.g. "<name> (project removed)". */
    removedLabel?: (projectId: string) => string | null;
  } = {}
): ProjectNames {
  const ttlMs = options.ttlMs ?? 30_000;
  const now = options.now ?? Date.now;
  let names = new Map<string, string>();
  let loaded = false;
  let fetchedAt = Number.NEGATIVE_INFINITY;
  let inFlight: Promise<void> | null = null;

  return {
    name: (projectId) => {
      if (!projectId) return null;
      const live = names.get(projectId);
      if (live !== undefined) return live;
      if (!loaded || !options.removedLabel) return null;
      try { return options.removedLabel(projectId); } catch { return null; }
    },
    refresh() {
      if (inFlight) return inFlight;
      if (now() - fetchedAt < ttlMs) return Promise.resolve();
      inFlight = list()
        .then(
          (projects) => {
            names = new Map(projects.filter((project) => project.name).map((project) => [project.id, project.name]));
            loaded = true;
            try { options.onRefresh?.(projects); } catch { /* bookkeeping must not break name lookups */ }
          },
          () => {}
        )
        .finally(() => {
          fetchedAt = now();
          inFlight = null;
        });
      return inFlight;
    }
  };
}
