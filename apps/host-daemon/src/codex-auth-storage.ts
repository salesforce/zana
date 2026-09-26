import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { open, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'smol-toml';
import { HostCommandError } from './host-command-error.js';

const AUTH_MAX_BYTES = 256 * 1024;
const KEYCHAIN_TIMEOUT_MS = 8_000;
const pendingKeychainReads = new Map<string, Promise<string | null>>();

export type CodexKeyringReader = (codexHome: string) => Promise<string | null>;

// Only the trusted host calls this. Neither the executable nor the Keychain
// service/account is supplied by the renderer. Never log the child error: it
// can include credential-bearing stdout, even when the command failed.
export async function readCodexKeyring(
  codexHome: string,
  deps: { platform?: NodeJS.Platform; execFileImpl?: typeof execFile } = {}
): Promise<string | null> {
  if ((deps.platform ?? process.platform) !== 'darwin') {
    throw new HostCommandError('codex_keyring_unavailable',
      'This host cannot read Codex’s credential store. Configure OPENAI_API_KEY on the host for voice input.');
  }
  const canonicalHome = await realpath(codexHome).catch(() => codexHome);
  // Matches Codex's direct keyring backend (login/src/auth/storage.rs).
  const account = `cli|${createHash('sha256').update(canonicalHome).digest('hex').slice(0, 16)}`;
  const pending = pendingKeychainReads.get(account);
  if (pending) return pending;
  if (pendingKeychainReads.size >= 4) {
    throw new HostCommandError('codex_keyring_unavailable', 'Credential access is busy. Try voice input again shortly.');
  }
  const read = new Promise<string | null>((resolve, reject) => {
    (deps.execFileImpl ?? execFile)('/usr/bin/security', [
      'find-generic-password', '-s', 'Codex Auth', '-a', account, '-w'
    ], {
      cwd: canonicalHome,
      encoding: 'utf8',
      timeout: KEYCHAIN_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      maxBuffer: AUTH_MAX_BYTES,
      windowsHide: true
    }, (error, stdout) => {
      if (!error) return resolve(stdout.trim() || null);
      // errSecItemNotFound (-25300) is returned by security as exit status 44.
      if (error.code === 44) return resolve(null);
      reject(new HostCommandError('codex_keyring_unavailable',
        'Cannot access your Codex login in Keychain. On your Mac, unlock Keychain and allow access if prompted, then try again.'));
    });
  });
  pendingKeychainReads.set(account, read);
  try {
    return await read;
  } finally {
    pendingKeychainReads.delete(account);
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

export async function readStoredCodexAuth(
  codexHome: string,
  readKeyring: CodexKeyringReader = readCodexKeyring
): Promise<Record<string, unknown>> {
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
  let auth: Record<string, unknown> | null = null;
  let keyringError: unknown;
  if (mode === 'keyring' || mode === 'auto') {
    try {
      if (config.auth_keyring_backend !== undefined && config.auth_keyring_backend !== 'direct') {
        throw new HostCommandError('codex_keyring_unavailable',
          'This Codex credential store is not supported yet. Configure OPENAI_API_KEY on the host for voice input.');
      }
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
