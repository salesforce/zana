/**
 * Per-phase timing for the Squad launch path. Logs only the phase name and the
 * elapsed milliseconds, never prompts, ids or paths.
 *
 * It uses `console.warn` on purpose: the runtime log sink writes only warn and
 * error lines, so an info line would never reach `server.log` and a launch
 * could not be measured from it.
 */
export type SquadLaunchTimingLog = (message: string) => void;

export interface SquadLaunchTimingOptions {
  now?: () => number;
  log?: SquadLaunchTimingLog;
}

const PHASE_NAME = /^[a-z0-9-]{1,48}$/;

/** Runs one phase and logs its duration, also when it throws. */
export async function timeSquadLaunchPhase<T>(
  phase: string, run: () => Promise<T>, options: SquadLaunchTimingOptions = {}
): Promise<T> {
  const now = options.now ?? Date.now;
  const log = options.log ?? ((message) => console.warn(message));
  const startedAt = now();
  try {
    return await run();
  } finally {
    const label = PHASE_NAME.test(phase) ? phase : 'invalid-phase';
    log(`[squad-launch] ${label} took ${Math.max(0, Math.round(now() - startedAt))}ms`);
  }
}
