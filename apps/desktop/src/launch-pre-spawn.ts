/** True when a launch error was raised before any process existed (admission refusal). */
export function isPreSpawnRefusal(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { preSpawn?: unknown }).preSpawn === true;
}
