/** Maximum title length accepted by plugin UI interaction requests. */
export const PLUGIN_INTERACTION_MAX_TITLE_LENGTH = 160;

/** Maximum JSON payload size accepted by plugin UI interaction requests. */
export const PLUGIN_INTERACTION_MAX_PAYLOAD_BYTES = 64 * 1024;

/**
 * Longest `ui.requestInput` timeout a plugin may ask for: seven days. Must stay
 * under `setTimeout`'s 2^31-1 ms ceiling, past which Node fires the waiter
 * timer after 1 ms instead of the requested delay.
 */
export const PLUGIN_INTERACTION_MAX_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;

/** The UTF-8 byte length of a value's JSON form. */
export function jsonByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}
