/**
 * The machine this desktop main process runs on. A packaged/production app
 * learns it from its own enrolled utility daemon. A dev-attach app
 * (`ELECTRON_RENDERER_URL`, no supervisor) talks to a separately launched
 * daemon sharing the same data dir, so read the daemon's persisted `host.id`.
 * Without either, stay undefined: host guards then refuse explicit machines.
 */
export function createLocalHostIdResolver(deps: {
  supervisorHostId: () => string | undefined;
  devAttach: () => boolean;
  readPersistedHostId: () => string | null;
}): () => string | undefined {
  let cached: string | undefined;
  return () => {
    const enrolled = deps.supervisorHostId();
    if (enrolled) return enrolled;
    if (!deps.devAttach()) return undefined;
    cached ??= deps.readPersistedHostId() ?? undefined;
    return cached;
  };
}
