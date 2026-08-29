import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('hosts:relaunchLocal IPC', () => {
  it('relaunches the packaged host utility instead of stealing its lock over HTTP', () => {
    const source = readFileSync(new URL('../app.ts', import.meta.url), 'utf8');
    expect(source).toContain('IPC.hosts.relaunchLocal');
    expect(source).toContain('relaunchEnrolledHost');
    expect(source).toContain('api/v1/hosts/relaunch-local');
    const relaunchIdx = source.indexOf('relaunchEnrolledHost');
    const httpIdx = source.indexOf('api/v1/hosts/relaunch-local');
    expect(relaunchIdx).toBeGreaterThan(-1);
    expect(httpIdx).toBeGreaterThan(relaunchIdx);
  });
});
