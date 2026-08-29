import { describe, expect, it } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), '../assets/install-machine.sh');

function writeNodeStub(dir: string, major: number): string {
  mkdirSync(dir, { recursive: true });
  const bin = join(dir, 'node');
  writeFileSync(bin, `#!/bin/sh\nif [ "$1" = "-v" ]; then echo v${major}.0.0; exit 0; fi\nif [ "$1" = "-p" ]; then echo ${major}; exit 0; fi\nexit 0\n`);
  chmodSync(bin, 0o755);
  return bin;
}

describe('install-machine.sh flags', () => {
  it('requires join-code, host-id, and server', () => {
    const missing = spawnSync('sh', [script], { encoding: 'utf8' });
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain('--join-code');
    const unknown = spawnSync('sh', [script, '--nope'], { encoding: 'utf8' });
    expect(unknown.status).toBe(2);
  });

  it('picks Node >= 22 from PATH, nix-profile, or ZCC_NODE and ignores PATH Node 20', () => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-install-node-'));
    const node20 = writeNodeStub(join(root, 'node20'), 20);
    const node22 = writeNodeStub(join(root, 'node22'), 22);
    const emptyHome = join(root, 'empty-home');
    mkdirSync(emptyHome);

    const tooOld = spawnSync('sh', [script, '--resolve-node'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${dirname(node20)}:/usr/bin:/bin`,
        HOME: emptyHome,
        ZCC_NODE: '',
        NVM_DIR: '',
        ZCC_SKIP_NIX_STORE: '1'
      }
    });
    expect(tooOld.status).toBe(1);
    expect(tooOld.stderr).toContain('Node.js >= 22');

    const fromEnv = spawnSync('sh', [script, '--resolve-node'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${dirname(node20)}:/usr/bin:/bin`,
        HOME: emptyHome,
        ZCC_NODE: node22,
        NVM_DIR: '',
        ZCC_SKIP_NIX_STORE: '1'
      }
    });
    expect(fromEnv.status).toBe(0);
    expect(fromEnv.stdout.trim()).toBe(node22);

    const nixHome = join(root, 'nix-home');
    const nixNode = writeNodeStub(join(nixHome, '.nix-profile', 'bin'), 22);
    const fromNix = spawnSync('sh', [script, '--resolve-node'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${dirname(node20)}:/usr/bin:/bin`,
        HOME: nixHome,
        ZCC_NODE: '',
        NVM_DIR: '',
        ZCC_SKIP_NIX_STORE: '1'
      }
    });
    expect(fromNix.status).toBe(0);
    expect(fromNix.stdout.trim()).toBe(nixNode);
  });

  it('keeps the daemon without systemd when the user bus is missing', () => {
    const source = spawnSync('sh', ['-c', `grep -E "systemd_user_available|nohup |No systemd user bus" ${JSON.stringify(script)}`], {
      encoding: 'utf8'
    });
    expect(source.stdout).toContain('systemd_user_available');
    expect(source.stdout).toContain('nohup ');
    expect(source.stdout).toContain('No systemd user bus');
  });
});
