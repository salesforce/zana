import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createControlCredentialSigner } from './control-credential.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('control credential signer', () => {
  it('keeps session credentials valid across signer restarts without exposing the secret', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-control-credential-'));
    dirs.push(dir);
    const secretPath = join(dir, 'control-signing.key');
    const first = createControlCredentialSigner({
      secretPath,
      randomSecret: () => Buffer.alloc(32, 7)
    });
    const credential = first.credentialForSession('tmux-session');

    const restarted = createControlCredentialSigner({
      secretPath,
      randomSecret: () => Buffer.alloc(32, 9)
    });
    expect(restarted.verifySessionCredential('tmux-session', credential)).toBe(true);
    expect(restarted.verifySessionCredential('other-session', credential)).toBe(false);
    expect(statSync(secretPath).mode & 0o777).toBe(0o600);
    expect(readFileSync(secretPath)).toEqual(Buffer.alloc(32, 7));
    expect(credential).not.toContain(Buffer.alloc(32, 7).toString('hex'));
  });
});
