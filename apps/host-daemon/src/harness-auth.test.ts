import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, rmSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

// A throwaway HOME per run so the store writes to ~/.zcc/harness-auth.enc under
// a temp dir, and a fake safeStorage that "encrypts" by tagging the plaintext
// (reversible) — enough to prove the store round-trips + keeps the token off the
// renderer-facing status. `vi.hoisted` runs BEFORE the (hoisted) vi.mock factory
// and the module import, so `HOME` is initialized when harness-auth.ts computes
// its data dir at load time.
const { HOME, cryptoState } = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  return {
    HOME: mkdtempSync(join(tmpdir(), 'cc-harness-auth-')) as string,
    // Mutable so a test can flip encryption off or force a decrypt failure.
    cryptoState: { available: true, decryptThrows: false } as {
      available: boolean;
      decryptThrows: boolean;
    }
  };
});

vi.mock('electron', () => ({
  app: { getPath: () => HOME },
  safeStorage: {
    isEncryptionAvailable: () => cryptoState.available,
    encryptString: (s: string) => Buffer.from(`enc:${s}`),
    decryptString: (b: Buffer) => {
      if (cryptoState.decryptThrows) throw new Error('decrypt failed');
      return b.toString().replace(/^enc:/, '');
    }
  }
}));

import {
  setHarnessAuth,
  getHarnessAuth,
  getHarnessAuthStatus,
  isHarnessAuthKey,
  HARNESS_AUTH_KEYS
} from './harness-auth.js';

const authFile = join(HOME, '.zcc', 'harness-auth.enc');

describe('harness-auth store', () => {
  beforeEach(() => {
    // Restore healthy encryption before each test clears the store.
    cryptoState.available = true;
    cryptoState.decryptThrows = false;
    // Clear every family between tests so each starts clean.
    for (const k of HARNESS_AUTH_KEYS) setHarnessAuth(k, { baseUrl: null, token: null });
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.CURSOR_API_KEY;
  });

  afterEach(() => {
    vi.unstubAllEnvs?.();
  });

  it('nothing stored ⇒ empty credential + hasToken false', () => {
    expect(getHarnessAuth('claude')).toEqual({});
    const status = getHarnessAuthStatus().find((s) => s.key === 'claude')!;
    expect(status).toEqual({ key: 'claude', baseUrl: undefined, hasToken: false });
  });

  it('round-trips a base URL (readable) and token (decrypted only via getHarnessAuth)', () => {
    setHarnessAuth('codex', { baseUrl: 'https://gw/v1', token: 'sk-secret' });
    expect(getHarnessAuth('codex')).toEqual({ baseUrl: 'https://gw/v1', token: 'sk-secret' });

    // The renderer-facing status carries the URL but NEVER the token value.
    const status = getHarnessAuthStatus().find((s) => s.key === 'codex')!;
    expect(status.baseUrl).toBe('https://gw/v1');
    expect(status.hasToken).toBe(true);
    expect(JSON.stringify(status)).not.toContain('sk-secret');
  });

  it('the on-disk blob stores the token ENCRYPTED, never plaintext', () => {
    setHarnessAuth('claude', { token: 'plaintext-token' });
    const raw = readFileSync(authFile, 'utf8');
    expect(raw).not.toContain('plaintext-token');
    // Stored under tokenEnc as base64 of the (fake-)encrypted bytes.
    const blob = JSON.parse(raw);
    expect(blob.claude.tokenEnc).toBeTruthy();
    expect(Buffer.from(blob.claude.tokenEnc, 'base64').toString()).toBe('enc:plaintext-token');
  });

  it('null clears a single field; undefined leaves it unchanged', () => {
    setHarnessAuth('cursor', { baseUrl: 'https://c/api', token: 'k' });
    // Clear only the token; base URL survives.
    setHarnessAuth('cursor', { token: null });
    expect(getHarnessAuth('cursor')).toEqual({ baseUrl: 'https://c/api' });
    // undefined token leaves it cleared; update only the URL.
    setHarnessAuth('cursor', { baseUrl: 'https://c/api2' });
    expect(getHarnessAuth('cursor')).toEqual({ baseUrl: 'https://c/api2' });
  });

  it('clearing both fields removes the family entry from disk', () => {
    setHarnessAuth('claude', { baseUrl: 'https://a', token: 't' });
    expect(existsSync(authFile)).toBe(true);
    setHarnessAuth('claude', { baseUrl: null, token: null });
    expect(getHarnessAuth('claude')).toEqual({});
  });

  it('a blank/whitespace value clears rather than sets', () => {
    setHarnessAuth('codex', { token: 'real' });
    setHarnessAuth('codex', { token: '   ' });
    expect(getHarnessAuth('codex').token).toBeUndefined();
  });

  it('rejects an unknown / prototype-polluting key (Rule 1: main validates)', () => {
    expect(isHarnessAuthKey('claude')).toBe(true);
    expect(isHarnessAuthKey('gemini')).toBe(false);
    expect(isHarnessAuthKey('__proto__')).toBe(false);
    expect(isHarnessAuthKey(42)).toBe(false);
    expect(isHarnessAuthKey(undefined)).toBe(false);
    // A rogue key from an untrusted renderer must throw, not create a stored entry.
    expect(() => setHarnessAuth('evil' as never, { token: 't' })).toThrow(/Unknown harness auth key/);
    expect(() => setHarnessAuth('__proto__' as never, { token: 't' })).toThrow();
    // The store is untouched — no rogue family, and the prototype is intact.
    expect(getHarnessAuthStatus().map((s) => s.key).sort()).toEqual(['claude', 'codex', 'cursor']);
    expect(({} as Record<string, unknown>).token).toBeUndefined();
  });

  it('encryption unavailable ⇒ set(token) throws and stores nothing; baseUrl still saves', () => {
    cryptoState.available = false;
    // A token write must fail loudly (the UI relies on the throw → false "saved").
    expect(() => setHarnessAuth('claude', { token: 'sk-x' })).toThrow(/Encryption unavailable/);
    // …and leave no stored token behind.
    const status = getHarnessAuthStatus().find((s) => s.key === 'claude')!;
    expect(status.hasToken).toBe(false);
    // A base-URL-only write does NOT touch encryption, so it still succeeds.
    setHarnessAuth('claude', { baseUrl: 'https://gw' });
    expect(getHarnessAuth('claude')).toEqual({ baseUrl: 'https://gw' });
  });

  it('a stored token becomes unreadable if encryption goes away later', () => {
    setHarnessAuth('claude', { token: 'sk-later' });
    expect(getHarnessAuth('claude').token).toBe('sk-later');
    // Encryption regresses (e.g. keychain locked) — getHarnessAuth must degrade to
    // no token, never throw, so a launch just proceeds without the override.
    cryptoState.available = false;
    expect(getHarnessAuth('claude')).toEqual({});
  });

  it('a decrypt failure degrades to no token instead of throwing', () => {
    setHarnessAuth('codex', { baseUrl: 'https://gw/v1', token: 'sk-corrupt' });
    cryptoState.decryptThrows = true;
    // Base URL survives (it isn't encrypted); the token is silently dropped.
    expect(getHarnessAuth('codex')).toEqual({ baseUrl: 'https://gw/v1' });
  });

  it.runIf(process.platform !== 'win32')('writes the credential file owner-only (0600)', () => {
    setHarnessAuth('claude', { token: 't' });
    expect(statSync(authFile).mode & 0o777).toBe(0o600);
  });

  it('rejects a non-http(s) or malformed base URL, storing nothing', () => {
    expect(() => setHarnessAuth('claude', { baseUrl: 'file:///etc/passwd' })).toThrow(/http/);
    expect(() => setHarnessAuth('claude', { baseUrl: 'not-a-url' })).toThrow(/Invalid base URL/);
    expect(() => setHarnessAuth('claude', { baseUrl: 'javascript:alert(1)' })).toThrow(/http/);
    // A control char (would corrupt the env var / TOML string) is rejected too.
    expect(() => setHarnessAuth('claude', { baseUrl: 'https://h\n/v1' })).toThrow(/control/);
    // Nothing landed in the store.
    expect(getHarnessAuth('claude')).toEqual({});
    // A clean https URL still saves.
    setHarnessAuth('claude', { baseUrl: 'https://gw.example/v1' });
    expect(getHarnessAuth('claude')).toEqual({ baseUrl: 'https://gw.example/v1' });
  });

  it('ambient env token surfaces in STATUS (hasToken) but NOT in getHarnessAuth', () => {
    process.env.OPENAI_API_KEY = 'ambient-key';
    // Nothing stored, but the ambient key means the UI shows "configured".
    const status = getHarnessAuthStatus().find((s) => s.key === 'codex')!;
    expect(status.hasToken).toBe(true);
    // getHarnessAuth is STORED-ONLY — it must NOT re-inject the ambient key
    // (which would risk remapping it under the wrong provider env var).
    expect(getHarnessAuth('codex')).toEqual({});
  });
});

afterEach(() => {
  /* keep HOME across the suite; remove at process exit */
});

// Best-effort cleanup of the temp HOME.
process.on('exit', () => {
  try {
    rmSync(HOME, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});
