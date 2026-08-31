import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('hosts pairing IPC', () => {
  it('starts from allowlisted fields and never takes a renderer command string', () => {
    const source = readFileSync(new URL('../hosts-pairing.ts', import.meta.url), 'utf8');
    expect(source).toContain('authorizeSshPairing');
    expect(source).toContain('productServerUrl()');
    expect(source).toContain('sshPairingSession.start');
    expect(source).toContain('IPC.hosts.pairingStart');
    expect(source).not.toContain('req.command');
    expect(source).not.toContain('extraArgs');
  });
});
