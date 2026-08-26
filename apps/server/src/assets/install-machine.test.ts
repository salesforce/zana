import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

describe('install-machine.sh flags', () => {
  it('requires join-code, host-id, and server', () => {
    const script = join(dirname(fileURLToPath(import.meta.url)), '../assets/install-machine.sh');
    const missing = spawnSync('sh', [script], { encoding: 'utf8' });
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain('--join-code');
    const unknown = spawnSync('sh', [script, '--nope'], { encoding: 'utf8' });
    expect(unknown.status).toBe(2);
  });
});
