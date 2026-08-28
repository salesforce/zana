/** Maximum title length accepted by plugin UI interaction requests. */
export const PLUGIN_INTERACTION_MAX_TITLE_LENGTH = 160;

/** Maximum JSON payload size accepted by plugin UI interaction requests. */
export const PLUGIN_INTERACTION_MAX_PAYLOAD_BYTES = 64 * 1024;

/** The UTF-8 byte length of a value's JSON form. */
export function jsonByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}
