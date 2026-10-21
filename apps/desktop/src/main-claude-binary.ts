import { statSync } from 'node:fs';
import type { AppConfig } from '@zana-ai/zcc-domain/product';

/** Same precedence as the server's `configuredClaudeProvider()`: the canonical harness entry, then the legacy flat field. */
export function mainClaudeBinary(config: AppConfig): string {
  return (config.harnesses?.byId?.claude?.binary || config.claudeBinary || 'claude').trim();
}

/** Cheap change stamp for the config file. Every config write is an atomic rename, so inode/mtime/size change with it. */
function configStamp(configFile: string): string {
  try {
    const st = statSync(configFile);
    return `${st.ino}:${st.mtimeMs}:${st.size}`;
  } catch {
    return 'missing';
  }
}

/**
 * Resolves the binary at call time, so a changed setting applies to the next LLM run. With `configFile`
 * the resolved value is cached and re-resolved only when that file's stamp changes, which avoids a full
 * synchronous `getConfig()` (read, normalise, possible heal-write) on the main thread for every micro-call.
 */
export function mainClaudeBinaryGetter(store: { getConfig(): AppConfig }, configFile?: string): () => string {
  if (!configFile) return () => mainClaudeBinary(store.getConfig());
  let cached: { stamp: string; binary: string } | undefined;
  return () => {
    const stamp = configStamp(configFile);
    if (cached && cached.stamp === stamp) return cached.binary;
    const binary = mainClaudeBinary(store.getConfig());
    cached = { stamp, binary };
    return binary;
  };
}
