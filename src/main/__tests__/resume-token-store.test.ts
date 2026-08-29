import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cryptoState = vi.hoisted(() => ({ available: true, decryptThrows: false }));

vi.mock('electron', () => ({
  app: { getPath: () => '/unused' },
  safeStorage: {
    isEncryptionAvailable: () => cryptoState.available,
    encryptString: (value: string) => Buffer.from(`enc:${value}`),
    decryptString: (value: Buffer) => {
      if (cryptoState.decryptThrows) throw new Error('decrypt failed');
      return value.toString().replace(/^enc:/, '');
    }
  }
}));

import { createResumeTokenStore } from '../execution/resume-token-store.js';

describe('resume token store', () => {
  function fixture(now = 1_000) {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-resume-token-'));
    let clock = now;
    const filePath = join(dir, 'tokens.enc');
    return {
      dir,
      filePath,
      store: createResumeTokenStore({ filePath, now: () => clock }),
      advance: (milliseconds: number) => { clock += milliseconds; }
    };
  }

  it('encrypts token at rest and exposes only renderer-safe status', () => {
    const { dir, filePath, store } = fixture();
    try {
      store.set({ projectId: 'project-1', executionId: 'execution-1', token: 'secret-token', expiresAt: 2_000 });
      const raw = readFileSync(filePath, 'utf8');
      expect(raw).not.toContain('secret-token');
      expect(JSON.parse(raw).tokens[0].tokenEnc).toBe(Buffer.from('enc:secret-token').toString('base64'));
      expect(store.status('project-1', 'execution-1')).toEqual({ state: 'available', expiresAt: 2_000 });
      expect(JSON.stringify(store.status('project-1', 'execution-1'))).not.toContain('secret-token');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keys entries by project and execution without renderer disclosure', () => {
    const { dir, store } = fixture();
    try {
      store.set({ projectId: 'project-1', executionId: 'execution-1', token: 'one', expiresAt: 2_000 });
      store.set({ projectId: 'project-2', executionId: 'execution-1', token: 'two', expiresAt: 2_000 });
      expect(store.readForBinding('project-1', 'execution-1')).toBe('one');
      expect(store.status('project-1', 'execution-1')).toEqual({ state: 'available', expiresAt: 2_000 });
      expect(store.readForBinding('project-2', 'execution-1')).toBe('two');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('clears explicit and expired tokens without revealing them', () => {
    const { dir, store, advance } = fixture();
    try {
      store.set({ projectId: 'project-1', executionId: 'execution-1', token: 'clear-me', expiresAt: 2_000 });
      store.clear('project-1', 'execution-1');
      expect(store.status('project-1', 'execution-1')).toEqual({ state: 'missing' });
      store.set({ projectId: 'project-1', executionId: 'execution-2', token: 'expire-me', expiresAt: 2_000 });
      advance(1_000);
      expect(store.status('project-1', 'execution-2')).toEqual({ state: 'expired', expiresAt: 2_000 });
      expect(store.readForBinding('project-1', 'execution-2')).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('consumes corrupt encrypted data rather than permitting a retry', () => {
    const { dir, store } = fixture();
    try {
      store.set({ projectId: 'project-1', executionId: 'execution-1', token: 'token', expiresAt: 2_000 });
      cryptoState.decryptThrows = true;
      expect(store.readForBinding('project-1', 'execution-1')).toBeUndefined();
      cryptoState.decryptThrows = false;
      expect(store.status('project-1', 'execution-1')).toEqual({ state: 'missing' });
    } finally {
      cryptoState.decryptThrows = false;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects invalid input and fails closed when encryption is unavailable', () => {
    const { dir, store } = fixture();
    try {
      expect(() => store.set({ projectId: '', executionId: 'execution-1', token: 'token', expiresAt: 2_000 })).toThrow(/project id/);
      expect(() => store.set({ projectId: 'project-1', executionId: 'execution-1', token: 'token', expiresAt: 1_000 })).toThrow(/expiry/);
      cryptoState.available = false;
      expect(() => store.set({ projectId: 'project-1', executionId: 'execution-1', token: 'token', expiresAt: 2_000 })).toThrow(/Encryption unavailable/);
      expect(store.status('project-1', 'execution-1')).toEqual({ state: 'missing' });
    } finally {
      cryptoState.available = true;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('replaces the cached token atomically and survives store reload', () => {
    const { dir, filePath, store } = fixture();
    try {
      store.set({ projectId: 'project-1', executionId: 'execution-1', token: 'old-token', expiresAt: 2_000 });
      store.set({ projectId: 'project-1', executionId: 'execution-1', token: 'rotated-token', expiresAt: 3_000 });
      const reloaded = createResumeTokenStore({ filePath, now: () => 1_000 });
      expect(reloaded.readForBinding('project-1', 'execution-1')).toBe('rotated-token');
      expect(readFileSync(filePath, 'utf8')).not.toContain('rotated-token');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform !== 'win32')('writes 0600 token file', () => {
    const { dir, filePath, store } = fixture();
    try {
      store.set({ projectId: 'project-1', executionId: 'execution-1', token: 'token', expiresAt: 2_000 });
      expect(statSync(filePath).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
