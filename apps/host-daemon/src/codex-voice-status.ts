import type { CodexVoiceStatusResult } from '@zana-ai/zcc-contracts/host-rpc';
import { resolveCodexHome, type CodexAuthReadOptions } from './codex-auth.js';
import { codexAuthFileExists, readCodexStoreConfig } from './codex-auth-storage.js';

// Cheap readiness probe for the composer's mic button. It never reads the OS
// credential store: starting Codex and reading OS credentials can take seconds
// and may require OS authorization. Keyring-backed logins are reported as
// `unverified` and resolved by the native Codex interface on first use.
export async function probeCodexVoiceStatus(
  options: CodexAuthReadOptions = {}
): Promise<CodexVoiceStatusResult> {
  const env = options.env ?? process.env;
  if (env.OPENAI_API_KEY?.trim()) return { state: 'ready' };
  const codexHome = resolveCodexHome(options);
  try {
    const { mode } = await readCodexStoreConfig(codexHome);
    if (mode === 'keyring') return { state: 'unverified' };
    if (mode === 'ephemeral') return { state: 'missing' };
    if (await codexAuthFileExists(codexHome)) return { state: 'ready' };
    return { state: mode === 'auto' ? 'unverified' : 'missing' };
  } catch {
    return { state: 'missing' };
  }
}
