/**
 * Per-harness authentication store — a base URL + API token for each interactive
 * agent CLI family (Claude Code / Codex / Cursor), so a user can point a harness
 * at a gateway/proxy or supply a key WITHOUT running that CLI's own `login` flow.
 *
 * This is the harness (terminal-agent) twin of `voice/secrets.ts`. The key is
 * the launch-profile family, and the credential is injected into the spawned
 * agent's process — as env vars and/or a provider-specific config arg — by each
 * `LaunchProvider.authInjection`.
 *
 * SECURITY POSTURE (mirrors voice-secrets):
 *  - The TOKEN is a secret: encrypted at rest via electron `safeStorage`, written
 *    to `~/.zcc/harness-auth.enc`, and NEVER read back to the renderer — the UI
 *    only ever learns a boolean `configured` (see {@link getHarnessAuthStatus}).
 *  - The BASE URL is not a secret (it's a hostname): stored in the same blob but
 *    freely read back so the settings field can show the current value.
 *  - Ambient env fallback: if no token is stored, the agent still inherits the
 *    standard env var (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, …) from the host
 *    process, so this store only ADDS an override, never removes existing auth.
 *
 * Rule 4 (atomic, serialized writes): tmp + rename, single-process store.
 */

import * as electron from 'electron';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveZccDataDir } from './host-config.js';

/** The harness families that can carry a per-harness credential. */
export type HarnessAuthKey = 'claude' | 'codex' | 'cursor';

export const HARNESS_AUTH_KEYS: readonly HarnessAuthKey[] = ['claude', 'codex', 'cursor'] as const;

/**
 * Runtime guard for a family key. The IPC boundary types `key` as HarnessAuthKey,
 * but TS types are erased — a buggy/compromised renderer can pass any string
 * (Rule 1: the renderer is untrusted, main validates). Enforce membership of the
 * closed enum here so an arbitrary/`__proto__`-style key can never reach the
 * stored blob. `Object.hasOwn` on the ambient-env map also rejects prototype keys.
 */
export function isHarnessAuthKey(key: unknown): key is HarnessAuthKey {
  return typeof key === 'string' && (HARNESS_AUTH_KEYS as readonly string[]).includes(key);
}

/** A resolved credential handed to a provider's `authInjection`. */
export interface HarnessAuthCredential {
  /** Base URL / gateway endpoint (non-secret). Undefined ⇒ use the CLI default. */
  baseUrl?: string;
  /** API token / bearer (secret, decrypted). Undefined ⇒ rely on ambient env. */
  token?: string;
}

/** Renderer-safe status: what's configured, WITHOUT the secret token value. */
export interface HarnessAuthStatus {
  key: HarnessAuthKey;
  /** The stored base URL (non-secret), if any. */
  baseUrl?: string;
  /** Whether a token is stored (never the token itself). */
  hasToken: boolean;
}

type ElectronSafeStorage = {
  isEncryptionAvailable: () => boolean;
  encryptString: (value: string) => Buffer;
  decryptString: (value: Buffer) => string;
};

function electronApi(): {
  app?: { getPath: (name: string) => string };
  safeStorage?: ElectronSafeStorage;
} {
  const ns = electron as {
    app?: { getPath: (name: string) => string };
    safeStorage?: ElectronSafeStorage;
    default?: {
      app?: { getPath: (name: string) => string };
      safeStorage?: ElectronSafeStorage;
    };
  };
  if (ns.app || ns.safeStorage) return ns;
  if (ns.default && typeof ns.default === 'object') return ns.default;
  return {};
}

/**
 * Resolve the store path LAZILY (not at module load): `app.getPath` throws before
 * electron's app is ready, and importing this module transitively (via pty.ts)
 * from a unit test must not require a full electron-app mock. Every accessor
 * computes it on demand. Node enroll (no Electron) falls back to HOME / ZCC_DATA_DIR.
 */
function dataDir(): string {
  const home = electronApi().app?.getPath?.('home') ?? homedir();
  return resolveZccDataDir(process.env, home);
}
function authFilePath(): string {
  return join(dataDir(), 'harness-auth.enc');
}

/** On-disk shape: per-family baseUrl (plain) + token (base64 of encrypted bytes). */
interface StoredEntry {
  baseUrl?: string;
  /** base64(safeStorage.encryptString(token)). */
  tokenEnc?: string;
}
type StoredBlob = Partial<Record<HarnessAuthKey, StoredEntry>>;

function ensureDir(): void {
  const dir = dataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function readBlob(): StoredBlob {
  try {
    const file = authFilePath();
    if (!existsSync(file)) return {};
    return JSON.parse(readFileSync(file, 'utf8')) as StoredBlob;
  } catch {
    return {};
  }
}

function writeBlob(blob: StoredBlob): void {
  ensureDir();
  const file = authFilePath();
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  // Owner-only (0600): the blob holds the encrypted token, but the base URL is
  // plaintext and the file shouldn't be world-readable either way. `mode` on the
  // tmp file carries through the atomic rename. On Windows the mode bits are a
  // no-op (safeStorage/DPAPI is the real protection there).
  writeFileSync(tmp, JSON.stringify(blob), { encoding: 'utf8', mode: 0o600 });
  renameSync(tmp, file);
}

/**
 * Validate a base URL before it's stored. The value is later injected as an env
 * var (`ANTHROPIC_BASE_URL`, `CURSOR_API_URL`) or interpolated into a codex TOML
 * `-c` override, so reject anything that isn't a clean http(s) URL: it must parse
 * as a URL, use the http/https scheme, and contain no control chars (which could
 * break the env var or the TOML string). Rule 1 — main validates renderer input.
 */
function assertValidBaseUrl(url: string): void {
  // Reject C0 controls + DEL + space; interpolating them into an env var or TOML
  // string is unsafe.
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f ]/.test(url)) {
    throw new Error('Base URL contains control characters');
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid base URL: ${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Base URL must be http(s): ${url}`);
  }
}

/** The ambient env var each family reads by default (the fallback token source). */
const AMBIENT_TOKEN_ENV: Record<HarnessAuthKey, string> = {
  claude: 'ANTHROPIC_API_KEY',
  codex: 'OPENAI_API_KEY',
  cursor: 'CURSOR_API_KEY'
};

/**
 * Set (or clear) a harness's stored credential. `baseUrl`/`token` each:
 *   - a non-empty string ⇒ set/replace,
 *   - `null` ⇒ explicitly clear that field,
 *   - `undefined` ⇒ leave unchanged.
 * Clearing both fields removes the family entry entirely.
 */
export function setHarnessAuth(
  key: HarnessAuthKey,
  patch: { baseUrl?: string | null; token?: string | null }
): void {
  // Rule 1: reject any key outside the closed family enum before it touches the
  // store — the IPC handler forwards the renderer's key verbatim, and a rogue key
  // (arbitrary string, `__proto__`) must never create a stored entry.
  if (!isHarnessAuthKey(key)) {
    throw new Error(`Unknown harness auth key: ${String(key)}`);
  }
  const blob = readBlob();
  const entry: StoredEntry = { ...blob[key] };

  if (patch.baseUrl !== undefined) {
    const v = patch.baseUrl?.trim();
    if (v) {
      assertValidBaseUrl(v);
      entry.baseUrl = v;
    } else delete entry.baseUrl;
  }

  if (patch.token !== undefined) {
    const v = patch.token?.trim();
    if (v) {
      const storage = electronApi().safeStorage;
      if (!storage?.isEncryptionAvailable()) {
        throw new Error('Encryption unavailable — safeStorage not ready');
      }
      entry.tokenEnc = storage.encryptString(v).toString('base64');
    } else {
      delete entry.tokenEnc;
    }
  }

  if (entry.baseUrl === undefined && entry.tokenEnc === undefined) {
    delete blob[key];
  } else {
    blob[key] = entry;
  }
  writeBlob(blob);
}

/**
 * Resolve the STORED credential for a family — the stored baseUrl + decrypted
 * token, for a provider's `authInjection`. Returns `{}` when nothing is stored, so
 * a plain launch injects nothing and stays byte-identical. Never throws (a
 * decryption failure degrades to no token).
 *
 * Deliberately does NOT fall back to the ambient env var: the spawned child
 * already inherits `process.env`, so the ambient key is live without us re-
 * injecting it — and re-injecting would risk REMAPPING it under a different name
 * (e.g. ambient `ANTHROPIC_API_KEY` must NOT become `ANTHROPIC_AUTH_TOKEN`, which
 * has different auth semantics). Ambient presence is surfaced only for the UI
 * "configured" badge — see {@link getHarnessAuthStatus}.
 */
export function getHarnessAuth(key: HarnessAuthKey): HarnessAuthCredential {
  const entry = readBlob()[key] ?? {};
  const cred: HarnessAuthCredential = {};
  if (entry.baseUrl) cred.baseUrl = entry.baseUrl;

  const storage = electronApi().safeStorage;
  if (entry.tokenEnc && storage?.isEncryptionAvailable()) {
    try {
      cred.token = storage.decryptString(Buffer.from(entry.tokenEnc, 'base64'));
    } catch {
      /* no token */
    }
  }
  return cred;
}

/** Renderer-safe status for every family (no secret token values). */
export function getHarnessAuthStatus(): HarnessAuthStatus[] {
  const blob = readBlob();
  return HARNESS_AUTH_KEYS.map((key) => {
    const entry = blob[key] ?? {};
    const hasStored = !!entry.tokenEnc;
    const hasAmbient = !!process.env[AMBIENT_TOKEN_ENV[key]]?.trim();
    return {
      key,
      baseUrl: entry.baseUrl,
      hasToken: hasStored || hasAmbient
    };
  });
}
