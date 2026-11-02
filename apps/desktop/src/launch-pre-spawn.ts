import { LaunchSpawnError } from '@zana-ai/zcc-server/services/launch/coordinator';

/** True when a launch error was raised before any process existed (admission refusal). */
export function isPreSpawnRefusal(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { preSpawn?: unknown }).preSpawn === true;
}

/**
 * Classify a launch error. Once process creation was attempted, a readiness or
 * persistence error cannot prove execution never started, so it is unconfirmed.
 * An admission refusal (e.g. a required MCP server is unavailable) happens before
 * any process exists, so it stays a definite failure and is returned unchanged.
 */
export function launchFailure(spawnAttempted: boolean, error: unknown): unknown {
  if (!spawnAttempted || isPreSpawnRefusal(error)) return error;
  return new LaunchSpawnError('LAUNCH_UNCONFIRMED', error instanceof Error ? error.message : String(error));
}
