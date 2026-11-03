export interface SweepOrphanTempDirsOptions {
  /** Directory to scan. Defaults to `os.tmpdir()`. */
  tempRoot?: string;
  /** Temp dir prefixes to consider, e.g. `bb-provider-bridge`, `zcc-host`. */
  prefixes: readonly string[];
  /** Liveness probe for an owner pid. Defaults to `process.kill(pid, 0)`. */
  isAlive?: (pid: number) => boolean;
  /** Cap on entries inspected per sweep. Defaults to 200. */
  maxEntries?: number;
  /** Clock for the recent-modification guard. Defaults to `Date.now`. */
  now?: () => number;
}

export interface SweepOrphanTempDirsResult {
  inspected: number;
  removed: number;
  skipped: number;
  failed: number;
}

/** Contract stub: behaviour lands in u-core. */
export async function sweepOrphanTempDirs(
  _options: SweepOrphanTempDirsOptions,
): Promise<SweepOrphanTempDirsResult> {
  throw new Error("not implemented: sweepOrphanTempDirs");
}
