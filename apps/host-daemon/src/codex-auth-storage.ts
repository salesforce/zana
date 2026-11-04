import { open, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'smol-toml';
import { HostCommandError } from './host-command-error.js';
import { readCodexNativeAuth, type CodexNativeAuthOptions } from './codex-auth-native.js';

const AUTH_MAX_BYTES = 256 * 1024;
const pendingKeychainReads = new Map<string, Promise<string | null>>();

export type CodexKeyringReader = (codexHome: string) => Promise<string | null>;

// Coalesce concurrent reads, without retaining completed credentials or failures.
// Codex owns access to its configured OS store on every supported platform.
export async function readCodexKeyring(
  codexHome: string,
  options: CodexNativeAuthOptions = {}
): Promise<string | null> {
  const canonicalHome = await realpath(codexHome).catch(() => codexHome);
  const pending = pendingKeychainReads.get(canonicalHome);
  if (pending) return pending;
  if (pendingKeychainReads.size >= 4) {
    throw new HostCommandError('codex_keyring_unavailable', 'Credential access is busy. Try voice input again shortly.');
  }
  const read = readCodexNativeAuth(canonicalHome, options);
  pendingKeychainReads.set(canonicalHome, read);
  try {
    return await read;
  } finally {
    pendingKeychainReads.delete(canonicalHome);
  }
}

async function readBoundedFile(path: string, limit: number): Promise<string | null> {
  const file = await open(path, 'r').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw new HostCommandError('codex_auth_invalid', 'Cannot read the Codex login configuration on this host.');
  });
  if (!file) return null;
  try {
    const buffer = Buffer.alloc(limit + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await file.read(buffer, size, buffer.length - size, size);
      if (bytesRead === 0) break;
      size += bytesRead;
    }
    if (size > limit) throw new Error('too large');
    return buffer.subarray(0, size).toString('utf8');
  } catch {
    throw new HostCommandError('codex_auth_invalid', 'Cannot read the Codex login configuration on this host.');
  } finally {
    await file.close();
  }
}

function parseAuth(raw: string | null): Record<string, unknown> | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw);
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch { /* Do not include credential contents in errors. */ }
  throw new HostCommandError('codex_auth_invalid', 'The saved Codex login is invalid. Sign in to Codex again on the host.');
}

export type CodexCredentialStoreMode = 'file' | 'keyring' | 'auto' | 'ephemeral';

export async function readCodexStoreConfig(
  codexHome: string
): Promise<{ config: Record<string, unknown>; mode: CodexCredentialStoreMode }> {
  const configText = await readBoundedFile(join(codexHome, 'config.toml'), 1024 * 1024);
  let config: Record<string, unknown>;
  try {
    config = configText === null ? {} : parse(configText);
  } catch {
    throw new HostCommandError('codex_auth_invalid', 'The Codex configuration on the host is invalid.');
  }
  const mode = config.cli_auth_credentials_store ?? 'file';
  if (typeof mode !== 'string' || !['file', 'keyring', 'auto', 'ephemeral'].includes(mode)) {
    throw new HostCommandError('codex_auth_invalid', 'The Codex credential storage setting on the host is invalid.');
  }
  return { config, mode: mode as CodexCredentialStoreMode };
}

export async function codexAuthFileExists(codexHome: string): Promise<boolean> {
  return parseAuth(await readBoundedFile(join(codexHome, 'auth.json'), AUTH_MAX_BYTES)) !== null;
}

export async function readStoredCodexAuth(
  codexHome: string,
  readKeyring: CodexKeyringReader = readCodexKeyring
): Promise<Record<string, unknown>> {
  const { mode } = await readCodexStoreConfig(codexHome);
  let auth: Record<string, unknown> | null = null;
  let keyringError: unknown;
  if (mode === 'keyring' || mode === 'auto') {
    try {
      auth = parseAuth(await readKeyring(codexHome));
    } catch (error) {
      if (mode === 'keyring') throw error;
      keyringError = error;
    }
  }
  if (!auth && (mode === 'file' || mode === 'auto')) {
    auth = parseAuth(await readBoundedFile(join(codexHome, 'auth.json'), AUTH_MAX_BYTES));
  }
  if (auth) return auth;
  if (keyringError) throw keyringError;
  throw new HostCommandError('codex_auth_missing',
    'Voice input needs a Codex login on the connected computer. Sign in there, then try again.');
}
