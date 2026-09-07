/**
 * One-time execution resume tokens. Tokens are encrypted at rest and never leave
 * this module through renderer-safe APIs. Main clears an entry only after a
 * successful grant bind, so transient monitor-spawn failures remain retryable.
 */

import { app, safeStorage } from 'electron';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';

const MAX_STRING = 2_048;

export interface ResumeTokenStatus {
  state: 'available' | 'expired' | 'missing';
  expiresAt?: number;
}

interface StoredResumeToken {
  projectId: string;
  executionId: string;
  /** base64(safeStorage.encryptString(token)) */
  tokenEnc: string;
  expiresAt: number;
}

interface StoredResumeTokenFile {
  version: 1;
  tokens: StoredResumeToken[];
}

export interface ResumeTokenStoreOptions {
  filePath?: string;
  now?: () => number;
  /**
   * E2E-ONLY. When true, bypass Electron `safeStorage` entirely and store the
   * token as plaintext base64. On a headless macOS runner
   * `safeStorage.isEncryptionAvailable()` blocks forever on a Keychain access it
   * cannot complete (no GUI session), which wedges the whole durable launch on
   * the main thread. `--password-store=basic` does NOT help — that switch is
   * Linux-only; macOS always uses the Keychain backend. The built app sets this
   * from `ZCC_E2E_HOME` (see host.ts); production never enables it.
   */
  insecure?: boolean;
}

function defaultFilePath(): string {
  return join(app.getPath('home'), '.zcc', 'execution-resume-tokens.enc');
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_STRING) {
    throw new Error(`Invalid execution resume token ${label}`);
  }
  return value;
}

function assertExpiresAt(value: unknown, now: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= now) {
    throw new Error('Invalid execution resume token expiry');
  }
  return value;
}

function isStoredToken(value: unknown): value is StoredResumeToken {
  if (!value || typeof value !== 'object') return false;
  const token = value as Partial<StoredResumeToken>;
  return typeof token.projectId === 'string' && token.projectId.trim().length > 0 && token.projectId.length <= MAX_STRING
    && typeof token.executionId === 'string' && token.executionId.trim().length > 0 && token.executionId.length <= MAX_STRING
    && typeof token.tokenEnc === 'string' && token.tokenEnc.length > 0
    && typeof token.expiresAt === 'number' && Number.isFinite(token.expiresAt);
}

/**
 * Creates a per-project/execution token store. All methods are synchronous: this
 * keeps read-consume-delete indivisible on Electron's single main-process event
 * loop while each write reaches disk via a 0600 temp file plus atomic rename.
 */
export function createResumeTokenStore(options: ResumeTokenStoreOptions = {}) {
  const filePath = options.filePath ?? defaultFilePath();
  const now = options.now ?? Date.now;
  const insecure = options.insecure === true;

  // safeStorage seam. In `insecure` E2E mode these never touch the native
  // Keychain (which blocks headless on macOS); plaintext base64 keeps the
  // on-disk file shape identical so the rest of the store is unchanged.
  const encAvailable = (): boolean => (insecure ? true : safeStorage.isEncryptionAvailable());
  const encrypt = (value: string): string =>
    insecure ? Buffer.from(value, 'utf8').toString('base64') : safeStorage.encryptString(value).toString('base64');
  const decrypt = (enc: string): string =>
    insecure ? Buffer.from(enc, 'base64').toString('utf8') : safeStorage.decryptString(Buffer.from(enc, 'base64'));

  function read(): StoredResumeTokenFile {
    try {
      if (!existsSync(filePath)) return { version: 1, tokens: [] };
      const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<StoredResumeTokenFile>;
      if (parsed.version !== 1 || !Array.isArray(parsed.tokens) || !parsed.tokens.every(isStoredToken)) {
        throw new Error('invalid shape');
      }
      return { version: 1, tokens: parsed.tokens };
    } catch (error) {
      throw new Error(`Corrupt execution resume token store: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function write(state: StoredResumeTokenFile): void {
    mkdirSync(dirname(filePath), { recursive: true });
    const temp = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
    writeFileSync(temp, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 });
    renameSync(temp, filePath);
  }

  function removeExpired(state: StoredResumeTokenFile, timestamp: number): boolean {
    const originalLength = state.tokens.length;
    state.tokens = state.tokens.filter((entry) => entry.expiresAt > timestamp);
    return state.tokens.length !== originalLength;
  }

  function set(input: { projectId: string; executionId: string; token: string; expiresAt: number }): void {
    const timestamp = now();
    const projectId = assertString(input.projectId, 'project id');
    const executionId = assertString(input.executionId, 'execution id');
    const token = assertString(input.token, 'token');
    const expiresAt = assertExpiresAt(input.expiresAt, timestamp);
    if (!encAvailable()) throw new Error('Encryption unavailable - safeStorage not ready');

    const state = read();
    removeExpired(state, timestamp);
    state.tokens = state.tokens.filter((entry) => entry.projectId !== projectId || entry.executionId !== executionId);
    state.tokens.push({ projectId, executionId, tokenEnc: encrypt(token), expiresAt });
    write(state);
  }

  function clear(projectId: string, executionId: string): void {
    const safeProjectId = assertString(projectId, 'project id');
    const safeExecutionId = assertString(executionId, 'execution id');
    const state = read();
    const changed = removeExpired(state, now());
    const kept = state.tokens.filter((entry) => entry.projectId !== safeProjectId || entry.executionId !== safeExecutionId);
    if (changed || kept.length !== state.tokens.length) {
      state.tokens = kept;
      write(state);
    }
  }

  /** Renderer-safe: indicates token availability but never reveals encrypted or plaintext token data. */
  function status(projectId: string, executionId: string): ResumeTokenStatus {
    const safeProjectId = assertString(projectId, 'project id');
    const safeExecutionId = assertString(executionId, 'execution id');
    const state = read();
    const timestamp = now();
    const expired = state.tokens.find((candidate) => candidate.projectId === safeProjectId && candidate.executionId === safeExecutionId && candidate.expiresAt <= timestamp);
    const changed = removeExpired(state, timestamp);
    if (changed) write(state);
    const entry = state.tokens.find((candidate) => candidate.projectId === safeProjectId && candidate.executionId === safeExecutionId);
    return entry ? { state: 'available', expiresAt: entry.expiresAt }
      : expired ? { state: 'expired', expiresAt: expired.expiresAt }
      : { state: 'missing' };
  }

  /** Main-only binding path. Never exposed to renderer. */
  function readForBinding(projectId: string, executionId: string): string | undefined {
    const safeProjectId = assertString(projectId, 'project id');
    const safeExecutionId = assertString(executionId, 'execution id');
    const state = read();
    const timestamp = now();
    const removedExpired = removeExpired(state, timestamp);
    const entry = state.tokens.find((candidate) => candidate.projectId === safeProjectId && candidate.executionId === safeExecutionId);
    if (!entry) {
      if (removedExpired) write(state);
      return undefined;
    }

    if (!encAvailable()) return undefined;
    try {
      return decrypt(entry.tokenEnc);
    } catch {
      state.tokens = state.tokens.filter((candidate) => candidate !== entry);
      write(state);
      return undefined;
    }
  }

  return { set, clear, status, readForBinding };
}
