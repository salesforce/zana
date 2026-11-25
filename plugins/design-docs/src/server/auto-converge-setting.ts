import type { PluginKvStorage } from '@zana-ai/zcc-plugin-sdk';

/** Plugin KV key holding the "settle safe peer changes" preference. */
export const AUTO_CONVERGE_KEY = 'settings.autoConverge';

export interface AutoConvergeSetting {
  /** Synchronous read for the sync store; false until the stored value loads. */
  enabled(): boolean;
  /** Resolves once the stored value has been read (a failed read leaves it off). */
  ready: Promise<void>;
  get(): Promise<boolean>;
  set(enabled: boolean): Promise<boolean>;
}

/**
 * The preference lives in plugin KV, edited from Settings → Peers inside Design Docs.
 * Fail closed: an unreadable value leaves automatic settling off.
 */
export function createAutoConvergeSetting(
  kv: Pick<PluginKvStorage, 'get' | 'set'>,
  warn: (message: string) => void,
  /** The value this plugin kept as a global plugin setting before it moved here; copied once when KV has none. */
  legacy?: () => Promise<boolean>
): AutoConvergeSetting {
  let value = false;
  let written = false;
  const ready = kv.get<unknown>(AUTO_CONVERGE_KEY)
    .then(async (stored) => {
      if (written) return;
      if (stored === undefined && legacy && await legacy()) {
        await kv.set(AUTO_CONVERGE_KEY, true);
        if (!written) value = true;
        return;
      }
      value = stored === true;
    })
    .catch((error: unknown) => warn(`design docs setting load failed; automatic settling stays off: ${String(error).slice(0, 160)}`));
  return {
    enabled: () => value,
    ready,
    get: async () => { await ready; return value; },
    set: async (enabled) => {
      if (typeof enabled !== 'boolean') throw new TypeError('enabled must be a boolean');
      await kv.set(AUTO_CONVERGE_KEY, enabled);
      written = true;
      value = enabled;
      return value;
    }
  };
}
