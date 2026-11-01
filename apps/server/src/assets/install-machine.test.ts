import { describe, expect, it } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), '../assets/install-machine.sh');

function writeNodeStub(dir: string, major: number): string {
  mkdirSync(dir, { recursive: true });
  const bin = join(dir, 'node');
  writeFileSync(bin, `#!/bin/sh\nif [ "$1" = "-v" ]; then echo v${major}.0.0; exit 0; fi\nif [ "$1" = "-e" ]; then printf ${major}; exit 0; fi\nexit 0\n`);
  chmodSync(bin, 0o755);
  return bin;
}

describe('install-machine.sh flags', () => {
  it.each([false, true])('validates enrollment before stopping the daemon, replacement=%s', replace => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-install-preflight-'));
    const bin = join(root, 'bin'), data = join(root, 'data'), trace = join(root, 'trace');
    mkdirSync(bin); mkdirSync(data);
    writeFileSync(join(data, 'auth.json'), 'saved-auth');
    const stubs = {
      node: 'case "$1" in -e) printf 22; exit 0;; -v) echo v22.0.0; exit 0;; esac\nprintf "%s\\n" "$*" "$ZCC_PROJECT_CATALOGUE_DATA_DIR" >> "$TRACE"\ncase "$*" in *--check-enrollment*) exit 7;; esac',
      curl: 'while [ $# -gt 0 ]; do [ "$1" = -o ] && out=$2; shift; done\n: > "$out"; printf 200',
      tar: 'printf x > "$4/join.mjs"',
      launchctl: 'printf "launchctl %s\\n" "$*" >> "$TRACE"',
      systemctl: 'printf "systemctl %s\\n" "$*" >> "$TRACE"'
    };
    for (const [name, body] of Object.entries(stubs)) {
      writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`); chmodSync(join(bin, name), 0o755);
    }
    const daemon = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', join(data, 'runtime/join.mjs'), 'join'], { stdio: 'ignore' });
    daemon.unref();
    writeFileSync(join(data, 'host-daemon.pid'), String(daemon.pid));
    try {
      const result = spawnSync('sh', [script, '--host-id', 'host-1', '--join-code', 'code', '--server', 'https://example.com', ...(replace ? ['--replace-enrollment'] : [])], {
        encoding: 'utf8', env: { ...process.env, HOME: root, PATH: `${bin}:/usr/bin:/bin`, ZCC_NODE: join(bin, 'node'), ZCC_DATA_DIR: data, TRACE: trace,
          ZCC_INSTALL_WAIT_ATTEMPTS: '1', ZCC_INSTALL_WAIT_DELAY: '0', ZCC_INSTALL_SKIP_SERVICE: '1', ZCC_PROJECT_CATALOGUE_DATA_DIR: replace ? join(root, 'custom-app') : '' }
      });
      expect(result.status).toBe(7);
      const calls = readFileSync(trace, 'utf8');
      expect(calls).toContain('--check-enrollment');
      expect(calls).toContain(replace ? join(root, 'custom-app') : join(root, '.zcc'));
      expect(calls.includes('--replace-enrollment')).toBe(replace);
      expect(calls).not.toMatch(/launchctl|systemctl/);
      expect(readFileSync(join(data, 'auth.json'), 'utf8')).toBe('saved-auth');
      expect(() => process.kill(daemon.pid!, 0)).not.toThrow();
      expect(readFileSync(join(data, 'host-daemon.pid'), 'utf8')).toBe(String(daemon.pid));
    } finally { daemon.kill('SIGKILL'); rmSync(root, { recursive: true, force: true }); }
  });
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

  it('accepts a real Node >= 22 even when FORCE_COLOR is set', () => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-install-color-'));
    try {
      const resolved = spawnSync('sh', [script, '--resolve-node'], {
        encoding: 'utf8',
        env: { ...process.env, PATH: '/usr/bin:/bin', HOME: root, ZCC_NODE: process.execPath, NVM_DIR: '', ZCC_SKIP_NIX_STORE: '1', FORCE_COLOR: '3' }
      });
      expect(resolved.status).toBe(0);
      expect(resolved.stdout.trim()).toBe(process.execPath);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps the daemon without systemd when the user bus is missing', () => {
    const source = spawnSync('sh', ['-c', `grep -E "systemd_user_available|nohup |No systemd user bus" ${JSON.stringify(script)}`], {
      encoding: 'utf8'
    });
    expect(source.stdout).toContain('systemd_user_available');
    expect(source.stdout).toContain('nohup ');
    expect(source.stdout).toContain('No systemd user bus');
  });

  it('refuses to replace another machine and preserves its credentials', () => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-install-identity-'));
    try {
      writeFileSync(join(root, 'host.id'), 'original-host');
      writeFileSync(join(root, 'auth.json'), 'original-credentials');
      const result = spawnSync('sh', [script, '--host-id', 'different-host', '--join-code', 'fixture', '--server', 'https://example.com'], {
        encoding: 'utf8', env: { ...process.env, ZCC_DATA_DIR: root }
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('another machine');
      expect(readFileSync(join(root, 'host.id'), 'utf8')).toBe('original-host');
      expect(readFileSync(join(root, 'auth.json'), 'utf8')).toBe('original-credentials');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  describe('failure markers', () => {
    const joinCode = 'JOINCODE-secret-123';
    const server = 'https://example.com:8443/t/tenant-abc';

    function run(curlBody: string, tarBody = 'exit 0') {
      const root = mkdtempSync(join(tmpdir(), 'zcc-install-marker-'));
      const bin = join(root, 'bin');
      const node = writeNodeStub(bin, 22);
      for (const [name, body] of [['curl', curlBody], ['tar', tarBody]]) {
        writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
        chmodSync(join(bin, name), 0o755);
      }
      const dataDir = join(root, 'data');
      const result = spawnSync('sh', [script, '--join-code', joinCode, '--host-id', 'host-1', '--server', server], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${bin}:/usr/bin:/bin`,
          HOME: root,
          ZCC_NODE: node,
          ZCC_DATA_DIR: dataDir,
          ZCC_INSTALL_SKIP_SERVICE: '1',
          ZCC_INSTALL_WAIT_ATTEMPTS: '2',
          ZCC_INSTALL_WAIT_DELAY: '0'
        }
      });
      return { result, dataDir, root };
    }

    const curlCode = (code: string) => `case "$*" in *127.0.0.1*) exit 0 ;; esac\nwhile [ $# -gt 0 ]; do [ "$1" = -o ] && out=$2; shift; done\n: > "$out"\nprintf %s ${code}`;

    it('reports one stable artifact-unavailable line for an HTTP error without leaking path or join code', () => {
      const { result, root } = run(curlCode('503'));
      try {
        const lines = result.stderr.split('\n').filter((l) => l.startsWith('zcc-install:'));
        expect(lines).toEqual(['zcc-install: artifact-unavailable status=503 origin=https://example.com:8443']);
        expect(result.status).toBe(1);
        expect(result.stderr + result.stdout).not.toContain('/t/');
        expect(result.stderr + result.stdout).not.toContain(joinCode);
      } finally { rmSync(root, { recursive: true, force: true }); }
    });

    it('reports curl-exit-N when curl itself fails', () => {
      const { result, root } = run('exit 7');
      try {
        const lines = result.stderr.split('\n').filter((l) => l.startsWith('zcc-install:'));
        expect(lines).toEqual(['zcc-install: artifact-unavailable status=curl-exit-7 origin=https://example.com:8443']);
        expect(result.status).toBe(1);
      } finally { rmSync(root, { recursive: true, force: true }); }
    });

    it('names the failing step for other nonzero exits', () => {
      const { result, root } = run(curlCode('200'), 'exit 9');
      try {
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('zcc-install: failed step=unpack rc=');
        expect(result.stderr).not.toContain('artifact-unavailable');
        expect(result.stderr).not.toContain(joinCode);
      } finally { rmSync(root, { recursive: true, force: true }); }
    });

    it('prints no marker on success and stamps an attempt boundary before the join', () => {
      const { result, dataDir, root } = run(curlCode('200'), 'printf x > "$4/join.mjs"');
      try {
        expect(result.status).toBe(0);
        expect(result.stderr).not.toContain('zcc-install:');
        const log = readFileSync(join(dataDir, 'host-daemon.log'), 'utf8');
        expect(log).toMatch(/^zcc-join: attempt \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z host=host-1$/m);
        expect(log.startsWith('zcc-join: attempt ')).toBe(true);
      } finally { rmSync(root, { recursive: true, force: true }); }
    });
  });
});
