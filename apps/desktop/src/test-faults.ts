/**
 * Test-only fault injection for built-Electron E2E runs.
 *
 * `__ZCC_TEST_FAULTS__` is inlined by the build only when the E2E runner builds the app, so in a
 * production build the guard is the literal `false`, the bundler drops the branch, and the
 * environment variable is never read. Even in an E2E build nothing fires unless `ZCC_TEST_FAULT`
 * names the fault.
 */
declare const __ZCC_TEST_FAULTS__: boolean | undefined;

export function testFaultActive(name: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (typeof __ZCC_TEST_FAULTS__ === 'undefined' || !__ZCC_TEST_FAULTS__) return false;
  return env.ZCC_TEST_FAULT === name;
}

/**
 * `worker-spawn-throw` selects the second seat (`:1`) of every persona row, so a row with quantity
 * >= 2 launches one seat and fails the next while sibling seats and rows keep launching. Slot ids
 * are `<row>:<personaId>:<index>`; the orchestrator seat (`orchestrator:<id>`) is never selected.
 */
export function workerSpawnFaultFor(slotId: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return testFaultActive('worker-spawn-throw', env) && slotId.endsWith(':1');
}

const MAX_TEST_NO_TURN_WARN_MS = 10 * 60_000;

/**
 * Build-gated override of the no-turn warning window, so an E2E run need not wait the production
 * stall window (30 minutes by default). Absent, non-numeric, non-positive or ceiling-exceeding values
 * yield undefined, which leaves the service default in force. Never read in a production build.
 */
export function testNoTurnWarnWindowMs(env: NodeJS.ProcessEnv = process.env): number | undefined {
  if (typeof __ZCC_TEST_FAULTS__ === 'undefined' || !__ZCC_TEST_FAULTS__) return undefined;
  const raw = env.ZCC_TEST_NO_TURN_WARN_MS;
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  const value = Number(raw);
  return value >= 1 && value <= MAX_TEST_NO_TURN_WARN_MS ? value : undefined;
}

const MAX_TEST_VISIBILITY_MS = 10 * 60_000;

/**
 * Build-gated override of a visibility window (`idle`, `heartbeat`, `blocker`), so an E2E run need not wait
 * 3, 5 or 30 minutes. Reads `ZCC_TEST_<NAME>_NOTICE_MS`; absent, non-numeric, non-positive or oversized values
 * yield undefined and leave the service default in force. Never read in a production build.
 */
export function testVisibilityWindowMs(name: 'IDLE' | 'HEARTBEAT' | 'BLOCKER', env: NodeJS.ProcessEnv = process.env): number | undefined {
  if (typeof __ZCC_TEST_FAULTS__ === 'undefined' || !__ZCC_TEST_FAULTS__) return undefined;
  const raw = env[`ZCC_TEST_${name}_NOTICE_MS`];
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  const value = Number(raw);
  return value >= 1 && value <= MAX_TEST_VISIBILITY_MS ? value : undefined;
}
