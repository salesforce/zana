import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('hosts pairing IPC', () => {
  const source = readFileSync(new URL('../hosts-pairing.ts', import.meta.url), 'utf8');

  it('starts from allowlisted fields and never takes a renderer command string', () => {
    expect(source).toContain('authorizeSshPairing');
    expect(source).toContain('productServerUrl()');
    expect(source).toContain('sshPairingSession.start');
    expect(source).toContain('IPC.hosts.pairingStart');
    expect(source).not.toContain('req.command');
    expect(source).not.toContain('extraArgs');
  });

  it('takes the pairing origin from the supervisor selector, not the bare public app URL', () => {
    expect(source).toContain('pairingTarget()');
    expect(source).not.toContain('resolvePublicAppUrl');
    expect(source).not.toContain('publicAppUrl');
    expect(source).not.toContain('sshPairingArgv');
  });
});
