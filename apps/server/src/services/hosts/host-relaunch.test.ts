import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('local host daemon relaunch', () => {
  it('steals the data-dir lock so Settings can recover this machine', () => {
    const source = readFileSync(new URL('./host-relaunch.ts', import.meta.url), 'utf8');
    expect(source).toContain('stealLock: true');
    expect(source).toContain('startEnrolledHostDaemon');
  });

  it('is wired on POST /api/v1/hosts/relaunch-local', () => {
    const api = readFileSync(new URL('../../http/hosts-api.ts', import.meta.url), 'utf8');
    expect(api).toContain("path === '/api/v1/hosts/relaunch-local'");
    expect(api).toContain('relaunchLocalHostDaemon');
  });
});
